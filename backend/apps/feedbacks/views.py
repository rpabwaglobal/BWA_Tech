"""
Views do app de feedback.

FeedbackPublicoView é a ÚNICA rota sem autenticação do sistema inteiro fora de
login/register/recover. Tratada como superfície de ataque: ver os comentários de
`_pedido_utilizavel` e `_indisponivel`, que são onde as decisões de segurança
moram.

PedidoFeedbackViewSet é o oposto: autenticado, sob `view_content`, e existe só
para a fase 2 pegar o link e montar o botão de copiar.
"""
from __future__ import annotations

import logging
import re

from django.db import IntegrityError, transaction
from django.db.models import Count, DateTimeField, Q, Max, Value
from django.db.models.functions import Coalesce
from django.utils import timezone
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_exempt
from rest_framework import mixins, status, viewsets
from rest_framework.parsers import JSONParser
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.permissions import HasPerm, PodeVerConteudo
from apps.accounts.scoping import scope_cards

from .models import (
    ESTADOS_QUE_PROMOVEM,
    MAX_RESPOSTAS_POR_PEDIDO,
    EstadoPedido,
    PedidoFeedback,
    RespostaFeedback,
    link_ativo,
)
from .serializers import (
    FormularioPublicoSerializer,
    PedidoFeedbackInternoSerializer,
    PedidoFeedbackResumoSerializer,
    validar_valores,
)
from .services import mascara_token, notificar_transicao
from .throttling import FeedbackEnvioThrottle, FeedbackIPThrottle, FeedbackTokenThrottle

logger = logging.getLogger(__name__)

# UMA mensagem para TODOS os casos não-utilizáveis. Token inexistente, token
# fora do alfabeto, token grande demais, pedido apagado por CASCADE e pedido que
# bateu no teto de respostas saem por aqui com o MESMO status e o MESMO corpo —
# é o que impede a rota de virar oráculo de enumeração.
#
# "JÁ RESPONDIDO" SAIU desta lista: o link não expira mais, então um pedido
# respondido é utilizável como qualquer outro e devolve o formulário. O texto
# continua verdadeiro para os casos que restam.
MSG_INDISPONIVEL = 'Este link não está mais disponível.'

# A ÚNICA resposta desta rota que NÃO é o 404 uniforme — e a exceção é
# deliberada, com um limite escrito.
#
# O que o 404 único protege é ENUMERAÇÃO: token inexistente, token fora do
# alfabeto, token grande demais e pedido apagado por CASCADE têm de ser
# INDISTINGUÍVEIS entre si, senão a rota vira oráculo de "este token existe".
# Essa propriedade continua INTACTA — nada disso passa por aqui: `_encerrado`
# só é alcançado DEPOIS de o token ter sido resolvido para uma linha real.
#
# A distinção que este bloco cria é encerrado × aberto, e ela não entrega nada:
# quem tem o token já sabia que o link existia (foi enviado a ele à mão). Esconder
# o encerramento atrás do 404 genérico só faria o cliente achar que o link
# quebrou e cobrar a equipe — sem ganho de segurança nenhum.
#
# 410 GONE, e não 404: aqui "existiu e acabou" é EXATAMENTE o que se quer dizer,
# e é o status que dá ao frontend um gancho estável para a tela própria sem
# depender de casar string de mensagem. `encerrado: True` vai junto pelo mesmo
# motivo, para o cliente não ter de inferir nada do status.
MSG_ENCERRADO = (
    'Este feedback foi encerrado e não aceita mais respostas. '
    'Se você precisa enviar uma avaliação, fale com quem te enviou o link.'
)

# `secrets.token_urlsafe(32)` produz 43 caracteres; a coluna tem 64. Recusar
# acima disso evita levar lixo até o banco — e recusa com a MESMA resposta de
# token inexistente, então não é um sinal aproveitável.
TAMANHO_MAX_TOKEN = 64

# O alfabeto de `secrets.token_urlsafe` (base64 url-safe): letras, dígitos, '_'
# e '-'. Qualquer outra coisa não é um token possível e nem chega ao banco.
_ALFABETO_TOKEN = re.compile(r'[A-Za-z0-9_-]+')


class FeedbackPublicoView(APIView):
    """GET devolve o formulário; POST grava a resposta. Sem login, por desenho.

    Molde copiado das três únicas rotas anônimas do sistema
    (accounts/views.py:909, :941, :1001). `authentication_classes = []` é o item
    que mais importa: nenhum header Authorization e nenhum cookie de sessão é
    sequer processado, então `request.user` é AnonymousUser deterministicamente
    e um funcionário logado no mesmo navegador não "empresta" sessão para esta
    rota. O código abaixo NÃO lê `request.user` em ponto nenhum.

    O gate `PodeVerConteudo` é aplicado view a view no resto do sistema, nunca em
    DEFAULT_PERMISSION_CLASSES — então esta rota nasce fora dele por construção,
    sem precisar de exceção.

    `throttle_classes` SUBSTITUI a lista default (não soma): aqui valem só os
    limites desta rota, escolhidos por MÉTODO em `get_throttles`.
    """

    permission_classes = [AllowAny]
    authentication_classes = []
    # Só o limite por IP é comum aos dois métodos; o limite por token é
    # escolhido em `get_throttles` (leitura e escrita têm baldes separados).
    throttle_classes = [FeedbackIPThrottle, FeedbackTokenThrottle]

    def get_throttles(self):
        """Baldes SEPARADOS para ler e para escrever o mesmo link.

        Antes GET e POST dividiam o MESMO balde de token, e isso nunca apertou
        porque o link era de uso único. Agora ele é perene e vai para várias
        pessoas: 20 pessoas abrindo o link (e algumas recarregando) consumiam o
        balde e o cliente LEGÍTIMO via "Muitas tentativas em pouco tempo".

        O limite único também estava frouxo no outro sentido: 60 INSERTs por
        hora não é teto nenhum para um link sem login. Separando, a leitura
        afrouxa (120/hour) e a escrita aperta muito (10/hour) — 10 opiniões por
        hora no MESMO link já é folga absurda para o caso real.

        `feedback_ip` fica nos dois: é por IP, e 20 pessoas são 20 IPs.
        """
        if self.request.method == 'POST':
            return [FeedbackIPThrottle(), FeedbackEnvioThrottle()]
        return [FeedbackIPThrottle(), FeedbackTokenThrottle()]

    # SÓ JSON. Sem isto, o DRF monta os parsers default (JSON + Form +
    # MultiPart) e um POST `multipart/form-data` de QUALQUER pessoa que tenha o
    # link é PARSEADO antes de a view olhar o conteúdo: `DATA_UPLOAD_MAX_MEMORY_SIZE`
    # não vale para as partes de ARQUIVO, então tudo acima de
    # FILE_UPLOAD_MAX_MEMORY_SIZE (2,5 MB) vai para arquivo temporário em DISCO.
    # MEDIDO: um upload de 3 MB num token válido era aceito e parseado (a
    # resposta era 400 "Formato inválido", DEPOIS de gravar). Um anônimo
    # escrevendo em disco sem limite de tamanho é gravidade desnecessária numa
    # rota que só recebe um JSON pequeno.
    #
    # Com apenas o JSONParser, o DRF levanta UnsupportedMediaType (415) na
    # seleção do parser, ANTES de tocar no corpo (`Request._parse` escolhe o
    # parser antes de ler o stream) — o disco nunca é usado.
    #
    # NÃO vira oráculo: `request.data` só é acessado DEPOIS de `_pedido_utilizavel`,
    # então um token inutilizável continua saindo pelo 404 de sempre, com
    # qualquer Content-Type.
    parser_classes = [JSONParser]

    # OPTIONS não pode descrever a view. O metadata default do DRF devolve o
    # `name` e a DESCRIPTION da classe — isto é, a DOCSTRING inteira — para
    # quem não tem login. MEDIDO: `OPTIONS /api/feedback/<qualquer coisa>/`
    # devolvia 200 com 989 bytes contendo os caminhos e as LINHAS do código de
    # autenticação ("accounts/views.py:909, :941, :1001") e o desenho da rota.
    # Isso é reconhecimento de graça para quem está sondando, e contraria a
    # regra desta fase: a rota pública não expõe nada interno.
    #
    # `metadata_class = None` faz o próprio DRF responder 405
    # (rest_framework/views.py, `APIView.options`), igual para token válido e
    # inválido. O PREFLIGHT do navegador não passa por aqui: o CorsMiddleware
    # responde ao OPTIONS com `Access-Control-Request-Method` antes da view
    # (há teste cobrindo isso).
    metadata_class = None

    @method_decorator(csrf_exempt)
    def dispatch(self, *args, **kwargs):
        return super().dispatch(*args, **kwargs)

    def finalize_response(self, request, response, *args, **kwargs):
        """Impede que o TOKEN INTEIRO entre no log da aplicação.

        MEDIDO, não suposto: `django/core/handlers/base.py:142-149` chama
        `log_response` para TODA resposta com status >= 400 — não só quando um
        Http404 propaga. Como o token está no path e o logger `django.request`
        está em nível DEBUG (settings.py:497-501), cada 404/400/429 desta rota
        gravaria a credencial completa em log. Só trocar `raise Http404` por
        `return Response(404)` NÃO resolve; os testes mostraram o token no log
        mesmo assim.

        `_has_been_logged` é a chave que o próprio `django.utils.log.log_response`
        consulta antes de logar (utils/log.py:237). Marcando aqui, o log é
        suprimido para as respostas desta view — e só desta view.

        Fica em `finalize_response` porque é por onde passam TODAS as respostas
        do DRF, inclusive as que nascem de exceção (o 429 do throttle e o 405 de
        método não permitido), que nenhum `return` nosso alcançaria.

        RESIDUAL DECLARADO: o token continua no access log do Traefik/daphne,
        exatamente como um link de redefinição de senha em qualquer sistema.
        """
        response = super().finalize_response(request, response, *args, **kwargs)
        if response.status_code >= 400:
            response._has_been_logged = True
        return response

    # --- fronteira ---------------------------------------------------------

    def _indisponivel(self) -> Response:
        """A resposta única de "não dá para usar este link".

        404 e não 410/403: 410 significa "existiu e acabou" e seria ele próprio
        o oráculo. Um corpo só, um status só, para todos os casos.
        """
        return Response({'detail': MSG_INDISPONIVEL}, status=status.HTTP_404_NOT_FOUND)

    def _encerrado(self) -> Response:
        """A tela PRÓPRIA de "este feedback foi encerrado". Ver MSG_ENCERRADO.

        Corpo mínimo de propósito: nem `referencia`, nem `data_entrega`, nem
        contador. A página encerrada não precisa deles para dizer o que precisa
        dizer, e cada campo a mais aqui é dado da empresa exposto numa rota
        anônima sem nenhum ganho para quem lê.
        """
        return Response(
            {'detail': MSG_ENCERRADO, 'encerrado': True},
            status=status.HTTP_410_GONE,
        )

    def _pedido_utilizavel(self, token: str):
        """Resolve o token, ou None. Uma função só decide TUDO.

        O LINK NÃO EXPIRA: nem por tempo, nem por ter sido respondido. O
        `.exclude(estado=RESPONDIDO)` que morava nesta query FOI REMOVIDO — era
        ele, e só ele, que fechava o link para GET e para POST ao mesmo tempo.
        Com ele fora, o GET devolve o formulário para sempre e várias pessoas
        respondem o mesmo link, que é o pedido literal do usuário.

        O que NÃO mudou é a propriedade anti-enumeração: continua sendo UMA
        consulta, e token inexistente, token fora do alfabeto, token grande
        demais e pedido apagado por CASCADE continuam percorrendo o mesmo
        caminho, com o mesmo custo e a mesma resposta. O que saiu da lista de
        casos indistinguíveis é só "já respondido" — porque ele deixou de ser um
        caso não-utilizável.

        LIMITE HONESTO: um token VÁLIDO E UTILIZÁVEL é, por definição,
        distinguível — ele funciona, e pode devolver 400 numa validação de
        campo. A garantia que importa para enumeração é a que está aqui: todos
        os estados NÃO-UTILIZÁVEIS são indistinguíveis entre si.
        """
        # Só o alfabeto que `secrets.token_urlsafe` produz chega ao banco. Não é
        # validação de formulário — é para que nenhum byte esquisito vindo da URL
        # (NUL, acentos, o que o cliente inventar) vire erro de driver: no
        # Postgres um '\x00' numa comparação de texto levanta ValueError, o que
        # daria 500 — e um 500 escapa da supressão de log de `finalize_response`,
        # levando a URL INTEIRA para o log da aplicação. Recusa aqui, com o
        # MESMO 404 de sempre, então não é sinal aproveitável.
        if not token or len(token) > TAMANHO_MAX_TOKEN or not _ALFABETO_TOKEN.fullmatch(token):
            return None
        return (
            PedidoFeedback.objects
            .select_related('formulario')
            .filter(token=token)
            .first()
        )

    # --- endpoints ---------------------------------------------------------

    def get(self, request, token: str):
        """Devolve {titulo, subtitulo, referencia, data_entrega, campos}. Nada além disso.

        Pode ser chamado quantas vezes for preciso, SEMPRE — inclusive durante a
        espera dos 30 dias e inclusive depois de já ter sido respondido, porque
        o link não expira. Reabrir traz o formulário em branco, pronto para
        OUTRA pessoa responder.

        NÃO diz quantas pessoas já responderam. O contador é dado INTERNO: ele
        vive no endpoint autenticado. Aqui ele vazaria informação da empresa e
        ainda influenciaria quem está prestes a responder.

        O rascunho fica em localStorage no navegador, o que atende o caso
        "fechei sem querer" sem criar tabela de rascunho nem mais dado pessoal
        no servidor.
        """
        pedido = self._pedido_utilizavel(token)
        if pedido is None:
            return self._indisponivel()
        # "Para sempre" ganhou UMA exceção, e ela é reversível: enquanto o pedido
        # estiver em "Feedback Finalizado" o formulário nem é montado. Arrastar o
        # card de volta no board reabre — o token é o mesmo, nada foi revogado.
        if not link_ativo(pedido.estado):
            return self._encerrado()
        return Response(FormularioPublicoSerializer(pedido).data)

    def post(self, request, token: str):
        """Grava UMA resposta. Várias pessoas podem responder o mesmo link.

        Cada envio é uma LINHA nova: nenhuma sobrescreve a anterior, porque o
        valor da feature é ter várias opiniões sobre a mesma entrega.
        """
        pedido = self._pedido_utilizavel(token)
        if pedido is None:
            return self._indisponivel()

        # ANTES de tocar em `request.data`: um link encerrado não deve nem
        # parsear o corpo, muito menos devolver erro de validação campo a campo —
        # isso seria uma tela de formulário respondendo a quem já não pode
        # responder. É a MESMA checagem do GET, na mesma ordem, para não existir
        # a janela em que a página abre e o envio falha (ou o contrário).
        if not link_ativo(pedido.estado):
            return self._encerrado()

        corpo = request.data if isinstance(request.data, dict) else {}
        limpos, erros = validar_valores(pedido.formulario.campos, corpo.get('valores'))
        if erros:
            return Response({'valores': erros}, status=status.HTTP_400_BAD_REQUEST)

        # TETO ABSOLUTO POR PEDIDO — o que substitui o índice único do OneToOne.
        # Recusa com o MESMO 404 de sempre, e não com um 429 nem com uma tela
        # nova: um corpo diferente aqui tornaria a rota um oráculo ("este token
        # existe e está cheio"). Uma consulta COUNT a mais por POST, nenhuma no
        # GET.
        if pedido.respostas.count() >= MAX_RESPOSTAS_POR_PEDIDO:
            return self._indisponivel()

        try:
            # `atomic` isola o INSERT: um IntegrityError sem ele deixaria a
            # transação da requisição quebrada para qualquer query seguinte.
            with transaction.atomic():
                RespostaFeedback.objects.create(pedido=pedido, valores=limpos)
        except IntegrityError:
            # Este `except` DEIXOU de significar "já respondeu" (não há mais
            # índice único a violar) e agora só pega falha REAL de banco. Mantido
            # mesmo assim: sem ele o erro viraria 500, e um 500 escapa da
            # supressão de log de `finalize_response`, levando o TOKEN que está
            # no path para o log da aplicação. Loga aqui, com o token mascarado,
            # e devolve o 404 de sempre.
            logger.exception(
                'Feedback: falha ao gravar a resposta do pedido %s (token %s)',
                pedido.pk, mascara_token(token),
            )
            return self._indisponivel()

        agora = timezone.now()
        # Estado no WHERE: o banco serializa as tentativas e o ROWCOUNT decide
        # quem de fato promoveu. `atualizado_em` é explícito porque auto_now não
        # dispara em queryset .update().
        #
        # Aceita responder ANTES dos 30 dias (estado ainda 'aguardando_prazo'):
        # o link nasce junto com o pedido, então quem recebeu antes e respondeu
        # pula direto para "Feedback colhido".
        #
        # É ESTE WHERE que faz o card entrar em "Feedback colhido" na PRIMEIRA
        # resposta e FICAR lá: da 2ª em diante o estado já é RESPONDIDO, o
        # rowcount é 0, o hook não redispara e `respondido_em` NÃO se move —
        # movê-lo tornaria o prazo de retenção do dado pessoal reiniciável por um
        # anônimo, indefinidamente.
        promovido = PedidoFeedback.objects.filter(
            pk=pedido.pk, estado__in=ESTADOS_QUE_PROMOVEM,
        ).update(
            estado=EstadoPedido.RESPONDIDO,
            # `Coalesce` e não `agora` cru: com "Feedback Finalizado" existe agora
            # um caminho que devolve um pedido JÁ RESPONDIDO ao estado
            # 'aguardando_resposta' (encerrar e depois arrastar de volta). Sem
            # isto, a resposta seguinte reentraria neste UPDATE — o rowcount
            # voltaria a ser 1 — e sobrescreveria `respondido_em`, que é o
            # instante da PRIMEIRA resposta e a data que a tela mostra. A
            # docstring acima já prometia que ele "NÃO se move"; até este pedido
            # quem garantia isso era só o WHERE, e ele deixou de bastar.
            respondido_em=Coalesce(
                'respondido_em', Value(agora, output_field=DateTimeField()),
            ),
            atualizado_em=agora,
        )
        if promovido == 1:
            try:
                notificar_transicao(pedido.pk, EstadoPedido.RESPONDIDO)
            except Exception:  # noqa: BLE001 — o hook é da fase 2; falha dele
                # não pode desfazer uma resposta que já está gravada.
                logger.exception(
                    'Feedback: hook de transição falhou no pedido %s (token %s)',
                    pedido.pk, mascara_token(token),
                )

        return Response(
            {'detail': 'Resposta recebida. Obrigado!'},
            status=status.HTTP_201_CREATED,
        )


class PedidoFeedbackViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    """Onde a fase 2 pega o link para COPIAR — um card, ou um LOTE de cards.

    `GET /api/feedbacks/pedidos/?card=<id>` casa `<id>` contra `card_id` OU
    `card_kanban_id`, porque a fase 2 vai perguntar a partir do card do kanban de
    monitoramento, e a fase 1 já grava o pedido pelo card MARCADO.

    `GET /api/feedbacks/pedidos/?cards=1,2,3` é a MESMA pergunta em lote, para o
    preview do board desenhar o link em cada card sem uma requisição POR CARD
    (um board de 40 cards faria 40 chamadas a cada render). Teto de ids por
    chamada, e o escopo de setor é aplicado ao CONJUNTO de uma vez.

    OS DOIS MODOS DEVOLVEM FORMATOS DIFERENTES, e isso é deliberado: o singular
    (diálogo do card) traz o TEXTO das respostas; o lote (board) traz só o link
    e o contador. Um board de 100 cards não pode baixar megabytes de dado
    pessoal para desenhar 100 botões de copiar.

    ESTE ENDPOINT ENTREGA O TOKEN (dentro de `url_publica`), e o token é a
    credencial INTEIRA da rota anônima. Por isso ele é deliberadamente estreito:

    1. SEM `?card=` a lista sai VAZIA. Antes, um GET em `/api/feedbacks/pedidos/`
       devolvia TODOS os pedidos paginados, cada um com o link pronto —
       qualquer conta com `view_content` colhia os links de todos os clientes e
       podia responder no lugar deles. Nada no contrato da fase 2 precisa disso:
       ela sempre pergunta por um card.
    2. NÃO existe rota de DETALHE (`/pedidos/<pk>/`). Ela deixava o mesmo
       inventário acessível por inteiro só iterando 1, 2, 3… Só ListModelMixin.
    3. O card perguntado tem de ser VISÍVEL para quem pergunta (`scope_cards`, a
       mesma regra de setor do resto da plataforma). Hoje é no-op, porque
       `SETOR_SCOPING_ENABLED` está desligado e o sistema inteiro é fail-open;
       no dia em que a flag ligar, o link acompanha a visibilidade do card em
       vez de ficar de fora da segmentação.
    """

    permission_classes = [IsAuthenticated, PodeVerConteudo]
    serializer_class = PedidoFeedbackInternoSerializer
    # `respostas` é FK REVERSA (várias por pedido), então `select_related` aqui é
    # `FieldError` — não degradação, erro duro em TODA chamada. O join vira
    # `prefetch_related`, e só no modo singular, que é o único que lê o texto.
    #
    # `total_respostas` é o CONTADOR do preview, e ele conta LINHAS VIVAS (não
    # uma coluna acumulada): é a solução menor — sem coluna nova, sem backfill,
    # sem F()+1 em cada POST e sem risco de divergir das linhas reais. Se um dia
    # a retenção for ligada (hoje FEEDBACK_RETENCAO_DIAS=0), o contador cai junto
    # com o texto apagado, o que é coerente com o que a tela já pratica: o
    # conteúdo some, o FATO fica na coluna "Feedback colhido" e em
    # `respondido_em`.
    queryset = (
        PedidoFeedback.objects
        .select_related('formulario')
        # `Max` junto do `Count`: a tag do card precisa da data da última
        # resposta, e uma AGREGAÇÃO é o caminho barato. Prefetch de
        # `respostas` traria o JSON de TODAS elas — megabytes de dado
        # pessoal só para desenhar uma data em cada card do quadro.
        .annotate(
            total_respostas=Count('respostas'),
            ultima_resposta=Max('respostas__enviado_em'),
        )
    )
    http_method_names = ['get', 'head', 'options']

    # Teto de ids por chamada em lote. Não é performance: é para o parâmetro não
    # virar uma forma de pedir o chaveiro inteiro numa requisição só. Acima
    # disso, o frontend fatia.
    MAX_CARDS_POR_LOTE = 100

    def get_serializer_class(self):
        # O board recebe o RESUMO (sem texto de resposta); o diálogo recebe o
        # detalhe. Ver a docstring da classe.
        if self.request.query_params.get('cards'):
            return PedidoFeedbackResumoSerializer
        return PedidoFeedbackInternoSerializer

    def get_queryset(self):
        qs = super().get_queryset()

        # Import local: mantém o app sem acoplamento no carregamento (o motor
        # referencia 'projects.Card' por string em models.py justamente para
        # não importar apps.projects), mesmo padrão que accounts/views.py:863
        # já usa para quebrar ciclo.
        from apps.projects.models import Card

        lote = self.request.query_params.get('cards')
        if lote:
            ids = []
            for pedaco in lote.split(','):
                try:
                    ids.append(int(pedaco))
                except (TypeError, ValueError):
                    # Um id podre não pode virar "lista tudo", nem derrubar os
                    # ids válidos do mesmo lote.
                    continue
            ids = ids[:self.MAX_CARDS_POR_LOTE]
            if not ids:
                return qs.none()

            # O escopo é aplicado ao CONJUNTO de uma vez (uma consulta, não N):
            # o que não é visível para quem pergunta simplesmente não entra na
            # lista, sem erro e sem dizer que existe.
            visiveis = set(
                scope_cards(Card.objects.filter(pk__in=ids), self.request.user)
                .values_list('pk', flat=True)
            )
            if not visiveis:
                return qs.none()
            return qs.filter(Q(card_id__in=visiveis) | Q(card_kanban_id__in=visiveis))

        card = self.request.query_params.get('card')
        if not card:
            # Sem card não há pergunta legítima — e "listar tudo" aqui é
            # entregar o chaveiro inteiro.
            return qs.none()
        try:
            card_id = int(card)
        except (TypeError, ValueError):
            # Parâmetro inválido não pode virar "lista tudo".
            return qs.none()

        if not scope_cards(Card.objects.filter(pk=card_id), self.request.user).exists():
            return qs.none()

        # `prefetch_related` só aqui: é o modo que serializa o texto das
        # respostas, e sem ele cada pedido custaria uma consulta.
        return (
            qs.prefetch_related('respostas')
            .filter(Q(card_id=card_id) | Q(card_kanban_id=card_id))
        )


class ExportarFeedbacksView(APIView):
    """Baixa TODOS os feedbacks em tabela: uma linha por resposta.

    `GET /api/feedbacks/exportar/?formato=xlsx|csv`

    AUTENTICADA e sob `view_metrics`, e não `view_content`: a planilha reúne o
    texto de TODAS as respostas de TODA a empresa num arquivo só, que sai do
    sistema e passa a circular por e-mail e pendrive. Isso é dado consolidado —
    a mesma régua dos relatórios, não a de "ver o card do meu setor".

    Resposta em STREAMING direto, sem passar pelo app `reports`: aquele sistema
    é de job (enfileira, grava em disco, o cliente faz polling e baixa depois) e
    aqui o volume é pequeno e o botão fica ao lado da busca — a pessoa espera o
    arquivo cair na hora, e nada fica no disco para expurgar.
    """

    permission_classes = [IsAuthenticated, HasPerm('view_metrics')]

    def get(self, request):
        from .exportacao import exportar_csv, exportar_xlsx

        formato = (request.query_params.get('formato') or 'xlsx').strip().lower()
        if formato == 'csv':
            return exportar_csv()
        if formato == 'xlsx':
            return exportar_xlsx()
        return Response(
            {'detail': "Formato inválido. Use 'xlsx' ou 'csv'."},
            status=status.HTTP_400_BAD_REQUEST,
        )


class PreviaFeedbacksView(APIView):
    """Pré-visualização da tabela de feedbacks, no formato do preview de relatórios.

    `GET /api/feedbacks/exportar/previa/?offset=0&limit=100`

    Mesma permissão da exportação (`view_metrics`): quem não pode baixar o
    arquivo também não pode lê-lo pela janela.
    """

    permission_classes = [IsAuthenticated, HasPerm('view_metrics')]

    def get(self, request):
        from .exportacao import previa

        def inteiro(nome, padrao, teto):
            try:
                return max(0, min(int(request.query_params.get(nome, padrao)), teto))
            except (TypeError, ValueError):
                return padrao

        # Teto no `limit`: o parâmetro vem do cliente, e sem limite um pedido de
        # 1.000.000 montaria a tabela inteira em memória a cada rolagem.
        return Response(previa(offset=inteiro('offset', 0, 1_000_000),
                               limit=inteiro('limit', 100, 500)))

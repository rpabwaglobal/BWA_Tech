"""
Fronteira do motor de feedback.

Este módulo é a ÚNICA porta de entrada da fase 2. Tudo aqui recebe e devolve
tipos simples (ids, `date`, `str`) e NÃO importa `apps.projects` em lugar
nenhum — a FK é declarada por string em models.py, então não existe ciclo com
`projects/apps.py:ready`, que já importa signals.
"""
from __future__ import annotations

import datetime
import logging
import secrets

from django.db import IntegrityError, transaction
from django.utils import timezone

from .models import EstadoPedido, FeedbackFormulario, PedidoFeedback

logger = logging.getLogger(__name__)

# Quantas vezes tentar de novo se o token sortear uma colisão. Com 256 bits a
# probabilidade é astronômica; a retentativa existe para que um azar não vire
# um 500 na criação do pedido.
_MAX_TENTATIVAS_TOKEN = 5


def gerar_token() -> str:
    """Gera a credencial da rota anônima.

    `secrets.token_urlsafe(32)` = 256 bits de entropia de CSPRNG, 43 caracteres
    seguros para URL. Nada de uuid, nada sequencial, NADA derivado do id: um
    token adivinhável aqui expõe o único endpoint do sistema que não pede login.
    """
    return secrets.token_urlsafe(32)


def mascara_token(token: str) -> str:
    """Prefixo curto para log.

    O token INTEIRO nunca vai para log nosso. Seis caracteres bastam para
    correlacionar duas linhas de log e não bastam para usar o link.
    """
    if not token:
        return '(vazio)'
    return f'{token[:6]}…'


def formulario_ativo(slug: str = 'padrao') -> FeedbackFormulario:
    """Devolve a versão ATIVA do formulário do slug.

    Levanta `FeedbackFormulario.DoesNotExist` se não houver — o motor não
    inventa formulário. A constraint parcial `uniq_formulario_ativo_por_slug`
    garante que este `.get()` nunca encontre duas.
    """
    return FeedbackFormulario.objects.get(slug=slug, ativo=True)


def criar_pedido_feedback(
    *,
    card_id: int,
    data_referencia: datetime.date,
    referencia_publica: str,
    card_kanban_id: int | None = None,
    formulario_slug: str = 'padrao',
) -> PedidoFeedback:
    """Cria (ou devolve) o pedido de feedback de um card. PONTO DE ENTRADA DA FASE 2.

    ENTRADA
      card_id             PK do Card MARCADO (o do checkbox
                          `gerar_formulario_feedback`), NÃO o card de
                          monitoramento do kanban.
      data_referencia     A data de entrega JÁ convertida para data LOCAL pela
                          fase 2: `timezone.localdate(project.data_entrega)`.
                          O motor nunca lê o projeto nem converte fuso — é a
                          fase 2 que decide o fallback quando `data_entrega` é
                          None (ela PODE ser None mesmo com status='entregue':
                          nada no backend preenche esse campo automaticamente).
      referencia_publica  Rótulo que a página ANÔNIMA vai exibir sob o campo
                          1.1 ("Nome do projeto:"). A fase 2 passa `card.nome`
                          — decisão explícita do usuário, e a que torna cinco
                          links do mesmo projeto distinguíveis entre si.
                          Copiado, não referenciado — congela o que o
                          respondente viu. Truncado em 200, que é o próprio
                          `max_length` de `Card.nome`, logo na prática nunca
                          corta.
                          ATENÇÃO: é a ÚNICA string do sistema que um anônimo
                          vê, e é texto livre digitado pela equipe. O motor não
                          tem como distinguir um nome legítimo de um dado
                          sensível; quem marca o checkbox é avisado disso na
                          tela.
      card_kanban_id      PK do card criado na sprint sistêmica. Opcional:
                          passe se já criou o card, ou deixe None e preencha
                          depois com
                          `PedidoFeedback.objects.filter(pk=...).update(card_kanban_id=...)`.
                          ATENÇÃO: numa SEGUNDA chamada para o mesmo card, este
                          argumento é IGNORADO — `get_or_create` só aplica os
                          `defaults` quando cria. Isso é proposital (é o que
                          impede um segundo disparo do sinal de sobrescrever o
                          pedido e rebaixar o estado), mas significa que
                          preencher o card do kanban depois exige o `.update()`
                          acima. O mesmo vale para `referencia_publica`,
                          `data_referencia` e `formulario_slug`.
      formulario_slug     Qual família de formulário usar.

    SAÍDA
      A instância de PedidoFeedback — criada OU a já existente. Use
      `pedido.token` e `pedido.url_publica`.

    EFEITOS
      Cria no máximo UMA linha em `feedbacks_pedidofeedback`, com
      `estado='aguardando_prazo'` e o LINK JÁ VÁLIDO (o link nasce com o
      pedido, não aos 30 dias: sendo envio manual não há motivo para segurá-lo,
      e dá para antecipar quando fizer sentido). NÃO envia nada. NÃO cria card.
      NÃO escreve em apps.projects.

    ERROS
      ValueError                          se `data_referencia` vier None — o
                                          motor se recusa a inventar data.
      FeedbackFormulario.DoesNotExist     se não houver versão ativa do slug.

    COMO CHAMAR
      De dentro de `transaction.on_commit(...)` no sinal de Project que a fase 2
      vai criar. `on_commit` porque um pedido criado numa transação que der
      rollback deixaria um token vivo apontando para nada.

    IDEMPOTÊNCIA
      É o índice único do OneToOne `card`, não o `get` do get_or_create. Dois
      workers concorrentes: um insere, o outro toma IntegrityError e recebe a
      linha existente. É isso que garante ao mesmo tempo "um formulário por
      card" e "cinco cards marcados no mesmo projeto = cinco pedidos".
    """
    if data_referencia is None:
        raise ValueError('data_referencia é obrigatória')

    formulario = formulario_ativo(formulario_slug)
    referencia = (referencia_publica or '').strip()[:200]

    ultima_falha: IntegrityError | None = None
    for _tentativa in range(_MAX_TENTATIVAS_TOKEN):
        try:
            with transaction.atomic():
                pedido, _criado = PedidoFeedback.objects.get_or_create(
                    card_id=card_id,
                    defaults={
                        'token': gerar_token(),
                        'card_kanban_id': card_kanban_id,
                        'formulario': formulario,
                        'data_referencia': data_referencia,
                        'referencia_publica': referencia,
                        'estado': EstadoPedido.AGUARDANDO_PRAZO,
                    },
                )
            return pedido
        except IntegrityError as exc:
            # Duas causas possíveis, e a diferença importa:
            #  - outro worker inseriu o pedido deste card entre o SELECT e o
            #    INSERT  -> a linha existe, é só devolvê-la (idempotência);
            #  - colisão de token (praticamente impossível) -> sortear outro.
            ultima_falha = exc
            existente = PedidoFeedback.objects.filter(card_id=card_id).first()
            if existente is not None:
                return existente

    # Cinco colisões seguidas de 256 bits não acontecem; se acontecer, é sinal
    # de outra coisa quebrada e o chamador precisa saber.
    raise ultima_falha  # type: ignore[misc]


def mover_pedido_do_card_kanban(card_kanban_id: int, novo_estado: str) -> bool:
    """O ARRASTE. Escreve no PEDIDO primeiro e só depois projeta na coluna.

    Devolve False (e não escreve nada) quando o card do kanban não tem pedido —
    um card órfão no board não tem fonte da verdade para mover, e inventar uma
    coluna nova para ele seria criar exatamente a dessincronia que este módulo
    existe para impedir.

    >>> A ORDEM É O PONTO INTEIRO DESTA FUNÇÃO. <<<
    `PedidoFeedback.estado` é a FONTE DA VERDADE e a coluna do card é PROJEÇÃO
    dele (ver o cabeçalho de models.py). Um arraste que escrevesse SÓ no card
    passaria no teste da tela e seria DESFEITO em silêncio pela reconciliação
    diária de `tasks._reconciliar_colunas_do_kanban`, que devolve todo card à
    coluna que o pedido manda. O usuário veria o card voltar sozinho de madrugada,
    sem nenhuma mensagem — o pior tipo de bug possível aqui.

    `select_for_update` porque este é o único caminho em que um HUMANO compete
    com a varredura do Celery pelo mesmo pedido: sem o lock, um arraste para
    "Feedback Finalizado" concorrente com a promoção dos 30 dias poderia gravar o
    estado do humano e a coluna da varredura (ou o contrário), deixando os dois
    valores em desacordo até a próxima reconciliação.

    `.update()` no Card, JAMAIS `card.save()` — mesmo motivo de
    `notificar_transicao`: `save()` acorda `card_pre_save`
    (`apply_development_time_metrics`, que mede tempo de desenvolvimento) e
    `card_created_or_updated` (CardLog + notificação + broadcast). Nada disso faz
    sentido para um card que é lembrete, e `apply_development_time_metrics`
    escreveria métricas de desenvolvimento inventadas num card que ninguém
    desenvolve.

    NÃO MEXE EM `respondido_em`: ele é o instante em que alguém DE FATO
    respondeu, e é corte de retenção. Arrastar um card para "Feedback colhido" na
    mão não cria uma resposta, então não pode carimbar uma data de resposta; e
    arrastar para fora não pode apagar a que existe.
    """
    if novo_estado not in EstadoPedido.values:
        # Estado de fora do fluxo não chega aqui pela API (a view valida antes),
        # mas um chamador novo poderia — e gravar lixo em `estado` quebraria a
        # varredura e a reconciliação de uma vez só.
        raise ValueError(f'estado fora do fluxo de feedback: {novo_estado!r}')

    from apps.projects.models import Card

    agora = timezone.now()
    with transaction.atomic():
        pedido = (
            PedidoFeedback.objects.select_for_update()
            .filter(card_kanban_id=card_kanban_id)
            .first()
        )
        if pedido is None:
            return False

        if pedido.estado != novo_estado:
            # `atualizado_em` explícito: auto_now NÃO dispara em queryset
            # `.update()` — a mesma pegadinha que os dois outros chamadores já
            # documentam.
            PedidoFeedback.objects.filter(pk=pedido.pk).update(
                estado=novo_estado, atualizado_em=agora,
            )

        # `exclude` para o UPDATE ser no-op quando a coluna já está certa (o caso
        # comum de um arraste repetido ou de um retry do cliente).
        Card.objects.filter(pk=card_kanban_id).exclude(status=novo_estado).update(
            status=novo_estado,
        )

    logger.info(
        'Feedback: pedido %s movido à mão para %s (card de kanban %s).',
        pedido.pk, novo_estado, card_kanban_id,
    )
    return True


def notificar_transicao(pedido_id: int, estado: str) -> None:
    """Hook de transição: projeta o estado do pedido na COLUNA do card do kanban.

    ASSINATURA INTOCADA (a fase 2 substituiu só o corpo). É chamada pela task de
    promoção e pela view pública, SEMPRE e SOMENTE quando o UPDATE de estado
    devolveu rowcount == 1 — assim nunca dispara duas vezes para a mesma
    transição.

    É uma linha porque os valores de `EstadoPedido` são LITERALMENTE as keys das
    3 etapas do kanban: não há tabela de-para.

    `.update()`, JAMAIS `card.save()`. `save()` acorda `card_pre_save` (um SELECT
    extra + `apply_development_time_metrics`) e `card_created_or_updated`
    (CardLog + notificações + broadcast realtime). Qualquer um deles pode
    levantar — e este hook roda com a exceção ENGOLIDA nos dois chamadores, logo
    o card ficaria na coluna errada CALADO.

    LIMITE CONHECIDO E COBERTO: se este UPDATE falhar, o pedido já foi promovido
    (o UPDATE do estado é commitado ANTES) e o card fica para trás, sem
    retentativa — a varredura seguinte não pega mais aquele pedido porque o
    estado já saiu do valor que ela procura. Quem fecha esse buraco é a
    RECONCILIAÇÃO no fim de `tasks.liberar_pedidos_no_prazo`, que uma vez por dia
    reconverge card e pedido. É o que torna "projeção" uma garantia, e não uma
    esperança.
    """
    pedido = (
        PedidoFeedback.objects.filter(pk=pedido_id)
        .values('card_kanban_id')
        .first()
    )
    if not pedido or not pedido['card_kanban_id']:
        # Pedido sem card de exibição (fase 1 pura, ou card apagado à mão — a FK
        # é SET_NULL). Nada a projetar.
        logger.info('Feedback: pedido %s -> %s (sem card de kanban)', pedido_id, estado)
        return

    # Import LOCAL: mantém o módulo sem acoplamento no carregamento — o motor
    # referencia 'projects.Card' por string em models.py exatamente para não
    # importar `apps.projects`.
    from apps.projects.models import Card

    Card.objects.filter(pk=pedido['card_kanban_id']).update(status=estado)
    logger.info('Feedback: pedido %s -> %s', pedido_id, estado)

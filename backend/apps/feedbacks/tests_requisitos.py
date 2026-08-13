"""
Testes dos 10 requisitos de cobertura da FASE 1 do motor de feedback.

Este arquivo é irmão de `tests.py` e existe separado de propósito: cada classe
aqui responde a UM item da lista de cobertura pedida, na ordem, para que a
leitura do resultado do runner seja a própria conferência do checklist.

Duas escolhas de método valem ser ditas, porque mudam o que os testes provam:

1. NADA AQUI É TESTADO CONTRA O RELÓGIO REAL onde a data importa. A conta dos 30
   dias é feita com `timezone.now` CONGELADO num instante que cai dentro da
   janela em que a data LOCAL e a data UTC divergem (21h à meia-noite em
   America/Sao_Paulo). Um teste que rodasse às 14h passaria mesmo com o bug de
   fuso — que este projeto já teve — porque às 14h as duas datas coincidem.

2. As asserções da rota anônima são sobre o CORPO INTEIRO, campo a campo, e não
   sobre "contém". `assertIn` não pega vazamento: um campo interno acrescentado
   por engano num refactor futuro continuaria passando. Comparar o dicionário
   completo quebra na hora em que o vazamento aparecer, que é o ponto.
"""
from __future__ import annotations

import datetime as dt
import io
import string
from unittest import mock

from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Permission
from django.core.cache import cache
from django.core.management import call_command
from django.db import connection
from django.db.models import Max
from django.test import Client, TestCase
from django.test.utils import CaptureQueriesContext
from django.utils import timezone

from apps.accounts.models import SetorCatalogo
from apps.projects.models import Card, Project, Sprint

from ._apoio_testes import chave_de_texto, resposta_valida
from .models import (
    MAX_RESPOSTAS_POR_PEDIDO,
    EstadoPedido,
    FeedbackFormulario,
    PedidoFeedback,
    RespostaFeedback,
)
from .services import criar_pedido_feedback
from .tasks import liberar_pedidos_no_prazo, limpar_respostas_expiradas
from .views import MSG_INDISPONIVEL

User = get_user_model()

# 2026-08-12 01:30 UTC == 2026-08-11 22:30 em America/Sao_Paulo (UTC-3, sem
# horário de verão desde 2019). É o instante que separa quem usa
# `timezone.localdate()` de quem usa `timezone.now().date()`: nesta hora as duas
# apontam para DIAS DIFERENTES. Todo teste de prazo roda aqui dentro.
INSTANTE_NA_JANELA_DE_DIVERGENCIA = dt.datetime(2026, 8, 12, 1, 30, tzinfo=dt.timezone.utc)
DATA_LOCAL_ESPERADA = dt.date(2026, 8, 11)
DATA_UTC_ESPERADA = dt.date(2026, 8, 12)


class BaseFeedback(TestCase):
    """Cadeia mínima Sprint -> Project -> Card (setor da sprint é NOT NULL).

    Os nomes internos são propositalmente ESQUISITOS e únicos ('SEGREDO-...'):
    servem de marcador para os testes de vazamento poderem procurar por eles no
    corpo cru da resposta pública. Um nome genérico como "Projeto teste" daria
    falso negativo se aparecesse por acaso.
    """

    def setUp(self):
        # O throttle da rota anônima conta em cache. Sem limpar, o resíduo de um
        # teste faz o seguinte receber 429 e a falha aponta para o lugar errado.
        cache.clear()
        self.user = User.objects.create_user(
            username='SEGREDO-USUARIO', password='x' * 12,
        )
        self.setor = SetorCatalogo.objects.create(
            codename='seg', nome='SEGREDO-SETOR',
        )
        agora = timezone.now()
        self.sprint = Sprint.objects.create(
            nome='SEGREDO-SPRINT', data_inicio=agora,
            fechamento_em=agora + dt.timedelta(days=7), duracao_dias=7,
            supervisor=self.user, setor=self.setor,
        )
        self.projeto = Project.objects.create(nome='SEGREDO-PROJETO', sprint=self.sprint)
        self.card = Card.objects.create(nome='Site institucional', projeto=self.projeto)

    # --- utilidades --------------------------------------------------------

    def novo_card(self, nome: str) -> Card:
        return Card.objects.create(nome=nome, projeto=self.projeto)

    def novo_pedido(self, **kwargs) -> PedidoFeedback:
        defaults = {
            'card_id': self.card.id,
            'data_referencia': timezone.localdate(),
            'referencia_publica': self.card.nome,
        }
        defaults.update(kwargs)
        return criar_pedido_feedback(**defaults)

    def url(self, token: str) -> str:
        return f'/api/feedback/{token}/'

    def responder(self, token: str, texto: str = 'muito bom', client=None, **sobrescreve):
        """Responde com um payload VÁLIDO para a definição daquele pedido.

        O payload é DERIVADO da definição (ver `_apoio_testes`), não escrito à
        mão: estes testes são sobre prazo, oráculo, estado e retenção, e nenhum
        deles é sobre quais são as perguntas. Os testes que SÃO sobre o conteúdo
        montam o payload à mão, que é onde isso é o ponto.

        TOKEN SEM PEDIDO cai na definição ATIVA em vez de estourar. É o caso
        que os testes de ORÁCULO usam DE PROPÓSITO (token inexistente bem
        formado, token de card apagado, token não-ASCII): buscar o pedido para
        montar o payload levantava `DoesNotExist` no próprio helper e o teste
        morria antes de chegar à view — justamente o teste que prova que a view
        responde igual nos dois casos. Derivar da ativa também é o que o cliente
        real faria: ele monta o POST com o formulário que viu, e o servidor tem
        de 404 do mesmo jeito.
        """
        cliente = client or self.client
        pedido = (
            PedidoFeedback.objects.select_related('formulario')
            .filter(token=token).first()
        )
        definicao = (
            pedido.formulario.campos if pedido is not None
            else self.formulario_ativo().campos
        )
        valores = resposta_valida(definicao, texto, **sobrescreve)
        return cliente.post(
            self.url(token), {'valores': valores},
            content_type='application/json',
        )

    def chave_livre(self, pedido) -> str:
        """A key do primeiro campo de texto - onde `responder()` poe o texto."""
        return chave_de_texto(pedido.formulario.campos)

    def formulario_ativo(self) -> FeedbackFormulario:
        return FeedbackFormulario.objects.get(slug='padrao', ativo=True)

    def _publicar_versao(
        self, *, campos: list, titulo: str = 'Formulário novo',
        subtitulo: str = '', slug: str = 'padrao',
    ) -> FeedbackFormulario:
        """Publica a PRÓXIMA versão do slug pelo PROCEDIMENTO DE 2 PASSOS.

        1. desativar a atual (UPDATE, statement SEPARADO e ANTERIOR);
        2. criar a linha nova, mesmo slug, versao+1, ativo=True.

        A linha antiga NUNCA é editada — só perde o flag. Inverter a ordem
        levanta IntegrityError, porque `uniq_formulario_ativo_por_slug` é
        PARCIAL e não é DEFERRABLE.

        A versão é DERIVADA do maior número já existente, nunca cravada: a
        migration 0005 já ocupou a versão 2 de 'padrao', e um `versao=2`
        escrito à mão colidiria em (slug, versao). Derivar mantém estes testes
        válidos quando existir uma versão 3 semeada amanhã.
        """
        proxima = 1 + (
            FeedbackFormulario.objects.filter(slug=slug)
            .order_by('-versao').values_list('versao', flat=True).first() or 0
        )
        FeedbackFormulario.objects.filter(slug=slug, ativo=True).update(ativo=False)
        return FeedbackFormulario.objects.create(
            slug=slug, versao=proxima, titulo=titulo, subtitulo=subtitulo,
            campos=campos, ativo=True,
        )


# =========================================================================== #
# 1. A BORDA DOS 30 DIAS, EM FUSO LOCAL
# =========================================================================== #
class Req01BordaDosTrintaDiasTests(BaseFeedback):
    """29 dias não promove; 30 promove; 31 promove. E a conta é em data LOCAL."""

    def _tres_pedidos(self, hoje: dt.date):
        """Cria três pedidos na MESMA fila, com 29, 30 e 31 dias de idade.

        Os três de uma vez, numa varredura só, de propósito: assim o teste também
        prova que a tarefa separa a fila corretamente, e não só que ela sabe
        responder sim ou não para um item isolado.
        """
        pedidos = {}
        for dias in (29, 30, 31):
            card = self.novo_card(f'Card de {dias} dias')
            pedidos[dias] = criar_pedido_feedback(
                card_id=card.id,
                data_referencia=hoje - dt.timedelta(days=dias),
                referencia_publica=card.nome,
            )
        return pedidos

    def test_29_nao_promove_30_e_31_promovem_com_relogio_congelado(self):
        """O teste principal da borda, com o relógio parado às 22h30 locais.

        Nessa hora `timezone.localdate()` é dia 11 e `timezone.now().date()` é
        dia 12. O pedido de 29 dias é EXATAMENTE o caso que separa os dois: pela
        data local ele ainda não venceu; pela data UTC ele já teria vencido. Se
        alguém trocar `localdate()` por `now().date()` na tarefa, este teste é o
        que quebra.
        """
        with mock.patch('django.utils.timezone.now',
                        return_value=INSTANTE_NA_JANELA_DE_DIVERGENCIA):
            # Pré-condição do teste: sem a divergência, ele não prova nada.
            self.assertEqual(timezone.localdate(), DATA_LOCAL_ESPERADA)
            self.assertEqual(timezone.now().date(), DATA_UTC_ESPERADA)
            self.assertNotEqual(timezone.localdate(), timezone.now().date())

            pedidos = self._tres_pedidos(DATA_LOCAL_ESPERADA)
            with self.settings(FEEDBACK_ESPERA_DIAS=30):
                resultado = liberar_pedidos_no_prazo()

        # `reconciliados` entrou no retorno na FASE 2: a varredura passou a
        # terminar reconvergendo a coluna do kanban com o estado do pedido (ver
        # `_reconciliar_colunas_do_kanban`). Zero aqui porque, no caminho feliz,
        # o hook já deixou tudo sincronizado. Estas asserções comparam o dict
        # INTEIRO de propósito — é o que fez a mudança de contrato aparecer.
        self.assertEqual(resultado, {'promovidos': 2, 'falhas': 0, 'reconciliados': 0})

        pedidos[29].refresh_from_db()
        pedidos[30].refresh_from_db()
        pedidos[31].refresh_from_db()
        self.assertEqual(pedidos[29].estado, EstadoPedido.AGUARDANDO_PRAZO)
        self.assertEqual(pedidos[30].estado, EstadoPedido.AGUARDANDO_RESPOSTA)
        self.assertEqual(pedidos[31].estado, EstadoPedido.AGUARDANDO_RESPOSTA)

    def test_a_mesma_borda_vale_com_o_relogio_real(self):
        """Sem mock nenhum, para o resultado não depender do congelamento."""
        pedidos = self._tres_pedidos(timezone.localdate())
        with self.settings(FEEDBACK_ESPERA_DIAS=30):
            resultado = liberar_pedidos_no_prazo()

        self.assertEqual(resultado['promovidos'], 2)
        self.assertEqual(
            PedidoFeedback.objects.get(pk=pedidos[29].pk).estado,
            EstadoPedido.AGUARDANDO_PRAZO,
        )
        for dias in (30, 31):
            self.assertEqual(
                PedidoFeedback.objects.get(pk=pedidos[dias].pk).estado,
                EstadoPedido.AGUARDANDO_RESPOSTA,
            )

    def test_o_prazo_configurado_no_deploy_e_de_fato_30_dias(self):
        """Os testes acima fixam o prazo; este confere o valor que vai para produção."""
        self.assertEqual(settings.FEEDBACK_ESPERA_DIAS, 30)

    def test_pedido_com_data_no_futuro_nunca_promove(self):
        """Guarda contra um `abs()`/sinal trocado na subtração do corte."""
        card = self.novo_card('Entrega futura')
        pedido = criar_pedido_feedback(
            card_id=card.id,
            data_referencia=timezone.localdate() + dt.timedelta(days=10),
            referencia_publica=card.nome,
        )
        self.assertEqual(liberar_pedidos_no_prazo()['promovidos'], 0)
        pedido.refresh_from_db()
        self.assertEqual(pedido.estado, EstadoPedido.AGUARDANDO_PRAZO)


# =========================================================================== #
# 2. IDEMPOTÊNCIA
# =========================================================================== #
class Req02IdempotenciaTests(BaseFeedback):
    """Rodar de novo não promove de novo, e não duplica pedido."""

    def test_duas_varreduras_seguidas_promovem_uma_vez_so(self):
        pedido = self.novo_pedido(
            data_referencia=timezone.localdate() - dt.timedelta(days=30),
        )
        # O hook é o que a fase 2 vai usar para mexer no kanban: dispará-lo duas
        # vezes moveria o card duas vezes. Contar as chamadas é a parte que
        # `estado == 'aguardando_resposta'` sozinho não provaria.
        with mock.patch('apps.feedbacks.tasks.notificar_transicao') as hook:
            primeira = liberar_pedidos_no_prazo()
            segunda = liberar_pedidos_no_prazo()
            terceira = liberar_pedidos_no_prazo()

        self.assertEqual(primeira, {'promovidos': 1, 'falhas': 0, 'reconciliados': 0})
        self.assertEqual(segunda, {'promovidos': 0, 'falhas': 0, 'reconciliados': 0})
        self.assertEqual(terceira, {'promovidos': 0, 'falhas': 0, 'reconciliados': 0})
        self.assertEqual(hook.call_count, 1)
        hook.assert_called_once_with(pedido.pk, EstadoPedido.AGUARDANDO_RESPOSTA)

        pedido.refresh_from_db()
        self.assertEqual(pedido.estado, EstadoPedido.AGUARDANDO_RESPOSTA)
        self.assertEqual(PedidoFeedback.objects.count(), 1)

    def test_varredura_repetida_nao_reescreve_a_linha(self):
        """Prova mais forte que o contador: a 2ª passada não faz UPDATE nenhum.

        Se o estado saísse do WHERE, a linha seria reescrita e `atualizado_em`
        andaria — mesmo com o estado final parecendo correto.
        """
        pedido = self.novo_pedido(
            data_referencia=timezone.localdate() - dt.timedelta(days=45),
        )
        liberar_pedidos_no_prazo()
        pedido.refresh_from_db()
        carimbo_apos_a_primeira = pedido.atualizado_em

        liberar_pedidos_no_prazo()
        pedido.refresh_from_db()
        self.assertEqual(pedido.atualizado_em, carimbo_apos_a_primeira)

    def test_criar_o_pedido_duas_vezes_devolve_a_mesma_linha_e_o_mesmo_token(self):
        """O link precisa ser ESTÁVEL: um segundo disparo do sinal da fase 2 não
        pode gerar um token novo, porque o antigo já pode ter sido enviado."""
        primeiro = self.novo_pedido()
        segundo = self.novo_pedido(referencia_publica='outro rótulo qualquer')

        self.assertEqual(primeiro.pk, segundo.pk)
        self.assertEqual(primeiro.token, segundo.token)
        self.assertEqual(PedidoFeedback.objects.count(), 1)
        # E o rótulo do primeiro é preservado: get_or_create não sobrescreve.
        self.assertEqual(segundo.referencia_publica, self.card.nome)

    def test_recriar_o_pedido_depois_de_promovido_nao_volta_o_estado(self):
        """Regressão: se a criação usasse update_or_create, o pedido voltaria
        para 'aguardando_prazo' e o card desceria de coluna sozinho."""
        pedido = self.novo_pedido(
            data_referencia=timezone.localdate() - dt.timedelta(days=30),
        )
        liberar_pedidos_no_prazo()

        de_novo = self.novo_pedido()
        self.assertEqual(de_novo.pk, pedido.pk)
        self.assertEqual(de_novo.estado, EstadoPedido.AGUARDANDO_RESPOSTA)
        self.assertEqual(PedidoFeedback.objects.count(), 1)

    def test_cinco_cards_marcados_geram_cinco_pedidos_e_cinco_links(self):
        """A dedup é por CARD. Por projeto, seria um pedido só — e o requisito
        do usuário é o oposto: cinco marcados, cinco formulários."""
        cards = [self.card] + [self.novo_card(f'Card {i}') for i in range(1, 5)]
        pedidos = [
            criar_pedido_feedback(
                card_id=c.id,
                data_referencia=timezone.localdate(),
                referencia_publica=c.nome,
            )
            for c in cards
        ]
        self.assertEqual(PedidoFeedback.objects.count(), 5)
        self.assertEqual(len({p.token for p in pedidos}), 5)
        # Todos no MESMO projeto — é exatamente o cenário que não pode deduplicar.
        self.assertEqual({c.projeto_id for c in cards}, {self.projeto.id})
        # E `card_kanban` nulo em todos: o OneToOne não pode implicar em
        # "só um pedido sem card de kanban" (a fase 2 cria os cards depois).
        self.assertEqual(
            PedidoFeedback.objects.filter(card_kanban__isnull=True).count(), 5,
        )


# =========================================================================== #
# 3. O LINK NASCE COM O PEDIDO
# =========================================================================== #
class Req03LinkDesdeACriacaoTests(BaseFeedback):

    def test_link_valido_no_dia_zero_e_ja_abre_o_formulario(self):
        pedido = self.novo_pedido(data_referencia=timezone.localdate())

        # Ainda faltam 30 dias...
        self.assertEqual(pedido.estado, EstadoPedido.AGUARDANDO_PRAZO)
        self.assertEqual(liberar_pedidos_no_prazo()['promovidos'], 0)

        # ...e o link já existe, já é forte e já abre.
        self.assertEqual(len(pedido.token), 43)  # secrets.token_urlsafe(32)
        self.assertTrue(pedido.url_publica.endswith(f'/feedback/{pedido.token}'))
        resposta = self.client.get(self.url(pedido.token))
        self.assertEqual(resposta.status_code, 200)
        self.assertTrue(resposta.json()['campos'])

    def test_da_para_responder_antes_dos_30_dias(self):
        """O link nasce cedo justamente para poder ser antecipado."""
        pedido = self.novo_pedido(
            data_referencia=timezone.localdate() - dt.timedelta(days=3),
        )
        self.assertEqual(self.responder(pedido.token).status_code, 201)

        pedido.refresh_from_db()
        self.assertEqual(pedido.estado, EstadoPedido.RESPONDIDO)
        # E a varredura dos 30 dias não desfaz o atalho quando o prazo chegar.
        PedidoFeedback.objects.filter(pk=pedido.pk).update(
            data_referencia=timezone.localdate() - dt.timedelta(days=60),
        )
        self.assertEqual(liberar_pedidos_no_prazo()['promovidos'], 0)
        pedido.refresh_from_db()
        self.assertEqual(pedido.estado, EstadoPedido.RESPONDIDO)

    def test_o_token_nao_e_derivado_do_id(self):
        """Token sequencial ou derivado do id torna a única rota anônima
        enumerável — é o risco central deste desenho."""
        tokens = []
        for i in range(5):
            card = self.novo_card(f'Card token {i}')
            tokens.append(criar_pedido_feedback(
                card_id=card.id,
                data_referencia=timezone.localdate(),
                referencia_publica=card.nome,
            ))
        # NÃO se testa "o token não CONTÉM o pk": um token aleatório contém
        # qualquer dígito dado em ~6% de uma janela de 4 chars, então a
        # asserção falhava sozinha em ~27% das execuções sem que nada
        # estivesse errado — e um teste que falha à toa acaba sendo ignorado
        # justamente quando pega o defeito de verdade. O que se afirma abaixo
        # é determinístico e é o que de fato impede enumeração.
        alfabeto = set(string.ascii_letters + string.digits + '-_')
        for pedido in tokens:
            # 43 chars = os 256 bits de secrets.token_urlsafe(32): é o TAMANHO
            # do espaço que torna a varredura inviável, não a aparência.
            self.assertGreaterEqual(len(pedido.token), 43)
            self.assertTrue(set(pedido.token) <= alfabeto)
            # Derivado do id seria previsível a partir do id: não é.
            self.assertNotEqual(pedido.token, str(pedido.pk))
        # Sorteado, não sequencial: 5 pedidos criados em sequência geram 5
        # tokens distintos e sem prefixo comum.
        self.assertEqual(len({p.token for p in tokens}), 5)
        prefixos = {p.token[:8] for p in tokens}
        self.assertEqual(len(prefixos), 5)


# =========================================================================== #
# 4. REABRÍVEL ENQUANTO NÃO RESPONDIDO
# =========================================================================== #
class Req04ReabrivelTests(BaseFeedback):

    def test_get_repetido_devolve_o_mesmo_formulario(self):
        """"caso feche sem querer ou preencha e esqueça de enviar" — literal."""
        pedido = self.novo_pedido()

        corpos = []
        for _ in range(5):
            resposta = self.client.get(self.url(pedido.token))
            self.assertEqual(resposta.status_code, 200)
            corpos.append(resposta.json())

        # Idênticos, não apenas "todos 200": um GET que consumisse o pedido
        # devolveria 200 na primeira e outra coisa na segunda.
        for corpo in corpos[1:]:
            self.assertEqual(corpo, corpos[0])
        self.assertTrue(corpos[0]['campos'])

    def test_reabre_nos_dois_estados_abertos(self):
        """Antes E depois da promoção dos 30 dias o link continua abrindo."""
        pedido = self.novo_pedido(
            data_referencia=timezone.localdate() - dt.timedelta(days=30),
        )
        antes = self.client.get(self.url(pedido.token))

        self.assertEqual(liberar_pedidos_no_prazo()['promovidos'], 1)
        pedido.refresh_from_db()
        self.assertEqual(pedido.estado, EstadoPedido.AGUARDANDO_RESPOSTA)

        depois = self.client.get(self.url(pedido.token))
        self.assertEqual(antes.status_code, 200)
        self.assertEqual(depois.status_code, 200)
        self.assertEqual(antes.json(), depois.json())

    def test_reabrir_nao_grava_nada(self):
        """Abrir o link não pode criar resposta nem mexer no pedido."""
        pedido = self.novo_pedido()
        carimbo = pedido.atualizado_em

        for _ in range(4):
            self.client.get(self.url(pedido.token))

        pedido.refresh_from_db()
        self.assertEqual(pedido.atualizado_em, carimbo)
        self.assertIsNone(pedido.respondido_em)
        self.assertFalse(RespostaFeedback.objects.exists())


# =========================================================================== #
# 5. DEPOIS DE RESPONDIDO
# =========================================================================== #
class Req05DepoisDeRespondidoTests(BaseFeedback):
    """A classe inteira mudou de sinal, e é uma decisão de produto, não um ajuste.

    Ela afirmava "depois de respondido o link acabou". O pedido do usuário é o
    oposto: "mais de um usuário deve poder responder o feedback, o link do
    formulário não deve expirar". Cada teste abaixo é o irmão INVERTIDO do que
    existia, com a mesma força — mesmo número de asserções, mesma exatidão.
    """

    def test_segundo_post_e_aceito_e_a_primeira_resposta_e_preservada(self):
        pedido = self.novo_pedido()
        self.assertEqual(self.responder(pedido.token, 'a primeira').status_code, 201)

        pedido.refresh_from_db()
        respondido_em_original = pedido.respondido_em

        segunda = self.responder(pedido.token, 'a segunda')
        self.assertEqual(segunda.status_code, 201)

        # DUAS linhas, e nenhuma sobrescreveu a outra: o valor da feature é ter
        # várias opiniões sobre a mesma entrega.
        self.assertEqual(RespostaFeedback.objects.count(), 2)
        self.assertEqual(
            {r.valores[self.chave_livre(pedido)] for r in RespostaFeedback.objects.all()},
            {'a primeira', 'a segunda'},
        )
        pedido.refresh_from_db()
        # O carimbo da resposta é o CORTE DA RETENÇÃO: se a segunda resposta o
        # movesse, o prazo de descarte do dado pessoal seria reiniciável de fora,
        # indefinidamente, por qualquer anônimo com o link.
        self.assertEqual(pedido.respondido_em, respondido_em_original)
        self.assertEqual(pedido.estado, EstadoPedido.RESPONDIDO)

    def test_get_depois_de_respondido_devolve_o_formulario_de_novo(self):
        """Reabrir traz o formulário EM BRANCO, para a próxima pessoa."""
        pedido = self.novo_pedido()
        self.responder(pedido.token)

        resposta = self.client.get(self.url(pedido.token))
        self.assertEqual(resposta.status_code, 200)
        # O contrato público inteiro, e nada do que já foi respondido.
        self.assertEqual(
            set(resposta.json()),
            {'titulo', 'subtitulo', 'referencia', 'data_entrega', 'campos'},
        )
        self.assertTrue(resposta.json()['campos'])

    def test_post_num_link_ja_respondido_valida_os_campos_normalmente(self):
        """O 2º POST passa pela validação de sempre — não morre antes dela.

        Antes os dois caminhos morriam em `_pedido_utilizavel` com 404, para que
        um 400 de campo não denunciasse que o token existe. Agora o link é
        utilizável, então a distinção 201/400 é o comportamento normal de um
        formulário aberto — e não diz nada que o próprio 200 do GET já não diga.
        """
        pedido = self.novo_pedido()
        self.responder(pedido.token)

        valido = self.responder(pedido.token, 'texto ok')
        invalido = self.client.post(
            self.url(pedido.token), {'valores': {'chave_inventada': 'x'}},
            content_type='application/json',
        )
        self.assertEqual(valido.status_code, 201)
        self.assertEqual(invalido.status_code, 400)
        # E o payload inválido não gravou nada: são 2 linhas, não 3.
        self.assertEqual(RespostaFeedback.objects.count(), 2)

    def test_o_teto_por_pedido_recusa_com_o_404_de_sempre(self):
        """O teto substitui o índice único que a feature removeu.

        Sem ele, um link público, perene e sem login aceita gravação ILIMITADA
        dentro da taxa — e o balde do rate limit zera a cada restart do Redis.
        A recusa é o MESMO corpo de token inexistente: um status ou uma mensagem
        própria transformariam a rota num oráculo ("este token existe e encheu").
        """
        pedido = self.novo_pedido()
        RespostaFeedback.objects.bulk_create([
            RespostaFeedback(pedido=pedido, valores={})
            for _ in range(MAX_RESPOSTAS_POR_PEDIDO)
        ])

        recusada = self.responder(pedido.token, 'a que passa do teto')

        self.assertEqual(recusada.status_code, 404)
        self.assertEqual(recusada.json(), {'detail': MSG_INDISPONIVEL})
        self.assertEqual(
            RespostaFeedback.objects.filter(pedido=pedido).count(),
            MAX_RESPOSTAS_POR_PEDIDO,
        )


# =========================================================================== #
# 6. NÃO VIRA ORÁCULO DE ENUMERAÇÃO
# =========================================================================== #
class Req06NaoEhOraculoTests(BaseFeedback):
    """Todos os estados NÃO-UTILIZÁVEIS respondem exatamente igual.

    LIMITE DECLARADO: um token válido e utilizável é distinguível por definição
    (ele funciona). O que não pode ser distinguível é o resto — senão dá para
    varrer o espaço de tokens perguntando "este existe?".
    """

    def _tokens_inutilizaveis(self) -> dict[str, str]:
        """Os QUATRO casos que continuam indistinguíveis entre si.

        'ja_respondido' SAIU desta lista — o link não expira mais, então um
        pedido respondido é utilizável e devolve 200. Os quatro que ficaram são a
        garantia anti-enumeração e não podem ser afrouxados junto: token
        inexistente, card apagado por CASCADE, não-ASCII e grande demais.
        """
        card_apagado = self.novo_card('Card que será apagado')
        pedido_orfao = criar_pedido_feedback(
            card_id=card_apagado.id,
            data_referencia=timezone.localdate(),
            referencia_publica=card_apagado.nome,
        )
        token_orfao = pedido_orfao.token
        card_apagado.delete()  # CASCADE leva o pedido junto
        self.assertFalse(PedidoFeedback.objects.filter(token=token_orfao).exists())

        return {
            'inexistente_bem_formado': 'z' * 43,
            'card_apagado': token_orfao,
            'nao_ascii': 'çãõ-token-inválido',
            'grande_demais': 'x' * 200,
        }

    def test_get_responde_identico_em_todos_os_casos_inutilizaveis(self):
        casos = self._tokens_inutilizaveis()
        respostas = {
            nome: self.client.get(self.url(token)) for nome, token in casos.items()
        }
        referencia = respostas['inexistente_bem_formado']

        for nome, resposta in respostas.items():
            with self.subTest(caso=nome):
                self.assertEqual(resposta.status_code, 404)
                self.assertEqual(resposta.json(), referencia.json())
                self.assertEqual(resposta.json(), {'detail': MSG_INDISPONIVEL})
                self.assertEqual(
                    resposta.headers.get('Content-Type'),
                    referencia.headers.get('Content-Type'),
                )
                # Nada de cabeçalho denunciando o caso (Allow, Location, etc.).
                self.assertEqual(
                    sorted(resposta.headers.keys()),
                    sorted(referencia.headers.keys()),
                )

    def test_post_responde_identico_em_todos_os_casos_inutilizaveis(self):
        casos = self._tokens_inutilizaveis()
        respostas = {
            nome: self.responder(token) for nome, token in casos.items()
        }
        referencia = respostas['inexistente_bem_formado']

        for nome, resposta in respostas.items():
            with self.subTest(caso=nome):
                self.assertEqual(resposta.status_code, 404)
                self.assertEqual(resposta.json(), referencia.json())
        # E nenhum deles gravou coisa alguma.
        self.assertEqual(RespostaFeedback.objects.count(), 0)

    def test_card_apagado_e_inexistente_custam_o_mesmo_numero_de_consultas(self):
        """Diferença de custo é oráculo por latência, mesmo com corpo igual.

        O par mudou porque 'já respondido' saiu da lista, mas a PROPRIEDADE é a
        mesma e continua travada: os casos inutilizáveis percorrem a MESMA query
        única, sem nenhum `if` em Python separando um do outro.
        """
        card_apagado = self.novo_card('Card que será apagado')
        pedido_orfao = criar_pedido_feedback(
            card_id=card_apagado.id,
            data_referencia=timezone.localdate(),
            referencia_publica=card_apagado.nome,
        )
        token_orfao = pedido_orfao.token
        card_apagado.delete()  # CASCADE leva o pedido junto

        with CaptureQueriesContext(connection) as orfao:
            self.client.get(self.url(token_orfao))
        with CaptureQueriesContext(connection) as inexistente:
            self.client.get(self.url('z' * 43))

        self.assertEqual(len(orfao), len(inexistente))
        self.assertEqual(len(inexistente), 1)

    def test_o_link_respondido_continua_abrindo_e_numa_consulta_so(self):
        """O caso que SAIU da lista, afirmado explicitamente.

        Sem este teste, remover 'ja_respondido' dos indistinguíveis pareceria
        perda de cobertura. Ele prova o oposto: o link responde 200 com o
        contrato público inteiro, e continua custando UMA consulta — a mesma que
        um token inexistente, então não há oráculo por latência tampouco.
        """
        pedido = self.novo_pedido()
        self.responder(pedido.token)

        with CaptureQueriesContext(connection) as respondido:
            resposta = self.client.get(self.url(pedido.token))

        self.assertEqual(resposta.status_code, 200)
        self.assertEqual(
            set(resposta.json()),
            {'titulo', 'subtitulo', 'referencia', 'data_entrega', 'campos'},
        )
        self.assertEqual(len(respondido), 1)

    def test_o_404_publico_nao_carrega_nenhum_dado(self):
        """Nem o token de volta, nem contagem, nem 'tente novamente em X'."""
        resposta = self.client.get(self.url('z' * 43))
        self.assertEqual(set(resposta.json().keys()), {'detail'})
        self.assertNotIn('z' * 43, resposta.content.decode())


# =========================================================================== #
# 7. SEM AUTENTICAÇÃO E FORA DO GATE view_content
# =========================================================================== #
class Req07SemAutenticacaoTests(BaseFeedback):

    def test_anonimo_abre_e_responde(self):
        pedido = self.novo_pedido()
        self.assertEqual(self.client.get(self.url(pedido.token)).status_code, 200)
        self.assertEqual(self.responder(pedido.token).status_code, 201)

    def test_post_anonimo_passa_pela_protecao_de_csrf(self):
        """O respondente é um navegador SEM cookie de sessão e SEM token CSRF.

        O cliente de teste desliga a checagem por padrão; `enforce_csrf_checks=True`
        reproduz o navegador de verdade. Se este POST desse 403, TODO respondente
        seria barrado em produção e o motor inteiro seria inútil.

        MEDIDO, e o resultado contraria o que o código sugere: quem garante isso
        NÃO é o `@method_decorator(csrf_exempt)` desta view. `APIView.as_view()`
        do DRF já embrulha toda view em `csrf_exempt`
        (rest_framework/views.py:150) — em DRF a checagem de CSRF vive dentro da
        `SessionAuthentication`, e aqui `authentication_classes = []` também a
        remove. Removi o decorador e este teste continuou passando. Ele fica
        como decoração redundante e declaração de intenção; o teste vale pela
        propriedade de produção, não por aquela linha.
        """
        pedido = self.novo_pedido()
        navegador = Client(enforce_csrf_checks=True)
        self.assertEqual(navegador.get(self.url(pedido.token)).status_code, 200)
        self.assertEqual(
            self.responder(pedido.token, client=navegador).status_code, 201,
        )

    def test_usuario_sem_view_content_abre_o_link_normalmente(self):
        """O gate `view_content` é aplicado view a view; esta rota nasce fora.

        O contraste com o endpoint interno é o que dá sentido à asserção: o
        MESMO usuário que leva 403 lá recebe 200 aqui.
        """
        pedido = self.novo_pedido()
        self.assertFalse(self.user.has_perm('accounts.view_content'))
        self.client.force_login(self.user)

        interno = self.client.get('/api/feedbacks/pedidos/')
        publico = self.client.get(self.url(pedido.token))

        self.assertEqual(interno.status_code, 403)
        self.assertEqual(publico.status_code, 200)

    def test_endpoint_interno_libera_com_view_content(self):
        """Fecha o contraste acima: o 403 era mesmo do gate, não de outra coisa."""
        self.user.user_permissions.add(
            Permission.objects.get(codename='view_content'),
        )
        self.client.force_login(User.objects.get(pk=self.user.pk))
        self.assertEqual(self.client.get('/api/feedbacks/pedidos/').status_code, 200)

    def test_authorization_invalido_nao_derruba_a_rota_publica(self):
        """`authentication_classes = []` significa que o header nem é olhado.

        Sem isso, um Authorization podre (ou o de um token expirado guardado no
        navegador de quem já foi funcionário) transformaria a resposta em 401 e
        a pessoa não conseguiria responder.
        """
        pedido = self.novo_pedido()
        resposta = self.client.get(
            self.url(pedido.token), HTTP_AUTHORIZATION='Token lixo-invalido-qualquer',
        )
        self.assertEqual(resposta.status_code, 200)

    def test_sessao_de_funcionario_logado_nao_contamina_a_rota(self):
        pedido = self.novo_pedido()
        self.client.force_login(self.user)
        resposta = self.client.get(self.url(pedido.token))
        self.assertEqual(resposta.status_code, 200)
        self.assertEqual(set(resposta.json().keys()),
                         {'titulo', 'subtitulo', 'referencia', 'data_entrega', 'campos'})


# =========================================================================== #
# 8. A ROTA PÚBLICA NÃO VAZA DADO INTERNO
# =========================================================================== #
class Req08NaoVazaDadoInternoTests(BaseFeedback):

    def test_corpo_do_get_e_exatamente_o_contrato_campo_a_campo(self):
        """O dicionário INTEIRO, não `assertIn`: um campo novo quebra aqui.

        A definição é publicada AQUI, com um único campo de texto, e não é a
        ativa de produção de propósito: este teste é sobre a FORMA do payload
        (quais chaves saem), e travá-lo na definição semeada faria dele um
        segundo lugar para manter as onze perguntas em dia. O conteúdo real da
        versão ativa está travado palavra por palavra em `tests_formulario_v2`.

        MUDOU DUAS VEZES, de propósito: `subtitulo` entrou como chave de
        TOPO (a intro da página, versionada junto com as perguntas), `referencia`
        é o nome do CARD, e `data_entrega` entrou depois para a tela dizer
        "entregue em X". São CINCO chaves de topo, e continuam sendo cinco: o
        contador de respostas é dado INTERNO e não pode aparecer aqui. As chaves
        de CAMPO continuam sendo as cinco de sempre nos tipos de texto — as
        condicionais por tipo estão em `tests_formulario_v2`.
        """
        formulario = self._publicar_versao(
            titulo='Contrato do GET',
            subtitulo='Intro do contrato.',
            campos=[{
                'key': 'comentario',
                'label': 'Como foi?',
                'tipo': 'texto_longo',
                'obrigatorio': True,
                'max_length': 2000,
            }],
        )
        # DEPOIS de publicar: a FK do formulário é congelada na criação do
        # pedido, então um pedido criado antes continuaria na definição anterior.
        pedido = self.novo_pedido()

        corpo = self.client.get(self.url(pedido.token)).json()

        self.assertEqual(corpo, {
            'titulo': formulario.titulo,
            'subtitulo': formulario.subtitulo,
            'referencia': self.card.nome,
            'data_entrega': pedido.data_referencia.isoformat(),
            'campos': [
                {
                    'key': 'comentario',
                    'label': 'Como foi?',
                    'tipo': 'texto_longo',
                    'obrigatorio': True,
                    'max_length': 2000,
                },
            ],
        })

    def test_nenhum_nome_interno_aparece_no_corpo_cru(self):
        """Responsável, sprint, setor, projeto — nada disso chega até aqui."""
        pedido = self.novo_pedido()
        bruto = self.client.get(self.url(pedido.token)).content.decode()

        for segredo in ('SEGREDO-USUARIO', 'SEGREDO-SETOR',
                        'SEGREDO-SPRINT', 'SEGREDO-PROJETO'):
            with self.subTest(segredo=segredo):
                self.assertNotIn(segredo, bruto)

    def test_nenhum_identificador_interno_aparece_no_corpo(self):
        """Nem id de card, nem id de pedido, nem o token de volta, nem estado."""
        pedido = self.novo_pedido()
        corpo = self.client.get(self.url(pedido.token)).json()

        chaves_proibidas = {
            'id', 'pk', 'card', 'card_id', 'card_kanban', 'estado', 'token',
            'data_referencia', 'respondido_em', 'criado_em', 'valores',
            'formulario', 'url_publica', 'projeto', 'sprint', 'setor',
            'responsavel',
        }
        self.assertEqual(set(corpo.keys()) & chaves_proibidas, set())
        self.assertNotIn(pedido.token, self.client.get(
            self.url(pedido.token)).content.decode())

    def test_anotacao_interna_dentro_da_definicao_nao_vaza(self):
        """A definição dos campos é JSON livre: um dia alguém guarda uma nota lá.

        `campos_publicos` reescreve campo a campo em vez de devolver o JSON cru,
        e é isso que este teste trava.
        """
        FeedbackFormulario.objects.filter(slug='padrao', ativo=True).update(ativo=False)
        FeedbackFormulario.objects.create(
            # Versao DERIVADA: cravar o numero quebra quando uma migration
            # semeia a versao seguinte (foi o que aconteceu com a v3).
            slug='padrao',
            versao=(FeedbackFormulario.objects.filter(slug='padrao')
                    .aggregate(m=Max('versao'))['m'] or 0) + 1,
            titulo='Com anotação', ativo=True,
            campos=[{
                'key': 'comentario',
                'label': 'Como foi?',
                'tipo': 'texto_longo',
                'obrigatorio': True,
                'max_length': 500,
                'anotacao_interna': 'SEGREDO-DA-DEFINICAO',
                'responsavel_interno': 'SEGREDO-USUARIO',
            }],
        )
        pedido = self.novo_pedido()
        resposta = self.client.get(self.url(pedido.token))

        self.assertNotIn('SEGREDO-DA-DEFINICAO', resposta.content.decode())
        self.assertEqual(
            set(resposta.json()['campos'][0].keys()),
            {'key', 'label', 'tipo', 'obrigatorio', 'max_length'},
        )

    def test_um_pedido_nao_enxerga_o_outro(self):
        """Cada link mostra só o SEU card — nada de "outros cards do projeto"."""
        outro_card = self.novo_card('SEGREDO-OUTRO-CARD')
        criar_pedido_feedback(
            card_id=outro_card.id,
            data_referencia=timezone.localdate(),
            referencia_publica=outro_card.nome,
        )
        pedido = self.novo_pedido()

        bruto = self.client.get(self.url(pedido.token)).content.decode()
        self.assertIn(self.card.nome, bruto)
        self.assertNotIn('SEGREDO-OUTRO-CARD', bruto)

    def test_referencia_publica_e_copia_congelada_do_rotulo(self):
        """Renomear o card depois não muda o que o respondente já viu — e, mais
        importante, prova que a rota NÃO faz join em Card."""
        pedido = self.novo_pedido()
        Card.objects.filter(pk=self.card.pk).update(nome='SEGREDO-NOME-NOVO')

        corpo = self.client.get(self.url(pedido.token)).json()
        self.assertEqual(corpo['referencia'], 'Site institucional')
        self.assertNotIn('SEGREDO-NOME-NOVO', str(corpo))


# =========================================================================== #
# 9. UM PEDIDO PROBLEMÁTICO NÃO DERRUBA A FILA
# =========================================================================== #
class Req09ResilienciaDaTarefaTests(BaseFeedback):

    def _fila_de_tres_vencidos(self) -> list[PedidoFeedback]:
        vencida = timezone.localdate() - dt.timedelta(days=40)
        pedidos = []
        for i in range(3):
            card = self.novo_card(f'Card da fila {i}')
            pedidos.append(criar_pedido_feedback(
                card_id=card.id, data_referencia=vencida, referencia_publica=card.nome,
            ))
        return pedidos

    def test_falha_no_meio_da_fila_nao_impede_os_seguintes(self):
        """O item ruim é o do MEIO de propósito: se a tarefa abortasse, o
        terceiro ficaria para trás e ninguém perceberia (a próxima varredura o
        pegaria). Colocar o ruim no fim daria um teste que passa sem provar nada.
        """
        pedidos = self._fila_de_tres_vencidos()
        problematico = pedidos[1]

        def hook(pedido_id, estado):
            if pedido_id == problematico.pk:
                raise RuntimeError('falha simulada no hook da fase 2')

        with mock.patch('apps.feedbacks.tasks.notificar_transicao', side_effect=hook):
            # assertLogs também prova que a falha foi REGISTRADA: engolir o erro
            # em silêncio seria pior do que derrubar a fila.
            with self.assertLogs('apps.feedbacks.tasks', level='ERROR') as capturado:
                resultado = liberar_pedidos_no_prazo()

        self.assertEqual(resultado['falhas'], 1)
        self.assertEqual(len(capturado.records), 1)
        # E o log não pode carregar o token do pedido problemático.
        self.assertNotIn(problematico.token, '\n'.join(capturado.output))
        # Os TRÊS foram promovidos no banco: o UPDATE acontece antes do hook, e a
        # exceção do hook não pode desfazer uma transição já gravada.
        for pedido in pedidos:
            pedido.refresh_from_db()
            self.assertEqual(pedido.estado, EstadoPedido.AGUARDANDO_RESPOSTA)

    def test_hook_quebrado_em_todos_ainda_promove_todos(self):
        """Pior caso: o colaborador da fase 2 está fora do ar por inteiro."""
        pedidos = self._fila_de_tres_vencidos()
        with mock.patch('apps.feedbacks.tasks.notificar_transicao',
                        side_effect=RuntimeError('kanban fora do ar')):
            with self.assertLogs('apps.feedbacks.tasks', level='ERROR'):
                resultado = liberar_pedidos_no_prazo()

        self.assertEqual(resultado['falhas'], 3)
        self.assertEqual(
            PedidoFeedback.objects.filter(
                estado=EstadoPedido.AGUARDANDO_RESPOSTA).count(),
            3,
        )
        # E a varredura seguinte, com o hook são, não reprocessa nada.
        self.assertEqual(liberar_pedidos_no_prazo()['promovidos'], 0)
        self.assertEqual(len(pedidos), 3)

    def test_pedido_apagado_no_meio_da_varredura_nao_quebra_a_tarefa(self):
        """Falha realista, sem mock de exceção: a tarefa materializa os ids e só
        depois faz o UPDATE. Se alguém apagar o card nesse intervalo, o UPDATE
        casa 0 linhas — e isso não pode virar erro nem contar como promoção.

        A vítima é escolhida DENTRO do hook, a partir de quem ainda não passou:
        a fila sai ordenada por `-criado_em` (Meta.ordering), então fixar o alvo
        de fora faria o teste depender dessa ordenação. Na primeira chamada do
        hook só UM pedido foi processado — qualquer outro serve, sempre.
        """
        pedidos = self._fila_de_tres_vencidos()
        apagado: dict[str, int] = {}

        def hook(pedido_id, estado):
            if apagado:
                return
            alvo = next(p for p in pedidos if p.pk != pedido_id)
            apagado['pedido'] = alvo.pk
            Card.objects.filter(pk=alvo.card_id).delete()  # CASCADE leva o pedido

        with mock.patch('apps.feedbacks.tasks.notificar_transicao', side_effect=hook):
            resultado = liberar_pedidos_no_prazo()

        # Some sem exceção e sem contar como promovido: 3 na fila, 1 evaporou.
        self.assertEqual(resultado, {'promovidos': 2, 'falhas': 0, 'reconciliados': 0})
        self.assertFalse(PedidoFeedback.objects.filter(pk=apagado['pedido']).exists())
        sobreviventes = PedidoFeedback.objects.exclude(pk=apagado['pedido'])
        self.assertEqual(sobreviventes.count(), 2)
        for pedido in sobreviventes:
            self.assertEqual(pedido.estado, EstadoPedido.AGUARDANDO_RESPOSTA)

    def test_falha_ao_apagar_uma_resposta_nao_impede_as_demais(self):
        """A mesma tolerância por item vale para a tarefa de retenção (LGPD):
        uma linha travada não pode deixar as outras retidas para sempre."""
        alvos = []
        with self.settings(FEEDBACK_RETENCAO_DIAS=30):
            for i in range(3):
                card = self.novo_card(f'Card retencao {i}')
                pedido = criar_pedido_feedback(
                    card_id=card.id, data_referencia=timezone.localdate(),
                    referencia_publica=card.nome,
                )
                resposta = RespostaFeedback.objects.create(
                    pedido=pedido, valores={'o_que_agradou': f'texto {i}'},
                )
                PedidoFeedback.objects.filter(pk=pedido.pk).update(
                    estado=EstadoPedido.RESPONDIDO,
                    respondido_em=timezone.now() - dt.timedelta(days=31),
                )
                # O corte da retenção é POR LINHA (`enviado_em`) desde que um
                # pedido passou a ter várias respostas. `auto_now_add` obriga o
                # `update()` para envelhecer.
                RespostaFeedback.objects.filter(pk=resposta.pk).update(
                    enviado_em=timezone.now() - dt.timedelta(days=31),
                )
                alvos.append(resposta.pk)

            travada = alvos[1]
            filtrar_original = RespostaFeedback.objects.filter

            class QuerySetQueExplode:
                """Só o `delete()` falha; o resto do queryset segue real."""

                def __init__(self, qs):
                    self._qs = qs

                def delete(self):
                    raise RuntimeError('falha simulada de banco')

            def filtrar(*args, **kwargs):
                qs = filtrar_original(*args, **kwargs)
                if kwargs.get('pk') == travada:
                    return QuerySetQueExplode(qs)
                return qs

            with mock.patch.object(RespostaFeedback.objects, 'filter',
                                   side_effect=filtrar):
                with self.assertLogs('apps.feedbacks.tasks', level='ERROR'):
                    resultado = limpar_respostas_expiradas()

        self.assertEqual(resultado['apagadas'], 2)
        self.assertEqual(resultado['falhas'], 1)
        # Sobrou exatamente a travada — as outras duas foram apagadas.
        self.assertEqual(
            list(RespostaFeedback.objects.values_list('pk', flat=True)), [travada],
        )

    def test_fila_vazia_e_no_op(self):
        self.assertEqual(liberar_pedidos_no_prazo(), {'promovidos': 0, 'falhas': 0, 'reconciliados': 0})


# =========================================================================== #
# 10. TROCAR OS CAMPOS NÃO EXIGE MIGRATION
# =========================================================================== #
class Req10TrocaDeFormularioTests(BaseFeedback):
    """Trocar as perguntas é DADO, não schema — e o teste tem de continuar
    provando isso mesmo depois que uma migration já publicou uma versão.

    Estes testes publicavam a versão 2 à mão. A migration 0005 passou a semear a
    versão 2 do slug 'padrao', e o `versao=2` cravado virou UniqueViolation em
    (slug, versao). A correção não é renumerar para 3 — é DERIVAR a próxima
    versão (`_publicar_versao` na base), para que a mesma armadilha não volte no
    dia em que existir uma v3 semeada.
    """

    CAMPOS_SEGUINTES = [
        {'key': 'nota', 'label': 'De 0 a 10, quanto você recomendaria?',
         'tipo': 'texto', 'obrigatorio': True, 'max_length': 4},
        {'key': 'melhoria', 'label': 'O que faríamos melhor?',
         'tipo': 'texto_longo', 'obrigatorio': False, 'max_length': 800},
    ]

    def _publicar_seguinte(self) -> FeedbackFormulario:
        """O procedimento de 2 passos documentado na migration 0002."""
        return self._publicar_versao(
            titulo='Como foi trabalhar com a gente?',
            campos=self.CAMPOS_SEGUINTES,
        )

    def test_fluxo_completo_com_campos_novos_sem_tocar_no_schema(self):
        self._publicar_seguinte()
        card = self.novo_card('Card do formulário novo')
        pedido = criar_pedido_feedback(
            card_id=card.id, data_referencia=timezone.localdate(),
            referencia_publica=card.nome,
        )

        # O GET já entrega os campos NOVOS, campo a campo.
        corpo = self.client.get(self.url(pedido.token)).json()
        self.assertEqual(corpo['titulo'], 'Como foi trabalhar com a gente?')
        self.assertEqual([c['key'] for c in corpo['campos']], ['nota', 'melhoria'])
        self.assertEqual(corpo['campos'][0]['max_length'], 4)
        self.assertFalse(corpo['campos'][1]['obrigatorio'])

        # E o POST valida contra a definição NOVA.
        aceito = self.client.post(
            self.url(pedido.token),
            {'valores': {'nota': '9', 'melhoria': 'prazo mais curto'}},
            content_type='application/json',
        )
        self.assertEqual(aceito.status_code, 201)
        pedido.refresh_from_db()
        self.assertEqual(
            pedido.respostas.first().valores,
            {'nota': '9', 'melhoria': 'prazo mais curto'},
        )

    def test_a_chave_antiga_passa_a_ser_rejeitada(self):
        """Prova que a validação segue o DADO, e não uma lista fixa no código.

        O payload é escrito À MÃO com a chave da versão ANTERIOR, e não derivado
        de `_apoio_testes`: derivar produziria um payload válido para a
        definição nova, que é justamente o contrário do que este teste existe
        para provar.
        """
        anterior = self.formulario_ativo()
        chave_velha = anterior.campos[0]['key']
        self._publicar_seguinte()

        card = self.novo_card('Card da versão seguinte')
        pedido = criar_pedido_feedback(
            card_id=card.id, data_referencia=timezone.localdate(),
            referencia_publica=card.nome,
        )
        self.assertNotEqual(pedido.formulario_id, anterior.pk)

        recusado = self.client.post(
            self.url(pedido.token),
            {'valores': {chave_velha: 'texto no campo velho'}},
            content_type='application/json',
        )
        self.assertEqual(recusado.status_code, 400)
        self.assertFalse(RespostaFeedback.objects.filter(pedido=pedido).exists())

    def test_resposta_antiga_continua_legivel_contra_a_versao_que_a_pessoa_viu(self):
        """É por isso que a troca cria uma LINHA nova em vez de editar a atual."""
        anterior = self.formulario_ativo()
        antigo = self.novo_pedido()
        self.responder(antigo.token, 'respondi no formulário velho')
        gravado = PedidoFeedback.objects.get(pk=antigo.pk).respostas.first().valores

        self._publicar_seguinte()

        antigo.refresh_from_db()
        # A linha antiga não foi editada: mesma PK, mesma versão, mesmos campos.
        # Só o flag `ativo` mudou.
        self.assertEqual(antigo.formulario_id, anterior.pk)
        self.assertEqual(antigo.formulario.versao, anterior.versao)
        self.assertEqual(antigo.formulario.campos, anterior.campos)
        self.assertEqual(antigo.respostas.first().valores, gravado)

    def test_o_banco_recusa_duas_versoes_ativas_ao_mesmo_tempo(self):
        """Sem a constraint parcial, o passo 1 esquecido deixaria duas ativas e a
        escolha do formulário do pedido novo seria arbitrária.

        A versão é DERIVADA, e isso é o teste: com um número já ocupado o INSERT
        também falharia, mas por `uniq_formulario_slug_versao` — e o teste
        passaria verde sem nunca ter exercitado a constraint PARCIAL que ele diz
        estar provando.
        """
        from django.db import IntegrityError, transaction

        livre = 1 + FeedbackFormulario.objects.filter(
            slug='padrao').order_by('-versao').first().versao

        with self.assertRaises(IntegrityError), transaction.atomic():
            FeedbackFormulario.objects.create(
                slug='padrao', versao=livre, titulo='Duplicada', campos=[],
                ativo=True,
            )

    def test_a_troca_nao_gera_migration_pendente(self):
        """A prova literal do requisito: depois de trocar os campos, o Django não
        detecta mudança de schema no app.

        `makemigrations --check` levanta SystemExit(1) quando falta migration.
        Escopado em 'feedbacks' de propósito: outro app com modelo em edição não
        pode fazer ESTE teste falhar.
        """
        self._publicar_seguinte()
        saida = io.StringIO()
        try:
            call_command(
                'makemigrations', 'feedbacks', '--check', '--dry-run',
                stdout=saida, stderr=saida, verbosity=1,
            )
        except SystemExit:
            self.fail(
                'Trocar os campos do formulário exigiu migration de schema. '
                f'makemigrations disse: {saida.getvalue()}'
            )

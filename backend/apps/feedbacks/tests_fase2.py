"""
Testes da FASE 2: o produto ligado ao motor.

A fase 1 provou o motor. Aqui a pergunta é outra: o projeto virar "Entregue"
produz os cards e os links certos, nos lugares certos, sem tocar em nada que já
existia — e SEM DUPLICAR quando a entrega acontece duas vezes.

Três escolhas de método, porque mudam o que os testes provam:

1. O TESTE DE SETOR LIGA A FLAG (`@override_settings(SETOR_SCOPING_ENABLED=True)`).
   Com ela desligada — que é o estado de hoje — `_sem_escopo` devolve o queryset
   inteiro e NENHUMA asserção de visibilidade significa coisa alguma. O erro só
   apareceria no dia do rollout, como vazamento, com meses de cards já criados
   errados.

2. AS TRANSIÇÕES SÃO EXERCITADAS PELOS CAMINHOS REAIS (a varredura do Celery e o
   POST anônimo), não chamando `notificar_transicao` na mão. É o acoplamento
   entre motor e projeção que está sob teste, não a função isolada.

3. O CARD ORIGINAL É CONFERIDO CAMPO A CAMPO depois da entrega. "Não foi tocado"
   é requisito literal do usuário, e um `assertEqual(status)` sozinho não pegaria
   uma troca de projeto ou de sprint.
"""
from __future__ import annotations

import datetime as dt
from unittest import mock

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Permission
from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils import timezone

from apps.accounts.models import NivelCompartilhamento, SetorCatalogo, UserSetor
from apps.projects.models import (
    Card, CardCompartilhamento, CardStatus, KanbanStage, Project,
    ProjectKanbanStageConfig, ProjectStatus, Sprint,
)
from apps.projects.services import get_proxima_sprint, sprint_conflitante_na_janela
from apps.projects.views import FEEDBACK_ETAPA_FORA_DO_FLUXO, FEEDBACK_SOMENTE_LEITURA

from ._apoio_testes import resposta_valida
from .estrutura import (
    NOME_PROJETO_MONITORAMENTO, garantir_estrutura_monitoramento,
    gerar_pedido_do_card_finalizado,
)
from .models import EstadoPedido, PedidoFeedback
from .tasks import liberar_pedidos_no_prazo

User = get_user_model()

# As etapas do fluxo. 'feedback_encerrado' entrou depois, com a etapa que
# invalida o link — e é reversível: voltar o card reabre o formulário.
CHAVES_DAS_ETAPAS = [
    'aguardando_prazo', 'aguardando_resposta', 'respondido', 'feedback_encerrado',
]
CHAVES_NORMAIS = [
    'a_desenvolver', 'em_desenvolvimento', 'parado_pendencias',
    'em_homologacao', 'finalizado', 'inviabilizado',
]


class BaseFase2(TestCase):
    """Cadeia real: setor -> sprint -> projeto -> cards (um marcado, um não)."""

    def setUp(self):
        cache.clear()
        self.user = User.objects.create_superuser(
            username='chefe', password='x' * 12, email='chefe@example.com',
        )
        self.setor = SetorCatalogo.objects.create(codename='tec', nome='Tecnologia')
        agora = timezone.now()
        self.sprint = Sprint.objects.create(
            nome='Sprint 1', data_inicio=agora,
            fechamento_em=agora + dt.timedelta(days=7), duracao_dias=7,
            supervisor=self.user, setor=self.setor,
        )
        self.projeto = Project.objects.create(nome='Portal do cliente', sprint=self.sprint)
        self.card_marcado = Card.objects.create(
            nome='Tela de login', projeto=self.projeto, gerar_formulario_feedback=True,
        )
        self.card_comum = Card.objects.create(nome='Tela de senha', projeto=self.projeto)

    # --- utilidades --------------------------------------------------------

    def entregar(self):
        """O gatilho REAL: gravar o status pelo caminho que a API usa (`save()`).

        `captureOnCommitCallbacks(execute=True)` é OBRIGATÓRIO e não é detalhe de
        teste: o signal agenda a geração em `transaction.on_commit`, e o
        `TestCase` envolve cada teste numa transação que nunca comita — sem isto,
        o callback JAMAIS rodaria e todo teste desta suíte passaria por engano,
        provando nada. Executar aqui é o que faz o teste percorrer o mesmo
        caminho da requisição real.
        """
        # O status do projeto continua sendo gravado porque alguns testes o
        # afirmam — mas quem DISPARA a geração agora é o card finalizado.
        with self.captureOnCommitCallbacks(execute=True):
            self.projeto.status = ProjectStatus.ENTREGUE
            self.projeto.save()
        self._finalizar_marcados()


    def _finalizar_marcados(self, projeto=None):
        """O GATILHO REAL: finalizar os cards MARCADOS do projeto.

        Antes esta suíte disparava `Project.status = 'entregue'`. Aquele era o
        gatilho da primeira versão e foi trocado quando os dados mostraram que
        ninguém move o status do projeto (106 de 106 em 'criado'): neste sistema
        o projeto é uma PASTA e quem tem ciclo de vida é o CARD.

        `captureOnCommitCallbacks(execute=True)` é OBRIGATÓRIO e não é detalhe
        de teste: o signal agenda a geração em `transaction.on_commit`, e o
        `TestCase` envolve cada teste numa transação que nunca comita — sem
        isto o callback JAMAIS rodaria e todo teste desta suíte passaria por
        engano, provando nada.
        """
        alvo = projeto or self.projeto
        marcados = list(
            Card.objects.filter(projeto=alvo, gerar_formulario_feedback=True))

        # REENTREGA É UMA TRANSIÇÃO DE VERDADE. Quem já está em 'finalizado'
        # precisa SAIR antes de voltar — o signal dispara na TRANSIÇÃO, não no
        # estado. Sem este passo, chamar `entregar()` uma segunda vez seria um
        # no-op silencioso, e os testes de "não duplica" e "não rebaixa a
        # coluna" passariam sem exercitar nada.
        reabrir = [c for c in marcados if c.status == CardStatus.FINALIZADO]
        if reabrir:
            with self.captureOnCommitCallbacks(execute=True):
                for card in reabrir:
                    card.status = CardStatus.EM_DESENVOLVIMENTO
                    card.save()

        with self.captureOnCommitCallbacks(execute=True):
            for card in marcados:
                card.status = CardStatus.FINALIZADO
                card.save()

    def projeto_monitoramento(self) -> Project:
        return Project.objects.get(nome=NOME_PROJETO_MONITORAMENTO)

    def cards_de_monitoramento(self):
        return Card.objects.filter(projeto=self.projeto_monitoramento())

    def logar(self, user=None):
        alvo = user or self.user
        self.client.force_login(User.objects.get(pk=alvo.pk))


# =========================================================================== #
# 1. O GATILHO E A ESTRUTURA
# =========================================================================== #
class GatilhoDaEntregaTests(BaseFase2):

    def test_entrega_gera_pedido_e_card_apenas_para_o_card_marcado(self):
        self.entregar()

        pedidos = PedidoFeedback.objects.all()
        self.assertEqual(pedidos.count(), 1)
        self.assertEqual(pedidos.first().card_id, self.card_marcado.pk)

        cards = self.cards_de_monitoramento()
        self.assertEqual(cards.count(), 1)
        self.assertEqual(cards.first().nome, self.card_marcado.nome)
        self.assertEqual(cards.first().status, EstadoPedido.AGUARDANDO_PRAZO)
        self.assertEqual(pedidos.first().card_kanban_id, cards.first().pk)

    def test_cinco_marcados_geram_cinco_pedidos_e_cinco_links(self):
        """A cardinalidade pedida: UM pedido e UM link POR CARD MARCADO."""
        for i in range(4):
            Card.objects.create(
                nome=f'Extra {i}', projeto=self.projeto, gerar_formulario_feedback=True)

        self.entregar()

        self.assertEqual(PedidoFeedback.objects.count(), 5)
        self.assertEqual(self.cards_de_monitoramento().count(), 5)
        tokens = set(PedidoFeedback.objects.values_list('token', flat=True))
        self.assertEqual(len(tokens), 5)

    def test_projeto_sem_card_marcado_nao_gera_nada(self):
        self.card_marcado.gerar_formulario_feedback = False
        self.card_marcado.save()

        self.entregar()

        self.assertEqual(PedidoFeedback.objects.count(), 0)
        self.assertFalse(Project.objects.filter(nome=NOME_PROJETO_MONITORAMENTO).exists())

    def test_salvar_de_novo_um_projeto_ja_entregue_nao_reprocessa(self):
        """É a TRANSIÇÃO que dispara, não o estado."""
        self.entregar()
        with mock.patch('apps.feedbacks.signals.gerar_pedido_do_card_finalizado') as gerar:
            with self.captureOnCommitCallbacks(execute=True):
                self.projeto.nome = 'Portal do cliente (v2)'
                self.projeto.save()
        gerar.assert_not_called()

    def test_o_card_original_nao_e_tocado_em_nada(self):
        """Requisito literal: o card entregue continua onde estava, como estava.

        `status` FICA DE FORA da comparação — e não por conveniência: finalizar
        o card é o próprio gatilho. Exigir que ele não mude seria exigir que a
        entrega não acontecesse. O que este teste defende é o resto: o card não
        muda de projeto, não é renomeado, não perde o responsável nem o setor,
        não ganha prazo. Ou seja, o fluxo de feedback OBSERVA a entrega, não
        mexe no trabalho de quem entregou.
        """
        CAMPOS = ('projeto_id', 'nome', 'responsavel_id', 'data_fim', 'setor_id')
        antes = Card.objects.values(*CAMPOS).get(pk=self.card_marcado.pk)

        self.entregar()

        depois = Card.objects.values(*CAMPOS).get(pk=self.card_marcado.pk)
        self.assertEqual(antes, depois)
        # E a transição que disparou tudo de fato ficou gravada.
        self.assertEqual(
            Card.objects.values_list('status', flat=True).get(pk=self.card_marcado.pk),
            'finalizado',
        )
        # E a sprint do projeto original também não mudou.
        self.assertEqual(
            Project.objects.values_list('sprint_id', flat=True).get(pk=self.projeto.pk),
            self.sprint.pk,
        )

    def test_o_card_de_monitoramento_nasce_sem_responsavel_e_sem_prazo(self):
        self.entregar()
        card = self.cards_de_monitoramento().get()
        self.assertIsNone(card.responsavel_id)
        self.assertIsNone(card.data_fim)


# =========================================================================== #
# 2. REENTREGA — A PROVA DE QUE NÃO NASCE CARD DUPLICADO
# =========================================================================== #
class ReentregaTests(BaseFase2):

    def test_entregue_voltou_entregue_de_novo_nao_duplica_nada(self):
        self.entregar()
        token_inicial = PedidoFeedback.objects.get().token
        card_inicial = self.cards_de_monitoramento().get().pk

        self.projeto.status = ProjectStatus.EM_DESENVOLVIMENTO
        self.projeto.save()
        self.entregar()

        self.assertEqual(PedidoFeedback.objects.count(), 1)
        self.assertEqual(self.cards_de_monitoramento().count(), 1)
        self.assertEqual(PedidoFeedback.objects.get().token, token_inicial)
        self.assertEqual(self.cards_de_monitoramento().get().pk, card_inicial)

    def test_reentrega_depois_da_promocao_nao_rebaixa_a_coluna(self):
        """O card já promovido não volta para "Aguardando 30 dias"."""
        self.entregar()
        pedido = PedidoFeedback.objects.get()
        PedidoFeedback.objects.filter(pk=pedido.pk).update(
            estado=EstadoPedido.AGUARDANDO_RESPOSTA)
        Card.objects.filter(pk=pedido.card_kanban_id).update(
            status=EstadoPedido.AGUARDANDO_RESPOSTA)

        self.projeto.status = ProjectStatus.EM_DESENVOLVIMENTO
        self.projeto.save()
        self.entregar()

        self.assertEqual(
            PedidoFeedback.objects.get().estado, EstadoPedido.AGUARDANDO_RESPOSTA)
        self.assertEqual(
            self.cards_de_monitoramento().get().status, EstadoPedido.AGUARDANDO_RESPOSTA)

    def test_gerar_direto_duas_vezes_e_idempotente(self):
        """Sem passar pelo signal: a função em si tem de ser idempotente."""
        # O alvo agora é o CARD: a função gera o pedido DELE.
        alvo = Card.objects.filter(
            projeto=self.projeto, gerar_formulario_feedback=True).first()
        alvo.status = CardStatus.FINALIZADO
        alvo.save()
        gerar_pedido_do_card_finalizado(alvo.pk)
        gerar_pedido_do_card_finalizado(alvo.pk)

        self.assertEqual(PedidoFeedback.objects.count(), 1)
        self.assertEqual(self.cards_de_monitoramento().count(), 1)


# =========================================================================== #
# 3. `data_entrega` NULA — O MODO DE FALHA MAIS PROVÁVEL
# =========================================================================== #
class DataDeReferenciaTests(BaseFase2):

    def test_data_entrega_none_usa_a_data_local_de_hoje(self):
        self.assertIsNone(self.projeto.data_entrega)

        self.entregar()

        self.assertEqual(
            PedidoFeedback.objects.get().data_referencia, timezone.localdate())

    def test_finalizado_em_e_convertido_para_data_LOCAL(self):
        """22h30 locais = dia SEGUINTE em UTC. `dt.date()` daria o dia errado.

        A data de referência sai de `Card.finalizado_em` — o instante em que o
        card foi arrastado para "Finalizado" —, e não mais de
        `Project.data_entrega`: projeto aqui é pasta, quem é entregue é o card.

        `finalizado_em` é gravado PELO SIGNAL de projects, que o sobrescreve com
        `timezone.now()` a cada transição (projects/signals.py:207). Por isso o
        instante é fixado por `update()` DEPOIS da transição, e a geração é
        chamada direto: presetar o campo antes do `save()` seria apagado, e o
        teste passaria a medir o relógio em vez da conversão de fuso.
        """
        # 2026-08-12 01:30 UTC == 2026-08-11 22:30 em America/Sao_Paulo.
        instante = dt.datetime(2026, 8, 12, 1, 30, tzinfo=dt.timezone.utc)

        self.entregar()
        PedidoFeedback.objects.all().delete()
        self.cards_de_monitoramento().delete()
        Card.objects.filter(pk=self.card_marcado.pk).update(finalizado_em=instante)

        gerar_pedido_do_card_finalizado(self.card_marcado.pk)

        self.assertEqual(
            PedidoFeedback.objects.get().data_referencia, dt.date(2026, 8, 11))

    def test_finalizar_o_card_pela_api_nao_devolve_500(self):
        """O CAMINHO REAL DA TELA: arrastar o card para "Finalizado".

        Vale por dois: prova que a feature não derruba o PATCH (500) e que
        também não fica inerte (0 pedidos). Um teste que só chamasse a função
        interna passaria com o signal desligado — este não.
        """
        self.logar()
        with self.captureOnCommitCallbacks(execute=True):
            resposta = self.client.patch(
                f'/api/cards/{self.card_marcado.pk}/',
                {'status': CardStatus.FINALIZADO},
                content_type='application/json',
            )
        self.assertEqual(resposta.status_code, 200)
        self.assertEqual(PedidoFeedback.objects.count(), 1)

    def test_falha_na_geracao_nao_sobe_do_callback(self):
        """`on_commit` que LEVANTA propaga para quem fez o commit — ou seja, o
        PATCH do projeto responderia 500 COM O STATUS JÁ GRAVADO. Nada pode
        subir daqui; a falha é silenciosa por desenho e o log é o único aviso."""
        self.logar()
        with mock.patch(
            'apps.feedbacks.estrutura.garantir_estrutura_monitoramento',
            side_effect=RuntimeError('banco pegou fogo'),
        ):
            # Não levanta: se levantasse, o `with` explodiria aqui.
            alvo = Card.objects.filter(
                projeto=self.projeto, gerar_formulario_feedback=True).first()
            alvo.status = CardStatus.FINALIZADO
            alvo.save()
            resumo = gerar_pedido_do_card_finalizado(alvo.pk)

            # O MESMO caminho da tela, com a geração quebrada por baixo: tem
            # de responder 200 e gravar o status assim mesmo.
            outro = Card.objects.create(
                nome='Tela de cadastro', projeto=self.projeto,
                gerar_formulario_feedback=True,
            )
            with self.captureOnCommitCallbacks(execute=True):
                resposta = self.client.patch(
                    f'/api/cards/{outro.pk}/',
                    {'status': CardStatus.FINALIZADO},
                    content_type='application/json',
                )

        self.assertEqual(resumo['falhas'], 1)
        self.assertEqual(resposta.status_code, 200)
        outro.refresh_from_db()
        self.assertEqual(outro.status, CardStatus.FINALIZADO)


# =========================================================================== #
# 4. O SEED: IDEMPOTENTE E RECORTADO
# =========================================================================== #
class EstruturaDeMonitoramentoTests(BaseFase2):

    def test_seed_rodado_duas_vezes_nao_duplica(self):
        primeiro = garantir_estrutura_monitoramento()
        segundo = garantir_estrutura_monitoramento()

        self.assertEqual(primeiro.pk, segundo.pk)
        self.assertEqual(Sprint.objects.filter(is_system=True).count(), 1)
        self.assertEqual(Project.objects.filter(is_system=True).count(), 1)
        self.assertEqual(
            ProjectKanbanStageConfig.objects.filter(project=primeiro).count(),
            len(CHAVES_DAS_ETAPAS))

    def test_board_do_monitoramento_tem_exatamente_as_colunas_do_fluxo(self):
        self.logar()
        projeto = garantir_estrutura_monitoramento()

        resposta = self.client.get(f'/api/projects/{projeto.pk}/kanban-config/')

        self.assertEqual(resposta.status_code, 200)
        self.assertEqual(
            [s['key'] for s in resposta.json()['stages']], CHAVES_DAS_ETAPAS)

    def test_projeto_normal_continua_com_as_seis_colunas(self):
        """O recorte vale nos DOIS sentidos: as do fluxo não vazam para cá."""
        self.logar()
        garantir_estrutura_monitoramento()

        resposta = self.client.get(f'/api/projects/{self.projeto.pk}/kanban-config/')

        self.assertEqual(
            sorted(s['key'] for s in resposta.json()['stages']), sorted(CHAVES_NORMAIS))

    def test_catalogo_global_de_etapas_nao_devolve_as_do_fluxo(self):
        """O furo do seletor "adicionar coluna"."""
        self.logar()
        garantir_estrutura_monitoramento()

        resposta = self.client.get('/api/kanban-stages/')

        corpo = resposta.json()
        itens = corpo['results'] if isinstance(corpo, dict) and 'results' in corpo else corpo
        keys = {item['key'] for item in itens}
        self.assertTrue(keys.issuperset(CHAVES_NORMAIS))
        self.assertEqual(keys & set(CHAVES_DAS_ETAPAS), set())

    def test_seed_marca_uma_etapa_pre_existente_como_oculta(self):
        """Banco que já tenha a key (criada à mão) não pode deixá-la no catálogo."""
        KanbanStage.objects.create(key='respondido', label='Qualquer coisa')

        garantir_estrutura_monitoramento()

        self.assertTrue(
            KanbanStage.objects.get(key='respondido').oculta_no_catalogo)

    def test_sem_usuario_no_banco_o_seed_desiste_sem_quebrar(self):
        """A data migration precisa poder pular; a auto-cura conserta depois."""
        Sprint.objects.all().delete()
        Project.objects.all().delete()
        User.objects.all().delete()

        self.assertIsNone(garantir_estrutura_monitoramento())

    def test_corpo_da_data_migration_gemea_roda_e_e_idempotente(self):
        """`estrutura.py` e `migrations/0003_seed_monitoramento` são gêmeos.

        No banco de TESTE a migration sempre toma o caminho do "pular" (não há
        usuário no instante em que ela roda), então o corpo dela nunca seria
        exercitado por ninguém — um `setor` no lugar de `setor_id`, ou uma key
        com typo, só apareceria no dia do deploy. Aqui ela é chamada com os
        modelos REAIS no lugar dos históricos: os nomes de campo são os mesmos, e
        é exatamente isso que está sob teste.

        POR QUE O TESTE MUDOU: ele procurava o projeto pelo NOME, usando a
        constante ATUAL do código. A 0003 é um retrato CONGELADO e cria com o
        nome antigo ('Monitoramento de feedbacks', f minúsculo); quem renomeia é
        a 0006, que veio depois. O `get()` por nome deixou de achar — e casar por
        nome é justamente o que o sistema proíbe em três lugares (o comentário de
        `Project.is_system`, `_projeto_do_fluxo_de_feedback` e
        `isProjetoMonitoramento` no frontend). A identidade oficial é o PAR DE
        FLAGS, e é por ele que se procura agora.

        E, para o teste ficar MAIS forte em vez de só voltar ao verde, ele passou
        a rodar a 0006 em seguida: cobre os dois gêmeos e a costura entre eles.
        """
        import importlib

        modulo = importlib.import_module(
            'apps.feedbacks.migrations.0003_seed_monitoramento')

        class AppsFalso:
            """`apps.get_model` do estado histórico, servindo os modelos reais."""

            @staticmethod
            def get_model(app_label, model_name):
                from django.apps import apps as registry
                return registry.get_model(app_label, model_name)

        modulo.semear(AppsFalso, None)

        # O par de flags é a identidade; o nome é só um rótulo que já mudou uma
        # vez e pode mudar de novo.
        projeto = Project.objects.get(is_system=True, sprint__is_system=True)
        self.assertEqual(projeto.nome, modulo.NOME_PROJETO)
        self.assertTrue(projeto.is_system)
        self.assertTrue(Sprint.objects.get(pk=projeto.sprint_id).is_system)
        # A 0003 é um RETRATO CONGELADO de quando o fluxo tinha três etapas —
        # e migration aplicada não se reescreve. A quarta chega na 0009; a
        # convergência com `estrutura.py` é afirmada no fim deste teste, depois
        # de rodar as duas.
        self.assertEqual(
            list(
                ProjectKanbanStageConfig.objects
                .filter(project=projeto).order_by('order')
                .values_list('stage__key', flat=True)
            ),
            CHAVES_DAS_ETAPAS[:3],
        )
        # Rodar de novo não duplica (é o mesmo `get_or_create` da função gêmea).
        modulo.semear(AppsFalso, None)
        self.assertEqual(Project.objects.filter(is_system=True).count(), 1)

        # A COSTURA COM A 0006: o retrato congelado nasce com o nome antigo e é a
        # migration seguinte que converge para o nome de hoje. Rodá-la aqui prova
        # que ela acha o projeto criado pela 0003 (as duas casam pelo par de
        # flags) e que o resultado final é o nome que o resto do sistema usa.
        renomear = importlib.import_module(
            'apps.feedbacks.migrations.0006_renomear_monitoramento')
        renomear.para_maiusculo(AppsFalso, None)

        projeto.refresh_from_db()
        self.assertEqual(projeto.nome, NOME_PROJETO_MONITORAMENTO)
        self.assertEqual(
            Sprint.objects.get(pk=projeto.sprint_id).nome, NOME_PROJETO_MONITORAMENTO,
        )

        # A COSTURA COM A 0009: a quarta etapa ("Feedback Finalizado") entrou
        # depois e SÓ existe nela. É este trecho que prova o que o teste promete
        # no nome — que a cadeia de migrations converge para o MESMO board que
        # `estrutura.py` monta em tempo de execução. Sem ele, um banco criado
        # do zero pelas migrations nasceria com três colunas e a quarta só
        # apareceria na primeira auto-cura, em silêncio.
        encerrar = importlib.import_module(
            'apps.feedbacks.migrations.0009_etapa_feedback_encerrado')
        encerrar.semear(AppsFalso, None)

        self.assertEqual(
            list(
                ProjectKanbanStageConfig.objects
                .filter(project=projeto).order_by('order')
                .values_list('stage__key', flat=True)
            ),
            CHAVES_DAS_ETAPAS,
        )


# =========================================================================== #
# 5. A SPRINT SISTÊMICA FICA FORA DE TUDO
# =========================================================================== #
class SprintSistemicaTests(BaseFase2):

    def setUp(self):
        super().setUp()
        self.monitoramento = garantir_estrutura_monitoramento()
        self.sistemica = Sprint.objects.get(is_system=True)

    def test_nao_aparece_na_listagem_de_sprints(self):
        self.logar()
        corpo = self.client.get('/api/sprints/').json()
        itens = corpo['results'] if isinstance(corpo, dict) and 'results' in corpo else corpo
        self.assertNotIn(self.sistemica.pk, [s['id'] for s in itens])
        self.assertIn(self.sprint.pk, [s['id'] for s in itens])

    def test_continua_acessivel_no_detail_para_o_atalho_abrir(self):
        self.logar()
        resposta = self.client.get(f'/api/sprints/{self.sistemica.pk}/')
        self.assertEqual(resposta.status_code, 200)
        self.assertTrue(resposta.json()['is_system'])

    def test_nao_bloqueia_a_criacao_de_sprint_no_setor_dela(self):
        """A janela dela cruza tudo; sem o recorte, o setor travaria."""
        agora = timezone.now()
        conflito = sprint_conflitante_na_janela(
            setor_id=self.sistemica.setor_id,
            data_inicio=agora, fechamento_em=agora + dt.timedelta(days=7),
        )
        self.assertIsNone(conflito)

    def test_nao_e_destino_de_replicacao(self):
        """Sem o recorte, `finalizar_sprint_replicacao` despejaria projetos nela."""
        outra = Sprint.objects.create(
            nome='Sprint do sem-setor', data_inicio=timezone.now(),
            fechamento_em=timezone.now() + dt.timedelta(days=1), duracao_dias=1,
            supervisor=self.user, setor=self.sistemica.setor,
        )
        self.assertIsNone(get_proxima_sprint(outra))

    def test_nao_e_fechada_pela_varredura_por_data(self):
        from apps.projects.tasks import finalizar_sprints_por_data

        # Mesmo com a data no passado (cenário de encurtamento por engano).
        Sprint.objects.filter(pk=self.sistemica.pk).update(
            fechamento_em=timezone.now() - dt.timedelta(days=1))

        finalizar_sprints_por_data()

        self.sistemica.refresh_from_db()
        self.assertFalse(self.sistemica.finalizada)

    def test_salvar_a_sprint_sistemica_nao_agenda_fechamento_no_broker(self):
        with mock.patch('apps.projects.tasks.fechar_sprint_em_hora.apply_async') as publicar:
            self.sistemica.fechamento_em = timezone.now() + dt.timedelta(days=9000)
            self.sistemica.save()
        publicar.assert_not_called()

    def test_is_system_nao_e_gravavel_pela_api(self):
        self.logar()
        self.client.patch(
            f'/api/sprints/{self.sprint.pk}/', {'is_system': True},
            content_type='application/json',
        )
        self.sprint.refresh_from_db()
        self.assertFalse(self.sprint.is_system)


# =========================================================================== #
# 6. O ARRASTO MANUAL: PERMITIDO DENTRO DO FLUXO, RECUSADO PARA FORA DELE
# =========================================================================== #
class ValidacaoDeStatusTests(BaseFase2):

    def setUp(self):
        super().setUp()
        self.entregar()
        self.card_feedback = self.cards_de_monitoramento().get()
        self.logar()

    def _patch_status(self, card, novo):
        return self.client.patch(
            f'/api/cards/{card.pk}/', {'status': novo}, content_type='application/json',
        )

    def test_card_comum_nao_entra_em_coluna_de_feedback(self):
        resposta = self._patch_status(self.card_comum, 'aguardando_prazo')

        self.assertEqual(resposta.status_code, 400)
        self.assertIn('status', resposta.json())
        self.card_comum.refresh_from_db()
        self.assertEqual(self.card_comum.status, 'a_desenvolver')

    def test_arrastar_dentro_do_fluxo_escreve_no_pedido_e_no_card(self):
        """A PREMISSA do teste antigo morreu — de novo, e por pedido explícito.

        Ele afirmava que arrastar era recusado (400 do serializer, depois 403 da
        view). O usuário então pediu a etapa "Feedback Finalizado" e disse, com
        todas as letras, que um card encerrado precisa poder VOLTAR para
        "Aguardando Feedback" ou "Feedback colhido" — o que só existe se o
        arraste dentro do fluxo passar. A recusa virou um recorte: MOVER passa,
        EDITAR/CRIAR/EXCLUIR não.

        A asserção que importa não é o 200: é que o PEDIDO mudou junto. Se só o
        card mudasse, a reconciliação diária desfaria o arraste em silêncio — e
        um teste que olhasse só o card ficaria verde enquanto o produto quebrava
        de madrugada.
        """
        resposta = self._patch_status(self.card_feedback, EstadoPedido.ENCERRADO)

        self.assertEqual(resposta.status_code, 200)
        self.card_feedback.refresh_from_db()
        self.assertEqual(self.card_feedback.status, EstadoPedido.ENCERRADO)
        self.assertEqual(
            PedidoFeedback.objects.get(card_kanban=self.card_feedback).estado,
            EstadoPedido.ENCERRADO,
        )

    def test_card_de_feedback_nao_pode_ir_para_finalizado(self):
        """Sair do fluxo continua barrado — só mudou o status HTTP (403 → 400).

        400 porque a recusa deixou de ser "você não pode escrever aqui" e passou
        a ser "esta etapa não existe neste fluxo": `PedidoFeedback.estado` só
        conhece os quatro valores do board de monitoramento, e 'finalizado' ainda
        travaria o card para sempre (`_card_edicao_restrita`).
        """
        resposta = self._patch_status(self.card_feedback, 'finalizado')

        self.assertEqual(resposta.status_code, 400)
        self.assertEqual(resposta.json()['detail'], FEEDBACK_ETAPA_FORA_DO_FLUXO)
        self.card_feedback.refresh_from_db()
        self.assertEqual(self.card_feedback.status, EstadoPedido.AGUARDANDO_PRAZO)

    def test_editar_qualquer_campo_do_card_de_feedback_e_recusado(self):
        """A PREMISSA do teste antigo morreu, e por isso ele virou o negativo.

        Ele afirmava "o bloqueio é do STATUS, não do card" e esperava 200 ao
        editar um campo inofensivo. O pedido do usuário passou a ser explícito no
        sentido contrário — "não deve ter a opção de criar card, de editar ou
        excluir" —, então a afirmação certa hoje é que NEM um comentário passa.

        A cobertura que se perde ("projeto normal continua editável") já existe
        verde em `test_movimentacao_normal_do_board_continua_funcionando`.
        """
        resposta = self.client.patch(
            f'/api/cards/{self.card_feedback.pk}/',
            {'card_comment': 'liguei para o cliente', 'status': EstadoPedido.AGUARDANDO_PRAZO},
            content_type='application/json',
        )

        self.assertEqual(resposta.status_code, 403)
        self.assertEqual(resposta.json()['detail'], FEEDBACK_SOMENTE_LEITURA)
        # E o campo não foi gravado — a recusa é de verdade, não só de status.
        self.card_feedback.refresh_from_db()
        self.assertNotEqual(self.card_feedback.card_comment, 'liguei para o cliente')

    def test_a_regra_do_serializer_continua_de_pe_para_o_card_de_feedback(self):
        """A regra 1 do serializer ficou INALCANÇÁVEL pela API — não morta.

        Com o 403 da view rodando antes, `_validar_status_no_board` nunca mais é
        chamado para um card de feedback vindo de fora. Este teste de UNIDADE
        impede que ela vire código órfão: se alguém a apagar achando que "não é
        usada", isto fica vermelho. É a contrapartida de
        `test_card_comum_nao_entra_em_coluna_de_feedback`, que exercita o outro
        lado da mesma função pela API.
        """
        from rest_framework.exceptions import ValidationError

        from apps.projects.serializers import CardSerializer

        serializer = CardSerializer(
            instance=self.card_feedback, data={'status': 'respondido'}, partial=True,
        )
        with self.assertRaises(ValidationError) as erro:
            serializer.is_valid(raise_exception=True)
        self.assertIn('status', erro.exception.detail)

    def test_movimentacao_normal_do_board_continua_funcionando(self):
        resposta = self._patch_status(self.card_comum, 'em_desenvolvimento')
        self.assertEqual(resposta.status_code, 200)

    def test_projeto_sem_config_de_kanban_aceita_status_legado(self):
        """O escape para projeto legado: sem config nenhuma, vale a lista antiga."""
        ProjectKanbanStageConfig.objects.filter(project=self.projeto).delete()
        resposta = self._patch_status(self.card_comum, 'em_homologacao')
        self.assertEqual(resposta.status_code, 200)


# =========================================================================== #
# 7. AS TRANSIÇÕES: O CARD SEGUE O PEDIDO
# =========================================================================== #
class TransicaoDeColunaTests(BaseFase2):

    def setUp(self):
        super().setUp()
        self.entregar()
        self.pedido = PedidoFeedback.objects.get()
        self.card_feedback = Card.objects.get(pk=self.pedido.card_kanban_id)

    def test_os_trinta_dias_promovem_o_card_para_aguardando_feedback(self):
        PedidoFeedback.objects.filter(pk=self.pedido.pk).update(
            data_referencia=timezone.localdate() - dt.timedelta(days=30))

        liberar_pedidos_no_prazo()

        self.card_feedback.refresh_from_db()
        self.assertEqual(self.card_feedback.status, EstadoPedido.AGUARDANDO_RESPOSTA)

    def test_responder_o_formulario_move_o_card_para_feedback_colhido(self):
        resposta = self.client.post(
            f'/api/feedback/{self.pedido.token}/',
            {'valores': resposta_valida(
                self.pedido.formulario.campos, 'ficou ótimo')},
            content_type='application/json',
        )

        self.assertEqual(resposta.status_code, 201)
        self.card_feedback.refresh_from_db()
        self.assertEqual(self.card_feedback.status, EstadoPedido.RESPONDIDO)

    def test_divergencia_existente_e_reconvergida_pela_varredura(self):
        """O buraco que a fase 1 deixou aberto — e a rede que a fase 2 pôs embaixo.

        O cenário montado à mão é EXATAMENTE o resíduo de um hook que falhou num
        deploy anterior: pedido promovido, card parado na coluna antiga, e nenhum
        caminho que tentasse de novo (o estado já saiu do valor que a varredura
        procura, então o pedido nem entra mais na fila de promoção).
        """
        PedidoFeedback.objects.filter(pk=self.pedido.pk).update(
            estado=EstadoPedido.AGUARDANDO_RESPOSTA)
        self.card_feedback.refresh_from_db()
        self.assertEqual(self.card_feedback.status, EstadoPedido.AGUARDANDO_PRAZO)

        liberar_pedidos_no_prazo()

        self.card_feedback.refresh_from_db()
        self.assertEqual(self.card_feedback.status, EstadoPedido.AGUARDANDO_RESPOSTA)

    def test_hook_quebrado_nao_deixa_divergencia_ao_fim_da_varredura(self):
        """Com o hook explodindo, a promoção acontece e o card AINDA assim chega
        na coluna certa — porque a reconciliação roda no fim da MESMA varredura."""
        PedidoFeedback.objects.filter(pk=self.pedido.pk).update(
            data_referencia=timezone.localdate() - dt.timedelta(days=30))

        with mock.patch(
            'apps.feedbacks.tasks.notificar_transicao',
            side_effect=RuntimeError('kanban fora do ar'),
        ) as hook:
            resultado = liberar_pedidos_no_prazo()

        hook.assert_called_once()
        # O UPDATE do estado é commitado ANTES do hook: a falha não o desfaz.
        self.assertEqual(
            PedidoFeedback.objects.get(pk=self.pedido.pk).estado,
            EstadoPedido.AGUARDANDO_RESPOSTA,
        )
        self.assertEqual(resultado['reconciliados'], 1)
        self.card_feedback.refresh_from_db()
        self.assertEqual(self.card_feedback.status, EstadoPedido.AGUARDANDO_RESPOSTA)

    def test_reconciliacao_nao_encosta_em_card_comum(self):
        Card.objects.filter(pk=self.card_comum.pk).update(status='em_desenvolvimento')

        liberar_pedidos_no_prazo()

        self.card_comum.refresh_from_db()
        self.assertEqual(self.card_comum.status, 'em_desenvolvimento')


# =========================================================================== #
# 8. SETOR — COM A FLAG LIGADA (hoje o erro seria DORMENTE)
# =========================================================================== #
@override_settings(SETOR_SCOPING_ENABLED=True)
class EscopoPorSetorTests(BaseFase2):

    def setUp(self):
        super().setUp()
        self.entregar()
        self.card_feedback = self.cards_de_monitoramento().get()

        self.de_dentro = self._usuario('quem_entregou', self.setor)
        outro_setor = SetorCatalogo.objects.create(codename='fin', nome='Financeiro')
        self.de_fora = self._usuario('terceiro', outro_setor)

    def _usuario(self, username, setor):
        user = User.objects.create_user(username=username, password='x' * 12)
        user.user_permissions.add(Permission.objects.get(codename='view_content'))
        UserSetor.objects.create(user=user, setor=setor, is_primary=True)
        return User.objects.get(pk=user.pk)

    def test_o_card_de_feedback_e_compartilhado_com_o_setor_que_entregou(self):
        vinculo = CardCompartilhamento.objects.get(card=self.card_feedback)
        self.assertEqual(vinculo.setor_id, self.setor.pk)
        self.assertEqual(vinculo.nivel, NivelCompartilhamento.LEITURA)

    def test_quem_entregou_ve_o_card_e_pega_o_link(self):
        self.client.force_login(self.de_dentro)

        resposta = self.client.get(f'/api/feedbacks/pedidos/?card={self.card_feedback.pk}')

        self.assertEqual(resposta.status_code, 200)
        corpo = resposta.json()
        itens = corpo['results'] if isinstance(corpo, dict) and 'results' in corpo else corpo
        self.assertEqual(len(itens), 1)
        self.assertIn('/feedback/', itens[0]['url_publica'])

    def test_um_terceiro_setor_nao_ve_o_card_nem_o_link(self):
        self.client.force_login(self.de_fora)

        resposta = self.client.get(f'/api/feedbacks/pedidos/?card={self.card_feedback.pk}')

        corpo = resposta.json()
        itens = corpo['results'] if isinstance(corpo, dict) and 'results' in corpo else corpo
        self.assertEqual(itens, [])

    def test_o_card_de_feedback_nao_cai_no_setor_de_ninguem_por_heranca(self):
        """O projeto de monitoramento mora no setor TÉCNICO do fluxo.

        Era `sem_setor` até a verificação de escopo mostrar que aquele setor É
        de alguém — de todo usuário ainda não classificado. Ver
        `tests_escopo_fase2.py` e o comentário de `SETOR_MONITORAMENTO_CODENAME`.
        """
        self.assertNotEqual(self.card_feedback.setor_id, self.setor.pk)
        self.assertEqual(
            self.card_feedback.setor_id, self.projeto_monitoramento().setor_id)


# =========================================================================== #
# 9. O CONTRATO COM `apps.projects` (as duas cordas que não podem arrebentar)
# =========================================================================== #
class ContratoComProjectsTests(BaseFase2):

    def test_o_valor_de_finalizado_usado_no_signal_e_o_do_enum(self):
        """O signal escreve 'finalizado' à mão para não importar apps.projects.

        Esta é a corda que arrebenta em silêncio: se `CardStatus.FINALIZADO`
        mudar de valor, o signal simplesmente para de disparar e NADA acusa —
        nenhum erro, só formulários que deixam de ser gerados.
        """
        from apps.projects.models import CardStatus

        from .signals import STATUS_FINALIZADO

        self.assertEqual(STATUS_FINALIZADO, CardStatus.FINALIZADO.value)

    def test_as_keys_das_etapas_cabem_em_card_status(self):
        """`Card.status` é max_length=20 e 'aguardando_resposta' tem 19."""
        limite = Card._meta.get_field('status').max_length
        for key in EstadoPedido.values:
            self.assertLessEqual(len(key), limite, key)

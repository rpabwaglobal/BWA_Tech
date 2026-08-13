"""
Testes PONTA A PONTA da fase 2 — o fluxo inteiro pelos caminhos do produto.

`tests_fase2.py` prova as PEÇAS (o signal, o seed, a task, o serializer). Aqui a
pergunta é outra e mais crua: uma pessoa sentada na tela, usando só a API que o
frontend usa, consegue percorrer o caminho todo — marcar o checkbox, entregar o
projeto, achar o link, esperar os 30 dias, receber a resposta — e o sistema fica
íntegro no fim? Por isso quase nada aqui chama função interna: os cards nascem
por `POST /api/cards/`, a entrega é `PATCH /api/projects/<id>/`, a coluna é lida
do `kanban-config` do projeto e a resposta chega pela rota anônima.

QUATRO ESCOLHAS DE MÉTODO, porque mudam o que estes testes provam:

1. A COLUNA É CONFERIDA PELO RÓTULO QUE O BOARD DESENHA, não pelo valor de
   `Card.status`. `_coluna_do_card` resolve o status contra a `kanban-config` do
   projeto e devolve None quando o board NÃO tem aquela coluna. Comparar strings
   de status passaria feliz com o card parado numa coluna que ninguém vê — que é
   exatamente o modo de falha desta feature.

2. O TEMPO ANDA PELA `data_referencia`, e não por mock de relógio. É o mesmo
   fato que a varredura lê (`data_referencia__lte=hoje - 30`), então o teste
   exercita a aritmética real da task, inclusive a BORDA: 29 dias não promove,
   30 promove.

3. O CARD ORIGINAL É COMPARADO CAMPO A CAMPO — TODOS eles, via `.values()`, e
   não uma lista escolhida a dedo. "Não foi tocado" é requisito literal do
   usuário; uma lista curta não pegaria um campo que só amanhã passe a ser
   alterado.

4. `captureOnCommitCallbacks(execute=True)` envolve TODA entrega. O signal agenda
   a geração em `transaction.on_commit` e o `TestCase` nunca comita: sem isso o
   callback jamais rodaria e a suíte inteira passaria por engano.

NÃO EXISTE E-MAIL AQUI, e não é omissão: o link nasce com o pedido e é enviado à
mão por uma pessoa que o copia do card.
"""
from __future__ import annotations

import datetime as dt
from io import StringIO
from unittest import mock

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone

from apps.accounts.models import SetorCatalogo
from apps.projects.models import (
    Card, CardStatus, KanbanStage, Project, ProjectKanbanStageConfig,
    ProjectStatus, Sprint,
)

from ._apoio_testes import chave_de_texto, resposta_valida
from .estrutura import NOME_PROJETO_MONITORAMENTO, garantir_estrutura_monitoramento
from .models import EstadoPedido, PedidoFeedback, RespostaFeedback
from .tasks import liberar_pedidos_no_prazo

User = get_user_model()

# Os rótulos que o usuário pediu, escritos como ele os escreveu. Ficam aqui em
# vez de saírem de `etapas_monitoramento()` de propósito: se alguém renomear a
# etapa no código, o requisito do usuário tem de falhar, não acompanhar.
COLUNA_PRAZO = 'Aguardando 30 dias'
COLUNA_RESPOSTA = 'Aguardando Feedback'
COLUNA_COLHIDO = 'Feedback colhido'
COLUNA_ENCERRADO = 'Feedback Finalizado'

CHAVES_DE_FEEDBACK = [
    'aguardando_prazo', 'aguardando_resposta', 'respondido', 'feedback_encerrado',
]
CHAVES_NORMAIS = [
    'a_desenvolver', 'em_desenvolvimento', 'parado_pendencias',
    'em_homologacao', 'finalizado', 'inviabilizado',
]


class BaseE2E(TestCase):
    """A cadeia real: setor -> sprint -> projeto, com o usuário JÁ LOGADO.

    Nenhum card é criado aqui. Cada teste cria os seus pela API, porque o
    checkbox é a primeira coisa sob teste e criar `Card(...)` no ORM pularia
    justamente o serializer que precisa aceitá-lo.
    """

    def setUp(self):
        cache.clear()
        self.user = User.objects.create_superuser(
            username='entregador', password='x' * 12, email='entregador@example.com',
        )
        self.setor = SetorCatalogo.objects.create(codename='tec', nome='Tecnologia')
        agora = timezone.now()
        self.sprint = Sprint.objects.create(
            nome='Sprint 1', data_inicio=agora,
            fechamento_em=agora + dt.timedelta(days=14), duracao_dias=14,
            supervisor=self.user, setor=self.setor,
        )
        self.projeto = Project.objects.create(nome='Portal do cliente', sprint=self.sprint)
        self.client.force_login(User.objects.get(pk=self.user.pk))

    # --- os caminhos do produto -------------------------------------------

    def criar_card(self, nome, *, gerar_formulario=False) -> Card:
        """`POST /api/cards/` — o mesmo caminho do botão "Novo Card"."""
        resposta = self.client.post(
            '/api/cards/',
            {
                'nome': nome,
                'projeto': self.projeto.pk,
                'gerar_formulario_feedback': gerar_formulario,
            },
            content_type='application/json',
        )
        self.assertEqual(resposta.status_code, 201, resposta.content)
        return Card.objects.get(pk=resposta.json()['id'])

    def mudar_status_do_projeto(self, novo_status):
        """`PATCH /api/projects/<id>/` — o seletor de status da tela.

        O `captureOnCommitCallbacks` não é detalhe de teste: é o que faz o
        callback de `on_commit` do signal rodar, como rodaria numa requisição de
        verdade que comita.
        """
        with self.captureOnCommitCallbacks(execute=True):
            resposta = self.client.patch(
                f'/api/projects/{self.projeto.pk}/',
                {'status': novo_status},
                content_type='application/json',
            )
        self.assertEqual(resposta.status_code, 200, resposta.content)
        return resposta

    def entregar(self):
        # Ver `_finalizar_marcados`: o gatilho é o CARD finalizado, não o status
        # do projeto. O status continua sendo gravado porque há testes que o
        # afirmam.
        resposta = self.mudar_status_do_projeto(ProjectStatus.ENTREGUE)
        self._finalizar_marcados()
        return resposta

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


    # --- leitura pelo mesmo lugar que a tela lê -----------------------------

    def board(self, project_id) -> list[dict]:
        resposta = self.client.get(f'/api/projects/{project_id}/kanban-config/')
        self.assertEqual(resposta.status_code, 200, resposta.content)
        return resposta.json()['stages']

    def coluna_do_card(self, card_id) -> str | None:
        """O RÓTULO da coluna onde o card aparece — None se o board não a desenha.

        Devolver None em vez de levantar é proposital: "o card está numa coluna
        que não existe no quadro" é um resultado possível do sistema, e é ele
        que os testes precisam poder recusar explicitamente.
        """
        card = Card.objects.get(pk=card_id)
        for etapa in self.board(card.projeto_id):
            if etapa['key'] == card.status:
                return etapa['label']
        return None

    def monitoramento(self) -> Project:
        return Project.objects.get(nome=NOME_PROJETO_MONITORAMENTO)

    def cards_de_monitoramento(self):
        return Card.objects.filter(projeto=self.monitoramento())

    def link_do_card(self, card_id):
        """`GET /api/feedbacks/pedidos/?card=<id>` — de onde o botão Copiar tira o link."""
        resposta = self.client.get(f'/api/feedbacks/pedidos/?card={card_id}')
        self.assertEqual(resposta.status_code, 200, resposta.content)
        corpo = resposta.json()
        itens = corpo['results'] if isinstance(corpo, dict) and 'results' in corpo else corpo
        return itens[0]['url_publica'] if itens else None

    def envelhecer(self, dias):
        """Recua a `data_referencia` de todos os pedidos — o tempo passando.

        Mexer no FATO que a varredura lê, em vez de no relógio, mantém a
        aritmética de data local da task sob teste em vez de mockada.
        """
        for pedido in PedidoFeedback.objects.all():
            PedidoFeedback.objects.filter(pk=pedido.pk).update(
                data_referencia=pedido.data_referencia - dt.timedelta(days=dias))


# =========================================================================== #
# O CAMINHO INTEIRO, DE UMA PONTA A OUTRA
# =========================================================================== #
class FluxoCompletoTests(BaseE2E):
    """Um teste só, percorrendo a feature do checkbox até o feedback colhido.

    Os testes seguintes recortam cada etapa com asserções mais duras. Este existe
    porque a soma das etapas não é a mesma coisa que a jornada: é aqui que um
    acoplamento errado entre duas etapas certas apareceria.
    """

    def test_do_checkbox_ao_feedback_colhido(self):
        marcado = self.criar_card('Tela de login', gerar_formulario=True)
        comum = self.criar_card('Refatorar CSS')

        # 1. Entrega -> nasce UM card de feedback, só do card marcado.
        self.entregar()
        self.assertEqual(self.cards_de_monitoramento().count(), 1)
        card_feedback = self.cards_de_monitoramento().get()
        self.assertFalse(PedidoFeedback.objects.filter(card_id=comum.pk).exists())

        # 2. Ele nasce na primeira coluna e o link JÁ funciona (o envio é manual,
        #    então não há por que segurar o link até os 30 dias).
        self.assertEqual(self.coluna_do_card(card_feedback.pk), COLUNA_PRAZO)
        link = self.link_do_card(card_feedback.pk)
        token = link.rsplit('/', 1)[-1]
        self.assertEqual(self.client.get(f'/api/feedback/{token}/').status_code, 200)

        # 3. Passam os 30 dias: a varredura promove e o CARD MUDA DE COLUNA.
        self.envelhecer(30)
        liberar_pedidos_no_prazo()
        self.assertEqual(self.coluna_do_card(card_feedback.pk), COLUNA_RESPOSTA)

        # 4. O cliente responde pela rota anônima (sem login, sem sessão).
        self.client.logout()
        pedido = PedidoFeedback.objects.get(token=token)
        resposta = self.client.post(
            f'/api/feedback/{token}/',
            {'valores': resposta_valida(
                pedido.formulario.campos, 'entrega ficou ótima')},
            content_type='application/json',
        )
        self.assertEqual(resposta.status_code, 201, resposta.content)

        # 5. E o card chega na última coluna.
        self.client.force_login(User.objects.get(pk=self.user.pk))
        self.assertEqual(self.coluna_do_card(card_feedback.pk), COLUNA_COLHIDO)

        # 6. O card ORIGINAL continua no projeto dele. O status É 'finalizado':
        #    foi arrastar para lá que disparou tudo isto. O que se afirma aqui é
        #    que o fluxo de feedback não o sequestrou para o board de
        #    monitoramento no meio do caminho.
        marcado.refresh_from_db()
        self.assertEqual(marcado.projeto_id, self.projeto.pk)
        self.assertEqual(marcado.status, CardStatus.FINALIZADO)


# =========================================================================== #
# 1. CARDINALIDADE: 2 MARCADOS + 1 NÃO MARCADO = 2 CARDS E 2 PEDIDOS
# =========================================================================== #
class CardinalidadeDaEntregaTests(BaseE2E):

    def setUp(self):
        super().setUp()
        self.marcado_a = self.criar_card('Tela de login', gerar_formulario=True)
        self.marcado_b = self.criar_card('Relatório mensal', gerar_formulario=True)
        self.comum = self.criar_card('Refatorar CSS')

    def test_nascem_exatamente_dois_cards_e_dois_pedidos(self):
        self.entregar()

        self.assertEqual(PedidoFeedback.objects.count(), 2)
        self.assertEqual(self.cards_de_monitoramento().count(), 2)
        self.assertEqual(
            set(PedidoFeedback.objects.values_list('card_id', flat=True)),
            {self.marcado_a.pk, self.marcado_b.pk},
        )

    def test_o_card_nao_marcado_nao_gera_nada(self):
        self.entregar()

        self.assertFalse(PedidoFeedback.objects.filter(card_id=self.comum.pk).exists())
        # E nenhum card de monitoramento carrega o nome dele.
        self.assertNotIn(
            self.comum.nome,
            list(self.cards_de_monitoramento().values_list('nome', flat=True)),
        )

    def test_cada_pedido_tem_o_seu_proprio_link(self):
        """UM formulário POR CARD MARCADO: dois cards, dois tokens diferentes."""
        self.entregar()

        tokens = set(PedidoFeedback.objects.values_list('token', flat=True))
        self.assertEqual(len(tokens), 2)
        links = {
            self.link_do_card(self.marcado_a.pk),
            self.link_do_card(self.marcado_b.pk),
        }
        self.assertEqual(len(links), 2)
        self.assertNotIn(None, links)

    def test_o_checkbox_e_opcional_e_nasce_desmarcado(self):
        """O requisito é "campo OPCIONAL marcável" — omiti-lo não pode dar 400."""
        resposta = self.client.post(
            '/api/cards/',
            {'nome': 'Sem opinião', 'projeto': self.projeto.pk},
            content_type='application/json',
        )
        self.assertEqual(resposta.status_code, 201, resposta.content)
        self.assertFalse(resposta.json()['gerar_formulario_feedback'])


# =========================================================================== #
# 2. O CARD ORIGINAL FICA INTACTO — CAMPO A CAMPO
# =========================================================================== #
class CardOriginalIntactoTests(BaseE2E):

    def setUp(self):
        super().setUp()
        self.marcado = self.criar_card('Tela de login', gerar_formulario=True)

    def _retrato(self, card_id) -> dict:
        """TODAS as colunas concretas do card, e não uma lista escolhida a dedo."""
        return Card.objects.values().get(pk=card_id)

    def test_o_fluxo_nao_mexe_em_nenhuma_coluna_alem_das_da_propria_entrega(self):
        """COMPARAÇÃO PAREADA, e continua sendo campo a campo.

        "O card não é tocado" deixou de poder ser afirmado como "nada muda":
        finalizar o card É a entrega, e a própria finalização grava `status`,
        `finalizado_em`, `updated_at` e as métricas de tempo. Listar essas
        colunas à mão para ignorá-las traria de volta exatamente a fragilidade
        que o `values()` existe para evitar — a lista envelheceria calada.

        Então a pergunta é feita de outro jeito: um card MARCADO e um card NÃO
        MARCADO são finalizados do mesmo jeito, e se compara o CONJUNTO DE
        COLUNAS QUE MUDOU em cada um. Se o fluxo de feedback encostasse no card
        de quem entregou, o marcado teria alguma coluna a mais — qualquer uma,
        inclusive uma que só exista amanhã.
        """
        comum = self.criar_card('Tela de senha')

        antes_marcado = self._retrato(self.marcado.pk)
        antes_comum = self._retrato(comum.pk)

        with self.captureOnCommitCallbacks(execute=True):
            for card in (self.marcado, comum):
                card.status = CardStatus.FINALIZADO
                card.save()

        def mudaram(antes, card_id):
            depois = self._retrato(card_id)
            return {c for c in antes if antes[c] != depois[c]}

        self.assertEqual(
            mudaram(antes_marcado, self.marcado.pk),
            mudaram(antes_comum, comum.pk),
        )
        # E o pareamento só vale se a entrega realmente aconteceu.
        self.assertEqual(PedidoFeedback.objects.count(), 1)

    def test_o_card_original_continua_no_mesmo_projeto_e_na_mesma_sprint(self):
        """Requisito literal: "o card entregue do projeto continua lá"."""
        self.entregar()

        self.marcado.refresh_from_db()
        self.assertEqual(self.marcado.projeto_id, self.projeto.pk)
        self.assertEqual(
            Project.objects.values_list('sprint_id', flat=True).get(pk=self.projeto.pk),
            self.sprint.pk,
        )
        # E o card de feedback é OUTRO card, num OUTRO projeto.
        card_feedback = self.cards_de_monitoramento().get()
        self.assertNotEqual(card_feedback.pk, self.marcado.pk)
        self.assertNotEqual(card_feedback.projeto_id, self.projeto.pk)

    def test_o_card_original_continua_no_board_do_projeto_dele(self):
        """Se ele tivesse ido para o fluxo de feedback, sumiria do quadro.

        A coluna esperada não é escrita à mão: o que importa é que
        `coluna_do_card` RESOLVE (o board do projeto dele conhece o status) e
        que a coluna não é nenhuma das do fluxo de feedback. `coluna_do_card`
        devolve None quando o board não tem a coluna — é assim que um card
        sequestrado apareceria aqui.
        """
        self.entregar()

        coluna = self.coluna_do_card(self.marcado.pk)
        self.assertIsNotNone(coluna)
        self.assertNotIn(
            coluna, {COLUNA_PRAZO, COLUNA_RESPOSTA, COLUNA_COLHIDO, COLUNA_ENCERRADO})

    def test_o_projeto_de_monitoramento_nao_rouba_o_card_marcado(self):
        self.entregar()

        self.assertNotIn(
            self.marcado.pk,
            list(self.cards_de_monitoramento().values_list('pk', flat=True)),
        )


# =========================================================================== #
# 3. O CARD DE FEEDBACK NASCE EM "AGUARDANDO 30 DIAS" E JÁ COM LINK
# =========================================================================== #
class NascimentoDoCardDeFeedbackTests(BaseE2E):

    def setUp(self):
        super().setUp()
        self.marcado = self.criar_card('Tela de login', gerar_formulario=True)
        self.entregar()
        self.pedido = PedidoFeedback.objects.get()
        self.card_feedback = Card.objects.get(pk=self.pedido.card_kanban_id)

    def test_nasce_na_primeira_coluna_do_fluxo(self):
        self.assertEqual(self.coluna_do_card(self.card_feedback.pk), COLUNA_PRAZO)
        self.assertEqual(self.pedido.estado, EstadoPedido.AGUARDANDO_PRAZO)

    def test_o_link_ja_existe_no_instante_do_nascimento(self):
        self.assertTrue(self.pedido.token)
        link = self.link_do_card(self.card_feedback.pk)
        self.assertIsNotNone(link)
        self.assertTrue(link.endswith(f'/feedback/{self.pedido.token}'))

    def test_o_link_ja_abre_antes_dos_trinta_dias(self):
        """O envio é MANUAL: segurar o link até o prazo não serviria a ninguém."""
        resposta = self.client.get(f'/api/feedback/{self.pedido.token}/')

        self.assertEqual(resposta.status_code, 200)
        self.assertEqual(resposta.json()['referencia'], self.marcado.nome)

    def test_o_link_e_alcancavel_tambem_pelo_card_original(self):
        """Quem entregou está olhando o card DELE, não o do fluxo interno."""
        self.assertEqual(
            self.link_do_card(self.marcado.pk),
            self.link_do_card(self.card_feedback.pk),
        )

    def test_o_card_de_feedback_e_um_lembrete_sem_dono_e_sem_prazo(self):
        self.assertIsNone(self.card_feedback.responsavel_id)
        self.assertIsNone(self.card_feedback.data_fim)
        self.assertIsNone(self.card_feedback.data_inicio)

    def test_o_card_de_feedback_nao_pertence_a_sprint_de_trabalho(self):
        """Requisito literal: "esses cards não devem ser atrelados a uma sprint"."""
        self.assertNotEqual(self.card_feedback.projeto.sprint_id, self.sprint.pk)
        self.assertTrue(self.card_feedback.projeto.sprint.is_system)


# =========================================================================== #
# 4. OS 30 DIAS PROMOVEM O CARD DE COLUNA
# =========================================================================== #
class PromocaoAosTrintaDiasTests(BaseE2E):

    def setUp(self):
        super().setUp()
        self.marcado = self.criar_card('Tela de login', gerar_formulario=True)
        self.entregar()
        self.pedido = PedidoFeedback.objects.get()
        self.card_feedback = Card.objects.get(pk=self.pedido.card_kanban_id)

    def test_aos_trinta_dias_o_card_muda_de_coluna(self):
        self.envelhecer(30)

        resultado = liberar_pedidos_no_prazo()

        self.assertEqual(resultado['promovidos'], 1)
        self.assertEqual(resultado['falhas'], 0)
        self.assertEqual(self.coluna_do_card(self.card_feedback.pk), COLUNA_RESPOSTA)
        self.assertEqual(
            PedidoFeedback.objects.get().estado, EstadoPedido.AGUARDANDO_RESPOSTA)

    def test_no_vigesimo_nono_dia_ainda_nao(self):
        """A borda: um dia a menos e o card não sai do lugar."""
        self.envelhecer(29)

        resultado = liberar_pedidos_no_prazo()

        self.assertEqual(resultado['promovidos'], 0)
        self.assertEqual(self.coluna_do_card(self.card_feedback.pk), COLUNA_PRAZO)

    def test_a_varredura_rodada_duas_vezes_nao_promove_duas_vezes(self):
        self.envelhecer(30)

        primeira = liberar_pedidos_no_prazo()
        segunda = liberar_pedidos_no_prazo()

        self.assertEqual(primeira['promovidos'], 1)
        self.assertEqual(segunda['promovidos'], 0)
        self.assertEqual(self.coluna_do_card(self.card_feedback.pk), COLUNA_RESPOSTA)

    def test_a_promocao_nao_encosta_nos_cards_de_trabalho(self):
        comum = self.criar_card('Refatorar CSS')
        self.envelhecer(30)

        liberar_pedidos_no_prazo()

        comum.refresh_from_db()
        self.assertEqual(comum.status, 'a_desenvolver')


# =========================================================================== #
# 5. FORMULÁRIO RESPONDIDO -> "FEEDBACK COLHIDO"
# =========================================================================== #
class RespostaDoFormularioTests(BaseE2E):

    def setUp(self):
        super().setUp()
        self.marcado = self.criar_card('Tela de login', gerar_formulario=True)
        self.entregar()
        self.pedido = PedidoFeedback.objects.get()
        self.card_feedback = Card.objects.get(pk=self.pedido.card_kanban_id)

    def _responder(self, texto='ficou ótimo'):
        """Payload derivado da definicao ativa - ver `_apoio_testes`."""
        return self.client.post(
            f'/api/feedback/{self.pedido.token}/',
            {'valores': resposta_valida(self.pedido.formulario.campos, texto)},
            content_type='application/json',
        )

    def test_responder_move_o_card_para_feedback_colhido(self):
        self.envelhecer(30)
        liberar_pedidos_no_prazo()

        self.assertEqual(self._responder().status_code, 201)

        self.assertEqual(self.coluna_do_card(self.card_feedback.pk), COLUNA_COLHIDO)
        self.assertEqual(PedidoFeedback.objects.get().estado, EstadoPedido.RESPONDIDO)

    def test_responder_antes_dos_trinta_dias_pula_direto_para_a_ultima_coluna(self):
        """O link nasce válido; quem responde cedo não fica preso no meio."""
        self.assertEqual(self._responder().status_code, 201)

        self.assertEqual(self.coluna_do_card(self.card_feedback.pk), COLUNA_COLHIDO)

    def test_a_resposta_fica_gravada_e_o_link_continua_valendo(self):
        """A afirmação INVERTIDA da de antes, com a mesma força.

        O teste dizia "o link fecha" e conferia que o 2º POST devolvia 404. O
        pedido do usuário é o oposto: "mais de um usuário deve poder responder o
        feedback, o link do formulário não deve expirar". Então a regra que este
        teste trava agora é que a segunda pessoa é ACEITA e que a primeira
        resposta NÃO é sobrescrita.
        """
        chave = chave_de_texto(self.pedido.formulario.campos)

        self.assertEqual(self._responder('atendimento rápido').status_code, 201)
        # Outra pessoa, MESMO link.
        self.assertEqual(self._responder('a entrega atrasou').status_code, 201)

        self.assertEqual(RespostaFeedback.objects.count(), 2)
        # Os DOIS textos preservados: nenhuma resposta sobrescreve a outra.
        self.assertEqual(
            {r.valores[chave] for r in RespostaFeedback.objects.all()},
            {'atendimento rápido', 'a entrega atrasou'},
        )

    def test_a_segunda_resposta_nao_remove_o_carimbo_da_primeira(self):
        """O card entra em "Feedback colhido" na PRIMEIRA e FICA lá.

        `respondido_em` é o corte da retenção do dado pessoal. Se a 2ª resposta o
        movesse, um anônimo com o link reiniciaria esse prazo indefinidamente —
        e a coluna seria reescrita a cada envio.
        """
        self._responder('primeira')
        pedido = PedidoFeedback.objects.get()
        carimbo = pedido.respondido_em

        self._responder('segunda')

        pedido.refresh_from_db()
        self.assertEqual(pedido.estado, EstadoPedido.RESPONDIDO)
        self.assertEqual(pedido.respondido_em, carimbo)
        self.assertEqual(self.coluna_do_card(self.card_feedback.pk), COLUNA_COLHIDO)

    def test_a_varredura_seguinte_nao_rebaixa_um_card_ja_colhido(self):
        self._responder()

        liberar_pedidos_no_prazo()

        self.assertEqual(self.coluna_do_card(self.card_feedback.pk), COLUNA_COLHIDO)


# =========================================================================== #
# 6. REENTREGA: ENTREGUE -> EM DESENVOLVIMENTO -> ENTREGUE
# =========================================================================== #
class ReentregaPelaApiTests(BaseE2E):

    def setUp(self):
        super().setUp()
        self.marcado_a = self.criar_card('Tela de login', gerar_formulario=True)
        self.marcado_b = self.criar_card('Relatório mensal', gerar_formulario=True)

    def test_entregar_duas_vezes_nao_duplica_card_nem_pedido(self):
        self.entregar()
        tokens = set(PedidoFeedback.objects.values_list('token', flat=True))
        cards = set(self.cards_de_monitoramento().values_list('pk', flat=True))

        self.mudar_status_do_projeto(ProjectStatus.EM_DESENVOLVIMENTO)
        self.entregar()

        self.assertEqual(PedidoFeedback.objects.count(), 2)
        self.assertEqual(self.cards_de_monitoramento().count(), 2)
        # Os MESMOS dois: nem token novo (o link já enviado continua valendo),
        # nem card novo no board.
        self.assertEqual(set(PedidoFeedback.objects.values_list('token', flat=True)), tokens)
        self.assertEqual(set(self.cards_de_monitoramento().values_list('pk', flat=True)), cards)

    def test_tres_idas_e_voltas_continuam_com_dois_cards(self):
        for _ in range(3):
            self.entregar()
            self.mudar_status_do_projeto(ProjectStatus.EM_DESENVOLVIMENTO)
        self.entregar()

        self.assertEqual(PedidoFeedback.objects.count(), 2)
        self.assertEqual(self.cards_de_monitoramento().count(), 2)

    def test_a_reentrega_nao_rebaixa_um_card_ja_promovido(self):
        self.entregar()
        self.envelhecer(30)
        liberar_pedidos_no_prazo()
        card = Card.objects.get(pk=PedidoFeedback.objects.first().card_kanban_id)
        self.assertEqual(self.coluna_do_card(card.pk), COLUNA_RESPOSTA)

        self.mudar_status_do_projeto(ProjectStatus.EM_DESENVOLVIMENTO)
        self.entregar()

        self.assertEqual(self.coluna_do_card(card.pk), COLUNA_RESPOSTA)
        self.assertEqual(self.cards_de_monitoramento().count(), 2)

    def test_marcar_um_card_novo_depois_da_primeira_entrega_gera_o_dele(self):
        """A reentrega não pode ser inerte: card marcado DEPOIS também merece link."""
        self.entregar()
        self.criar_card('Ajuste pedido pelo cliente', gerar_formulario=True)

        self.mudar_status_do_projeto(ProjectStatus.EM_DESENVOLVIMENTO)
        self.entregar()

        self.assertEqual(PedidoFeedback.objects.count(), 3)
        self.assertEqual(self.cards_de_monitoramento().count(), 3)


# =========================================================================== #
# 7. O SEED É IDEMPOTENTE
# =========================================================================== #
class SeedIdempotenteTests(BaseE2E):

    def test_rodar_o_seed_tres_vezes_nao_duplica_nada(self):
        primeiro = garantir_estrutura_monitoramento()
        segundo = garantir_estrutura_monitoramento()
        terceiro = garantir_estrutura_monitoramento()

        self.assertEqual({primeiro.pk, segundo.pk, terceiro.pk}, {primeiro.pk})
        self.assertEqual(Sprint.objects.filter(is_system=True).count(), 1)
        self.assertEqual(Project.objects.filter(nome=NOME_PROJETO_MONITORAMENTO).count(), 1)
        self.assertEqual(
            KanbanStage.objects.filter(key__in=CHAVES_DE_FEEDBACK).count(),
            len(CHAVES_DE_FEEDBACK))
        self.assertEqual(
            ProjectKanbanStageConfig.objects.filter(project=primeiro).count(),
            len(CHAVES_DE_FEEDBACK))

    def test_duas_entregas_de_projetos_diferentes_usam_a_mesma_estrutura(self):
        """O caminho real do seed é a auto-cura na entrega, não uma chamada solta."""
        self.criar_card('Tela de login', gerar_formulario=True)
        self.entregar()

        outro = Project.objects.create(nome='App interno', sprint=self.sprint)
        card = Card.objects.create(
            nome='Push de notificações', projeto=outro, gerar_formulario_feedback=True)
        with self.captureOnCommitCallbacks(execute=True):
            outro.status = ProjectStatus.ENTREGUE
            outro.save()
        # É a finalização do CARD que dispara — ver `_finalizar_marcados`.
        with self.captureOnCommitCallbacks(execute=True):
            card.status = CardStatus.FINALIZADO
            card.save()

        self.assertEqual(Sprint.objects.filter(is_system=True).count(), 1)
        self.assertEqual(Project.objects.filter(nome=NOME_PROJETO_MONITORAMENTO).count(), 1)
        self.assertEqual(self.cards_de_monitoramento().count(), 2)
        self.assertTrue(PedidoFeedback.objects.filter(card_id=card.pk).exists())

    def test_o_board_continua_com_as_colunas_na_ordem_depois_de_reseminar(self):
        projeto = garantir_estrutura_monitoramento()
        garantir_estrutura_monitoramento()

        self.assertEqual(
            [(e['key'], e['label']) for e in self.board(projeto.pk)],
            [
                ('aguardando_prazo', COLUNA_PRAZO),
                ('aguardando_resposta', COLUNA_RESPOSTA),
                ('respondido', COLUNA_COLHIDO),
                ('feedback_encerrado', COLUNA_ENCERRADO),
            ],
        )


# =========================================================================== #
# 8. A SPRINT SISTÊMICA FICA FORA DE TUDO
# =========================================================================== #
class SprintSistemicaForaDeTudoTests(BaseE2E):

    def setUp(self):
        super().setUp()
        self.marcado = self.criar_card('Tela de login', gerar_formulario=True)
        self.entregar()
        self.sistemica = Sprint.objects.get(is_system=True)
        self.card_feedback = self.cards_de_monitoramento().get()

    # --- (a) fora da LISTA de sprints --------------------------------------

    def test_nao_aparece_em_api_sprints(self):
        corpo = self.client.get('/api/sprints/').json()
        itens = corpo['results'] if isinstance(corpo, dict) and 'results' in corpo else corpo

        ids = [s['id'] for s in itens]
        self.assertNotIn(self.sistemica.pk, ids)
        self.assertIn(self.sprint.pk, ids)

    def test_continua_abrindo_no_detail_para_o_atalho_funcionar(self):
        """Sumir da lista não pode virar 404 no atalho da tela de Sprints."""
        resposta = self.client.get(f'/api/sprints/{self.sistemica.pk}/')

        self.assertEqual(resposta.status_code, 200)
        self.assertTrue(resposta.json()['is_system'])

    # --- (b) fora das MÉTRICAS ---------------------------------------------

    def test_nao_entra_no_relatorio_de_metricas(self):
        """`sprints_visiveis()` recorta `is_system` para os seis geradores."""
        from apps.reports.generators.metrics import Report
        from apps.reports.models import ReportJob

        job = ReportJob(user=self.user, type='metrics', format='csv', filters={})
        dados = Report(job).fetch_data()

        nomes = [linha['sprint'] for linha in dados['throughput']]
        self.assertIn(self.sprint.nome, nomes)
        self.assertNotIn(self.sistemica.nome, nomes)
        self.assertEqual(dados['kpis']['sprints'], 1)

    def test_o_card_de_feedback_sai_marcado_como_sistemico_na_rota_de_metricas(self):
        """`/api/cards/metrics/` devolve tudo e marca o que a métrica descarta.

        É o contrato de que a página de Métricas depende para excluí-lo — se o
        flag parasse de vir, o card de feedback entraria nas contas sem avisar.
        """
        corpo = self.client.get('/api/cards/metrics/').json()
        itens = corpo['results'] if isinstance(corpo, dict) and 'results' in corpo else corpo

        por_id = {item['id']: item for item in itens}
        self.assertTrue(por_id[self.card_feedback.pk]['projeto_is_system'])
        self.assertFalse(por_id[self.marcado.pk]['projeto_is_system'])

    def test_nao_conta_como_sprint_em_andamento_do_setor(self):
        """A janela dela é de ~100 anos: sem o recorte, ela seria "a sprint atual"."""
        from apps.projects.services import (
            get_sprint_ids_atribuiveis, outra_sprint_em_andamento,
        )

        self.assertIsNone(outra_sprint_em_andamento(self.sistemica.setor_id))
        self.assertNotIn(self.sistemica.pk, get_sprint_ids_atribuiveis())

    # --- (c) fora do FECHAMENTO AUTOMÁTICO ---------------------------------

    def test_a_varredura_por_data_nao_a_fecha_nem_com_a_data_no_passado(self):
        from apps.projects.tasks import finalizar_sprints_por_data

        Sprint.objects.filter(pk=self.sistemica.pk).update(
            fechamento_em=timezone.now() - dt.timedelta(days=1))

        finalizar_sprints_por_data()

        self.sistemica.refresh_from_db()
        self.assertFalse(self.sistemica.finalizada)

    def test_a_task_de_eta_recusa_fechar_a_sistemica(self):
        from apps.projects.tasks import fechar_sprint_em_hora

        resultado = fechar_sprint_em_hora(
            self.sistemica.pk, self.sistemica.fechamento_em.isoformat())

        self.assertEqual(resultado, 'systemic')
        self.sistemica.refresh_from_db()
        self.assertFalse(self.sistemica.finalizada)

    def test_o_comando_de_deploy_nao_agenda_fechamento_para_a_sistemica(self):
        """`agendar_fechamento_sprints_abertas` roda a cada deploy e varre sprints.

        Um ETA publicado para ela ficaria ~100 anos no broker (e na memória do
        worker, que segura tarefas agendadas) para uma task que só responde
        'systemic'. `Sprint.save()` já não a agenda; este comando é o outro
        caminho que chega no mesmo lugar.
        """
        with mock.patch(
            'apps.projects.tasks.fechar_sprint_em_hora.apply_async'
        ) as publicar:
            call_command('agendar_fechamento_sprints_abertas', stdout=StringIO())

        agendadas = {chamada.kwargs['args'][0] for chamada in publicar.call_args_list}
        self.assertIn(self.sprint.pk, agendadas)
        self.assertNotIn(self.sistemica.pk, agendadas)

    def test_a_sprint_sistemica_nao_fecha_e_a_trava_de_sprint_fechada_nao_pega(self):
        """O ASSUNTO é a sistêmica nunca fechar — não "editar card".

        O teste antigo provava isso indiretamente: PATCH num card de feedback
        devolvia 200, logo a trava de sprint fechada não tinha pegado. Esse
        caminho morreu — o fluxo virou somente-leitura pela API e a recusa hoje é
        403 para todo mundo.

        TROCAR 200 POR 403 DESTRUIRIA O TESTE: o 403 novo vem ANTES da trava e a
        mascararia, então um bug que fechasse a sistêmica passaria despercebido
        exatamente aqui. Por isso o assunto original é afirmado DIRETAMENTE (a
        sprint continua aberta, e `_card_edicao_restrita` é False), e o 403 é
        conferido com a MENSAGEM, para provar que a recusa é a de somente-leitura
        e não a de "sprints finalizadas".
        """
        from apps.projects.tasks import finalizar_sprints_por_data
        from apps.projects.views import (
            FEEDBACK_SOMENTE_LEITURA, _card_edicao_restrita,
        )

        # (1) NO ESTADO NORMAL a trava de sprint fechada não pega o card. Esta
        #     asserção roda ANTES de mexer na data de propósito:
        #     `_sprint_efetivamente_fechada` considera fechada também a sprint
        #     cujo `fechamento_em` já passou, então empurrar a data para o
        #     passado tornaria o card restrito por uma razão legítima e a
        #     asserção diria outra coisa.
        self.assertFalse(_card_edicao_restrita(self.card_feedback))

        # (2) A DATA VAI PARA O PASSADO e a varredura roda. Sem empurrar a data,
        #     a varredura não teria motivo para fechar sprint nenhuma e a
        #     asserção passaria por vacuidade — verde tanto com a proteção
        #     quanto sem ela (medido: mutação confirmada).
        Sprint.objects.filter(pk=self.sistemica.pk).update(
            fechamento_em=timezone.now() - dt.timedelta(days=1))

        finalizar_sprints_por_data()

        self.sistemica.refresh_from_db()
        self.assertFalse(self.sistemica.finalizada)

        # (3) A recusa que sobra é a de somente-leitura do fluxo.
        resposta = self.client.patch(
            f'/api/cards/{self.card_feedback.pk}/',
            {'card_comment': 'liguei para o cliente'},
            content_type='application/json',
        )
        self.assertEqual(resposta.status_code, 403, resposta.content)
        self.assertEqual(resposta.json()['detail'], FEEDBACK_SOMENTE_LEITURA)

    # --- (d) fora da REPLICAÇÃO --------------------------------------------

    def test_nao_e_destino_da_replicacao_de_uma_sprint_que_fecha(self):
        """Se fosse, finalizar uma sprint despejaria projetos dentro do fluxo."""
        from apps.projects.services import get_proxima_sprint

        no_mesmo_setor = Sprint.objects.create(
            nome='Sprint do sem-setor', data_inicio=timezone.now(),
            fechamento_em=timezone.now() + dt.timedelta(days=1), duracao_dias=1,
            supervisor=self.user, setor=self.sistemica.setor,
        )

        self.assertIsNone(get_proxima_sprint(no_mesmo_setor))

    def test_nao_impede_a_criacao_de_sprint_no_setor_onde_ela_mora(self):
        """A janela dela cruza qualquer outra; sem o recorte o setor travaria."""
        agora = timezone.now()
        resposta = self.client.post(
            '/api/sprints/',
            {
                'nome': 'Sprint nova',
                'data_inicio': agora.isoformat(),
                'fechamento_em': (agora + dt.timedelta(days=7)).isoformat(),
                'duracao_dias': 7,
                'supervisor': self.user.pk,
                # `setor` é endereçado por CODENAME no serializer, não por id.
                'setor': self.sistemica.setor.codename,
            },
            content_type='application/json',
        )

        self.assertEqual(resposta.status_code, 201, resposta.content)


# =========================================================================== #
# 9. AS 3 ETAPAS NÃO VAZAM PARA UM PROJETO NORMAL
# =========================================================================== #
class EtapasNaoVazamTests(BaseE2E):

    def setUp(self):
        super().setUp()
        self.comum = self.criar_card('Refatorar CSS')
        self.criar_card('Tela de login', gerar_formulario=True)
        self.entregar()

    def test_o_board_do_projeto_normal_continua_com_as_seis_colunas(self):
        keys = [e['key'] for e in self.board(self.projeto.pk)]

        self.assertEqual(sorted(keys), sorted(CHAVES_NORMAIS))
        self.assertEqual(set(keys) & set(CHAVES_DE_FEEDBACK), set())

    def test_o_bundle_da_sprint_separa_o_fluxo_de_feedback_dos_projetos_normais(self):
        """Outro caminho, outra pré-população de config — o mesmo recorte tem de valer.

        POR QUE O TESTE MUDOU: o bundle passou a incluir, DE PROPÓSITO, o projeto
        de monitoramento (a página da sprint o desenha fixado como primeira
        coluna — é pedido do usuário). O teste iterava `kanban_configs.values()`
        indistintamente, então o projeto sistêmico entrava no laço e as 3 chaves
        apareciam. Não há vazamento: elas aparecem SÓ sob ele.

        Em vez de afrouxar, o teste passou a afirmar DUAS coisas — nenhum projeto
        NÃO-sistêmico desenha chave de feedback, e o de monitoramento desenha
        EXATAMENTE as três. Fica mais forte do que era.
        """
        resposta = self.client.get(f'/api/sprints/{self.sprint.pk}/bundle/')

        self.assertEqual(resposta.status_code, 200, resposta.content)
        corpo = resposta.json()

        # O par de flags é a identidade oficial do fluxo (a mesma regra de
        # `_projeto_do_fluxo_de_feedback` e de `isProjetoMonitoramento`).
        sistemicos = {
            str(p['id']) for p in corpo['projects']
            if p.get('is_system') and (p.get('sprint_detail') or {}).get('is_system')
        }
        self.assertEqual(len(sistemicos), 1, corpo['projects'])

        normais = 0
        for project_id, configs in corpo['kanban_configs'].items():
            keys = {c['key'] for c in configs}
            if str(project_id) in sistemicos:
                self.assertEqual(keys, set(CHAVES_DE_FEEDBACK))
            else:
                normais += 1
                self.assertEqual(keys & set(CHAVES_DE_FEEDBACK), set())
        # Sem isto, um bundle que parasse de trazer projeto normal nenhum
        # passaria por vacuidade.
        self.assertGreaterEqual(normais, 1)

    def test_o_catalogo_global_de_etapas_nao_oferece_as_tres(self):
        corpo = self.client.get('/api/kanban-stages/').json()
        itens = corpo['results'] if isinstance(corpo, dict) and 'results' in corpo else corpo

        keys = {item['key'] for item in itens}
        self.assertTrue(keys.issuperset(CHAVES_NORMAIS))
        self.assertEqual(keys & set(CHAVES_DE_FEEDBACK), set())

    def test_um_projeto_criado_depois_do_seed_nasce_com_as_seis_colunas(self):
        """A ordem importa: as 3 etapas já existem no banco quando ele nasce."""
        novo = Project.objects.create(nome='Projeto novo', sprint=self.sprint)

        keys = [e['key'] for e in self.board(novo.pk)]

        self.assertEqual(sorted(keys), sorted(CHAVES_NORMAIS))

    def test_nao_da_para_acrescentar_coluna_de_feedback_a_um_projeto_normal(self):
        """O furo que sobrava: tirar a etapa do CATÁLOGO só a escondia da tela.

        `POST kanban-config/add` aceitava qualquer key existente, e uma vez
        configurada no projeto ela vira status legítimo para
        `_validar_status_no_board` — ou seja, o board comum ganharia a coluna E o
        card comum passaria a poder entrar nela.
        """
        resposta = self.client.post(
            f'/api/projects/{self.projeto.pk}/kanban-config/add/',
            {'stage_key': 'aguardando_prazo'},
            content_type='application/json',
        )

        self.assertEqual(resposta.status_code, 400, resposta.content)
        self.assertNotIn('aguardando_prazo', [e['key'] for e in self.board(self.projeto.pk)])
        # A consequência que de fato importa: o card comum continua recusado.
        mover = self.client.patch(
            f'/api/cards/{self.comum.pk}/',
            {'status': 'aguardando_prazo'},
            content_type='application/json',
        )
        self.assertEqual(mover.status_code, 400)
        self.comum.refresh_from_db()
        self.assertEqual(self.comum.status, 'a_desenvolver')

    def test_nao_da_para_acrescentar_coluna_de_trabalho_ao_board_de_monitoramento(self):
        """O mesmo furo espelhado: uma coluna que nenhum estado de pedido produz."""
        monitoramento = self.monitoramento()

        resposta = self.client.post(
            f'/api/projects/{monitoramento.pk}/kanban-config/add/',
            {'stage_key': 'em_desenvolvimento'},
            content_type='application/json',
        )

        self.assertEqual(resposta.status_code, 400, resposta.content)
        self.assertEqual(
            [e['key'] for e in self.board(monitoramento.pk)], CHAVES_DE_FEEDBACK)

    def test_projeto_normal_continua_aceitando_coluna_normal(self):
        """A guarda não pode estrangular a configuração legítima do board."""
        ProjectKanbanStageConfig.objects.filter(
            project=self.projeto, stage__key='parado_pendencias').delete()

        resposta = self.client.post(
            f'/api/projects/{self.projeto.pk}/kanban-config/add/',
            {'stage_key': 'parado_pendencias'},
            content_type='application/json',
        )

        self.assertEqual(resposta.status_code, 200, resposta.content)
        self.assertIn('parado_pendencias', [e['key'] for e in self.board(self.projeto.pk)])


# =========================================================================== #
# O RASTRO DE AUDITORIA DO CARD QUE O SISTEMA CRIA
# =========================================================================== #
class AutoriaDoCardDeFeedbackTests(BaseE2E):
    """Quem "criou" o card de monitoramento? NINGUÉM — foi o fluxo.

    Este bloco existe por causa de um defeito que só apareceu quando os cards
    passaram a ser criados pela API nestes testes: `CardSerializer.create`
    guardava o usuário da requisição num `threading.local` e nunca o limpava.
    `threading.local` vive na THREAD, e o servidor reaproveita threads entre
    requisições — então a próxima criação de card que NÃO passasse pelo
    serializer (esta aqui, a replicação de sprint, a aprovação de sugestão)
    lia o valor do dono anterior e assinava o CardLog com ele.

    O card de feedback é o caso mais claro: ele nasce de um `Card.objects.create`
    dentro do `on_commit` da entrega, e creditar sua criação a uma pessoa é
    escrever no histórico algo que não aconteceu.
    """

    def test_criar_card_pela_api_nao_deixa_usuario_pendurado_na_thread(self):
        """A causa, medida direto: depois da requisição a thread fica LIMPA."""
        from apps.projects import signals

        self.criar_card('Tela de login', gerar_formulario=True)

        self.assertFalse(
            hasattr(signals._thread_locals, 'user'),
            'O usuário da requisição ficou preso na thread e será lido pela '
            'próxima criação de card que não passar pelo serializer.')

    def test_o_card_de_feedback_nao_e_creditado_a_quem_criou_outro_card(self):
        from apps.projects.models import CardLog, CardLogEventType

        # Pessoa A cria o card marcado pela tela.
        self.criar_card('Tela de login', gerar_formulario=True)

        # Pessoa B (outra conta, mesma thread do processo) faz a entrega.
        outra = User.objects.create_superuser(
            username='gerente', password='x' * 12, email='gerente@example.com')
        self.client.force_login(User.objects.get(pk=outra.pk))
        self.entregar()

        card_feedback = self.cards_de_monitoramento().get()
        log = CardLog.objects.get(
            card=card_feedback, tipo_evento=CardLogEventType.CRIADO)
        self.assertIsNone(
            log.usuario_id,
            'O card de monitoramento é criado pelo fluxo: nenhum usuário pode '
            'aparecer como autor dele.')


# =========================================================================== #
# 10. `data_entrega` NULA — O ESTADO REAL DA TELA
# =========================================================================== #
class DataEntregaNulaTests(BaseE2E):
    """NINGUÉM preenche `Project.data_entrega`: nem o backend nem a tela.

    Ou seja, o caminho NORMAL da feature é justamente este. Sem o fallback, o
    motor levantaria `ValueError` e a feature ficaria inerte em silêncio.
    """

    def setUp(self):
        super().setUp()
        self.marcado = self.criar_card('Tela de login', gerar_formulario=True)

    def test_entregar_sem_data_de_entrega_devolve_200_e_gera_o_pedido(self):
        self.assertIsNone(self.projeto.data_entrega)

        self.entregar()

        self.projeto.refresh_from_db()
        self.assertEqual(self.projeto.status, ProjectStatus.ENTREGUE)
        self.assertEqual(PedidoFeedback.objects.count(), 1)
        self.assertEqual(
            PedidoFeedback.objects.get().data_referencia, timezone.localdate())

    def test_a_contagem_passa_a_valer_a_partir_de_hoje(self):
        """O fallback não é só "não quebrar": ele define QUANDO o card promove."""
        self.entregar()

        self.envelhecer(29)
        self.assertEqual(liberar_pedidos_no_prazo()['promovidos'], 0)
        self.envelhecer(1)
        self.assertEqual(liberar_pedidos_no_prazo()['promovidos'], 1)

    def test_a_varredura_sobrevive_ao_pedido_recem_nascido(self):
        """Nenhuma falha na varredura do mesmo dia — e nada promovido cedo demais."""
        self.entregar()

        resultado = liberar_pedidos_no_prazo()

        self.assertEqual(resultado['falhas'], 0)
        self.assertEqual(resultado['promovidos'], 0)
        self.assertEqual(resultado['reconciliados'], 0)
        card = Card.objects.get(pk=PedidoFeedback.objects.get().card_kanban_id)
        self.assertEqual(self.coluna_do_card(card.pk), COLUNA_PRAZO)

    def test_o_campo_do_usuario_nao_e_preenchido_pelas_nossas_costas(self):
        """`data_entrega` é editável pelo usuário — a feature não escreve nele."""
        self.entregar()

        self.projeto.refresh_from_db()
        self.assertIsNone(self.projeto.data_entrega)

    def test_finalizacao_as_22h30_locais_vale_o_dia_LOCAL(self):
        """22h30 locais já são o dia SEGUINTE em UTC — `dt.date()` daria o dia errado.

        A referência é `Card.finalizado_em`, gravado pelo signal de projects a
        cada transição para "Finalizado". Ele é fixado por `update()` DEPOIS da
        transição porque o signal sobrescreve o campo com `timezone.now()` —
        presetar antes do `save()` seria apagado sem aviso.
        """
        # 2026-08-12 01:30 UTC == 2026-08-11 22:30 em America/Sao_Paulo.
        instante = dt.datetime(2026, 8, 12, 1, 30, tzinfo=dt.timezone.utc)

        marcado = self.criar_card('Tela de login', gerar_formulario=True)
        self.entregar()
        PedidoFeedback.objects.all().delete()
        self.cards_de_monitoramento().delete()
        Card.objects.filter(pk=marcado.pk).update(finalizado_em=instante)

        from .estrutura import gerar_pedido_do_card_finalizado
        gerar_pedido_do_card_finalizado(marcado.pk)

        self.assertEqual(
            PedidoFeedback.objects.get().data_referencia, dt.date(2026, 8, 11))

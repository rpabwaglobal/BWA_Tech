"""
Testes do motor de feedback (fase 1).

Cobrem o que não dá para verificar lendo: a idempotência sob repetição, a
indistinguibilidade das respostas da rota anônima, a validação estrita do JSON
escrito por alguém sem login, e a aritmética de data em fuso LOCAL.
"""
from __future__ import annotations

from datetime import timedelta

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone

from apps.accounts.models import SetorCatalogo
from apps.projects.models import Card, Project, Sprint

from ._apoio_testes import chave_de_texto, resposta_valida
from .models import EstadoPedido, FeedbackFormulario, PedidoFeedback, RespostaFeedback
from .services import criar_pedido_feedback
from .tasks import liberar_pedidos_no_prazo, limpar_respostas_expiradas


def proxima_versao_livre(slug: str = 'padrao') -> int:
    """Primeira `versao` ainda nao usada por `slug`.

    Existe porque cravar o numero (`versao=3`) quebra sozinho toda vez que uma
    migration semeia a versao seguinte do formulario — foi exatamente o que
    aconteceu quando a v3 entrou.
    """
    from django.db.models import Max
    atual = (FeedbackFormulario.objects.filter(slug=slug)
             .aggregate(m=Max('versao'))['m'] or 0)
    return atual + 1

from .throttling import FeedbackTokenThrottle

User = get_user_model()


class BaseFeedbackTestCase(TestCase):
    """Monta a cadeia mínima Sprint -> Project -> Card (setor é NOT NULL)."""

    def setUp(self):
        # O throttle guarda contadores em cache; sem limpar, um teste
        # contaminaria o seguinte.
        cache.clear()
        self.user = User.objects.create_user(username='tester', password='x' * 12)
        self.setor = SetorCatalogo.objects.create(codename='tec', nome='Tecnologia')
        agora = timezone.now()
        self.sprint = Sprint.objects.create(
            nome='Sprint teste', data_inicio=agora,
            fechamento_em=agora + timedelta(days=7), duracao_dias=7,
            supervisor=self.user, setor=self.setor,
        )
        self.projeto = Project.objects.create(nome='Projeto teste', sprint=self.sprint)
        self.card = Card.objects.create(nome='Card marcado', projeto=self.projeto)
        self.card_kanban = Card.objects.create(nome='Card do kanban', projeto=self.projeto)

    def novo_pedido(self, **kwargs):
        defaults = {
            'card_id': self.card.id,
            'data_referencia': timezone.localdate(),
            'referencia_publica': self.card.nome,
        }
        defaults.update(kwargs)
        return criar_pedido_feedback(**defaults)

    def valores(self, pedido, texto: str = 'ok', **sobrescreve) -> dict:
        """Uma resposta ACEITAVEL para a definicao daquele pedido.

        Derivada da definicao, e nao escrita a mao, porque estes testes sao
        sobre o MOTOR (prazo, estado, idempotencia, log) e nao sobre quais
        sao as perguntas. Cravar as chaves aqui fazia trinta testes
        quebrarem a cada troca de versao do formulario, por um motivo que
        nao e o assunto de nenhum deles."""
        return resposta_valida(pedido.formulario.campos, texto, **sobrescreve)

    def chave_livre(self, pedido) -> str:
        """A key do primeiro campo de texto - onde `valores()` poe o texto."""
        return chave_de_texto(pedido.formulario.campos)


class CriacaoTests(BaseFeedbackTestCase):

    def test_cria_com_token_forte_e_estado_inicial(self):
        pedido = self.novo_pedido()
        self.assertEqual(pedido.estado, EstadoPedido.AGUARDANDO_PRAZO)
        # token_urlsafe(32) -> 43 chars. O link nasce junto com o pedido.
        self.assertGreaterEqual(len(pedido.token), 40)
        self.assertIn(pedido.token, pedido.url_publica)
        self.assertIsNone(pedido.respondido_em)

    def test_idempotente_por_card(self):
        primeiro = self.novo_pedido()
        segundo = self.novo_pedido(referencia_publica='outro nome')
        self.assertEqual(primeiro.pk, segundo.pk)
        self.assertEqual(PedidoFeedback.objects.count(), 1)

    def test_cards_diferentes_geram_pedidos_diferentes(self):
        """Cinco cards marcados = cinco pedidos. A dedup é por CARD, não por projeto."""
        um = self.novo_pedido()
        outro = self.novo_pedido(card_id=self.card_kanban.id)
        self.assertNotEqual(um.pk, outro.pk)
        self.assertNotEqual(um.token, outro.token)

    def test_recusa_data_referencia_nula(self):
        with self.assertRaises(ValueError):
            self.novo_pedido(data_referencia=None)

    def test_sem_formulario_ativo_levanta(self):
        FeedbackFormulario.objects.update(ativo=False)
        with self.assertRaises(FeedbackFormulario.DoesNotExist):
            self.novo_pedido()

    def test_banco_recusa_duas_versoes_ativas_do_mesmo_slug(self):
        """É a constraint que garante que `formulario_ativo()` nunca ache duas."""
        # A versao tem de ser INEDITA. Com uma ja existente o IntegrityError
        # viria da unicidade de (slug, versao) e o teste passaria pelo motivo
        # errado, sem provar nada sobre a constraint PARCIAL, que e o assunto
        # aqui. CRAVAR o numero foi o que quebrou este teste quando a v3 foi
        # semeada — entao ele e DERIVADO, e nenhuma versao futura o alcanca.
        from django.db import IntegrityError, transaction
        with self.assertRaises(IntegrityError), transaction.atomic():
            FeedbackFormulario.objects.create(
                slug='padrao', versao=proxima_versao_livre(), titulo='Outro',
                campos=[], ativo=True,
            )

    def test_trocar_o_formulario_nao_exige_migration_de_schema(self):
        """O procedimento documentado em 0002: desativa a atual, cria a versão seguinte."""
        # Publica a versao 3: a 2 ja e a de producao, semeada pela 0005. E o
        # mesmo procedimento de 2 passos, um degrau acima.
        FeedbackFormulario.objects.filter(slug='padrao', ativo=True).update(ativo=False)
        FeedbackFormulario.objects.create(
            slug='padrao', versao=proxima_versao_livre(), titulo='Formulário novo', ativo=True,
            campos=[{'key': 'nota', 'label': 'Nota', 'tipo': 'texto',
                     'obrigatorio': True, 'max_length': 10}],
        )
        pedido = self.novo_pedido()
        resp = self.client.get(f'/api/feedback/{pedido.token}/')
        self.assertEqual(resp.json()['titulo'], 'Formulário novo')
        self.assertEqual(resp.json()['campos'][0]['key'], 'nota')


class RotaPublicaTests(BaseFeedbackTestCase):

    def url(self, token):
        return f'/api/feedback/{token}/'

    def test_get_devolve_somente_o_contrato_publico(self):
        pedido = self.novo_pedido()
        resp = self.client.get(self.url(pedido.token))
        self.assertEqual(resp.status_code, 200)
        # Nada de responsável, sprint, setor, id de card, id do pedido, token.
        # `subtitulo` entrou nesta entrega: e a intro da pagina, texto fixo
        # nosso, versionado junto com as perguntas.
        self.assertEqual(set(resp.json().keys()),
                         {'titulo', 'subtitulo', 'referencia', 'data_entrega', 'campos'})
        self.assertEqual(resp.json()['referencia'], self.card.nome)
        self.assertEqual(resp.json()['campos'][0]['key'], 'respondente')

    def test_get_pode_ser_reaberto_enquanto_nao_respondido(self):
        pedido = self.novo_pedido()
        for _ in range(3):
            self.assertEqual(self.client.get(self.url(pedido.token)).status_code, 200)

    def test_os_tokens_inutilizaveis_continuam_indistinguiveis_entre_si(self):
        """A propriedade anti-enumeração, com um caso a MENOS na lista.

        "Já respondido" SAIU daqui porque deixou de ser um caso inutilizável — o
        link não expira mais e devolve o formulário para sempre (ver
        `test_o_link_continua_abrindo_depois_de_respondido`). Os demais casos
        continuam sendo a garantia e NÃO podem ser afrouxados junto: mesmo
        status, mesmo corpo e mesmo Content-Type para todos.
        """
        casos = {
            'inexistente': 'nao-existe-este-token',
            'fora_do_alfabeto': 'token-com-acento-é',
            'grande_demais': 'a' * 200,
        }
        respostas = {
            nome: self.client.get(self.url(token)) for nome, token in casos.items()
        }
        referencia = respostas['inexistente']
        for nome, resposta in respostas.items():
            with self.subTest(caso=nome):
                self.assertEqual(resposta.status_code, 404)
                self.assertEqual(resposta.json(), referencia.json())
                self.assertEqual(resposta.headers.get('Content-Type'),
                                 referencia.headers.get('Content-Type'))

    def test_post_grava_resposta_e_vira_o_estado(self):
        pedido = self.novo_pedido()
        resp = self.client.post(
            self.url(pedido.token), {'valores': self.valores(pedido, '  muito bom  ')},
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 201)
        pedido.refresh_from_db()
        self.assertEqual(pedido.estado, EstadoPedido.RESPONDIDO)
        self.assertIsNotNone(pedido.respondido_em)
        # O `strip` continua sendo do servidor.
        self.assertEqual(
            pedido.respostas.first().valores[self.chave_livre(pedido)], 'muito bom')

    def test_responder_antes_do_prazo_e_aceito(self):
        """O link nasce com o pedido, então responder cedo pula direto para colhido."""
        pedido = self.novo_pedido(data_referencia=timezone.localdate())
        self.assertEqual(pedido.estado, EstadoPedido.AGUARDANDO_PRAZO)
        resp = self.client.post(
            self.url(pedido.token), {'valores': self.valores(pedido, 'antecipado')},
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 201)
        pedido.refresh_from_db()
        self.assertEqual(pedido.estado, EstadoPedido.RESPONDIDO)

    def test_segunda_resposta_e_aceita_e_nao_sobrescreve_a_primeira(self):
        """A afirmação INVERTIDA da que estava aqui, com a mesma força.

        Este teste dizia "a segunda resposta é recusada" e travava o 404. O
        pedido do usuário é o contrário — "mais de um usuário deve poder
        responder o feedback, o link do formulário não deve expirar" —, então a
        regra que ele trava agora é: os dois envios são aceitos, viram DUAS
        linhas, e nenhum apaga o outro.
        """
        pedido = self.novo_pedido()
        chave = self.chave_livre(pedido)

        primeira = self.client.post(
            self.url(pedido.token), {'valores': self.valores(pedido, 'primeira')},
            content_type='application/json',
        )
        segunda = self.client.post(
            self.url(pedido.token), {'valores': self.valores(pedido, 'segunda')},
            content_type='application/json',
        )

        self.assertEqual(primeira.status_code, 201)
        self.assertEqual(segunda.status_code, 201)
        self.assertEqual(RespostaFeedback.objects.count(), 2)
        self.assertEqual(
            {r.valores[chave] for r in RespostaFeedback.objects.all()},
            {'primeira', 'segunda'},
        )

    def test_o_link_continua_abrindo_depois_de_respondido(self):
        """O link NÃO expira: nem por tempo, nem por ter sido respondido.

        Reabrir devolve o formulário em branco, pronto para OUTRA pessoa. Antes
        este GET caía no 404 de indisponível.
        """
        pedido = self.novo_pedido()
        self.client.post(
            self.url(pedido.token), {'valores': self.valores(pedido, 'primeira')},
            content_type='application/json',
        )

        resposta = self.client.get(self.url(pedido.token))

        self.assertEqual(resposta.status_code, 200)
        # E continua sendo o contrato público de sempre — o contador NÃO entra.
        self.assertEqual(
            set(resposta.json()),
            {'titulo', 'subtitulo', 'referencia', 'data_entrega', 'campos'},
        )

    def test_chave_desconhecida_e_rejeitada(self):
        pedido = self.novo_pedido()
        resp = self.client.post(
            self.url(pedido.token),
            {'valores': self.valores(pedido, campo_injetado='x' * 100)},
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 400)
        self.assertFalse(RespostaFeedback.objects.exists())

    def test_valor_acima_do_max_length_e_rejeitado(self):
        pedido = self.novo_pedido()
        chave = self.chave_livre(pedido)
        resp = self.client.post(
            self.url(pedido.token),
            {'valores': self.valores(pedido, **{chave: 'a' * 2001})},
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 400)
        self.assertFalse(RespostaFeedback.objects.exists())

    def test_campo_obrigatorio_vazio_e_rejeitado(self):
        pedido = self.novo_pedido()
        # So espaco em TODO campo obrigatorio: para o motor, e nao responder.
        vazios = {
            c['key']: '   '
            for c in pedido.formulario.campos if c.get('obrigatorio')
        }
        self.assertTrue(vazios, 'a definicao precisa ter campo obrigatorio')
        resp = self.client.post(
            self.url(pedido.token), {'valores': self.valores(pedido, **vazios)},
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 400)
        self.assertFalse(RespostaFeedback.objects.exists())

    def test_token_nunca_entra_no_log_da_aplicacao(self):
        """Regressão: o Django loga TODA resposta >= 400, não só Http404 propagado.

        `django/core/handlers/base.py:142` chama `log_response` para qualquer
        status >= 400 — e o token está no path. Sem a supressão em
        `finalize_response`, este teste falha nos três casos abaixo.
        """
        pedido = self.novo_pedido()
        with self.assertLogs('django.request', level='DEBUG') as capturado:
            # 400 (validação), 404 (token inexistente), 404 (token fora do
            # alfabeto) e as respostas de sucesso.
            self.client.post(
                self.url(pedido.token), {'valores': {'x': 'y'}},
                content_type='application/json',
            )
            self.client.get(self.url('token-que-nao-existe'))
            self.client.get(self.url('acentuado-é-impossível'))
            self.client.post(
                self.url(pedido.token), {'valores': self.valores(pedido)},
                content_type='application/json',
            )
            self.client.get(self.url(pedido.token))
            # assertLogs falha se NADA for logado; garante que a captura funciona.
            import logging
            logging.getLogger('django.request').debug('sentinela')
        self.assertNotIn(pedido.token, '\n'.join(capturado.output))

    def test_rota_ignora_sessao_de_quem_esta_logado(self):
        """authentication_classes = [] — a sessão de um funcionário não vaza para cá."""
        pedido = self.novo_pedido()
        self.client.force_login(self.user)
        self.assertEqual(self.client.get(self.url(pedido.token)).status_code, 200)


class ThrottleTests(TestCase):

    def test_chave_de_cache_nao_contem_o_token(self):
        class FakeView:
            kwargs = {'token': 'token-supersecreto-que-nao-pode-vazar'}

        chave = FeedbackTokenThrottle().get_cache_key(None, FakeView())
        self.assertNotIn('supersecreto', chave)
        self.assertTrue(chave.startswith('throttle_feedback_token_'))


class TarefasTests(BaseFeedbackTestCase):

    def test_nao_promove_antes_do_prazo(self):
        self.novo_pedido(data_referencia=timezone.localdate() - timedelta(days=29))
        self.assertEqual(liberar_pedidos_no_prazo()['promovidos'], 0)

    def test_promove_no_prazo_e_e_idempotente(self):
        pedido = self.novo_pedido(data_referencia=timezone.localdate() - timedelta(days=30))
        self.assertEqual(liberar_pedidos_no_prazo()['promovidos'], 1)
        pedido.refresh_from_db()
        self.assertEqual(pedido.estado, EstadoPedido.AGUARDANDO_RESPOSTA)
        # Segunda passada não reprocessa: o estado está no WHERE do UPDATE.
        self.assertEqual(liberar_pedidos_no_prazo()['promovidos'], 0)

    def test_varredura_nao_toca_em_respondidos(self):
        pedido = self.novo_pedido(data_referencia=timezone.localdate() - timedelta(days=60))
        self.client.post(
            f'/api/feedback/{pedido.token}/', {'valores': self.valores(pedido)},
            content_type='application/json',
        )
        self.assertEqual(liberar_pedidos_no_prazo()['promovidos'], 0)
        pedido.refresh_from_db()
        self.assertEqual(pedido.estado, EstadoPedido.RESPONDIDO)

    def test_retencao_desligada_por_padrao(self):
        pedido = self.novo_pedido()
        RespostaFeedback.objects.create(pedido=pedido, valores={'comentario': 'x'})
        resultado = limpar_respostas_expiradas()
        self.assertTrue(resultado['desligado'])
        self.assertEqual(RespostaFeedback.objects.count(), 1)

    def test_retencao_apaga_o_texto_e_preserva_o_fato(self):
        """O prazo passou a ser contado POR LINHA (`enviado_em`).

        Antes o filtro era `pedido__respondido_em__lt` e este teste envelhecia o
        PEDIDO. Com várias respostas isso vira um bug de perda de dado —
        `respondido_em` congela na primeira resposta, então o filtro casaria
        também uma resposta enviada hoje. Ver o teste irmão
        `test_retencao_conta_o_prazo_de_cada_resposta_separadamente`.
        """
        with self.settings(FEEDBACK_RETENCAO_DIAS=30):
            pedido = self.novo_pedido()
            resposta = RespostaFeedback.objects.create(
                pedido=pedido, valores={'comentario': 'x'})
            # `enviado_em` é auto_now_add: envelhecer exige `update()`.
            RespostaFeedback.objects.filter(pk=resposta.pk).update(
                enviado_em=timezone.now() - timedelta(days=31),
            )
            PedidoFeedback.objects.filter(pk=pedido.pk).update(
                estado=EstadoPedido.RESPONDIDO,
                respondido_em=timezone.now() - timedelta(days=31),
            )
            self.assertEqual(limpar_respostas_expiradas()['apagadas'], 1)
        self.assertFalse(RespostaFeedback.objects.exists())
        pedido.refresh_from_db()
        # A métrica sobrevive: o fato e a data ficam, o conteúdo some.
        self.assertEqual(pedido.estado, EstadoPedido.RESPONDIDO)
        self.assertIsNotNone(pedido.respondido_em)

    def test_retencao_conta_o_prazo_de_cada_resposta_separadamente(self):
        """Uma resposta de hoje NÃO pode ser apagada pelo prazo de outra.

        `respondido_em` congela na PRIMEIRA resposta. Enquanto o corte saía dele,
        um pedido respondido há 400 dias arrastava para o expurgo TODA linha
        daquele pedido — inclusive a que uma segunda pessoa enviou hoje, sem que
        ela tivesse cumprido um dia sequer do prazo. É perda de dado disfarçada
        de LGPD, e fica invisível hoje só porque FEEDBACK_RETENCAO_DIAS é 0.
        """
        with self.settings(FEEDBACK_RETENCAO_DIAS=30):
            pedido = self.novo_pedido()
            antiga = RespostaFeedback.objects.create(
                pedido=pedido, valores={'comentario': 'vencida'})
            nova = RespostaFeedback.objects.create(
                pedido=pedido, valores={'comentario': 'de hoje'})
            RespostaFeedback.objects.filter(pk=antiga.pk).update(
                enviado_em=timezone.now() - timedelta(days=400),
            )
            # O pedido inteiro está "vencido" — é o carimbo da primeira resposta.
            PedidoFeedback.objects.filter(pk=pedido.pk).update(
                estado=EstadoPedido.RESPONDIDO,
                respondido_em=timezone.now() - timedelta(days=400),
            )

            self.assertEqual(limpar_respostas_expiradas()['apagadas'], 1)

        sobreviventes = list(RespostaFeedback.objects.values_list('pk', flat=True))
        self.assertEqual(sobreviventes, [nova.pk])


class EndpointAutenticadoTests(BaseFeedbackTestCase):

    def setUp(self):
        super().setUp()
        self.user.user_permissions.add(
            __import__('django.contrib.auth.models', fromlist=['Permission'])
            .Permission.objects.get(codename='view_content')
        )
        self.user = User.objects.get(pk=self.user.pk)  # limpa o cache de permissões
        self.client.force_login(self.user)

    def test_busca_por_card_marcado_e_por_card_do_kanban(self):
        pedido = self.novo_pedido(card_kanban_id=self.card_kanban.id)
        for card_id in (self.card.id, self.card_kanban.id):
            resp = self.client.get(f'/api/feedbacks/pedidos/?card={card_id}')
            self.assertEqual(resp.status_code, 200)
            dados = resp.json()['results']
            self.assertEqual(len(dados), 1)
            # CONJUNTO EXATO de chaves, e nunca `assertIn`: é esta asserção que
            # pega um campo interno entrando no payload por refactor. Ela mudou
            # conscientemente duas vezes nesta entrega — `resposta` (singular)
            # virou `respostas` (LISTA, porque várias pessoas respondem o mesmo
            # link) e entrou `total_respostas`, o contador que o preview do card
            # mostra. Enquanto ninguém respondeu, a lista é vazia e o contador é
            # 0 — as chaves existem sempre, para a tela não ter que distinguir
            # "campo ausente" de "sem resposta".
            self.assertEqual(set(dados[0].keys()),
                             {'id', 'estado', 'data_referencia', 'respondido_em',
                              'url_publica', 'respostas', 'total_respostas'})
            self.assertEqual(dados[0]['respostas'], [])
            self.assertEqual(dados[0]['total_respostas'], 0)
            self.assertIn(pedido.token, dados[0]['url_publica'])

    def test_exige_autenticacao(self):
        self.client.logout()
        self.assertIn(self.client.get('/api/feedbacks/pedidos/').status_code, (401, 403))

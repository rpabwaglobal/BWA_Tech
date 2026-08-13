"""Cobertura de `/api/users/?participa_do_trabalho=true` — a rota que alimenta o
widget "Usuários sem card" do Dashboard.

Por que este arquivo existe: o parâmetro não aparecia em nenhum `tests*.py`. O
corte de VISITANTE (quem não tem `view_content`) nunca teve prova executável, e
o corte de CONTA DESATIVADA existia só por efeito colateral de
`usuarios_com_perm_qs`, cujo `is_active=True` é uma afirmação sobre PERMISSÃO
(equivalência com `has_perm`) e não sobre offboarding. Um refactor daquela função
reintroduziria inativo na lista em silêncio.

Os cenários batem na view REAL por HTTP: o que se afirma é o que o Dashboard
receberia.
"""
from unittest.mock import patch

from django.core.cache import cache
from django.test import TestCase
from rest_framework.authtoken.models import Token

from .models import (
    CARGO_CHOICES_CACHE_KEY,
    SETOR_CHOICES_CACHE_KEY,
    Cargo,
    SetorCatalogo,
    User,
)


class ListagemParticipantesDoTrabalhoTests(TestCase):
    def setUp(self):
        # `get_cargo_choices`/`get_setor_choices` são cacheados; sem limpar, o
        # catálogo montado aqui não apareceria nas choices.
        cache.delete(CARGO_CHOICES_CACHE_KEY)
        cache.delete(SETOR_CHOICES_CACHE_KEY)

        SetorCatalogo.objects.get_or_create(
            codename='sem_setor', defaults={'nome': 'Sem Setor', 'is_system': True})
        Cargo.objects.get_or_create(
            codename='admin', defaults={'nome': 'Administrador', 'is_system': True})
        # As permissões são fixadas explicitamente (e não herdadas do seed das
        # migrations) para o cenário não depender do estado do catálogo:
        # 'desenvolvedor' TEM o piso de leitura, 'visitante' não tem nada.
        self.cargo_dev = self._cargo('desenvolvedor', 'Desenvolvedor', ['view_content'])
        self.cargo_visitante = self._cargo('visitante', 'Visitante', [])

        # A gestora é `role='admin'`: a autorização dela passa pelo
        # AdminRolePermissionBackend (caminho real) e ela sai das listagens por
        # `exclude(role='admin')`, então não polui as asserções.
        self.gestora = User.objects.create_user(
            username='gestora', password='SenhaForte!123', role='admin')
        self.ativo = User.objects.create_user(
            username='ativo', password='SenhaForte!123', role='desenvolvedor')
        self.inativo = User.objects.create_user(
            username='inativo', password='SenhaForte!123', role='desenvolvedor',
            is_active=False)
        self.visitante = User.objects.create_user(
            username='visitante', password='SenhaForte!123', role='visitante')

        self.token = Token.objects.create(user=self.gestora).key

    def _cargo(self, codename, nome, permissoes):
        cargo, _ = Cargo.objects.get_or_create(codename=codename, defaults={'nome': nome})
        cargo.permissoes_padrao = permissoes
        cargo.save(update_fields=['permissoes_padrao'])
        return cargo

    def _auth(self):
        return {'authorization': f'Token {self.token}'}

    def _ids_listados(self, query=''):
        resp = self.client.get(f'/api/users/{query}', headers=self._auth())
        self.assertEqual(resp.status_code, 200, resp.content)
        dados = resp.json()
        itens = dados['results'] if isinstance(dados, dict) else dados
        return {item['id'] for item in itens}

    # ---- conta desativada -------------------------------------------------

    def test_inativo_com_view_content_fica_fora_da_lista(self):
        """Ninguém cobra card de quem saiu da empresa. O cargo dele TEM
        `view_content` — o que o tira da lista é a conta estar desativada."""
        ids = self._ids_listados('?participa_do_trabalho=true')
        self.assertIn(self.ativo.pk, ids)
        self.assertNotIn(self.inativo.pk, ids)

    def test_corte_de_inativo_nao_depende_de_quem_resolve_a_permissao(self):
        """O cenário "refactor futuro naquela função", encenado.

        Com `ids_que_participam_do_trabalho` devolvendo TODO MUNDO (inclusive o
        inativo), o único filtro que sobra é o `is_active=True` que
        `_filtrar_participantes` aplica por conta própria. Se alguém apagá-lo
        achando que é redundante, este teste cai.
        """
        todos = {self.ativo.pk, self.inativo.pk, self.visitante.pk}
        with patch('apps.accounts.views.ids_que_participam_do_trabalho',
                   return_value=todos):
            ids = self._ids_listados('?participa_do_trabalho=true')
        self.assertIn(self.ativo.pk, ids)
        self.assertNotIn(
            self.inativo.pk, ids,
            'o corte de conta desativada precisa valer sozinho em _filtrar_participantes')

    # ---- visitante --------------------------------------------------------

    def test_visitante_fica_fora_da_lista(self):
        """Quem não enxerga sprint, projeto nem card não está "sem card" —
        está fora do trabalho. O corte é por PERMISSÃO (`view_content`), nunca
        por nome de cargo."""
        ids = self._ids_listados('?participa_do_trabalho=true')
        self.assertNotIn(self.visitante.pk, ids)

    # ---- o filtro é opt-in ------------------------------------------------

    def test_sem_o_parametro_a_listagem_continua_completa(self):
        """O filtro não pode virar corte global: `/users/` sem o parâmetro
        precisa continuar resolvendo inativo e visitante (é o que permite exibir
        o responsável histórico de um card antigo)."""
        ids = self._ids_listados()
        for usuario in (self.ativo, self.inativo, self.visitante):
            self.assertIn(usuario.pk, ids, usuario.username)

    # ---- regressão: is_active não é editável por PATCH --------------------

    def test_patch_com_is_active_nao_desativa(self):
        """`is_active` é read_only no UserSerializer de propósito: desativar tem
        que passar por `/set-active/`, que é quem revoga token e solta os cards
        abertos. O DRF descarta o campo em silêncio e devolve 200 — este teste
        trava esse comportamento, senão um `read_only_fields` editado sem
        querer abriria uma porta de desativação que não cumpre nada disso."""
        resp = self.client.patch(
            f'/api/users/{self.ativo.pk}/',
            data={'is_active': False},
            content_type='application/json',
            headers=self._auth(),
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        self.ativo.refresh_from_db()
        self.assertTrue(self.ativo.is_active)


class DesativacaoPelaAPITests(TestCase):
    """O caminho REAL da tela, ponta a ponta: o gestor clica em desativar e as
    DUAS metades do pedido têm que acontecer na mesma request — a pessoa sai da
    lista que alimenta o widget "Usuários sem card" E os cards abertos dela
    ficam sem responsável.

    Os testes do serviço (projects/tests.py) provam a regra em isolamento; aqui
    se prova que a porta HTTP realmente a aciona. Sem isto, alguém pode remover
    a chamada de `set_active` e a suíte continua verde.
    """

    def setUp(self):
        cache.delete(CARGO_CHOICES_CACHE_KEY)
        cache.delete(SETOR_CHOICES_CACHE_KEY)

        setor, _ = SetorCatalogo.objects.get_or_create(
            codename='sem_setor', defaults={'nome': 'Sem Setor', 'is_system': True})
        Cargo.objects.get_or_create(
            codename='admin', defaults={'nome': 'Administrador', 'is_system': True})
        cargo_dev, _ = Cargo.objects.get_or_create(
            codename='desenvolvedor', defaults={'nome': 'Desenvolvedor'})
        cargo_dev.permissoes_padrao = ['view_content']
        cargo_dev.save(update_fields=['permissoes_padrao'])

        self.gestora = User.objects.create_user(
            username='gestora_api', password='SenhaForte!123', role='admin')
        self.dev = User.objects.create_user(
            username='dev.desligado', password='SenhaForte!123', role='desenvolvedor',
            first_name='Fulano', last_name='de Tal')
        self.token = Token.objects.create(user=self.gestora).key

        from datetime import datetime, time, timedelta

        from django.utils import timezone

        from apps.projects.models import Card, CardStatus, Project, Sprint

        self.Card = Card
        self.CardStatus = CardStatus

        tz = timezone.get_current_timezone()
        hoje = timezone.localdate()  # data LOCAL: `timezone.now().date()` erra à noite
        self.sprint = Sprint.objects.create(
            nome='Sprint da desativação',
            data_inicio=timezone.make_aware(datetime.combine(hoje, time.min), tz),
            fechamento_em=timezone.make_aware(
                datetime.combine(hoje + timedelta(days=13), time(23, 0)), tz),
            duracao_dias=14,
            supervisor=self.gestora,
            setor=setor,
        )
        self.projeto = Project.objects.create(nome='Projeto da desativação', sprint=self.sprint)

    def _auth(self):
        return {'authorization': f'Token {self.token}'}

    def _card(self, nome, status, responsavel):
        return self.Card.objects.create(
            nome=nome, projeto=self.projeto, status=status,
            responsavel=responsavel, criado_por=self.gestora)

    def _set_active(self, usuario, valor):
        return self.client.post(
            f'/api/users/{usuario.pk}/set-active/',
            data={'is_active': valor},
            content_type='application/json',
            headers=self._auth(),
        )

    def _participantes(self):
        resp = self.client.get('/api/users/?participa_do_trabalho=true', headers=self._auth())
        self.assertEqual(resp.status_code, 200, resp.content)
        dados = resp.json()
        itens = dados['results'] if isinstance(dados, dict) else dados
        return {item['id'] for item in itens}

    def test_desativar_pela_api_solta_o_aberto_e_preserva_o_encerrado(self):
        aberto = self._card('Card vivo', self.CardStatus.EM_DESENVOLVIMENTO, self.dev)
        finalizado = self._card('Card entregue', self.CardStatus.FINALIZADO, self.dev)
        inviabilizado = self._card('Card morto', self.CardStatus.INVIABILIZADO, self.dev)

        # `captureOnCommitCallbacks` executa os callbacks de `on_commit` (o
        # broadcast do Kanban e o aviso de conta desativada), que em `TestCase`
        # nunca rodariam porque a transação é revertida. É o que prova que o
        # caminho de tempo real da desativação não estoura.
        with self.captureOnCommitCallbacks(execute=True) as callbacks:
            resp = self._set_active(self.dev, False)
        self.assertEqual(resp.status_code, 200, resp.content)
        # Sem esta asserção a de cima seria vazia: `execute=True` num bloco que
        # não registrou nada passa igual. São dois callbacks esperados — o
        # broadcast do Kanban (serviço) e o aviso de conta desativada (view).
        self.assertGreaterEqual(
            len(callbacks), 2,
            'a desativação precisa agendar os avisos de tempo real para DEPOIS do commit')

        self.dev.refresh_from_db()
        self.assertFalse(self.dev.is_active)

        aberto.refresh_from_db()
        self.assertIsNone(aberto.responsavel_id)
        for card in (finalizado, inviabilizado):
            card.refresh_from_db()
            self.assertEqual(
                card.responsavel_id, self.dev.pk,
                f'{card.nome}: apagar o responsável aqui reescreveria a entrega da sprint')

    def test_desativar_pela_api_registra_o_gestor_no_historico(self):
        """Vindo da API existe ator humano — o log tem que dizer QUEM desativou.
        É a diferença entre este caminho e o de shell/migration, onde o autor
        fica nulo de propósito."""
        from apps.projects.models import CardLogEventType

        aberto = self._card('Card vivo', self.CardStatus.EM_DESENVOLVIMENTO, self.dev)

        self._set_active(self.dev, False)

        log = aberto.logs.get(tipo_evento=CardLogEventType.RESPONSAVEL_ALTERADO)
        self.assertEqual(log.usuario_id, self.gestora.pk)
        self.assertIn('Fulano de Tal', log.descricao)
        self.assertIn('conta desativada', log.descricao)

    def test_desativado_sai_da_lista_que_alimenta_o_widget(self):
        """O pedido inteiro numa asserção só: antes ele é cobrado por card,
        depois de desativado ele não aparece nem para ser cobrado."""
        self._card('Card vivo', self.CardStatus.EM_DESENVOLVIMENTO, self.dev)

        self.assertIn(self.dev.pk, self._participantes(), 'pré-condição: ativo aparece')

        self._set_active(self.dev, False)

        self.assertNotIn(
            self.dev.pk, self._participantes(),
            'desativado não pode reaparecer como "usuário sem card" logo após perder o card')

    def test_reativar_pela_api_nao_devolve_os_cards(self):
        """Decisão explícita do dono do produto, travada por teste: reativar
        devolve o acesso, não o trabalho. Quem reassumiu o card enquanto a
        pessoa estava fora não pode perdê-lo porque ela voltou."""
        from apps.projects.models import CardLogEventType

        aberto = self._card('Card do que voltou', self.CardStatus.EM_DESENVOLVIMENTO, self.dev)

        self.assertEqual(self._set_active(self.dev, False).status_code, 200)
        self.assertEqual(self._set_active(self.dev, True).status_code, 200)

        self.dev.refresh_from_db()
        self.assertTrue(self.dev.is_active, 'pré-condição: a conta voltou')
        self.assertIn(self.dev.pk, self._participantes(), 'reativado volta a ser cobrado')

        aberto.refresh_from_db()
        self.assertIsNone(
            aberto.responsavel_id,
            'a desatribuição é definitiva — reativar NÃO reatribui')
        self.assertEqual(
            aberto.logs.filter(tipo_evento=CardLogEventType.RESPONSAVEL_ALTERADO).count(), 1,
            'o ciclo desativar→reativar não pode empilhar histórico')

    def test_desativar_duas_vezes_nao_duplica_historico(self):
        """Clique repetido no toggle (ou request reenviada) é cenário real de
        tela — não pode virar duas linhas do mesmo fato."""
        from apps.projects.models import CardLogEventType

        aberto = self._card('Card do toggle', self.CardStatus.EM_DESENVOLVIMENTO, self.dev)

        self._set_active(self.dev, False)
        self._set_active(self.dev, False)

        self.assertEqual(
            aberto.logs.filter(tipo_evento=CardLogEventType.RESPONSAVEL_ALTERADO).count(), 1)

    def test_card_de_outra_pessoa_nao_e_afetado_pela_desativacao(self):
        """A desativação recorta por responsável. Se o filtro escapasse, um
        offboarding limparia cards de quem ficou — e sem volta."""
        colega = User.objects.create_user(
            username='colega', password='SenhaForte!123', role='desenvolvedor')
        alheio = self._card('Card do colega', self.CardStatus.EM_DESENVOLVIMENTO, colega)

        self._set_active(self.dev, False)

        alheio.refresh_from_db()
        self.assertEqual(alheio.responsavel_id, colega.pk)
        self.assertIn(colega.pk, self._participantes())

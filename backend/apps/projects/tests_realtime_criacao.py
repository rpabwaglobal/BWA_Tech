"""O quadro precisa saber que um card NASCEU, nao so que ele se moveu.

O sintoma era: criar card e ter de recarregar a pagina. O backend ja transmitia
`kanban_changed` na criacao e o hook do cliente ja sabia trata-lo - as telas do
quadro e que nunca registraram o ouvinte. Este teste tranca a metade do backend:
se o broadcast sumir do caminho de criacao, o defeito volta e ninguem percebe,
porque nada quebra visivelmente.
"""
import datetime as dt
from unittest import mock

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone

from apps.accounts.models import SetorCatalogo
from apps.projects.models import Card, Project, Sprint

User = get_user_model()


class BroadcastNaCriacaoDeCardTests(TestCase):

    def setUp(self):
        self.user = User.objects.create_superuser(
            username='chefe_rt', password='x' * 12, email='chefe.rt@example.com')
        self.setor = SetorCatalogo.objects.create(codename='tec_rt', nome='Tec RT')
        agora = timezone.now()
        # Sprint EM ANDAMENTO: `_sprint_is_active` e pre-requisito do broadcast.
        self.sprint = Sprint.objects.create(
            nome='Sprint tempo real', data_inicio=agora - dt.timedelta(days=1),
            fechamento_em=agora + dt.timedelta(days=7), duracao_dias=8,
            supervisor=self.user, setor=self.setor)
        self.projeto = Project.objects.create(nome='Projeto RT', sprint=self.sprint)

    def test_criar_card_transmite_kanban_changed(self):
        with mock.patch('apps.projects.realtime.broadcast_kanban_changed') as bc:
            Card.objects.create(nome='Card novo', projeto=self.projeto, criado_por=self.user)

        self.assertTrue(
            bc.called,
            'A criacao de card nao transmitiu kanban_changed: o quadro dos outros '
            'usuarios so mostraria o card apos F5.')

    def test_o_evento_vai_para_o_grupo_da_sprint_e_sem_carga_util(self):
        """Sem carga util de proposito: quem decide o que cada um enxerga e o
        queryset escopado do REST, entao o cliente refaz a busca. Repetir a regra
        de visibilidade no emissor foi o defeito que formularios/realtime.py
        teve de desfazer."""
        with mock.patch('apps.projects.realtime.get_channel_layer') as layer:
            camada = mock.MagicMock()
            # AsyncMock: `group_send` e aguardado via async_to_sync. Com
            # MagicMock o await falha, a excecao e engolida pelo try/except do
            # broadcast, e o teste ainda passaria - mas cuspindo um traceback
            # que treina quem le a ignorar a saida dos testes.
            camada.group_send = mock.AsyncMock()
            layer.return_value = camada
            Card.objects.create(nome='Card grupo', projeto=self.projeto, criado_por=self.user)

        chamadas = [c for c in camada.group_send.call_args_list
                    if c.args and c.args[0] == f'sprint_{self.sprint.id}_kanban']
        self.assertTrue(chamadas, 'Nada foi enviado ao grupo do kanban da sprint.')

        evento = chamadas[-1].args[1]
        self.assertEqual(evento.get('type'), 'kanban_changed')
        self.assertNotIn('card', evento)
        self.assertNotIn('cards', evento)

    def test_sprint_encerrada_nao_transmite(self):
        """Limitacao conhecida e deliberada (`_sprint_is_active`): so a sprint em
        andamento gera tempo real. Num projeto de sprint fechada o card novo
        continua exigindo F5 - documentado aqui para nao ser confundido com bug.
        """
        self.sprint.finalizada = True
        self.sprint.save(update_fields=['finalizada'])

        with mock.patch('apps.projects.realtime.get_channel_layer') as layer:
            camada = mock.MagicMock()
            # AsyncMock: `group_send` e aguardado via async_to_sync. Com
            # MagicMock o await falha, a excecao e engolida pelo try/except do
            # broadcast, e o teste ainda passaria - mas cuspindo um traceback
            # que treina quem le a ignorar a saida dos testes.
            camada.group_send = mock.AsyncMock()
            layer.return_value = camada
            Card.objects.create(nome='Card sprint velha', projeto=self.projeto,
                                criado_por=self.user)

        do_kanban = [c for c in camada.group_send.call_args_list
                     if c.args and 'kanban' in str(c.args[0])]
        self.assertEqual(do_kanban, [])

"""Filtros de periodo e de projeto no relatorio de cards.

Os dois defeitos cobertos aqui faziam o relatorio ESCONDER trabalho que existe -
a pior falha possivel num relatorio, porque ninguem desconfia de um numero a
menos. Foram encontrados a partir de um caso real: "0 cards" num periodo em que
19 haviam sido entregues.
"""
import datetime as dt

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone

from apps.accounts.models import SetorCatalogo
from apps.projects.models import Card, CardStatus, Project, Sprint
from apps.reports.generators.cards import Report
from apps.reports.models import ReportJob

User = get_user_model()


class FiltrosDoRelatorioDeCardsTests(TestCase):

    def setUp(self):
        self.user = User.objects.create_user(
            username='rel_user', email='rel.user@example.com', password='x' * 12,
            role='admin', is_superuser=True, is_staff=True)
        self.setor = SetorCatalogo.objects.create(codename='rel_setor', nome='Rel')

        agora = timezone.now()
        # Duas sprints: a virada de sprint replica o projeto, entao o MESMO
        # projeto existe uma vez em cada uma.
        self.sprint_velha = Sprint.objects.create(
            nome='Velha', data_inicio=agora - dt.timedelta(days=40),
            fechamento_em=agora - dt.timedelta(days=20), duracao_dias=20,
            supervisor=self.user, setor=self.setor, finalizada=True)
        self.sprint_atual = Sprint.objects.create(
            nome='Atual', data_inicio=agora - dt.timedelta(days=5),
            fechamento_em=agora + dt.timedelta(days=9), duracao_dias=14,
            supervisor=self.user, setor=self.setor)

        self.proj_velho = Project.objects.create(nome='Projeto X', sprint=self.sprint_velha)
        self.proj_atual = Project.objects.create(nome='Projeto X', sprint=self.sprint_atual)

    def _relatorio(self, filtros):
        job = ReportJob(user=self.user, type='cards', format='xlsx', filters=filtros)
        return list(Report(job).fetch_data())

    def _card_finalizado_em(self, projeto, quando, nome):
        card = Card.objects.create(
            nome=nome, projeto=projeto, status=CardStatus.FINALIZADO, criado_por=self.user)
        Card.objects.filter(pk=card.pk).update(finalizado_em=quando)
        return card

    def test_o_filtro_de_projeto_alcanca_as_instancias_de_TODAS_as_sprints(self):
        """O caso real que originou isto: 0 cards num periodo com entregas.

        A virada de sprint replica o projeto, entao "Projeto X" e uma linha por
        sprint. Filtrar pelo id que a tela oferece (o da sprint atual) escondia
        tudo que foi entregue nas sprints anteriores - justamente o que um
        relatorio por PERIODO deveria mostrar.
        """
        entregue = timezone.localtime() - dt.timedelta(days=25)
        self._card_finalizado_em(self.proj_velho, entregue, 'Card da sprint velha')

        linhas = self._relatorio({
            'project_id': self.proj_atual.id,   # o id que a tela manda
            'status': CardStatus.FINALIZADO,
            'period_date_type': 'delivered',
            'period_start': (entregue - dt.timedelta(days=2)).strftime('%Y-%m-%d'),
            'period_end': (entregue + dt.timedelta(days=2)).strftime('%Y-%m-%d'),
        })

        self.assertEqual(len(linhas), 1,
                         'o card da sprint anterior sumiu do relatorio por periodo')

    def test_o_ultimo_dia_do_periodo_entra_inteiro(self):
        """`__lte` com a data crua vira meia-noite e descarta o dia todo.

        Quem pede "ate segunda-feira" perdia tudo que foi entregue na
        segunda-feira, sem nenhum sinal de que faltava algo.
        """
        hoje = timezone.localtime().replace(hour=15, minute=30, second=0, microsecond=0)
        self._card_finalizado_em(self.proj_atual, hoje, 'Entregue hoje as 15h30')

        linhas = self._relatorio({
            'status': CardStatus.FINALIZADO,
            'period_date_type': 'delivered',
            'period_start': hoje.strftime('%Y-%m-%d'),
            'period_end': hoje.strftime('%Y-%m-%d'),   # mesmo dia nas duas pontas
        })

        self.assertEqual(len(linhas), 1,
                         'card entregue no ultimo dia do periodo ficou de fora')

    def test_entrega_no_fim_da_noite_conta_no_dia_LOCAL(self):
        """O campo e UTC; a data escolhida e local.

        As 22h em Sao Paulo ja e o dia seguinte em UTC. Com bordas ingenuas, o
        card era jogado para fora do dia em que de fato foi entregue - a mesma
        armadilha de fuso que ja mordeu o calculo de prazo neste sistema.
        """
        local = timezone.localtime().replace(hour=22, minute=30, second=0, microsecond=0)
        self._card_finalizado_em(self.proj_atual, local, 'Entregue as 22h30')

        linhas = self._relatorio({
            'status': CardStatus.FINALIZADO,
            'period_date_type': 'delivered',
            'period_start': local.strftime('%Y-%m-%d'),
            'period_end': local.strftime('%Y-%m-%d'),
        })

        self.assertEqual(len(linhas), 1,
                         'entrega no fim da noite caiu no dia errado por causa do fuso')

    def test_filtrar_por_sprint_continua_recortando(self):
        """A abertura do filtro de projeto nao pode atropelar o de sprint: quem
        pede UMA sprint continua recebendo so ela."""
        antigo = timezone.localtime() - dt.timedelta(days=25)
        self._card_finalizado_em(self.proj_velho, antigo, 'Da sprint velha')
        self._card_finalizado_em(self.proj_atual, timezone.localtime(), 'Da sprint atual')

        linhas = self._relatorio({
            'project_id': self.proj_atual.id,
            'sprint_id': self.sprint_atual.id,
            'status': CardStatus.FINALIZADO,
        })

        nomes = {l.nome for l in linhas}
        self.assertEqual(nomes, {'Da sprint atual'})

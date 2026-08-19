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
from apps.reports.generators import executive, metrics
from apps.reports.generators import user as user_gen
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

    def test_entrega_no_fim_da_noite_do_ultimo_dia_conta(self):
        """As 22h30 do ultimo dia pedido - a borda mais extrema do intervalo.

        Este teste ja se chamou "conta_no_dia_LOCAL" e dizia proteger contra um
        deslocamento de fuso: o campo e UTC, a data escolhida e local, logo as
        22h em Sao Paulo ja seriam o dia seguinte em UTC. ESSA EXPLICACAO ERA
        FALSA e fica registrada aqui para ninguem reconstruir o raciocinio.
        Com `USE_TZ=True` o Django converte um limite ingenuo usando
        `get_default_timezone()`, que neste projeto e America/Sao_Paulo - o SQL
        sai com `-03:00`, nao com `Z`. Medido: limite ingenuo e limite aware
        devolvem exatamente os mesmos registros.

        O que este teste protege de verdade e o mesmo `__lte` na meia-noite do
        teste anterior, no ponto em que ele mais machuca: quanto mais tarde a
        entrega, mais fundo dentro do dia descartado ela cai.
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
                         'entrega no fim do ultimo dia do periodo ficou de fora')

    def test_o_primeiro_dia_do_periodo_comeca_a_meia_noite(self):
        """A outra ponta do intervalo, que nenhum teste cobria.

        Uma entrega as 00h30 do primeiro dia pedido tem de entrar: o inicio do
        periodo e o primeiro instante do dia, nao um horario arbitrario.
        """
        madrugada = timezone.localtime().replace(hour=0, minute=30, second=0, microsecond=0)
        self._card_finalizado_em(self.proj_atual, madrugada, 'Entregue as 00h30')

        linhas = self._relatorio({
            'status': CardStatus.FINALIZADO,
            'period_date_type': 'delivered',
            'period_start': madrugada.strftime('%Y-%m-%d'),
            'period_end': madrugada.strftime('%Y-%m-%d'),
        })

        self.assertEqual(len(linhas), 1,
                         'entrega na madrugada do primeiro dia ficou de fora')

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


class UltimoDiaNosDemaisRelatoriosTests(TestCase):
    """O MESMO defeito de borda vivia em mais tres geradores.

    `cards.py` e `bottlenecks.py` foram corrigidos primeiro, a partir do caso
    real. Uma auditoria dos demais encontrou copias do mesmo `_parse_date` em
    `executive.py`, `metrics.py` e `user.py` - cada uma alimentando `__lte`.
    Medido no acervo real, numa janela de um mes: 6 entregas e 2 aprovacoes de
    mudanca de data sumiam dos KPIs, e cinco pessoas diferentes perdiam uma
    entrega cada no relatorio individual.

    Como o defeito era COPIA, o teste tambem cobre os tres de uma vez: se
    alguem restaurar o `__lte` em qualquer um deles, cai aqui.
    """

    def setUp(self):
        self.user = User.objects.create_user(
            username='rel_geral', email='rel.geral@example.com', password='x' * 12,
            role='admin', is_superuser=True, is_staff=True)
        self.setor = SetorCatalogo.objects.create(codename='rel_geral_setor', nome='RelG')

        agora = timezone.now()
        self.sprint = Sprint.objects.create(
            nome='Sprint dos KPIs', data_inicio=agora - dt.timedelta(days=5),
            fechamento_em=agora + dt.timedelta(days=9), duracao_dias=14,
            supervisor=self.user, setor=self.setor)
        self.projeto = Project.objects.create(nome='Projeto KPI', sprint=self.sprint)

        # A entrega mora no ULTIMO dia da janela, longe da meia-noite: e
        # exatamente o registro que o `__lte` descartava.
        self.dia = timezone.localtime().replace(hour=16, minute=0, second=0, microsecond=0)
        card = Card.objects.create(
            nome='Entregue as 16h do ultimo dia', projeto=self.projeto,
            status=CardStatus.FINALIZADO, criado_por=self.user,
            responsavel=self.user)
        Card.objects.filter(pk=card.pk).update(finalizado_em=self.dia)

    def _filtros(self, **extra):
        f = {
            'period_date_type': 'delivered',
            'period_start': (self.dia - dt.timedelta(days=3)).strftime('%Y-%m-%d'),
            'period_end': self.dia.strftime('%Y-%m-%d'),
        }
        f.update(extra)
        return f

    def _rodar(self, gerador, tipo, **extra):
        job = ReportJob(user=self.user, type=tipo, format='pdf',
                        filters=self._filtros(**extra))
        return gerador.Report(job).fetch_data()

    def test_executivo_conta_a_entrega_do_ultimo_dia(self):
        dados = self._rodar(executive, 'executive')
        self.assertEqual(dados['total_delivered'], 1,
                         'o Executivo perdeu a entrega do ultimo dia da janela')

    def test_metricas_globais_contam_a_entrega_do_ultimo_dia(self):
        dados = self._rodar(metrics, 'metrics')
        self.assertEqual(dados['kpis']['closed_total'], 1,
                         'as Metricas Globais perderam a entrega do ultimo dia')

    def test_relatorio_por_usuario_conta_a_entrega_do_ultimo_dia(self):
        dados = self._rodar(user_gen, 'user', user_id=self.user.id)
        self.assertEqual(len(dados['delivered']), 1,
                         'o relatorio Por Usuario perdeu a entrega do ultimo dia')

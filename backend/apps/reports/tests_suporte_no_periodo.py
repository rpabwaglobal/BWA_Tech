"""Chamado de suporte conta no mes em que foi RESOLVIDO.

O DEFEITO QUE MORAVA AQUI: o relatorio executivo contava chamados resolvidos
filtrando por `ChamadoSuporte.data_atualizacao`, que e `auto_now=True` — ou
seja, reescrito em QUALQUER save. Mover entre abas, o proxy do portal re-tocando
o registro, corrigir uma nota: tudo movia a data.

RESSALVA MEDIDA DEPOIS, e que o commit original nao sabia: nos RELATORIOS o
efeito disso nao era mes errado, era ZERO. A tabela local `ChamadoSuporte` tem
zero linhas em producao — os chamados vivem no portal externo e chegam por
proxy. Entao a consulta aqui esta correta e continua sem dados para ler.

Esta suite segue valendo: ela cria chamados locais, que e o cenario em que a
consulta tem o que ler, e trava a regra para o dia em que a fonte mudar. O que
ela NAO prova e que o KPI do relatorio mostre algo diferente de zero hoje.

Quem consertou o problema que o usuario relatou foi a tela de Metricas, que le
os chamados do portal.

A tela de Metricas ja tinha abandonado `data_atualizacao` pelo mesmo motivo e
passado a ler a timeline (`ChamadoSuporteTimeline`, evento `etapa_alterada`); o
relatorio ficou para tras. Esta suite trava os dois lados: que o relatorio usa a
timeline, e que `data_atualizacao` nao influencia mais nada.
"""
import datetime as dt

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone

from apps.formularios.models import (
    ChamadoSuporte, ChamadoSuporteStatus, ChamadoSuporteTimeline,
    ChamadoSuporteTimelineTipo, SuporteItem, SuporteMotivo, SuporteTipo,
)
from apps.reports.generators import executive
from apps.reports.models import ReportJob

User = get_user_model()


class SuporteContaNoMesDaResolucaoTests(TestCase):

    def setUp(self):
        self.user = User.objects.create_user(
            username='rel_suporte', email='rel.suporte@example.com',
            password='x' * 12, role='admin', is_superuser=True, is_staff=True)

        self.setembro = {'inicio': '2026-09-01', 'fim': '2026-09-30'}
        self.outubro = {'inicio': '2026-10-01', 'fim': '2026-10-31'}

        # O catalogo que o chamado exige por FK. Vem do portal externo em
        # producao; aqui basta existir.
        self.tipo = SuporteTipo.objects.create(nome='Sistema')
        self.item = SuporteItem.objects.create(tipo=self.tipo, nome='BWA Tech')
        self.motivo = SuporteMotivo.objects.create(nome='Erro')

    # -- fabricas ---------------------------------------------------------

    def _chamado(self, nome, status=ChamadoSuporteStatus.RESOLVIDO):
        return ChamadoSuporte.objects.create(
            status=status,
            descricao=nome,
            usuario_nome='Fulano',
            usuario_email='fulano@example.com',
            tipo=self.tipo,
            item=self.item,
            motivo=self.motivo,
            data_abertura=timezone.make_aware(dt.datetime(2026, 9, 1, 9, 0)),
        )

    def _resolvido_em(self, chamado, quando):
        """Grava o evento de troca de etapa, que e a conclusao de verdade.

        `data` e `auto_now_add`, entao precisa de `update` depois do create —
        e e exatamente por isso que a timeline e confiavel e o
        `data_atualizacao` nao: aqui a data so muda se alguem mandar.
        """
        evento = ChamadoSuporteTimeline.objects.create(
            chamado_id=chamado.id,
            tipo_evento=ChamadoSuporteTimelineTipo.ETAPA_ALTERADA,
            descricao='Etapa alterada para Concluído',
        )
        ChamadoSuporteTimeline.objects.filter(pk=evento.pk).update(data=quando)
        return evento

    def _contar(self, periodo):
        job = ReportJob(
            user=self.user, type='executive', format='pdf',
            # `period_start`/`period_end` sao as chaves que o gerador le. Com as
            # erradas o filtro e ignorado em silencio e TUDO entra — foi assim
            # que esta suite falhou na primeira execucao, com o codigo certo.
            filters={'period_start': periodo['inicio'], 'period_end': periodo['fim']},
        )
        return executive.Report(job).fetch_data()['support_resolved']

    # -- o caso relatado --------------------------------------------------

    def test_resolvido_em_setembro_conta_em_setembro(self):
        c = self._chamado('Resolvido em setembro')
        self._resolvido_em(c, timezone.make_aware(dt.datetime(2026, 9, 15, 14, 0)))

        self.assertEqual(self._contar(self.setembro), 1)
        self.assertEqual(self._contar(self.outubro), 0)

    def test_tocar_o_chamado_depois_NAO_o_move_de_mes(self):
        """O caso exato que o usuario relatou.

        Resolvido em 30/09, editado em 02/10. Antes, `data_atualizacao` virava
        02/10 e o chamado sumia de setembro.
        """
        c = self._chamado('Resolvido no fim de setembro')
        self._resolvido_em(c, timezone.make_aware(dt.datetime(2026, 9, 30, 17, 0)))

        # Um toque qualquer em outubro: `data_atualizacao` (auto_now) sobe.
        c.save()
        c.refresh_from_db()

        self.assertEqual(
            self._contar(self.setembro), 1,
            'o chamado saiu de setembro so porque alguem o editou depois')
        self.assertEqual(self._contar(self.outubro), 0)

    def test_aberto_em_setembro_e_resolvido_em_outubro_conta_em_outubro(self):
        """A outra metade da regra: vale a conclusao, nao a abertura."""
        c = self._chamado('Atravessa o mes')
        self._resolvido_em(c, timezone.make_aware(dt.datetime(2026, 10, 5, 11, 0)))

        self.assertEqual(self._contar(self.setembro), 0)
        self.assertEqual(self._contar(self.outubro), 1)

    # -- bordas do periodo ------------------------------------------------

    def test_o_ultimo_dia_do_mes_entra_inteiro(self):
        """Mesma classe de erro que `apps/reports/periodo.py` existe para evitar.

        Resolvido as 23h do dia 30: um `__lte` do dia 30 as 00:00 descartaria.
        """
        c = self._chamado('Ultimo dia, de noite')
        self._resolvido_em(c, timezone.make_aware(dt.datetime(2026, 9, 30, 23, 0)))

        self.assertEqual(self._contar(self.setembro), 1)

    def test_o_primeiro_dia_do_mes_entra_desde_a_meia_noite(self):
        c = self._chamado('Primeiro dia, de madrugada')
        self._resolvido_em(c, timezone.make_aware(dt.datetime(2026, 9, 1, 0, 30)))

        self.assertEqual(self._contar(self.setembro), 1)

    # -- o que fica de fora, e por que ------------------------------------

    def test_resolvido_sem_evento_de_etapa_fica_de_fora(self):
        """Sem data de conclusao ele nao pertence a mes nenhum.

        Entrar com a data errada seria pior que nao entrar. A tela de Metricas
        mostra um aviso com a contagem desses casos, para eles nao sumirem em
        silencio — que e a diferenca entre omitir e esconder.
        """
        self._chamado('Resolvido sem timeline')

        self.assertEqual(self._contar(self.setembro), 0)
        self.assertEqual(self._contar(self.outubro), 0)

    def test_chamado_nao_resolvido_fica_de_fora(self):
        """Um chamado que mudou de etapa mas nao chegou a Resolvido nao conta.

        O evento de timeline existe (ele andou no quadro), entao so a checagem
        de status o mantem fora. Sem ela, qualquer movimento viraria entrega.
        """
        c = self._chamado('Ainda em andamento', status=ChamadoSuporteStatus.EM_ANDAMENTO)
        self._resolvido_em(c, timezone.make_aware(dt.datetime(2026, 9, 10, 10, 0)))

        self.assertEqual(self._contar(self.setembro), 0)

    # -- a trava contra a volta do defeito --------------------------------

    def test_o_relatorio_nao_usa_data_atualizacao(self):
        """A trava explicita.

        `data_atualizacao` e `auto_now` e nao tem relacao com a conclusao. Se
        alguem a trouxer de volta para o recorte de periodo, este teste falha
        antes de o numero errado chegar ao relatorio de alguem.
        """
        import inspect

        fonte = inspect.getsource(executive.Report.fetch_data)
        # Procura o USO como filtro, nao a palavra: o comentario do gerador
        # cita `data_atualizacao` de proposito, para explicar por que ela saiu.
        for uso in ('data_atualizacao__gte', 'data_atualizacao__lt',
                    'data_atualizacao__lte', "filter(data_atualizacao"):
            self.assertNotIn(
                uso, fonte,
                '`data_atualizacao` voltou a recortar o periodo no gerador '
                'executivo. Ela e auto_now: qualquer save a reescreve, e o '
                'chamado muda de mes sozinho.')

    def test_a_contagem_usa_a_timeline(self):
        """A regra mora em `apps.reports.suporte`, nao dentro do gerador.

        Este teste olhava a fonte do gerador e passou a falhar quando a consulta
        foi extraida — corretamente: o lugar mudou. Agora ele confere o modulo,
        que e onde a decisao vive.
        """
        import inspect

        from apps.reports import suporte

        fonte = inspect.getsource(suporte.chamados_resolvidos_no_periodo)
        self.assertIn('ChamadoSuporteTimeline', fonte)
        self.assertIn('ETAPA_ALTERADA', fonte)

    def test_vale_a_ULTIMA_troca_de_etapa(self):
        """Um chamado reaberto e resolvido de novo conta na segunda vez.

        A tela faz o mesmo (ordena por `-data` e pega o primeiro), e as duas
        precisam concordar.
        """
        c = self._chamado('Reaberto e resolvido de novo')
        self._resolvido_em(c, timezone.make_aware(dt.datetime(2026, 9, 10, 10, 0)))
        self._resolvido_em(c, timezone.make_aware(dt.datetime(2026, 10, 8, 16, 0)))

        self.assertEqual(self._contar(self.setembro), 0)
        self.assertEqual(self._contar(self.outubro), 1)


class OsDoisRelatoriosNaoPodemDivergirTests(TestCase):
    """Executivo e Metricas contam chamados resolvidos do MESMO jeito.

    Os dois tinham a consulta escrita separadamente, cada um com um comentario
    dizendo que deviam ficar "em sincronia". Consertar so um faria os dois
    darem numeros diferentes para o mesmo mes — pior que o erro original, porque
    dois numeros divergentes destroem a confianca nos dois.

    Agora os dois chamam `apps.reports.suporte.chamados_resolvidos_no_periodo`.
    Esta suite existe para que continuem chamando.
    """

    def setUp(self):
        self.user = User.objects.create_user(
            username='rel_dois', email='rel.dois@example.com',
            password='x' * 12, role='admin', is_superuser=True, is_staff=True)
        self.tipo = SuporteTipo.objects.create(nome='Sistema')
        self.item = SuporteItem.objects.create(tipo=self.tipo, nome='BWA Tech')
        self.motivo = SuporteMotivo.objects.create(nome='Erro')

        self.setembro = {'period_start': '2026-09-01', 'period_end': '2026-09-30'}

    def _chamado_resolvido_em(self, quando, nome='Chamado'):
        c = ChamadoSuporte.objects.create(
            status=ChamadoSuporteStatus.RESOLVIDO, descricao=nome,
            usuario_nome='Fulano', usuario_email='fulano@example.com',
            tipo=self.tipo, item=self.item, motivo=self.motivo,
            data_abertura=timezone.make_aware(dt.datetime(2026, 9, 1, 9, 0)))
        evento = ChamadoSuporteTimeline.objects.create(
            chamado_id=c.id,
            tipo_evento=ChamadoSuporteTimelineTipo.ETAPA_ALTERADA,
            descricao='Etapa alterada para Concluído')
        ChamadoSuporteTimeline.objects.filter(pk=evento.pk).update(data=quando)
        return c

    def _executivo(self):
        job = ReportJob(user=self.user, type='executive', format='pdf',
                        filters=dict(self.setembro))
        return executive.Report(job).fetch_data()['support_resolved']

    def _metricas(self):
        from apps.reports.generators import metrics
        job = ReportJob(user=self.user, type='metrics', format='pdf',
                        filters=dict(self.setembro))
        return metrics.Report(job).fetch_data()['operations']['support_resolved']

    def test_os_dois_dao_o_mesmo_numero(self):
        self._chamado_resolvido_em(
            timezone.make_aware(dt.datetime(2026, 9, 15, 14, 0)), 'Em setembro')
        self._chamado_resolvido_em(
            timezone.make_aware(dt.datetime(2026, 10, 5, 14, 0)), 'Em outubro')

        self.assertEqual(self._executivo(), 1)
        self.assertEqual(self._metricas(), 1)
        self.assertEqual(
            self._executivo(), self._metricas(),
            'os dois relatorios divergiram sobre o mesmo mes')

    def test_tocar_o_chamado_nao_move_nenhum_dos_dois(self):
        c = self._chamado_resolvido_em(
            timezone.make_aware(dt.datetime(2026, 9, 30, 17, 0)))
        c.save()  # `data_atualizacao` (auto_now) sobe para hoje

        self.assertEqual(self._executivo(), 1)
        self.assertEqual(self._metricas(), 1)

    def test_os_dois_usam_o_modulo_compartilhado(self):
        """A trava estrutural.

        Nao basta os numeros baterem hoje: eles batem porque a consulta e uma
        so. Se alguem reescrever a consulta dentro de um dos geradores, este
        teste falha antes de os dois voltarem a divergir.
        """
        import inspect

        from apps.reports.generators import metrics

        for gerador, nome in ((executive, 'executive'), (metrics, 'metrics')):
            fonte = inspect.getsource(gerador.Report.fetch_data)
            self.assertIn(
                'chamados_resolvidos_no_periodo', fonte,
                '`%s` deixou de usar o modulo compartilhado de suporte.' % nome)
            self.assertNotIn(
                'data_atualizacao__', fonte,
                '`%s` voltou a recortar o periodo por `data_atualizacao`, que '
                'e auto_now.' % nome)

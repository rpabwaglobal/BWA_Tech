"""Chamado de suporte conta no mes em que foi RESOLVIDO.

O DEFEITO QUE MORAVA AQUI: o relatorio executivo contava chamados resolvidos
filtrando por `ChamadoSuporte.data_atualizacao`, que e `auto_now=True` — ou
seja, reescrito em QUALQUER save. Mover entre abas, o proxy do portal re-tocando
o registro, corrigir uma nota: tudo movia a data.

RESSALVA MEDIDA DEPOIS, e que o commit original nao sabia: nos RELATORIOS o
efeito disso nao era mes errado, era ZERO. A tabela local `ChamadoSuporte` tem
zero linhas — os chamados vivem no portal externo e chegam por proxy. Entao a
primeira correcao, que trocou a data mas seguiu lendo `ChamadoSuporte`, ficou
CERTA E SEM DADOS: o KPI continuou em zero.

A contagem agora le a timeline, que e a unica fonte que existe neste banco, e le
pela CHAVE da etapa (`etapa_destino`), nao pelo rotulo de exibicao. Esta suite
trava as duas decisoes, mais a de que `data_atualizacao` nao influencia nada.

POR QUE NENHUM TESTE AQUI CRIA `ChamadoSuporte`: porque a producao tambem nao.
Criar um chamado local para os testes passarem esconderia exatamente o defeito
que levou um mes para ser notado — uma consulta correta lendo uma tabela que
nunca e povoada. Os testes montam so a timeline, como a producao faz.
"""
import datetime as dt

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone

from apps.formularios.models import (
    ChamadoSuporteTimeline, ChamadoSuporteTimelineTipo,
)
from apps.reports.generators import executive
from apps.reports.models import ReportJob
from apps.reports.periodo import fim_do_periodo, inicio_do_periodo
from apps.reports.suporte import contar_resolvidos_no_periodo

User = get_user_model()

SETEMBRO = {'period_start': '2026-09-01', 'period_end': '2026-09-30'}
OUTUBRO = {'period_start': '2026-10-01', 'period_end': '2026-10-31'}


class MontaTimeline:
    """Fabrica de eventos de etapa, compartilhada pelas suites.

    `chamado_id` e um inteiro solto de proposito: o campo nao e FK, porque o
    chamado vive no portal externo. E essa a forma dos dados em producao.
    """

    def _evento(self, chamado_id, quando, destino='finalizado',
                descricao='Etapa do quadro: "Em desenvolvimento" -> "X".'):
        """Um movimento de etapa. `data` e auto_now_add, dai o update depois.

        E justamente por isso que a timeline e confiavel e o `data_atualizacao`
        nao: aqui a data so muda se alguem mandar mudar.
        """
        evento = ChamadoSuporteTimeline.objects.create(
            chamado_id=chamado_id,
            tipo_evento=ChamadoSuporteTimelineTipo.ETAPA_ALTERADA,
            descricao=descricao,
            etapa_destino=destino,
        )
        ChamadoSuporteTimeline.objects.filter(pk=evento.pk).update(data=quando)
        return evento


class KpiDeResolvidosNosRelatoriosTests(MontaTimeline, TestCase):
    """O KPI `support_resolved` do relatorio executivo, ponta a ponta."""

    def setUp(self):
        self.user = User.objects.create_user(
            username='rel_suporte', email='rel.suporte@example.com',
            password='x' * 12, role='admin', is_superuser=True, is_staff=True)

    def _contar(self, periodo):
        job = ReportJob(
            user=self.user, type='executive', format='pdf',
            # `period_start`/`period_end` sao as chaves que o gerador le. Com as
            # erradas o filtro e ignorado em silencio e TUDO entra — foi assim
            # que esta suite falhou na primeira execucao, com o codigo certo.
            filters=dict(periodo),
        )
        return executive.Report(job).fetch_data()['support_resolved']

    # -- o caso relatado --------------------------------------------------

    def test_resolvido_em_setembro_conta_em_setembro(self):
        self._evento(1, timezone.make_aware(dt.datetime(2026, 9, 15, 14, 0)))

        self.assertEqual(self._contar(SETEMBRO), 1)
        self.assertEqual(self._contar(OUTUBRO), 0)

    def test_aberto_em_setembro_e_resolvido_em_outubro_conta_em_outubro(self):
        """A outra metade da regra: vale a conclusao, nao a abertura."""
        self._evento(1, timezone.make_aware(dt.datetime(2026, 9, 2, 9, 0)),
                     destino='em_desenvolvimento')
        self._evento(1, timezone.make_aware(dt.datetime(2026, 10, 5, 11, 0)))

        self.assertEqual(self._contar(SETEMBRO), 0)
        self.assertEqual(self._contar(OUTUBRO), 1)

    def test_conta_sem_nenhum_chamado_na_tabela_local(self):
        """A trava contra a volta do bug de um mes inteiro.

        A versao anterior desta correcao lia `ChamadoSuporte`, que em producao
        esta VAZIA, e por isso devolvia zero parecendo certa. Aqui nao existe
        nenhuma linha em `ChamadoSuporte` — e o numero tem que sair. Se alguem
        reintroduzir a dependencia daquela tabela, este teste cai.
        """
        from apps.formularios.models import ChamadoSuporte

        self._evento(7, timezone.make_aware(dt.datetime(2026, 9, 11, 8, 0)))

        self.assertEqual(ChamadoSuporte.objects.count(), 0)
        self.assertEqual(self._contar(SETEMBRO), 1)

    # -- bordas do periodo ------------------------------------------------

    def test_o_ultimo_dia_do_mes_entra_inteiro(self):
        """Mesma classe de erro que `apps/reports/periodo.py` existe para evitar.

        Resolvido as 23h do dia 30: um `__lte` do dia 30 as 00:00 descartaria.
        """
        self._evento(1, timezone.make_aware(dt.datetime(2026, 9, 30, 23, 0)))

        self.assertEqual(self._contar(SETEMBRO), 1)

    def test_o_primeiro_dia_do_mes_entra_desde_a_meia_noite(self):
        self._evento(1, timezone.make_aware(dt.datetime(2026, 9, 1, 0, 30)))

        self.assertEqual(self._contar(SETEMBRO), 1)

    # -- o que fica de fora, e por que ------------------------------------

    def test_sem_evento_de_etapa_fica_de_fora(self):
        """Sem data de conclusao ele nao pertence a mes nenhum.

        Entrar com a data errada seria pior que nao entrar. A tela de Metricas
        mostra um aviso com a contagem desses casos, para eles nao sumirem em
        silencio — que e a diferenca entre omitir e esconder.
        """
        ChamadoSuporteTimeline.objects.create(
            chamado_id=1,
            tipo_evento=ChamadoSuporteTimelineTipo.COMENTARIO,
            descricao='Comentario qualquer')

        self.assertEqual(self._contar(SETEMBRO), 0)
        self.assertEqual(self._contar(OUTUBRO), 0)

    def test_vale_a_ULTIMA_troca_de_etapa(self):
        """Um chamado reaberto e resolvido de novo conta na segunda vez.

        A tela faz o mesmo (ordena por `-data` e pega o primeiro), e as duas
        precisam concordar.
        """
        self._evento(1, timezone.make_aware(dt.datetime(2026, 9, 10, 10, 0)))
        self._evento(1, timezone.make_aware(dt.datetime(2026, 10, 8, 16, 0)))

        self.assertEqual(self._contar(SETEMBRO), 0)
        self.assertEqual(self._contar(OUTUBRO), 1)

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
        """A regra mora em `apps.reports.suporte`, nao dentro do gerador."""
        import inspect

        from apps.reports import suporte

        fonte = inspect.getsource(suporte.contar_resolvidos_no_periodo)
        self.assertIn('ChamadoSuporteTimeline', fonte)
        self.assertIn('ETAPA_ALTERADA', fonte)


class OsDoisRelatoriosNaoPodemDivergirTests(MontaTimeline, TestCase):
    """Executivo e Metricas contam chamados resolvidos do MESMO jeito.

    Os dois tinham a consulta escrita separadamente, cada um com um comentario
    dizendo que deviam ficar "em sincronia". Consertar so um faria os dois
    darem numeros diferentes para o mesmo mes — pior que o erro original, porque
    dois numeros divergentes destroem a confianca nos dois.

    Agora os dois chamam `apps.reports.suporte.contar_resolvidos_no_periodo`.
    Esta suite existe para que continuem chamando.
    """

    def setUp(self):
        self.user = User.objects.create_user(
            username='rel_dois', email='rel.dois@example.com',
            password='x' * 12, role='admin', is_superuser=True, is_staff=True)

    def _executivo(self):
        job = ReportJob(user=self.user, type='executive', format='pdf',
                        filters=dict(SETEMBRO))
        return executive.Report(job).fetch_data()['support_resolved']

    def _metricas(self):
        from apps.reports.generators import metrics
        job = ReportJob(user=self.user, type='metrics', format='pdf',
                        filters=dict(SETEMBRO))
        return metrics.Report(job).fetch_data()['operations']['support_resolved']

    def test_os_dois_dao_o_mesmo_numero(self):
        self._evento(1, timezone.make_aware(dt.datetime(2026, 9, 15, 14, 0)))
        self._evento(2, timezone.make_aware(dt.datetime(2026, 10, 5, 14, 0)))

        self.assertEqual(self._executivo(), 1)
        self.assertEqual(self._metricas(), 1)
        self.assertEqual(
            self._executivo(), self._metricas(),
            'os dois relatorios divergiram sobre o mesmo mes')

    def test_reaberto_nao_move_nenhum_dos_dois(self):
        """O criterio da ultima movimentacao vale nos dois geradores."""
        self._evento(1, timezone.make_aware(dt.datetime(2026, 9, 10, 10, 0)))
        self._evento(1, timezone.make_aware(dt.datetime(2026, 9, 20, 10, 0)),
                     destino='em_desenvolvimento')

        self.assertEqual(self._executivo(), 0)
        self.assertEqual(self._metricas(), 0)

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
                'contar_resolvidos_no_periodo', fonte,
                '`%s` deixou de usar o modulo compartilhado de suporte.' % nome)
            self.assertNotIn(
                'data_atualizacao__', fonte,
                '`%s` voltou a recortar o periodo por `data_atualizacao`, que '
                'e auto_now.' % nome)


class ContagemDeResolvidosPelaTimelineTests(MontaTimeline, TestCase):
    """A contagem em si, sem passar pelos geradores.

    POR QUE PELA TIMELINE: os chamados vivem no portal externo e a tabela local
    `ChamadoSuporte` tem zero linhas, entao a consulta que a lia devolvia ZERO em
    qualquer mes — e sempre devolveu. A timeline, essa sim, e gravada aqui.

    POR QUE PELA CHAVE, E NAO PELO ROTULO: a `descricao` do evento e montada pelo
    FRONTEND com o rotulo de exibicao da etapa ('Concluido'). Contar a partir
    daquele texto faria um relatorio do backend depender de um texto de
    interface: renomear a etapa na tela derrubaria o numero em silencio, e
    eventos antigos e novos passariam a discordar entre si.

    `ChamadoSuporteTimeline.etapa_destino` guarda a CHAVE, e a migracao 0014
    preencheu o historico — 1010 de 1010 eventos, nenhum rotulo fora do mapa.
    """

    def _contar(self, periodo):
        return contar_resolvidos_no_periodo(
            inicio_do_periodo(periodo['period_start']),
            fim_do_periodo(periodo['period_end']),
        )

    # -- o basico ---------------------------------------------------------

    def test_conta_no_mes_em_que_foi_concluido(self):
        self._evento(1, timezone.make_aware(dt.datetime(2026, 9, 15, 10, 0)))

        self.assertEqual(self._contar(SETEMBRO), 1)
        self.assertEqual(self._contar(OUTUBRO), 0)

    def test_movimento_para_outra_etapa_nao_conta(self):
        """Mover para 'em andamento' nao e entrega."""
        self._evento(1, timezone.make_aware(dt.datetime(2026, 9, 15, 10, 0)),
                     destino='em_desenvolvimento')

        self.assertEqual(self._contar(SETEMBRO), 0)

    def test_inviabilizado_nao_conta_como_resolvido(self):
        self._evento(1, timezone.make_aware(dt.datetime(2026, 9, 15, 10, 0)),
                     destino='inviabilizado')

        self.assertEqual(self._contar(SETEMBRO), 0)

    # -- a armadilha do reaberto ------------------------------------------

    def test_chamado_reaberto_depois_de_concluido_NAO_conta(self):
        """Vale a ULTIMA movimentacao, nao qualquer uma.

        Um `filter(etapa_destino='finalizado')` cru responderia "teve ALGUM
        movimento para concluido" e contaria este chamado, que hoje esta aberto
        de novo. E o erro mais facil de cometer nesta consulta.
        """
        self._evento(1, timezone.make_aware(dt.datetime(2026, 9, 10, 10, 0)))
        self._evento(1, timezone.make_aware(dt.datetime(2026, 9, 20, 10, 0)),
                     destino='em_desenvolvimento')

        self.assertEqual(
            self._contar(SETEMBRO), 0,
            'chamado reaberto depois de concluido ainda conta como entregue')

    def test_reaberto_e_concluido_de_novo_conta_na_SEGUNDA_vez(self):
        self._evento(1, timezone.make_aware(dt.datetime(2026, 9, 10, 10, 0)))
        self._evento(1, timezone.make_aware(dt.datetime(2026, 9, 20, 10, 0)),
                     destino='em_desenvolvimento')
        self._evento(1, timezone.make_aware(dt.datetime(2026, 10, 5, 10, 0)))

        self.assertEqual(self._contar(SETEMBRO), 0)
        self.assertEqual(self._contar(OUTUBRO), 1)

    def test_chamados_diferentes_somam(self):
        """A guarda contra contar chamado, e nao evento.

        Os dois chamados foram concluidos no mesmo mes; o numero e 2. Um
        `.distinct()` perdido ou um `set` so de `chamado_id` daria 1.
        """
        self._evento(1, timezone.make_aware(dt.datetime(2026, 9, 10, 10, 0)))
        self._evento(2, timezone.make_aware(dt.datetime(2026, 9, 11, 10, 0)))

        self.assertEqual(self._contar(SETEMBRO), 2)

    # -- o acoplamento que foi removido -----------------------------------

    def test_a_contagem_NAO_le_a_descricao(self):
        """A trava do refactor.

        O evento abaixo tem a chave certa e uma descricao sem relacao nenhuma
        com 'Concluido'. Se a contagem voltar a ler o texto, ele some.
        """
        self._evento(1, timezone.make_aware(dt.datetime(2026, 9, 15, 10, 0)),
                     descricao='qualquer coisa que nao menciona a etapa')

        self.assertEqual(
            self._contar(SETEMBRO), 1,
            'a contagem voltou a depender do texto da descricao')

    def test_o_modulo_nao_tem_rotulo_de_interface(self):
        """Nenhum rotulo de exibicao no codigo da contagem."""
        import inspect

        from apps.reports import suporte

        fonte = inspect.getsource(suporte.contar_resolvidos_no_periodo)
        for rotulo in ('Concluído', 'Concluido', 'Etapa do quadro'):
            self.assertNotIn(
                rotulo, fonte,
                'a contagem voltou a depender do rotulo de interface %r. A '
                'chave vive em `etapa_destino`.' % rotulo)

    # -- bordas do periodo ------------------------------------------------

    def test_o_ultimo_dia_do_mes_entra_inteiro(self):
        self._evento(1, timezone.make_aware(dt.datetime(2026, 9, 30, 23, 30)))

        self.assertEqual(self._contar(SETEMBRO), 1)

    def test_a_virada_do_mes_pertence_a_outubro(self):
        """A ponta de CIMA do periodo, no instante exato.

        `fim_do_periodo('2026-09-30')` e 01/10 00:00, e o intervalo e
        semi-aberto `[inicio, fim)`. Um evento exatamente na virada pertence a
        outubro, nao a setembro — e a mesma classe de erro que
        `apps/reports/periodo.py` existe para evitar, agora do outro lado.

        ESTE TESTE NASCEU DE UMA MUTACAO QUE SOBREVIVEU: trocar `data >=
        period_end` por `data > period_end` nao quebrava nada, porque o teste
        de borda que existia parava as 23h30 e nunca encostava no limite.
        """
        self._evento(1, timezone.make_aware(dt.datetime(2026, 10, 1, 0, 0)))

        self.assertEqual(
            self._contar(SETEMBRO), 0,
            'a virada do mes entrou em setembro: a ponta de cima virou inclusiva')
        self.assertEqual(self._contar(OUTUBRO), 1)

    def test_evento_sem_etapa_destino_fica_de_fora(self):
        """Registro antigo que a migracao nao alcancou, ou gravado sem a chave.

        Fica de fora em vez de entrar com palpite. Se isto comecar a acontecer
        com eventos NOVOS, e sinal de que algum chamador do frontend parou de
        mandar a chave.
        """
        self._evento(
            1, timezone.make_aware(dt.datetime(2026, 9, 15, 10, 0)),
            destino='',
            descricao='Etapa do quadro: "Em desenvolvimento" -> "Concluído".')

        self.assertEqual(self._contar(SETEMBRO), 0)

"""A regra de prazo, vista de dentro dos geradores de relatório.

`apps.projects.tests_prazo` cobre a regra em si. Esta suíte cobre outra coisa:
que os geradores REALMENTE a chamam. A distinção não é acadêmica — foi
exatamente aqui que o defeito passou.

O commit que estendeu a tolerância para o card em aberto trocou o FILTRO de
`bottlenecks.py` e esqueceu a COLUNA de dias do mesmo arquivo. A regra estava
certa, os testes da regra passavam, e o relatório mostrava um número apurado por
subtração crua — divergindo do relatório irmão, que havia sido corrigido no
mesmo commit. Nenhum teste percebeu, porque nenhum teste olhava para os
geradores.

A auditoria que encontrou isso registrou o motivo em uma linha: "as linhas
alteradas nos três geradores de relatório não têm cobertura automatizada
nenhuma". Esta suíte é a resposta.
"""
import datetime as dt

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone

from apps.accounts.models import SetorCatalogo
from apps.projects.models import Card, CardStatus, Project, Sprint
from apps.projects.prazo import TOLERANCIA_DO_PRAZO
from apps.reports.generators import backlog, bottlenecks, executive
from apps.reports.models import ReportJob

User = get_user_model()


class PrazoNosGeradoresTests(TestCase):
    """Os geradores respeitam o minuto de tolerância, nos dois lados."""

    def setUp(self):
        self.user = User.objects.create_user(
            username='ger_prazo', email='ger.prazo@example.com', password='x' * 12,
            role='admin', is_superuser=True, is_staff=True)
        self.setor = SetorCatalogo.objects.create(
            codename='ger_setor', nome='Geradores')

        self.agora = timezone.now()
        self.sprint = Sprint.objects.create(
            nome='Sprint dos geradores', data_inicio=self.agora - dt.timedelta(days=10),
            fechamento_em=self.agora + dt.timedelta(days=10), duracao_dias=20,
            supervisor=self.user, setor=self.setor)
        self.projeto = Project.objects.create(
            nome='Projeto dos geradores', sprint=self.sprint, setor=self.setor)

    # -- fábricas ---------------------------------------------------------

    def _aberto_vencido_ha(self, delta, nome):
        """Card em desenvolvimento cujo prazo venceu há `delta`.

        `delta` é medido a partir do PRAZO, não do limite real — é assim que o
        defeito aparece: um card vencido há "um dia e trinta segundos" tem zero
        dias inteiros de atraso, porque o prazo só expirou um minuto depois.
        """
        return Card.objects.create(
            nome=nome, projeto=self.projeto, criado_por=self.user,
            status=CardStatus.EM_DESENVOLVIMENTO,
            data_fim=self.agora - delta)

    def _entregue_com_estouro_de(self, delta, nome):
        """Card finalizado que passou `delta` do prazo."""
        prazo = self.agora - dt.timedelta(days=30)
        card = Card.objects.create(
            nome=nome, projeto=self.projeto, criado_por=self.user,
            status=CardStatus.EM_DESENVOLVIMENTO, data_fim=prazo)
        Card.objects.filter(pk=card.pk).update(
            status=CardStatus.FINALIZADO, finalizado_em=prazo + delta)
        card.refresh_from_db()
        return card

    def _linhas(self, modulo, tipo):
        job = ReportJob(user=self.user, type=tipo, format='xlsx', filters={})
        gerador = modulo.Report(job)
        return {
            linha['nome']: linha
            for linha in gerador.table_rows(gerador.fetch_data())
            if 'nome' in linha
        }

    # -- o defeito que passou ---------------------------------------------

    def test_a_coluna_de_dias_de_gargalos_desconta_a_tolerancia(self):
        """O caso exato que escapou: um dia e trinta segundos não é um dia.

        O prazo venceu 30 segundos DEPOIS da marca de 24 horas, porque o minuto
        de tolerância empurra o limite. Por subtração crua dá 1; pela regra dá
        0. Este teste falha se alguém reverter a coluna para a subtração.
        """
        um_dia_e_pouco = dt.timedelta(days=1, seconds=30)
        self._aberto_vencido_ha(um_dia_e_pouco, 'Vencido um dia e trinta')

        linhas = self._linhas(bottlenecks, 'bottlenecks')

        self.assertIn('Vencido um dia e trinta', linhas)
        self.assertEqual(
            linhas['Vencido um dia e trinta']['atraso_dias'], 0,
            'a coluna voltou a subtrair o prazo cru em vez de usar a regra')

    def test_as_duas_colunas_de_gargalos_usam_a_mesma_formula(self):
        """Entregue atrasado e em aberto atrasado, o MESMO estouro.

        As duas categorias dividem a coluna "Atraso (dias)". Um estouro de um
        dia e trinta segundos precisa dar o mesmo número nas duas, senão o
        leitor compara duas linhas do mesmo relatório e vê números diferentes
        para a mesma coisa.
        """
        estouro = dt.timedelta(days=1, seconds=30)
        self._aberto_vencido_ha(estouro, 'Aberto com estouro')
        self._entregue_com_estouro_de(estouro, 'Entregue com estouro')

        linhas = self._linhas(bottlenecks, 'bottlenecks')

        self.assertIn('Aberto com estouro', linhas)
        self.assertIn('Entregue com estouro', linhas)
        self.assertEqual(
            linhas['Aberto com estouro']['atraso_dias'],
            linhas['Entregue com estouro']['atraso_dias'],
            'as duas categorias da mesma coluna apuram o atraso de jeitos '
            'diferentes')

    def test_a_coluna_de_backlog_concorda_com_a_de_gargalos(self):
        """Dois relatórios, o mesmo card, o mesmo número.

        É a divergência que a auditoria mediu: gargalos dizia 1 e backlog dizia
        0 para o mesmo card, na janela de 60 segundos depois de cada virada de
        dia.
        """
        self._aberto_vencido_ha(dt.timedelta(days=1, seconds=30), 'Card dos dois')

        de_gargalos = self._linhas(bottlenecks, 'bottlenecks')
        de_backlog = self._linhas(backlog, 'backlog')

        self.assertIn('Card dos dois', de_gargalos)
        self.assertIn('Card dos dois', de_backlog)
        self.assertEqual(
            de_gargalos['Card dos dois']['atraso_dias'],
            de_backlog['Card dos dois']['dias_em_atraso'],
            'os dois relatórios discordam sobre o atraso do mesmo card')

    # -- o filtro, e não só a coluna --------------------------------------

    def test_gargalos_nao_lista_card_dentro_do_minuto_do_prazo(self):
        """Prazo vencido há 30 segundos ainda não é prazo vencido."""
        self._aberto_vencido_ha(dt.timedelta(seconds=30), 'Dentro do minuto')
        self._aberto_vencido_ha(dt.timedelta(seconds=90), 'Passou do minuto')

        nomes = set(self._linhas(bottlenecks, 'bottlenecks'))

        self.assertNotIn('Dentro do minuto', nomes)
        self.assertIn('Passou do minuto', nomes)

    def test_o_executivo_nao_conta_card_dentro_do_minuto_do_prazo(self):
        """A contagem de abertos atrasados do executivo, na fronteira."""
        job = ReportJob(user=self.user, type='executive', format='pdf', filters={})

        self._aberto_vencido_ha(dt.timedelta(seconds=30), 'Executivo dentro')
        dentro = executive.Report(job).fetch_data()['open_late']

        self._aberto_vencido_ha(dt.timedelta(seconds=90), 'Executivo fora')
        fora = executive.Report(job).fetch_data()['open_late']

        self.assertEqual(dentro, 0, 'contou um card que ainda está no prazo')
        self.assertEqual(fora, 1, 'não contou o card que passou do prazo')

    def test_card_sem_prazo_nao_entra_em_nenhum_dos_tres(self):
        """A troca do filtro tirou a cláusula de NULL explícita.

        `data_fim__lt=now` excluía NULL por acidente do SQL; `q_prazo_vencido`
        precisa excluir também. Este teste é o que garante isso no caminho real
        dos geradores, e não só no unitário da regra.
        """
        Card.objects.create(
            nome='Sem prazo nenhum', projeto=self.projeto, criado_por=self.user,
            status=CardStatus.EM_DESENVOLVIMENTO, data_fim=None)

        job = ReportJob(user=self.user, type='executive', format='pdf', filters={})

        self.assertNotIn('Sem prazo nenhum', set(self._linhas(bottlenecks, 'bottlenecks')))
        self.assertEqual(executive.Report(job).fetch_data()['open_late'], 0)

    def test_a_tolerancia_dos_geradores_e_a_da_regra(self):
        """Nenhum gerador tem número mágico próprio.

        Se alguém mudar TOLERANCIA_DO_PRAZO, os geradores têm de acompanhar.
        O teste amarra o cenário à constante em vez de a "60 segundos".

        RELÓGIO CONGELADO, E NÃO É PRECIOSISMO. A primeira versão deste teste
        montava os cards a partir de `self.agora` (de `setUp`) e deixava o
        gerador ler `timezone.now()` — ou seja, um instante DEPOIS. Com margem
        de um segundo, bastava a suíte estar carregada para o card "um segundo
        antes do limite" cruzar o limite no meio do caminho e o teste falhar
        sem nada ter quebrado. Aconteceu de verdade, numa suíte de 46 testes.

        Congelar é o que permite manter a margem de UM segundo, que é o ponto:
        alargá-la para trinta deixaria o teste estável e sem valor, porque ele
        deixaria de medir a fronteira.
        """
        from unittest.mock import patch

        quase = TOLERANCIA_DO_PRAZO - dt.timedelta(seconds=1)
        passou = TOLERANCIA_DO_PRAZO + dt.timedelta(seconds=1)

        self._aberto_vencido_ha(quase, 'Um segundo antes do limite')
        self._aberto_vencido_ha(passou, 'Um segundo depois do limite')

        # O mesmo instante que montou os cards é o que o gerador vai ler.
        with patch('apps.reports.generators.bottlenecks.timezone.now',
                   return_value=self.agora):
            nomes = set(self._linhas(bottlenecks, 'bottlenecks'))

        self.assertNotIn('Um segundo antes do limite', nomes)
        self.assertIn('Um segundo depois do limite', nomes)

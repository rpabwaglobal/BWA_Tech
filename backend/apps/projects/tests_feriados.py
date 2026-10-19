"""A unica fonte de feriados do sistema, e o endpoint que a publica.

POR QUE ESTA SUITE EXISTE. Ate 19/10/2026 havia TRES respostas diferentes para
"este dia e feriado?" — uma no frontend, uma no fallback do backend e uma na API
externa — e as tres discordavam entre si. A API nunca chegou a funcionar: a
tabela de cache tinha zero linhas em producao e a chave nunca foi configurada,
entao o backend vinha respondendo pelo fallback de oito datas fixas, sem
Carnaval, sem Sexta-feira Santa, sem Corpus Christi e sem o 20/11.

Os testes abaixo travam as duas metades da regra separadamente, porque elas
falham de jeitos diferentes: a calculada falha se o algoritmo estiver errado, a
cadastrada falha se alguem esquecer de consultar o banco.
"""
from datetime import date

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from apps.projects.feriados import (
    ANO_CONSCIENCIA_NEGRA, e_dia_util, feriados_entre, nacionais_do_ano, pascoa,
)
from apps.projects.models import Feriado

User = get_user_model()


class PascoaTests(TestCase):
    """O algoritmo de Meeus/Jones/Butcher, contra datas publicadas.

    Tudo que e movel no calendario brasileiro sai daqui, entao um erro nesta
    funcao erra quatro feriados por ano de uma vez.
    """

    def test_domingos_de_pascoa_conhecidos(self):
        esperado = {
            2023: date(2023, 4, 9),
            2024: date(2024, 3, 31),
            2025: date(2025, 4, 20),
            2026: date(2026, 4, 5),
            2027: date(2027, 3, 28),
        }
        for ano, dia in esperado.items():
            self.assertEqual(pascoa(ano), dia, 'Pascoa de %d' % ano)

    def test_pascoa_cai_sempre_em_domingo(self):
        """Uma propriedade, nao uma tabela: vale para qualquer ano."""
        for ano in range(2000, 2101):
            self.assertEqual(
                pascoa(ano).weekday(), 6,
                'Pascoa de %d nao caiu num domingo' % ano)


class NacionaisCalculadosTests(TestCase):

    def test_os_moveis_de_2026(self):
        dias = nacionais_do_ano(2026)

        self.assertIn(date(2026, 2, 16), dias, 'carnaval, segunda')
        self.assertIn(date(2026, 2, 17), dias, 'carnaval, terca')
        self.assertIn(date(2026, 4, 3), dias, 'sexta-feira santa')
        self.assertIn(date(2026, 6, 4), dias, 'corpus christi')

    def test_os_fixos_de_2026(self):
        dias = nacionais_do_ano(2026)
        for mes, dia in ((1, 1), (4, 21), (5, 1), (9, 7), (10, 12),
                         (11, 2), (11, 15), (12, 25)):
            self.assertIn(date(2026, mes, dia), dias)

    def test_consciencia_negra_vale_a_partir_de_2024(self):
        """A Lei 14.759/2023 tornou o 20/11 nacional. Antes disso, nao era.

        Contar o 20/11 em anos anteriores mudaria o tempo de desenvolvimento de
        cards ja fechados em 2023 — numero errado, no passado, sem ninguem ter
        pedido.
        """
        self.assertIn(date(ANO_CONSCIENCIA_NEGRA, 11, 20),
                      nacionais_do_ano(ANO_CONSCIENCIA_NEGRA))
        self.assertNotIn(date(ANO_CONSCIENCIA_NEGRA - 1, 11, 20),
                         nacionais_do_ano(ANO_CONSCIENCIA_NEGRA - 1))

    def test_dia_comum_nao_entra(self):
        self.assertNotIn(date(2026, 3, 3), nacionais_do_ano(2026))


class FeriadosEntreTests(TestCase):
    """A uniao das duas metades, que e o que o resto do sistema consome."""

    def test_junta_calculado_e_cadastrado(self):
        Feriado.objects.create(
            data=date(2026, 6, 29), nome='Sao Pedro', abrangencia='municipal')

        dias = feriados_entre(date(2026, 1, 1), date(2026, 12, 31))

        self.assertIn(date(2026, 5, 1), dias, 'nacional calculado sumiu')
        self.assertIn(date(2026, 6, 29), dias, 'cadastrado sumiu')

    def test_atravessa_a_virada_do_ano(self):
        """Um intervalo de dezembro a janeiro precisa dos DOIS anos."""
        dias = feriados_entre(date(2025, 12, 1), date(2026, 1, 31))

        self.assertIn(date(2025, 12, 25), dias)
        self.assertIn(date(2026, 1, 1), dias)

    def test_nao_devolve_nada_fora_do_intervalo(self):
        """A guarda contra devolver o ano inteiro quando pedem uma semana."""
        Feriado.objects.create(
            data=date(2026, 6, 29), nome='Sao Pedro', abrangencia='municipal')

        dias = feriados_entre(date(2026, 4, 1), date(2026, 4, 30))

        self.assertIn(date(2026, 4, 3), dias, 'sexta-feira santa')
        self.assertIn(date(2026, 4, 21), dias, 'tiradentes')
        self.assertNotIn(date(2026, 5, 1), dias)
        self.assertNotIn(date(2026, 6, 29), dias)
        self.assertTrue(all(date(2026, 4, 1) <= d <= date(2026, 4, 30) for d in dias))

    def test_intervalo_invertido_nao_devolve_vazio(self):
        """Quem troca inicio e fim recebe o intervalo, nao um silencio."""
        dias = feriados_entre(date(2026, 12, 31), date(2026, 1, 1))

        self.assertIn(date(2026, 5, 1), dias)

    def test_fim_de_semana_NAO_entra(self):
        """Feriado e fim de semana sao perguntas separadas, de proposito.

        Quem chama combina as duas; junta-las aqui esconderia qual das duas
        tirou o dia, e o frontend precisa justamente distinguir isso.
        """
        dias = feriados_entre(date(2026, 3, 1), date(2026, 3, 31))

        self.assertNotIn(date(2026, 3, 7), dias, 'sabado comum entrou')
        self.assertNotIn(date(2026, 3, 8), dias, 'domingo comum entrou')


class EDiaUtilTests(TestCase):

    def test_sabado_e_domingo_nao_sao_uteis(self):
        self.assertFalse(e_dia_util(date(2026, 3, 7)))
        self.assertFalse(e_dia_util(date(2026, 3, 8)))

    def test_feriado_nacional_nao_e_util(self):
        self.assertFalse(e_dia_util(date(2026, 5, 1)))

    def test_feriado_cadastrado_nao_e_util(self):
        Feriado.objects.create(
            data=date(2026, 6, 29), nome='Sao Pedro', abrangencia='municipal')

        self.assertFalse(e_dia_util(date(2026, 6, 29)))

    def test_terca_comum_e_util(self):
        self.assertTrue(e_dia_util(date(2026, 3, 3)))


class EndpointDeFeriadosTests(TestCase):

    def setUp(self):
        self.user = User.objects.create_user(
            username='feriados_api', email='feriados@example.com',
            password='x' * 12, role='admin')
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.url = reverse('feriados')

    def test_exige_autenticacao(self):
        self.assertIn(APIClient().get(self.url).status_code, (401, 403))

    def test_devolve_calculados_e_cadastrados(self):
        Feriado.objects.create(
            data=date(2026, 6, 29), nome='Sao Pedro', abrangencia='municipal')

        r = self.client.get(self.url, {'inicio': '2026-01-01', 'fim': '2026-12-31'})

        self.assertEqual(r.status_code, 200)
        self.assertIn('2026-05-01', r.data['feriados'])
        self.assertIn('2026-06-29', r.data['feriados'])
        self.assertIn('2026-11-20', r.data['feriados'])

    def test_vem_ordenado(self):
        r = self.client.get(self.url, {'inicio': '2026-01-01', 'fim': '2026-12-31'})

        self.assertEqual(r.data['feriados'], sorted(r.data['feriados']))

    def test_sem_parametros_devolve_uma_janela_util(self):
        """Sem filtro o cliente recebe algo utilizavel, nao um erro nem o vazio."""
        r = self.client.get(self.url)

        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.data['feriados'])

    def test_recusa_intervalo_invertido(self):
        r = self.client.get(self.url, {'inicio': '2026-12-31', 'fim': '2026-01-01'})

        self.assertEqual(r.status_code, 400)

    def test_recusa_intervalo_absurdo(self):
        """O teto. Sem ele, um pedido de seculos monta um conjunto gigante."""
        r = self.client.get(self.url, {'inicio': '1900-01-01', 'fim': '2099-12-31'})

        self.assertEqual(r.status_code, 400)

    def test_recusa_data_invalida(self):
        r = self.client.get(self.url, {'inicio': 'ontem', 'fim': '2026-01-01'})

        self.assertEqual(r.status_code, 400)

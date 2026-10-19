"""Tempo de desenvolvimento dos cards, em dias e minutos uteis.

A REGRA DE FERIADO MUDOU DE DONO. Este modulo lia a tabela de cache da API
externa e, quando ela vinha vazia, caia num fallback de oito datas fixas. Medido
em producao em 19/10/2026: a tabela tinha ZERO linhas, a chave da API nunca foi
configurada e o sync so rodava por comando manual que ninguem chamava — ou seja,
o fallback era o caminho NORMAL, e o calculo vinha ignorando Carnaval,
Sexta-feira Santa, Corpus Christi e o 20/11 em silencio.

Agora a resposta vem de `apps.projects.feriados`, unica no sistema.
"""
from datetime import date, datetime
from unittest.mock import patch
from zoneinfo import ZoneInfo

from django.test import TestCase
from django.utils import timezone

from apps.projects.business_time import calculate_development_time
from apps.projects.models import Feriado

TZ = ZoneInfo('America/Sao_Paulo')


def _local_dt(y, m, d, h, mi=0):
    return timezone.make_aware(datetime(y, m, d, h, mi), TZ)


def _dia_inteiro(y, m, d):
    """Um expediente completo naquele dia, das 8h as 17h."""
    return calculate_development_time(_local_dt(y, m, d, 8), _local_dt(y, m, d, 17))


class BusinessTimeTests(TestCase):
    def test_full_business_day_nine_hours(self):
        start = _local_dt(2026, 3, 2, 7, 30)  # segunda
        end = _local_dt(2026, 3, 2, 17, 30)
        result = calculate_development_time(start, end)
        self.assertIsNotNone(result)
        self.assertEqual(result['dias_uteis_desenvolvimento'], 1)
        self.assertEqual(result['minutos_uteis_desenvolvimento'], 540)

    def test_partial_same_day(self):
        start = _local_dt(2026, 3, 2, 10, 0)
        end = _local_dt(2026, 3, 2, 11, 0)
        result = calculate_development_time(start, end)
        self.assertEqual(result['minutos_uteis_desenvolvimento'], 60)
        self.assertEqual(result['dias_uteis_desenvolvimento'], 1)

    def test_skips_weekend(self):
        # Sexta 16h ate segunda 9h — so a tarde de sexta e a manha de segunda.
        start = _local_dt(2026, 3, 6, 16, 0)  # sexta
        end = _local_dt(2026, 3, 9, 9, 0)  # segunda
        result = calculate_development_time(start, end)
        self.assertGreaterEqual(result['dias_uteis_desenvolvimento'], 2)

    def test_dias_corridos_one_day(self):
        start = _local_dt(2026, 3, 2, 7, 30)
        end = _local_dt(2026, 3, 3, 7, 30)
        result = calculate_development_time(start, end)
        self.assertEqual(result['segundos_corridos_desenvolvimento'], 86400)


class FeriadoNaoContaComoTempoDeDesenvolvimentoTests(TestCase):
    """Cada metade da regra de feriado, conferida num DIA DE SEMANA.

    A SUITE ANTIGA USAVA 25/01/2026 PARA ISSO, QUE E UM DOMINGO. O teste chamado
    `test_holiday_from_cache` afirmava que o dia nao contava por ser feriado,
    mas ele nao contaria de qualquer jeito — passaria com a regra de feriado
    inteiramente removida. As datas abaixo sao todas dia de semana, e cada uma
    traz o dia da semana escrito ao lado para a proxima pessoa nao repetir o
    engano.
    """

    def test_dia_comum_de_semana_conta(self):
        """A referencia. Sem ela os testes abaixo nao provam nada."""
        r = _dia_inteiro(2026, 3, 3)  # terca comum
        self.assertEqual(r['dias_uteis_desenvolvimento'], 1)

    # -- metade calculada: os nacionais -----------------------------------

    def test_feriado_nacional_fixo_nao_conta(self):
        r = _dia_inteiro(2026, 5, 1)  # sexta, Dia do Trabalhador
        self.assertEqual(r['dias_uteis_desenvolvimento'], 0)
        self.assertEqual(r['minutos_uteis_desenvolvimento'], 0)

    def test_carnaval_nao_conta(self):
        """Carnaval nao estava no fallback antigo — era dia util no calculo."""
        r = _dia_inteiro(2026, 2, 17)  # terca de carnaval
        self.assertEqual(r['dias_uteis_desenvolvimento'], 0)

    def test_sexta_feira_santa_nao_conta(self):
        r = _dia_inteiro(2026, 4, 3)  # sexta-feira santa
        self.assertEqual(r['dias_uteis_desenvolvimento'], 0)

    def test_corpus_christi_nao_conta(self):
        r = _dia_inteiro(2026, 6, 4)  # quinta
        self.assertEqual(r['dias_uteis_desenvolvimento'], 0)

    def test_consciencia_negra_nao_conta(self):
        """Faltava nas DUAS implementacoes antigas, desde 2024."""
        r = _dia_inteiro(2026, 11, 20)  # sexta
        self.assertEqual(r['dias_uteis_desenvolvimento'], 0)

    # -- metade cadastrada: o que a equipe mantem -------------------------

    def test_feriado_cadastrado_nao_conta(self):
        dia = date(2026, 6, 29)  # segunda, Sao Pedro — municipal, nao calculavel
        self.assertEqual(
            _dia_inteiro(2026, 6, 29)['dias_uteis_desenvolvimento'], 1,
            'a data escolhida ja era feriado por outro motivo; o teste nao '
            'provaria nada')

        Feriado.objects.create(data=dia, nome='Sao Pedro', abrangencia='municipal')

        self.assertEqual(_dia_inteiro(2026, 6, 29)['dias_uteis_desenvolvimento'], 0)

    def test_feriado_cadastrado_de_outro_dia_nao_afeta(self):
        Feriado.objects.create(
            data=date(2026, 6, 29), nome='Sao Pedro', abrangencia='municipal')

        self.assertEqual(_dia_inteiro(2026, 3, 3)['dias_uteis_desenvolvimento'], 1)


class OCalculoNaoFalaComARedeTests(TestCase):
    """A trava que sobreviveu a remocao da API externa.

    O modulo que buscava feriados por HTTP foi removido, entao hoje nao ha o que
    chamar. Este teste fica porque o erro que ele guarda e facil de repetir: uma
    chamada de rede dentro do `pre_save` de um card ficaria presa esperando um
    servidor de terceiro, e o incidente de 24/08 mostrou que uma espera dessas
    derruba o site inteiro.
    """

    @patch('requests.get')
    @patch('requests.post')
    def test_calcular_tempo_nao_faz_http(self, mock_post, mock_get):
        calculate_development_time(
            _local_dt(2026, 3, 2, 8), _local_dt(2026, 6, 30, 17))

        mock_get.assert_not_called()
        mock_post.assert_not_called()

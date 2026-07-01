from datetime import date, datetime
from unittest.mock import patch
from zoneinfo import ZoneInfo

from django.test import TestCase
from django.utils import timezone

from apps.projects.business_time import calculate_development_time
from apps.projects.holiday_sync import holiday_dates_between
from apps.projects.models import CachedHoliday

TZ = ZoneInfo('America/Sao_Paulo')
NATAL_IBGE = 2408102


def _local_dt(y, m, d, h, mi=0):
    return timezone.make_aware(datetime(y, m, d, h, mi), TZ)


class BusinessTimeTests(TestCase):
    def test_full_business_day_nine_hours(self):
        start = _local_dt(2026, 3, 2, 7, 30)  # Monday
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
        # Fri 17:00 to Mon 09:00 — only Fri afternoon + Mon morning counted
        start = _local_dt(2026, 3, 6, 16, 0)  # Friday
        end = _local_dt(2026, 3, 9, 9, 0)  # Monday
        result = calculate_development_time(start, end)
        self.assertGreaterEqual(result['dias_uteis_desenvolvimento'], 2)

    def test_holiday_from_cache(self):
        CachedHoliday.objects.create(
            date=date(2026, 1, 25),
            year=2026,
            name='Aniversário de Natal',
            tipo='MUNICIPAL',
            ibge=NATAL_IBGE,
        )
        start = _local_dt(2026, 1, 25, 8, 0)
        end = _local_dt(2026, 1, 25, 17, 0)
        result = calculate_development_time(start, end)
        self.assertEqual(result['dias_uteis_desenvolvimento'], 0)
        self.assertEqual(result['minutos_uteis_desenvolvimento'], 0)

    def test_dias_corridos_one_day(self):
        start = _local_dt(2026, 3, 2, 7, 30)
        end = _local_dt(2026, 3, 3, 7, 30)
        result = calculate_development_time(start, end)
        self.assertEqual(result['segundos_corridos_desenvolvimento'], 86400)

    def test_fallback_national_holiday_with_partial_cache(self):
        """Nacionais fixos contam mesmo quando há cache parcial de outro ano."""
        CachedHoliday.objects.create(
            date=date(2026, 1, 25),
            year=2026,
            name='Aniversário de Natal',
            tipo='MUNICIPAL',
            ibge=NATAL_IBGE,
        )
        # 1º de maio (feriado nacional fixo) — segunda em 2026
        start = _local_dt(2026, 5, 1, 8, 0)
        end = _local_dt(2026, 5, 1, 17, 0)
        result = calculate_development_time(start, end)
        self.assertEqual(result['dias_uteis_desenvolvimento'], 0)
        self.assertEqual(result['minutos_uteis_desenvolvimento'], 0)

    @patch('apps.projects.holiday_sync.requests.get')
    def test_holiday_dates_between_does_not_call_api(self, mock_get):
        """Leitura de feriados no cálculo não deve disparar HTTP."""
        holiday_dates_between(date(2026, 1, 1), date(2026, 12, 31))
        mock_get.assert_not_called()

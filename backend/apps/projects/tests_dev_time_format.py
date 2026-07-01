from apps.projects.dev_time_format import (
    average_minutos_uteis,
    format_average_minutos_uteis,
    format_average_segundos_corridos,
    format_minutos_uteis,
    format_segundos_corridos,
)
from django.test import SimpleTestCase


class DevTimeFormatTests(SimpleTestCase):
    def test_format_full_hours(self):
        self.assertEqual(format_minutos_uteis(540), '9h')

    def test_format_hours_and_minutes(self):
        self.assertEqual(format_minutos_uteis(90), '1h 30min')

    def test_format_minutes_only(self):
        self.assertEqual(format_minutos_uteis(45), '45min')

    def test_format_zero(self):
        self.assertEqual(format_minutos_uteis(0), '0min')

    def test_format_none(self):
        self.assertEqual(format_minutos_uteis(None), '—')

    def test_format_segundos_corridos(self):
        self.assertEqual(format_segundos_corridos(86400), '1d')
        self.assertEqual(format_segundos_corridos(90000), '1d 1h')
        self.assertEqual(format_segundos_corridos(7200), '2h')
        self.assertEqual(format_average_segundos_corridos(90000, 2), '12h 30min')

    def test_average_formatted(self):
        self.assertEqual(format_average_minutos_uteis(150, 2), '1h 15min')
        self.assertEqual(average_minutos_uteis(150, 2), 75)

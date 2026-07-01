from django.core.management.base import BaseCommand

from apps.projects.holiday_sync import sync_holidays_natal


class Command(BaseCommand):
    help = 'Sincroniza feriados de Natal/RN (Feriados API) para o cache local.'

    def add_arguments(self, parser):
        parser.add_argument('--ano', type=int, required=True, help='Ano (ex.: 2026)')
        parser.add_argument('--force', action='store_true', help='Rebusca mesmo se o ano já estiver em cache')

    def handle(self, *args, **options):
        year = options['ano']
        force = options['force']
        if year < 2000 or year > 2100:
            self.stdout.write(self.style.ERROR('Ano deve estar entre 2000 e 2100.'))
            raise SystemExit(1)
        try:
            count = sync_holidays_natal(year, force=force)
            self.stdout.write(self.style.SUCCESS(f'Feriados sincronizados para {year}: {count} novo(s) registro(s).'))
        except Exception as exc:
            self.stdout.write(self.style.ERROR(f'Falha ao sincronizar: {exc}'))
            raise SystemExit(1) from exc

"""Login no portal (PORTAL_* no .env) e GET na API externa de chamados."""

import requests
from django.conf import settings
from django.core.management.base import BaseCommand

from apps.formularios.portal_auth import PortalLoginError, login_on_portal


class Command(BaseCommand):
    help = 'Obtém JWT do portal e lista GET .../api/formularios/suporte/por-usuario/'

    def add_arguments(self, parser):
        parser.add_argument(
            '--usuario-email',
            type=str,
            default='',
            help='Query opcional usuario_email= (como na documentação)',
        )

    def handle(self, *args, **options):
        base = (settings.PORTAL_BASE_URL or '').strip().rstrip('/')
        if not base:
            self.stderr.write(self.style.ERROR('Defina PORTAL_BASE_URL no backend/.env'))
            raise SystemExit(1)

        try:
            token = login_on_portal()
        except PortalLoginError as exc:
            self.stderr.write(self.style.ERROR(str(exc)))
            raise SystemExit(1) from exc

        url = f'{base}/api/formularios/suporte/por-usuario/'
        params = {}
        if options['usuario_email'].strip():
            params['usuario_email'] = options['usuario_email'].strip()

        self.stdout.write(f'GET {url}')
        if params:
            self.stdout.write(f'params={params}')

        try:
            r = requests.get(
                url,
                params=params or None,
                headers={
                    'Authorization': f'Bearer {token}',
                    'Content-Type': 'application/json',
                },
                timeout=45,
            )
        except requests.RequestException as exc:
            self.stderr.write(self.style.ERROR(f'Erro de rede na listagem: {exc}'))
            raise SystemExit(1) from exc

        self.stdout.write(self.style.NOTICE(f'HTTP {r.status_code}'))
        self.stdout.write(r.text)

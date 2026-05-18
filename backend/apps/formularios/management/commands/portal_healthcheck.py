"""Healthcheck do proxy portal-formularios — útil pra diagnosticar em produção.

Verifica:
1. PORTAL_BASE_URL / PORTAL_USERNAME / PORTAL_PASSWORD setados.
2. Login no portal funciona (devolve JWT).
3. (opcional) Faz uma chamada GET de teste pra `suporte/catalogo/` pra confirmar
   que o JWT é aceito pelo portal e o endpoint responde.

Uso:
    python manage.py portal_healthcheck            # checa config + login
    python manage.py portal_healthcheck --probe    # + chamada GET de teste
"""
from __future__ import annotations

import requests
from django.conf import settings
from django.core.management.base import BaseCommand

from apps.formularios.portal_auth import PortalLoginError, login_on_portal


class Command(BaseCommand):
    help = 'Verifica a configuração do portal de formularios + testa login.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--probe',
            action='store_true',
            help='Adiciona uma chamada GET de teste a suporte/catalogo/ no portal.',
        )

    def handle(self, *args, **options):
        ok = True

        base = (getattr(settings, 'PORTAL_BASE_URL', '') or '').strip()
        user = (getattr(settings, 'PORTAL_USERNAME', '') or '').strip()
        pwd = getattr(settings, 'PORTAL_PASSWORD', '') or ''

        self.stdout.write('--- Variaveis de ambiente ---')
        self.stdout.write(f'PORTAL_BASE_URL  = {base or "(VAZIO)"}')
        self.stdout.write(f'PORTAL_USERNAME  = {user or "(VAZIO)"}')
        self.stdout.write(f'PORTAL_PASSWORD  = {"(definido)" if pwd else "(VAZIO)"}')

        if not base or not user or not pwd:
            self.stderr.write(self.style.ERROR(
                'FALHOU: uma ou mais variaveis PORTAL_* nao estao definidas no .env do servidor.'
            ))
            raise SystemExit(2)

        self.stdout.write('')
        self.stdout.write('--- Login no portal ---')
        try:
            token = login_on_portal()
        except PortalLoginError as exc:
            self.stderr.write(self.style.ERROR(f'FALHOU: {exc}'))
            raise SystemExit(3) from exc
        self.stdout.write(self.style.SUCCESS(
            f'OK: token recebido ({len(token)} chars).'
        ))

        if not options['probe']:
            self.stdout.write('')
            self.stdout.write(self.style.SUCCESS(
                'Healthcheck OK. Use --probe para tambem testar uma chamada GET.'
            ))
            return

        self.stdout.write('')
        self.stdout.write('--- Probe GET suporte/catalogo/ ---')
        url = f'{base.rstrip("/")}/api/formularios/suporte/catalogo/'
        try:
            r = requests.get(
                url,
                headers={'Authorization': f'Bearer {token}', 'Accept': 'application/json'},
                timeout=30,
            )
        except requests.RequestException as exc:
            self.stderr.write(self.style.ERROR(f'FALHOU: erro de rede ao chamar {url}: {exc}'))
            raise SystemExit(4) from exc

        self.stdout.write(f'URL:    {url}')
        self.stdout.write(f'Status: {r.status_code}')
        ct = r.headers.get('Content-Type', '?')
        self.stdout.write(f'Type:   {ct}')

        if r.status_code >= 400:
            self.stderr.write(self.style.ERROR(
                f'FALHOU: portal devolveu HTTP {r.status_code}. Body (primeiros 500 chars):'
            ))
            self.stderr.write(r.text[:500])
            ok = False
        else:
            self.stdout.write(self.style.SUCCESS('OK: endpoint respondeu 2xx.'))

        self.stdout.write('')
        if ok:
            self.stdout.write(self.style.SUCCESS('Healthcheck completo OK.'))
        else:
            raise SystemExit(5)

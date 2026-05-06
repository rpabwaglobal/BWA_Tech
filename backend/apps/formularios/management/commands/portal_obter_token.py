"""Comando de apoio: imprime o JWT `access` retornado pelo portal (uso local / CI)."""

from django.core.management.base import BaseCommand

from apps.formularios.portal_auth import PortalLoginError, login_on_portal


class Command(BaseCommand):
    help = 'Obtém o token JWT access do portal (credenciais: PORTAL_* no .env).'

    def handle(self, *args, **options):
        try:
            token = login_on_portal()
        except PortalLoginError as exc:
            self.stderr.write(self.style.ERROR(str(exc)))
            raise SystemExit(1) from exc

        self.stdout.write(token)

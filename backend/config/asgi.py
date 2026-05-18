"""
ASGI config for config project.

It exposes the ASGI callable as a module-level variable named ``application``.

For more information on this file, see
https://docs.djangoproject.com/en/5.2/howto/deployment/asgi/
"""

import logging
import os

from channels.auth import AuthMiddlewareStack
from channels.routing import ProtocolTypeRouter, URLRouter
from channels.security.websocket import OriginValidator
from django.conf import settings
from django.core.asgi import get_asgi_application

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')

# Initialize Django ASGI application early to ensure the AppRegistry
# is populated before importing code that may import ORM models.
django_asgi_app = get_asgi_application()

from apps.projects import routing  # noqa: E402

logger = logging.getLogger(__name__)


def _build_ws_allowed_origins() -> list[str]:
    """Lista de origens aceitas para WebSocket. Combina:

    - `WS_ALLOWED_ORIGINS` (env var dedicada, se presente — vírgula separada).
    - `ALLOWED_HOSTS` do Django (espelha a config HTTP).
    - `CSRF_TRUSTED_ORIGINS` (já inclui scheme, útil para validações de Origin
      que comparam scheme+host).

    Em DEBUG sem nenhuma origem definida, libera localhost.
    """
    raw = os.getenv('WS_ALLOWED_ORIGINS', '').strip()
    explicit = [o.strip() for o in raw.split(',') if o.strip()]

    hosts = [h for h in getattr(settings, 'ALLOWED_HOSTS', []) if h]
    csrf = [
        o for o in getattr(settings, 'CSRF_TRUSTED_ORIGINS', []) if o
    ]

    combined: list[str] = []
    for src in (explicit, hosts, csrf):
        for item in src:
            if item not in combined:
                combined.append(item)

    if not combined and getattr(settings, 'DEBUG', False):
        combined = ['localhost', '127.0.0.1', '[::1]']

    return combined


_WS_ALLOWED_ORIGINS = _build_ws_allowed_origins()
logger.info('WS allowed origins: %s', _WS_ALLOWED_ORIGINS)


class LoggingOriginValidator(OriginValidator):
    """Espelha o OriginValidator do Channels mas registra quando rejeita —
    facilita o diagnóstico em produção quando uma origem é negada."""

    async def __call__(self, scope, receive, send):
        if scope.get('type') == 'websocket':
            origin = None
            for name, value in scope.get('headers', []):
                if name == b'origin':
                    origin = value.decode('latin1', errors='replace')
                    break
            from urllib.parse import urlparse  # local, evita peso no import

            parsed = urlparse(origin) if origin else None
            if not self.valid_origin(parsed):
                logger.warning(
                    'WS origin rejeitada: origin=%r path=%r allowed=%s',
                    origin,
                    scope.get('path'),
                    self.allowed_origins,
                )
        return await super().__call__(scope, receive, send)


# AuthMiddlewareStack popula scope['user'] via cookie/sessão Django — nenhum
# dos nossos consumers usa isso (todos leem token manualmente), mas mantemos
# por compatibilidade com middlewares de terceiros que possam ler scope['user'].
application = ProtocolTypeRouter({
    "http": django_asgi_app,
    "websocket": LoggingOriginValidator(
        AuthMiddlewareStack(
            URLRouter(routing.websocket_urlpatterns),
        ),
        _WS_ALLOWED_ORIGINS,
    ),
})

"""
Autenticação no portal externo para obter JWT (`access`).

Credenciais: apenas variáveis de ambiente / Django settings — nunca no código-fonte.
"""

from __future__ import annotations

import logging
import time

import requests
from django.conf import settings

logger = logging.getLogger(__name__)


class PortalLoginError(Exception):
    """Falha ao obter token do portal."""


def login_on_portal() -> str:
    """
    POST em `{PORTAL_BASE_URL}/api/autenticacao/obter-token-acesso/`
    com email/senha e retorna o campo `access` (JWT).

    Raises:
        PortalLoginError: resposta inválida, rede ou credenciais não configuradas.
    """
    base = (getattr(settings, 'PORTAL_BASE_URL', '') or '').strip().rstrip('/')
    username = (getattr(settings, 'PORTAL_USERNAME', '') or '').strip()
    password = getattr(settings, 'PORTAL_PASSWORD', '') or ''

    if not base or not username or not password:
        raise PortalLoginError(
            'Configure PORTAL_BASE_URL, PORTAL_USERNAME e PORTAL_PASSWORD no ambiente (ex.: backend/.env).',
        )

    url = f'{base}/api/autenticacao/obter-token-acesso/'
    payload = {'email': username, 'senha': password}
    headers = {'Content-Type': 'application/json'}

    try:
        response = requests.post(url, json=payload, headers=headers, timeout=30)
        response.raise_for_status()
        data = response.json()
    except requests.RequestException as exc:
        logger.warning('Falha de rede ao autenticar no portal: %s', exc)
        raise PortalLoginError('Erro de rede ao realizar login no portal.') from exc
    except ValueError as exc:
        raise PortalLoginError('Resposta do portal não é JSON válido.') from exc

    token = data.get('access')
    if not token or not isinstance(token, str):
        raise PortalLoginError(
            'Resposta do portal sem campo "access"; verifique URL e credenciais.',
        )

    return token


_cached_access: tuple[str, float] | None = None
_CACHED_ACCESS_TTL_SEC = 240.0


def login_on_portal_cached() -> str:
    """Reutiliza o JWT por alguns minutos para não autenticar a cada pedido do proxy."""
    global _cached_access
    now = time.monotonic()
    if _cached_access is not None:
        token, until = _cached_access
        if now < until:
            return token
    token = login_on_portal()
    _cached_access = (token, now + _CACHED_ACCESS_TTL_SEC)
    return token

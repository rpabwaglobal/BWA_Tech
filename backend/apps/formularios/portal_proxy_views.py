"""
Proxy HTTP para `{PORTAL_BASE_URL}/api/formularios/*` — mesma origem no browser (evita CORS na LAN).

O SPA autentica no BWA (Token); este view reenvia ao portal com Bearer JWT obtido no servidor.
"""

from __future__ import annotations

import ipaddress
import logging
import re
import socket
from urllib.parse import urlparse

import requests
from django.conf import settings
from django.http import HttpResponse
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .portal_auth import PortalLoginError, login_on_portal_cached

logger = logging.getLogger(__name__)

# Path seguro: letras, dígitos, hífen, underline, ponto, barra. Sem `..`, `\`,
# `:`, espaços ou caracteres de controle. Evita path traversal e injeção.
_SAFE_PATH_RE = re.compile(r'^[A-Za-z0-9_\-./]*$')


def _is_internal_host(hostname: str) -> bool:
    """True se o hostname/IP aponta para loopback, link-local, metadata cloud
    ou rede privada RFC1918. Defesa contra SSRF interno."""
    if not hostname:
        return True
    # Bloqueio explícito de metadados de nuvem
    BLOCKED_HOSTS = {
        '169.254.169.254',          # AWS/GCP/Azure IMDS
        'metadata.google.internal',
        'metadata',
        '100.100.100.200',          # Alibaba
    }
    if hostname.lower() in BLOCKED_HOSTS:
        return True
    # Tentar resolver para todos os IPs (defesa contra DNS rebinding)
    try:
        infos = socket.getaddrinfo(hostname, None)
    except socket.gaierror:
        return True  # DNS quebrado → bloqueia por segurança
    for info in infos:
        try:
            ip = ipaddress.ip_address(info[4][0])
        except ValueError:
            continue
        if ip.is_loopback or ip.is_link_local or ip.is_private or ip.is_multicast:
            return True
    return False


class PortalFormulariosProxyView(APIView):
    """GET/POST/PATCH/PUT/DELETE → portal `/api/formularios/<path>`."""

    permission_classes = [IsAuthenticated]

    def _forward(self, request, path: str):
        base = (getattr(settings, 'PORTAL_BASE_URL', '') or '').strip().rstrip('/')
        if not base:
            return Response(
                {'detail': 'PORTAL_BASE_URL não configurado.'},
                status=503,
            )

        # Validar PORTAL_BASE_URL (defesa contra config maliciosa)
        try:
            parsed_base = urlparse(base)
        except ValueError:
            return Response({'detail': 'PORTAL_BASE_URL inválida.'}, status=503)
        if parsed_base.scheme not in ('http', 'https'):
            return Response({'detail': 'PORTAL_BASE_URL deve usar http(s).'}, status=503)
        if _is_internal_host(parsed_base.hostname or ''):
            logger.error('PORTAL_BASE_URL aponta para host interno: %s', parsed_base.hostname)
            return Response({'detail': 'Configuração inválida.'}, status=503)

        sub = (path or '').lstrip('/')
        # Bloqueio de path traversal e caracteres perigosos
        if '..' in sub.split('/') or not _SAFE_PATH_RE.match(sub):
            return Response({'detail': 'Path inválido.'}, status=400)
        url = f'{base}/api/formularios/{sub}'
        if request.GET:
            from urllib.parse import urlencode

            qs = urlencode(request.GET, doseq=True)
            url = f'{url}?{qs}'

        try:
            token = login_on_portal_cached()
        except PortalLoginError as exc:
            return Response({'detail': str(exc)}, status=503)

        headers = {
            'Authorization': f'Bearer {token}',
            'Accept': request.headers.get('Accept', '*/*'),
        }

        method = request.method.upper()
        kw: dict = {'headers': headers, 'timeout': 90}

        if method in ('POST', 'PATCH', 'PUT'):
            ct = request.content_type or 'application/json'
            headers['Content-Type'] = ct
            kw['data'] = request.body
        elif method == 'DELETE' and request.body:
            ct = request.content_type or 'application/json'
            headers['Content-Type'] = ct
            kw['data'] = request.body

        try:
            upstream = requests.request(method, url, **kw)
        except requests.RequestException:
            logger.exception('Falha de rede no proxy portal-formularios (%s %s)', method, url)
            return Response({'detail': 'Erro ao contactar o portal.'}, status=502)

        content_type = upstream.headers.get('Content-Type') or 'application/json'
        return HttpResponse(upstream.content, status=upstream.status_code, content_type=content_type)

    def get(self, request, path):
        return self._forward(request, path)

    def post(self, request, path):
        return self._forward(request, path)

    def patch(self, request, path):
        return self._forward(request, path)

    def put(self, request, path):
        return self._forward(request, path)

    def delete(self, request, path):
        return self._forward(request, path)

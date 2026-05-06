"""
Proxy HTTP para `{PORTAL_BASE_URL}/api/formularios/*` — mesma origem no browser (evita CORS na LAN).

O SPA autentica no BWA (Token); este view reenvia ao portal com Bearer JWT obtido no servidor.
"""

from __future__ import annotations

import logging

import requests
from django.conf import settings
from django.http import HttpResponse
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .portal_auth import PortalLoginError, login_on_portal_cached

logger = logging.getLogger(__name__)


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

        sub = (path or '').lstrip('/')
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

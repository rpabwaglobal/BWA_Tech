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

from .portal_auth import PortalLoginError, invalidate_portal_token_cache, login_on_portal_cached
from .realtime import broadcast_chamado

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


def _maybe_broadcast_suporte_event(method: str, path: str, upstream: requests.Response) -> None:
    """Dispara evento WebSocket de suporte quando a mutação afeta um chamado.

    Heurística (não exige acoplamento com o portal):
    - POST `suporte/`         → chamado_created
    - PATCH/PUT `suporte/<id>/...` → chamado_updated
    - DELETE                   → ignorado (consumer atual não trata)

    Falhas silenciosas (parse JSON ou Channels offline) não devem quebrar o
    fluxo do proxy — broadcast é melhoria de UX, não correctness.
    """
    if method not in ('POST', 'PATCH', 'PUT'):
        return
    parts = [p for p in path.split('/') if p]
    if not parts or parts[0] != 'suporte':
        return
    try:
        payload = upstream.json()
    except ValueError:
        return
    # POST suporte/ retorna o chamado criado; PATCH/PUT suporte/<id>/[...] também.
    if not isinstance(payload, dict) or 'id' not in payload:
        return
    if method == 'POST' and len(parts) == 1:
        event = 'chamado_created'
    else:
        event = 'chamado_updated'
    try:
        broadcast_chamado(event, payload)
    except Exception:
        logger.exception('Falha ao fazer broadcast do evento %s', event)


# Headers da resposta upstream que repassamos ao cliente. Não inclui
# Content-Length/Transfer-Encoding (Django recalcula), Set-Cookie (cookies do
# portal não devem vazar pro nosso domínio), Connection (controle de conexão).
_FORWARDED_RESPONSE_HEADERS = {
    'content-type',
    'content-disposition',
    'cache-control',
    'etag',
    'last-modified',
    'link',
    'x-total-count',
    'x-pagination',
}


class PortalFormulariosProxyView(APIView):
    """Proxy autenticado entre o frontend BWA e o portal externo de formulários.

    GET/POST/PATCH/PUT/DELETE → `{PORTAL_BASE_URL}/api/formularios/<path>` com
    Bearer JWT obtido server-side via `login_on_portal_cached()`.

    Fluxo:
    1. Valida `PORTAL_BASE_URL` (existência, scheme, defesa contra SSRF).
    2. Valida path (whitelist de caracteres, sem traversal).
    3. Obtém JWT do cache (ou faz login novo).
    4. Encaminha a requisição. Se upstream retorna 401, invalida o cache
       e tenta UMA vez mais — cobre o caso de JWT cacheado revogado/expirado
       antes do TTL local.
    5. Repassa status code, content-type e headers úteis (paginação, ETag, etc).
    """

    permission_classes = [IsAuthenticated]

    def _do_request(self, method: str, url: str, request) -> requests.Response:
        """Monta e executa a requisição HTTP ao upstream. Sempre busca o JWT
        do cache antes — quem chama é responsável por invalidar em 401."""
        token = login_on_portal_cached()
        headers = {
            'Authorization': f'Bearer {token}',
            'Accept': request.headers.get('Accept', '*/*'),
        }
        kw: dict = {'headers': headers, 'timeout': 90}
        if method in ('POST', 'PATCH', 'PUT') or (method == 'DELETE' and request.body):
            headers['Content-Type'] = request.content_type or 'application/json'
            kw['data'] = request.body
        return requests.request(method, url, **kw)

    def _forward(self, request, path: str):
        base = (getattr(settings, 'PORTAL_BASE_URL', '') or '').strip().rstrip('/')
        if not base:
            logger.error(
                'PORTAL_BASE_URL não configurado — proxy portal-formularios offline.',
            )
            return Response(
                {
                    'detail': (
                        'O acesso ao portal de formulários não está configurado neste servidor. '
                        'Avise o administrador.'
                    ),
                    'reason': 'portal_base_url_missing',
                },
                status=503,
            )

        # Validar PORTAL_BASE_URL (defesa contra config maliciosa / SSRF)
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

        method = request.method.upper()

        # Primeira tentativa. Em caso de 401 (JWT cacheado já revogado pelo portal
        # antes do nosso TTL local), invalida o cache e tenta de novo — UMA vez.
        try:
            try:
                upstream = self._do_request(method, url, request)
            except PortalLoginError as exc:
                logger.warning('Login no portal falhou: %s', exc)
                return Response(
                    {
                        'detail': (
                            'Falha ao autenticar no portal. Verifique '
                            'PORTAL_USERNAME/PORTAL_PASSWORD no servidor.'
                        ),
                        'reason': 'portal_login_failed',
                    },
                    status=503,
                )

            if upstream.status_code == 401:
                logger.info(
                    'Upstream %s respondeu 401; invalidando cache de JWT e tentando novamente.',
                    url,
                )
                invalidate_portal_token_cache()
                try:
                    upstream = self._do_request(method, url, request)
                except PortalLoginError as exc:
                    logger.warning('Re-login no portal falhou após 401: %s', exc)
                    return Response(
                        {
                            'detail': 'Sessão com o portal expirou e não foi possível renovar.',
                            'reason': 'portal_token_refresh_failed',
                        },
                        status=503,
                    )
        except requests.RequestException:
            logger.exception('Falha de rede no proxy portal-formularios (%s %s)', method, url)
            return Response(
                {
                    'detail': 'Erro ao contactar o portal — tente novamente em instantes.',
                    'reason': 'portal_unreachable',
                },
                status=502,
            )

        # Broadcast realtime para os outros clientes conectados ao WS de suporte.
        # Como os chamados estão no portal externo, o Django não recebe sinais
        # nativos — então usamos as próprias mutações que passam pelo proxy como
        # gatilho. Cobre o caso comum (todos os usuários editam via tech.bwa.global).
        if 200 <= upstream.status_code < 300:
            _maybe_broadcast_suporte_event(method, sub, upstream)

        # Repassa o body e os headers úteis. Excluímos headers de transporte
        # (Content-Length, Transfer-Encoding) que o Django reescreve, e Set-Cookie
        # do portal (não queremos vazar cookies de outro domínio).
        content_type = upstream.headers.get('Content-Type') or 'application/json'
        response = HttpResponse(
            upstream.content,
            status=upstream.status_code,
            content_type=content_type,
        )
        for raw_name, value in upstream.headers.items():
            if raw_name.lower() in _FORWARDED_RESPONSE_HEADERS and raw_name.lower() != 'content-type':
                response[raw_name] = value
        return response

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

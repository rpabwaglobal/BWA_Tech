import mimetypes
from pathlib import Path
from django.http import JsonResponse, FileResponse, Http404, HttpResponseNotModified
from django.conf import settings
from django.utils.http import http_date, parse_http_date_safe
from .versao import versao_atual
from rest_framework.exceptions import AuthenticationFailed

from apps.accounts.authentication import ExpiringTokenAuthentication

# Cache longo e imutável: as fotos de perfil são salvas com nome único (uuid), então
# a URL muda sempre que a foto muda. Isso permite ao browser cachear o avatar para
# sempre e NÃO refazer o download a cada navegação — evitando a saturação que fazia
# alguns avatares não carregarem até dar F5.
_MEDIA_CACHE_CONTROL = 'public, max-age=31536000, immutable'

# Mesmo cache imutável, mas restrito ao browser de quem pediu: um cache
# compartilhado (proxy/CDN) guardando o arquivo entregaria a cópia sem passar
# pela checagem de acesso.
_MEDIA_CACHE_CONTROL_PRIVADO = 'private, max-age=31536000, immutable'

# /media/ é alcançado por navegação comum do browser (<img src>, <a download>), que
# NÃO carrega o header Authorization usado pela API — então só ficam abertos os
# prefixos que dependem exatamente disso. Todo o resto exige usuário autenticado.
_MEDIA_PUBLICA = (
    # Avatares: entram por <img src> em toda a interface e o arquivo é gravado com
    # nome uuid (process_profile_picture), então a URL não é adivinhável.
    'profiles/',
    # Anexo de card e arquivo de resolução de chamado: o SPA aponta o <a download>
    # direto para a URL do arquivo, sem intermediar por endpoint da API.
    'card_anexos/',
    'suporte_resolucao/',
)

# Prefixos NUNCA servidos por /media/, nem para quem está autenticado.
_MEDIA_BLOQUEADA = (
    # Relatório é o agregado de tudo que o DONO do job enxerga (o conteúdo é
    # escopado por `job.user` na geração), mas o arquivo em disco não carrega
    # esse vínculo: o nome vem de BaseReport.filename, determinístico — título
    # de um conjunto fixo de oito strings + timestamp com granularidade de
    # MINUTO. Estar autenticado bastaria para varrer o mês e baixar o
    # consolidado de outro setor. O download legítimo passa por
    # /api/reports/<id>/download|preview/, que filtra por `user=request.user`
    # (apps/reports/views.py:52) — nem o SPA nem o serializer apontam para
    # /media/reports/ em lugar nenhum, então fechar aqui não quebra nada.
    'reports/',
)


def _requisicao_autenticada(request):
    """Identifica o usuário fora do stack do DRF: aceita a sessão do Django (admin)
    e também o token da API, para clientes que conseguem mandar o header."""
    user = getattr(request, 'user', None)
    if user is not None and user.is_authenticated:
        return True
    try:
        return ExpiringTokenAuthentication().authenticate(request) is not None
    except AuthenticationFailed:
        return False


def serve_media(request, path):
    """Serve arquivos de mídia (fotos de perfil, etc.) com cache agressivo e
    suporte a requisições condicionais (ETag / If-Modified-Since → 304)."""
    media_root = Path(settings.MEDIA_ROOT).resolve()
    if not media_root.is_dir():
        raise Http404()
    path = path.strip('/')
    if '..' in path or path.startswith('/'):
        raise Http404()
    try:
        file_path = (media_root / path).resolve(strict=True)
        # Caminho relativo canônico: é ele que decide o gate, para que variações de
        # escrita ("./reports/x") não driblem a comparação de prefixo.
        relativo = file_path.relative_to(media_root).as_posix()
    except (OSError, ValueError):
        # Cobre arquivo inexistente e tentativa de sair do MEDIA_ROOT — o converter
        # <path:path> aceita coisas que o pathlib trata como raiz absoluta ("C:/…").
        raise Http404()
    # Vem ANTES do teste de existência para que o 404 seja idêntico ao de arquivo
    # inexistente: um 403 (ou um 404 tardio) já confirmaria que o relatório de
    # tal título foi gerado em tal minuto.
    if relativo.startswith(_MEDIA_BLOQUEADA):
        raise Http404()

    if not file_path.is_file():
        raise Http404()

    # Responde 404 (e não 403) para quem não pode ver: os nomes dos arquivos
    # gerados são previsíveis, e um 403 já confirmaria que existem.
    publico = relativo.startswith(_MEDIA_PUBLICA)
    if not publico and not _requisicao_autenticada(request):
        raise Http404()
    cache_control = _MEDIA_CACHE_CONTROL if publico else _MEDIA_CACHE_CONTROL_PRIVADO

    stat = file_path.stat()
    last_modified = int(stat.st_mtime)
    etag = f'"{stat.st_mtime_ns:x}-{stat.st_size:x}"'

    # Revalidação barata: se o cliente já tem a versão atual, responde 304 sem corpo.
    if_none_match = request.META.get('HTTP_IF_NONE_MATCH')
    if if_none_match and etag in (t.strip() for t in if_none_match.split(',')):
        not_modified = HttpResponseNotModified()
        not_modified['ETag'] = etag
        not_modified['Cache-Control'] = cache_control
        return not_modified
    if_modified_since = parse_http_date_safe(request.META.get('HTTP_IF_MODIFIED_SINCE', ''))
    if if_modified_since is not None and if_modified_since >= last_modified:
        not_modified = HttpResponseNotModified()
        not_modified['ETag'] = etag
        not_modified['Cache-Control'] = cache_control
        return not_modified

    content_type, _ = mimetypes.guess_type(str(file_path))
    response = FileResponse(open(file_path, 'rb'), content_type=content_type or 'application/octet-stream')
    response['Last-Modified'] = http_date(last_modified)
    response['ETag'] = etag
    response['Cache-Control'] = cache_control
    return response


def api_root(request):
    """View raiz da API"""
    return JsonResponse({
        'message': 'Gerenciador de Projetos API',
        'version': versao_atual(),
        'endpoints': {
            'users': '/api/users/',
            'sprints': '/api/sprints/',
            'projects': '/api/projects/',
            'cards': '/api/cards/',
            'events': '/api/events/',
            'formularios': '/api/formularios/',
            'portal_formularios_access': '/api/portal/formularios-access/',
            'admin': '/admin/',
        }
    })


def serve_spa(request, path):
    """Serve o frontend (SPA) em deploy: arquivos estáticos ou index.html."""
    frontend_dir = getattr(settings, 'FRONTEND_BUILD_DIR', None)
    if not frontend_dir or not frontend_dir.exists():
        return JsonResponse({'error': 'Frontend não encontrado. Rode: cd frontend && npm run build'}, status=404)
    path = path.strip('/')
    if '..' in path or path.startswith('/'):
        raise Http404()
    if path:
        file_path = frontend_dir / path
        # Mesma armadilha já tratada em serve_media: o catch-all `(?P<path>.*)`
        # entrega strings que o pathlib considera raiz ABSOLUTA ("C:/Windows/…"
        # no Windows, com ou sem barra invertida), e nesse caso o operador `/`
        # DESCARTA o frontend_dir em vez de concatenar. Como serve_spa não exige
        # autenticação nenhuma, isso serviria qualquer arquivo do disco para
        # quem nem está logado — e os guardas acima não pegam, porque a string
        # não tem '..' nem começa com '/'. Confirma que o alvo canônico continua
        # DENTRO do build antes de abrir; fora dele cai no index.html, que já é
        # a resposta de hoje para qualquer caminho que não seja arquivo do build.
        try:
            dentro_do_build = file_path.resolve().is_relative_to(frontend_dir.resolve())
        except (OSError, ValueError):
            dentro_do_build = False
        if dentro_do_build and file_path.is_file():
            content_type, _ = mimetypes.guess_type(str(file_path))
            return FileResponse(open(file_path, 'rb'), content_type=content_type or 'application/octet-stream')
    index_path = frontend_dir / 'index.html'
    if not index_path.is_file():
        raise Http404()
    return FileResponse(open(index_path, 'rb'), content_type='text/html')

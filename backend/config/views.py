import mimetypes
from pathlib import Path
from django.http import JsonResponse, FileResponse, Http404, HttpResponseNotModified
from django.conf import settings
from django.utils.http import http_date, parse_http_date_safe

# Cache longo e imutável: as fotos de perfil são salvas com nome único (uuid), então
# a URL muda sempre que a foto muda. Isso permite ao browser cachear o avatar para
# sempre e NÃO refazer o download a cada navegação — evitando a saturação que fazia
# alguns avatares não carregarem até dar F5.
_MEDIA_CACHE_CONTROL = 'public, max-age=31536000, immutable'


def serve_media(request, path):
    """Serve arquivos de mídia (fotos de perfil, etc.) com cache agressivo e
    suporte a requisições condicionais (ETag / If-Modified-Since → 304)."""
    media_root = Path(settings.MEDIA_ROOT)
    if not media_root.exists():
        raise Http404()
    path = path.strip('/')
    if '..' in path or path.startswith('/'):
        raise Http404()
    file_path = media_root / path
    if not file_path.is_file():
        raise Http404()

    stat = file_path.stat()
    last_modified = int(stat.st_mtime)
    etag = f'"{stat.st_mtime_ns:x}-{stat.st_size:x}"'

    # Revalidação barata: se o cliente já tem a versão atual, responde 304 sem corpo.
    if_none_match = request.META.get('HTTP_IF_NONE_MATCH')
    if if_none_match and etag in (t.strip() for t in if_none_match.split(',')):
        not_modified = HttpResponseNotModified()
        not_modified['ETag'] = etag
        not_modified['Cache-Control'] = _MEDIA_CACHE_CONTROL
        return not_modified
    if_modified_since = parse_http_date_safe(request.META.get('HTTP_IF_MODIFIED_SINCE', ''))
    if if_modified_since is not None and if_modified_since >= last_modified:
        not_modified = HttpResponseNotModified()
        not_modified['ETag'] = etag
        not_modified['Cache-Control'] = _MEDIA_CACHE_CONTROL
        return not_modified

    content_type, _ = mimetypes.guess_type(str(file_path))
    response = FileResponse(open(file_path, 'rb'), content_type=content_type or 'application/octet-stream')
    response['Last-Modified'] = http_date(last_modified)
    response['ETag'] = etag
    response['Cache-Control'] = _MEDIA_CACHE_CONTROL
    return response


def api_root(request):
    """View raiz da API"""
    return JsonResponse({
        'message': 'Gerenciador de Projetos API',
        'version': '1.0.0',
        'endpoints': {
            'users': '/api/users/',
            'sprints': '/api/sprints/',
            'projects': '/api/projects/',
            'cards': '/api/cards/',
            'events': '/api/events/',
            'teams': '/api/teams/',
            'team-members': '/api/team-members/',
            'hierarchies': '/api/hierarchies/',
            'timeline': '/api/timeline/',
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
        if file_path.is_file():
            content_type, _ = mimetypes.guess_type(str(file_path))
            return FileResponse(open(file_path, 'rb'), content_type=content_type or 'application/octet-stream')
    index_path = frontend_dir / 'index.html'
    if not index_path.is_file():
        raise Http404()
    return FileResponse(open(index_path, 'rb'), content_type='text/html')

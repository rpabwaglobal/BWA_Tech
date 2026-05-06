import mimetypes
from pathlib import Path
from django.http import JsonResponse, FileResponse, Http404
from django.conf import settings


def serve_media(request, path):
    """Serve arquivos de mídia (fotos de perfil, etc.) em produção (DEBUG=False)."""
    media_root = Path(settings.MEDIA_ROOT)
    if not media_root.exists():
        raise Http404()
    path = path.strip('/')
    if '..' in path or path.startswith('/'):
        raise Http404()
    file_path = media_root / path
    if not file_path.is_file():
        raise Http404()
    content_type, _ = mimetypes.guess_type(str(file_path))
    return FileResponse(open(file_path, 'rb'), content_type=content_type or 'application/octet-stream')


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

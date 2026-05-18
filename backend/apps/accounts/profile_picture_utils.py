"""Helper único para resolução de URL de foto de perfil.

Centraliza a lógica usada por vários serializers/views: validação de existência
física do arquivo (evita 404 quando o DB aponta para um arquivo que sumiu do
volume), normalização do path e construção da URL absoluta.

Use sempre que precisar entregar `profile_picture_url` para o frontend.
"""
from __future__ import annotations

from typing import Optional


def get_profile_picture_url(user, request=None) -> Optional[str]:
    """Retorna a URL absoluta (ou relativa, se sem request) da foto de perfil
    de ``user``. Retorna ``None`` se o usuário não tem foto OU se o arquivo
    referenciado no banco não existe mais no storage (referência órfã)."""
    if user is None:
        return None
    pic = getattr(user, 'profile_picture', None)
    if not pic:
        return None
    try:
        # Tolerância a referências órfãs (volume resetado, cleanup antigo, etc.).
        # storage.exists() é uma chamada filesystem barata localmente.
        if not pic.storage.exists(pic.name):
            return None
        url = pic.url
    except (ValueError, OSError, NotImplementedError):
        return None
    path = url if url.startswith('/') else '/' + url
    if request is not None:
        return request.build_absolute_uri(path)
    return path

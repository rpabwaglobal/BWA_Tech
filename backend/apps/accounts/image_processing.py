"""Normalização de fotos de perfil: redimensiona, re-encoda e gera nome único.

Motivação: fotos grandes (o upload aceita até 5 MB) servidas cruas fazem com que
páginas com muitos avatares disparem dezenas de downloads pesados simultâneos,
saturando o servidor de mídia — o sintoma é o avatar que "não carrega até dar F5".

Aqui garantimos que toda foto salva seja:
  * pequena (máx 512px, re-encodada como JPEG) → download rápido, sem saturação;
  * com nome único (uuid) → a URL muda sempre que a foto muda, o que torna seguro
    o cache imutável no browser (ver ``serve_media`` em ``config/views.py``).
"""
from __future__ import annotations

import io
import uuid
from typing import Optional

from django.core.files.base import ContentFile

try:
    from PIL import Image, ImageOps
except ImportError:  # pragma: no cover
    Image = None  # type: ignore[assignment]
    ImageOps = None  # type: ignore[assignment]

MAX_DIMENSION = 512
JPEG_QUALITY = 85


def process_profile_picture(file) -> Optional[ContentFile]:
    """Recebe um ``UploadedFile`` já validado e devolve um ``ContentFile`` pronto
    para salvar em ``user.profile_picture`` — redimensionado, re-encodado como
    JPEG e com nome único (``<uuid>.jpg``).

    Retorna ``None`` se o Pillow não estiver disponível ou a imagem não puder ser
    processada; nesse caso o caller deve salvar o arquivo original como fallback.
    """
    if Image is None:
        return None
    try:
        file.seek(0)
        img = Image.open(file)
        # Corrige orientação EXIF (fotos de celular deitadas) e descarta metadados.
        img = ImageOps.exif_transpose(img)
        # JPEG não suporta alpha/paleta: achata para RGB.
        if img.mode != 'RGB':
            img = img.convert('RGB')
        resample = getattr(Image, 'Resampling', Image).LANCZOS
        img.thumbnail((MAX_DIMENSION, MAX_DIMENSION), resample)
        buffer = io.BytesIO()
        img.save(buffer, format='JPEG', quality=JPEG_QUALITY, optimize=True)
        buffer.seek(0)
        return ContentFile(buffer.read(), name=f"{uuid.uuid4().hex}.jpg")
    except Exception:
        return None
    finally:
        try:
            file.seek(0)
        except Exception:
            pass

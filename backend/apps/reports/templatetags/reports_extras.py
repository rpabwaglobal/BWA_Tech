"""
Filtros template auxiliares para os relatórios.
"""
from __future__ import annotations

from django import template

register = template.Library()


@register.filter
def get_item(value, key):
    """Acessa value[key] em templates Django (sem isso, dict[key] não funciona).

    Aceita dict ou list/tuple (com índice numérico).
    """
    if value is None:
        return None
    try:
        return value[key]
    except (KeyError, IndexError, TypeError):
        return None


@register.filter
def initials(value):
    """Iniciais do nome (até 2 letras maiúsculas)."""
    if not value:
        return '?'
    parts = str(value).strip().split()
    if not parts:
        return '?'
    if len(parts) == 1:
        return parts[0][:2].upper()
    return (parts[0][0] + parts[-1][0]).upper()

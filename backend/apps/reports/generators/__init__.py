"""
Registry de geradores de relatório.

Cada gerador concreto é registrado aqui pelo seu `type_id`. A Celery task
resolve o tipo do ReportJob neste mapa para instanciar o gerador correto.

Para adicionar um novo relatório:
1. Crie um arquivo `apps/reports/generators/<nome>.py` com uma subclasse
   de BaseReport (e export `Report` apontando pra ela).
2. Adicione o nome em `_MODULES` abaixo.
3. Adicione um template HTML em `apps/reports/templates/reports/<nome>.html`.
"""
from __future__ import annotations

from typing import Type

from .base import BaseReport


_MODULES = [
    'metrics',
    'sprint',
    'cards',
    'projects',
    'user',
    'bottlenecks',
    'executive',
    'backlog',
]

_REGISTRY_LOADED = False
REGISTRY: dict[str, Type[BaseReport]] = {}


def _populate_registry() -> None:
    """Importa todas as subclasses concretas e popula REGISTRY.

    Imports tolerantes a ImportError pra permitir desenvolvimento incremental
    (registra só os geradores cujos arquivos já existem).
    """
    global _REGISTRY_LOADED
    if _REGISTRY_LOADED:
        return
    for module_name in _MODULES:
        try:
            module = __import__(
                f'apps.reports.generators.{module_name}',
                fromlist=['Report'],
            )
        except ImportError:
            continue
        report_cls = getattr(module, 'Report', None)
        if report_cls is None or not issubclass(report_cls, BaseReport):
            continue
        type_id = report_cls.type_id
        if not type_id:
            continue
        REGISTRY[type_id] = report_cls
    _REGISTRY_LOADED = True


def resolve(type_id: str) -> Type[BaseReport]:
    """Retorna a classe gerador para o tipo. Lança KeyError se não existir."""
    _populate_registry()
    try:
        return REGISTRY[type_id]
    except KeyError as exc:
        raise KeyError(
            f'Tipo de relatório desconhecido: "{type_id}". '
            f'Disponíveis: {sorted(REGISTRY)}'
        ) from exc


def available_types() -> list[str]:
    """Lista os type_ids registrados (útil para validação de input)."""
    _populate_registry()
    return sorted(REGISTRY)
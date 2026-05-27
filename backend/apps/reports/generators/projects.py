"""
Relatório de Projetos.

Filtros:
- project_ids (lista): se vazio, todos não-arquivados/não-sistêmicos

Exporta todos os cards dos projetos selecionados, agrupados por projeto.
"""
from __future__ import annotations

from collections import defaultdict
from typing import Any

from django.utils import timezone

from apps.projects.models import Card, Project

from .base import BaseReport, FilterDisplay, TableColumn


class Report(BaseReport):
    type_id = 'projects'
    title = 'Relatório de Projetos'
    template_name = 'reports/projects.html'
    orientation = 'landscape'

    def fetch_data(self) -> dict[str, Any]:
        self.set_progress(10, 'Carregando projetos...')
        project_ids = self.filters.get('project_ids') or []
        qs = Project.objects.filter(arquivado=False, is_system=False).select_related('sprint').order_by('nome')
        if project_ids:
            qs = qs.filter(id__in=project_ids)
        projects = list(qs)

        self.set_progress(40, f'Carregando cards de {len(projects)} projeto(s)...')
        cards = list(
            Card.objects.select_related('responsavel', 'projeto')
            .filter(projeto_id__in=[p.id for p in projects])
            .order_by('projeto_id', '-finalizado_em', 'data_fim')
        )
        self.set_progress(70, f'{len(cards)} cards carregados')

        by_project: dict[int, list[Card]] = defaultdict(list)
        for c in cards:
            by_project[c.projeto_id].append(c)

        return {
            'projects': projects,
            'cards_by_project': dict(by_project),
            'total_cards': len(cards),
        }

    def filters_display(self, data: Any) -> list[FilterDisplay]:
        projects = data['projects']
        if not self.filters.get('project_ids'):
            return [FilterDisplay('Projetos', 'Todos (ativos, não-sistêmicos)')]
        names = ', '.join(p.nome for p in projects[:5])
        if len(projects) > 5:
            names += f' e mais {len(projects) - 5}'
        return [FilterDisplay('Projetos', names or '—')]

    def build_context(self, data: dict[str, Any]) -> dict[str, Any]:
        return data

    def table_columns(self) -> list[TableColumn]:
        return [
            TableColumn('projeto', 'Projeto', width=30),
            TableColumn('sprint', 'Sprint', width=22),
            TableColumn('nome', 'Card', width=40),
            TableColumn('status', 'Status', width=22),
            TableColumn('area', 'Área', width=15),
            TableColumn('tipo', 'Tipo', width=20),
            TableColumn('prioridade', 'Prioridade', width=14),
            TableColumn('responsavel', 'Responsável', width=22),
            TableColumn('data_fim', 'Prazo', format='dd/mm/yyyy hh:mm', width=18),
            TableColumn('finalizado_em', 'Finalizado em', format='dd/mm/yyyy hh:mm', width=18),
        ]

    def table_rows(self, data: dict[str, Any]) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        for project in data['projects']:
            for c in data['cards_by_project'].get(project.id, []):
                rows.append({
                    'projeto': project.nome,
                    'sprint': project.sprint.nome if project.sprint_id else '',
                    'nome': c.nome,
                    'status': c.get_status_display(),
                    'area': c.get_area_display(),
                    'tipo': c.get_tipo_display(),
                    'prioridade': c.get_prioridade_display(),
                    'responsavel': (
                        f'{c.responsavel.first_name} {c.responsavel.last_name}'.strip()
                        or c.responsavel.username
                    ) if c.responsavel_id else '',
                    'data_fim': _to_naive(c.data_fim),
                    'finalizado_em': _to_naive(c.finalizado_em),
                })
        return rows


def _to_naive(dt):
    if dt is None:
        return None
    if timezone.is_aware(dt):
        return timezone.localtime(dt).replace(tzinfo=None)
    return dt

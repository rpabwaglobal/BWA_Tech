"""
Relatório de Backlog — cards não entregues, agrupados por projeto.

Filtros: project_id (opcional)
"""
from __future__ import annotations

from collections import defaultdict
from typing import Any

from django.utils import timezone

from apps.projects.models import Card, Project

from .base import BaseReport, FilterDisplay, TableColumn


class Report(BaseReport):
    type_id = 'backlog'
    title = 'Backlog Atual'
    template_name = 'reports/backlog.html'
    orientation = 'landscape'

    def fetch_data(self) -> dict[str, Any]:
        self.set_progress(10, 'Filtrando cards não-terminados...')
        qs = (
            Card.objects.select_related('projeto', 'projeto__sprint', 'responsavel')
            .filter(projeto__arquivado=False, projeto__is_system=False)
            .exclude(status__in=['finalizado', 'inviabilizado'])
            .order_by('projeto_id', 'data_fim')
        )
        project_id = self.filters.get('project_id')
        if project_id:
            qs = qs.filter(projeto_id=project_id)
        cards = list(qs)

        by_project: dict[int, list[Card]] = defaultdict(list)
        for c in cards:
            by_project[c.projeto_id].append(c)

        # Projetos com cards (mantém ordem alfabética por nome)
        proj_ids = list(by_project.keys())
        projects = list(
            Project.objects.filter(id__in=proj_ids)
            .select_related('sprint')
            .order_by('nome')
        )

        self.set_progress(80, f'{len(cards)} cards no backlog')
        return {
            'projects': projects,
            'cards_by_project': dict(by_project),
            'total': len(cards),
        }

    def filters_display(self, data: Any) -> list[FilterDisplay]:
        if self.filters.get('project_id'):
            pj = Project.objects.filter(pk=self.filters['project_id']).first()
            return [FilterDisplay('Projeto', pj.nome if pj else '—')]
        return [FilterDisplay('Projeto', 'Todos os ativos')]

    def build_context(self, data: dict[str, Any]) -> dict[str, Any]:
        return data

    def table_columns(self) -> list[TableColumn]:
        return [
            TableColumn('projeto', 'Projeto', width=28),
            TableColumn('sprint', 'Sprint', width=22),
            TableColumn('nome', 'Card', width=40),
            TableColumn('status', 'Status', width=22),
            TableColumn('responsavel', 'Responsável', width=22),
            TableColumn('data_fim', 'Prazo', format='dd/mm/yyyy hh:mm', width=18),
            TableColumn('dias_em_atraso', 'Dias em atraso', width=14),
        ]

    def table_rows(self, data: dict[str, Any]) -> list[dict[str, Any]]:
        now = timezone.now()
        rows = []
        for project in data['projects']:
            for c in data['cards_by_project'].get(project.id, []):
                atraso = ''
                if c.data_fim and c.data_fim < now:
                    atraso = (now - c.data_fim).days
                rows.append({
                    'projeto': project.nome,
                    'sprint': project.sprint.nome if project.sprint_id else '',
                    'nome': c.nome,
                    'status': c.get_status_display(),
                    'responsavel': (
                        f'{c.responsavel.first_name} {c.responsavel.last_name}'.strip()
                        or c.responsavel.username
                    ) if c.responsavel_id else '',
                    'data_fim': _to_naive(c.data_fim),
                    'dias_em_atraso': atraso,
                })
        return rows


def _to_naive(dt):
    if dt is None:
        return None
    if timezone.is_aware(dt):
        return timezone.localtime(dt).replace(tzinfo=None)
    return dt

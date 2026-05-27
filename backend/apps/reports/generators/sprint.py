"""
Relatório de Sprint detalhada.

Filtro obrigatório:
- sprint_id

Exporta TODOS os projetos e cards da sprint, agrupados por projeto.
"""
from __future__ import annotations

from collections import defaultdict
from typing import Any

from django.utils import timezone

from apps.projects.models import Card, Project, Sprint

from .base import BaseReport, FilterDisplay, TableColumn


class Report(BaseReport):
    type_id = 'sprint'
    title = 'Relatório de Sprint'
    template_name = 'reports/sprint.html'
    orientation = 'landscape'

    def fetch_data(self) -> dict[str, Any]:
        sprint_id = self.filters.get('sprint_id')
        if not sprint_id:
            raise ValueError('Filtro obrigatório: sprint_id')

        self.set_progress(5, 'Carregando sprint...')
        sprint = Sprint.objects.get(pk=sprint_id)

        self.set_progress(15, 'Carregando projetos...')
        projects = list(
            Project.objects.filter(sprint=sprint, arquivado=False, is_system=False)
            .order_by('nome')
        )

        self.set_progress(40, 'Carregando cards...')
        project_ids = [p.id for p in projects]
        cards = list(
            Card.objects.select_related('responsavel', 'projeto')
            .filter(projeto_id__in=project_ids)
            .order_by('projeto_id', '-finalizado_em', 'data_fim')
        )
        self.set_progress(70, f'{len(cards)} cards carregados')

        by_project: dict[int, list[Card]] = defaultdict(list)
        for c in cards:
            by_project[c.projeto_id].append(c)

        # Métricas agregadas da sprint
        total = len(cards)
        finalizados = sum(1 for c in cards if c.status == 'finalizado' and c.finalizado_em)
        inviabilizados = sum(1 for c in cards if c.status == 'inviabilizado')
        em_andamento = sum(1 for c in cards if c.status in ('em_desenvolvimento', 'em_homologacao'))
        a_desenvolver = sum(1 for c in cards if c.status == 'a_desenvolver')
        atrasados = 0
        for c in cards:
            if c.status == 'finalizado' and c.finalizado_em and c.data_fim:
                if c.finalizado_em > c.data_fim:
                    atrasados += 1

        return {
            'sprint': sprint,
            'projects': projects,
            'cards_by_project': dict(by_project),
            'total_cards': total,
            'finalizados': finalizados,
            'inviabilizados': inviabilizados,
            'em_andamento': em_andamento,
            'a_desenvolver': a_desenvolver,
            'atrasados': atrasados,
        }

    def filters_display(self, data: Any) -> list[FilterDisplay]:
        sprint = data['sprint']
        return [
            FilterDisplay('Sprint', sprint.nome),
            FilterDisplay(
                'Período',
                f'{timezone.localtime(sprint.data_inicio).strftime("%d/%m/%Y")} → '
                f'{timezone.localtime(sprint.fechamento_em).strftime("%d/%m/%Y")}',
            ),
            FilterDisplay('Status', 'Finalizada' if sprint.finalizada else 'Em andamento'),
        ]

    def build_context(self, data: dict[str, Any]) -> dict[str, Any]:
        return data

    # ── Tabular (XLSX/CSV) ──
    def table_columns(self) -> list[TableColumn]:
        return [
            TableColumn('projeto', 'Projeto', width=30),
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

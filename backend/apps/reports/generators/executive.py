"""
Relatório Executivo — 1 página de KPIs principais.

Filtros: period_start / period_end (opcional)
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from django.utils import timezone

from apps.projects.models import Card, Project, Sprint

from .base import BaseReport, FilterDisplay, TableColumn


def _parse_date(v: str | None) -> datetime | None:
    if not v:
        return None
    try:
        if 'T' in v:
            return datetime.fromisoformat(v.replace('Z', '+00:00'))
        return datetime.strptime(v, '%Y-%m-%d')
    except (ValueError, TypeError):
        return None


class Report(BaseReport):
    type_id = 'executive'
    title = 'Relatório Executivo'
    subtitle = 'Visão consolidada em uma página'
    template_name = 'reports/executive.html'
    orientation = 'portrait'

    def fetch_data(self) -> dict[str, Any]:
        self.set_progress(20, 'Calculando KPIs...')
        now = timezone.now()
        period_start = _parse_date(self.filters.get('period_start'))
        period_end = _parse_date(self.filters.get('period_end'))

        cards = Card.objects.filter(projeto__arquivado=False, projeto__is_system=False)
        delivered = cards.filter(status='finalizado', finalizado_em__isnull=False)
        if period_start:
            delivered = delivered.filter(finalizado_em__gte=period_start)
        if period_end:
            delivered = delivered.filter(finalizado_em__lte=period_end)
        delivered_list = list(delivered.select_related('projeto'))

        # On-time
        with_due = [c for c in delivered_list if c.data_fim]
        on_time = sum(1 for c in with_due if c.finalizado_em <= c.data_fim)
        on_time_pct = round(on_time * 100 / len(with_due), 1) if with_due else None

        # Cycle time
        ms_day = 86400
        cycles = [
            (c.finalizado_em - c.data_inicio).total_seconds()
            for c in delivered_list
            if c.data_inicio and c.finalizado_em and (c.finalizado_em - c.data_inicio).total_seconds() >= 0
        ]
        avg_cycle = round(sum(cycles) / len(cycles) / ms_day, 1) if cycles else None

        # Sprint ativa
        active_sprint = Sprint.objects.filter(finalizada=False).order_by('-data_inicio').first()

        # Em aberto atrasados
        open_late = cards.exclude(status__in=['finalizado', 'inviabilizado']).filter(data_fim__lt=now).count()

        # Top usuário do período
        per_user: dict[int, dict[str, Any]] = {}
        for c in delivered_list:
            if not c.responsavel_id:
                continue
            row = per_user.setdefault(c.responsavel_id, {'name': '', 'count': 0})
            row['name'] = (
                f'{c.responsavel.first_name} {c.responsavel.last_name}'.strip()
                if c.responsavel else ''
            )
            row['count'] += 1
        top_user = max(per_user.values(), key=lambda r: r['count'], default=None)

        # Projetos ativos
        active_projects = Project.objects.filter(arquivado=False, is_system=False).count()

        self.set_progress(95, 'Finalizando...')
        return {
            'total_delivered': len(delivered_list),
            'on_time': on_time,
            'on_time_pct': on_time_pct,
            'late_total': (len(with_due) - on_time) if with_due else 0,
            'avg_cycle': avg_cycle,
            'active_sprint': active_sprint,
            'active_projects': active_projects,
            'open_late': open_late,
            'top_user': top_user,
        }

    def filters_display(self, data: Any) -> list[FilterDisplay]:
        ps = self.filters.get('period_start')
        pe = self.filters.get('period_end')
        if not ps and not pe:
            return [FilterDisplay('Período', 'Todo o histórico')]
        return [FilterDisplay('Período', f'{ps or "?"} → {pe or "?"}')]

    def build_context(self, data: dict[str, Any]) -> dict[str, Any]:
        return data

    # Executivo não tem export tabular (é uma única página de resumo).
    # Se chamarem xlsx/csv, vai estourar NotImplementedError — UI vai mostrar.
    def table_columns(self) -> list[TableColumn]:
        return []

"""
Relatório de Atrasos & Gargalos.

Combina dois pontos de dor:
1. Cards atrasados (entregues fora do prazo OU em aberto com data_fim passada)
2. Cycle time mais lento por área e por etapa

Filtros: period_start / period_end (opcional)
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from django.utils import timezone

from apps.projects.models import Card, CardArea

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
    type_id = 'bottlenecks'
    title = 'Atrasos & Gargalos'
    template_name = 'reports/bottlenecks.html'
    orientation = 'portrait'

    def fetch_data(self) -> dict[str, Any]:
        self.set_progress(10, 'Filtrando cards...')
        now = timezone.now()
        period_start = _parse_date(self.filters.get('period_start'))
        period_end = _parse_date(self.filters.get('period_end'))

        base = (
            Card.objects.select_related('projeto', 'projeto__sprint', 'responsavel')
            .filter(projeto__arquivado=False, projeto__is_system=False)
        )

        # Entregues atrasados (finalizado_em > data_fim)
        late_delivered_qs = base.filter(
            status='finalizado',
            finalizado_em__isnull=False,
            data_fim__isnull=False,
        )
        if period_start:
            late_delivered_qs = late_delivered_qs.filter(finalizado_em__gte=period_start)
        if period_end:
            late_delivered_qs = late_delivered_qs.filter(finalizado_em__lte=period_end)

        # Materializa em chunks com progresso, depois filtra in-memory pra ter
        # certeza que o filtro Python (finalizado_em > data_fim) funcione.
        all_delivered = self.paginate_with_progress(
            late_delivered_qs, label='Analisando entregas',
            progress_start=15, progress_end=45, chunk_size=100,
        )
        late_delivered = [c for c in all_delivered if c.finalizado_em > c.data_fim]

        # Em aberto com prazo passado (cards não-terminais com data_fim < hoje)
        open_late_qs = (
            base.exclude(status__in=['finalizado', 'inviabilizado'])
                .filter(data_fim__lt=now)
        )
        open_late = self.paginate_with_progress(
            open_late_qs, label='Analisando cards em aberto',
            progress_start=45, progress_end=65, chunk_size=100,
        )

        self.set_progress(60, 'Calculando cycle time por área...')
        ms_day = 86400
        per_area: dict[str, dict[str, Any]] = {}
        for c in late_delivered_qs:
            if not (c.data_inicio and c.finalizado_em):
                continue
            secs = (c.finalizado_em - c.data_inicio).total_seconds()
            if secs < 0:
                continue
            a = per_area.setdefault(c.area, {'sum': 0, 'count': 0})
            a['sum'] += secs
            a['count'] += 1
        area_labels = {a[0]: a[1] for a in CardArea.choices}
        cycle_by_area = sorted(
            [
                {
                    'area': area_labels.get(k, k),
                    'count': v['count'],
                    'avg_days': round(v['sum'] / v['count'] / ms_day, 1) if v['count'] else 0,
                }
                for k, v in per_area.items()
            ],
            key=lambda r: -r['avg_days'],
        )

        self.set_progress(90, 'Finalizando...')
        return {
            'late_delivered': late_delivered,
            'late_delivered_total': len(late_delivered),
            'open_late': open_late,
            'open_late_total': len(open_late),
            'cycle_by_area': cycle_by_area,
        }

    def filters_display(self, data: Any) -> list[FilterDisplay]:
        ps = self.filters.get('period_start')
        pe = self.filters.get('period_end')
        if not ps and not pe:
            return [FilterDisplay('Período', 'Todo o histórico')]
        return [FilterDisplay('Período', f'{ps or "?"} → {pe or "?"}')]

    def build_context(self, data: dict[str, Any]) -> dict[str, Any]:
        return data

    def table_columns(self) -> list[TableColumn]:
        return [
            TableColumn('categoria', 'Categoria', width=22),
            TableColumn('nome', 'Card', width=40),
            TableColumn('projeto', 'Projeto', width=28),
            TableColumn('responsavel', 'Responsável', width=22),
            TableColumn('data_fim', 'Prazo', format='dd/mm/yyyy hh:mm', width=18),
            TableColumn('finalizado_em', 'Finalizado em', format='dd/mm/yyyy hh:mm', width=18),
            TableColumn('atraso_dias', 'Atraso (dias)', width=14),
        ]

    def table_rows(self, data: dict[str, Any]) -> list[dict[str, Any]]:
        now = timezone.now()
        rows = []
        for c in data['late_delivered']:
            atraso = (c.finalizado_em - c.data_fim).days
            rows.append({
                'categoria': 'Entregue atrasado',
                'nome': c.nome,
                'projeto': c.projeto.nome if c.projeto_id else '',
                'responsavel': (
                    f'{c.responsavel.first_name} {c.responsavel.last_name}'.strip()
                    or c.responsavel.username
                ) if c.responsavel_id else '',
                'data_fim': _to_naive(c.data_fim),
                'finalizado_em': _to_naive(c.finalizado_em),
                'atraso_dias': atraso,
            })
        for c in data['open_late']:
            atraso = (now - c.data_fim).days
            rows.append({
                'categoria': 'Em aberto atrasado',
                'nome': c.nome,
                'projeto': c.projeto.nome if c.projeto_id else '',
                'responsavel': (
                    f'{c.responsavel.first_name} {c.responsavel.last_name}'.strip()
                    or c.responsavel.username
                ) if c.responsavel_id else '',
                'data_fim': _to_naive(c.data_fim),
                'finalizado_em': None,
                'atraso_dias': atraso,
            })
        return rows


def _to_naive(dt):
    if dt is None:
        return None
    if timezone.is_aware(dt):
        return timezone.localtime(dt).replace(tzinfo=None)
    return dt

"""
Relatório de Atrasos & Gargalos.

Combina dois pontos de dor:
1. Cards atrasados (entregues fora do prazo OU em aberto com data_fim passada)
2. Tempo em desenvolvimento mais lento por área (entregas atrasadas)

Filtros: period_start / period_end (opcional)
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from django.utils import timezone

from apps.projects.models import Card, CardArea

from apps.projects.dev_time_format import format_minutos_uteis, format_segundos_corridos

from .base import BaseReport, FilterDisplay, TableColumn
from .dev_time_stats import accumulate_card_dev_time, bucket_averages, _new_bucket


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
        # Tipo de data: default 'delivered' (relatório de atrasos é sobre
        # entregas), opcional 'created'.
        date_field = 'created_at' if (
            (self.filters.get('period_date_type') or 'delivered') == 'created'
        ) else 'finalizado_em'
        if period_start:
            late_delivered_qs = late_delivered_qs.filter(**{f'{date_field}__gte': period_start})
        if period_end:
            late_delivered_qs = late_delivered_qs.filter(**{f'{date_field}__lte': period_end})

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

        self.set_progress(60, 'Calculando tempo em desenvolvimento por área...')
        area_labels = {a[0]: a[1] for a in CardArea.choices}
        per_area: dict[str, dict[str, Any]] = {}
        for c in late_delivered:
            if c.segundos_corridos_desenvolvimento is None:
                continue
            a = per_area.setdefault(c.area, {
                'area': area_labels.get(c.area, c.area),
                **_new_bucket(),
            })
            accumulate_card_dev_time(a, c)
        cycle_by_area = sorted(
            [
                {
                    'area': v['area'],
                    **bucket_averages(v),
                }
                for v in per_area.values()
            ],
            key=lambda r: -(r.get('avg_segundos_corridos') or 0),
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
        type_label = {
            'created': 'criação',
            'delivered': 'entrega',
        }.get(self.filters.get('period_date_type') or 'delivered', 'entrega')
        return [FilterDisplay(
            f'Período ({type_label})',
            f'{ps or "?"} → {pe or "?"}',
        )]

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
            TableColumn('dias_corridos_desenvolvimento', 'Dias corridos (dev)', width=16),
            TableColumn('dias_uteis_desenvolvimento', 'Dias úteis (dev)', width=14),
            TableColumn('horas_uteis_desenvolvimento', 'Horas úteis (dev)', width=16),
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
                'dias_corridos_desenvolvimento': (
                    format_segundos_corridos(c.segundos_corridos_desenvolvimento)
                    if c.segundos_corridos_desenvolvimento is not None else None
                ),
                'dias_uteis_desenvolvimento': c.dias_uteis_desenvolvimento,
                'horas_uteis_desenvolvimento': (
                    format_minutos_uteis(c.minutos_uteis_desenvolvimento)
                    if c.minutos_uteis_desenvolvimento is not None else None
                ),
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
                'dias_corridos_desenvolvimento': None,
                'dias_uteis_desenvolvimento': None,
                'horas_uteis_desenvolvimento': None,
                'atraso_dias': atraso,
            })
        return rows


def _to_naive(dt):
    if dt is None:
        return None
    if timezone.is_aware(dt):
        return timezone.localtime(dt).replace(tzinfo=None)
    return dt

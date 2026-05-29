"""
Relatório por Usuário individual.

Filtros:
- user_id (obrigatório)
- period_start / period_end (opcional)

Mostra entregas, on-time %, cycle time pessoal, distribuição por área.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from django.contrib.auth import get_user_model
from django.utils import timezone

from apps.projects.models import Card, CardArea

from .base import BaseReport, FilterDisplay, TableColumn


def _parse_date(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        if 'T' in value:
            return datetime.fromisoformat(value.replace('Z', '+00:00'))
        return datetime.strptime(value, '%Y-%m-%d')
    except (ValueError, TypeError):
        return None


User = get_user_model()


class Report(BaseReport):
    type_id = 'user'
    title = 'Por Usuário'
    template_name = 'reports/user.html'
    orientation = 'portrait'

    def fetch_data(self) -> dict[str, Any]:
        user_id = self.filters.get('user_id')
        if not user_id:
            raise ValueError('Filtro obrigatório: user_id')
        self.set_progress(10, 'Carregando usuário...')
        target = User.objects.get(pk=user_id)

        period_start = _parse_date(self.filters.get('period_start'))
        period_end = _parse_date(self.filters.get('period_end'))

        qs = (
            Card.objects.select_related('projeto', 'projeto__sprint')
            .filter(
                responsavel=target,
                projeto__arquivado=False,
                projeto__is_system=False,
                status='finalizado',
                finalizado_em__isnull=False,
            )
            .order_by('-finalizado_em')
        )
        # Tipo de data: default 'delivered' (relatório por usuário é sobre
        # entregas dele), opcional 'created'.
        date_field = 'created_at' if (
            (self.filters.get('period_date_type') or 'delivered') == 'created'
        ) else 'finalizado_em'
        if period_start:
            qs = qs.filter(**{f'{date_field}__gte': period_start})
        if period_end:
            qs = qs.filter(**{f'{date_field}__lte': period_end})
        delivered = self.paginate_with_progress(
            qs, label='Carregando entregas do usuário',
            progress_start=15, progress_end=70, chunk_size=100,
        )

        # On-time: finalizado_em <= data_fim (cards com ambas as datas).
        with_due = [c for c in delivered if c.data_fim]
        on_time = sum(1 for c in with_due if c.finalizado_em <= c.data_fim)
        late = len(with_due) - on_time
        pct = round(on_time * 100 / len(with_due), 1) if with_due else None

        # Cycle time
        ms_day = 86400
        cycles = []
        for c in delivered:
            if c.data_inicio and c.finalizado_em:
                secs = (c.finalizado_em - c.data_inicio).total_seconds()
                if secs >= 0:
                    cycles.append(secs)
        avg_cycle = round(sum(cycles) / len(cycles) / ms_day, 1) if cycles else None

        # Distribuição por área
        area_labels = {a[0]: a[1] for a in CardArea.choices}
        by_area: dict[str, int] = {}
        for c in delivered:
            by_area[c.area] = by_area.get(c.area, 0) + 1
        total = sum(by_area.values()) or 1
        area_dist = sorted(
            [
                {'area': area_labels.get(k, k), 'count': v, 'pct': round(v * 100 / total, 1)}
                for k, v in by_area.items()
            ],
            key=lambda r: -r['count'],
        )

        self.set_progress(90, 'Montando relatório...')
        full_name = f'{target.first_name} {target.last_name}'.strip() or target.username
        return {
            'target_user': target,
            'target_user_name': full_name,
            'delivered': delivered,
            'total_delivered': len(delivered),
            'on_time': on_time,
            'late': late,
            'on_time_pct': pct,
            'avg_cycle': avg_cycle,
            'area_dist': area_dist,
        }

    def filters_display(self, data: Any) -> list[FilterDisplay]:
        ps = self.filters.get('period_start')
        pe = self.filters.get('period_end')
        if ps or pe:
            type_label = {
                'created': 'criação',
                'delivered': 'entrega',
            }.get(self.filters.get('period_date_type') or 'delivered', 'entrega')
            period_field = FilterDisplay(
                f'Período ({type_label})',
                f'{ps or "?"} → {pe or "?"}',
            )
        else:
            period_field = FilterDisplay('Período', 'Todo o histórico')
        return [
            FilterDisplay('Usuário', data['target_user_name']),
            period_field,
        ]

    def build_context(self, data: dict[str, Any]) -> dict[str, Any]:
        return data

    def table_columns(self) -> list[TableColumn]:
        return [
            TableColumn('nome', 'Card', width=40),
            TableColumn('projeto', 'Projeto', width=28),
            TableColumn('area', 'Área', width=15),
            TableColumn('tipo', 'Tipo', width=20),
            TableColumn('data_fim', 'Prazo', format='dd/mm/yyyy hh:mm', width=18),
            TableColumn('finalizado_em', 'Finalizado em', format='dd/mm/yyyy hh:mm', width=18),
            TableColumn('on_time', 'No prazo?', width=12),
        ]

    def table_rows(self, data: dict[str, Any]) -> list[dict[str, Any]]:
        out = []
        for c in data['delivered']:
            on_time = ''
            if c.data_fim and c.finalizado_em:
                on_time = 'Sim' if c.finalizado_em <= c.data_fim else 'Não'
            out.append({
                'nome': c.nome,
                'projeto': c.projeto.nome if c.projeto_id else '',
                'area': c.get_area_display(),
                'tipo': c.get_tipo_display(),
                'data_fim': _to_naive(c.data_fim),
                'finalizado_em': _to_naive(c.finalizado_em),
                'on_time': on_time,
            })
        return out


def _to_naive(dt):
    if dt is None:
        return None
    if timezone.is_aware(dt):
        return timezone.localtime(dt).replace(tzinfo=None)
    return dt

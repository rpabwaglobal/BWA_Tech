"""
Relatório Executivo — 1 página de KPIs principais.

Filtros: period_start / period_end (opcional)
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from django.utils import timezone

from apps.projects.models import (
    Card,
    CardDateChangeRequestStatus,
    CardDueDateChangeRequest,
    Project,
    Sprint,
)
from apps.formularios.models import ChamadoSuporte, ChamadoSuporteStatus
from apps.suggestions.models import ProjectSuggestion

from .base import BaseReport, FilterDisplay, TableColumn
from .dev_time_stats import aggregate_dev_time


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
    title = 'Executivo (KPIs)'
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
        # Tipo de data do filtro: default 'delivered' (relatório executivo é
        # sobre entregas), opcional 'created' (criação).
        date_field = 'created_at' if (
            (self.filters.get('period_date_type') or 'delivered') == 'created'
        ) else 'finalizado_em'
        if period_start:
            delivered = delivered.filter(**{f'{date_field}__gte': period_start})
        if period_end:
            delivered = delivered.filter(**{f'{date_field}__lte': period_end})
        delivered_list = list(delivered.select_related('projeto'))

        # On-time
        with_due = [c for c in delivered_list if c.data_fim]
        on_time = sum(1 for c in with_due if c.finalizado_em <= c.data_fim)
        on_time_pct = round(on_time * 100 / len(with_due), 1) if with_due else None

        # Tempo médio em desenvolvimento (campos persistidos)
        dev_time = aggregate_dev_time(delivered_list)

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

        # Operação geral (filtrada pelo mesmo período do report).
        # `support_resolved`: chamados marcados como 'Resolvido' (atualização
        # final dentro da janela — `data_atualizacao` reflete a transição).
        # `date_changes_approved`: solicitações que efetivamente mudaram a
        # data de entrega (status 'approved', usa `reviewed_at`).
        # `projects_proposed`: TODAS as sugestões abertas no período, sem
        # filtrar por status (a "proposição" é o evento que conta).
        self.set_progress(80, 'Apurando operação geral...')
        support_qs = ChamadoSuporte.objects.filter(status=ChamadoSuporteStatus.RESOLVIDO)
        if period_start:
            support_qs = support_qs.filter(data_atualizacao__gte=period_start)
        if period_end:
            support_qs = support_qs.filter(data_atualizacao__lte=period_end)
        support_resolved = support_qs.count()

        date_changes_qs = CardDueDateChangeRequest.objects.filter(
            status=CardDateChangeRequestStatus.APPROVED,
        )
        if period_start:
            date_changes_qs = date_changes_qs.filter(reviewed_at__gte=period_start)
        if period_end:
            date_changes_qs = date_changes_qs.filter(reviewed_at__lte=period_end)
        date_changes_approved = date_changes_qs.count()

        suggestions_qs = ProjectSuggestion.objects.all()
        if period_start:
            suggestions_qs = suggestions_qs.filter(created_at__gte=period_start)
        if period_end:
            suggestions_qs = suggestions_qs.filter(created_at__lte=period_end)
        projects_proposed = suggestions_qs.count()

        self.set_progress(95, 'Finalizando...')
        return {
            'total_delivered': len(delivered_list),
            'on_time': on_time,
            'on_time_pct': on_time_pct,
            'late_total': (len(with_due) - on_time) if with_due else 0,
            'avg_cycle': dev_time.get('avg_dias_corridos'),
            'avg_dias_uteis': dev_time.get('avg_dias_uteis'),
            'avg_horas_uteis': dev_time.get('avg_horas_uteis'),
            'dev_time_count': dev_time.get('count', 0),
            'active_sprint': active_sprint,
            'active_projects': active_projects,
            'open_late': open_late,
            'top_user': top_user,
            'support_resolved': support_resolved,
            'date_changes_approved': date_changes_approved,
            'projects_proposed': projects_proposed,
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

    # Executivo não tem export tabular (é uma única página de resumo).
    # Se chamarem xlsx/csv, vai estourar NotImplementedError — UI vai mostrar.
    def table_columns(self) -> list[TableColumn]:
        return []

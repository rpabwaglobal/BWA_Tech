"""
Relatório de Métricas Globais.

Cobre as principais visões da página `/metricas`:
- KPIs do topo (totais)
- Cards finalizados por usuário (ranking)
- Throughput por sprint
- Volume por área
- Cycle time médio (geral, por área, por usuário)

Filtros (mutuamente exclusivos — frontend obriga escolher um dos dois modos):
- period_start / period_end (opcional): filtra cards entregues nesse período
- sprint_ids (opcional, lista de ints): restringe cards + lista de sprints
  do throughput às sprints selecionadas. NÃO afeta "Operação geral"
  (chamados/alterações/sugestões não têm FK pra Sprint).
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from django.db.models import F
from django.utils import timezone

from apps.projects.models import (
    Card,
    CardDateChangeRequestStatus,
    CardDueDateChangeRequest,
    Sprint,
)
from apps.formularios.models import ChamadoSuporte, ChamadoSuporteStatus
from apps.suggestions.models import ProjectSuggestion

from .base import BaseReport, FilterDisplay, TableColumn

# Regra de negócio do app: cards entregues = status finalizado COM finalizado_em.
CLOSED_STATUS = 'finalizado'


def _parse_date(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        if 'T' in value:
            return datetime.fromisoformat(value.replace('Z', '+00:00'))
        return datetime.strptime(value, '%Y-%m-%d')
    except (ValueError, TypeError):
        return None


class Report(BaseReport):
    type_id = 'metrics'
    title = 'Métricas Globais'
    template_name = 'reports/metrics.html'
    orientation = 'portrait'

    def fetch_data(self) -> dict[str, Any]:
        self.set_progress(10, 'Carregando cards...')
        period_start = _parse_date(self.filters.get('period_start'))
        period_end = _parse_date(self.filters.get('period_end'))
        # `sprint_ids` aceita lista (preferencial) ou valor único (defesa
        # contra um cliente antigo enviando string). Strings vazias e itens
        # não-inteiros são descartados.
        raw_ids = self.filters.get('sprint_ids')
        if isinstance(raw_ids, (list, tuple)):
            id_candidates = raw_ids
        elif raw_ids in (None, ''):
            id_candidates = []
        else:
            id_candidates = [raw_ids]
        sprint_ids: list[int] = []
        for v in id_candidates:
            try:
                sprint_ids.append(int(v))
            except (TypeError, ValueError):
                continue

        cards_qs = (
            Card.objects.select_related('projeto', 'responsavel', 'projeto__sprint')
            .filter(projeto__arquivado=False, projeto__is_system=False)
        )
        if sprint_ids:
            cards_qs = cards_qs.filter(projeto__sprint_id__in=sprint_ids)

        closed_qs = cards_qs.filter(status=CLOSED_STATUS, finalizado_em__isnull=False)
        if period_start:
            closed_qs = closed_qs.filter(finalizado_em__gte=period_start)
        if period_end:
            closed_qs = closed_qs.filter(finalizado_em__lte=period_end)

        self.set_progress(30, 'Calculando KPIs...')
        closed_cards = list(closed_qs)
        # Quando há sprints selecionadas, throughput mostra só elas;
        # senão, todas (ordem mais recente primeiro).
        sprints_qs = Sprint.objects.all().order_by('-data_inicio')
        if sprint_ids:
            sprints_qs = sprints_qs.filter(id__in=sprint_ids)
        sprints = list(sprints_qs)

        # KPIs principais
        users_with_deliveries = len({c.responsavel_id for c in closed_cards if c.responsavel_id})
        kpis = {
            'closed_total': len(closed_cards),
            'sprints': len(sprints),
            'users_with_deliveries': users_with_deliveries,
        }

        # Ranking por usuário
        self.set_progress(45, 'Calculando ranking de usuários...')
        per_user: dict[int, dict[str, Any]] = {}
        for c in closed_cards:
            if not c.responsavel_id:
                continue
            row = per_user.setdefault(
                c.responsavel_id,
                {
                    'user_id': c.responsavel_id,
                    'name': (
                        f'{c.responsavel.first_name} {c.responsavel.last_name}'.strip()
                        or c.responsavel.username
                    ),
                    'role': c.responsavel.role if c.responsavel else '',
                    'count': 0,
                },
            )
            row['count'] += 1
        ranking = sorted(per_user.values(), key=lambda r: -r['count'])

        # Throughput por sprint
        self.set_progress(60, 'Calculando throughput por sprint...')
        cards_by_sprint: dict[int, int] = {}
        for c in closed_cards:
            sid = c.projeto.sprint_id if c.projeto_id else None
            if not sid:
                continue
            cards_by_sprint[sid] = cards_by_sprint.get(sid, 0) + 1
        throughput = []
        for s in sprints:
            delivered = cards_by_sprint.get(s.id, 0)
            days = max(1, s.duracao_dias or 1)
            throughput.append({
                'sprint': s.nome,
                'delivered': delivered,
                'days': days,
                'per_day': round(delivered / days, 2),
                'active': not s.finalizada,
            })

        # Volume por área
        self.set_progress(75, 'Calculando volume por área...')
        by_area: dict[str, int] = {}
        for c in closed_cards:
            by_area[c.area] = by_area.get(c.area, 0) + 1
        total = sum(by_area.values()) or 1
        # Map area code → display label
        area_labels = {a.value: a.label for a in Card._meta.get_field('area').choices and []}
        from apps.projects.models import CardArea  # local pra evitar ciclo
        area_labels = {a[0]: a[1] for a in CardArea.choices}
        volume = sorted(
            [
                {'area': area_labels.get(k, k), 'count': v, 'pct': round(v * 100 / total, 1)}
                for k, v in by_area.items()
            ],
            key=lambda r: -r['count'],
        )

        # Cycle time
        self.set_progress(85, 'Calculando cycle time...')
        ms_day = 86400
        total_seconds = 0
        count_with_cycle = 0
        per_user_cycle: dict[int, dict[str, Any]] = {}
        per_area_cycle: dict[str, dict[str, Any]] = {}
        for c in closed_cards:
            if not c.data_inicio or not c.finalizado_em:
                continue
            secs = (c.finalizado_em - c.data_inicio).total_seconds()
            if secs < 0:
                continue
            total_seconds += secs
            count_with_cycle += 1
            if c.responsavel_id:
                u = per_user_cycle.setdefault(c.responsavel_id, {
                    'name': (
                        f'{c.responsavel.first_name} {c.responsavel.last_name}'.strip()
                        or c.responsavel.username
                    ),
                    'role': c.responsavel.role if c.responsavel else '',
                    'sum': 0,
                    'count': 0,
                })
                u['sum'] += secs
                u['count'] += 1
            a = per_area_cycle.setdefault(c.area, {'area': area_labels.get(c.area, c.area), 'sum': 0, 'count': 0})
            a['sum'] += secs
            a['count'] += 1

        avg_overall = round((total_seconds / count_with_cycle / ms_day), 1) if count_with_cycle else 0
        cycle_by_user = sorted(
            [
                {
                    'name': v['name'],
                    'role': v['role'],
                    'count': v['count'],
                    'avg_days': round(v['sum'] / v['count'] / ms_day, 1) if v['count'] else 0,
                }
                for v in per_user_cycle.values()
            ],
            key=lambda r: r['avg_days'],
        )
        cycle_by_area = sorted(
            [
                {
                    'area': v['area'],
                    'count': v['count'],
                    'avg_days': round(v['sum'] / v['count'] / ms_day, 1) if v['count'] else 0,
                }
                for v in per_area_cycle.values()
            ],
            key=lambda r: r['avg_days'],
        )

        # Operação geral (mesma janela do report) — mantém regra dos
        # relatórios Executivo/Métricas em sincronia.
        self.set_progress(90, 'Apurando operação geral...')
        support_qs = ChamadoSuporte.objects.filter(status=ChamadoSuporteStatus.RESOLVIDO)
        if period_start:
            support_qs = support_qs.filter(data_atualizacao__gte=period_start)
        if period_end:
            support_qs = support_qs.filter(data_atualizacao__lte=period_end)

        date_changes_qs = CardDueDateChangeRequest.objects.filter(
            status=CardDateChangeRequestStatus.APPROVED,
        )
        if period_start:
            date_changes_qs = date_changes_qs.filter(reviewed_at__gte=period_start)
        if period_end:
            date_changes_qs = date_changes_qs.filter(reviewed_at__lte=period_end)

        suggestions_qs = ProjectSuggestion.objects.all()
        if period_start:
            suggestions_qs = suggestions_qs.filter(created_at__gte=period_start)
        if period_end:
            suggestions_qs = suggestions_qs.filter(created_at__lte=period_end)

        operations = {
            'support_resolved': support_qs.count(),
            'date_changes_approved': date_changes_qs.count(),
            'projects_proposed': suggestions_qs.count(),
        }

        self.set_progress(95, 'Finalizando...')
        return {
            'kpis': kpis,
            'ranking': ranking,
            'throughput': throughput,
            'volume': volume,
            'cycle': {
                'avg_overall': avg_overall,
                'count_with_cycle': count_with_cycle,
                'by_user': cycle_by_user,
                'by_area': cycle_by_area,
            },
            'operations': operations,
        }

    def filters_display(self, data: Any) -> list[FilterDisplay]:
        out: list[FilterDisplay] = []
        ps = self.filters.get('period_start')
        pe = self.filters.get('period_end')
        if ps or pe:
            out.append(FilterDisplay('Período', f'{ps or "?"} → {pe or "?"}'))
        else:
            out.append(FilterDisplay('Período', 'Todo o histórico'))
        raw_ids = self.filters.get('sprint_ids')
        ids: list[int] = []
        if isinstance(raw_ids, (list, tuple)):
            for v in raw_ids:
                try:
                    ids.append(int(v))
                except (TypeError, ValueError):
                    continue
        elif raw_ids not in (None, ''):
            try:
                ids.append(int(raw_ids))
            except (TypeError, ValueError):
                pass
        if ids:
            names = list(Sprint.objects.filter(id__in=ids).values_list('nome', flat=True))
            label = ', '.join(names) if names else ', '.join(f'#{i}' for i in ids)
            out.append(FilterDisplay('Sprint(s)', label))
        return out

    def build_context(self, data: dict[str, Any]) -> dict[str, Any]:
        return data

    # ── Tabular: ranking de usuários é a tabela padrão pro XLSX/CSV ──
    def table_columns(self) -> list[TableColumn]:
        return [
            TableColumn('rank', '#', width=6),
            TableColumn('name', 'Usuário', width=30),
            TableColumn('role', 'Cargo', width=18),
            TableColumn('count', 'Entregas', width=12),
            TableColumn('avg_cycle_days', 'Cycle médio (dias)', width=20),
        ]

    def table_rows(self, data: dict[str, Any]) -> list[dict[str, Any]]:
        # Junta ranking + cycle por user
        cycle_by_name = {c['name']: c['avg_days'] for c in data['cycle']['by_user']}
        rows: list[dict[str, Any]] = []
        for i, r in enumerate(data['ranking'], start=1):
            rows.append({
                'rank': i,
                'name': r['name'],
                'role': r.get('role', ''),
                'count': r['count'],
                'avg_cycle_days': cycle_by_name.get(r['name'], ''),
            })
        return rows

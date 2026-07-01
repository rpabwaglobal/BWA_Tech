"""
Relatório de Cards.

Filtros opcionais (todos via job.filters):
- sprint_ids (lista) OU sprint_id (single, legado): filtra por sprint(s)
- project_id, status, area, tipo, responsavel_id, prioridade
- period_start, period_end (filtra por created_at)

`sprint_ids`/`period` são mutuamente exclusivos no frontend, mas o backend
aceita ambos defensivamente (interseção, se vierem juntos).

Exporta:
- PDF/DOCX: tabela estilizada com badges de status/prioridade
- XLSX/CSV: planilha com colunas pra filtrar no Excel
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from django.utils import timezone

from apps.projects.models import Card, Project, Sprint

from apps.projects.dev_time_format import format_minutos_uteis, format_segundos_corridos

from .base import BaseReport, FilterDisplay, TableColumn


def _parse_date(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        # Aceita 'YYYY-MM-DD' ou ISO completo
        if 'T' in value:
            return datetime.fromisoformat(value.replace('Z', '+00:00'))
        return datetime.strptime(value, '%Y-%m-%d')
    except (ValueError, TypeError):
        return None


class Report(BaseReport):
    type_id = 'cards'
    title = 'Cards'
    subtitle = None
    template_name = 'reports/cards.html'
    orientation = 'landscape'

    def fetch_data(self) -> list[Card]:
        self.set_progress(5, 'Filtrando cards...')
        qs = (
            Card.objects.select_related('projeto', 'projeto__sprint', 'responsavel')
            .filter(projeto__arquivado=False, projeto__is_system=False)
            .order_by('-finalizado_em', '-created_at')
        )

        # Aceita sprint_ids (lista, preferencial) e sprint_id (legado).
        sprint_ids = _coerce_int_list(self.filters.get('sprint_ids'))
        if not sprint_ids:
            single = self.filters.get('sprint_id')
            if single not in (None, ''):
                try:
                    sprint_ids = [int(single)]
                except (TypeError, ValueError):
                    sprint_ids = []
        if sprint_ids:
            qs = qs.filter(projeto__sprint_id__in=sprint_ids)
        project_id = self.filters.get('project_id')
        if project_id:
            qs = qs.filter(projeto_id=project_id)
        st = self.filters.get('status')
        if st:
            qs = qs.filter(status=st)
        area = self.filters.get('area')
        if area:
            qs = qs.filter(area=area)
        tipo = self.filters.get('tipo')
        if tipo:
            qs = qs.filter(tipo=tipo)
        responsavel_id = self.filters.get('responsavel_id')
        if responsavel_id:
            qs = qs.filter(responsavel_id=responsavel_id)
        prioridade = self.filters.get('prioridade')
        if prioridade:
            qs = qs.filter(prioridade=prioridade)

        period_start = _parse_date(self.filters.get('period_start'))
        period_end = _parse_date(self.filters.get('period_end'))
        # `period_date_type` define se filtra por data de criação ou de
        # entrega (default = created, retrocompatível). Frontend manda
        # 'created' ou 'delivered'.
        date_field = {
            'created': 'created_at',
            'delivered': 'finalizado_em',
        }.get(self.filters.get('period_date_type') or 'created', 'created_at')
        if period_start:
            qs = qs.filter(**{f'{date_field}__gte': period_start})
        if period_end:
            qs = qs.filter(**{f'{date_field}__lte': period_end})

        # Paginação com progresso: barra evolui de 10→65% conforme as páginas
        # vão sendo carregadas. Mensagem "Exportando cards 245/1340".
        return self.paginate_with_progress(
            qs, label='Carregando cards', progress_start=10, progress_end=65, chunk_size=100,
        )

    def filters_display(self, data: Any) -> list[FilterDisplay]:
        out: list[FilterDisplay] = []
        f = self.filters
        sprint_ids = _coerce_int_list(f.get('sprint_ids'))
        if not sprint_ids and f.get('sprint_id') not in (None, ''):
            try:
                sprint_ids = [int(f['sprint_id'])]
            except (TypeError, ValueError):
                sprint_ids = []
        if sprint_ids:
            names = list(Sprint.objects.filter(id__in=sprint_ids).values_list('nome', flat=True))
            label = ', '.join(names) if names else ', '.join(f'#{i}' for i in sprint_ids)
            out.append(FilterDisplay('Sprint(s)', label))
        if f.get('project_id'):
            pr = Project.objects.filter(pk=f['project_id']).first()
            if pr:
                out.append(FilterDisplay('Projeto', pr.nome))
        if f.get('status'):
            out.append(FilterDisplay('Status', f['status']))
        if f.get('area'):
            out.append(FilterDisplay('Área', f['area']))
        if f.get('tipo'):
            out.append(FilterDisplay('Tipo', f['tipo']))
        if f.get('prioridade'):
            out.append(FilterDisplay('Prioridade', f['prioridade']))
        if f.get('period_start') or f.get('period_end'):
            type_label = {
                'created': 'criação',
                'delivered': 'entrega',
            }.get(f.get('period_date_type') or 'created', 'criação')
            out.append(FilterDisplay(
                f'Período ({type_label})',
                f'{f.get("period_start", "?")} → {f.get("period_end", "?")}',
            ))
        return out

    def build_context(self, data: list[Card]) -> dict[str, Any]:
        return {'cards': data, 'total_cards': len(data)}

    # ── Tabular (XLSX/CSV) ──
    def table_columns(self) -> list[TableColumn]:
        return [
            TableColumn('nome', 'Nome', width=40),
            TableColumn('projeto', 'Projeto', width=30),
            TableColumn('sprint', 'Sprint', width=22),
            TableColumn('status', 'Status', width=22),
            TableColumn('area', 'Área', width=15),
            TableColumn('tipo', 'Tipo', width=20),
            TableColumn('prioridade', 'Prioridade', width=14),
            TableColumn('responsavel', 'Responsável', width=22),
            TableColumn('data_inicio', 'Início', format='dd/mm/yyyy hh:mm', width=18),
            TableColumn('data_fim', 'Prazo', format='dd/mm/yyyy hh:mm', width=18),
            TableColumn('finalizado_em', 'Finalizado em', format='dd/mm/yyyy hh:mm', width=18),
            TableColumn('dias_corridos_desenvolvimento', 'Dias corridos (dev)', width=16),
            TableColumn('dias_uteis_desenvolvimento', 'Dias úteis (dev)', width=14),
            TableColumn('horas_uteis_desenvolvimento', 'Horas úteis (dev)', width=16),
            TableColumn('created_at', 'Criado em', format='dd/mm/yyyy hh:mm', width=18),
        ]

    def table_rows(self, data: list[Card]) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        for c in data:
            rows.append({
                'nome': c.nome,
                'projeto': c.projeto.nome if c.projeto_id else '',
                'sprint': (c.projeto.sprint.nome
                           if c.projeto_id and c.projeto.sprint_id else ''),
                'status': c.get_status_display(),
                'area': c.get_area_display(),
                'tipo': c.get_tipo_display(),
                'prioridade': c.get_prioridade_display(),
                'responsavel': (
                    f'{c.responsavel.first_name} {c.responsavel.last_name}'.strip()
                    or c.responsavel.username
                ) if c.responsavel_id else '',
                'data_inicio': _to_naive(c.data_inicio),
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
                'created_at': _to_naive(c.created_at),
            })
        return rows


def _to_naive(dt):
    """openpyxl não aceita datetime tz-aware. Converte para horário local."""
    if dt is None:
        return None
    if timezone.is_aware(dt):
        return timezone.localtime(dt).replace(tzinfo=None)
    return dt


def _coerce_int_list(raw: Any) -> list[int]:
    """Aceita lista/tupla ou valor único e devolve list[int] (filtra
    elementos não-int). Útil pra normalizar filtros vindos do JSON."""
    if raw in (None, ''):
        return []
    candidates = raw if isinstance(raw, (list, tuple)) else [raw]
    out: list[int] = []
    for v in candidates:
        try:
            out.append(int(v))
        except (TypeError, ValueError):
            continue
    return out

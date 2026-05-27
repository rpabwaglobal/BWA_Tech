"""
Relatório de Cards.

Filtros opcionais (todos via job.filters):
- sprint_id, project_id, status, area, tipo, responsavel_id, prioridade
- period_start, period_end (filtra por finalizado_em OU data_fim)

Exporta:
- PDF/DOCX: tabela estilizada com badges de status/prioridade
- XLSX/CSV: planilha com colunas pra filtrar no Excel
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from django.utils import timezone

from apps.projects.models import Card, Project, Sprint

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

        sprint_id = self.filters.get('sprint_id')
        if sprint_id:
            qs = qs.filter(projeto__sprint_id=sprint_id)
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
        if period_start:
            qs = qs.filter(created_at__gte=period_start)
        if period_end:
            qs = qs.filter(created_at__lte=period_end)

        # Paginação com progresso: barra evolui de 10→65% conforme as páginas
        # vão sendo carregadas. Mensagem "Exportando cards 245/1340".
        return self.paginate_with_progress(
            qs, label='Carregando cards', progress_start=10, progress_end=65, chunk_size=100,
        )

    def filters_display(self, data: Any) -> list[FilterDisplay]:
        out: list[FilterDisplay] = []
        f = self.filters
        if f.get('sprint_id'):
            sp = Sprint.objects.filter(pk=f['sprint_id']).first()
            if sp:
                out.append(FilterDisplay('Sprint', sp.nome))
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
            out.append(FilterDisplay(
                'Período',
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

"""
Cálculo de tempo em desenvolvimento: dias corridos, dias úteis e horas de expediente.
Expediente: 07:30–12:30 e 13:30–17:30 (America/Sao_Paulo), excluindo fins de semana e feriados.

QUAIS FERIADOS: os de `apps/projects/feriados.py`, que é a única fonte do
sistema. Antes este módulo lia a tabela de cache da API externa e, quando ela
vinha vazia — que era SEMPRE, medido em produção —, caía num fallback de oito
datas fixas: sem Carnaval, sem Sexta-feira Santa, sem Corpus Christi, sem 20/11.
O cálculo nunca quebrou, só deu outro número em silêncio.
"""
from __future__ import annotations

from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from django.utils import timezone

from .feriados import feriados_entre
from .models import Card, CardStatus

LOCAL_TZ = ZoneInfo('America/Sao_Paulo')
WORK_WINDOWS = (
    (time(7, 30), time(12, 30)),
    (time(13, 30), time(17, 30)),
)

def _to_local(dt: datetime) -> datetime:
    if timezone.is_naive(dt):
        dt = timezone.make_aware(dt, timezone.get_current_timezone())
    return dt.astimezone(LOCAL_TZ)


def _is_weekend(d: date) -> bool:
    return d.weekday() >= 5


def _minutes_in_window(day: date, period_start: datetime, period_end: datetime, win_start: time, win_end: time) -> int:
    tz = period_start.tzinfo
    window_start = datetime.combine(day, win_start, tzinfo=tz)
    window_end = datetime.combine(day, win_end, tzinfo=tz)
    start = max(period_start, window_start)
    end = min(period_end, window_end)
    if end <= start:
        return 0
    return int((end - start).total_seconds() // 60)


def _business_minutes_on_day(day: date, period_start: datetime, period_end: datetime, holidays: set[date]) -> int:
    if _is_weekend(day) or day in holidays:
        return 0
    day_start = datetime.combine(day, time.min, tzinfo=period_start.tzinfo)
    day_end = datetime.combine(day, time(23, 59, 59), tzinfo=period_start.tzinfo)
    seg_start = max(period_start, day_start)
    seg_end = min(period_end, day_end)
    if seg_end <= seg_start:
        return 0
    total = 0
    for win_start, win_end in WORK_WINDOWS:
        total += _minutes_in_window(day, seg_start, seg_end, win_start, win_end)
    return total


def calculate_development_time(data_inicio: datetime, finalizado_em: datetime) -> dict[str, int] | None:
    """
    Retorna dias corridos, dias úteis e horas úteis entre data_inicio e finalizado_em.
    None se intervalo inválido.
    """
    if not data_inicio or not finalizado_em:
        return None
    start = _to_local(data_inicio)
    end = _to_local(finalizado_em)
    if end < start:
        return None

    holidays = feriados_entre(start.date(), end.date())

    total_minutes = 0
    business_days = 0
    current = start.date()
    last_day = end.date()
    while current <= last_day:
        minutes = _business_minutes_on_day(current, start, end, holidays)
        if minutes > 0:
            business_days += 1
            total_minutes += minutes
        current += timedelta(days=1)

    elapsed_seconds = int((end - start).total_seconds())

    return {
        'segundos_corridos_desenvolvimento': elapsed_seconds,
        'dias_uteis_desenvolvimento': business_days,
        'minutos_uteis_desenvolvimento': total_minutes,
    }


def apply_development_time_metrics(card: Card) -> None:
    """Preenche ou limpa métricas de tempo no card conforme status e datas."""
    if card.status != CardStatus.FINALIZADO:
        card.segundos_corridos_desenvolvimento = None
        card.dias_uteis_desenvolvimento = None
        card.minutos_uteis_desenvolvimento = None
        return

    metrics = calculate_development_time(card.data_inicio, card.finalizado_em)
    if metrics is None:
        card.segundos_corridos_desenvolvimento = None
        card.dias_uteis_desenvolvimento = None
        card.minutos_uteis_desenvolvimento = None
        return

    card.segundos_corridos_desenvolvimento = metrics['segundos_corridos_desenvolvimento']
    card.dias_uteis_desenvolvimento = metrics['dias_uteis_desenvolvimento']
    card.minutos_uteis_desenvolvimento = metrics['minutos_uteis_desenvolvimento']

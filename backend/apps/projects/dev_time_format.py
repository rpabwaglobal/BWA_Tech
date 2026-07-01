"""Formatação de tempo em desenvolvimento."""
from __future__ import annotations


def format_segundos_corridos(seconds: int | None) -> str:
    """Ex.: 90000 → '1d 1h', 86400 → '1d', 7200 → '2h', 2700 → '45min'."""
    if seconds is None:
        return '—'
    if seconds <= 0:
        return '0h'
    days, remainder = divmod(int(seconds), 86400)
    hours, remainder = divmod(remainder, 3600)
    minutes = remainder // 60
    if days and hours:
        return f'{days}d {hours}h'
    if days:
        return f'{days}d'
    if hours and minutes:
        return f'{hours}h {minutes}min'
    if hours:
        return f'{hours}h'
    if minutes:
        return f'{minutes}min'
    return '0h'


def average_segundos_corridos(total_seconds: int, count: int) -> int | None:
    if count <= 0:
        return None
    return round(total_seconds / count)


def format_average_segundos_corridos(total_seconds: int, count: int) -> str | None:
    avg = average_segundos_corridos(total_seconds, count)
    if avg is None:
        return None
    return format_segundos_corridos(avg)


def format_minutos_uteis(minutes: int | None) -> str:
    """Ex.: 90 → '1h 30min', 60 → '1h', 45 → '45min', 0 → '0min'."""
    if minutes is None:
        return '—'
    if minutes <= 0:
        return '0min'
    hours, mins = divmod(int(minutes), 60)
    if hours and mins:
        return f'{hours}h {mins}min'
    if hours:
        return f'{hours}h'
    return f'{mins}min'


def average_minutos_uteis(total_minutes: int, count: int) -> int | None:
    if count <= 0:
        return None
    return round(total_minutes / count)


def format_average_minutos_uteis(total_minutes: int, count: int) -> str | None:
    avg = average_minutos_uteis(total_minutes, count)
    if avg is None:
        return None
    return format_minutos_uteis(avg)

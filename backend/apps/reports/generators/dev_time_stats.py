"""
Agregações de tempo em desenvolvimento a partir dos campos persistidos no Card.
"""
from __future__ import annotations

from typing import Any

from apps.projects.dev_time_format import (
    average_segundos_corridos,
    format_average_minutos_uteis,
    format_average_segundos_corridos,
)


def _new_bucket() -> dict[str, Any]:
    return {
        'sum_segundos_corridos': 0,
        'count_corridos': 0,
        'sum_uteis_days': 0,
        'count_uteis_days': 0,
        'sum_minutos': 0,
        'count_minutos': 0,
    }


def accumulate_card_dev_time(bucket: dict[str, Any], card) -> None:
    if card.segundos_corridos_desenvolvimento is not None:
        bucket['sum_segundos_corridos'] += card.segundos_corridos_desenvolvimento
        bucket['count_corridos'] += 1
    if card.dias_uteis_desenvolvimento is not None:
        bucket['sum_uteis_days'] += card.dias_uteis_desenvolvimento
        bucket['count_uteis_days'] += 1
    if card.minutos_uteis_desenvolvimento is not None:
        bucket['sum_minutos'] += card.minutos_uteis_desenvolvimento
        bucket['count_minutos'] += 1


def bucket_averages(bucket: dict[str, Any]) -> dict[str, Any]:
    count = bucket['count_corridos']
    avg_segundos = average_segundos_corridos(
        bucket['sum_segundos_corridos'], bucket['count_corridos'],
    )
    return {
        'count': count,
        'avg_segundos_corridos': avg_segundos,
        'avg_dias_corridos': format_average_segundos_corridos(
            bucket['sum_segundos_corridos'], bucket['count_corridos'],
        ),
        'avg_dias_uteis': (
            round(bucket['sum_uteis_days'] / bucket['count_uteis_days'], 1)
            if bucket['count_uteis_days'] else None
        ),
        'avg_horas_uteis': format_average_minutos_uteis(
            bucket['sum_minutos'], bucket['count_minutos'],
        ),
    }


def aggregate_dev_time(cards) -> dict[str, Any]:
    bucket = _new_bucket()
    for card in cards:
        accumulate_card_dev_time(bucket, card)
    return bucket_averages(bucket)

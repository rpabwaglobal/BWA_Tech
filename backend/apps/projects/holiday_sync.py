"""
Sincronização de feriados (Natal/RN) via Feriados API com cache em banco.
https://feriadosapi.com/docs
"""
from __future__ import annotations

import logging
from datetime import date, datetime

import requests
from django.conf import settings
from django.db import transaction
from django.utils import timezone

from .models import CachedHoliday

logger = logging.getLogger(__name__)

# Natal/RN — capital (endpoint municipal gratuito no plano Free)
NATAL_IBGE = 2408102
FERIADOS_API_BASE = 'https://feriadosapi.com'
MIN_HOLIDAYS_PER_YEAR = 8


def _parse_api_date(value: str) -> date:
    """Converte DD/MM/YYYY da API para date."""
    return datetime.strptime(value.strip(), '%d/%m/%Y').date()


def _year_cache_complete(year: int) -> bool:
    """Ano considerado sincronizado quando há volume mínimo de feriados em cache."""
    return (
        CachedHoliday.objects.filter(year=year, ibge=NATAL_IBGE).count()
        >= MIN_HOLIDAYS_PER_YEAR
    )


def sync_holidays_natal(year: int, *, force: bool = False) -> int:
    """
    Busca feriados de Natal (nacionais + estaduais + municipais) e grava no cache.
    Retorna quantidade de registros criados (não atualizados).
    """
    if year < 2000 or year > 2100:
        raise ValueError(f'Ano fora do intervalo suportado (2000–2100): {year}')

    if not force and _year_cache_complete(year):
        return 0

    api_key = getattr(settings, 'FERIADOS_API_KEY', '') or ''
    if not api_key:
        logger.warning('FERIADOS_API_KEY não configurada; sync de feriados ignorado.')
        return 0

    url = f'{FERIADOS_API_BASE}/api/v1/feriados/cidade/{NATAL_IBGE}'
    response = requests.get(
        url,
        params={'ano': year},
        headers={'Authorization': f'Bearer {api_key}'},
        timeout=30,
    )
    response.raise_for_status()
    payload = response.json()
    feriados = payload.get('feriados') or []

    parsed: list[tuple[date, str, str]] = []
    for item in feriados:
        raw_date = item.get('data')
        if not raw_date:
            continue
        try:
            holiday_date = _parse_api_date(str(raw_date))
        except (ValueError, TypeError) as exc:
            logger.warning('Feriado ignorado (data inválida %r): %s', raw_date, exc)
            continue
        name = ((item.get('nome') or '').strip() or 'Feriado')[:200]
        tipo = ((item.get('tipo') or '').strip() or 'NACIONAL')[:20]
        parsed.append((holiday_date, name, tipo))

    if not parsed:
        logger.warning('Nenhum feriado válido retornado para %s', year)
        return 0

    now = timezone.now()
    created = 0
    with transaction.atomic():
        if force:
            CachedHoliday.objects.filter(year=year, ibge=NATAL_IBGE).delete()
        for holiday_date, name, tipo in parsed:
            _, was_created = CachedHoliday.objects.update_or_create(
                date=holiday_date,
                ibge=NATAL_IBGE,
                defaults={
                    'year': year,
                    'name': name,
                    'tipo': tipo,
                    'synced_at': now,
                },
            )
            if was_created:
                created += 1
    return created


def ensure_holidays_for_range(start: date, end: date) -> None:
    """
    Sincroniza via HTTP cada ano no intervalo — apenas para jobs/comandos ops.
    Não usar no caminho de request (pre_save de cards).
    """
    if start > end:
        start, end = end, start
    for year in range(start.year, end.year + 1):
        try:
            sync_holidays_natal(year)
        except Exception as exc:
            logger.warning('Falha ao sincronizar feriados %s: %s', year, exc)


def holiday_dates_between(start: date, end: date) -> set[date]:
    """Datas de feriado em cache entre start e end (inclusive). Somente leitura local."""
    if start > end:
        start, end = end, start
    qs = CachedHoliday.objects.filter(
        ibge=NATAL_IBGE,
        date__gte=start,
        date__lte=end,
    ).values_list('date', flat=True)
    return set(qs)

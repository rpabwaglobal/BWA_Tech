"""
Limites de período dos relatórios, resolvidos de um jeito só.

O DEFEITO QUE MORAVA AQUI: O ÚLTIMO DIA DO PERÍODO NÃO ENTRAVA.
`datetime.strptime('2026-08-17', '%Y-%m-%d')` devolve `2026-08-17 00:00`, e
`finalizado_em__lte` disso descarta o dia 17 INTEIRO — porque os campos
comparados são `DateTimeField`, e quase toda entrega acontece depois da
meia-noite. Quem pede "até segunda-feira" perde tudo que foi entregue na
segunda-feira. Medido no acervo real: numa janela de uma semana em Inteligência
Artificial, 2 cards sumiam só por causa disso; nas Métricas Globais, 5; no
Executivo, 6.

A saída é um intervalo SEMI-ABERTO: `[início do primeiro dia, início do dia
seguinte ao último)`, usado com `__lt`. Semi-aberto e não `__lte` do último
instante porque não existe "último instante" exato — `23:59:59.999999` deixa de
fora o microssegundo seguinte, e essa é justamente a classe de erro que se quer
parar de escrever.

SOBRE FUSO, PARA NÃO SE PERDER TEMPO COM ISSO DE NOVO: os limites saem daqui
tz-aware, mas isso NÃO é o que conserta o relatório. Com `USE_TZ=True`, o Django
já converte um `datetime` ingênuo usando `get_default_timezone()` — que aqui é
`America/Sao_Paulo`, e não UTC — antes de mandar para o banco. Medido: o mesmo
filtro com limite ingênuo e com limite aware devolve exatamente os mesmos
registros. O ganho de devolver aware é outro, e menor: some o `RuntimeWarning`
de comparação ingênua, e o resultado deixa de depender de um `TIME_ZONE` que
`config/settings.py` define duas vezes (linha 193 como 'UTC', linha 379 como
'America/Sao_Paulo' — vale a segunda).
"""
from datetime import datetime, timedelta

from django.utils import timezone


def _parse(valor: str | None) -> datetime | None:
    if not valor:
        return None
    try:
        if 'T' in valor:
            return datetime.fromisoformat(valor.replace('Z', '+00:00'))
        return datetime.strptime(valor, '%Y-%m-%d')
    except (ValueError, TypeError):
        return None


def _no_fuso_local(bruto: datetime) -> datetime:
    if timezone.is_naive(bruto):
        return timezone.make_aware(bruto, timezone.get_current_timezone())
    return bruto


def inicio_do_periodo(valor: str | None) -> datetime | None:
    """O primeiro instante do dia escolhido, no fuso local."""
    bruto = _parse(valor)
    if bruto is None:
        return None
    return _no_fuso_local(bruto)


def fim_do_periodo(valor: str | None) -> datetime | None:
    """O início do dia SEGUINTE ao escolhido, no fuso local.

    Use com `__lt`, e não com `__lte`: o valor devolvido é a fronteira aberta do
    intervalo, o que faz o último dia entrar inteiro sem depender de quantas
    casas de precisão o banco guarda.
    """
    bruto = _parse(valor)
    if bruto is None:
        return None
    # Quando vem data pura, o dia acaba na virada seguinte. Quando vem um
    # instante ISO completo, quem chamou já escolheu o corte — respeita.
    if valor and 'T' not in valor:
        bruto = bruto + timedelta(days=1)
    return _no_fuso_local(bruto)

"""
Limites de período dos relatórios, resolvidos de um jeito só.

DOIS DEFEITOS MORAVAM AQUI, e os dois faziam o relatório esconder trabalho que
existe — que é a pior falha possível num relatório, porque ninguém desconfia de
um número a menos.

1. O FIM DO PERÍODO ERA MEIA-NOITE. `datetime.strptime('2026-08-17', '%Y-%m-%d')`
   devolve `2026-08-17 00:00`, e `finalizado_em__lte` disso descarta o dia 17
   INTEIRO. Quem pede "até segunda-feira" perde tudo que foi entregue na
   segunda-feira. Medido no acervo real: numa janela de uma semana em
   Inteligência Artificial, 2 cards sumiam só por causa disso.

2. AS BORDAS ERAM INGÊNUAS, OS CAMPOS SÃO UTC. `finalizado_em` é
   `DateTimeField` e o banco guarda em UTC; a data que a pessoa escolhe na tela
   é do fuso dela. Um card finalizado às 22h de 17/08 em São Paulo está gravado
   como 18/08 01:00 UTC — comparar com um limite ingênuo joga esse card para
   fora do dia em que ele de fato foi entregue. É a mesma armadilha que já
   mordeu o cálculo de prazo em outros pontos do sistema.

A saída é um intervalo SEMI-ABERTO no fuso local: `[início do primeiro dia,
início do dia seguinte ao último)`. Semi-aberto e não `<=` do último instante
porque não existe "último instante" exato — `23:59:59.999999` deixa de fora o
microssegundo seguinte, e essa é justamente a classe de erro que se quer parar
de escrever.
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

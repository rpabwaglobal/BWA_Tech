"""Chamados de suporte resolvidos num período — a regra, num lugar só.

QUANDO UM CHAMADO CONTA: no instante em que o card foi movido de etapa pela
última vez, segundo a timeline local (`ChamadoSuporteTimeline`, evento
`etapa_alterada`). Não é a abertura, e não é a última atualização.

ERA `ChamadoSuporte.data_atualizacao` NOS DOIS RELATÓRIOS. Aquele campo é
`auto_now=True`: reescrito em QUALQUER save — mover entre abas, o proxy do portal
re-tocando o registro, corrigir uma nota. A tela de Métricas já havia abandonado
esse campo por isso e passado a ler a timeline; os relatórios ficaram para trás.

MAS O EFEITO NOS RELATÓRIOS NÃO ERA MÊS ERRADO: ERA ZERO. Medido contra a base,
`support_resolved` devolve 0 em qualquer mês, e devolve 0 até sem filtro de
período nenhum — porque a tabela local `ChamadoSuporte` tem ZERO linhas.

OS CHAMADOS NÃO MORAM NESTE BANCO. Vivem no portal externo (api.bwa.global) e
chegam por proxy; o frontend os busca por `formulariosApi`, não pela API local.
O que fica gravado aqui é só a linha do tempo. Então esta consulta está CERTA e
continua lendo uma tabela vazia: o KPI segue em zero até alguém decidir entre
contar pela timeline, buscar no portal, ou tirar o campo do relatório.

Quem de fato consertou o problema relatado foi a tela de Métricas, que lê os
chamados do portal e combina com a timeline local.

POR QUE UM MÓDULO, E NÃO O CONSERTO NO LUGAR ONDE APARECEU: a consulta estava
escrita duas vezes, no gerador Executivo e no de Métricas, com um comentário em
cada dizendo que as duas deviam ficar "em sincronia". Consertar uma faria os dois
relatórios darem números diferentes para o mesmo mês — pior que o erro original,
porque dois números divergentes destroem a confiança nos dois. Mesmo motivo de
`apps/reports/periodo.py` e de `apps/projects/prazo.py` existirem.

CHAMADO RESOLVIDO SEM EVENTO DE ETAPA FICA DE FORA. Sem data de conclusão ele não
pertence a mês nenhum, e entrar com a data errada é pior que não entrar. A tela de
Métricas mostra a contagem desses casos num aviso, para eles não sumirem em
silêncio — a diferença entre omitir e esconder.
"""
from django.db.models import OuterRef, QuerySet, Subquery

from apps.formularios.models import (
    ChamadoSuporte, ChamadoSuporteStatus, ChamadoSuporteTimeline,
    ChamadoSuporteTimelineTipo,
)


def chamados_resolvidos_no_periodo(period_start, period_end) -> QuerySet:
    """Chamados resolvidos cuja CONCLUSÃO caiu na janela.

    `period_start` e `period_end` vêm de `apps.reports.periodo` — intervalo
    semi-aberto `[início, fim)`, e por isso a ponta de cima usa `__lt`. Passar
    `None` em qualquer uma delas dispensa aquele lado do recorte.

    A anotação `resolvido_em` fica disponível em cada linha, para quem precisar
    da data além da contagem.
    """
    ultima_mudanca_de_etapa = (
        ChamadoSuporteTimeline.objects
        .filter(
            chamado_id=OuterRef('pk'),
            tipo_evento=ChamadoSuporteTimelineTipo.ETAPA_ALTERADA,
        )
        .order_by('-data')
        .values('data')[:1]
    )

    qs = (
        ChamadoSuporte.objects
        .filter(status=ChamadoSuporteStatus.RESOLVIDO)
        .annotate(resolvido_em=Subquery(ultima_mudanca_de_etapa))
    )
    # Comparação com NULL em SQL resulta em desconhecido, então chamado sem
    # evento de etapa já fica fora por aqui — não há guarda explícita a escrever.
    if period_start:
        qs = qs.filter(resolvido_em__gte=period_start)
    if period_end:
        qs = qs.filter(resolvido_em__lt=period_end)
    return qs

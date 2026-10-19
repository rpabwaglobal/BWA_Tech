"""Chamados de suporte resolvidos num período — a regra, num lugar só.

QUANDO UM CHAMADO CONTA: no mês em que sua ÚLTIMA movimentação de etapa foi para
a etapa concluída, segundo a timeline local (`ChamadoSuporteTimeline`, evento
`etapa_alterada`). Não é a abertura, e não é a última atualização do registro.

ERA `ChamadoSuporte.data_atualizacao` NOS DOIS RELATÓRIOS. Aquele campo é
`auto_now=True`: reescrito em QUALQUER save — mover entre abas, o proxy do portal
re-tocando o registro, corrigir uma nota. A tela de Métricas já havia abandonado
esse campo por isso e passado a ler a timeline; os relatórios ficaram para trás.

MAS O EFEITO NOS RELATÓRIOS NÃO ERA MÊS ERRADO: ERA ZERO. Medido contra a base,
`support_resolved` devolvia 0 em qualquer mês, e devolvia 0 até sem filtro de
período nenhum — porque a tabela local `ChamadoSuporte` tem ZERO linhas.

OS CHAMADOS NÃO MORAM NESTE BANCO. Vivem no portal externo (api.bwa.global) e
chegam por proxy; o frontend os busca por `formulariosApi`, não pela API local.
O que fica gravado aqui é só a linha do tempo. Por isso a primeira versão desta
correção — que consertou a data mas seguiu lendo `ChamadoSuporte` — continuou
devolvendo zero: estava certa e sem dados. A consulta agora lê a timeline, que é
a única fonte que de fato existe neste banco.

POR QUE PELA CHAVE, E NÃO PELO RÓTULO: a `descricao` do evento é montada pelo
FRONTEND com o rótulo de exibição da etapa ('Concluído'). Contar a partir daquele
texto faria um relatório do backend depender de um texto de interface: renomear a
etapa na tela derrubaria o número em silêncio, e eventos antigos e novos
passariam a discordar entre si. `ChamadoSuporteTimeline.etapa_destino` guarda a
CHAVE justamente para isso, e a migração `formularios.0014` preencheu o
histórico — 1.010 de 1.010 eventos, nenhum rótulo fora do mapa.

POR QUE UM MÓDULO, E NÃO O CONSERTO NO LUGAR ONDE APARECEU: a consulta estava
escrita duas vezes, no gerador Executivo e no de Métricas, com um comentário em
cada dizendo que as duas deviam ficar "em sincronia". Consertar uma faria os dois
relatórios darem números diferentes para o mesmo mês — pior que o erro original,
porque dois números divergentes destroem a confiança nos dois. Mesmo motivo de
`apps/reports/periodo.py` e de `apps/projects/prazo.py` existirem.

CHAMADO SEM EVENTO DE ETAPA FICA DE FORA. Sem data de conclusão ele não pertence
a mês nenhum, e entrar com a data errada é pior que não entrar. A tela de
Métricas mostra a contagem desses casos num aviso, para eles não sumirem em
silêncio — a diferença entre omitir e esconder.
"""
from django.db.models import Max

from apps.formularios.models import (
    ChamadoSuporteTimeline, ChamadoSuporteTimelineTipo,
)

#: A chave da etapa concluída, igual à do kanban de Suporte. É CHAVE, não
#: rótulo: ver "POR QUE PELA CHAVE" no topo deste módulo.
ETAPA_CONCLUIDA = 'finalizado'


def contar_resolvidos_no_periodo(period_start, period_end) -> int:
    """Chamados cuja ÚLTIMA movimentação foi para a etapa concluída, na janela.

    `period_start` e `period_end` vêm de `apps.reports.periodo` — intervalo
    semi-aberto `[início, fim)`. Passar `None` em qualquer uma delas dispensa
    aquele lado do recorte.

    É a ÚLTIMA movimentação que vale: um chamado reaberto e resolvido de novo
    conta na segunda vez, e um que foi concluído e depois reaberto não conta. A
    tela de Métricas usa o mesmo critério (ordena por `-data` e pega o
    primeiro), e as duas precisam concordar.

    Medido na base em 19/10/2026: 119 chamados concluídos em setembro e 85 em
    outubro, contra os 0 que os relatórios mostravam.
    """
    ultimo_por_chamado = (
        ChamadoSuporteTimeline.objects
        .filter(tipo_evento=ChamadoSuporteTimelineTipo.ETAPA_ALTERADA)
        .values('chamado_id')
        .annotate(ultima=Max('data'))
    )

    # O par (chamado, instante) do último movimento. Juntar de volta na tabela
    # é o que permite perguntar PARA ONDE aquele último movimento foi — um
    # `filter(etapa_destino=...)` antes da agregação responderia outra coisa:
    # "teve ALGUM movimento para concluído", que conta chamado reaberto depois.
    pares = {(x['chamado_id'], x['ultima']) for x in ultimo_por_chamado}
    if not pares:
        return 0

    candidatos = (
        ChamadoSuporteTimeline.objects
        .filter(
            tipo_evento=ChamadoSuporteTimelineTipo.ETAPA_ALTERADA,
            etapa_destino=ETAPA_CONCLUIDA,
        )
        .values_list('chamado_id', 'data')
    )

    total = 0
    for chamado_id, data in candidatos:
        if (chamado_id, data) not in pares:
            continue
        if period_start and data < period_start:
            continue
        if period_end and data >= period_end:
            continue
        total += 1
    return total

"""
Tarefas periódicas do motor de feedback.

Nome EXPLÍCITO no `@shared_task(name='feedbacks.…')`, padrão de
apps/reports/tasks.py: desacopla a chave do CELERY_BEAT_SCHEDULE do caminho do
módulo. A descoberta é automática (`app.autodiscover_tasks()` em
config/celery.py:30 varre o `tasks.py` de todo app em INSTALLED_APPS).

Cadência diária nas duas: a granularidade do domínio é DIA, e CELERY_TIMEZONE
já é America/Sao_Paulo, então o crontab dispara em horário local.
"""
from __future__ import annotations

import logging
from datetime import timedelta

from celery import shared_task
from django.conf import settings
from django.utils import timezone

from .models import EstadoPedido, PedidoFeedback, RespostaFeedback
from .services import notificar_transicao

logger = logging.getLogger(__name__)


@shared_task(name='feedbacks.liberar_pedidos_no_prazo')
def liberar_pedidos_no_prazo() -> dict:
    """Promove os pedidos que completaram a espera: aguardando_prazo -> aguardando_resposta.

    Sem e-mail, os 30 dias VIRARAM o gatilho da etapa: antes era "e-mail enviado
    com sucesso -> muda de etapa"; agora é "completou o prazo a partir de
    data_referencia -> muda de etapa", e quem faz isso é esta varredura.

    Toda a aritmética é em DATA LOCAL (`timezone.localdate()`, nunca
    `timezone.now().date()`, que é UTC): as duas divergem das 21h à meia-noite e
    isso já causou bug neste projeto. Como `data_referencia` é DateField e já
    chega convertida pela fase 2, aqui não há nenhuma conversão de fuso.

    IDEMPOTÊNCIA: o estado entra no WHERE do UPDATE, então o banco serializa
    duas execuções concorrentes e o ROWCOUNT decide quem promoveu. O hook de
    sincronização só dispara com rowcount == 1 — nunca duas vezes para a mesma
    transição. Mesmo padrão de `finalizar_sprints_por_data`
    (projects/tasks.py:242-267): estado no banco como trava, sem lock externo.

    ROBUSTEZ: um item problemático não derruba a fila. Cada pedido é processado
    no seu próprio try/except; um erro é logado e a varredura segue.
    """
    dias = getattr(settings, 'FEEDBACK_ESPERA_DIAS', 30)
    corte = timezone.localdate() - timedelta(days=dias)

    # Materializa só os ids: o UPDATE seguinte re-checa o estado, então uma
    # lista levemente desatualizada é inofensiva — e evita segurar um cursor
    # aberto enquanto o hook da fase 2 escreve no kanban.
    ids = list(
        PedidoFeedback.objects
        .filter(estado=EstadoPedido.AGUARDANDO_PRAZO, data_referencia__lte=corte)
        .values_list('pk', flat=True)
    )

    promovidos = 0
    falhas = 0
    for pedido_id in ids:
        try:
            agora = timezone.now()
            linhas = PedidoFeedback.objects.filter(
                pk=pedido_id, estado=EstadoPedido.AGUARDANDO_PRAZO,
            ).update(
                estado=EstadoPedido.AGUARDANDO_RESPOSTA,
                atualizado_em=agora,
            )
            if linhas == 1:
                promovidos += 1
                notificar_transicao(pedido_id, EstadoPedido.AGUARDANDO_RESPOSTA)
        except Exception:  # noqa: BLE001 — um pedido ruim não pode parar os outros
            falhas += 1
            # Nunca logamos o token: o id do pedido basta para investigar.
            logger.exception('Feedback: falha ao promover o pedido %s', pedido_id)

    reconciliados = _reconciliar_colunas_do_kanban()

    if promovidos or falhas or reconciliados:
        logger.info(
            'Feedback: %s pedido(s) promovido(s) para aguardando_resposta, %s falha(s), '
            '%s card(s) reconciliado(s).',
            promovidos, falhas, reconciliados,
        )
    return {'promovidos': promovidos, 'falhas': falhas, 'reconciliados': reconciliados}


def _reconciliar_colunas_do_kanban() -> int:
    """Devolve todo card de feedback à coluna que o PEDIDO dele manda. Devolve quantos.

    FECHA O ÚNICO BURACO ESTRUTURAL DO HOOK. `notificar_transicao` roda DEPOIS de
    o UPDATE de estado já ter sido commitado, e a exceção dele vira só log nos
    dois chamadores. Como o estado já saiu do valor que a varredura procura
    (`estado=AGUARDANDO_PRAZO` no WHERE lá em cima), a próxima execução não tenta
    de novo: sem isto, um pedido em 'aguardando_resposta' com o card parado em
    "Aguardando 30 dias" ficaria assim PARA SEMPRE.

    Roda no FIM da varredura que já existe: nenhuma task nova, nenhuma entrada
    nova no CELERY_BEAT_SCHEDULE, nenhuma coluna nova. Uma vez por dia o card
    volta a espelhar o pedido — que é literalmente a definição de PROJEÇÃO,
    agora garantida em vez de esperada.

    `.update()` cru pelo mesmo motivo do hook: `save()` acordaria os signals do
    Card (CardLog, notificação, broadcast) para uma correção de rotina.
    """
    from apps.projects.models import Card

    total = 0
    for estado in EstadoPedido.values:
        # `pedido_exibido` é o related_name do OneToOne `card_kanban`: só cards de
        # feedback entram nesta consulta. O Django reescreve o filtro com join
        # como `WHERE id IN (subquery)`, então o UPDATE é válido.
        total += (
            Card.objects.filter(pedido_exibido__estado=estado)
            .exclude(status=estado)
            .update(status=estado)
        )
    return total


@shared_task(name='feedbacks.limpar_respostas_expiradas')
def limpar_respostas_expiradas() -> dict:
    """Apaga o CONTEÚDO das respostas vencidas, preservando o fato e a data.

    Política copiada de `reports.limpar_relatorios_expirados`: a LINHA de
    auditoria fica, o conteúdo some. Aqui isso significa apagar a
    RespostaFeedback INTEIRA — é ela que concentra o dado pessoal (LGPD) — e
    deixar o PedidoFeedback com `estado='respondido'` e `respondido_em`. O FATO e
    a DATA sobrevivem sem o texto, e por isso também não é preciso nenhuma coluna
    `anonimizado_em`.

    Como um pedido tem VÁRIAS respostas e cada uma cumpre o seu próprio prazo,
    um pedido pode ficar com parte das linhas apagada e parte viva. É o
    comportamento correto — e é por isso que o contador do preview conta linhas
    VIVAS: ele cai junto com o texto, coerente com o que a tela já pratica.

    `FEEDBACK_RETENCAO_DIAS = 0` DESLIGA a limpeza, e é o default proposital: o
    prazo é decisão de negócio, não default técnico. Enquanto o usuário não
    definir o número, nada é apagado.

    `getattr` com default para a task não explodir se o setting sumir — mesmo
    cuidado de reports/tasks.py:121.
    """
    dias = getattr(settings, 'FEEDBACK_RETENCAO_DIAS', 0)
    if not dias or dias <= 0:
        return {'apagadas': 0, 'falhas': 0, 'desligado': True}

    corte = timezone.now() - timedelta(days=dias)
    # O corte é POR LINHA (`enviado_em`), nunca pelo `respondido_em` do PEDIDO.
    # Com várias respostas por pedido, `respondido_em` congela no instante da
    # PRIMEIRA resposta — filtrar por ele casaria TODAS as linhas daquele pedido,
    # inclusive uma resposta enviada HOJE, que seria apagada amanhã sem ter
    # cumprido um dia sequer do prazo. Seria perda de dado do usuário disfarçada
    # de LGPD. Cada resposta cumpre o SEU prazo, que é literalmente o que o
    # setting define: dias que o TEXTO sobrevive DEPOIS DE ENVIADO.
    ids = list(
        RespostaFeedback.objects
        .filter(enviado_em__lt=corte)
        .values_list('pk', flat=True)
    )

    apagadas = 0
    falhas = 0
    for resposta_id in ids:
        try:
            excluidas, _ = RespostaFeedback.objects.filter(pk=resposta_id).delete()
            if excluidas:
                apagadas += 1
        except Exception:  # noqa: BLE001 — tolerância por item, como em reports
            falhas += 1
            logger.exception('Feedback: falha ao apagar a resposta %s', resposta_id)

    if apagadas or falhas:
        logger.info(
            'Feedback: %s resposta(s) apagada(s) por retenção (%s dia(s)), %s falha(s).',
            apagadas, dias, falhas,
        )
    return {'apagadas': apagadas, 'falhas': falhas, 'desligado': False}

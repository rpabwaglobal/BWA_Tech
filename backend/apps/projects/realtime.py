"""Funções de broadcast WebSocket para o app projects.

Mantém separado de `notification_utils.py` (que é específico para notificações
persistentes do model Notification) — aqui ficam eventos efêmeros tipo
"card moveu", que não viram registro no banco.
"""

from __future__ import annotations

import logging

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.utils import timezone

logger = logging.getLogger(__name__)


def _sprint_is_active(sprint) -> bool:
    """Sprint considerada 'em andamento' = não finalizada e dentro do intervalo
    [data_inicio, fechamento_em]. Quando False, broadcast é no-op para essa
    sprint (alinha com o pedido do produto: só sprint atual gera realtime)."""
    if not sprint or sprint.finalizada:
        return False
    now = timezone.now()
    if sprint.data_inicio and sprint.data_inicio > now:
        return False
    if sprint.fechamento_em and sprint.fechamento_em < now:
        return False
    return True


def broadcast_kanban_changed(card, actor_user_id=None) -> None:
    """Invalida widgets (ex.: «Usuários sem card» no dashboard) para clientes
    conectados ao Kanban da sprint em andamento."""
    projeto = getattr(card, 'projeto', None)
    sprint = getattr(projeto, 'sprint', None) if projeto else None
    if not _sprint_is_active(sprint):
        return

    group_name = f'sprint_{sprint.id}_kanban'
    try:
        # `get_channel_layer()` DENTRO do try: ele não só devolve None quando
        # não há camada — ele LEVANTA quando a camada está configurada e não
        # pode ser construída (BACKEND inexistente, CONFIG inválida, servidor
        # fora do ar na instanciação). Como esta função é chamada do post_save
        # do Card, uma exceção aqui subia pelo signal e derrubava a request:
        # com o Redis mal configurado, mover um card no quadro respondia 500.
        # Tempo real é melhoria de UX — a escrita já aconteceu e não pode ser
        # desfeita porque o WebSocket caiu.
        channel_layer = get_channel_layer()
        if not channel_layer:
            return
        async_to_sync(channel_layer.group_send)(
            group_name,
            {
                'type': 'kanban_changed',
                'card_id': card.id,
                'actor_user_id': actor_user_id,
            },
        )
    except Exception:
        logger.exception(
            'Falha ao broadcast kanban_changed: card=%s sprint=%s',
            card.id,
            sprint.id,
        )


def broadcast_card_moved(card, old_status: str, new_status: str, actor_user_id=None) -> None:
    """Notifica todos os clientes conectados ao Kanban da sprint do card que
    um card mudou de status.

    No-op se:
    - card não tem projeto ou projeto não tem sprint
    - sprint não está em andamento
    - channel layer não está configurada

    Frontend pode usar `actor_user_id` para anti-eco (ignorar o próprio evento).
    """
    projeto = getattr(card, 'projeto', None)
    sprint = getattr(projeto, 'sprint', None) if projeto else None
    if not _sprint_is_active(sprint):
        return

    group_name = f'sprint_{sprint.id}_kanban'
    try:
        # Dentro do try pelo mesmo motivo do `broadcast_kanban_changed` acima:
        # camada configurada e inconstruível LEVANTA, e este ponto é chamado do
        # post_save do Card — a exceção derrubava a movimentação do card.
        channel_layer = get_channel_layer()
        if not channel_layer:
            return
        async_to_sync(channel_layer.group_send)(
            group_name,
            {
                'type': 'card_movement',  # bate com handler card_movement do SprintKanbanConsumer
                'card_id': card.id,
                'old_status': old_status,
                'new_status': new_status,
                'actor_user_id': actor_user_id,
            },
        )
        logger.debug(
            'broadcast_card_moved enviado: card=%s sprint=%s %s→%s',
            card.id, sprint.id, old_status, new_status,
        )
        broadcast_kanban_changed(card, actor_user_id=actor_user_id)
    except Exception:
        logger.exception(
            'Falha ao broadcast card_moved: card=%s sprint=%s', card.id, sprint.id,
        )


def broadcast_solicitacoes_changed(card, sempre_ids=()) -> None:
    """Avisa que o painel de Demandas/Solicitações mudou — sem dizer o que.

    O evento é literalmente `{'type': 'solicitacoes_changed'}`. POR QUE SEM
    PAYLOAD: quem decide o que cada pessoa enxerga da fila é o GET da API, que
    já passa por `scope_card_reopen_requests` / `scope_card_date_change_requests`.
    Mandar a linha serializada obrigaria este emissor a repetir aquela decisão
    de visibilidade fora de qualquer queryset — o erro que
    `formularios/realtime.py` teve de desfazer. Aqui o pior caso de errar o
    destinatário é um GET desperdiçado, não um vazamento de conteúdo.

    DESTINATÁRIO = quem tem `view_content` (o piso de visibilidade do painel,
    `PodeVerConteudo`), recortado pelo setor que alcança o card. NÃO é "quem tem
    `approve_card_reopen`": as três abas e seus CONTADORES são renderizados para
    todo mundo, só Aprovar/Recusar é restrito (Projects.tsx). Avisar só quem
    aprova deixaria o contador velho para quase todas as sessões — o bug de
    volta para a maioria.

    O recorte por setor não protege conteúdo (não há conteúdo aqui), protege
    CADÊNCIA: sem ele, alguém do setor A mediria a frequência de reaberturas do
    setor B. Inócuo enquanto `SETOR_SCOPING_ENABLED` estiver desligada — e é
    justamente o vazamento dormente que ele fecha no dia em que ela ligar.

    `sempre_ids`: gente ligada ao pedido por vínculo explícito (o solicitante),
    que não pode ser calada por um detalhe de cadastro de setor.

    Custo: ~2 consultas com a flag OFF, ~8 constantes com ela ligada. A
    resolução acontece UMA vez por evento, nunca dentro de laço.
    """
    if card is None:
        return
    # Solicitação de projeto arquivado não aparece no painel de ninguém: o
    # `list` das duas filas filtra `card__projeto__arquivado=False`. Emitir aqui
    # dispararia a recarga completa em toda sessão aberta para mudar zero pixel.
    projeto = getattr(card, 'projeto', None)
    if projeto is not None and getattr(projeto, 'arquivado', False):
        return

    try:
        # Imports TARDIOS: `signals` importa este módulo (também de forma
        # tardia) para os broadcasts do kanban — importar no topo inverteria o
        # grafo e criaria ciclo.
        from apps.accounts.permissions import usuarios_com_perm_qs
        from apps.accounts.realtime import notify_users

        from .signals import usuarios_que_alcancam

        ids = list(
            usuarios_que_alcancam(
                usuarios_com_perm_qs('view_content'),
                card,
                sempre_ids=tuple(sempre_ids),
            ).values_list('id', flat=True)
        )
        notify_users(ids, 'solicitacoes_changed')
    except Exception:
        # Tempo real é melhoria de UX: a solicitação já foi commitada e não
        # pode ser desfeita porque o WebSocket caiu (mesma postura do
        # `_notificar_solicitante` em views.py).
        logger.exception(
            'Falha ao broadcast solicitacoes_changed: card=%s', getattr(card, 'id', None),
        )

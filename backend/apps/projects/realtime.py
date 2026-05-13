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

    channel_layer = get_channel_layer()
    if not channel_layer:
        return

    group_name = f'sprint_{sprint.id}_kanban'
    try:
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
    except Exception:
        logger.exception(
            'Falha ao broadcast card_moved: card=%s sprint=%s', card.id, sprint.id,
        )

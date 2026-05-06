import logging

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer

logger = logging.getLogger(__name__)

SUPORTE_KANBAN_GROUP = 'suporte_kanban'


def broadcast_chamado(event: str, payload: dict) -> None:
    """Envia atualização do Kanban para todos os clientes ligados em /ws/suporte/."""
    channel_layer = get_channel_layer()
    if channel_layer is None:
        logger.warning('Channel layer não configurado; broadcast suporte ignorado.')
        return
    try:
        async_to_sync(channel_layer.group_send)(
            SUPORTE_KANBAN_GROUP,
            {
                'type': 'suporte.kanban_push',
                'event': event,
                'payload': payload,
            },
        )
    except Exception:
        logger.exception('Falha ao enviar evento suporte realtime.')

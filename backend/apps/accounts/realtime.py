"""Push em tempo real de mudanças de acesso do usuário (cargo, permissões
granulares, setor, ativação/desativação). Reaproveita o grupo de WebSocket
`user_{id}` já usado para notificações (`apps.projects.consumers.
NotificationConsumer`) — evita abrir uma segunda conexão só para isso.

O evento não carrega o payload novo: o cliente, ao recebê-lo, refaz
GET /users/me/ (fonte de verdade, já filtra o que cada um pode ver) e
atualiza o AuthContext. Mantém o consumer burro e evita duplicar no backend
a lógica de serialização/visibilidade que já vive no DRF.
"""
import logging

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer

logger = logging.getLogger(__name__)


def _group_send(user_id, event_type):
    channel_layer = get_channel_layer()
    if channel_layer is None:
        logger.warning('Channel layer indisponível — %s não enviado (usuario %s)', event_type, user_id)
        return
    try:
        async_to_sync(channel_layer.group_send)(f'user_{user_id}', {'type': event_type})
    except Exception:
        logger.exception('Erro ao enviar %s via WebSocket (usuario %s)', event_type, user_id)


def notify_permissions_changed(user_ids):
    """Avisa um ou vários usuários que cargo/permissões/setor mudaram — o
    cliente deve refazer GET /users/me/ e atualizar a UI na hora (ganha ou
    perde acesso a telas/ações sem precisar de F5)."""
    ids = [user_ids] if isinstance(user_ids, int) else list(user_ids)
    for uid in ids:
        _group_send(uid, 'permissions_changed')


def notify_account_deactivated(user_id):
    """Avisa o usuário desativado para encerrar a sessão imediatamente. O
    token já foi revogado no servidor (ver UserViewSet.set_active) — isto só
    evita esperar a próxima request falhar com 401 para o usuário perceber."""
    _group_send(user_id, 'account_deactivated')

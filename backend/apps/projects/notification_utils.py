from channels.layers import get_channel_layer
from asgiref.sync import async_to_sync
from django.contrib.auth import get_user_model
from .models import Notification, NotificationType, UserNotificationPreference
import logging

logger = logging.getLogger(__name__)

User = get_user_model()


def send_notification(
    user_id,
    tipo: str,
    titulo: str,
    mensagem: str,
    card_id=None,
    sprint_id=None,
    project_id=None,
    metadata=None
):
    """
    Cria uma notificação no banco de dados e envia via WebSocket.
    
    Args:
        user_id: ID do usuário destinatário
        tipo: Tipo da notificação (NotificationType)
        titulo: Título da notificação
        mensagem: Mensagem da notificação
        card_id: ID do card relacionado (opcional)
        sprint_id: ID da sprint relacionada (opcional)
        project_id: ID do projeto relacionado (opcional)
        metadata: Dicionário com metadados extras (opcional)
    """
    try:
        user = User.objects.get(id=user_id)
    except User.DoesNotExist:
        return None

    # Verifica preferência do usuário. Se desativada, NÃO cria a notificação.
    # Cria registro on-demand com defaults se ainda não existir.
    prefs, _ = UserNotificationPreference.objects.get_or_create(user=user)
    if not prefs.is_enabled(tipo):
        logger.debug(
            'Notificacao suprimida pela preferencia do usuario: user=%s tipo=%s',
            user_id, tipo,
        )
        return None

    notification = Notification.objects.create(
        usuario=user,
        tipo=tipo,
        titulo=titulo,
        mensagem=mensagem,
        card_id=card_id,
        sprint_id=sprint_id,
        project_id=project_id,
        metadata=metadata or {}
    )
    
    # Enviar via WebSocket
    try:
        channel_layer = get_channel_layer()
        if channel_layer:
            async_to_sync(channel_layer.group_send)(
                f'user_{user_id}',
                {
                    'type': 'notification_message',
                    'notification': {
                        'id': str(notification.id),
                        'tipo': notification.tipo,
                        'tipo_display': notification.get_tipo_display(),
                        'titulo': notification.titulo,
                        'mensagem': notification.mensagem,
                        'lida': notification.lida,
                        'data_criacao': notification.data_criacao.isoformat(),
                        'card_id': str(notification.card_id) if notification.card_id else None,
                        'sprint_id': str(notification.sprint_id) if notification.sprint_id else None,
                        'project_id': str(notification.project_id) if notification.project_id else None,
                        'metadata': notification.metadata,
                    }
                }
            )
            logger.info(f'Notificacao enviada via WebSocket para usuario {user_id}: {titulo}')
        else:
            logger.warning(f'Channel layer nao disponivel. Notificacao criada mas nao enviada via WebSocket.')
    except Exception as e:
        logger.error(f'Erro ao enviar notificacao via WebSocket: {e}')
        # Continuar mesmo se houver erro no WebSocket - a notificação já foi salva no banco
    
    return notification


def send_notification_to_multiple_users(
    user_ids,
    tipo: str,
    titulo: str,
    mensagem: str,
    card_id=None,
    sprint_id=None,
    project_id=None,
    metadata=None
):
    """
    Envia notificação para múltiplos usuários.
    
    Args:
        user_ids: Lista de IDs de usuários
        ... (outros parâmetros iguais a send_notification)
    """
    notifications = []
    for user_id in user_ids:
        notification = send_notification(
            user_id=user_id,
            tipo=tipo,
            titulo=titulo,
            mensagem=mensagem,
            card_id=card_id,
            sprint_id=sprint_id,
            project_id=project_id,
            metadata=metadata
        )
        if notification:
            notifications.append(notification)
    return notifications

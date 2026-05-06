import json
import logging

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncWebsocketConsumer
from rest_framework.authtoken.models import Token

from .realtime import SUPORTE_KANBAN_GROUP

logger = logging.getLogger(__name__)


class SuporteKanbanConsumer(AsyncWebsocketConsumer):
    """Todos os utilizadores autenticados (Token query/header) recebem eventos do grupo Kanban."""

    async def connect(self):
        self.user = None
        query_string = self.scope.get('query_string', b'').decode()
        token = None
        if query_string:
            params = dict(param.split('=') for param in query_string.split('&') if '=' in param)
            token = params.get('token')
        if not token:
            headers = dict(self.scope.get('headers', []))
            auth_header = headers.get(b'authorization', b'').decode()
            if auth_header.startswith('Token '):
                token = auth_header[6:]
        if token:
            self.user = await self.get_user_from_token(token)
        if not self.user:
            logger.warning('WebSocket suporte: sem token válido')
            await self.close()
            return

        await self.channel_layer.group_add(SUPORTE_KANBAN_GROUP, self.channel_name)
        await self.accept()
        logger.info('WebSocket suporte Kanban ligado: %s', self.user.username)

    async def disconnect(self, close_code):
        try:
            await self.channel_layer.group_discard(SUPORTE_KANBAN_GROUP, self.channel_name)
        except Exception:
            pass

    async def receive(self, text_data):
        try:
            data = json.loads(text_data)
            if data.get('type') == 'ping':
                await self.send(text_data=json.dumps({'type': 'pong'}))
        except json.JSONDecodeError:
            pass

    async def suporte_kanban_push(self, event):
        await self.send(
            text_data=json.dumps(
                {
                    'type': 'suporte',
                    'event': event['event'],
                    'data': event['payload'],
                },
            ),
        )

    @database_sync_to_async
    def get_user_from_token(self, token_key):
        try:
            token = Token.objects.select_related('user').get(key=token_key)
            return token.user if token.user.is_active else None
        except Token.DoesNotExist:
            return None

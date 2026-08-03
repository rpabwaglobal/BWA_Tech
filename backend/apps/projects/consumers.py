import json
import logging
from urllib.parse import parse_qs

from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async
from django.contrib.auth import get_user_model
from rest_framework.authtoken.models import Token

logger = logging.getLogger(__name__)
User = get_user_model()


class NotificationConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        self.user = None
        self.user_id = None
        
        # Obter token da query string ou headers
        query_string = self.scope.get('query_string', b'').decode()
        token = None
        
        # Tentar obter token da query string
        if query_string:
            params = dict(param.split('=') for param in query_string.split('&') if '=' in param)
            token = params.get('token')
        
        # Se não encontrou na query string, tentar nos headers
        if not token:
            headers = dict(self.scope.get('headers', []))
            auth_header = headers.get(b'authorization', b'').decode()
            if auth_header.startswith('Token '):
                token = auth_header[6:]
        
        # Autenticar usuário
        if token:
            self.user = await self.get_user_from_token(token)
            if self.user:
                self.user_id = self.user.id
                self.group_name = f'user_{self.user_id}'
                
                # Adicionar ao grupo
                await self.channel_layer.group_add(
                    self.group_name,
                    self.channel_name
                )
                
                logger.info(f'WebSocket conectado para usuario {self.user.username} (ID: {self.user_id})')
                await self.accept()
                return
        
        # Se não autenticado, rejeitar conexão
        logger.warning('WebSocket: Tentativa de conexão sem autenticação válida')
        await self.close()
    
    async def disconnect(self, close_code):
        # Remover do grupo
        if self.user_id:
            await self.channel_layer.group_discard(
                self.group_name,
                self.channel_name
            )
    
    async def receive(self, text_data):
        # Processar mensagens recebidas do cliente (se necessário)
        try:
            data = json.loads(text_data)
            message_type = data.get('type')
            
            if message_type == 'ping':
                await self.send(text_data=json.dumps({
                    'type': 'pong'
                }))
        except json.JSONDecodeError:
            pass
    
    async def notification_message(self, event):
        # Enviar notificação para o WebSocket
        notification_data = event.get('notification', {})
        logger.info(f'Enviando notificacao via WebSocket para usuario {self.user_id}: {notification_data.get("titulo", "N/A")}')

        await self.send(text_data=json.dumps({
            'type': 'notification',
            'data': notification_data
        }))

    async def permissions_changed(self, event):
        # Cargo/permissões/setor do usuário mudou — cliente deve refazer
        # GET /users/me/ e atualizar a UI (ver apps.accounts.realtime).
        logger.info(f'Avisando usuario {self.user_id} de mudanca de permissoes')
        await self.send(text_data=json.dumps({'type': 'permissions_changed'}))

    async def account_deactivated(self, event):
        # Usuário foi desativado — cliente deve encerrar a sessão na hora.
        logger.info(f'Avisando usuario {self.user_id} de desativacao de conta')
        await self.send(text_data=json.dumps({'type': 'account_deactivated'}))

    @database_sync_to_async
    def get_user_from_token(self, token_key):
        """Obter usuário a partir do token"""
        try:
            token = Token.objects.select_related('user').get(key=token_key)
            return token.user if token.user.is_active else None
        except Token.DoesNotExist:
            return None


class SprintKanbanConsumer(AsyncWebsocketConsumer):
    """Atualizações em tempo real de cards no Kanban de uma sprint.

    Grupo: `sprint_{sprint_id}_kanban` — compartilhado por TODOS os clientes
    vendo aquela sprint (página /sprint/<id>) ou qualquer projeto dela
    (página /projeto/<id>, que descobre sprint_id via project.sprint_id).
    """

    async def connect(self):
        self.user = None
        self.group_name = None

        # Auth: token via query string (parse_qs aceita valores com `=`) ou header.
        # NOTA: tokens em query string vazam em logs de proxy (issue F-1 do
        # security audit). Pre-existente em todos os consumers do projeto.
        query_string = self.scope.get('query_string', b'').decode()
        token = None
        if query_string:
            params = parse_qs(query_string)
            token = params.get('token', [None])[0]
        if not token:
            headers = dict(self.scope.get('headers', []))
            auth_header = headers.get(b'authorization', b'').decode()
            if auth_header.startswith('Token '):
                token = auth_header[6:]
        if token:
            self.user = await self._get_user_from_token(token)
        if not self.user:
            logger.warning('SprintKanbanWS: sem token válido')
            await self.close(code=4001)
            return

        # Validação do sprint_id (a regex da rota já garante \d+, mas confirmamos
        # que a sprint existe — evita grupos "fantasmas" e logs limpos).
        sprint_id_raw = self.scope['url_route']['kwargs'].get('sprint_id')
        try:
            sprint_id = int(sprint_id_raw)
        except (TypeError, ValueError):
            await self.close(code=4002)
            return

        # Entrar no grupo é receber TODA movimentação de card da sprint em tempo
        # real, e isso não aparece em tela nenhuma — sem escopo, saber o id
        # bastaria para acompanhar a operação de outro setor sem deixar rastro.
        # Sprint inexistente cai no mesmo ramo (filtro vazio) e fecha com o mesmo
        # código de propósito: separar os casos diria ao cliente quais ids existem.
        if not await self._pode_ver_sprint(sprint_id):
            logger.warning(
                'SprintKanbanWS: sprint %s inacessível para %s',
                sprint_id, self.user.username,
            )
            await self.close(code=4003)
            return

        self.group_name = f'sprint_{sprint_id}_kanban'
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()
        logger.info(
            'SprintKanbanWS conectado: user=%s sprint=%s', self.user.username, sprint_id,
        )

    async def disconnect(self, close_code):
        if self.group_name:
            try:
                await self.channel_layer.group_discard(self.group_name, self.channel_name)
            except Exception:
                pass

    async def receive(self, text_data):
        # Keep-alive: cliente envia {type:'ping'}, respondemos pong
        try:
            data = json.loads(text_data)
            if data.get('type') == 'ping':
                await self.send(text_data=json.dumps({'type': 'pong'}))
        except json.JSONDecodeError:
            pass

    async def kanban_changed(self, event):
        """Handler do dispatch `channel_layer.group_send(type='kanban_changed')`."""
        await self.send(text_data=json.dumps({
            'type': 'kanban_changed',
            'card_id': event.get('card_id'),
            'actor_user_id': event.get('actor_user_id'),
        }))

    async def card_movement(self, event):
        """Handler do dispatch `channel_layer.group_send(type='card_movement')`."""
        await self.send(text_data=json.dumps({
            'type': 'card_moved',
            'card_id': event['card_id'],
            'old_status': event['old_status'],
            'new_status': event['new_status'],
            'actor_user_id': event.get('actor_user_id'),
        }))

    @database_sync_to_async
    def _get_user_from_token(self, token_key):
        # NOTA: não valida TTL — pre-existente em todos os consumers do projeto.
        # REST API valida via ExpiringTokenAuthentication.
        try:
            token = Token.objects.select_related('user').get(key=token_key)
            return token.user if token.user.is_active else None
        except Token.DoesNotExist:
            return None

    @database_sync_to_async
    def _pode_ver_sprint(self, sprint_id: int) -> bool:
        """A sprint existe E o escopo por setor do usuário a alcança?

        Fail-open enquanto `SETOR_SCOPING_ENABLED` estiver False: `scope_sprints`
        devolve o queryset intacto, então hoje isto recusa apenas sprint
        inexistente — exatamente o que a checagem anterior fazia.
        """
        # Imports locais — evitam ciclo de import em consumers.py
        from apps.accounts.scoping import scope_sprints

        from .models import Sprint
        return scope_sprints(Sprint.objects.filter(pk=sprint_id), self.user).exists()

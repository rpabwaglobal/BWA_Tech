import json
import logging

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncWebsocketConsumer
from rest_framework.authtoken.models import Token

from .realtime import (
    SUPORTE_KANBAN_GROUP,
    SUPORTE_KANBAN_GROUP_SEM_SETOR,
    SUPORTE_KANBAN_GROUP_TODOS,
    grupo_do_dono,
    grupo_do_setor,
)

logger = logging.getLogger(__name__)


class SuporteKanbanConsumer(AsyncWebsocketConsumer):
    """Conecta usuários autenticados (Token query/header) ao Kanban de suporte.

    ## O escopo é decidido na INSCRIÇÃO, não no push

    A rodada anterior deixava todo mundo num grupo único e descartava o evento
    alheio ao recebê-lo. Isso mitigava a tela, mas não isolava nada: o payload
    completo do chamado do setor A já tinha atravessado o channel layer (Redis,
    em produção) e chegado ao processo do socket do setor B para só então ser
    jogado fora. Agora o recorte é de desenho — cada socket entra apenas nos
    grupos que a visibilidade dele alcança, e `broadcast_chamado`
    (apps/formularios/realtime.py) publica só nos grupos do chamado.

    Quais grupos cada um recebe, e por quê (a tabela completa está no docstring
    de `realtime.py`):

    - `SETOR_SCOPING_ENABLED` desligada → grupo global, todo mundo, como hoje.
      Fail-open explícito: com a segmentação desligada nada pode mudar de
      comportamento, e a garantia mais barata disso é não trocar a topologia.
    - Sem `view_all_tickets` → só o grupo de POSSE do próprio e-mail. É o eixo
      que o `get_queryset` dele usa (`usuario_email__iexact`, sem cláusula de
      setor), inclusive para quem tem `view_cross_setor`: bypass de ESCOPO não
      concede chamado alheio.
    - Com bypass de escopo (superuser / `view_cross_setor`) → o grupo `TODOS`.
    - Demais privilegiados → o grupo de cada setor seu, mais o dos órfãos.

    A resolução acontece uma vez, no connect, e fica congelada pela sessão —
    como já era com `is_privileged`. Mudança de setor ou de permissão no meio da
    sessão só vale na próxima conexão, e o cliente já é avisado disso pelo
    evento `permissions_changed`.

    O filtro por e-mail em `suporte_kanban_push` CONTINUA: com a flag desligada
    todos compartilham o grupo global, e é ele que impede o usuário comum de ver
    chamado alheio. Com a flag ligada ele vira redundância barata (o roteamento
    já entregou só ao dono).
    """

    async def connect(self):
        self.user = None
        self.is_privileged = False
        self.user_email_lower = ''
        self.grupos = []
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

        # Resolve permissão e email pra filtragem em suporte_kanban_push.
        # `has_perm` toca o ORM (cache de permissões) — precisa rodar em thread
        # síncrona no contexto async do consumer.
        self.is_privileged = await self._user_can_view_all_tickets()
        self.user_email_lower = (self.user.email or '').strip().lower()
        self.grupos = await self._resolver_grupos()

        for grupo in self.grupos:
            await self.channel_layer.group_add(grupo, self.channel_name)
        # Aceita mesmo com a lista vazia (usuário comum sem e-mail cadastrado):
        # ele não tem chamado que lhe pertença, mas a conexão em si é legítima e
        # o ping/pong do cliente continua funcionando. Recusar aqui só trocaria
        # "não recebe evento" por um ciclo de reconexão infinito no frontend.
        await self.accept()
        logger.info(
            'WebSocket suporte Kanban ligado: %s (privileged=%s, grupos=%s)',
            self.user.username, self.is_privileged, self.grupos,
        )

    async def disconnect(self, close_code):
        # `getattr` porque o disconnect também roda quando o connect fechou a
        # conexão antes de resolver os grupos (token inválido).
        for grupo in getattr(self, 'grupos', ()):
            try:
                await self.channel_layer.group_discard(grupo, self.channel_name)
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
        payload = event.get('payload') or {}
        # [C2] Filtra: usuário não-privilegiado só recebe payload do PRÓPRIO
        # chamado (mesmo email). Com `SETOR_SCOPING_ENABLED` desligada este é o
        # ÚNICO recorte que existe — todos estão no grupo global —, então sem
        # ele qualquer um veria descricao/empresa de chamados de outros.
        #
        # Não há aqui nenhuma checagem de SETOR: ela virou roteamento (ver o
        # `connect`). Consultar o setor do chamado a cada evento, depois de o
        # payload já ter chegado, era exatamente o desenho que trocava
        # isolamento por descarte tardio.
        if not self.is_privileged:
            payload_email = (payload.get('usuario_email') or '').strip().lower()
            if not self.user_email_lower or payload_email != self.user_email_lower:
                return  # descarta o evento silenciosamente
        await self.send(
            text_data=json.dumps(
                {
                    'type': 'suporte',
                    'event': event['event'],
                    'data': payload,
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

    @database_sync_to_async
    def _user_can_view_all_tickets(self):
        """Privilegiado = tem a permissão granular `view_all_tickets` (recebe
        eventos de chamados alheios, não só os do próprio email)."""
        return bool(self.user and self.user.has_perm('accounts.view_all_tickets'))

    @database_sync_to_async
    def _resolver_grupos(self):
        """Grupos em que este socket se inscreve (ordem: o mais restrito vence).

        Espelha, ramo a ramo, o que `ChamadoSuporteViewSet.get_queryset` e
        `scope_chamados` decidem para o REST — a divergência entre as duas rotas
        é que seria o furo.

        `_scoping_on` em vez de `_sem_escopo` porque aqui os dois casos que
        aquele junta precisam de tratamento diferente: flag desligada é grupo
        global (todo mundo junto, como hoje), enquanto bypass de escopo é o
        grupo `TODOS` (só quem tem o bypass).

        O grupo dos órfãos entra para todo privilegiado, inclusive o que não tem
        setor nenhum. `scope_chamados` corta esse usuário antes, no
        `if not setores: return qs.none()`, mas o fail-open de
        `_user_can_access_chamado` para chamado inexistente localmente vale mais
        aqui: produção roda em modo PROXY, com a tabela local vazia, e um
        usuário sem setor classificado ficaria com o kanban mudo.
        """
        from apps.accounts.scoping import (_scoping_on, setores_ids_do_usuario,
                                           usuario_ve_tudo)

        if not _scoping_on():
            return [SUPORTE_KANBAN_GROUP]
        if not self.is_privileged:
            grupo = grupo_do_dono(self.user_email_lower)
            return [grupo] if grupo else []
        if usuario_ve_tudo(self.user):
            return [SUPORTE_KANBAN_GROUP_TODOS]
        return [SUPORTE_KANBAN_GROUP_SEM_SETOR] + [
            grupo_do_setor(setor_id)
            for setor_id in sorted(setores_ids_do_usuario(self.user))
        ]

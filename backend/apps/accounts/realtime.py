"""Push em tempo real de mudanças de acesso do usuário (cargo, permissões
granulares, setor, ativação/desativação). Reaproveita o grupo de WebSocket
`user_{id}` já usado para notificações (`apps.projects.consumers.
NotificationConsumer`) — evita abrir uma segunda conexão só para isso.

O evento não carrega o payload novo: o cliente, ao recebê-lo, refaz
GET /users/me/ (fonte de verdade, já filtra o que cada um pode ver) e
atualiza o AuthContext. Mantém o consumer burro e evita duplicar no backend
a lógica de serialização/visibilidade que já vive no DRF.
"""
import asyncio
import logging

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer

logger = logging.getLogger(__name__)

# Quantos envios saem em paralelo por vez. Segura o número de operações
# simultâneas no Redis quando o alvo é um cargo com muita gente.
_TAMANHO_LOTE = 100


def _group_send_many(user_ids, event_type):
    """Dispara `event_type` para os grupos `user_{id}` de vários usuários.

    A camada de canais não expõe "envie para N grupos numa chamada" — o loop
    sobre os grupos é inevitável. O que dá para evitar é o custo de entrar e
    sair do laço de eventos a cada usuário: `async_to_sync` monta e desmonta um
    event loop por chamada, e num cargo com 300 pessoas isso seriam 300 idas e
    voltas em série. Aqui é UMA travessia sync→async por lote, com os envios do
    lote em paralelo via `asyncio.gather`.
    """
    ids = [user_ids] if isinstance(user_ids, int) else list(user_ids)
    if not ids:
        return
    channel_layer = get_channel_layer()
    if channel_layer is None:
        logger.warning('Channel layer indisponível — %s não enviado (%s usuário(s))', event_type, len(ids))
        return

    async def _enviar(lote):
        resultados = await asyncio.gather(
            *(channel_layer.group_send(f'user_{uid}', {'type': event_type}) for uid in lote),
            return_exceptions=True,
        )
        # Falha de um usuário não pode cancelar a dos outros: quem ficou sem o
        # aviso só descobre a mudança no próximo F5, mas os demais recebem.
        for uid, resultado in zip(lote, resultados):
            if isinstance(resultado, BaseException):
                logger.error('Erro ao enviar %s via WebSocket (usuario %s)', event_type, uid,
                             exc_info=resultado)

    for inicio in range(0, len(ids), _TAMANHO_LOTE):
        lote = ids[inicio:inicio + _TAMANHO_LOTE]
        try:
            async_to_sync(_enviar)(lote)
        except Exception:
            logger.exception('Erro ao enviar %s em lote (%s usuário(s))', event_type, len(lote))


def _group_send(user_id, event_type):
    _group_send_many([user_id], event_type)


def notify_permissions_changed(user_ids):
    """Avisa um ou vários usuários que cargo/permissões/setor mudaram — o
    cliente deve refazer GET /users/me/ e atualizar a UI na hora (ganha ou
    perde acesso a telas/ações sem precisar de F5)."""
    _group_send_many(user_ids, 'permissions_changed')


def notify_cargo_permissions_changed(codename):
    """Avisa TODO MUNDO que tem o cargo `codename`.

    Necessário porque `Cargo.permissoes_padrao` passou a ser concedida em tempo
    de `has_perm` (accounts/auth_backends.py): editar a lista de um cargo muda
    o acesso efetivo de todos os seus portadores de uma vez, e não só de quem
    for reatribuído depois. Sem este aviso, o requisito "efeito em tempo real,
    sem recarregar a página" valeria para mudanças em um usuário, mas não para
    mudanças no cargo.

    Só usuários ativos são avisados — inativo não tem sessão para atualizar (e
    o backend de cargo não concede nada a ele). Devolve quantos foram avisados.
    """
    if not codename:
        return 0
    from .models import User  # import tardio: models importa realtime indiretamente

    ids = list(User.objects.filter(role=codename, is_active=True).values_list('pk', flat=True))
    notify_permissions_changed(ids)
    return len(ids)


def notify_account_deactivated(user_id):
    """Avisa o usuário desativado para encerrar a sessão imediatamente. O
    token já foi revogado no servidor (ver UserViewSet.set_active) — isto só
    evita esperar a próxima request falhar com 401 para o usuário perceber."""
    _group_send(user_id, 'account_deactivated')

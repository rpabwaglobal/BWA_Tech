"""Publicação dos eventos do Kanban de suporte no channel layer.

## Por que aqui existem VÁRIOS grupos, e não um só

Grupo, no Channels, é endereço de entrega: tudo que é publicado num grupo chega
ao processo de TODO socket inscrito nele. Com um único grupo global, o payload
completo do chamado — descrição, empresa, e-mail do solicitante, texto da
resolução — trafegava pelo channel layer (Redis, em produção) até o worker de
quem não pode ver aquele chamado, e o descarte acontecia só na ponta, dentro do
consumer. Filtro de quem RECEBE não é isolamento: o dado já viajou, já passou
pelo Redis e já esteve na memória do outro processo.

Por isso o recorte passou a ser feito AQUI, na hora de publicar: o evento só
entra nos grupos que a regra de visibilidade alcança. Os grupos espelham, um a
um, os ramos de `scope_chamados` (apps/accounts/scoping.py) e de
`ChamadoSuporteViewSet.get_queryset`:

| grupo                        | quem se inscreve                    | espelha            |
|------------------------------|-------------------------------------|--------------------|
| `suporte_kanban`             | TODOS, só com a flag desligada       | o comportamento de hoje |
| `suporte_kanban_todos`       | superuser / `view_cross_setor`      | `usuario_ve_tudo`  |
| `suporte_kanban_setor_<id>`  | quem tem o setor `<id>`             | `Q(setor_id__in=...)` + compartilhamento |
| `suporte_kanban_sem_setor`   | `view_all_tickets` sem o bypass     | `Q(setor__isnull=True)` |
| `suporte_kanban_dono_<hash>` | o dono do e-mail                    | filtro por `usuario_email` |

A inscrição é decidida no `connect` (apps/formularios/consumers.py); esta função
decide o outro lado, o do remetente.

## Nomes de grupo

O Channels aceita em nome de grupo apenas `[A-Za-z0-9._-]`, até 100 caracteres —
e-mail tem `@` e `+`, então o grupo de posse usa o SHA-256 do e-mail
normalizado. O hash não é medida de sigilo (o espaço de e-mails é adivinhável),
é só codificação: dá um nome válido, de tamanho fixo, estável entre processos, e
de quebra evita gravar e-mail de usuário como chave no Redis.
"""
import hashlib
import logging

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer

logger = logging.getLogger(__name__)

# Grupo único e global. Continua existindo, mas SÓ é usado com
# `SETOR_SCOPING_ENABLED` desligada — ver `_grupos_alvo`.
SUPORTE_KANBAN_GROUP = 'suporte_kanban'

# Quem enxerga tudo (superuser ou `view_cross_setor`) entra aqui em vez de
# entrar no grupo de cada setor. Um grupo dedicado, e não "inscrever em todos os
# setores": a lista de setores é resolvida no connect e ficaria congelada, então
# um setor criado depois nunca chegaria a quem deveria ver tudo.
SUPORTE_KANBAN_GROUP_TODOS = 'suporte_kanban_todos'

# Chamado órfão: sem setor (`setor__isnull=True`) ou inexistente na tabela local
# (modo PROXY, em que os chamados vivem no portal externo). `scope_chamados`
# mantém o primeiro visível para todos de propósito — o vínculo com o setor é
# best-effort, derivado do e-mail na criação, e esconder um chamado órfão faria
# alguém perder um pedido de ajuda. O segundo é o mesmo fail-open que
# `_user_can_access_chamado` (views.py) aplica: em produção a tabela local está
# vazia, e tratar "não achei" como "não pode" derrubaria o realtime inteiro.
SUPORTE_KANBAN_GROUP_SEM_SETOR = 'suporte_kanban_sem_setor'


def grupo_do_setor(setor_id) -> str:
    """Grupo dos sockets de quem pertence a este setor."""
    return f'suporte_kanban_setor_{setor_id}'


def grupo_do_dono(email: str) -> str:
    """Grupo dos sockets do usuário dono deste e-mail ('' se não houver e-mail).

    Existe porque o eixo do usuário comum é POSSE, não setor: o `get_queryset`
    dele é `usuario_email__iexact`, sem nenhuma cláusula de setor. Roteá-lo pelo
    setor do chamado quebraria o caso real de quem trocou de setor depois de
    abrir o chamado — ele deixaria de receber evento do PRÓPRIO pedido.

    Normaliza igual ao `iexact` do queryset (strip + lower) para que os dois
    lados cheguem sempre ao mesmo nome de grupo.
    """
    normalizado = (email or '').strip().lower()
    if not normalizado:
        return ''
    digest = hashlib.sha256(normalizado.encode('utf-8')).hexdigest()[:32]
    return f'suporte_kanban_dono_{digest}'


def _grupos_alvo(payload: dict) -> list[str]:
    """Grupos que devem receber este evento, segundo o chamado do payload.

    Com `SETOR_SCOPING_ENABLED` DESLIGADA devolve só o grupo global — fail-open
    deliberado, e a forma mais simples de garantir que hoje nada muda: todo
    mundo continua inscrito no mesmo grupo de sempre, não há taxonomia nova para
    errar e esta função retorna ANTES de tocar o banco (zero consulta a mais por
    evento). O recorte por posse continua acontecendo no consumer, como já
    acontecia.

    Com a flag ligada, o alvo é a união de:
    - `TODOS` (quem tem bypass de escopo, sempre);
    - o grupo de posse do e-mail do solicitante (o usuário comum, dono do
      chamado, que não tem `view_all_tickets`);
    - o grupo do setor DONO do chamado, mais os grupos dos setores com quem ele
      foi compartilhado (`ChamadoCompartilhamento`) — os dois ramos de
      `scope_chamados`;
    - `SEM_SETOR` quando não há setor a resolver.

    Um mesmo socket pode estar em dois grupos alvo (o usuário pertence ao setor
    dono E a um setor com quem o chamado foi compartilhado) e receber o evento
    duas vezes. É inofensivo de propósito: o cliente faz upsert por id
    (`upsertChamadoLista` em frontend/src/pages/Support.tsx), então reaplicar o
    mesmo evento dá o mesmo estado. Deduplicar exigiria carregar id de mensagem
    e memória por socket para evitar um efeito que não existe.
    """
    from apps.accounts.scoping import _scoping_on

    # `_scoping_on` e não `_sem_escopo`: aqui não há usuário: quem publica é o
    # servidor, e o que se decide é a TAXONOMIA de grupos (global x por setor).
    # O bypass de escopo é decisão de quem se inscreve, no consumer.
    if not _scoping_on():
        return [SUPORTE_KANBAN_GROUP]

    from .models import ChamadoCompartilhamento, ChamadoSuporte

    grupos = {SUPORTE_KANBAN_GROUP_TODOS}

    dono = grupo_do_dono(payload.get('usuario_email') or '')
    if dono:
        grupos.add(dono)

    # O id é convertido, e não usado como veio: em produção o payload nasce da
    # resposta JSON do portal externo (portal_proxy_views), não do nosso
    # serializer, então o tipo dele é contrato de terceiro. Um id em string
    # faria `filter(pk=...)` estourar ValueError, e o `except` de
    # `broadcast_chamado` é fail-CLOSED — uma única resposta com `"id": "42"`
    # derrubaria o realtime de TODO mundo, silenciosamente.
    try:
        chamado_id = int(payload.get('id'))
    except (TypeError, ValueError):
        chamado_id = None
    if chamado_id is None:
        # Sem id não há setor a consultar. Trata como órfão em vez de cortar:
        # mesma escolha do antigo filtro no consumer, que liberava payload sem
        # id — apagar o kanban por causa de um campo ausente seria pior.
        grupos.add(SUPORTE_KANBAN_GROUP_SEM_SETOR)
        return sorted(grupos)

    # Uma consulta por pk (índice primário) devolve o setor dono. Lista em vez
    # de `.first()` para separar "não existe localmente" de "existe com setor
    # nulo" — os dois caem no grupo dos órfãos, mas por motivos diferentes e
    # vale deixar a distinção explícita.
    setores = list(
        ChamadoSuporte.objects.filter(pk=chamado_id)
        .values_list('setor_id', flat=True)[:1],
    )
    if not setores:  # modo proxy: o chamado vive no portal externo
        grupos.add(SUPORTE_KANBAN_GROUP_SEM_SETOR)
        return sorted(grupos)
    if setores[0] is None:  # local, mas ainda não classificado
        grupos.add(SUPORTE_KANBAN_GROUP_SEM_SETOR)
    else:
        grupos.add(grupo_do_setor(setores[0]))
    grupos.update(
        grupo_do_setor(setor_id)
        for setor_id in ChamadoCompartilhamento.objects
        .filter(chamado_id=chamado_id).values_list('setor_id', flat=True)
    )
    return sorted(grupos)


async def _publicar(channel_layer, grupos, mensagem) -> None:
    """Publica a mesma mensagem em cada grupo alvo.

    Um único `async_to_sync` para a lista inteira (e não um por grupo): a ponte
    sync→async monta um event loop a cada chamada, e o custo dela é maior que o
    dos `group_send` em si.
    """
    for grupo in grupos:
        await channel_layer.group_send(grupo, mensagem)


def broadcast_chamado(event: str, payload: dict) -> None:
    """Envia atualização do Kanban para quem alcança ESTE chamado.

    Chamado sempre de contexto síncrono — `transaction.on_commit` (views.py) ou
    o proxy do portal (portal_proxy_views.py) —, então as consultas de
    roteamento acontecem depois do commit e enxergam o setor já gravado.
    """
    channel_layer = get_channel_layer()
    if channel_layer is None:
        logger.warning('Channel layer não configurado; broadcast suporte ignorado.')
        return
    try:
        grupos = _grupos_alvo(payload or {})
        async_to_sync(_publicar)(
            channel_layer,
            grupos,
            {
                'type': 'suporte.kanban_push',
                'event': event,
                'payload': payload,
            },
        )
    except Exception:
        # Falha aqui não entrega o evento a ninguém — de propósito. Realtime é
        # melhoria de UX (a tela recarrega pelo REST), enquanto cair no grupo
        # global "para não perder o evento" reabriria justamente o vazamento
        # que este módulo fecha.
        logger.exception('Falha ao enviar evento suporte realtime.')

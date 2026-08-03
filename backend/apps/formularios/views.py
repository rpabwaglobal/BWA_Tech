import logging

from django.db import transaction
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from apps.accounts.sharing import CompartilhamentoSetorMixin

from .models import (
    ChamadoSuporte,
    ChamadoSuporteResolucao,
    ChamadoSuporteStatus,
    ChamadoSuporteTimeline,
    ChamadoSuporteTimelineTipo,
    SuporteMotivo,
    SuporteTipo,
)
from .realtime import broadcast_chamado
from .serializers import (
    CatalogTipoComItensSerializer,
    CatalogMotivoMiniSerializer,
    ChamadoResolucaoSerializer,
    ChamadoSuporteReadSerializer,
    ChamadoSuporteWriteSerializer,
    ChamadoSuportePatchSerializer,
    ChamadoSuporteTimelineSerializer,
)

logger = logging.getLogger(__name__)


# Conjunto de status válidos pra validar `?status=` no por_usuario.
# Usar `.value` pra extrair os literais ("Aberto", "Em andamento", ...).
_VALID_STATUSES = {choice.value for choice in ChamadoSuporteStatus}


def _user_can_access_chamado(request, chamado_id: int) -> bool:
    """True se o usuário alcança o chamado: privilegiado DENTRO do escopo de
    setor, ou dono do chamado (pelo e-mail).

    Em produção os chamados ficam no PORTAL externo (a tabela `ChamadoSuporte`
    local fica vazia em modo proxy). Se o chamado não existe localmente não há
    como conferir o owner aqui, então libera (a gate real fica no portal, já
    consultado pelo frontend). Em modo local, o filtro por email é a autoridade.

    `view_all_tickets` NÃO foi removida daqui — ela continua sendo o que vence a
    POSSE do chamado. O catálogo a descreve como "Ver todos os chamados de
    suporte (não só os próprios)" (accounts/permission_catalog.py), isto é, o
    contraste que ela resolve é próprio-vs-alheio, não setor-vs-setor; tanto que
    `ChamadoSuporteViewSet.get_queryset` já a faz conviver com `scope_chamados`.
    O escopo passa a valer aqui também porque este helper é a ÚNICA porta da
    timeline e da resolução: sem ele, um atendente do setor A pedia por id
    (`?chamado_id=`) exatamente o chamado do setor B que a listagem escondia
    dele — e a divergência entre as duas rotas é o furo.
    """
    from apps.accounts.scoping import scope_chamados

    local_qs = ChamadoSuporte.objects.filter(pk=chamado_id)
    if request.user.has_perm('accounts.view_all_tickets'):
        # O escopo primeiro, o fail-open do proxy só depois: com a flag OFF
        # `scope_chamados` devolve o queryset intacto e o caso comum (chamado
        # local) responde numa única consulta por pk. A segunda só roda quando o
        # escopo não achou nada — e aí ela distingue "chamado de outro setor"
        # (existe localmente, nega) de "chamado que mora no portal externo"
        # (tabela local vazia, libera, como o atalho de permissão fazia antes).
        return (scope_chamados(local_qs, request.user).exists()
                or not local_qs.exists())
    user_email = (request.user.email or '').strip().lower()
    if not local_qs.exists():
        return True
    if not user_email:
        return False
    return local_qs.filter(usuario_email__iexact=user_email).exists()


class ChamadoSuporteViewSet(CompartilhamentoSetorMixin, viewsets.ModelViewSet):
    """
    Compatível com o contrato documentado:
    POST /suporte/
    GET /suporte/por-usuario/
    GET /suporte/catalogo/
    PATCH /suporte/<pk>/
    PATCH /suporte/<pk>/notificar-usuario/
    """

    queryset = ChamadoSuporte.objects.select_related('tipo', 'item', 'item__tipo', 'motivo').all()
    permission_classes = [IsAuthenticated]
    pagination_class = None
    http_method_names = ['get', 'post', 'patch', 'head', 'options']

    # Campos que SÓ usuários privilegiados podem mutar via PATCH. Usuário comum
    # autenticado dono do chamado consegue, no máximo, abrir um novo — não
    # marca o próprio como Resolvido/Cancelado nem altera responsável/notas.
    # Isso evita bypass do fluxo de suporte (auto-fechamento de chamado).
    _PRIVILEGED_PATCH_FIELDS = frozenset({
        'status', 'responsavel_solucao', 'descricao_resolucao', 'tipo', 'item',
    })

    def get_queryset(self):
        """Mitigação de IDOR: usuários comuns só veem chamados associados ao
        próprio email (usuario_email). Quem tem `view_all_tickets` vê todos os
        chamados do seu setor (mais os compartilhados com ele)."""
        from apps.accounts.scoping import scope_chamados

        qs = ChamadoSuporte.objects.select_related('tipo', 'item', 'item__tipo', 'motivo')
        user = self.request.user
        if not user.is_authenticated:
            return qs.none()
        if user.has_perm('accounts.view_all_tickets'):
            return scope_chamados(qs, user)  # fail-open enquanto flag OFF
        # Filtragem por email do usuário autenticado (case-insensitive)
        user_email = (user.email or '').strip().lower()
        if not user_email:
            return qs.none()
        return qs.filter(usuario_email__iexact=user_email)

    def get_serializer_class(self):
        if self.action == 'create':
            return ChamadoSuporteWriteSerializer
        return ChamadoSuporteReadSerializer

    def list(self, request, *args, **kwargs):
        return Response(
            {'detail': 'Use GET suporte/por-usuario/ para listar chamados.'},
            status=status.HTTP_405_METHOD_NOT_ALLOWED,
        )

    def create(self, request, *args, **kwargs):
        serializer = ChamadoSuporteWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        # Atômico pra garantir que o WS broadcast só dispare se o save persistir.
        # `on_commit` faz o broadcast rodar APÓS o commit do DB — se algo
        # estourar antes, o WS não envia evento fantasma.
        with transaction.atomic():
            instance = serializer.save()
            # Deriva o setor do chamado pelo e-mail do solicitante (best-effort).
            self._derivar_setor(instance)
            read = ChamadoSuporteReadSerializer(instance)
            payload = read.data
            transaction.on_commit(lambda: broadcast_chamado('chamado_created', payload))
        return Response(payload, status=status.HTTP_201_CREATED)

    @staticmethod
    def _derivar_setor(chamado):
        """Setor do chamado = setor primário do usuário dono do e-mail. Silencioso
        se não houver correspondência (chamados do portal externo)."""
        if chamado.setor_id:
            return
        from apps.accounts.models import User
        from apps.accounts.scoping import setor_primario_do_usuario
        email = (chamado.usuario_email or '').strip().lower()
        if not email:
            return
        u = User.objects.filter(email__iexact=email).first()
        if u:
            s = setor_primario_do_usuario(u)
            if s:
                chamado.setor = s
                chamado.save(update_fields=['setor'])

    def partial_update(self, request, *args, **kwargs):
        instance = self.get_object()
        patch_sr = ChamadoSuportePatchSerializer(
            data=request.data,
            partial=True,
            context={'instance': instance},
        )
        patch_sr.is_valid(raise_exception=True)
        data = patch_sr.validated_data

        # [C1] Campos que só quem tem `manage_ticket_resolution` muta. Usuário
        # comum não fecha próprio chamado, não muda responsável solução, nem
        # move entre tabs.
        if not request.user.has_perm('accounts.manage_ticket_resolution'):
            forbidden = self._PRIVILEGED_PATCH_FIELDS & data.keys()
            if forbidden:
                raise PermissionDenied(
                    detail={
                        'detail': (
                            'Você não tem permissão para alterar estes campos. '
                            f'Restrito a suporte/admin: {", ".join(sorted(forbidden))}.'
                        ),
                    },
                )

        # [A3] `tipo` agora também é bloqueado em chamados encerrados.
        # Quem já foi Resolvido/Cancelado fica fixo na tab original.
        if instance.status in (ChamadoSuporteStatus.RESOLVIDO, ChamadoSuporteStatus.CANCELADO):
            locked_fields = self._PRIVILEGED_PATCH_FIELDS & data.keys()
            if locked_fields:
                return Response(
                    {
                        'detail': (
                            'Chamados resolvidos ou cancelados não podem ser '
                            'alterados (status, responsável, notas ou tipo).'
                        ),
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

        try:
            with transaction.atomic():
                for field in ('status', 'responsavel_solucao', 'descricao_resolucao'):
                    if field in data:
                        setattr(instance, field, data[field])
                if 'tipo' in data:
                    instance.tipo = data['tipo']
                if 'item' in data:
                    instance.item = data['item']
                instance.save()
                body = ChamadoSuporteReadSerializer(instance).data
                # [M2] broadcast só após commit — não envia evento fantasma
                # se algo estourar entre save() e response.
                transaction.on_commit(lambda: broadcast_chamado('chamado_updated', body))
        except Exception:
            logger.exception('Falha ao atualizar chamado #%s', instance.pk)
            raise
        return Response(body)

    @action(detail=False, methods=['get'], url_path='catalogo')
    def catalogo(self, request):
        tipos = (
            SuporteTipo.objects.filter(ativo=True, itens__ativo=True)
            .distinct()
            .prefetch_related('itens')
            .order_by('nome')
        )
        motivos = SuporteMotivo.objects.filter(ativo=True)
        return Response(
            {
                'tipos': CatalogTipoComItensSerializer(tipos, many=True).data,
                'motivos': CatalogMotivoMiniSerializer(motivos, many=True).data,
            },
        )

    @action(detail=False, methods=['get'], url_path='por-usuario')
    def por_usuario(self, request):
        """Lista chamados do usuário. Roles privilegiados podem filtrar por email
        arbitrário via `?usuario_email=`; usuários comuns ficam restritos ao
        próprio email (get_queryset já aplica o filtro).

        Query params opcionais:
        - `?tipo_id=<int>`: filtra por SuporteTipo (RPA / Easy / Dashboards).
        - `?status=<str>`: filtra por status; valor deve estar em
          ChamadoSuporteStatus (Aberto/Em andamento/Resolvido/Cancelado).
        - `?limit=<int>&offset=<int>`: paginação offset.
          - Quando passa ALGUM dos dois, resposta vira `{count, results}`
            (frontend usa isso pra scroll infinito em Concluído/Inviabilizado).
          - Sem limit/offset, retorna lista pura (compat com chamadas legadas).
        """
        qs = self.get_queryset()
        if request.user.has_perm('accounts.view_all_tickets'):
            email = request.query_params.get('usuario_email')
            if email:
                qs = qs.filter(usuario_email__iexact=email.strip())

        # Filtros opcionais por tipo e status.
        tipo_id = request.query_params.get('tipo_id')
        if tipo_id:
            try:
                qs = qs.filter(tipo_id=int(tipo_id))
            except (TypeError, ValueError):
                return Response(
                    {'detail': '`tipo_id` deve ser inteiro.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        status_filter = request.query_params.get('status')
        if status_filter:
            # [B3] Validar contra o enum. Antes aceitava qualquer string e
            # retornava lista vazia silenciosamente — confuso pro cliente.
            if status_filter not in _VALID_STATUSES:
                return Response(
                    {
                        'detail': (
                            f'`status` inválido. Aceitos: {sorted(_VALID_STATUSES)}.'
                        ),
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )
            qs = qs.filter(status=status_filter)

        # Paginação offset. Ativa só quando o cliente pede limit/offset.
        limit_raw = request.query_params.get('limit')
        offset_raw = request.query_params.get('offset')
        if limit_raw is not None or offset_raw is not None:
            try:
                limit = int(limit_raw) if limit_raw is not None else 50
                offset = int(offset_raw) if offset_raw is not None else 0
            except (TypeError, ValueError):
                return Response(
                    {'detail': '`limit` e `offset` devem ser inteiros.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            limit = max(1, min(limit, 200))  # clamp defensivo
            offset = max(0, offset)
            total = qs.count()
            page = qs[offset:offset + limit]
            return Response({
                'count': total,
                'results': ChamadoSuporteReadSerializer(page, many=True).data,
            })

        serializer = ChamadoSuporteReadSerializer(qs, many=True)
        return Response(serializer.data)

    @action(detail=True, methods=['patch'], url_path='notificar-usuario')
    def notificar_usuario(self, request, pk=None):
        """Marca/desmarca o chamado como "notificado". Operação só pra
        privilegiados — usuário comum NÃO falseia métricas de notificação
        do próprio chamado (A1)."""
        if not request.user.has_perm('accounts.notify_ticket_user'):
            raise PermissionDenied(
                detail={'detail': 'Você não tem permissão para alterar a flag de notificação.'},
            )
        instance = self.get_object()
        # [M3] Payload vazio = no-op (antes forçava True silenciosamente).
        # Cliente precisa enviar `usuario_notificado` explicitamente (true/false).
        if 'usuario_notificado' not in request.data:
            return Response(
                {'detail': 'Campo `usuario_notificado` (true/false) obrigatório.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        instance.usuario_notificado = bool(request.data.get('usuario_notificado'))
        try:
            with transaction.atomic():
                instance.save(update_fields=['usuario_notificado'])
                body = ChamadoSuporteReadSerializer(instance).data
                transaction.on_commit(lambda: broadcast_chamado('chamado_updated', body))
        except Exception:
            logger.exception('Falha em notificar_usuario chamado #%s', instance.pk)
            raise
        return Response(body)


class ChamadoSuporteTimelineViewSet(mixins.ListModelMixin, mixins.CreateModelMixin, viewsets.GenericViewSet):
    """Timeline local por chamado: GET ?chamado_id= — POST com chamado_id + descricao.

    [B5] Ownership: usuário comum só lê/grava timeline de chamados próprios
    (ChamadoSuporteViewSet.get_queryset aplica o mesmo filtro por email).
    """

    queryset = ChamadoSuporteTimeline.objects.select_related('usuario').all()
    serializer_class = ChamadoSuporteTimelineSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = None
    http_method_names = ['get', 'post', 'head', 'options']

    def _user_can_access_chamado(self, request, chamado_id: int) -> bool:
        # Delega ao helper de módulo (mesma regra usada pelo viewset de resolução).
        return _user_can_access_chamado(request, chamado_id)

    def list(self, request, *args, **kwargs):
        cid = request.query_params.get('chamado_id')
        if cid is None or str(cid).strip() == '':
            return Response(
                {'detail': 'Informe o parâmetro chamado_id.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            cid_int = int(cid)
        except (TypeError, ValueError):
            return Response({'detail': 'chamado_id inválido.'}, status=status.HTTP_400_BAD_REQUEST)
        if not self._user_can_access_chamado(request, cid_int):
            raise PermissionDenied(
                detail={'detail': 'Você não tem acesso à timeline desse chamado.'},
            )
        qs = self.queryset.filter(chamado_id=cid_int)
        serializer = self.get_serializer(qs, many=True)
        return Response(serializer.data)

    def perform_create(self, serializer):
        chamado_id = serializer.validated_data.get('chamado_id')
        if chamado_id is None or not self._user_can_access_chamado(self.request, chamado_id):
            raise PermissionDenied(
                detail={'detail': 'Você não tem acesso a esse chamado.'},
            )
        serializer.save(usuario=self.request.user)

    @action(detail=False, methods=['get'], url_path='resolvido-em')
    def resolvido_em(self, request):
        """Data em que cada chamado mudou de etapa pela última vez, segundo a
        timeline local — sempre gravada no BWA (`ChamadoSuporteTimeline`),
        mesmo quando o chamado em si vive no portal externo (modo proxy).

        Existe porque `ChamadoSuporte.data_atualizacao` é `auto_now=True`:
        reescrito em QUALQUER save (ex.: mover entre tabs, o proxy do portal
        re-tocando o registro), sem relação com a conclusão de fato. A
        timeline só ganha um evento `etapa_alterada` quando o usuário
        realmente move o card no quadro (`logSuporteChamadoChanges` no
        frontend) — por isso é a fonte confiável pra medir SLA.

        GET → {"1": "2026-06-03T14:25:00-03:00", ...} (todos os acessíveis)
        GET ?chamado_ids=1,2,3 → só esses. O parâmetro é OPCIONAL de propósito:
        a tela de métricas tem centenas de tickets e mandar todos os ids na
        query string estourava o limite prático de URL.

        Escopo igual ao do `list`: quem tem `view_all_tickets` vê os chamados do
        próprio setor (mais os compartilhados com ele); usuário comum só os
        chamados dele (em modo proxy, com a tabela local vazia, o critério de
        posse não se aplica — mesma semântica de `_user_can_access_chamado`).
        Chamados sem nenhum evento de troca de etapa ficam de fora do mapa.
        """
        ids_param = (request.query_params.get('chamado_ids') or '').strip()
        ids = None
        if ids_param:
            try:
                ids = {int(x) for x in ids_param.split(',') if x.strip()}
            except ValueError:
                return Response(
                    {'detail': 'chamado_ids deve ser uma lista de inteiros separados por vírgula.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        qs = ChamadoSuporteTimeline.objects.filter(
            tipo_evento=ChamadoSuporteTimelineTipo.ETAPA_ALTERADA)
        if ids:
            qs = qs.filter(chamado_id__in=ids)
        from apps.accounts.scoping import scope_chamados

        # Versão em lote do `_user_can_access_chamado`: exclui só os chamados
        # que existem localmente e que o usuário NÃO alcança. Quem existe só no
        # portal externo (modo proxy) nunca entra em `alheios`, e por isso
        # continua no mapa — mesmo fail-open do helper unitário.
        if request.user.has_perm('accounts.view_all_tickets'):
            # Privilegiado alcança os chamados do escopo dele, não os de todo
            # mundo: mesma regra do `get_queryset` e do
            # `_user_can_access_chamado`. Com a flag OFF `scope_chamados`
            # devolve tudo, `alheios` sai vazio e nada é excluído.
            alheios = ChamadoSuporte.objects.exclude(
                pk__in=scope_chamados(ChamadoSuporte.objects.all(), request.user)
                .values('pk'),
            )
        else:
            email = (request.user.email or '').strip().lower()
            alheios = ChamadoSuporte.objects.all()
            if email:
                alheios = alheios.exclude(usuario_email__iexact=email)
        alheios_ids = set(alheios.values_list('id', flat=True))
        if alheios_ids:
            qs = qs.exclude(chamado_id__in=alheios_ids)
        qs = qs.order_by('chamado_id', '-data').values_list('chamado_id', 'data')
        result = {}
        for chamado_id, data in qs:
            # Primeiro visto por chamado_id (após ORDER BY -data) = o mais recente.
            if chamado_id not in result:
                result[chamado_id] = data.isoformat()
        return Response(result)


class ChamadoSuporteResolucaoViewSet(viewsets.GenericViewSet):
    """Link + arquivo de resolução por chamado (um registro por chamado).

    GET  /suporte-resolucao/?chamado_id=<id>  → objeto ou `null`.
    POST /suporte-resolucao/  (multipart: chamado_id, link?, arquivo?)  → upsert.

    Restrito a suporte/admin (mesma regra da conclusão do ticket, que só
    privilegiados executam). Guardado localmente por `chamado_id` — funciona
    também quando o chamado vive no portal externo.

    Duas perguntas independentes governam o POST, e ele precisa das duas:
    `manage_ticket_resolution` responde "esta pessoa anexa resolução?" e
    `_user_can_access_chamado` responde "neste chamado?". Ter a primeira sem a
    segunda não dá acesso a chamado alheio.
    """

    queryset = ChamadoSuporteResolucao.objects.all()
    serializer_class = ChamadoResolucaoSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = None
    http_method_names = ['get', 'post', 'head', 'options']

    def _parse_chamado_id(self, raw):
        try:
            return int(raw)
        except (TypeError, ValueError):
            return None

    def list(self, request, *args, **kwargs):
        cid = request.query_params.get('chamado_id')
        cid_int = self._parse_chamado_id(cid)
        if cid_int is None:
            return Response(
                {'detail': 'Informe chamado_id válido.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not _user_can_access_chamado(request, cid_int):
            raise PermissionDenied(detail={'detail': 'Você não tem acesso a esse chamado.'})
        obj = ChamadoSuporteResolucao.objects.filter(chamado_id=cid_int).first()
        if obj is None:
            return Response(None)
        return Response(ChamadoResolucaoSerializer(obj, context={'request': request}).data)

    def create(self, request, *args, **kwargs):
        cid_int = self._parse_chamado_id(request.data.get('chamado_id'))
        if cid_int is None:
            return Response(
                {'detail': 'Informe chamado_id válido.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        # Anexar resolução é parte de concluir o chamado — exige `manage_ticket_resolution`.
        if not request.user.has_perm('accounts.manage_ticket_resolution'):
            raise PermissionDenied(
                detail={'detail': 'Você não tem permissão para anexar a resolução do chamado.'},
            )

        # Eixo POSSE (IDOR). `manage_ticket_resolution` e `view_all_tickets` são
        # permissões INDEPENDENTES no catálogo (accounts/permission_catalog.py):
        # quem tinha a primeira sem a segunda anexava a resolução de QUALQUER
        # chamado, bastando informar o `chamado_id` — e LIA a de qualquer um,
        # porque o 201 devolve o link/arquivo que já estava gravado. O gate de
        # setor não fechava isso: o furo aparecia também DENTRO do próprio setor,
        # entre chamados de pessoas diferentes.
        #
        # A regra de posse é a de `_user_can_access_chamado` — reaproveitada em
        # vez de reescrita, para que o `list` desta mesma viewset e o POST não
        # possam divergir. Chamado só no ramo SEM `view_all_tickets`, que é
        # exatamente o ramo em que aquele helper decide por e-mail e não encosta
        # em `scope_chamados`: o eixo SETOR desta rota é o `checar_escrita_no_pai`
        # logo abaixo, que obedece à flag de ESCRITA. Recusar escrita a partir da
        # flag de VISIBILIDADE é o acoplamento que as duas flags separadas
        # existem para evitar (ver config/settings.py).
        if (not request.user.has_perm('accounts.view_all_tickets')
                and not _user_can_access_chamado(request, cid_int)):
            raise PermissionDenied(
                detail={'detail': 'Você não tem acesso a esse chamado.'},
            )

        # A permissão diz O QUE a pessoa faz; o setor diz ONDE. Este POST é um
        # upsert por `chamado_id` (o `update_or_create` lá embaixo), ou seja,
        # ESCRITA dentro de um chamado — e ele NÃO passa por `get_object()`,
        # então o `SetorPermiteEscrita` que o `CompartilhamentoSetorMixin`
        # acopla às rotas de detalhe nunca roda por aqui. Sem este gate, quem
        # tem `manage_ticket_resolution` sobrescreve a resolução de um chamado
        # de outro setor — e o próprio 201 devolve o link/arquivo que já
        # estava lá, virando também um caminho de LEITURA.
        #
        # O gate é `checar_escrita_no_pai` (o mesmo dos POSTs de
        # projects/views.py), e não o `_user_can_access_chamado` do `list`: o
        # helper de leitura obedece à flag de VISIBILIDADE, e passar a recusar
        # escrita ao ligar só a visibilidade é exatamente o acoplamento que as
        # duas flags separadas existem para evitar (ver config/settings.py).
        # Com SETOR_WRITE_ENFORCEMENT_ENABLED OFF ele retorna sem fazer nada —
        # fail-open, nada muda hoje.
        from apps.accounts.scoping import checar_escrita_no_pai

        chamado = ChamadoSuporte.objects.filter(pk=cid_int).first()
        if chamado is not None and chamado.setor_id is not None:
            # Chamado inexistente na tabela local (modo PROXY, em que os
            # chamados vivem no portal externo) e chamado ainda sem setor ficam
            # de fora do gate de propósito: é o mesmo fail-open de
            # `_user_can_access_chamado` e da cláusula `setor__isnull=True` de
            # `scope_chamados` — chamado órfão não pode virar chamado que
            # ninguém consegue concluir.
            checar_escrita_no_pai(request.user, chamado)

        serializer = ChamadoResolucaoSerializer(data=request.data, context={'request': request})
        serializer.is_valid(raise_exception=True)
        validated = serializer.validated_data

        defaults = {'usuario': request.user}
        # Só sobrescreve campos efetivamente enviados (upsert parcial).
        if 'link' in validated:
            defaults['link'] = validated.get('link') or None
        arquivo = validated.get('arquivo')
        if arquivo is not None:
            defaults['arquivo'] = arquivo

        obj, _created = ChamadoSuporteResolucao.objects.update_or_create(
            chamado_id=cid_int,
            defaults=defaults,
        )
        return Response(
            ChamadoResolucaoSerializer(obj, context={'request': request}).data,
            status=status.HTTP_201_CREATED,
        )

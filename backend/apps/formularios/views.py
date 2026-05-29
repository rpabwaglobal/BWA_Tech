import logging

from django.db import transaction
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .models import ChamadoSuporte, ChamadoSuporteStatus, ChamadoSuporteTimeline, SuporteMotivo, SuporteTipo
from .realtime import broadcast_chamado
from .serializers import (
    CatalogTipoComItensSerializer,
    CatalogMotivoMiniSerializer,
    ChamadoSuporteReadSerializer,
    ChamadoSuporteWriteSerializer,
    ChamadoSuportePatchSerializer,
    ChamadoSuporteTimelineSerializer,
)

logger = logging.getLogger(__name__)


# Conjunto de status válidos pra validar `?status=` no por_usuario.
# Usar `.value` pra extrair os literais ("Aberto", "Em andamento", ...).
_VALID_STATUSES = {choice.value for choice in ChamadoSuporteStatus}


def _is_privileged(user) -> bool:
    """Privilegiado = supervisor/admin/gerente ou superuser. Usado em
    múltiplos pontos pra restringir mutações sensíveis."""
    if not user.is_authenticated:
        return False
    role = getattr(user, 'role', None)
    return role in ChamadoSuporteViewSet.PRIVILEGED_ROLES or user.is_superuser


class ChamadoSuporteViewSet(viewsets.ModelViewSet):
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

    # Roles privilegiados que podem ver/alterar chamados de QUALQUER usuário.
    PRIVILEGED_ROLES = {'admin', 'supervisor', 'gerente'}

    # Campos que SÓ usuários privilegiados podem mutar via PATCH. Usuário comum
    # autenticado dono do chamado consegue, no máximo, abrir um novo — não
    # marca o próprio como Resolvido/Cancelado nem altera responsável/notas.
    # Isso evita bypass do fluxo de suporte (auto-fechamento de chamado).
    _PRIVILEGED_PATCH_FIELDS = frozenset({
        'status', 'responsavel_solucao', 'descricao_resolucao', 'tipo',
    })

    def get_queryset(self):
        """Mitigação de IDOR: usuários comuns só veem chamados associados ao
        próprio email (usuario_email). Roles privilegiados veem tudo."""
        qs = ChamadoSuporte.objects.select_related('tipo', 'item', 'item__tipo', 'motivo')
        user = self.request.user
        if not user.is_authenticated:
            return qs.none()
        if _is_privileged(user):
            return qs
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
            read = ChamadoSuporteReadSerializer(instance)
            payload = read.data
            transaction.on_commit(lambda: broadcast_chamado('chamado_created', payload))
        return Response(payload, status=status.HTTP_201_CREATED)

    def partial_update(self, request, *args, **kwargs):
        instance = self.get_object()
        patch_sr = ChamadoSuportePatchSerializer(data=request.data, partial=True)
        patch_sr.is_valid(raise_exception=True)
        data = patch_sr.validated_data

        # [C1] Campos que só privilegiados mutam. Usuário comum não fecha
        # próprio chamado, não muda responsável solução, nem move entre tabs.
        if not _is_privileged(request.user):
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
        if _is_privileged(request.user):
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
        if not _is_privileged(request.user):
            raise PermissionDenied(
                detail={'detail': 'Apenas suporte/admin pode alterar a flag de notificação.'},
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
        """True se o usuário é privilegiado OU dono do chamado em questão."""
        if _is_privileged(request.user):
            return True
        user_email = (request.user.email or '').strip().lower()
        if not user_email:
            return False
        return ChamadoSuporte.objects.filter(
            pk=chamado_id, usuario_email__iexact=user_email,
        ).exists()

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

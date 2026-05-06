from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .models import ChamadoSuporte, ChamadoSuporteTimeline, SuporteMotivo, SuporteTipo
from .serializers import (
    CatalogTipoComItensSerializer,
    CatalogMotivoMiniSerializer,
    ChamadoSuporteReadSerializer,
    ChamadoSuporteWriteSerializer,
    ChamadoSuportePatchSerializer,
    ChamadoSuporteTimelineSerializer,
)


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
        instance = serializer.save()
        read = ChamadoSuporteReadSerializer(instance)
        return Response(read.data, status=status.HTTP_201_CREATED)

    def partial_update(self, request, *args, **kwargs):
        instance = self.get_object()
        patch_sr = ChamadoSuportePatchSerializer(data=request.data, partial=True)
        patch_sr.is_valid(raise_exception=True)
        data = patch_sr.validated_data
        for field in ('status', 'responsavel_solucao', 'descricao_resolucao'):
            if field in data:
                setattr(instance, field, data[field])
        instance.save()
        return Response(ChamadoSuporteReadSerializer(instance).data)

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
        qs = self.get_queryset()
        email = request.query_params.get('usuario_email')
        if email:
            qs = qs.filter(usuario_email__iexact=email.strip())
        serializer = ChamadoSuporteReadSerializer(qs, many=True)
        return Response(serializer.data)

    @action(detail=True, methods=['patch'], url_path='notificar-usuario')
    def notificar_usuario(self, request, pk=None):
        instance = self.get_object()
        instance.usuario_notificado = True
        if request.data and request.data.get('usuario_notificado') is False:
            instance.usuario_notificado = False
        instance.save()
        return Response(ChamadoSuporteReadSerializer(instance).data)


class ChamadoSuporteTimelineViewSet(mixins.ListModelMixin, mixins.CreateModelMixin, viewsets.GenericViewSet):
    """Timeline local por chamado: GET ?chamado_id= — POST com chamado_id + descricao."""

    queryset = ChamadoSuporteTimeline.objects.select_related('usuario').all()
    serializer_class = ChamadoSuporteTimelineSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = None
    http_method_names = ['get', 'post', 'head', 'options']

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
        qs = self.queryset.filter(chamado_id=cid_int)
        serializer = self.get_serializer(qs, many=True)
        return Response(serializer.data)

    def perform_create(self, serializer):
        serializer.save(usuario=self.request.user)

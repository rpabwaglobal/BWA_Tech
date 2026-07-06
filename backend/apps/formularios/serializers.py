import os

from rest_framework import serializers

from .models import (
    ChamadoSuporte,
    ChamadoSuporteResolucao,
    ChamadoSuporteStatus,
    ChamadoSuporteTimeline,
    ChamadoSuporteTimelineTipo,
    SuporteItem,
    SuporteMotivo,
    SuporteTipo,
)


class CatalogTipoMiniSerializer(serializers.ModelSerializer):
    class Meta:
        model = SuporteTipo
        fields = ('id', 'nome', 'ativo')


class CatalogItemMiniSerializer(serializers.ModelSerializer):
    tipo = CatalogTipoMiniSerializer(read_only=True)

    class Meta:
        model = SuporteItem
        fields = ('id', 'nome', 'ativo', 'tipo')


class CatalogMotivoMiniSerializer(serializers.ModelSerializer):
    class Meta:
        model = SuporteMotivo
        fields = ('id', 'nome', 'ativo')


class CatalogItemNestedSerializer(serializers.ModelSerializer):
    """Item dentro do catálogo (lista por tipo), sem tipo repetido no pai."""

    class Meta:
        model = SuporteItem
        fields = ('id', 'nome', 'ativo')


class CatalogTipoComItensSerializer(serializers.ModelSerializer):
    itens = serializers.SerializerMethodField()

    class Meta:
        model = SuporteTipo
        fields = ('id', 'nome', 'ativo', 'itens')

    def get_itens(self, obj):
        qs = obj.itens.filter(ativo=True)
        return CatalogItemNestedSerializer(qs, many=True).data


class ChamadoSuporteReadSerializer(serializers.ModelSerializer):
    tipo = CatalogTipoMiniSerializer(read_only=True)
    item = CatalogItemMiniSerializer(read_only=True)
    motivo = CatalogMotivoMiniSerializer(read_only=True)

    class Meta:
        model = ChamadoSuporte
        fields = (
            'id',
            'usuario_nome',
            'usuario_email',
            'usuario_setor',
            'empresa',
            'descricao',
            'tipo',
            'item',
            'motivo',
            'anexo_url',
            'status',
            'usuario_notificado',
            'responsavel',
            'responsavel_solucao',
            'descricao_resolucao',
            'data_abertura',
            'data_atualizacao',
        )


class ChamadoSuporteWriteSerializer(serializers.ModelSerializer):
    """POST create — tipo/item/motivo como IDs no payload."""

    class Meta:
        model = ChamadoSuporte
        fields = (
            'usuario_nome',
            'usuario_email',
            'usuario_setor',
            'empresa',
            'descricao',
            'tipo',
            'item',
            'motivo',
            'anexo_url',
            'status',
            'responsavel',
            'responsavel_solucao',
            'descricao_resolucao',
        )
        extra_kwargs = {
            'usuario_setor': {'allow_blank': True, 'required': False},
            'empresa': {'allow_blank': True, 'required': False},
            'anexo_url': {'allow_null': True, 'required': False},
            'responsavel': {'allow_null': True, 'required': False},
            'responsavel_solucao': {'allow_null': True, 'required': False},
            'descricao_resolucao': {'allow_null': True, 'required': False},
            'status': {'required': False},
        }

    def validate(self, attrs):
        tipo = attrs.get('tipo')
        item = attrs.get('item')
        motivo = attrs.get('motivo')
        if item is not None and tipo is not None and item.tipo_id != tipo.pk:
            raise serializers.ValidationError(
                {'item': 'O item selecionado não pertence ao tipo informado.'},
            )
        if motivo is not None and not motivo.ativo:
            raise serializers.ValidationError({'motivo': 'Motivo inativo.'})
        if tipo is not None and not tipo.ativo:
            raise serializers.ValidationError({'tipo': 'Tipo inativo.'})
        if item is not None and not item.ativo:
            raise serializers.ValidationError({'item': 'Item inativo.'})
        return attrs

    def create(self, validated_data):
        validated_data.setdefault(
            'status',
            ChamadoSuporteStatus.ABERTO,
        )
        return super().create(validated_data)


ALLOWED_PATCH_FIELDS = frozenset({
    'status', 'responsavel_solucao', 'descricao_resolucao', 'tipo', 'item',
})


class ChamadoSuportePatchSerializer(serializers.Serializer):
    status = serializers.ChoiceField(
        choices=ChamadoSuporteStatus.choices,
        required=False,
    )
    responsavel_solucao = serializers.CharField(allow_null=True, allow_blank=True, required=False)
    descricao_resolucao = serializers.CharField(allow_null=True, allow_blank=True, required=False)
    # `tipo` é FK pra SuporteTipo. Aceito como pk (id) — usado pelo multi-select
    # do frontend pra mover chamados entre as tabs RPA / Easy / Dashboards.
    tipo = serializers.PrimaryKeyRelatedField(
        queryset=SuporteTipo.objects.all(),
        required=False,
    )
    item = serializers.PrimaryKeyRelatedField(
        queryset=SuporteItem.objects.all(),
        required=False,
    )

    def validate(self, attrs):
        if not attrs:
            raise serializers.ValidationError(
                'Informe ao menos um dos campos: status, responsavel_solucao, '
                'descricao_resolucao, tipo, item.',
            )
        for key in attrs:
            if key not in ALLOWED_PATCH_FIELDS:
                raise serializers.ValidationError({key: 'Campo não permitido neste PATCH.'})
        instance = self.context.get('instance')
        tipo = attrs.get('tipo') or (instance.tipo if instance else None)
        item = attrs.get('item') or (instance.item if instance else None)
        if item is not None and tipo is not None and item.tipo_id != tipo.pk:
            raise serializers.ValidationError(
                {'item': 'O item selecionado não pertence ao tipo informado.'},
            )
        if tipo is not None and not tipo.ativo:
            raise serializers.ValidationError({'tipo': 'Tipo inativo.'})
        if item is not None and not item.ativo:
            raise serializers.ValidationError({'item': 'Item inativo.'})
        return attrs


# Extensões aceitas no arquivo de resolução: imagem, PDF, documento ou planilha.
# SVG fica de fora de propósito (vetor de XSS quando servido inline).
RESOLUCAO_ALLOWED_EXTENSIONS = frozenset({
    # imagem
    'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp',
    # pdf
    'pdf',
    # documento
    'doc', 'docx', 'txt', 'rtf', 'odt',
    # planilha
    'xls', 'xlsx', 'csv', 'ods',
})
RESOLUCAO_MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB


class ChamadoResolucaoSerializer(serializers.ModelSerializer):
    """Link + arquivo de resolução de um chamado. `arquivo` é write-only; a
    leitura expõe `arquivo_url` (URL absoluta) e `arquivo_nome`."""

    # Explícito (sem UniqueValidator do modelo): a view faz upsert por chamado_id
    # via update_or_create, então um POST repetido para o mesmo chamado é válido.
    chamado_id = serializers.IntegerField(min_value=1)
    arquivo_url = serializers.SerializerMethodField()
    arquivo_nome = serializers.SerializerMethodField()

    class Meta:
        model = ChamadoSuporteResolucao
        fields = [
            'id',
            'chamado_id',
            'link',
            'arquivo',
            'arquivo_url',
            'arquivo_nome',
            'criado_em',
            'atualizado_em',
        ]
        read_only_fields = ['id', 'criado_em', 'atualizado_em']
        extra_kwargs = {
            'arquivo': {'write_only': True, 'required': False, 'allow_null': True},
            'link': {'required': False, 'allow_null': True, 'allow_blank': True},
        }

    def get_arquivo_url(self, obj):
        if not obj.arquivo:
            return None
        request = self.context.get('request')
        url = obj.arquivo.url
        return request.build_absolute_uri(url) if request else url

    def get_arquivo_nome(self, obj):
        if not obj.arquivo:
            return None
        return os.path.basename(obj.arquivo.name)

    def validate_arquivo(self, value):
        if value in (None, ''):
            return value
        ext = os.path.splitext(value.name)[1].lower().lstrip('.')
        if ext not in RESOLUCAO_ALLOWED_EXTENSIONS:
            raise serializers.ValidationError(
                'Tipo de arquivo não suportado. Envie imagem, documento, PDF ou planilha.',
            )
        if value.size > RESOLUCAO_MAX_FILE_SIZE:
            raise serializers.ValidationError('Arquivo muito grande (máx 10 MB).')
        return value


def _format_user_name_timeline(user):
    if not user:
        return ''
    fn = (getattr(user, 'first_name', None) or '').strip()
    ln = (getattr(user, 'last_name', None) or '').strip()
    full = f'{fn} {ln}'.strip()
    return full or getattr(user, 'username', '') or ''


class ChamadoSuporteTimelineSerializer(serializers.ModelSerializer):
    usuario_name = serializers.SerializerMethodField()
    usuario_role_display = serializers.SerializerMethodField()
    tipo_evento_display = serializers.CharField(source='get_tipo_evento_display', read_only=True)
    tipo_evento = serializers.ChoiceField(
        choices=ChamadoSuporteTimelineTipo.choices,
        default=ChamadoSuporteTimelineTipo.COMENTARIO,
        required=False,
    )

    class Meta:
        model = ChamadoSuporteTimeline
        fields = [
            'id',
            'chamado_id',
            'tipo_evento',
            'tipo_evento_display',
            'descricao',
            'usuario',
            'usuario_name',
            'usuario_role_display',
            'data',
        ]
        read_only_fields = ['id', 'usuario', 'data']

    def get_usuario_name(self, obj):
        return _format_user_name_timeline(obj.usuario)

    def get_usuario_role_display(self, obj):
        return obj.usuario.get_role_display() if obj.usuario else None

from rest_framework import serializers
from django.conf import settings
from .models import GeekDayDraw
from apps.accounts.profile_picture_utils import get_profile_picture_url


def format_user_name(user):
    """Formata o nome do usuário"""
    if not user:
        return None
    if user.first_name and user.last_name:
        return f"{user.first_name} {user.last_name}"
    elif user.first_name:
        return user.first_name
    elif user.last_name:
        return user.last_name
    return user.username


class GeekDayDrawSerializer(serializers.ModelSerializer):
    usuario_name = serializers.SerializerMethodField()
    sorteado_por_name = serializers.SerializerMethodField()
    usuario_profile_picture = serializers.SerializerMethodField()

    class Meta:
        model = GeekDayDraw
        fields = [
            'id', 'usuario', 'usuario_name', 'usuario_profile_picture',
            'sorteado_por', 'sorteado_por_name', 'data_sorteio',
            'data_apresentacao',
            'marcado_manual', 'observacoes',
            'cycle',
        ]
        read_only_fields = ['data_sorteio']

    def get_usuario_name(self, obj):
        return format_user_name(obj.usuario)

    def get_sorteado_por_name(self, obj):
        return format_user_name(obj.sorteado_por) if obj.sorteado_por else None

    def get_usuario_profile_picture(self, obj):
        return get_profile_picture_url(obj.usuario, request=self.context.get('request'))


class GeekDayUserStatusSerializer(serializers.Serializer):
    """Serializer para status de sorteio dos usuários"""
    id = serializers.UUIDField()
    username = serializers.CharField()
    first_name = serializers.CharField(allow_null=True)
    last_name = serializers.CharField(allow_null=True)
    email = serializers.EmailField()
    role = serializers.CharField()  # Adicionar role para cores na roleta
    profile_picture_url = serializers.URLField(allow_null=True)
    ja_sorteado = serializers.BooleanField()
    total_sorteios = serializers.IntegerField()
    ultimo_sorteio = serializers.DateTimeField(allow_null=True)

from datetime import timedelta

from django.utils import timezone
from rest_framework.authentication import TokenAuthentication
from rest_framework.exceptions import AuthenticationFailed

TOKEN_TTL = timedelta(hours=24)


class ExpiringTokenAuthentication(TokenAuthentication):
    """
    Token DRF com TTL de 24 horas.
    Ao expirar, o token é apagado e retorna 401 para forçar novo login.
    """

    def authenticate_credentials(self, key):
        model = self.get_model()
        try:
            token = model.objects.select_related('user').get(key=key)
        except model.DoesNotExist:
            raise AuthenticationFailed('Token inválido.')

        if not token.user.is_active:
            raise AuthenticationFailed('Usuário inativo ou removido.')

        if timezone.now() > token.created + TOKEN_TTL:
            token.delete()
            raise AuthenticationFailed('Token expirado. Faça login novamente.')

        return (token.user, token)

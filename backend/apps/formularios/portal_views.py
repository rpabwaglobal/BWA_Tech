"""
Endpoint para o SPA obter o JWT do portal e chamar a API externa de formulários/suporte.
Credenciais do portal permanecem só no servidor (.env).
"""

from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .portal_auth import PortalLoginError, login_on_portal


class PortalFormulariosJWTView(APIView):
    """
    GET — usuário já autenticado no BWA recebe `access` (JWT) para usar em:
    Authorization: Bearer <access> na API externa (ex.: .../api/formularios/suporte/).
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        try:
            access = login_on_portal()
        except PortalLoginError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        return Response({'access': access})

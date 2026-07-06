import imghdr
import io

from django.db.models import Q
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.authtoken.models import Token
from .permissions import IsAdminOrSupervisor
from rest_framework.throttling import AnonRateThrottle
from django.contrib.auth import login, logout
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_exempt

try:
    from PIL import Image  # Pillow já é dependência (ImageField)
except ImportError:  # pragma: no cover
    Image = None  # type: ignore[assignment]

from .models import User
from .serializers import (
    UserSerializer,
    LoginSerializer,
    ChangePasswordSerializer,
    RegisterSerializer,
    RecoverAccountSerializer,
    _generate_recovery_code,
)
from .authentication import TOKEN_TTL


# --- Throttle classes (rate limiting por escopo) ---------------------------

class LoginRateThrottle(AnonRateThrottle):
    scope = 'login'


class RegisterRateThrottle(AnonRateThrottle):
    scope = 'register'


class RecoveryRateThrottle(AnonRateThrottle):
    scope = 'recovery'


# --- Validação de upload de imagem (defesa em profundidade) ----------------

ALLOWED_IMAGE_MIME = {'image/jpeg', 'image/png', 'image/webp'}
ALLOWED_IMAGE_KINDS = {'jpeg', 'png', 'webp'}
MAX_IMAGE_SIZE = 5 * 1024 * 1024  # 5 MB


def _validate_uploaded_image(file):
    """Retorna (ok, error_message). Valida tamanho, MIME, magic bytes e
    integridade via Pillow. Bloqueia SVG e tipos perigosos."""
    if not file:
        return False, 'Nenhum arquivo enviado.'
    if file.size > MAX_IMAGE_SIZE:
        return False, 'Arquivo muito grande (máx 5 MB).'
    if getattr(file, 'content_type', '') not in ALLOWED_IMAGE_MIME:
        return False, 'Formato não suportado. Use JPEG, PNG ou WebP.'
    # Magic bytes
    file.seek(0)
    head = file.read(32)
    file.seek(0)
    kind = imghdr.what(None, head)
    if kind not in ALLOWED_IMAGE_KINDS:
        return False, 'Arquivo não é uma imagem válida.'
    # Pillow.verify() pega bombs e arquivos corrompidos
    if Image is not None:
        try:
            img = Image.open(io.BytesIO(file.read()))
            img.verify()
        except Exception:
            return False, 'Imagem corrompida ou maliciosa.'
        finally:
            file.seek(0)
    return True, None


def _issue_fresh_token(user):
    """Rotaciona o token: deleta os existentes e cria um novo com `created` atual.

    Garante que o cliente receba sempre um token com 24h cheias de TTL,
    em vez de um token antigo prestes a expirar.
    Retorna (token, expires_at_iso).
    """
    Token.objects.filter(user=user).delete()
    token = Token.objects.create(user=user)
    expires_at = (token.created + TOKEN_TTL).isoformat()
    return token, expires_at


class UserViewSet(viewsets.ModelViewSet):
    queryset = User.objects.exclude(role='admin')
    serializer_class = UserSerializer
    permission_classes = [IsAuthenticated]

    def get_permissions(self):
        # Criação de conta legítima passa pelo RegisterView; aqui restringimos.
        # Excluir usuário também é ação de gestão (admin/supervisor).
        if self.action in ('create', 'destroy'):
            return [IsAdminOrSupervisor()]
        return super().get_permissions()

    def update(self, request, *args, **kwargs):
        """Editar usuário: o próprio (perfil) ou admin/supervisor (gestão/papel).
        Usuário comum não pode alterar o próprio papel (escalonamento)."""
        instance = self.get_object()
        is_privileged = request.user.role in ('admin', 'supervisor')
        is_self = instance.pk == request.user.pk
        if not is_privileged and not is_self:
            return Response(
                {'detail': 'Sem permissão para editar este usuário.'},
                status=status.HTTP_403_FORBIDDEN,
            )
        if not is_privileged and 'role' in request.data:
            novo = request.data.get('role')
            if novo and novo != instance.role:
                return Response(
                    {'detail': 'Você não pode alterar o próprio papel.'},
                    status=status.HTTP_403_FORBIDDEN,
                )
        return super().update(request, *args, **kwargs)

    def get_queryset(self):
        """Excluir admins das listagens; permitir que o usuário acesse o próprio perfil (retrieve/update)."""
        queryset = User.objects.exclude(role='admin')
        # Em detail (retrieve/update/partial_update/destroy): permitir acesso ao próprio usuário (ex.: admin editando seu perfil)
        if self.request.user and self.action in ('retrieve', 'update', 'partial_update', 'destroy'):
            queryset = User.objects.filter(Q(pk=self.request.user.pk) | ~Q(role='admin'))
        role = self.request.query_params.get('role', None)
        if role:
            queryset = queryset.filter(role=role)
        return queryset

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context['request'] = self.request
        return context

    @action(detail=False, methods=['get'], permission_classes=[IsAuthenticated])
    def me(self, request):
        """Retorna o usuário atual"""
        serializer = self.get_serializer(request.user)
        return Response(serializer.data)

    @action(detail=False, methods=['post'], permission_classes=[IsAuthenticated], url_path='change-password')
    def change_password(self, request):
        """Altera a senha do usuário atual"""
        serializer = ChangePasswordSerializer(data=request.data, context={'request': request})
        if serializer.is_valid():
            request.user.set_password(serializer.validated_data['new_password'])
            request.user.save()
            return Response({'message': 'Senha alterada com sucesso'})
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=False, methods=['get', 'post'], permission_classes=[IsAuthenticated], url_path='recovery-code')
    def recovery_code(self, request):
        """GET retorna o código atual do usuário autenticado.
        POST rotaciona: gera código novo (único no DB), invalida o anterior.

        O código não expira por tempo — fica válido até ser explicitamente
        regenerado (aqui ou via fluxo de recover-account, que rotaciona ao usar).
        """
        user = request.user
        if request.method == 'POST':
            user.recovery_code = _generate_recovery_code()
            user.save(update_fields=['recovery_code'])
        return Response({'recovery_code': user.recovery_code})

    @action(detail=False, methods=['post'], permission_classes=[IsAuthenticated], url_path='profile-picture')
    def profile_picture(self, request):
        """Atualiza a foto de perfil do usuário atual (validação robusta)."""
        file = request.FILES.get('profile_picture')
        ok, err = _validate_uploaded_image(file)
        if not ok:
            return Response(
                {'profile_picture': [err]},
                status=status.HTTP_400_BAD_REQUEST,
            )
        # Remove foto anterior se existir
        if request.user.profile_picture:
            request.user.profile_picture.delete(save=False)
        request.user.profile_picture = file
        request.user.save(update_fields=['profile_picture'])
        serializer = self.get_serializer(request.user)
        return Response(serializer.data)


class RegisterView(APIView):
    """Criação de conta: login, senha, e-mail; foto opcional. Novo usuário vem como desenvolvedor."""
    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_classes = [RegisterRateThrottle]

    @method_decorator(csrf_exempt)
    def dispatch(self, *args, **kwargs):
        return super().dispatch(*args, **kwargs)

    def post(self, request):
        # Validação de upload de imagem antes mesmo do serializer
        # (ImageField do DRF valida mínimo, mas a checagem manual é mais rigorosa).
        if 'profile_picture' in request.FILES:
            ok, err = _validate_uploaded_image(request.FILES['profile_picture'])
            if not ok:
                return Response({'profile_picture': [err]}, status=status.HTTP_400_BAD_REQUEST)
        serializer = RegisterSerializer(data=request.data)
        if serializer.is_valid():
            user = serializer.save()
            token, expires_at = _issue_fresh_token(user)
            user_serializer = UserSerializer(user, context={'request': request})
            return Response({
                'user': user_serializer.data,
                'token': token.key,
                'expires_at': expires_at,
                'message': 'Conta criada com sucesso.',
                'recovery_code': user.recovery_code,
            })
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


class LoginView(APIView):
    """View de login - token DRF com TTL de 24h."""
    permission_classes = [AllowAny]
    authentication_classes = []  # Não requer autenticação
    throttle_classes = [LoginRateThrottle]

    @method_decorator(csrf_exempt)
    def dispatch(self, *args, **kwargs):
        return super().dispatch(*args, **kwargs)

    def post(self, request):
        """Login do usuário - retorna token de autenticação"""
        serializer = LoginSerializer(data=request.data)
        if serializer.is_valid():
            user = serializer.validated_data['user']
            # Rotaciona token: cliente sempre recebe TTL cheio de 24h
            token, expires_at = _issue_fresh_token(user)
            user_serializer = UserSerializer(user, context={'request': request})
            return Response({
                'user': user_serializer.data,
                'token': token.key,
                'expires_at': expires_at,
                'message': 'Login realizado com sucesso'
            })
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


class LogoutView(APIView):
    """View de logout - remove apenas o token usado nesta requisição."""
    permission_classes = [IsAuthenticated]

    def post(self, request):
        token = getattr(request, 'auth', None)
        if token is not None and hasattr(token, 'delete'):
            token.delete()
        elif hasattr(request.user, 'auth_token'):
            request.user.auth_token.delete()
        logout(request)
        return Response({'message': 'Logout realizado com sucesso'})


class LogoutAllView(APIView):
    """Logout de TODOS os dispositivos: remove todos os tokens do usuário.
    Chamar após troca de senha / recuperação para revogar sessões antigas."""
    permission_classes = [IsAuthenticated]

    def post(self, request):
        Token.objects.filter(user=request.user).delete()
        logout(request)
        return Response({'message': 'Sessões em todos os dispositivos foram encerradas.'})


class RecoverAccountView(APIView):
    """Recupera acesso via código: redefine senha, rotaciona o código,
    invalida todos os tokens existentes do usuário."""
    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_classes = [RecoveryRateThrottle]

    @method_decorator(csrf_exempt)
    def dispatch(self, *args, **kwargs):
        return super().dispatch(*args, **kwargs)

    def post(self, request):
        serializer = RecoverAccountSerializer(data=request.data)
        if serializer.is_valid():
            user = serializer.validated_data['user']
            user.set_password(serializer.validated_data['new_password'])
            # Rotaciona o código após uso (o anterior deixa de funcionar
            # imediatamente — atende a "ao gerar novo, o antigo é invalidado").
            user.recovery_code = _generate_recovery_code()
            user.save(update_fields=['password', 'recovery_code'])
            # Logout-all após recovery (defesa contra atacante que já tinha token)
            Token.objects.filter(user=user).delete()
            return Response({'message': 'Senha redefinida com sucesso.'})
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

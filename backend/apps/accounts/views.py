import imghdr
import io

from django.db import transaction
from django.db.models import Q
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.authtoken.models import Token
from django.contrib.auth.models import Permission
from .permissions import IsAdminOrSupervisor, CanManageUserPermissions
from .permission_catalog import PERMISSION_CATALOG
from rest_framework.throttling import AnonRateThrottle
from django.contrib.auth import login, logout
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_exempt

try:
    from PIL import Image  # Pillow já é dependência (ImageField)
except ImportError:  # pragma: no cover
    Image = None  # type: ignore[assignment]

from django.core.cache import cache
from .models import User, Cargo, SetorCatalogo, CARGO_CHOICES_CACHE_KEY, SETOR_CHOICES_CACHE_KEY
from .image_processing import process_profile_picture
from .serializers import (
    UserSerializer,
    LoginSerializer,
    ChangePasswordSerializer,
    RegisterSerializer,
    RecoverAccountSerializer,
    CargoSerializer,
    SetorCatalogoSerializer,
    _generate_recovery_code,
)
from .authentication import TOKEN_TTL
from .realtime import notify_permissions_changed, notify_account_deactivated

ALL_PERMISSION_CODENAMES = {codename for codename, _label, _area in PERMISSION_CATALOG}


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
        # Captura ANTES: super().update() faz seu próprio get_object() (nova
        # instância), então `instance.role/.setor` aqui embaixo continuam
        # refletindo o valor pré-edição mesmo depois da chamada.
        old_role, old_setor = instance.role, instance.setor
        response = super().update(request, *args, **kwargs)
        if response.status_code < 300:
            novo_role = response.data.get('role', old_role)
            novo_setor = response.data.get('setor', old_setor)
            if novo_role != old_role or novo_setor != old_setor:
                notify_permissions_changed(instance.pk)
        return response

    def get_queryset(self):
        """Excluir admins das listagens; permitir que o usuário acesse o próprio perfil (retrieve/update)."""
        # Ações de gestão (tela de Gerenciamento de Usuários): precisam
        # enxergar admins também — o bloqueio de "supervisor não mexe em
        # admin" é feito por CanManageUserPermissions.has_object_permission,
        # não pela queryset.
        if self.request.user and self.action in ('set_active', 'set_permissions'):
            return User.objects.all()
        queryset = User.objects.exclude(role='admin')
        # Em detail (retrieve/update/partial_update/destroy): permitir acesso ao próprio usuário (ex.: admin editando seu perfil)
        if self.request.user and self.action in ('retrieve', 'update', 'partial_update', 'destroy'):
            queryset = User.objects.filter(Q(pk=self.request.user.pk) | ~Q(role='admin'))
        role = self.request.query_params.get('role', None)
        if role:
            queryset = queryset.filter(role=role)
        # Escopo por setor (seletores de responsável etc. mostram só quem
        # compartilha setor). Fail-open enquanto flag OFF. A tela de gestão usa
        # a action `all_users` (queryset próprio), não afetada por isto.
        from .scoping import scope_users
        return scope_users(queryset, self.request.user)

    @action(detail=False, methods=['get'], permission_classes=[IsAdminOrSupervisor], url_path='all')
    def all_users(self, request):
        """Lista TODOS os usuários (inclusive admins) para a tela de
        Gerenciamento de Usuários. Suporta busca por nome/username/email."""
        qs = User.objects.all().order_by('username')
        search = (request.query_params.get('search') or '').strip()
        if search:
            qs = qs.filter(
                Q(username__icontains=search)
                | Q(first_name__icontains=search)
                | Q(last_name__icontains=search)
                | Q(email__icontains=search)
            )
        page = self.paginate_queryset(qs)
        if page is not None:
            serializer = self.get_serializer(page, many=True)
            return self.get_paginated_response(serializer.data)
        serializer = self.get_serializer(qs, many=True)
        return Response(serializer.data)

    @action(detail=False, methods=['get'], permission_classes=[IsAdminOrSupervisor], url_path='permissions-catalog')
    def permissions_catalog(self, request):
        """Catálogo completo de permissões granulares, agrupado por área,
        pra popular os switches na tela de Gerenciamento de Usuários."""
        data = [{'codename': codename, 'name': name, 'area': area} for codename, name, area in PERMISSION_CATALOG]
        return Response(data)

    @action(detail=True, methods=['post'], permission_classes=[CanManageUserPermissions], url_path='set-permissions')
    def set_permissions(self, request, pk=None):
        """Substitui o conjunto de permissões granulares do usuário-alvo pela
        lista enviada. Bloqueado contra alvo admin (por não-admin) e
        autoedição via CanManageUserPermissions."""
        instance = self.get_object()
        codenames = request.data.get('codenames')
        if not isinstance(codenames, list) or not all(isinstance(c, str) for c in codenames):
            return Response({'codenames': ['Lista de codenames é obrigatória.']}, status=status.HTTP_400_BAD_REQUEST)
        invalid = sorted(set(codenames) - ALL_PERMISSION_CODENAMES)
        if invalid:
            return Response({'codenames': [f'Codenames inválidos: {", ".join(invalid)}']}, status=status.HTTP_400_BAD_REQUEST)
        perms = Permission.objects.filter(content_type__app_label='accounts', codename__in=codenames)
        instance.user_permissions.set(perms)
        notify_permissions_changed(instance.pk)
        serializer = self.get_serializer(instance)
        return Response(serializer.data)

    @action(detail=True, methods=['post'], permission_classes=[CanManageUserPermissions], url_path='set-active')
    def set_active(self, request, pk=None):
        """Ativa/desativa o usuário-alvo. Ao desativar, revoga explicitamente
        todos os tokens (reforço — o bloqueio automático via is_active já
        cobre requests futuras, ver authentication.py)."""
        instance = self.get_object()
        is_active = request.data.get('is_active')
        if not isinstance(is_active, bool):
            return Response({'is_active': ['Valor booleano obrigatório.']}, status=status.HTTP_400_BAD_REQUEST)
        instance.is_active = is_active
        instance.save(update_fields=['is_active'])
        if not is_active:
            Token.objects.filter(user=instance).delete()
            notify_account_deactivated(instance.pk)
        else:
            notify_permissions_changed(instance.pk)
        serializer = self.get_serializer(instance)
        return Response(serializer.data)

    # ---- Atribuição em massa (bulk) ---------------------------------------
    def _bulk_targets(self, request, user_ids):
        """Resolve os usuários-alvo de um bulk, aplicando as mesmas travas do
        gerenciamento individual: nunca a si mesmo; admin só é alterável por
        admin. Retorna (alvos, ignorados)."""
        if not isinstance(user_ids, list) or not user_ids:
            return None, None
        alvos, ignorados = [], []
        ids_norm, vistos = [], set()
        for raw in user_ids:
            try:
                uid = int(raw)
            except (TypeError, ValueError):
                ignorados.append({'id': raw, 'motivo': 'id inválido'})
                continue
            if uid not in vistos:
                vistos.add(uid)
                ids_norm.append(uid)
        encontrados = {u.pk: u for u in User.objects.filter(pk__in=ids_norm)}
        for uid in ids_norm:
            u = encontrados.get(uid)
            if u is None:
                ignorados.append({'id': uid, 'motivo': 'usuário inexistente'})
            elif u.pk == request.user.pk:
                ignorados.append({'id': u.pk, 'motivo': 'não pode alterar a si mesmo'})
            elif u.role == 'admin' and request.user.role != 'admin':
                ignorados.append({'id': u.pk, 'motivo': 'apenas admin gerencia admins'})
            else:
                alvos.append(u)
        return alvos, ignorados

    @action(detail=False, methods=['post'], permission_classes=[IsAdminOrSupervisor], url_path='bulk-assign-cargo')
    def bulk_assign_cargo(self, request):
        """Atribui um cargo a vários usuários de uma vez. `apply_template`
        (opcional) também aplica as permissões-padrão do cargo."""
        from .models import BulkOperationAudit, Cargo
        cargo_codename = request.data.get('cargo_codename')
        apply_template = bool(request.data.get('apply_template'))
        cargo = Cargo.objects.filter(codename=cargo_codename).first()
        if not cargo:
            return Response({'cargo_codename': ['Cargo inválido.']}, status=status.HTTP_400_BAD_REQUEST)
        # Só admin promove/rebaixa supervisor (espelha validate_role).
        if cargo_codename == 'supervisor' and request.user.role != 'admin':
            return Response({'detail': 'Apenas admin pode atribuir o cargo Supervisor.'}, status=status.HTTP_403_FORBIDDEN)
        alvos, ignorados = self._bulk_targets(request, request.data.get('user_ids'))
        if alvos is None:
            return Response({'user_ids': ['Lista de IDs obrigatória.']}, status=status.HTTP_400_BAD_REQUEST)

        template_perms = None
        if apply_template:
            template_perms = list(Permission.objects.filter(
                content_type__app_label='accounts', codename__in=(cargo.permissoes_padrao or [])))

        snapshot = {}
        with transaction.atomic():
            for u in alvos:
                if u.is_superuser:
                    ignorados.append({'id': u.pk, 'motivo': 'superuser (role forçado a admin)'}); continue
                snap = {'role': u.role}
                if apply_template:
                    snap['permissions'] = sorted(u.user_permissions.filter(
                        content_type__app_label='accounts').values_list('codename', flat=True))
                snapshot[str(u.pk)] = snap
                u.role = cargo_codename
                u.save(update_fields=['role', 'updated_at'])
                if apply_template:
                    u.user_permissions.set(template_perms)
            if snapshot:
                BulkOperationAudit.objects.create(
                    operador=request.user, tipo='cargo', snapshot=snapshot,
                    descricao=f'Cargo "{cargo.nome}" para {len(snapshot)} usuário(s)'
                              + (' (com template)' if apply_template else ''))
        cache.delete(CARGO_CHOICES_CACHE_KEY)
        if snapshot:
            notify_permissions_changed([int(pk) for pk in snapshot.keys()])
        return Response({'updated': len(snapshot), 'skipped': ignorados})

    @action(detail=False, methods=['post'], permission_classes=[IsAdminOrSupervisor], url_path='bulk-assign-setor')
    def bulk_assign_setor(self, request):
        """Define o setor primário de vários usuários. Aceita um codename
        ('' para limpar). Sincroniza o CharField `User.setor` E o vínculo M2M
        `UserSetor` (autoridade do scoping) — sem o M2M, o usuário ficaria com
        listas vazias quando SETOR_SCOPING_ENABLED=true. Limpar ('') zera o
        primário mas preserva os vínculos M2M existentes (remover de um setor
        é ação individual, não bulk)."""
        from .models import BulkOperationAudit, SetorCatalogo, UserSetor
        setor_codename = request.data.get('setor_codename', '')
        setor_obj = None
        if setor_codename:
            setor_obj = SetorCatalogo.objects.filter(codename=setor_codename).first()
            if setor_obj is None:
                return Response({'setor_codename': ['Setor inválido.']}, status=status.HTTP_400_BAD_REQUEST)
        alvos, ignorados = self._bulk_targets(request, request.data.get('user_ids'))
        if alvos is None:
            return Response({'user_ids': ['Lista de IDs obrigatória.']}, status=status.HTTP_400_BAD_REQUEST)
        snapshot = {}
        with transaction.atomic():
            for u in alvos:
                snapshot[str(u.pk)] = {
                    'setor': u.setor,
                    'setores_m2m': sorted(u.setores.values_list('codename', flat=True)),
                }
                u.setor = setor_codename
                u.save(update_fields=['setor', 'updated_at'])
                if setor_obj is not None:
                    vinculo, created = UserSetor.objects.get_or_create(
                        user=u, setor=setor_obj,
                        defaults={'is_primary': True, 'added_by': request.user})
                    if not created and not vinculo.is_primary:
                        vinculo.is_primary = True
                        vinculo.save(update_fields=['is_primary'])
                    UserSetor.objects.filter(user=u, is_primary=True).exclude(setor=setor_obj).update(is_primary=False)
                else:
                    UserSetor.objects.filter(user=u, is_primary=True).update(is_primary=False)
            if snapshot:
                BulkOperationAudit.objects.create(
                    operador=request.user, tipo='setor', snapshot=snapshot,
                    descricao=f'Setor "{setor_codename or "(nenhum)"}" para {len(snapshot)} usuário(s)')
        cache.delete(SETOR_CHOICES_CACHE_KEY)
        if snapshot:
            notify_permissions_changed([int(pk) for pk in snapshot.keys()])
        return Response({'updated': len(snapshot), 'skipped': ignorados})

    @action(detail=False, methods=['post'], permission_classes=[IsAdminOrSupervisor], url_path='bulk-set-permissions')
    def bulk_set_permissions(self, request):
        """Aplica permissões a vários usuários. `mode`: set (substitui) |
        add | remove."""
        from .models import BulkOperationAudit
        codenames = request.data.get('codenames')
        mode = request.data.get('mode', 'set')
        if not isinstance(codenames, list) or not all(isinstance(c, str) for c in codenames):
            return Response({'codenames': ['Lista obrigatória.']}, status=status.HTTP_400_BAD_REQUEST)
        if mode not in ('set', 'add', 'remove'):
            return Response({'mode': ['Deve ser set|add|remove.']}, status=status.HTTP_400_BAD_REQUEST)
        invalid = sorted(set(codenames) - ALL_PERMISSION_CODENAMES)
        if invalid:
            return Response({'codenames': [f'Inválidos: {", ".join(invalid)}']}, status=status.HTTP_400_BAD_REQUEST)
        alvos, ignorados = self._bulk_targets(request, request.data.get('user_ids'))
        if alvos is None:
            return Response({'user_ids': ['Lista de IDs obrigatória.']}, status=status.HTTP_400_BAD_REQUEST)
        perms = list(Permission.objects.filter(content_type__app_label='accounts', codename__in=codenames))
        snapshot = {}
        with transaction.atomic():
            for u in alvos:
                snapshot[str(u.pk)] = {'permissions': sorted(u.user_permissions.filter(
                    content_type__app_label='accounts').values_list('codename', flat=True))}
                if mode == 'set':
                    u.user_permissions.set(perms)
                elif mode == 'add':
                    u.user_permissions.add(*perms)
                else:
                    u.user_permissions.remove(*perms)
            if snapshot:
                BulkOperationAudit.objects.create(
                    operador=request.user, tipo='permissions', snapshot=snapshot,
                    descricao=f'Permissões ({mode}) para {len(snapshot)} usuário(s)')
        if snapshot:
            notify_permissions_changed([int(pk) for pk in snapshot.keys()])
        return Response({'updated': len(snapshot), 'skipped': ignorados})

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
        # Redimensiona/re-encoda e gera nome único (uuid) → download leve + cache imutável.
        processed = process_profile_picture(file)
        if processed is not None:
            request.user.profile_picture.save(processed.name, processed, save=False)
        else:
            request.user.profile_picture = file
        request.user.save(update_fields=['profile_picture'])
        serializer = self.get_serializer(request.user)
        return Response(serializer.data)


class CargoViewSet(viewsets.ModelViewSet):
    """Catálogo de cargos. Qualquer autenticado lê; admin/supervisor criam,
    editam (nome/cor/rótulo/template) e excluem. Cargos de sistema não são
    excluíveis e não têm codename/is_system editáveis."""
    queryset = Cargo.objects.all()
    serializer_class = CargoSerializer
    http_method_names = ['get', 'post', 'patch', 'delete', 'head', 'options']

    def get_permissions(self):
        if self.action in ('create', 'update', 'partial_update', 'destroy'):
            return [IsAdminOrSupervisor()]
        return [IsAuthenticated()]

    def destroy(self, request, *args, **kwargs):
        cargo = self.get_object()
        if cargo.is_system:
            return Response({'detail': 'Cargos de sistema não podem ser excluídos.'},
                            status=status.HTTP_403_FORBIDDEN)
        vinculados = User.objects.filter(role=cargo.codename).count()
        if vinculados:
            return Response(
                {'detail': f'Este cargo tem {vinculados} usuário(s) vinculado(s). '
                           'Reatribua-os antes de excluir.', 'usuarios_vinculados': vinculados},
                status=status.HTTP_409_CONFLICT)
        codename = cargo.codename
        cargo.delete()
        cache.delete(CARGO_CHOICES_CACHE_KEY)
        return Response({'detail': f'Cargo "{codename}" excluído.'}, status=status.HTTP_200_OK)


class SetorViewSet(viewsets.ModelViewSet):
    """Catálogo de setores. Mesmo padrão do CargoViewSet."""
    queryset = SetorCatalogo.objects.all()
    serializer_class = SetorCatalogoSerializer
    http_method_names = ['get', 'post', 'patch', 'delete', 'head', 'options']

    def get_permissions(self):
        if self.action in ('create', 'update', 'partial_update', 'destroy', 'atribuir_dados'):
            return [IsAdminOrSupervisor()]
        return [IsAuthenticated()]

    @action(detail=True, methods=['post'], url_path='atribuir-dados')
    def atribuir_dados(self, request, pk=None):
        """Associa sprints/projetos a este setor. Body:
        {sprint_ids?: [int], project_ids?: [int], todos?: bool}. Transacional.

        A hierarquia é respeitada: mover uma SPRINT move também os projetos e
        cards dela (a sprint é a autoridade de setor); mover um PROJETO
        espelha nos cards dele. Não existe `card_ids`: Card.setor é espelho do
        projeto e não é atribuível direto (evita card de setor X em projeto de
        setor Y). `todos` só captura registros órfãos (setor nulo) — após o
        backfill inicial é um no-op, por segurança."""
        setor = self.get_object()
        from apps.projects.models import Sprint, Project, Card
        data = request.data
        sprint_ids = data.get('sprint_ids')
        project_ids = data.get('project_ids')
        todos = bool(data.get('todos'))
        if not todos and not sprint_ids and not project_ids:
            return Response(
                {'detail': 'Informe sprint_ids, project_ids ou todos=true.'},
                status=status.HTTP_400_BAD_REQUEST)
        for nome, val in (('sprint_ids', sprint_ids), ('project_ids', project_ids)):
            if val is not None and not isinstance(val, list):
                return Response({nome: ['Deve ser uma lista de IDs.']}, status=status.HTTP_400_BAD_REQUEST)
        result = {}
        with transaction.atomic():
            if todos:
                result['sprints'] = Sprint.objects.filter(setor__isnull=True).update(setor=setor)
                result['projetos'] = Project.objects.filter(setor__isnull=True).update(setor=setor)
                result['cards'] = Card.objects.filter(setor__isnull=True).update(setor=setor)
            else:
                if sprint_ids:
                    result['sprints'] = Sprint.objects.filter(id__in=sprint_ids).update(setor=setor)
                    # propaga em árvore: projetos e cards seguem a sprint
                    result['projetos'] = Project.objects.filter(sprint_id__in=sprint_ids).update(setor=setor)
                    result['cards'] = Card.objects.filter(projeto__sprint_id__in=sprint_ids).update(setor=setor)
                if project_ids:
                    result['projetos'] = result.get('projetos', 0) + Project.objects.filter(
                        id__in=project_ids).update(setor=setor)
                    # espelha nos cards desses projetos
                    result['cards'] = result.get('cards', 0) + Card.objects.filter(
                        projeto_id__in=project_ids).update(setor=setor)
        return Response({'setor': setor.codename, 'atribuidos': result})

    def destroy(self, request, *args, **kwargs):
        setor = self.get_object()
        if setor.is_system:
            return Response({'detail': 'Setores de sistema não podem ser excluídos.'},
                            status=status.HTTP_403_FORBIDDEN)
        # Vínculos por CharField primário OU M2M UserSetor (autoridade do scoping).
        vinculados = User.objects.filter(
            Q(setor=setor.codename) | Q(setores=setor)).distinct().count()
        if vinculados:
            return Response(
                {'detail': f'Este setor tem {vinculados} usuário(s) vinculado(s). '
                           'Reatribua-os antes de excluir.', 'usuarios_vinculados': vinculados},
                status=status.HTTP_409_CONFLICT)
        # Dados vinculados (sprints/projetos) — checado só quando o campo existir (Fase 4+).
        try:
            from apps.projects.models import Sprint, Project
            if Sprint.objects.filter(setor=setor).exists() or Project.objects.filter(setor=setor).exists():
                return Response({'detail': 'Este setor tem sprints/projetos vinculados.'},
                                status=status.HTTP_409_CONFLICT)
        except Exception:
            pass  # campo setor ainda não existe nesses models
        codename = setor.codename
        setor.delete()
        cache.delete(SETOR_CHOICES_CACHE_KEY)
        return Response({'detail': f'Setor "{codename}" excluído.'}, status=status.HTTP_200_OK)


class RegisterView(APIView):
    """Criação de conta: login, senha, e-mail; foto opcional. Novo usuário vem como visitante (zero permissões)."""
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

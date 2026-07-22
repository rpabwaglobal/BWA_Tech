import re
import secrets
import string
import unicodedata

from django.core.cache import cache
from django.utils.text import slugify
from rest_framework import serializers
from .models import (
    User, Role, Cargo, SetorCatalogo,
    CARGO_CHOICES_CACHE_KEY, SETOR_CHOICES_CACHE_KEY,
)
from .permission_catalog import PERMISSION_CATALOG
from .profile_picture_utils import get_profile_picture_url
from .image_processing import process_profile_picture


class UserSerializer(serializers.ModelSerializer):
    role_display = serializers.CharField(source='get_role_display', read_only=True)
    setor_display = serializers.CharField(source='get_setor_display', read_only=True)
    profile_picture_url = serializers.SerializerMethodField(read_only=True)
    permissions = serializers.SerializerMethodField(read_only=True)

    def get_profile_picture_url(self, obj):
        return get_profile_picture_url(obj, request=self.context.get('request'))

    def get_permissions(self, obj):
        """Permissões só são visíveis para admin/supervisor (que as gerenciam)
        e para o PRÓPRIO usuário (o frontend monta Sidebar/rotas com elas).
        Para os demais, lista vazia — usuário comum não enxerga as permissões
        dos colegas."""
        request = self.context.get('request')
        viewer = getattr(request, 'user', None)
        pode_ver = viewer is not None and (
            getattr(viewer, 'is_superuser', False)
            or getattr(viewer, 'role', '') in (Role.ADMIN, Role.SUPERVISOR)
            or viewer.pk == obj.pk
        )
        if not pode_ver:
            return []
        return list(
            obj.user_permissions.filter(content_type__app_label='accounts')
            .values_list('codename', flat=True)
        )

    def validate_setor(self, value):
        """Só admin/supervisor podem alterar o setor de um usuário, e nunca o
        próprio (setor é atribuído por quem gerencia, não autoatribuído).
        O valor precisa existir no catálogo (SetorCatalogo) — vazio é
        permitido (= sem setor definido)."""
        request = self.context.get('request')
        if not request:
            return value
        if request.user.role not in ('admin', 'supervisor'):
            raise serializers.ValidationError(
                'Apenas administradores e supervisores podem alterar o setor.'
            )
        if self.instance and self.instance.pk == request.user.pk:
            raise serializers.ValidationError('Você não pode alterar o próprio setor.')
        if value and not SetorCatalogo.objects.filter(codename=value).exists():
            raise serializers.ValidationError('Setor inválido.')
        return value

    def validate_role(self, value):
        """
        Validação: Apenas Admin pode definir Supervisor.
        Admin e Supervisor podem definir qualquer outro cargo do catálogo
        (de sistema ou criado por eles), desde que exista em `Cargo`.
        """
        request = self.context.get('request')
        if not request:
            return value

        user = request.user
        current_role = self.instance.role if self.instance else None

        if not Cargo.objects.filter(codename=value).exists():
            raise serializers.ValidationError('Cargo inválido.')

        # Se está tentando definir como supervisor
        if value == Role.SUPERVISOR:
            if user.role != Role.ADMIN:
                raise serializers.ValidationError(
                    'Apenas administradores podem definir usuários como supervisores.'
                )

        # Se está tentando alterar de supervisor para outro cargo
        if current_role == Role.SUPERVISOR and value != Role.SUPERVISOR:
            if user.role != Role.ADMIN:
                raise serializers.ValidationError(
                    'Apenas administradores podem alterar o cargo de supervisores.'
                )

        # Qualquer outro cargo (de sistema ou customizado) — admin/supervisor podem definir
        if value != Role.SUPERVISOR:
            if user.role not in (Role.ADMIN, Role.SUPERVISOR):
                raise serializers.ValidationError(
                    'Apenas administradores e supervisores podem alterar cargos.'
                )

        return value

    class Meta:
        model = User
        fields = [
            'id', 'username', 'email', 'first_name', 'last_name',
            'role', 'role_display', 'setor', 'setor_display',
            'is_active', 'permissions', 'profile_picture_url', 'date_joined',
        ]
        # is_active só é editável via o endpoint dedicado /set-active/ (que
        # também revoga tokens) — mantido read_only aqui pra não permitir
        # burlar essa revogação e a checagem de alvo admin via PATCH genérico.
        read_only_fields = ['id', 'date_joined', 'is_active']


def _unique_codename(model, nome: str) -> str:
    """Gera um codename slug único (`novos_negocios`) a partir do nome
    digitado, com sufixo numérico em caso de colisão."""
    base = slugify(nome, allow_unicode=False).replace('-', '_')[:40] or 'item'
    codename = base
    n = 2
    while model.objects.filter(codename=codename).exists():
        suffix = f'_{n}'
        codename = f'{base[: 40 - len(suffix)]}{suffix}'
        n += 1
    return codename


_HEX_RE = re.compile(r'^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$')


def _validate_hex(value):
    value = (value or '').strip()
    if value and not _HEX_RE.match(value):
        raise serializers.ValidationError('Cor deve ser um hex válido (ex.: #3b82f6).')
    return value


class CargoSerializer(serializers.ModelSerializer):
    user_count = serializers.SerializerMethodField(read_only=True)

    class Meta:
        model = Cargo
        fields = ['id', 'codename', 'nome', 'is_system', 'cor', 'label_curto',
                  'descricao', 'permissoes_padrao', 'user_count']
        read_only_fields = ['id', 'codename', 'is_system', 'user_count']

    def get_user_count(self, obj):
        return User.objects.filter(role=obj.codename).count()

    def validate_nome(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError('Nome é obrigatório.')
        qs = Cargo.objects.filter(nome__iexact=value)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError('Já existe um cargo com esse nome.')
        return value

    def validate_cor(self, value):
        return _validate_hex(value)

    def validate_permissoes_padrao(self, value):
        if not isinstance(value, list) or not all(isinstance(x, str) for x in value):
            raise serializers.ValidationError('permissoes_padrao deve ser uma lista de codenames.')
        invalid = sorted(set(value) - {c for c, _l, _a in PERMISSION_CATALOG})
        if invalid:
            raise serializers.ValidationError(f'Codenames inválidos: {", ".join(invalid)}')
        return value

    def create(self, validated_data):
        codename = _unique_codename(Cargo, validated_data['nome'])
        validated_data['codename'] = codename
        validated_data['is_system'] = False
        cargo = Cargo.objects.create(**validated_data)
        cache.delete(CARGO_CHOICES_CACHE_KEY)
        return cargo

    def update(self, instance, validated_data):
        # codename e is_system nunca mudam (já read_only); cor/label de sistema podem mudar.
        for attr, val in validated_data.items():
            setattr(instance, attr, val)
        instance.save()
        cache.delete(CARGO_CHOICES_CACHE_KEY)
        return instance


class SetorCatalogoSerializer(serializers.ModelSerializer):
    user_count = serializers.SerializerMethodField(read_only=True)

    class Meta:
        model = SetorCatalogo
        fields = ['id', 'codename', 'nome', 'is_system', 'cor', 'label_curto',
                  'descricao', 'user_count']
        read_only_fields = ['id', 'codename', 'is_system', 'user_count']

    def get_user_count(self, obj):
        return User.objects.filter(setor=obj.codename).count()

    def validate_nome(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError('Nome é obrigatório.')
        qs = SetorCatalogo.objects.filter(nome__iexact=value)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError('Já existe um setor com esse nome.')
        return value

    def validate_cor(self, value):
        return _validate_hex(value)

    def create(self, validated_data):
        codename = _unique_codename(SetorCatalogo, validated_data['nome'])
        validated_data['codename'] = codename
        validated_data['is_system'] = False
        setor = SetorCatalogo.objects.create(**validated_data)
        cache.delete(SETOR_CHOICES_CACHE_KEY)
        return setor

    def update(self, instance, validated_data):
        for attr, val in validated_data.items():
            setattr(instance, attr, val)
        instance.save()
        cache.delete(SETOR_CHOICES_CACHE_KEY)
        return instance


def _generate_recovery_code() -> str:
    """Gera código `XXXX-XXXX-XXXX` único no DB.

    Retenta caso ocorra colisão (estatisticamente improvável com 36^12 ≈ 4.7e18
    combinações, mas a unicidade é garantida explicitamente). Limite de 20
    tentativas: se chegasse lá teríamos um problema sistêmico, não aleatório.
    """
    alphabet = string.ascii_uppercase + string.digits
    for _ in range(20):
        raw = ''.join(secrets.choice(alphabet) for _ in range(12))
        code = f"{raw[0:4]}-{raw[4:8]}-{raw[8:12]}"
        if not User.objects.filter(recovery_code=code).exists():
            return code
    raise RuntimeError(
        'Não foi possível gerar um recovery_code único após 20 tentativas. '
        'Verifique pressão por colisão no DB.'
    )


def _validate_password_strength(value):
    """Mínimo 8 caracteres, letra maiúscula, minúscula e pelo menos um caractere especial."""
    if len(value) < 8:
        raise serializers.ValidationError('A senha deve ter no mínimo 8 caracteres.')
    if not any(c.isupper() for c in value):
        raise serializers.ValidationError('A senha deve conter pelo menos uma letra maiúscula.')
    if not any(c.islower() for c in value):
        raise serializers.ValidationError('A senha deve conter pelo menos uma letra minúscula.')
    if not any(c in '!@#$%^&*()_+-=[]{}|;:,.<>?' for c in value):
        raise serializers.ValidationError('A senha deve conter pelo menos um caractere especial.')


class RegisterSerializer(serializers.Serializer):
    """Criação de conta: nome, login, e-mail @bwa.global, senha forte; foto opcional. Novo usuário vem como visitante (zero permissões)."""
    first_name = serializers.CharField(max_length=150)
    username = serializers.CharField(max_length=150)
    email = serializers.EmailField()
    password = serializers.CharField(write_only=True)
    profile_picture = serializers.ImageField(required=False, allow_null=True)

    def validate_username(self, value):
        if User.objects.filter(username=value).exists():
            raise serializers.ValidationError('Este nome de usuário já está em uso.')
        return value

    def validate_email(self, value):
        # NFKC normaliza variantes Unicode (ƅ → b, etc) e remove confusáveis. strip() remove espaços.
        # Rejeita null-byte (alguns parsers C truncam aí, permitindo bypass).
        if '\x00' in value:
            raise serializers.ValidationError('E-mail inválido.')
        value = unicodedata.normalize('NFKC', value).strip().lower()
        try:
            local, domain = value.rsplit('@', 1)
        except ValueError:
            raise serializers.ValidationError('E-mail inválido.')
        if domain != 'bwa.global':
            raise serializers.ValidationError('O e-mail deve ser do domínio @bwa.global.')
        if not local:
            raise serializers.ValidationError('E-mail inválido.')
        # Enumeration mitigation: mensagem genérica (mesma string usada em outras falhas).
        if User.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError('Não foi possível concluir o cadastro.')
        return value

    def validate_password(self, value):
        _validate_password_strength(value)
        return value

    def create(self, validated_data):
        profile_picture = validated_data.pop('profile_picture', None)
        recovery_code = _generate_recovery_code()
        user = User.objects.create_user(
            username=validated_data['username'],
            email=validated_data['email'],
            password=validated_data['password'],
            first_name=validated_data.get('first_name', '').strip() or '',
            role=Role.VISITANTE,
            recovery_code=recovery_code,
        )
        if profile_picture:
            processed = process_profile_picture(profile_picture)
            if processed is not None:
                user.profile_picture.save(processed.name, processed, save=False)
            else:
                user.profile_picture = profile_picture
            user.save(update_fields=['profile_picture'])
        return user


class LoginSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField(write_only=True)

    def validate(self, attrs):
        email = (attrs.get('email') or '').strip().lower()
        password = attrs.get('password')

        if email and password:
            user = User.objects.filter(email__iexact=email).first()
            if not (user and user.check_password(password)):
                raise serializers.ValidationError('Credenciais inválidas.')
            if not user.is_active:
                raise serializers.ValidationError('Usuário desativado.')
            attrs['user'] = user
        else:
            raise serializers.ValidationError('E-mail e senha são obrigatórios.')
        return attrs


class ChangePasswordSerializer(serializers.Serializer):
    current_password = serializers.CharField(write_only=True)
    new_password = serializers.CharField(write_only=True, min_length=8)

    def validate_current_password(self, value):
        request = self.context.get('request')
        if not request or not request.user.check_password(value):
            raise serializers.ValidationError('Senha atual incorreta.')
        return value


class RecoverAccountSerializer(serializers.Serializer):
    recovery_code = serializers.CharField(max_length=14)
    new_password = serializers.CharField(write_only=True)
    confirm_password = serializers.CharField(write_only=True)

    def validate_new_password(self, value):
        _validate_password_strength(value)
        return value

    def validate(self, attrs):
        if attrs.get('new_password') != attrs.get('confirm_password'):
            raise serializers.ValidationError('As senhas não coincidem.')
        code = attrs.get('recovery_code', '').strip().upper()
        user = User.objects.filter(recovery_code=code).first()
        # Mensagem unificada para evitar enumeration via timing/distinção
        invalid_msg = 'Código de recuperação inválido.'
        if not user:
            raise serializers.ValidationError(invalid_msg)
        if not user.is_active:
            raise serializers.ValidationError(invalid_msg)
        attrs['user'] = user
        return attrs

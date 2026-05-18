import secrets
import string
import unicodedata

from rest_framework import serializers
from .models import User, Role
from .profile_picture_utils import get_profile_picture_url


class UserSerializer(serializers.ModelSerializer):
    role_display = serializers.CharField(source='get_role_display', read_only=True)
    profile_picture_url = serializers.SerializerMethodField(read_only=True)

    def get_profile_picture_url(self, obj):
        return get_profile_picture_url(obj, request=self.context.get('request'))

    def validate_role(self, value):
        """
        Validação: Apenas Admin pode definir Supervisor.
        Admin e Supervisor podem definir Gerente e Desenvolvedor.
        """
        request = self.context.get('request')
        if not request:
            return value
        
        user = request.user
        current_role = self.instance.role if self.instance else None
        
        # Se está tentando definir como supervisor
        if value == 'supervisor':
            if user.role != 'admin':
                raise serializers.ValidationError(
                    'Apenas administradores podem definir usuários como supervisores.'
                )
        
        # Se está tentando alterar de supervisor para outro cargo
        if current_role == 'supervisor' and value != 'supervisor':
            if user.role != 'admin':
                raise serializers.ValidationError(
                    'Apenas administradores podem alterar o cargo de supervisores.'
                )
        
        # Admin e Supervisor podem alterar para gerente, desenvolvedor, dados ou processos
        if value in ['gerente', 'desenvolvedor', 'dados', 'processos']:
            if user.role not in ['admin', 'supervisor']:
                raise serializers.ValidationError(
                    'Apenas administradores e supervisores podem alterar cargos.'
                )
        
        return value

    class Meta:
        model = User
        fields = ['id', 'username', 'email', 'first_name', 'last_name', 'role', 'role_display', 'profile_picture_url', 'date_joined']
        read_only_fields = ['id', 'date_joined']


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
    """Criação de conta: nome, login, e-mail @bwa.global, senha forte; foto opcional. Novo usuário vem como desenvolvedor."""
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
            role=Role.DESENVOLVEDOR,
            recovery_code=recovery_code,
        )
        if profile_picture:
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

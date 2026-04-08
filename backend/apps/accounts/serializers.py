from rest_framework import serializers
from django.contrib.auth import authenticate
from .models import User, Role


class UserSerializer(serializers.ModelSerializer):
    role_display = serializers.CharField(source='get_role_display', read_only=True)
    profile_picture_url = serializers.SerializerMethodField(read_only=True)

    def get_profile_picture_url(self, obj):
        if not obj.profile_picture:
            return None
        url = obj.profile_picture.url
        path = url if url.startswith('/') else '/' + url
        request = self.context.get('request')
        if request:
            return request.build_absolute_uri(path)
        return path

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
        value = value.strip().lower()
        if not value.endswith('@bwa.global'):
            raise serializers.ValidationError('O e-mail deve ser do domínio @bwa.global.')
        if User.objects.filter(email=value).exists():
            raise serializers.ValidationError('Este e-mail já está cadastrado.')
        return value

    def validate_password(self, value):
        _validate_password_strength(value)
        return value

    def create(self, validated_data):
        profile_picture = validated_data.pop('profile_picture', None)
        user = User.objects.create_user(
            username=validated_data['username'],
            email=validated_data['email'],
            password=validated_data['password'],
            first_name=validated_data.get('first_name', '').strip() or '',
            role=Role.DESENVOLVEDOR,
        )
        if profile_picture:
            user.profile_picture = profile_picture
            user.save(update_fields=['profile_picture'])
        return user


class LoginSerializer(serializers.Serializer):
    username = serializers.CharField()
    password = serializers.CharField(write_only=True)

    def validate(self, attrs):
        username = (attrs.get('username') or '').strip()
        password = attrs.get('password')

        if username and password:
            user = authenticate(username=username, password=password)
            # Django autentica pelo username exatamente como está no banco; tentativa extra sem
            # diferenciar maiúsculas (ex.: italo.martins vs Italo.Martins).
            if not user:
                cand = User.objects.filter(username__iexact=username).first()
                if cand and cand.check_password(password):
                    user = cand
            if not user:
                raise serializers.ValidationError('Credenciais inválidas.')
            if not user.is_active:
                raise serializers.ValidationError('Usuário desativado.')
            attrs['user'] = user
        else:
            raise serializers.ValidationError('Username e senha são obrigatórios.')
        return attrs


class ChangePasswordSerializer(serializers.Serializer):
    current_password = serializers.CharField(write_only=True)
    new_password = serializers.CharField(write_only=True, min_length=8)

    def validate_current_password(self, value):
        request = self.context.get('request')
        if not request or not request.user.check_password(value):
            raise serializers.ValidationError('Senha atual incorreta.')
        return value

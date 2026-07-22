from django.contrib.auth.models import AbstractUser
from django.core.cache import cache
from django.db import models
from django.db.utils import DatabaseError

from .permission_catalog import PermissaoPlataforma  # noqa: F401 — registra Meta.permissions


class Role(models.TextChoices):
    """Códigos de cargo com regras de negócio hard-coded (promoção a supervisor,
    is_superuser -> admin, etc.). Cargos 'de sistema' (is_system=True) são hoje
    só 3: admin, supervisor, visitante. As constantes GERENTE/DESENVOLVEDOR/
    DADOS/PROCESSOS são mantidas porque ainda existem como cargos criados
    (is_system=False) e são referenciadas pelo command de migração de legados e
    por limit_choices_to. Cargos criados pelo admin/supervisor viram apenas
    linhas em `Cargo`, sem regras especiais — ver `validate_role`."""
    ADMIN = 'admin', 'Administrador BWA Tech'
    SUPERVISOR = 'supervisor', 'Supervisor'
    VISITANTE = 'visitante', 'Visitante'
    GERENTE = 'gerente', 'Gerente de Projetos'
    DESENVOLVEDOR = 'desenvolvedor', 'Desenvolvedor'
    DADOS = 'dados', 'Dados'
    PROCESSOS = 'processos', 'Processos'


# TTL curto: cargos/setores mudam raramente (ação manual de admin/supervisor),
# então cache agressivo é seguro; invalidado explicitamente ao criar um novo
# (ver serializers.py) para refletir na hora no processo que criou.
_CHOICES_CACHE_TTL = 60
CARGO_CHOICES_CACHE_KEY = 'accounts:cargo_choices'
SETOR_CHOICES_CACHE_KEY = 'accounts:setor_choices'


def get_cargo_choices():
    """Choices dinâmicas de `User.role`, lidas da tabela `Cargo`. Django 5+
    aceita `choices` como callable e o reavalia a cada `get_role_display()` —
    por isso o cache aqui: sem ele, cada chamada vira uma query."""
    choices = cache.get(CARGO_CHOICES_CACHE_KEY)
    if choices is None:
        try:
            choices = [(c.codename, c.nome) for c in Cargo.objects.all()]
        except DatabaseError:
            # Tabela ainda não existe (bootstrapping: manage.py check/
            # makemigrations rodam antes de a migration desta tabela ser
            # aplicada) — não quebra, só não há nada pra listar ainda.
            return []
        cache.set(CARGO_CHOICES_CACHE_KEY, choices, _CHOICES_CACHE_TTL)
    return choices


def get_setor_choices():
    """Choices dinâmicas de `User.setor`, lidas da tabela `SetorCatalogo`."""
    choices = cache.get(SETOR_CHOICES_CACHE_KEY)
    if choices is None:
        try:
            choices = [('', '—')] + [(s.codename, s.nome) for s in SetorCatalogo.objects.all()]
        except DatabaseError:
            return []
        cache.set(SETOR_CHOICES_CACHE_KEY, choices, _CHOICES_CACHE_TTL)
    return choices


class Cargo(models.Model):
    """Catálogo de cargos atribuíveis a um usuário. Os 3 'de sistema'
    (admin, supervisor, visitante) vêm semeados com is_system=True e são
    protegidos (não editam codename nem excluem); admin/supervisor podem criar
    novos cargos (is_system=False) e editar cor/rótulo.

    `permissoes_padrao` é um TEMPLATE de conveniência (lista de codenames de
    permissão): NUNCA re-propaga sozinho — só é aplicado quando o operador
    marca 'aplicar permissões-padrão' numa atribuição. A autoridade das
    permissões continua 100% em `user_permissions` por usuário."""
    codename = models.SlugField(max_length=40, unique=True)
    nome = models.CharField(max_length=60)
    is_system = models.BooleanField(default=False)
    cor = models.CharField(max_length=7, default='#94a3b8')  # hex; slate-400 = cinza default
    label_curto = models.CharField(max_length=16, blank=True)  # badges compactos; front trunca o nome se vazio
    descricao = models.CharField(max_length=255, blank=True)
    permissoes_padrao = models.JSONField(default=list, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['nome']
        verbose_name = 'Cargo'
        verbose_name_plural = 'Cargos'

    def __str__(self):
        return self.nome

    def delete(self, *args, **kwargs):
        """Defesa em profundidade: cargos de sistema nunca são excluíveis
        (protege shell/admin, não só a API)."""
        if self.is_system:
            from django.core.exceptions import ValidationError
            raise ValidationError('Cargos de sistema não podem ser excluídos.')
        return super().delete(*args, **kwargs)


class SetorCatalogo(models.Model):
    """Catálogo de setores/departamentos. Distinto de `SetorSolicitante`
    (apps/projects/models.py), que é o setor do solicitante de um Score de
    card — conceito não relacionado. Cor/rótulo definidos na criação/edição."""
    codename = models.SlugField(max_length=40, unique=True)
    nome = models.CharField(max_length=60)
    is_system = models.BooleanField(default=False)
    cor = models.CharField(max_length=7, default='#94a3b8')
    label_curto = models.CharField(max_length=16, blank=True)
    descricao = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['nome']
        verbose_name = 'Setor'
        verbose_name_plural = 'Setores'

    def __str__(self):
        return self.nome

    def delete(self, *args, **kwargs):
        if self.is_system:
            from django.core.exceptions import ValidationError
            raise ValidationError('Setores de sistema não podem ser excluídos.')
        return super().delete(*args, **kwargs)


class BulkOperationAudit(models.Model):
    """Registro de uma operação em massa (atribuir cargo/setor/permissões),
    guardando o estado ANTERIOR de cada usuário afetado para permitir reversão.
    `snapshot` = {str(user_id): {campo: valor_anterior}}."""
    TIPO_CHOICES = [
        ('cargo', 'Cargo'),
        ('setor', 'Setor'),
        ('permissions', 'Permissões'),
    ]
    operador = models.ForeignKey('accounts.User', on_delete=models.SET_NULL, null=True, related_name='+')
    tipo = models.CharField(max_length=20, choices=TIPO_CHOICES)
    descricao = models.CharField(max_length=255, blank=True)
    snapshot = models.JSONField(default=dict)
    revertido = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']


class User(AbstractUser):
    role = models.CharField(
        max_length=40,
        choices=get_cargo_choices,
        default=Role.VISITANTE,
        verbose_name='Função'
    )
    # `setor` (CharField) = setor PRIMÁRIO (exibição/compatibilidade). A
    # autoridade do escopo é o M2M `setores` (via UserSetor). Mantidos em
    # sincronia enquanto houver código legado usando o CharField.
    setor = models.CharField(
        max_length=40,
        choices=get_setor_choices,
        null=True,
        blank=True,
        default='',
        verbose_name='Setor'
    )
    setores = models.ManyToManyField(
        'accounts.SetorCatalogo', through='accounts.UserSetor',
        through_fields=('user', 'setor'),
        related_name='usuarios', blank=True, verbose_name='Setores')
    profile_picture = models.ImageField(
        upload_to='profiles/',
        null=True,
        blank=True,
        verbose_name='Foto de perfil'
    )
    recovery_code = models.CharField(
        max_length=14,
        unique=True,
        null=True,
        blank=True,
        verbose_name='Código de recuperação'
    )
    created_at = models.DateTimeField(auto_now_add=True, verbose_name='Data de Criação')
    updated_at = models.DateTimeField(auto_now=True, verbose_name='Data de Atualização')

    class Meta:
        verbose_name = 'Usuário'
        verbose_name_plural = 'Usuários'
        ordering = ['username']

    def save(self, *args, **kwargs):
        """Superusuários (ex.: italoadmin) devem ter role=Admin na plataforma."""
        if self.is_superuser:
            self.role = Role.ADMIN
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.username} ({self.get_role_display()})"

    @property
    def is_admin(self):
        return self.role == Role.ADMIN

    @property
    def is_supervisor(self):
        return self.role == Role.SUPERVISOR

    # NB: as properties is_gerente/is_desenvolvedor/is_dados/is_processos foram
    # removidas na Fase 6 — cargos legados agora são criados (is_system=False) e
    # a autorização é 100% por has_perm, não por role. Use has_perm(...) ou o
    # catálogo Cargo em vez de comparar role.


class UserSetor(models.Model):
    """Vínculo N:N usuário↔setor (o eixo de segmentação). `is_primary` marca o
    setor principal, espelhado no `User.setor` CharField para compatibilidade."""
    user = models.ForeignKey('accounts.User', on_delete=models.CASCADE, related_name='setor_links')
    setor = models.ForeignKey('accounts.SetorCatalogo', on_delete=models.CASCADE, related_name='user_links')
    is_primary = models.BooleanField(default=False)
    added_by = models.ForeignKey('accounts.User', on_delete=models.SET_NULL, null=True, blank=True, related_name='+')
    added_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [('user', 'setor')]
        verbose_name = 'Vínculo usuário-setor'
        verbose_name_plural = 'Vínculos usuário-setor'

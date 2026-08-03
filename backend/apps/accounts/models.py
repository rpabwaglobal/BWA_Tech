from django.contrib.auth.models import AbstractUser
from django.core.cache import cache
from django.db import models
from django.db.utils import DatabaseError

from .permission_catalog import PermissaoPlataforma  # noqa: F401 — registra Meta.permissions


class Role(models.TextChoices):
    """Os dois únicos cargos com significado para o código.

    `ADMIN` porque `User.save()` força esse cargo em superusers e o backend de
    autenticação lhe concede o catálogo inteiro; `VISITANTE` porque é o cargo
    de entrada e `NaoVisitanteEscreve` o usa como rede de segurança.

    Todo o resto do organograma — Supervisor, Gerente, CEO, o que a empresa
    precisar — é criado pelo admin na tela de Setores e Cargos e vira apenas
    uma linha em `Cargo`, sem regra especial no código. Autorização é sempre
    por permissão (`has_perm`), nunca por comparação de cargo."""
    ADMIN = 'admin', 'Administrador BWA Tech'
    VISITANTE = 'visitante', 'Visitante'


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

    `permissoes_padrao` (lista de codenames do PERMISSION_CATALOG) é FONTE DE
    AUTORIDADE, não um template de conveniência: `CargoPermissionBackend`
    (accounts/auth_backends.py) resolve essas permissões a cada `has_perm`, de
    modo que quem tem o cargo já as tem, sem nada ser copiado para
    `user_permissions`.

    Duas consequências que importam:
      - o acesso efetivo de um usuário é a UNIÃO desta lista com as permissões
        personalizadas dele (`user_permissions`). Uma nunca sobrescreve a outra,
        e a ordem em que foram concedidas é irrelevante;
      - editar esta lista muda o acesso de TODO MUNDO que tem o cargo, na hora.
        Por isso o `CargoViewSet` avisa esses usuários em tempo real
        (accounts/realtime.py) e aplica a trava anti-escalonamento: ninguém põe
        aqui permissão que não possui.

    A caixinha 'aplicar permissões-padrão' das atribuições continua existindo e
    copia esta lista para `user_permissions` — mas hoje é só um atalho para dar
    a alguém, de forma avulsa, as permissões que o cargo já daria."""
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

    def delete(self, *args, **kwargs):
        """Conta não é apagada — é desativada.

        Toda a plataforma pendura histórico no usuário: sprints, projetos,
        cards, logs, anexos, score. Apagar a linha levaria isso junto, e o
        trabalho de uma pessoa que saiu continua sendo o acervo da empresa.
        Desativar barra o login e revoga as sessões, preservando a autoria.

        Sobrescrito no model (e não só na API) porque o `delete()` também é
        alcançável pelo admin do Django e pelo shell — o offboarding tem que
        ser o mesmo caminho independentemente de por onde se chega.
        """
        from rest_framework.authtoken.models import Token

        self.is_active = False
        self.save(update_fields=['is_active', 'updated_at'])
        Token.objects.filter(user=self).delete()

    @property
    def is_admin(self):
        return self.role == Role.ADMIN

    # NB: não existem properties is_supervisor/is_gerente/is_desenvolvedor —
    # esses cargos são criados pelo admin e não têm significado para o código.
    # A autorização é 100% por has_perm, não por role. Use has_perm(...) ou o
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


class NivelCompartilhamento(models.TextChoices):
    """O que o setor convidado pode fazer com o item emprestado.

    A distinção é o motivo de o compartilhamento ter tabela própria em vez de
    M2M automático: emprestar para consulta e emprestar para trabalho são
    coisas diferentes, e sem o nível o dono não teria como escolher.
    """
    LEITURA = 'leitura', 'Somente visualizar'
    EDICAO = 'edicao', 'Visualizar e editar'


class CompartilhamentoSetorBase(models.Model):
    """Base dos vínculos "o setor X enxerga este item, neste nível".

    Abstrata porque cada tipo de conteúdo tem a sua tabela: FK de verdade
    (indexada, com CASCADE) vale mais que uma tabela genérica com id solto.

    O nível governa apenas o que o COMPARTILHAMENTO concede. Ele não amplia as
    permissões do cargo: quem não pode editar sprint no próprio setor também
    não passa a poder por causa de um empréstimo em nível de edição.
    """
    setor = models.ForeignKey(
        'accounts.SetorCatalogo', on_delete=models.CASCADE, related_name='+',
        verbose_name='Setor convidado')
    nivel = models.CharField(
        max_length=10, choices=NivelCompartilhamento.choices,
        default=NivelCompartilhamento.LEITURA, verbose_name='Nível de acesso')
    compartilhado_em = models.DateTimeField(auto_now_add=True)
    compartilhado_por = models.ForeignKey(
        'accounts.User', on_delete=models.SET_NULL, null=True, blank=True,
        related_name='+', verbose_name='Quem compartilhou')

    class Meta:
        abstract = True

    def __str__(self):
        return f'{self.setor_id} ({self.get_nivel_display()})'

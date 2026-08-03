from django.db import models
from django.conf import settings


class TeamType(models.TextChoices):
    PORTAL = 'portal', 'Portal'
    RPA = 'rpa', 'RPA'
    IA = 'ia', 'IA'
    DADOS = 'dados', 'Dados'
    PROCESSOS = 'processos', 'Processos'
    FRONT = 'front', 'Frontend'
    BACK = 'back', 'Backend'


class Team(models.Model):
    nome = models.CharField(max_length=100, verbose_name='Nome da Equipe')
    tipo = models.CharField(
        max_length=20,
        choices=TeamType.choices,
        default=TeamType.PORTAL,
        verbose_name='Tipo'
    )
    # Qualquer usuário pode responder pela equipe: quem pode designá-lo é decidido por permissão, não pelo cargo
    supervisor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='teams_supervised',
        verbose_name='Supervisor'
    )
    # Campos para sticky note
    cor = models.CharField(
        max_length=20,
        default='yellow',
        verbose_name='Cor da Nota'
    )
    posicao_x = models.FloatField(default=0, verbose_name='Posição X')
    posicao_y = models.FloatField(default=0, verbose_name='Posição Y')
    largura = models.FloatField(default=200, verbose_name='Largura')
    altura = models.FloatField(default=150, verbose_name='Altura')
    ordem = models.IntegerField(default=0, verbose_name='Ordem (camada no canvas)')
    created_at = models.DateTimeField(auto_now_add=True, verbose_name='Data de Criação')
    updated_at = models.DateTimeField(auto_now=True, verbose_name='Data de Atualização')

    class Meta:
        verbose_name = 'Equipe'
        verbose_name_plural = 'Equipes'
        ordering = ['nome']

    def __str__(self):
        return f"{self.nome} ({self.get_tipo_display()})"


class TeamMemberRole(models.TextChoices):
    GERENTE = 'gerente', 'Gerente'
    DESENVOLVEDOR = 'desenvolvedor', 'Desenvolvedor'


class TeamMember(models.Model):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='team_memberships',
        verbose_name='Usuário'
    )
    team = models.ForeignKey(
        Team,
        on_delete=models.CASCADE,
        related_name='members',
        verbose_name='Equipe'
    )
    role = models.CharField(
        max_length=20,
        choices=TeamMemberRole.choices,
        default=TeamMemberRole.DESENVOLVEDOR,
        verbose_name='Função na Equipe'
    )
    created_at = models.DateTimeField(auto_now_add=True, verbose_name='Data de Entrada')

    class Meta:
        verbose_name = 'Membro da Equipe'
        verbose_name_plural = 'Membros das Equipes'
        unique_together = ['user', 'team']
        ordering = ['team', 'role', 'user']

    def __str__(self):
        return f"{self.user.username} - {self.team.nome} ({self.get_role_display()})"


class Hierarchy(models.Model):
    """Representa a hierarquia Supervisor → Gerente → Desenvolvedor"""
    # A posição na hierarquia é montada livremente pelo admin; quem pode montá-la é
    # decidido por permissão, não pelo cargo de cada usuário
    supervisor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='supervised_hierarchies',
        verbose_name='Supervisor'
    )
    gerente = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='managed_hierarchies',
        verbose_name='Gerente',
        null=True,
        blank=True
    )
    desenvolvedor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='developer_hierarchies',
        verbose_name='Desenvolvedor',
        null=True,
        blank=True
    )
    created_at = models.DateTimeField(auto_now_add=True, verbose_name='Data de Criação')

    class Meta:
        verbose_name = 'Hierarquia'
        verbose_name_plural = 'Hierarquias'
        unique_together = ['supervisor', 'gerente', 'desenvolvedor']
        ordering = ['supervisor', 'gerente', 'desenvolvedor']

    def __str__(self):
        if self.gerente and self.desenvolvedor:
            return f"{self.supervisor.username} → {self.gerente.username} → {self.desenvolvedor.username}"
        elif self.gerente:
            return f"{self.supervisor.username} → {self.gerente.username}"
        elif self.desenvolvedor:
            return f"{self.supervisor.username} → {self.desenvolvedor.username}"
        return f"{self.supervisor.username}"


class NodePosition(models.Model):
    """Armazena as posições dos nodes no canvas de hierarquia"""
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='node_position',
        verbose_name='Usuário'
    )
    x = models.FloatField(verbose_name='Posição X')
    y = models.FloatField(verbose_name='Posição Y')
    updated_at = models.DateTimeField(auto_now=True, verbose_name='Data de Atualização')

    class Meta:
        verbose_name = 'Posição do Node'
        verbose_name_plural = 'Posições dos Nodes'
        ordering = ['user']

    def __str__(self):
        return f"{self.user.username} - ({self.x}, {self.y})"

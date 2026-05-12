from django.contrib.auth.models import AbstractUser
from django.db import models


class Role(models.TextChoices):
    ADMIN = 'admin', 'Admin'
    SUPERVISOR = 'supervisor', 'Supervisor'
    GERENTE = 'gerente', 'Gerente de Projetos'
    DESENVOLVEDOR = 'desenvolvedor', 'Desenvolvedor'
    DADOS = 'dados', 'Dados'
    PROCESSOS = 'processos', 'Processos'


class User(AbstractUser):
    role = models.CharField(
        max_length=20,
        choices=Role.choices,
        default=Role.DESENVOLVEDOR,
        verbose_name='Função'
    )
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

    @property
    def is_gerente(self):
        return self.role == Role.GERENTE

    @property
    def is_desenvolvedor(self):
        return self.role == Role.DESENVOLVEDOR

    @property
    def is_dados(self):
        return self.role == Role.DADOS

    @property
    def is_processos(self):
        return self.role == Role.PROCESSOS

from django.db import models
from django.conf import settings


class SuggestionStatus(models.TextChoices):
    BACKLOG = 'backlog', 'Backlog'
    EM_AVALIACAO = 'em_avaliacao', 'Em Avaliação'
    RECUSADO = 'recusado', 'Recusado'
    EM_DESENVOLVIMENTO = 'em_desenvolvimento', 'Em Desenvolvimento'
    FINALIZADO = 'finalizado', 'Finalizado'


class ProjectSuggestion(models.Model):
    titulo = models.CharField(max_length=200, verbose_name='Título')
    descricao = models.TextField(verbose_name='Descrição')
    # A sugestão entra no backlog e é avaliada: continua valendo mesmo depois
    # que quem a pediu sai da empresa. Fica anônima em vez de sumir.
    solicitante = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name='suggestions_created',
        null=True,
        blank=True,
        verbose_name='Solicitante'
    )
    status = models.CharField(
        max_length=20,
        choices=SuggestionStatus.choices,
        default=SuggestionStatus.BACKLOG,
        verbose_name='Status'
    )
    # Qualquer usuário pode constar como avaliador: quem tem direito de avaliar
    # é decidido por permissão, não pelo cargo.
    avaliado_por = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name='suggestions_evaluated',
        null=True,
        blank=True,
        verbose_name='Avaliado Por'
    )
    data_avaliacao = models.DateTimeField(null=True, blank=True, verbose_name='Data de Avaliação')
    observacoes = models.TextField(verbose_name='Observações', blank=True)
    created_at = models.DateTimeField(auto_now_add=True, verbose_name='Data de Criação')
    updated_at = models.DateTimeField(auto_now=True, verbose_name='Data de Atualização')

    class Meta:
        verbose_name = 'Sugestão de Projeto'
        verbose_name_plural = 'Sugestões de Projetos'
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.titulo} - {self.get_status_display()}"

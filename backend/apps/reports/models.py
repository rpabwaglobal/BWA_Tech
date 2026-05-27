"""
Modelo de Job de geração de relatório.

Cada export do usuário cria um ReportJob. A Celery task `generate_report`
processa o job de forma assíncrona e atualiza o progresso conforme avança.
Frontend faz polling em GET /api/reports/<id>/ até `status='completed'`.

Lock server-side: viewset rejeita criação de novo job enquanto o usuário
tem um job 'pending'|'running' (ver views.py).
"""
from __future__ import annotations

from django.conf import settings
from django.db import models


class ReportJob(models.Model):
    """Job de exportação de relatório.

    O `file` é preenchido quando `status='completed'`. Após `_RETENTION_DAYS`
    (atualmente 7), uma task periódica deve limpar arquivos antigos para não
    encher o storage (não implementado nesta fase).
    """

    class Status(models.TextChoices):
        PENDING = 'pending', 'Pendente'
        RUNNING = 'running', 'Em execução'
        COMPLETED = 'completed', 'Concluído'
        FAILED = 'failed', 'Falha'

    class Format(models.TextChoices):
        PDF = 'pdf', 'PDF'
        DOCX = 'docx', 'DOCX'
        XLSX = 'xlsx', 'XLSX'
        CSV = 'csv', 'CSV'

    type = models.CharField(
        max_length=50,
        db_index=True,
        help_text='ID do tipo de relatório (ex.: metrics, sprint, cards). Resolve pra um gerador no REGISTRY.',
    )
    format = models.CharField(max_length=10, choices=Format.choices)
    filters = models.JSONField(
        default=dict,
        blank=True,
        help_text='Filtros aplicados (ex.: {sprint_id, period_start, period_end, user_id}).',
    )
    # Para relatórios em tabela (xlsx/csv): se True, primeira linha = cabeçalho
    # com nomes das colunas. Independente do "cabeçalho contextual" (logo,
    # data, usuário, filtros) que SEMPRE é gravado.
    include_header = models.BooleanField(default=True)

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='report_jobs',
    )

    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.PENDING,
        db_index=True,
    )
    progress = models.PositiveSmallIntegerField(default=0, help_text='0–100')
    progress_message = models.CharField(max_length=200, blank=True)

    # Arquivo gerado. `upload_to` separa por user/ano-mês para evitar bagunça.
    file = models.FileField(upload_to='reports/%Y/%m/', null=True, blank=True)
    # Tamanho cached pra display (evita storage.size em loop de listagem).
    file_size = models.PositiveIntegerField(null=True, blank=True)

    error = models.TextField(blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        verbose_name = 'Relatório (Job)'
        verbose_name_plural = 'Relatórios (Jobs)'
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['user', 'status']),
        ]

    def __str__(self) -> str:
        return f'{self.type}/{self.format} ({self.status}) — {self.user_id}'

    @property
    def is_terminal(self) -> bool:
        return self.status in {self.Status.COMPLETED, self.Status.FAILED}

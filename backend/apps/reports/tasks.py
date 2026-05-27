"""
Celery task de geração de relatório.

Roda em background — o ViewSet enfileira ao criar o ReportJob e o frontend
faz polling no GET /api/reports/<id>/ até `status='completed'|'failed'`.
"""
from __future__ import annotations

import logging
import traceback

from celery import shared_task
from django.core.files.base import ContentFile
from django.utils import timezone

from apps.reports.generators import resolve
from apps.reports.models import ReportJob

logger = logging.getLogger(__name__)


@shared_task(name='reports.generate_report')
def generate_report(job_id: int) -> dict:
    """Gera o relatório identificado por `job_id` e salva o arquivo no FileField.

    Atualiza progress/status conforme avança. Em caso de exceção, marca o job
    como `failed` e grava a stacktrace em `error`.
    """
    try:
        job = ReportJob.objects.get(pk=job_id)
    except ReportJob.DoesNotExist:
        logger.warning('ReportJob %s não encontrado.', job_id)
        return {'ok': False, 'reason': 'not_found'}

    # Se outro worker já está processando OU o job já terminou, sai limpo.
    if job.status in {ReportJob.Status.RUNNING, ReportJob.Status.COMPLETED}:
        logger.info('ReportJob %s já em %s — ignorando.', job_id, job.status)
        return {'ok': False, 'reason': f'already_{job.status}'}

    job.status = ReportJob.Status.RUNNING
    job.progress = 1
    job.progress_message = 'Iniciando...'
    job.save(update_fields=['status', 'progress', 'progress_message', 'updated_at'])

    try:
        report_cls = resolve(job.type)
        generator = report_cls(job)
        blob = generator.render(job.format)
        if not isinstance(blob, (bytes, bytearray)):
            raise TypeError(
                f'Generator {report_cls} retornou {type(blob)}; esperado bytes.'
            )

        filename = generator.filename(job.format)
        job.file.save(filename, ContentFile(blob), save=False)
        job.file_size = len(blob)
        job.status = ReportJob.Status.COMPLETED
        job.progress = 100
        job.progress_message = 'Concluído'
        job.completed_at = timezone.now()
        job.save(update_fields=[
            'file', 'file_size', 'status', 'progress', 'progress_message',
            'completed_at', 'updated_at',
        ])
        return {'ok': True, 'job_id': job.id, 'file_size': job.file_size}

    except Exception as exc:  # noqa: BLE001 — queremos capturar TUDO
        logger.exception('Falha ao gerar relatório %s', job_id)
        job.status = ReportJob.Status.FAILED
        job.error = (str(exc) + '\n\n' + traceback.format_exc())[:5000]
        job.progress_message = 'Falha durante a geração'
        job.save(update_fields=['status', 'error', 'progress_message', 'updated_at'])
        return {'ok': False, 'reason': 'exception', 'detail': str(exc)}

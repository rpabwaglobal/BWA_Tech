"""
Celery task de geração de relatório.

Roda em background — o ViewSet enfileira ao criar o ReportJob e o frontend
faz polling no GET /api/reports/<id>/ até `status='completed'|'failed'`.
"""
from __future__ import annotations

import logging
import traceback
from uuid import uuid4

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
        # Defesa em profundidade sobre o bloqueio de `reports/` em
        # config/views.py: o nome devolvido por BaseReport.filename é
        # determinístico (um de oito títulos fixos + timestamp com granularidade
        # de MINUTO), então o caminho em MEDIA_ROOT seria enumerável por quem
        # descobrisse outra porta para os arquivos de mídia. Guardar dentro de um
        # subdiretório aleatório torna o caminho impossível de adivinhar sem
        # depender só do gate da rota.
        #
        # O segmento aleatório entra no DIRETÓRIO, nunca no nome do arquivo: o
        # Content-Disposition de /download/ e o filename de /preview/ saem de
        # `os.path.basename(job.file.name)` (apps/reports/views.py), logo o nome
        # bonito que o usuário recebe continua exatamente o de hoje.
        #
        # 16 hex = 64 bits, de sobra contra adivinhação e curto de propósito:
        # FileField.max_length é 100 e o Django TRUNCA o nome do arquivo (com
        # sufixo aleatório) se o caminho estourar — o que estragaria justamente
        # o nome exibido no download.
        pasta_opaca = uuid4().hex[:16]
        job.file.save(f'{pasta_opaca}/{filename}', ContentFile(blob), save=False)
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


@shared_task(name='reports.limpar_relatorios_expirados')
def limpar_relatorios_expirados() -> dict:
    """Apaga os ARQUIVOS de relatório vencidos e os órfãos deixados no disco.

    Relatório é o agregado de vários setores num arquivo só, e o arquivo sobrevive
    à requisição que o gerou. Sem esta rotina ele fica no disco para sempre: a
    remoção só acontecia ao fim de um `/download/` bem-sucedido, então quem usou
    só o `/preview/`, cancelou no meio, ou nunca abriu, deixava o arquivo lá.
    Encontrei 30 arquivos assim neste ambiente, o mais antigo de maio.

    O que apaga:
      1. Arquivo de job terminal mais velho que `REPORT_RETENTION_DAYS`. A LINHA
         do ReportJob fica — ela registra quem gerou o quê e quando, e isso é
         auditoria; o peso e o risco estão no arquivo, não no registro.
      2. Arquivo em `reports/` que nenhum job referencia (órfão). Acontece quando
         a linha é apagada sem passar pelo FileField, ou quando uma geração morre
         entre gravar o arquivo e salvar o job.

    O corte por mtime também protege o órfão RECÉM-criado: um arquivo sendo
    gravado agora ainda não tem job apontando para ele, e sem essa guarda a
    rotina o apagaria no meio da geração.
    """
    import os

    from django.conf import settings

    dias = getattr(settings, 'REPORT_RETENTION_DAYS', 7)
    corte = timezone.now() - timezone.timedelta(days=dias)

    vencidos = ReportJob.objects.filter(
        completed_at__lt=corte).exclude(file='').exclude(file=None)
    apagados_por_vencimento = 0
    for job in vencidos:
        try:
            job.file.delete(save=False)
            job.file_size = None
            job.save(update_fields=['file', 'file_size', 'updated_at'])
            apagados_por_vencimento += 1
        except OSError:
            logger.exception('Falha ao apagar arquivo do ReportJob %s', job.pk)

    raiz = os.path.join(settings.MEDIA_ROOT, 'reports')
    if not os.path.isdir(raiz):
        return {'vencidos': apagados_por_vencimento, 'orfaos': 0}

    referenciados = {
        os.path.normpath(os.path.join(settings.MEDIA_ROOT, nome))
        for nome in ReportJob.objects.exclude(file='').exclude(file=None)
                                     .values_list('file', flat=True)
    }
    limite_mtime = corte.timestamp()
    orfaos = 0
    for pasta, _dirs, arquivos in os.walk(raiz):
        for nome in arquivos:
            caminho = os.path.normpath(os.path.join(pasta, nome))
            if caminho in referenciados:
                continue
            try:
                if os.path.getmtime(caminho) >= limite_mtime:
                    continue  # novo demais: pode estar sendo gravado agora
                os.remove(caminho)
                orfaos += 1
            except OSError:
                logger.exception('Falha ao apagar órfão %s', caminho)

    if apagados_por_vencimento or orfaos:
        logger.info('Limpeza de relatórios: %s vencido(s), %s órfão(s).',
                    apagados_por_vencimento, orfaos)
    return {'vencidos': apagados_por_vencimento, 'orfaos': orfaos}

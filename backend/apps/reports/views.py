"""
ViewSet do app de Relatórios.

Endpoints:
- POST   /api/reports/                 cria job + dispara Celery (lock 1/user)
- GET    /api/reports/?status=running  lista jobs do usuário (filtros opcionais)
- GET    /api/reports/<id>/            polling de status/progresso
- GET    /api/reports/<id>/preview/    serve o arquivo inline (PDF embed em iframe)
- GET    /api/reports/<id>/download/   download attachment
- DELETE /api/reports/<id>/            cancela (apenas se pending) ou remove job concluído

Lock: ao tentar criar novo job enquanto há um pending/running do mesmo user,
retorna 409 com `{ existing_id, status }` — o frontend adota o job existente
em vez de duplicar.
"""
from __future__ import annotations

import mimetypes
import os

from django.http import FileResponse, Http404
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .models import ReportJob
from .serializers import ReportJobCreateSerializer, ReportJobSerializer
from .tasks import generate_report


_ACTIVE_STATUSES = (ReportJob.Status.PENDING, ReportJob.Status.RUNNING)


class ReportJobViewSet(viewsets.ModelViewSet):
    """CRUD de jobs de relatório. Sempre escopado ao usuário autenticado."""

    permission_classes = [IsAuthenticated]
    serializer_class = ReportJobSerializer
    # Sem filterset_fields — query params são tratados em get_queryset.
    http_method_names = ['get', 'post', 'delete', 'head', 'options']

    def get_queryset(self):
        qs = ReportJob.objects.filter(user=self.request.user).order_by('-created_at')
        status_param = self.request.query_params.get('status')
        if status_param:
            qs = qs.filter(status=status_param)
        return qs

    def get_serializer_class(self):
        if self.action == 'create':
            return ReportJobCreateSerializer
        return ReportJobSerializer

    def create(self, request, *args, **kwargs):
        # Lock: verifica se já tem job ativo do usuário antes de criar.
        existing = (
            ReportJob.objects.filter(user=request.user, status__in=_ACTIVE_STATUSES)
            .order_by('-created_at')
            .first()
        )
        if existing is not None:
            return Response(
                {
                    'detail': (
                        'Você já tem um relatório em geração. Aguarde concluir '
                        'ou cancele o atual antes de iniciar outro.'
                    ),
                    'existing_id': existing.id,
                    'existing_status': existing.status,
                    'existing_type': existing.type,
                    'existing_format': existing.format,
                },
                status=status.HTTP_409_CONFLICT,
            )

        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        job = serializer.save(user=request.user)
        # Dispara Celery. Em DEV sem worker, o task vai pra fila e fica lá —
        # use CELERY_TASK_ALWAYS_EAGER=true no .env de dev pra rodar inline.
        generate_report.delay(job.id)

        # Resposta usa o serializer "completo" pra incluir status atualizado.
        out = ReportJobSerializer(job, context=self.get_serializer_context())
        return Response(out.data, status=status.HTTP_201_CREATED)

    def destroy(self, request, *args, **kwargs):
        """Cancela job em andamento OU remove job concluído.

        - Pending/running: marca como failed (cancelado) — não tenta abortar
          a task Celery (revoke é frágil); o worker, ao terminar, vê que o
          job já foi marcado e não sobrescreve.
        - Completed/failed: deleta o registro + arquivo.
        """
        job = self.get_object()
        if job.status in _ACTIVE_STATUSES:
            job.status = ReportJob.Status.FAILED
            job.error = 'Cancelado pelo usuário'
            job.progress_message = 'Cancelado'
            job.save(update_fields=['status', 'error', 'progress_message', 'updated_at'])
            return Response(status=status.HTTP_204_NO_CONTENT)
        if job.file:
            job.file.delete(save=False)
        job.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=['get'], url_path='download')
    def download(self, request, pk=None):
        """Baixa o arquivo (Content-Disposition: attachment)."""
        job = self.get_object()
        return _serve_file(job, as_attachment=True)

    @action(detail=True, methods=['get'], url_path='preview')
    def preview(self, request, pk=None):
        """Serve o arquivo inline — usado pelo <iframe> do modal de preview.

        Faz sentido pra PDF (browser tem viewer nativo). Para DOCX/XLSX
        retorna o arquivo mesmo (o browser provavelmente vai baixar).
        """
        job = self.get_object()
        return _serve_file(job, as_attachment=False)


def _serve_file(job: ReportJob, *, as_attachment: bool) -> FileResponse:
    if job.status != ReportJob.Status.COMPLETED or not job.file:
        raise Http404('Arquivo do relatório não disponível.')
    filename = os.path.basename(job.file.name)
    content_type = (
        mimetypes.guess_type(filename)[0]
        or 'application/octet-stream'
    )
    # FileResponse já lida com Content-Length, ranges, etc.
    response = FileResponse(
        job.file.open('rb'),
        as_attachment=as_attachment,
        filename=filename,
        content_type=content_type,
    )
    return response

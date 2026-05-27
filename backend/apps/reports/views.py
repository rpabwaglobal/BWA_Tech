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

import logging
import mimetypes
import os

from django.http import FileResponse, Http404, StreamingHttpResponse
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

logger = logging.getLogger(__name__)

from .generators import resolve as resolve_generator
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
        """Baixa o arquivo (Content-Disposition: attachment).

        Auto-deleta o ReportJob (+ arquivo) APÓS o stream completar com
        sucesso. Cliente nem precisa avisar. Se o cliente desconectar
        no meio, o arquivo fica e o cleanup periódico (futuro) pega.
        """
        job = self.get_object()
        return _serve_file_and_delete_on_success(job)

    @action(detail=True, methods=['get'], url_path='preview')
    def preview(self, request, pk=None):
        """Serve o arquivo inline — usado pelo <iframe> do modal de preview.

        Faz sentido pra PDF (browser tem viewer nativo). Para DOCX/XLSX
        retorna o arquivo mesmo (o browser provavelmente vai baixar).
        """
        job = self.get_object()
        return _serve_file(job, as_attachment=False)

    @action(detail=False, methods=['post'], url_path='preview-table')
    def preview_table(self, request):
        """Preview JSON paginado p/ formatos tabulares (XLSX/CSV).

        Não cria ReportJob persistido — instancia o gerador num job efêmero,
        roda `fetch_data` + `table_rows` e devolve uma janela `[offset, +limit]`
        em JSON. `set_progress` vira no-op em job sem pk (ver BaseReport).

        Body: `{ type, filters?, limit?: 100, offset?: 0 }`. Cliente pode
        pedir páginas seguintes incrementando `offset`. Cada call re-roda
        `fetch_data` (sem cache) — barato porque as listas vivem em memória.

        Retorna 422 se o gerador não suporta formato tabular (sem colunas).
        """
        type_id = request.data.get('type')
        filters = request.data.get('filters') or {}
        try:
            limit = int(request.data.get('limit') or 100)
        except (TypeError, ValueError):
            limit = 100
        limit = max(1, min(limit, 1000))
        try:
            offset = int(request.data.get('offset') or 0)
        except (TypeError, ValueError):
            offset = 0
        offset = max(0, offset)

        if not isinstance(type_id, str) or not type_id:
            return Response(
                {'detail': 'Campo "type" é obrigatório.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not isinstance(filters, dict):
            return Response(
                {'detail': 'Campo "filters" precisa ser objeto.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            generator_cls = resolve_generator(type_id)
        except KeyError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        # Job efêmero (NÃO salvo). set_progress vira no-op por causa do pk None.
        ephemeral = ReportJob(
            user=request.user,
            type=type_id,
            format=ReportJob.Format.CSV,  # qualquer um tabular — só pra satisfazer o schema
            filters=filters,
            include_header=True,
        )
        generator = generator_cls(ephemeral)

        columns = generator.table_columns()
        if not columns:
            return Response(
                {
                    'detail': (
                        f'O relatório "{type_id}" não tem formato tabular — '
                        'use preview em PDF.'
                    ),
                },
                status=status.HTTP_422_UNPROCESSABLE_ENTITY,
            )

        try:
            data = generator.fetch_data()
            all_rows = list(generator.table_rows(data))
        except Exception as exc:  # noqa: BLE001 — superfície curta pro user
            return Response(
                {'detail': f'Falha ao preparar preview: {exc}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        total = len(all_rows)
        page = all_rows[offset:offset + limit]
        has_more = (offset + len(page)) < total

        return Response(
            {
                'columns': [{'key': c.key, 'label': c.label} for c in columns],
                'rows': page,
                'total': total,
                'offset': offset,
                'limit': limit,
                'has_more': has_more,
            },
            status=status.HTTP_200_OK,
        )


def _serve_file_and_delete_on_success(job: ReportJob) -> StreamingHttpResponse:
    """Stream do arquivo + delete do ReportJob (e arquivo do storage) ao
    completar a transferência.

    Detecção de "completou": conta bytes enviados; se >= file_size ao final
    do generator, é seguro deletar. Se o cliente desconectar no meio
    (GeneratorExit é propagado), o arquivo FICA — pra futuras tentativas.

    Não usa FileResponse porque a gente quer controle do ciclo de vida do
    handle e hook de "fim de stream" — StreamingHttpResponse com generator
    custom faz isso de forma confiável.
    """
    if job.status != ReportJob.Status.COMPLETED or not job.file:
        raise Http404('Arquivo do relatório não disponível.')

    filename = os.path.basename(job.file.name)
    content_type = mimetypes.guess_type(filename)[0] or 'application/octet-stream'

    # Cache locais — depois do delete o job some, então pegamos tudo antes.
    file_obj = job.file.open('rb')
    try:
        file_size = file_obj.seek(0, 2)
        file_obj.seek(0)
    except Exception:
        file_obj.close()
        raise

    job_id = job.id
    file_storage = job.file.storage
    file_name = job.file.name
    sent = [0]
    chunk_size = 64 * 1024

    def _generator():
        try:
            while True:
                chunk = file_obj.read(chunk_size)
                if not chunk:
                    break
                sent[0] += len(chunk)
                yield chunk
        finally:
            file_obj.close()
            # Só apaga se transferiu TUDO. Cliente desconectado no meio
            # vira GeneratorExit no yield e cai aqui com sent < file_size.
            if sent[0] >= file_size:
                try:
                    # Deleta o registro primeiro pra não deixar job órfão
                    # apontando pra arquivo inexistente.
                    ReportJob.objects.filter(pk=job_id).delete()
                    file_storage.delete(file_name)
                except Exception as exc:  # noqa: BLE001 — best-effort cleanup
                    logger.warning(
                        'Falha ao limpar ReportJob #%s após download: %s',
                        job_id, exc,
                    )

    response = StreamingHttpResponse(_generator(), content_type=content_type)
    response['Content-Length'] = str(file_size)
    # Padrão "BWATech - <Título> - DD-MM-YYYY HH-MM.<fmt>" já vem no nome
    # do arquivo (ver BaseReport.filename); só repete no Content-Disposition.
    safe_name = filename.replace('"', '')
    response['Content-Disposition'] = f'attachment; filename="{safe_name}"'
    return response


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

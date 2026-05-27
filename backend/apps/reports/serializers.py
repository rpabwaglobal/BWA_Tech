from rest_framework import serializers

from .generators import available_types
from .models import ReportJob


class ReportJobCreateSerializer(serializers.ModelSerializer):
    """Payload aceito no POST /api/reports/.

    Valida type contra o registry — frontend não pode pedir relatório
    inexistente. `user` é sempre o request.user (preenchido na view).
    """

    class Meta:
        model = ReportJob
        fields = ['type', 'format', 'filters', 'include_header']

    def validate_type(self, value: str) -> str:
        valid = available_types()
        if value not in valid:
            raise serializers.ValidationError(
                f'Tipo "{value}" não existe. Disponíveis: {", ".join(valid)}'
            )
        return value

    def validate_format(self, value: str) -> str:
        valid = {choice for choice, _ in ReportJob.Format.choices}
        if value not in valid:
            raise serializers.ValidationError(
                f'Formato "{value}" inválido. Use um de: {sorted(valid)}'
            )
        return value


class ReportJobSerializer(serializers.ModelSerializer):
    """Resposta do GET /api/reports/<id>/. Inclui url do arquivo se completed."""
    download_url = serializers.SerializerMethodField()
    preview_url = serializers.SerializerMethodField()

    class Meta:
        model = ReportJob
        fields = [
            'id', 'type', 'format', 'filters', 'include_header',
            'status', 'progress', 'progress_message',
            'file_size', 'error',
            'download_url', 'preview_url',
            'created_at', 'updated_at', 'completed_at',
        ]
        read_only_fields = fields

    def get_download_url(self, obj: ReportJob) -> str | None:
        if obj.status != ReportJob.Status.COMPLETED or not obj.file:
            return None
        return f'/api/reports/{obj.id}/download/'

    def get_preview_url(self, obj: ReportJob) -> str | None:
        # Preview embedável só faz sentido pra PDF (iframe nativo do browser
        # renderiza). DOCX/XLSX/CSV não têm preview embedável — frontend
        # baixa direto.
        if obj.status != ReportJob.Status.COMPLETED:
            return None
        if obj.format != ReportJob.Format.PDF:
            return None
        return f'/api/reports/{obj.id}/preview/'

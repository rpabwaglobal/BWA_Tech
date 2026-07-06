from django.conf import settings
from django.db import models


class SuporteTipo(models.Model):
    nome = models.CharField(max_length=200)
    ativo = models.BooleanField(default=True)

    class Meta:
        ordering = ['nome']
        verbose_name = 'Tipo de suporte'
        verbose_name_plural = 'Tipos de suporte'

    def __str__(self):
        return self.nome


class SuporteItem(models.Model):
    tipo = models.ForeignKey(
        SuporteTipo,
        on_delete=models.CASCADE,
        related_name='itens',
    )
    nome = models.CharField(max_length=200)
    ativo = models.BooleanField(default=True)

    class Meta:
        ordering = ['tipo_id', 'nome']
        verbose_name = 'Item de suporte'
        verbose_name_plural = 'Itens de suporte'

    def __str__(self):
        return f'{self.tipo.nome} · {self.nome}'


class SuporteMotivo(models.Model):
    nome = models.CharField(max_length=200)
    ativo = models.BooleanField(default=True)

    class Meta:
        ordering = ['nome']
        verbose_name = 'Motivo de suporte'
        verbose_name_plural = 'Motivos de suporte'

    def __str__(self):
        return self.nome


class ChamadoSuporteStatus(models.TextChoices):
    ABERTO = 'Aberto', 'Aberto'
    EM_ANDAMENTO = 'Em andamento', 'Em andamento'
    RESOLVIDO = 'Resolvido', 'Resolvido'
    CANCELADO = 'Cancelado', 'Cancelado'


class ChamadoSuporte(models.Model):
    usuario_nome = models.CharField(max_length=200)
    usuario_email = models.EmailField()
    usuario_setor = models.CharField(max_length=200, blank=True)
    empresa = models.CharField(max_length=200, blank=True)
    descricao = models.TextField()
    tipo = models.ForeignKey(SuporteTipo, on_delete=models.PROTECT, related_name='chamados')
    item = models.ForeignKey(SuporteItem, on_delete=models.PROTECT, related_name='chamados')
    motivo = models.ForeignKey(SuporteMotivo, on_delete=models.PROTECT, related_name='chamados')
    anexo_url = models.URLField(blank=True, null=True)
    status = models.CharField(
        max_length=20,
        choices=ChamadoSuporteStatus.choices,
        default=ChamadoSuporteStatus.ABERTO,
    )
    usuario_notificado = models.BooleanField(default=False)
    responsavel = models.CharField(max_length=200, blank=True, null=True)
    responsavel_solucao = models.CharField(max_length=200, blank=True, null=True)
    descricao_resolucao = models.TextField(blank=True, null=True)
    data_abertura = models.DateTimeField(auto_now_add=True)
    data_atualizacao = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-data_abertura']
        verbose_name = 'Chamado de suporte'
        verbose_name_plural = 'Chamados de suporte'
        # Índices pra acelerar filtros do por_usuario (que faz iexact em
        # usuario_email + filter por tipo_id/status). count() + slice eram
        # lentos sem isso.
        indexes = [
            models.Index(fields=['usuario_email'], name='suporte_email_idx'),
            models.Index(fields=['tipo', 'status'], name='suporte_tipo_status_idx'),
            models.Index(fields=['-data_abertura'], name='suporte_aberta_desc_idx'),
        ]

    def __str__(self):
        return f'#{self.pk} {self.usuario_email}'


class ChamadoSuporteResolucao(models.Model):
    """Anexos de RESOLUÇÃO de um chamado: link + arquivo, adicionados ao concluir.

    Guardado localmente por `chamado_id` (como a timeline) — funciona mesmo quando
    o chamado vive no portal externo (a tabela `ChamadoSuporte` local fica vazia
    nesse modo). Um registro por chamado; a conclusão faz upsert.
    """

    chamado_id = models.PositiveIntegerField(unique=True, db_index=True)
    link = models.URLField(blank=True, null=True)
    arquivo = models.FileField(upload_to='suporte_resolucao/', blank=True, null=True)
    usuario = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name='chamado_suporte_resolucoes',
        null=True,
        blank=True,
    )
    criado_em = models.DateTimeField(auto_now_add=True)
    atualizado_em = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'Resolução de chamado de suporte'
        verbose_name_plural = 'Resoluções de chamados de suporte'

    def __str__(self):
        return f'Resolução do chamado #{self.chamado_id}'


class ChamadoSuporteTimelineTipo(models.TextChoices):
    CRIADO = 'criado', 'Ticket criado'
    ETAPA_ALTERADA = 'etapa_alterada', 'Etapa alterada'
    RESPONSAVEL_ALTERADO = 'responsavel_alterado', 'Responsável alterado'
    NOTIFICACAO = 'notificacao', 'Notificação ao solicitante'
    PENDENCIA = 'pendencia', 'Pendência no quadro'
    COMENTARIO = 'comentario', 'Comentário'


class ChamadoSuporteTimeline(models.Model):
    """Observações/comentários da timeline do chamado (armazenados no BWA; id alinhado ao chamado na API)."""

    chamado_id = models.PositiveIntegerField(db_index=True)
    tipo_evento = models.CharField(
        max_length=30,
        choices=ChamadoSuporteTimelineTipo.choices,
        default=ChamadoSuporteTimelineTipo.COMENTARIO,
    )
    descricao = models.TextField()
    usuario = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name='chamado_suporte_timeline_entries',
        null=True,
        blank=True,
    )
    data = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-data']
        verbose_name = 'Timeline do chamado de suporte'
        verbose_name_plural = 'Timeline dos chamados de suporte'

    def __str__(self):
        return f'Chamado #{self.chamado_id} · {self.get_tipo_evento_display()} ({self.data})'

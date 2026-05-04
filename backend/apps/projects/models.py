import threading

from django.db import models, transaction
from django.conf import settings
from django.core.validators import MinValueValidator
from django.utils import timezone
from datetime import datetime
import logging


class Sprint(models.Model):
    nome = models.CharField(max_length=100, verbose_name='Nome da Sprint')
    data_inicio = models.DateTimeField(verbose_name='Data e hora de início')
    fechamento_em = models.DateTimeField(verbose_name='Data e hora de fechamento')
    duracao_dias = models.IntegerField(
        validators=[MinValueValidator(1)],
        verbose_name='Duração em Dias'
    )
    supervisor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='sprints_created',
        verbose_name='Supervisor'
    )
    finalizada = models.BooleanField(default=False, verbose_name='Finalizada')
    created_at = models.DateTimeField(auto_now_add=True, verbose_name='Data de Criação')
    updated_at = models.DateTimeField(auto_now=True, verbose_name='Data de Atualização')

    class Meta:
        verbose_name = 'Sprint'
        verbose_name_plural = 'Sprints'
        ordering = ['-data_inicio']

    def __str__(self):
        return f"{self.nome} ({self.data_inicio} → {self.fechamento_em})"

    def save(self, *args, **kwargs):
        """Agenda o fechamento automático no instante `fechamento_em` (definido na criação/edição da sprint)."""
        previous = None
        if self.pk:
            previous = Sprint.objects.filter(pk=self.pk).values('finalizada', 'fechamento_em').first()

        super().save(*args, **kwargs)

        if self.finalizada or not self.fechamento_em:
            return

        prev_f = previous.get('fechamento_em') if previous else None
        fechamento_changed = previous is None or prev_f != self.fechamento_em

        if not fechamento_changed:
            return

        expected_close_at = self.fechamento_em
        if timezone.is_naive(expected_close_at):
            expected_close_at = timezone.make_aware(expected_close_at, timezone.get_current_timezone())

        from .tasks import fechar_sprint_em_hora

        eta = expected_close_at if expected_close_at > timezone.now() else timezone.now()
        sprint_id = self.id
        close_iso = expected_close_at.isoformat()

        # Após o commit: a sprint já existe na BD. Publicar no broker numa thread evita
        # bloquear a resposta HTTP se Redis estiver lento ou indisponível.
        def schedule_close():
            def publish():
                try:
                    fechar_sprint_em_hora.apply_async(
                        args=[sprint_id, close_iso],
                        eta=eta,
                    )
                except Exception as e:
                    logging.getLogger(__name__).warning(
                        "Falha ao agendar fechamento ETA da sprint %s: %s",
                        sprint_id,
                        str(e),
                    )

            threading.Thread(target=publish, daemon=True).start()

        transaction.on_commit(schedule_close)


class ProjectStatus(models.TextChoices):
    CRIADO = 'criado', 'Criado'
    EM_AVALIACAO = 'em_avaliacao', 'Em Avaliação'
    APROVADO = 'aprovado', 'Aprovado'
    EM_DESENVOLVIMENTO = 'em_desenvolvimento', 'Em Desenvolvimento'
    ENTREGUE = 'entregue', 'Entregue'
    HOMOLOGADO = 'homologado', 'Homologado'
    ADIADO = 'adiado', 'Adiado'


class Project(models.Model):
    nome = models.CharField(max_length=200, verbose_name='Nome do Projeto')
    descricao = models.TextField(verbose_name='Descrição', blank=True)
    sprint = models.ForeignKey(
        Sprint,
        on_delete=models.CASCADE,
        related_name='projects',
        verbose_name='Sprint'
    )
    gerente_atribuido = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name='projects_managed',
        null=True,
        blank=True,
        limit_choices_to={'role': 'gerente'},
        verbose_name='Gerente Atribuído'
    )
    desenvolvedor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name='projects_assigned',
        null=True,
        blank=True,
        limit_choices_to={'role': 'desenvolvedor'},
        verbose_name='Desenvolvedor'
    )
    status = models.CharField(
        max_length=20,
        choices=ProjectStatus.choices,
        default=ProjectStatus.CRIADO,
        verbose_name='Status'
    )
    # Datas importantes
    data_criacao = models.DateTimeField(auto_now_add=True, verbose_name='Data de Criação')
    data_avaliacao = models.DateTimeField(null=True, blank=True, verbose_name='Data de Avaliação')
    data_atribuicao_gerente = models.DateTimeField(null=True, blank=True, verbose_name='Data de Atribuição do Gerente')
    data_inicio_desenvolvimento = models.DateTimeField(null=True, blank=True, verbose_name='Data de Início do Desenvolvimento')
    data_entrega = models.DateTimeField(null=True, blank=True, verbose_name='Data de Entrega')
    data_homologacao = models.DateTimeField(null=True, blank=True, verbose_name='Data de Homologação')
    # Adiamento
    data_adiamento_solicitada = models.DateTimeField(null=True, blank=True, verbose_name='Data de Solicitação de Adiamento')
    nova_data_prevista = models.DateField(null=True, blank=True, verbose_name='Nova Data Prevista')
    adiamento_aprovado = models.BooleanField(default=False, verbose_name='Adiamento Aprovado')
    created_at = models.DateTimeField(auto_now_add=True, verbose_name='Data de Criação')
    updated_at = models.DateTimeField(auto_now=True, verbose_name='Data de Atualização')

    class Meta:
        verbose_name = 'Projeto'
        verbose_name_plural = 'Projetos'
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.nome} - {self.get_status_display()}"


class CardStatus(models.TextChoices):
    A_DESENVOLVER = 'a_desenvolver', 'A Desenvolver'
    EM_DESENVOLVIMENTO = 'em_desenvolvimento', 'Em Desenvolvimento'
    PARADO_PENDENCIAS = 'parado_pendencias', 'Parado por Pendências'
    EM_HOMOLOGACAO = 'em_homologacao', 'Em Homologação'
    FINALIZADO = 'finalizado', 'Finalizado'
    INVIABILIZADO = 'inviabilizado', 'Inviabilizado'


class KanbanStage(models.Model):
    """
    Etapa/coluna global do Kanban.

    A `key` deve ser compatível com os valores atuais (Card.status já usa strings como
    'a_desenvolver', 'em_desenvolvimento', etc).
    """

    key = models.CharField(max_length=50, unique=True, verbose_name='Key (status)')
    label = models.CharField(max_length=100, verbose_name='Label')

    # Comportamento (usado na UI para lógica terminal e campos obrigatórios)
    is_terminal = models.BooleanField(default=False, verbose_name='Etapa Terminal')
    requires_required_data = models.BooleanField(default=False, verbose_name='Requer Dados Obrigatórios')

    created_at = models.DateTimeField(auto_now_add=True, verbose_name='Data de Criação')
    updated_at = models.DateTimeField(auto_now=True, verbose_name='Data de Atualização')

    class Meta:
        verbose_name = 'Etapa do Kanban'
        verbose_name_plural = 'Etapas do Kanban'
        ordering = ['key']

    def __str__(self):
        return f'{self.label} ({self.key})'


class ProjectKanbanStageConfig(models.Model):
    """
    Configura quais etapas um projeto terá e em que ordem elas aparecem.
    """

    project = models.ForeignKey(
        Project,
        on_delete=models.CASCADE,
        related_name='kanban_stage_configs',
        verbose_name='Projeto',
    )
    stage = models.ForeignKey(
        KanbanStage,
        on_delete=models.CASCADE,
        related_name='project_configs',
        verbose_name='Etapa',
    )
    order = models.PositiveIntegerField(default=0, verbose_name='Ordem')

    created_at = models.DateTimeField(auto_now_add=True, verbose_name='Data de Criação')
    updated_at = models.DateTimeField(auto_now=True, verbose_name='Data de Atualização')

    class Meta:
        verbose_name = 'Configuração de Etapas do Kanban por Projeto'
        verbose_name_plural = 'Configurações de Etapas do Kanban por Projeto'
        unique_together = [('project', 'stage')]
        ordering = ['order', 'stage__key']

    def __str__(self):
        return f'{self.project.nome}: {self.stage.label} ({self.order})'


class Priority(models.TextChoices):
    BAIXA = 'baixa', 'Baixa'
    MEDIA = 'media', 'Média'
    ALTA = 'alta', 'Alta'
    ABSOLUTA = 'absoluta', 'Absoluta'


class CardArea(models.TextChoices):
    RPA = 'rpa', 'RPA'
    FRONTEND = 'frontend', 'Frontend'
    BACKEND = 'backend', 'Backend'
    SCRIPT = 'script', 'Script'
    SISTEMA = 'sistema', 'Sistema'
    AUTOMACAO = 'automacao', 'Automação'


class CardType(models.TextChoices):
    NOVA_ROBOTIZACAO = 'nova_robotizacao', 'Nova Robotização'
    NOVA_AUTOMACAO = 'nova_automacao', 'Nova Automação'
    FEATURE = 'feature', 'Feature'
    BUG = 'bug', 'Bug'
    REFACT_COMPLETO = 'refact_completo', 'Refact Completo'
    REFACT_PONTUAL = 'refact_pontual', 'Refact Pontual'
    OTIMIZACAO_PROCESSO = 'otimizacao_processo', 'Otimização de Processo'
    MELHORIA_FLUXO = 'melhoria_fluxo', 'Melhoria de Fluxo'
    NOVO_SCRIPT = 'novo_script', 'Novo Script'
    FERRAMENTA = 'ferramenta', 'Ferramenta'
    QUALIDADE = 'qualidade', 'Qualidade'
    TESTE_SOFTWARE = 'teste_software', 'Teste de Software'
    RASPAGEM_DADOS = 'raspagem_dados', 'Raspagem de Dados'
    NOVO_PAINEL = 'novo_painel', 'Novo Painel'
    IA = 'ia', 'IA'
    AUDITORIA = 'auditoria', 'Auditoria'
    MANUTENCAO = 'manutencao', 'Manutenção'


class Card(models.Model):
    nome = models.CharField(max_length=200, verbose_name='Nome do Card')
    descricao = models.TextField(verbose_name='Descrição/Instruções', blank=True)
    script_url = models.URLField(
        max_length=500,
        verbose_name='Link do Script',
        blank=True,
        null=True,
        help_text='URL para o script de confecção do projeto'
    )
    projeto = models.ForeignKey(
        Project,
        on_delete=models.CASCADE,
        related_name='cards',
        verbose_name='Projeto'
    )
    area = models.CharField(
        max_length=20,
        choices=CardArea.choices,
        default=CardArea.BACKEND,
        verbose_name='Área'
    )
    tipo = models.CharField(
        max_length=30,
        choices=CardType.choices,
        default=CardType.FEATURE,
        verbose_name='Tipo'
    )
    responsavel = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name='cards_assigned',
        null=True,
        blank=True,
        verbose_name='Responsável'
    )
    criado_por = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name='cards_created',
        null=True,
        blank=True,
        verbose_name='Criado Por',
        help_text='Usuário que criou esta demanda'
    )
    status = models.CharField(
        max_length=20,
        choices=CardStatus.choices,
        default=CardStatus.A_DESENVOLVER,
        verbose_name='Status'
    )
    prioridade = models.CharField(
        max_length=20,
        choices=Priority.choices,
        default=Priority.MEDIA,
        verbose_name='Prioridade'
    )
    data_inicio = models.DateTimeField(null=True, blank=True, verbose_name='Data de Início')
    data_fim = models.DateTimeField(null=True, blank=True, verbose_name='Data de Fim')
    finalizado_em = models.DateTimeField(
        null=True,
        blank=True,
        verbose_name='Finalizado em',
        help_text='Instante em que o card passou a finalizado pela última vez (métricas de prazo).',
    )
    # Campos para estimativa de complexidade
    complexidade_selected_items = models.JSONField(
        default=list,
        blank=True,
        verbose_name='Itens Selecionados na Estimativa de Complexidade',
        help_text='Array de IDs dos itens selecionados na estimativa de complexidade'
    )
    complexidade_selected_development = models.CharField(
        max_length=50,
        null=True,
        blank=True,
        verbose_name='Desenvolvimento Selecionado na Estimativa',
        help_text='ID do item de desenvolvimento selecionado na estimativa de complexidade'
    )
    complexidade_custom_items = models.JSONField(
        default=list,
        blank=True,
        verbose_name='Itens Personalizados da Estimativa de Complexidade',
        help_text='Array de objetos com id, label e hours dos itens personalizados criados pelo usuário'
    )
    card_comment = models.TextField(
        blank=True,
        null=True,
        verbose_name='Comentário do Card',
        help_text='Comentário geral do card'
    )
    created_at = models.DateTimeField(auto_now_add=True, verbose_name='Data de Criação')
    updated_at = models.DateTimeField(auto_now=True, verbose_name='Data de Atualização')

    class Meta:
        verbose_name = 'Card'
        verbose_name_plural = 'Cards'
        ordering = ['projeto', 'prioridade', 'created_at']

    def __str__(self):
        return f"{self.nome} - {self.projeto.nome}"


class CardTodoStatus(models.TextChoices):
    PENDING = 'pending', 'Pendente'
    COMPLETED = 'completed', 'Concluído'
    BLOCKED = 'blocked', 'Bloqueado'
    WARNING = 'warning', 'Aviso'


class CardTodo(models.Model):
    card = models.ForeignKey(
        Card,
        on_delete=models.CASCADE,
        related_name='todos',
        verbose_name='Card'
    )
    label = models.CharField(max_length=500, verbose_name='Texto do TODO')
    is_original = models.BooleanField(
        default=False,
        verbose_name='TODO Original',
        help_text='Se é um TODO original criado automaticamente (não pode ser removido)'
    )
    status = models.CharField(
        max_length=20,
        choices=CardTodoStatus.choices,
        default=CardTodoStatus.PENDING,
        verbose_name='Status'
    )
    comment = models.TextField(
        blank=True,
        null=True,
        verbose_name='Comentário',
        help_text='Comentário do TODO'
    )
    order = models.IntegerField(
        default=0,
        verbose_name='Ordem',
        help_text='Ordem de exibição do TODO'
    )
    created_at = models.DateTimeField(auto_now_add=True, verbose_name='Data de Criação')
    updated_at = models.DateTimeField(auto_now=True, verbose_name='Data de Atualização')

    class Meta:
        verbose_name = 'TODO do Card'
        verbose_name_plural = 'TODOs dos Cards'
        ordering = ['order', 'created_at']

    def __str__(self):
        return f"{self.card.nome} - {self.label}"


class EventType(models.TextChoices):
    PENDENCIA = 'pendencia', 'Pendência'
    PRIORIDADE = 'prioridade', 'Prioridade'
    TAG = 'tag', 'Tag'
    COMENTARIO = 'comentario', 'Comentário'


class Event(models.Model):
    card = models.ForeignKey(
        Card,
        on_delete=models.CASCADE,
        related_name='events',
        verbose_name='Card'
    )
    tipo = models.CharField(
        max_length=20,
        choices=EventType.choices,
        verbose_name='Tipo de Evento'
    )
    descricao = models.TextField(verbose_name='Descrição')
    motivo = models.TextField(verbose_name='Motivo', blank=True)
    usuario = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='events_created',
        verbose_name='Usuário'
    )
    data = models.DateTimeField(auto_now_add=True, verbose_name='Data do Evento')

    class Meta:
        verbose_name = 'Evento'
        verbose_name_plural = 'Eventos'
        ordering = ['-data']

    def __str__(self):
        return f"{self.get_tipo_display()} - {self.card.nome} ({self.data})"


class CardLogEventType(models.TextChoices):
    CRIADO = 'criado', 'Card Criado'
    MOVIMENTADO = 'movimentado', 'Movimentado'
    PENDENCIA = 'pendencia', 'Pendência'
    ATUALIZADO = 'atualizado', 'Atualizado'
    ALTERACAO = 'alteracao', 'Alteração no Card'
    RESPONSAVEL_ALTERADO = 'responsavel_alterado', 'Responsável Alterado'


class CardLog(models.Model):
    card = models.ForeignKey(
        Card,
        on_delete=models.CASCADE,
        related_name='logs',
        verbose_name='Card'
    )
    tipo_evento = models.CharField(
        max_length=30,
        choices=CardLogEventType.choices,
        verbose_name='Tipo de Evento'
    )
    descricao = models.TextField(verbose_name='Descrição')
    usuario = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name='card_logs',
        null=True,
        blank=True,
        verbose_name='Usuário'
    )
    data = models.DateTimeField(auto_now_add=True, verbose_name='Data do Evento')

    class Meta:
        verbose_name = 'Log do Card'
        verbose_name_plural = 'Logs dos Cards'
        ordering = ['-data']

    def __str__(self):
        return f"{self.card.nome} - {self.get_tipo_evento_display()} ({self.data})"


class NotificationType(models.TextChoices):
    CARD_CREATED = 'card_created', 'Card Criado'
    CARD_UPDATED = 'card_updated', 'Card Atualizado'
    CARD_DELETED = 'card_deleted', 'Card Deletado'
    CARD_MOVED = 'card_moved', 'Card Movido'
    CARD_TODO_UPDATED = 'card_todo_updated', 'TODO do Card Atualizado'
    SPRINT_CREATED = 'sprint_created', 'Sprint Criada'
    PROJECT_CREATED = 'project_created', 'Projeto Criado'
    ROLE_CHANGED = 'role_changed', 'Cargo Alterado'
    CARD_OVERDUE = 'card_overdue', 'Card Atrasado'
    CARD_DUE_24H = 'card_due_24h', 'Card Vence em 24h'
    CARD_DUE_1H = 'card_due_1h', 'Card Vence em 1h'
    CARD_DUE_10MIN = 'card_due_10min', 'Card Vence em 10min'
    LOG_CREATED = 'log_created', 'Log Criado'


class WeeklyPriorityConfig(models.Model):
    """Configuração global para o horário limite das prioridades da semana"""
    horario_limite = models.TimeField(
        default='09:00:00',
        verbose_name='Horário Limite (Sexta-feira)'
    )
    fechamento_automatico = models.BooleanField(
        default=True,
        verbose_name='Fechamento Automático',
        help_text='Se habilitado, a semana será fechada automaticamente ao chegar no horário limite'
    )
    semana_fechada = models.JSONField(
        default=dict,
        blank=True,
        verbose_name='Semanas Fechadas',
        help_text='Dicionário com as semanas fechadas no formato {semana_inicio: True}'
    )
    created_at = models.DateTimeField(auto_now_add=True, verbose_name='Data de Criação')
    updated_at = models.DateTimeField(auto_now=True, verbose_name='Data de Atualização')

    class Meta:
        verbose_name = 'Configuração de Prioridade Semanal'
        verbose_name_plural = 'Configurações de Prioridade Semanal'

    def __str__(self):
        return f"Horário limite: {self.horario_limite}"

    @classmethod
    def get_config(cls):
        """Retorna a configuração, criando uma se não existir"""
        config, _ = cls.objects.get_or_create(pk=1)
        return config
    
    def is_semana_fechada(self, semana_inicio):
        """Verifica se uma semana específica está fechada"""
        if not self.semana_fechada:
            return False
        semana_str = semana_inicio.isoformat() if hasattr(semana_inicio, 'isoformat') else str(semana_inicio)
        return self.semana_fechada.get(semana_str, False)
    
    def fechar_semana(self, semana_inicio):
        """Marca uma semana como fechada"""
        if not self.semana_fechada:
            self.semana_fechada = {}
        semana_str = semana_inicio.isoformat() if hasattr(semana_inicio, 'isoformat') else str(semana_inicio)
        self.semana_fechada[semana_str] = True
        self.save()
    
    def abrir_semana(self, semana_inicio):
        """Marca uma semana como aberta (remove do dicionário)"""
        if not self.semana_fechada:
            return
        semana_str = semana_inicio.isoformat() if hasattr(semana_inicio, 'isoformat') else str(semana_inicio)
        if semana_str in self.semana_fechada:
            del self.semana_fechada[semana_str]
            self.save()


class CardDateChangeRequestStatus(models.TextChoices):
    PENDING = 'pending', 'Pendente'
    APPROVED = 'approved', 'Aprovado'
    REJECTED = 'rejected', 'Recusado'


class CardDueDateChangeRequest(models.Model):
    """
    Solicitação de alteração de data de entrega (data_fim) do card.

    Avaliada por supervisor/admin. Em aprovação, a hora é preservada e somente o dia é alterado.
    """
    card = models.ForeignKey(
        Card,
        on_delete=models.CASCADE,
        related_name='due_date_change_requests',
        verbose_name='Card'
    )
    requested_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='due_date_change_requests_created',
        verbose_name='Solicitado Por'
    )
    requested_date = models.DateField(verbose_name='Nova Data Solicitada')
    reason = models.TextField(blank=True, null=True, verbose_name='Motivo')
    status = models.CharField(
        max_length=20,
        choices=CardDateChangeRequestStatus.choices,
        default=CardDateChangeRequestStatus.PENDING,
        verbose_name='Status'
    )
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name='due_date_change_requests_reviewed',
        null=True,
        blank=True,
        verbose_name='Avaliado Por'
    )
    reviewed_at = models.DateTimeField(null=True, blank=True, verbose_name='Data de Avaliação')
    created_at = models.DateTimeField(auto_now_add=True, verbose_name='Data de Criação')
    updated_at = models.DateTimeField(auto_now=True, verbose_name='Data de Atualização')

    class Meta:
        verbose_name = 'Solicitação de Mudança de Data de Entrega'
        verbose_name_plural = 'Solicitações de Mudança de Data de Entrega'
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['status', '-created_at']),
            models.Index(fields=['card', 'status']),
            models.Index(fields=['requested_by', '-created_at']),
        ]

    def __str__(self):
        return f"{self.card.nome} -> {self.requested_date} ({self.get_status_display()})"


class WeeklyPriority(models.Model):
    """Prioridade da semana definida pelo supervisor para cada usuário"""
    usuario = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='weekly_priorities',
        verbose_name='Usuário',
        limit_choices_to={'role__in': ['gerente', 'desenvolvedor', 'dados']}
    )
    card = models.ForeignKey(
        Card,
        on_delete=models.CASCADE,
        related_name='weekly_priorities',
        verbose_name='Card'
    )
    semana_inicio = models.DateField(
        verbose_name='Início da Semana (Segunda-feira)',
        help_text='Data da segunda-feira da semana'
    )
    semana_fim = models.DateField(
        verbose_name='Fim da Semana (Sexta-feira)',
        help_text='Data da sexta-feira da semana'
    )
    definido_por = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name='weekly_priorities_defined',
        null=True,
        blank=True,
        verbose_name='Definido por',
        limit_choices_to={'role__in': ['supervisor', 'admin']}
    )
    created_at = models.DateTimeField(auto_now_add=True, verbose_name='Data de Criação')
    updated_at = models.DateTimeField(auto_now=True, verbose_name='Data de Atualização')

    class Meta:
        verbose_name = 'Prioridade Semanal'
        verbose_name_plural = 'Prioridades Semanais'
        unique_together = [['usuario', 'card', 'semana_inicio']]  # Um usuário pode ter múltiplas prioridades por semana, mas não o mesmo card duplicado
        ordering = ['-semana_inicio', 'usuario']

    def __str__(self):
        return f"{self.usuario.username} - {self.card.nome} ({self.semana_inicio} a {self.semana_fim})"

    def is_concluido(self):
        """Verifica se o card foi concluído"""
        return self.card.status == 'finalizado'

    def is_atrasado(self):
        """Verifica se o card está atrasado (não concluído até o horário limite de sexta-feira)"""
        from django.utils import timezone
        from datetime import datetime, time
        
        config = WeeklyPriorityConfig.get_config()
        horario_limite = config.horario_limite
        
        # Criar datetime para sexta-feira da semana com o horário limite
        limite_datetime = datetime.combine(self.semana_fim, horario_limite)
        limite_datetime = timezone.make_aware(limite_datetime)
        
        # Se o card não está concluído e já passou o horário limite
        if not self.is_concluido() and timezone.now() > limite_datetime:
            return True
        
        return False


class Notification(models.Model):
    usuario = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='notifications',
        verbose_name='Usuário'
    )
    tipo = models.CharField(
        max_length=30,
        choices=NotificationType.choices,
        verbose_name='Tipo de Notificação'
    )
    titulo = models.CharField(max_length=200, verbose_name='Título')
    mensagem = models.TextField(verbose_name='Mensagem')
    lida = models.BooleanField(default=False, verbose_name='Lida')
    data_criacao = models.DateTimeField(auto_now_add=True, verbose_name='Data de Criação')
    # Referências para navegação
    card_id = models.IntegerField(null=True, blank=True, verbose_name='ID do Card')
    sprint_id = models.IntegerField(null=True, blank=True, verbose_name='ID da Sprint')
    project_id = models.IntegerField(null=True, blank=True, verbose_name='ID do Projeto')
    # Metadados extras
    metadata = models.JSONField(default=dict, blank=True, verbose_name='Metadados')

    class Meta:
        verbose_name = 'Notificação'
        verbose_name_plural = 'Notificações'
        ordering = ['-data_criacao']
        indexes = [
            models.Index(fields=['usuario', 'lida', '-data_criacao']),
            models.Index(fields=['usuario', '-data_criacao']),
        ]

    def __str__(self):
        return f"{self.titulo} - {self.usuario.username} ({'Lida' if self.lida else 'Não lida'})"
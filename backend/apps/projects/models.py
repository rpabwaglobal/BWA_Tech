import threading

from django.db import models, transaction
from django.conf import settings
from django.core.validators import MinValueValidator
from django.utils import timezone
from datetime import datetime
import logging
from apps.accounts.models import CompartilhamentoSetorBase


class Sprint(models.Model):
    nome = models.CharField(max_length=100, verbose_name='Nome da Sprint')
    data_inicio = models.DateTimeField(verbose_name='Data e hora de início')
    fechamento_em = models.DateTimeField(verbose_name='Data e hora de fechamento')
    duracao_dias = models.IntegerField(
        validators=[MinValueValidator(1)],
        verbose_name='Duração em Dias'
    )
    # A sprint é acervo: continua no histórico depois que quem a criou sai da
    # empresa. PROTECT porque Project.sprint e Card.projeto são CASCADE — apagar
    # o supervisor levaria a sprint junto e, atrás dela, projetos e cards.
    supervisor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name='sprints_created',
        verbose_name='Supervisor'
    )
    finalizada = models.BooleanField(default=False, verbose_name='Finalizada')
    # Sprint "sistêmica": âncora de um fluxo interno (hoje só o "Monitoramento de
    # feedbacks"), NUNCA um ciclo de trabalho. Fica fora da lista de sprints, das
    # métricas, do fechamento automático e da replicação.
    # Substitui o hardcoding por nome, exatamente como `Project.is_system`.
    #
    # O campo era INEVITÁVEL: os dois discriminadores que já existiam
    # (`finalizada` e a janela `data_inicio`/`fechamento_em`) puxam para lados
    # opostos. Com `fechamento_em` no PASSADO, `_sprint_efetivamente_fechada`
    # (views.py) trancaria todo card de feedback e `finalizar_sprints_por_data`
    # fecharia a sprint sozinha; com ele no FUTURO — que é o valor que usamos —
    # a sprint apareceria como "em andamento" no menu, no Dashboard e como
    # destino de replicação. Nenhum valor resolve os dois lados; a flag resolve.
    is_system = models.BooleanField(
        default=False,
        db_index=True,
        verbose_name='Sprint Sistêmica',
        help_text='Sprints sistêmicas ancoram fluxos internos (ex.: Monitoramento de '
                  'feedbacks) e são excluídas de listagens, métricas, fechamento '
                  'automático e replicação.',
    )
    # Segmentação por setor (Fase 4+): Sprint é a autoridade; Project/Card herdam.
    # `setor` = setor dono; `setores_compartilhados` = outros setores que também
    # enxergam esta sprint. null=True durante a migração (backfill preenche tudo).
    setor = models.ForeignKey(
        'accounts.SetorCatalogo', on_delete=models.PROTECT, blank=True,
        db_index=True, related_name='sprints', verbose_name='Setor')
    setores_compartilhados = models.ManyToManyField(
        'accounts.SetorCatalogo', blank=True, related_name='sprints_compartilhadas',
        through='projects.SprintCompartilhamento',
        verbose_name='Setores com quem compartilha')
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

        # `is_system` entra no early-return junto com `finalizada`: a sprint
        # sistêmica nunca fecha, e `fechamento_em` dela é NOT NULL e fica ~100
        # anos no futuro. Sem esta condição, TODA gravação dela publicaria um
        # `fechar_sprint_em_hora` no broker apontando para a sprint que não deve
        # fechar — lixo permanente na fila.
        if self.finalizada or self.is_system or not self.fechamento_em:
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
        verbose_name='Gerente Atribuído'
    )
    # Qualquer usuário pode ser atribuído: quem pode atribuir é decidido por permissão, não pelo cargo
    desenvolvedor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name='projects_assigned',
        null=True,
        blank=True,
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
    # Arquivamento (soft delete reversível) — projetos arquivados somem das
    # operações diárias (Kanban, Prioridades, Dashboard) mas mantêm cards/logs
    # intactos. Hard delete continua disponível via destroy() do viewset.
    arquivado = models.BooleanField(default=False, db_index=True, verbose_name='Arquivado')
    arquivado_em = models.DateTimeField(null=True, blank=True, verbose_name='Arquivado em')
    arquivado_por = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name='projetos_arquivados',
        null=True,
        blank=True,
        verbose_name='Arquivado por',
    )
    # Projeto "sistêmico" (Suporte, Sugestões, Projetos Descartados).
    # Excluído de métricas, dashboards e bulk-archive/delete.
    # Substitui o hardcoding por nome no frontend.
    is_system = models.BooleanField(
        default=False,
        db_index=True,
        verbose_name='Projeto Sistêmico',
        help_text='Projetos sistêmicos (Suporte, Sugestões, Projetos Descartados) são excluídos de métricas e operações em massa.',
    )
    # Segmentação por setor (Fase 4+): default herdado da sprint no save().
    setor = models.ForeignKey(
        'accounts.SetorCatalogo', on_delete=models.PROTECT, blank=True,
        db_index=True, related_name='projetos', verbose_name='Setor')
    setores_compartilhados = models.ManyToManyField(
        'accounts.SetorCatalogo', blank=True, related_name='projetos_compartilhados',
        through='projects.ProjectCompartilhamento',
        verbose_name='Setores com quem compartilha')
    created_at = models.DateTimeField(auto_now_add=True, verbose_name='Data de Criação')
    updated_at = models.DateTimeField(auto_now=True, verbose_name='Data de Atualização')

    class Meta:
        verbose_name = 'Projeto'
        verbose_name_plural = 'Projetos'
        ordering = ['-created_at']

    def save(self, *args, **kwargs):
        # Herda o setor da sprint quando não definido (registros criados entre
        # deploys nunca ficam órfãos).
        if self.setor_id is None and self.sprint_id:
            self.setor_id = Sprint.objects.filter(pk=self.sprint_id).values_list('setor_id', flat=True).first()
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.nome} - {self.get_status_display()}"


class CardStatus(models.TextChoices):
    A_DESENVOLVER = 'a_desenvolver', 'A Desenvolver'
    EM_DESENVOLVIMENTO = 'em_desenvolvimento', 'Em Desenvolvimento'
    PARADO_PENDENCIAS = 'parado_pendencias', 'Parado por Pendências'
    EM_HOMOLOGACAO = 'em_homologacao', 'Em Homologação'
    FINALIZADO = 'finalizado', 'Finalizado'
    INVIABILIZADO = 'inviabilizado', 'Inviabilizado'


# Status que encerram o card. "ABERTO" é sempre definido pela NEGATIVA
# (`.exclude(status__in=CARD_STATUS_FECHADOS)`) — é a forma que o projeto já usa
# nos ~9 lugares onde a pergunta aparece, e é o lado seguro: um status que não
# esteja nesta dupla cai em "aberto", ou seja, continua sendo trabalho vivo.
#
# `KanbanStage.is_terminal` NÃO governa esta decisão, de propósito: aquele flag
# hoje é só decoração de UI e `KanbanStageViewSet` só exige
# `manage_global_kanban_stages` no `perform_create` (views.py) — qualquer um com
# `view_content` consegue virá-lo. Amarrar regra de negócio nele deixaria um
# não-privilegiado escolher, por exemplo, de quais cards o responsável some.
# Hoje as duas definições coincidem por causa do seed da migration 0028; se
# alguém criar uma etapa terminal customizada, ela é tratada como aberta.
CARD_STATUS_FECHADOS = (CardStatus.FINALIZADO, CardStatus.INVIABILIZADO)


class KanbanStage(models.Model):
    """
    Etapa/coluna global do Kanban.

    A `key` deve ser compatível com os valores atuais (Card.status já usa strings como
    'a_desenvolver', 'em_desenvolvimento', etc).
    """

    # `unique=True` SAIU daqui e virou duas constraints parciais (ver Meta).
    # A key deixou de ser única no sistema para ser única DENTRO do seu dono:
    # global entre as globais, e por projeto entre as do projeto. É isso que
    # permite dois projetos terem, cada um, a sua coluna "Backlog".
    key = models.CharField(max_length=50, verbose_name='Key (status)')
    label = models.CharField(max_length=100, verbose_name='Label')

    # DONO DA ETAPA. NULL = global (catálogo do sistema); preenchido = a coluna
    # pertence àquele projeto e não aparece para mais ninguém.
    #
    # CASCADE porque a coluna não tem vida fora do projeto: apagou o projeto,
    # apagou o quadro dele. Os cards do projeto morrem junto pelo mesmo caminho,
    # então não sobra card apontando para etapa inexistente.
    #
    # A key NÃO ganha prefixo nem sufixo para desambiguar. `Card.status` é
    # varchar(20) e a maior key do sistema já tem 19 — qualquer namespace
    # estouraria o campo no primeiro arraste. Quem separa é a constraint.
    projeto = models.ForeignKey(
        'projects.Project',
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='etapas_proprias',
        verbose_name='Projeto dono',
        help_text='Vazio = etapa global do catálogo. Preenchido = coluna deste projeto.',
    )

    # Comportamento (usado na UI para lógica terminal e campos obrigatórios)
    is_terminal = models.BooleanField(default=False, verbose_name='Etapa Terminal')
    requires_required_data = models.BooleanField(default=False, verbose_name='Requer Dados Obrigatórios')

    # Etapa que NÃO aparece no catálogo global (`GET /api/kanban-stages/`), que é
    # de onde a UI de "adicionar coluna" se alimenta.
    #
    # POR QUE UM CAMPO, e não um `if key in (...)`: o board de um projeto já é
    # recortado por `ProjectKanbanStageConfig`, então criar uma etapa nova não
    # adiciona coluna a ninguém. O furo que sobra é o SELETOR: sem isto, um
    # supervisor com `manage_kanban_config` poderia adicionar "Aguardando 30
    # dias" a um projeto comum. Uma lista de keys cravada aqui colocaria
    # conhecimento do app de feedbacks dentro de `projects` — é justamente o que
    # o flag evita, e é o mesmo raciocínio de `Project.is_system`.
    oculta_no_catalogo = models.BooleanField(
        default=False,
        verbose_name='Oculta no catálogo global',
        help_text='Etapas de fluxos internos (ex.: monitoramento de feedbacks) não '
                  'podem ser adicionadas a projetos comuns pela tela de etapas.',
    )

    created_at = models.DateTimeField(auto_now_add=True, verbose_name='Data de Criação')
    updated_at = models.DateTimeField(auto_now=True, verbose_name='Data de Atualização')

    class Meta:
        verbose_name = 'Etapa do Kanban'
        verbose_name_plural = 'Etapas do Kanban'
        ordering = ['key']
        constraints = [
            # DUAS constraints PARCIAIS no lugar do `unique=True` antigo.
            # Uma só, sobre (projeto, key), não serviria: no Postgres NULL nunca
            # é igual a NULL, então todas as globais escapariam da checagem e
            # nada impediria duas etapas globais com a mesma key.
            models.UniqueConstraint(
                fields=['key'],
                condition=models.Q(projeto__isnull=True),
                name='kanbanstage_key_global_unica',
            ),
            models.UniqueConstraint(
                fields=['projeto', 'key'],
                condition=models.Q(projeto__isnull=False),
                name='kanbanstage_key_unica_por_projeto',
            ),
        ]

    def __str__(self):
        return f'{self.label} ({self.key})'


def keys_reservadas() -> set:
    """Chaves que um projeto NÃO pode usar ao criar uma coluna própria.

    São duas famílias, e nenhuma delas está cravada como lista aqui:

    - As do CICLO DE VIDA (`CardStatus`), comparadas como string crua em
      métricas, filtros de relatório, `CARD_STATUS_FECHADOS` e no gatilho que
      gera o pedido de feedback ao finalizar um card. Um projeto com a própria
      "Finalizado" entraria nessas contas sem ninguém ter pedido, e a
      divergência apareceria num número de relatório, longe da causa.

    - As de FLUXO INTERNO, descobertas por `oculta_no_catalogo` em vez de
      listadas. Isso é deliberado e segue o mesmo raciocínio documentado no
      campo: cravar as keys do app `feedbacks` aqui colocaria conhecimento dele
      dentro de `projects`, que é justamente o que o flag existe para evitar.
      Fluxos internos futuros ficam cobertos sem tocar neste arquivo.
    """
    reservadas = set(CardStatus.values)
    reservadas |= set(
        KanbanStage.objects.filter(oculta_no_catalogo=True).values_list('key', flat=True)
    )
    return reservadas


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

    # CÓPIA DA KEY DA ETAPA, para o banco poder impedir duas colunas homônimas
    # no MESMO quadro.
    #
    # `unique_together('project', 'stage')` impede repetir a mesma ETAPA, não a
    # mesma KEY: com colunas por projeto, um projeto poderia ter configurada a
    # global `backlog` e mais a `backlog` própria. Como `Card.status` guarda a
    # string, o card passaria a pertencer às duas colunas ao mesmo tempo, e
    # todo código que resolve a coluna pela key escolheria no escuro DENTRO do
    # próprio projeto.
    #
    # A trava tinha de ser sobre `stage__key`, e `UniqueConstraint` só aceita
    # campos locais — atravessar o join é recusado na checagem do modelo. Daí a
    # desnormalização. Ela é segura porque a key é IMUTÁVEL depois de criada
    # (ver KanbanStageSerializer): o valor copiado não tem como ficar velho.
    stage_key = models.CharField(max_length=50, blank=True, verbose_name='Key da etapa')

    created_at = models.DateTimeField(auto_now_add=True, verbose_name='Data de Criação')
    updated_at = models.DateTimeField(auto_now=True, verbose_name='Data de Atualização')

    class Meta:
        verbose_name = 'Configuração de Etapas do Kanban por Projeto'
        verbose_name_plural = 'Configurações de Etapas do Kanban por Projeto'
        unique_together = [('project', 'stage')]
        ordering = ['order', 'stage__key']
        constraints = [
            models.UniqueConstraint(
                fields=['project', 'stage_key'],
                name='config_key_unica_por_projeto',
            ),
        ]

    def save(self, *args, **kwargs):
        # Mantém a cópia em dia sozinha. Deixar isso a cargo de quem cria a
        # config espalharia a responsabilidade por três lugares (a action de
        # adicionar, a replicação de sprint e o preenchimento das etapas padrão)
        # e bastaria um esquecer para a constraint parar de valer em silêncio.
        if self.stage_id and not self.stage_key:
            self.stage_key = self.stage.key
        super().save(*args, **kwargs)

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
    segundos_corridos_desenvolvimento = models.PositiveIntegerField(
        null=True,
        blank=True,
        verbose_name='Segundos corridos em desenvolvimento',
    )
    dias_uteis_desenvolvimento = models.PositiveSmallIntegerField(
        null=True,
        blank=True,
        verbose_name='Dias úteis em desenvolvimento',
    )
    minutos_uteis_desenvolvimento = models.PositiveIntegerField(
        null=True,
        blank=True,
        verbose_name='Minutos úteis em desenvolvimento',
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
    links = models.JSONField(
        default=list,
        blank=True,
        verbose_name='Links adicionais',
        help_text='Lista de links extras: [{"url": "...", "label": "..."}]'
    )
    # O checkbox do pedido original: "Gerar Formulário de Feedback".
    # Marcado aqui, no CARD, e não no projeto, porque a regra é UM formulário e
    # UM link POR CARD MARCADO — cinco marcados no mesmo projeto viram cinco
    # links distintos. O gatilho é o PROJETO virar "entregue"; quem decide QUAIS
    # cards geram é este campo.
    #
    # ATENÇÃO ao marcar: o NOME DESTE CARD é copiado para
    # `PedidoFeedback.referencia_publica` e é o que a pessoa de fora vê na página
    # anônima. É cópia congelada — renomear o card depois não muda o link já
    # enviado.
    gerar_formulario_feedback = models.BooleanField(
        default=False,
        verbose_name='Gerar formulário de feedback',
        help_text='Quando o projeto for marcado como Entregue, este card gera um pedido '
                  'de feedback com link público próprio.',
    )
    created_at = models.DateTimeField(auto_now_add=True, verbose_name='Data de Criação')
    updated_at = models.DateTimeField(auto_now=True, verbose_name='Data de Atualização')

    # Setor: ESPELHO do projeto (não editável direto). Mantido no save() e na
    # reatribuição de projeto — resolve "card que muda de projeto".
    setor = models.ForeignKey(
        'accounts.SetorCatalogo', on_delete=models.PROTECT, blank=True,
        db_index=True, related_name='cards', verbose_name='Setor')
    # Compartilhamento pontual: empresta ESTE card a outros setores sem mover o
    # projeto inteiro. Como `setor` é espelho do projeto, é o único jeito de dar
    # acesso a um card específico. Herda também o que vier do projeto/sprint.
    setores_compartilhados = models.ManyToManyField(
        'accounts.SetorCatalogo', blank=True, related_name='cards_compartilhados',
        through='projects.CardCompartilhamento',
        verbose_name='Setores com acesso compartilhado')

    def save(self, *args, **kwargs):
        # data_inicio = instante em que o card entrou em desenvolvimento (não criação nem sprint).
        if self.status == CardStatus.A_DESENVOLVER:
            self.data_inicio = None
        # Espelha o setor do projeto (sempre reflete o projeto atual).
        if self.projeto_id:
            self.setor_id = Project.objects.filter(pk=self.projeto_id).values_list('setor_id', flat=True).first()
        super().save(*args, **kwargs)

    class Meta:
        verbose_name = 'Card'
        verbose_name_plural = 'Cards'
        ordering = ['projeto', 'prioridade', 'created_at']

    def __str__(self):
        return f"{self.nome} - {self.projeto.nome}"


def caminho_anexo_card(instance, filename):
    """Nome aleatório para o anexo, preservando só a extensão.

    O arquivo é servido por `/media/` sem exigir header (o SPA aponta um
    `<a download>` direto para ele), então o nome é a única barreira: gravado
    com o nome original, `/media/card_anexos/contrato-cliente.pdf` seria
    adivinhável de fora. O nome amigável fica em `nome_original` e é o que
    aparece na interface e no download."""
    import uuid
    from pathlib import Path

    extensao = Path(filename).suffix.lower()[:12]
    return f'card_anexos/{uuid.uuid4().hex}{extensao}'


class CardAnexo(models.Model):
    """Arquivo anexado a um card (imagem, PDF, CSV, Excel, documento, etc.).

    Um card pode ter vários anexos. O arquivo fica no storage local (media/),
    servido por `config.views.serve_media`."""

    card = models.ForeignKey(
        Card,
        on_delete=models.CASCADE,
        related_name='anexos',
        verbose_name='Card',
    )
    arquivo = models.FileField(upload_to=caminho_anexo_card, verbose_name='Arquivo')
    nome_original = models.CharField(max_length=255, blank=True, verbose_name='Nome original')
    tamanho = models.PositiveBigIntegerField(default=0, verbose_name='Tamanho (bytes)')
    enviado_por = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name='card_anexos_enviados',
        null=True,
        blank=True,
        verbose_name='Enviado por',
    )
    criado_em = models.DateTimeField(auto_now_add=True, verbose_name='Enviado em')

    class Meta:
        ordering = ['-criado_em']
        verbose_name = 'Anexo do card'
        verbose_name_plural = 'Anexos dos cards'

    def __str__(self):
        return f'{self.nome_original or self.arquivo.name} (card #{self.card_id})'


class CachedHoliday(models.Model):
    """Cache local de feriados (Feriados API) para cálculo de dias úteis em Natal/RN."""

    date = models.DateField(verbose_name='Data')
    year = models.PositiveSmallIntegerField(verbose_name='Ano')
    name = models.CharField(max_length=200, verbose_name='Nome')
    tipo = models.CharField(max_length=20, verbose_name='Tipo')
    ibge = models.PositiveIntegerField(default=2408102, verbose_name='Código IBGE')
    synced_at = models.DateTimeField(auto_now=True, verbose_name='Sincronizado em')

    class Meta:
        verbose_name = 'Feriado em cache'
        verbose_name_plural = 'Feriados em cache'
        constraints = [
            models.UniqueConstraint(fields=['date', 'ibge'], name='projects_cachedholiday_date_ibge_uniq'),
        ]
        ordering = ['date']

    def __str__(self):
        return f'{self.date} — {self.name}'


# CardTodo e CardTodoStatus REMOVIDOS — sistema de subtarefas por card foi
# substituído por UserNote/UserNoteTodo (notas pessoais estilo Google Keep),
# definidos abaixo. CardTodo gerava muito ruído no banco e não era usado
# efetivamente. Ver migration `drop_cardtodo_add_usernote` para o cleanup.


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
    # O evento pertence ao card, não a quem o registrou: a autoria é rastro
    # pessoal e some com a conta, mas a pendência/comentário fica no histórico
    # (mesmo tratamento de CardLog.usuario).
    usuario = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name='events_created',
        null=True,
        blank=True,
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
    TRANSFERIDO_SPRINT = 'transferido_sprint', 'Transferido de Sprint'
    PENDENCIA = 'pendencia', 'Pendência'
    ATUALIZADO = 'atualizado', 'Atualizado'
    ALTERACAO = 'alteracao', 'Alteração no Card'
    RESPONSAVEL_ALTERADO = 'responsavel_alterado', 'Responsável Alterado'
    COMENTARIO = 'comentario', 'Comentário'
    # Reabertura é evento PRÓPRIO, e não um `atualizado`/`movimentado` qualquer:
    # ressuscitar trabalho já encerrado é a exceção que alguém vai querer achar
    # no histórico meses depois ("por que este card entregue voltou ao quadro?").
    # Enterrado dentro de 'atualizado' ele viraria mais uma linha de diff de
    # campos, indistinguível de uma troca de prioridade.
    REABERTO = 'reaberto', 'Card Reaberto'


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
    # CARD_TODO_UPDATED removido — decisão de produto (signals correspondentes
    # também apagados em signals.py). Registros antigos continuam no DB para histórico.
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

    Avaliada por supervisor/admin. Em aprovação, a data e hora solicitadas passam a ser o novo data_fim.
    """
    card = models.ForeignKey(
        Card,
        on_delete=models.CASCADE,
        related_name='due_date_change_requests',
        verbose_name='Card'
    )
    # Quem pediu é autoria, não o objeto do registro: a solicitação faz parte do
    # histórico de prazo do card e sobrevive anônima à saída da pessoa — mesma
    # regra de `reviewed_by`, logo abaixo.
    requested_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name='due_date_change_requests_created',
        null=True,
        blank=True,
        verbose_name='Solicitado Por'
    )
    requested_date = models.DateTimeField(verbose_name='Nova data e hora solicitada')
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


class CardReopenRequest(models.Model):
    """
    Solicitação de REABERTURA de um card fechado (finalizado ou inviabilizado).

    Irmão de `CardDueDateChangeRequest` de propósito: mesma anatomia (card,
    quem pediu, motivo, status, quem avaliou, quando), mesma fila na página de
    Projetos, mesma disciplina de escopo por setor. O que muda é o EFEITO da
    aprovação — lá o card só troca de prazo, aqui ele volta a existir como
    trabalho: status volta para "A Desenvolver" e o `data_fim` passa a ser a
    nova data informada.

    POR QUE a nova data é OBRIGATÓRIA (e não opcional como o `reason`):
    reabrir sem prazo devolveria ao quadro um card sem previsão de entrega —
    exatamente o estado que o resto da plataforma combate (alerta de atraso,
    vencimento em 24h/1h/10min, métricas de entrega no prazo, tudo depende de
    `data_fim`). Um card reaberto sem data seria invisível para todos esses
    mecanismos. Como o pedido é feito justamente porque a data anterior não
    valeu, é quem pede que precisa dizer a nova.

    Reaproveita `CardDateChangeRequestStatus`: são os mesmos três estados
    (pendente/aprovado/recusado), com o mesmo significado e os mesmos valores
    gravados. Um enum próprio seria uma cópia idêntica e obrigaria o frontend a
    aprender dois vocabulários para a mesma coluna de status.
    """
    card = models.ForeignKey(
        Card,
        on_delete=models.CASCADE,
        related_name='reopen_requests',
        verbose_name='Card'
    )
    # Autoria, não objeto do registro: a solicitação faz parte do histórico do
    # card e sobrevive anônima à saída da pessoa — mesma regra do irmão acima.
    requested_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name='reopen_requests_created',
        null=True,
        blank=True,
        verbose_name='Solicitado Por'
    )
    nova_data_entrega = models.DateTimeField(
        verbose_name='Nova data de entrega solicitada',
        help_text='Prazo que o card passa a ter quando a reabertura for aprovada.',
    )
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
        related_name='reopen_requests_reviewed',
        null=True,
        blank=True,
        verbose_name='Avaliado Por'
    )
    reviewed_at = models.DateTimeField(null=True, blank=True, verbose_name='Data de Avaliação')
    created_at = models.DateTimeField(auto_now_add=True, verbose_name='Data de Criação')
    updated_at = models.DateTimeField(auto_now=True, verbose_name='Data de Atualização')

    class Meta:
        verbose_name = 'Solicitação de Reabertura de Card'
        verbose_name_plural = 'Solicitações de Reabertura de Card'
        ordering = ['-created_at']
        indexes = [
            # A fila de pendências lê por status em ordem cronológica; a aba do
            # card lê por card; "meus pedidos" lê por solicitante.
            models.Index(fields=['status', '-created_at']),
            models.Index(fields=['card', 'status']),
            models.Index(fields=['requested_by', '-created_at']),
        ]

    def __str__(self):
        return f"Reabertura de {self.card.nome} -> {self.nova_data_entrega} ({self.get_status_display()})"


class WeeklyPriority(models.Model):
    """Prioridade da semana definida pelo supervisor para cada usuário"""
    # Prioridade pode ser definida para qualquer usuário; quem pode definir é decidido
    # pela permissão manage_weekly_priorities, não pelo cargo.
    # Aqui o usuário é o ALVO da prioridade (o autor é `definido_por`): sem ele o
    # registro não quer dizer nada e a unicidade (usuario, card, semana_inicio)
    # deixaria de valer, porque NULLs não colidem entre si. Daí PROTECT: a conta
    # só sai depois que as prioridades dela saírem.
    usuario = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name='weekly_priorities',
        verbose_name='Usuário'
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
        verbose_name='Definido por'
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


class UserNotificationPreference(models.Model):
    """Preferências por usuário de quais tipos de notificação ele deseja receber.

    Um registro por usuário (one-to-one). Quando o tipo está desativado,
    `send_notification()` nem cria a notificação no banco (filtragem no backend).

    Defaults:
    - 7 tipos ON (essenciais / pouco ruidosos)
    - 4 tipos OFF (opt-in: card_created, card_moved, sprint_created, role_changed)
    """

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='notification_preferences',
        verbose_name='Usuário',
    )
    # 7 default ON
    card_updated = models.BooleanField(default=True, verbose_name='Cards atualizados')
    card_deleted = models.BooleanField(default=True, verbose_name='Cards deletados')
    project_created = models.BooleanField(default=True, verbose_name='Projetos criados')
    card_overdue = models.BooleanField(default=True, verbose_name='Cards atrasados')
    card_due_24h = models.BooleanField(default=True, verbose_name='Vencimento em 24h')
    card_due_1h = models.BooleanField(default=True, verbose_name='Vencimento em 1h')
    card_due_10min = models.BooleanField(default=True, verbose_name='Vencimento em 10min')
    # 4 default OFF (opt-in)
    card_created = models.BooleanField(default=False, verbose_name='Cards criados')
    card_moved = models.BooleanField(default=False, verbose_name='Cards movidos')
    sprint_created = models.BooleanField(default=False, verbose_name='Sprints criadas')
    role_changed = models.BooleanField(default=False, verbose_name='Mudanças de cargo')

    updated_at = models.DateTimeField(auto_now=True, verbose_name='Atualizado em')

    class Meta:
        verbose_name = 'Preferência de notificação'
        verbose_name_plural = 'Preferências de notificação'

    def is_enabled(self, tipo: str) -> bool:
        """Retorna se o tipo está habilitado para receber notificações.

        Tipos desconhecidos retornam True (não bloqueia tipos novos adicionados
        antes do field correspondente existir no modelo)."""
        return bool(getattr(self, tipo, True))

    def __str__(self):
        return f"Preferências de {self.user.username}"

class UserNoteColor(models.TextChoices):
    """Paleta inspirada em papéis Color Plus / Sirio Color."""
    DEFAULT = 'default', 'Padrão'
    LILAS = 'lilas', 'Lilás (San Francisco)'
    ROSA = 'rosa', 'Rosa (Verona)'
    VERDE = 'verde', 'Verde (Tahiti)'
    AZUL = 'azul', 'Azul (Celeste)'
    BEGE = 'bege', 'Bege (Paglierino)'


class UserNote(models.Model):
    """Nota pessoal estilo Google Keep — privada por usuário.

    O conteúdo é uma sequência ordenada de `UserNoteItem` (blocos), permitindo
    intercalar parágrafos de texto e itens de checklist livremente. Atributos
    de nível-nota (título, cor, fixar, arquivar) ficam aqui.
    """
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='notes',
        verbose_name='Usuário',
    )
    title = models.CharField(max_length=200, blank=True, verbose_name='Título')
    color = models.CharField(
        max_length=20,
        choices=UserNoteColor.choices,
        default=UserNoteColor.DEFAULT,
        verbose_name='Cor',
    )
    pinned = models.BooleanField(default=False, verbose_name='Fixada')
    archived = models.BooleanField(default=False, verbose_name='Arquivada')
    order = models.IntegerField(default=0, verbose_name='Ordem de exibição')
    created_at = models.DateTimeField(auto_now_add=True, verbose_name='Criado em')
    updated_at = models.DateTimeField(auto_now=True, verbose_name='Atualizado em')

    class Meta:
        verbose_name = 'Nota'
        verbose_name_plural = 'Notas'
        ordering = ['-pinned', 'order', '-updated_at']
        indexes = [
            models.Index(fields=['user', 'archived', '-updated_at']),
            models.Index(fields=['user', 'pinned', '-updated_at']),
        ]

    def __str__(self):
        return f'{self.title or "(sem título)"} — {self.user.username}'


class UserNoteItemKind(models.TextChoices):
    TEXT = 'text', 'Texto'
    TODO = 'todo', 'Item de lista'


class UserNoteItem(models.Model):
    """Bloco dentro de uma UserNote. Pode ser um parágrafo de texto ou um
    item de checklist. A ordem entre blocos é livre — o frontend pode misturar
    text/todo na ordem desejada."""
    note = models.ForeignKey(
        UserNote,
        on_delete=models.CASCADE,
        related_name='items',
        verbose_name='Nota',
    )
    kind = models.CharField(
        max_length=10,
        choices=UserNoteItemKind.choices,
        default=UserNoteItemKind.TEXT,
        verbose_name='Tipo',
    )
    text = models.TextField(blank=True, verbose_name='Texto')
    done = models.BooleanField(default=False, verbose_name='Concluído (só p/ kind=todo)')
    order = models.IntegerField(default=0, verbose_name='Ordem')
    # Indentação tipo "tree" — pai dentro da mesma nota. Frontend pode aninhar
    # arrastando um item "pra frente" sobre outro. `on_delete=CASCADE` faz com
    # que apagar um pai apague os filhos junto (intencional: nó-pai some, sub-árvore some).
    parent = models.ForeignKey(
        'self',
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='children',
        verbose_name='Item pai (para indentação)',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'Item de nota'
        verbose_name_plural = 'Itens de nota'
        ordering = ['order', 'created_at']
        indexes = [
            models.Index(fields=['note', 'order']),
            models.Index(fields=['parent']),
        ]

    def __str__(self):
        if self.kind == UserNoteItemKind.TODO:
            return f'[{"x" if self.done else " "}] {self.text[:40]}'
        return self.text[:60]


class CardPin(models.Model):
    """Fixação de um card por usuário — atalho pessoal para acesso rápido.

    Apenas cards da sprint atual (não finalizada) e ainda não concluídos podem
    ser fixados. Quando o card é finalizado, todas as fixações dele são removidas
    automaticamente via signal.
    """
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='pinned_cards',
        verbose_name='Usuário',
    )
    card = models.ForeignKey(
        'Card',
        on_delete=models.CASCADE,
        related_name='pins',
        verbose_name='Card',
    )
    created_at = models.DateTimeField(auto_now_add=True, verbose_name='Fixado em')

    class Meta:
        verbose_name = 'Card fixado'
        verbose_name_plural = 'Cards fixados'
        ordering = ['-created_at']
        unique_together = [('user', 'card')]
        indexes = [
            models.Index(fields=['user', '-created_at']),
        ]

    def __str__(self):
        return f'{self.user.username} ⇩ {self.card_id}'


# ============================================================================
# Score (Pontuação de valor dos cards)
# ============================================================================

class SetorSolicitante(models.TextChoices):
    """Setor que solicitou a demanda (usado na tabela de Score)."""
    FISCAL = 'fiscal', 'Fiscal'
    CONTABIL = 'contabil', 'Contábil'
    MARKETING = 'marketing', 'Marketing'
    LEGALIZACAO = 'legalizacao', 'Legalização'
    PESSOAL = 'pessoal', 'Pessoal'
    DIRETORIA = 'diretoria', 'Diretoria'
    NOVOS_NEGOCIOS = 'novos_negocios', 'Novos Negócios'
    RH = 'rh', 'RH'


class ScoreCriterion(models.Model):
    """Campo configurável do formulário de Score (ex.: 'Redução de esforço').

    O supervisor pode adicionar / remover / editar critérios. Cada critério
    carrega seu próprio peso e sinal, de modo que a fórmula do Score é genérica:

        score = Σ ( (-1 se negativo senão +1) * peso * valor_escolhido )

    Isso reproduz a planilha original
    ``(0.3*Esforço + 0.25*Risco + 0.2*Escala) - (0.15*Complexidade + 0.1*Dependência)``
    e continua válida quando o supervisor adiciona ou remove campos.
    """
    nome = models.CharField(max_length=120, verbose_name='Nome do Critério')
    peso = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        default=0,
        verbose_name='Peso',
        help_text='Peso do critério na fórmula do Score (ex.: 0.30)'
    )
    negativo = models.BooleanField(
        default=False,
        verbose_name='Negativo',
        help_text='Se marcado, o critério subtrai do Score em vez de somar'
    )
    ordem = models.PositiveIntegerField(default=0, verbose_name='Ordem')
    ativo = models.BooleanField(default=True, verbose_name='Ativo')
    created_at = models.DateTimeField(auto_now_add=True, verbose_name='Data de Criação')
    updated_at = models.DateTimeField(auto_now=True, verbose_name='Data de Atualização')

    class Meta:
        verbose_name = 'Critério de Score'
        verbose_name_plural = 'Critérios de Score'
        ordering = ['ordem', 'id']

    def __str__(self):
        return self.nome


class ScoreCriterionOption(models.Model):
    """Opção (valor + descrição) de um critério de Score. Ex.: 0 = 'Não ajuda'."""
    criterion = models.ForeignKey(
        ScoreCriterion,
        on_delete=models.CASCADE,
        related_name='opcoes',
        verbose_name='Critério'
    )
    valor = models.IntegerField(verbose_name='Valor')
    descricao = models.CharField(max_length=200, verbose_name='Descrição')
    ordem = models.PositiveIntegerField(default=0, verbose_name='Ordem')

    class Meta:
        verbose_name = 'Opção de Critério'
        verbose_name_plural = 'Opções de Critério'
        ordering = ['ordem', 'valor']

    def __str__(self):
        return f'{self.criterion.nome}: {self.valor} — {self.descricao}'


class CardScore(models.Model):
    """Score atribuído a um card pelo supervisor."""
    card = models.OneToOneField(
        Card,
        on_delete=models.CASCADE,
        related_name='score',
        verbose_name='Card'
    )
    # Sem `choices`: o setor solicitante vem do catálogo (SetorCatalogo), que o
    # admin monta como quiser. Uma lista fixa aqui rejeitaria qualquer setor
    # criado depois — inclusive o setor padrão do sistema.
    setor_solicitante = models.CharField(
        max_length=40,
        null=True,
        blank=True,
        verbose_name='Setor Solicitante'
    )
    score_final = models.DecimalField(
        max_digits=7,
        decimal_places=2,
        default=0,
        verbose_name='Score Final'
    )
    criado_por = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='scores_criados',
        verbose_name='Criado por'
    )
    atualizado_por = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='scores_atualizados',
        verbose_name='Atualizado por'
    )
    created_at = models.DateTimeField(auto_now_add=True, verbose_name='Data de Criação')
    updated_at = models.DateTimeField(auto_now=True, verbose_name='Data de Atualização')

    class Meta:
        verbose_name = 'Score do Card'
        verbose_name_plural = 'Scores dos Cards'
        ordering = ['-updated_at']

    def __str__(self):
        return f'{self.card.nome} — {self.score_final}'

    def calcular_score(self):
        """Recalcula ``score_final`` a partir dos valores e pesos dos critérios ATIVOS.

        Critérios inativos não entram na fórmula (ficam ocultos na tela); seus
        valores permanecem no banco caso o critério seja reativado depois.
        """
        from decimal import Decimal
        total = Decimal('0')
        for valor in self.valores.select_related('criterion').all():
            criterion = valor.criterion
            if not criterion.ativo:
                continue
            contrib = criterion.peso * valor.valor
            total += (-contrib) if criterion.negativo else contrib
        self.score_final = total
        return total


class CardScoreValue(models.Model):
    """Valor escolhido para um critério dentro de um CardScore.

    Guarda o ``valor`` bruto (int), não uma FK para a opção, para que o histórico
    do card permaneça íntegro mesmo se o supervisor editar/remover opções depois.
    """
    card_score = models.ForeignKey(
        CardScore,
        on_delete=models.CASCADE,
        related_name='valores',
        verbose_name='Score'
    )
    criterion = models.ForeignKey(
        ScoreCriterion,
        on_delete=models.CASCADE,
        related_name='valores_atribuidos',
        verbose_name='Critério'
    )
    valor = models.IntegerField(verbose_name='Valor')

    class Meta:
        verbose_name = 'Valor de Critério do Score'
        verbose_name_plural = 'Valores de Critério do Score'
        unique_together = [('card_score', 'criterion')]

    def __str__(self):
        return f'{self.criterion.nome} = {self.valor}'


class ScoreHistoryAction(models.TextChoices):
    CRIADO = 'criado', 'Score Criado'
    EDITADO = 'editado', 'Score Editado'
    EXCLUIDO = 'excluido', 'Score Excluído'


class ScoreHistory(models.Model):
    """Histórico de alterações do Score de um card (coluna 'Histórico do Score')."""
    card = models.ForeignKey(
        Card,
        on_delete=models.CASCADE,
        related_name='score_historico',
        verbose_name='Card'
    )
    acao = models.CharField(
        max_length=20,
        choices=ScoreHistoryAction.choices,
        verbose_name='Ação'
    )
    score_final = models.DecimalField(max_digits=7, decimal_places=2, default=0)
    setor_solicitante = models.CharField(max_length=30, null=True, blank=True)
    snapshot = models.JSONField(
        default=list,
        blank=True,
        verbose_name='Snapshot',
        help_text='Cópia dos critérios/valores no momento da alteração'
    )
    usuario = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='score_historico_entries',
        verbose_name='Usuário'
    )
    data = models.DateTimeField(auto_now_add=True, verbose_name='Data')

    class Meta:
        verbose_name = 'Histórico de Score'
        verbose_name_plural = 'Históricos de Score'
        ordering = ['-data']

    def __str__(self):
        return f'{self.card.nome} — {self.get_acao_display()} ({self.data})'



class _CompartilhamentoProjects(CompartilhamentoSetorBase):
    """Só para não repetir a Meta abstrata nas três tabelas abaixo."""
    class Meta(CompartilhamentoSetorBase.Meta):
        abstract = True


class SprintCompartilhamento(_CompartilhamentoProjects):
    """Sprint emprestada a outro setor. É o compartilhamento mais amplo: pela
    cascata de `scoping.py`, alcança os projetos e os cards da sprint."""
    sprint = models.ForeignKey(
        Sprint, on_delete=models.CASCADE, related_name='compartilhamentos')

    class Meta:
        constraints = [models.UniqueConstraint(
            fields=['sprint', 'setor'], name='uniq_compartilhamento_sprint_setor')]
        # O escopo pergunta sempre "quais itens o setor S enxerga?" — o índice
        # segue essa ordem, e o `nivel` junto evita voltar à tabela no gate de
        # escrita.
        indexes = [models.Index(fields=['setor', 'nivel'], name='idx_compart_sprint_setor')]
        verbose_name = 'Compartilhamento de sprint'
        verbose_name_plural = 'Compartilhamentos de sprint'


class ProjectCompartilhamento(_CompartilhamentoProjects):
    """Projeto emprestado a outro setor; alcança os cards dele."""
    project = models.ForeignKey(
        Project, on_delete=models.CASCADE, related_name='compartilhamentos')

    class Meta:
        constraints = [models.UniqueConstraint(
            fields=['project', 'setor'], name='uniq_compartilhamento_project_setor')]
        indexes = [models.Index(fields=['setor', 'nivel'], name='idx_compart_project_setor')]
        verbose_name = 'Compartilhamento de projeto'
        verbose_name_plural = 'Compartilhamentos de projeto'


class CardCompartilhamento(_CompartilhamentoProjects):
    """Card avulso emprestado a outro setor, sem levar o projeto junto."""
    card = models.ForeignKey(
        Card, on_delete=models.CASCADE, related_name='compartilhamentos')

    class Meta:
        constraints = [models.UniqueConstraint(
            fields=['card', 'setor'], name='uniq_compartilhamento_card_setor')]
        indexes = [models.Index(fields=['setor', 'nivel'], name='idx_compart_card_setor')]
        verbose_name = 'Compartilhamento de card'
        verbose_name_plural = 'Compartilhamentos de card'

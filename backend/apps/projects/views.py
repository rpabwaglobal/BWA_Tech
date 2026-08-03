import logging
import os

from rest_framework import viewsets, filters, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView
from django_filters.rest_framework import DjangoFilterBackend
from django.db import transaction
from django.db.models import Q, Max, Count, F
from django.utils import timezone
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)
from .models import (
    Sprint,
    Project,
    KanbanStage,
    ProjectKanbanStageConfig,
    Card,
    CardAnexo,
    CardStatus,
    UserNote,
    CardPin,
    Event,
    CardLog,
    Notification,
    UserNotificationPreference,
    WeeklyPriority,
    WeeklyPriorityConfig,
    CardDueDateChangeRequest,
    CardLogEventType,
    ScoreCriterion,
    CardScore,
    CardScoreValue,
    ScoreHistory,
    ScoreHistoryAction,
    SetorSolicitante,
)
from .services import finalizar_sprint_replicacao, get_sprint_ids_atribuiveis
from apps.accounts.profile_picture_utils import get_profile_picture_url
from apps.accounts.models import Role
from apps.accounts.permissions import PodeVerConteudo, HasPerm, NaoVisitanteEscreve
from apps.accounts.scoping import checar_escrita_no_pai, scope_card_logs
from apps.accounts.sharing import CompartilhamentoSetorMixin
from apps.accounts.scoping import (scope_sprints, scope_projects, scope_cards,
                                   scope_card_scores, scope_users,
                                   scope_weekly_priorities, scope_events,
                                   scope_card_anexos, scope_card_pins,
                                   scope_card_date_change_requests,
                                   projetos_editaveis)
from .serializers import (
    SprintSerializer, ProjectSerializer, CardSerializer, CardKanbanSerializer,
    CardMetricsSerializer,
    UserNoteSerializer, CardPinSerializer, EventSerializer,
    CardLogSerializer, NotificationSerializer, NotificationPreferenceSerializer,
    WeeklyPrioritySerializer, WeeklyPriorityConfigSerializer,
    CardDueDateChangeRequestSerializer,
    KanbanStageSerializer,
    ScoreCriterionSerializer, CardScoreSerializer, CardPickerSerializer,
    CardAnexoSerializer,
)


def _move_project_cards_status(project, from_stage_key, to_stage_key, user=None):
    """
    Move cards entre etapas do Kanban.
    Quando envolve finalizado, salva um a um para disparar signals (finalizado_em + métricas).
    """
    cards_qs = Card.objects.filter(projeto=project, status=from_stage_key)
    involves_finalizado = (
        from_stage_key == CardStatus.FINALIZADO
        or to_stage_key == CardStatus.FINALIZADO
    )
    if involves_finalizado:
        moved = 0
        for card in cards_qs:
            card.status = to_stage_key
            if user is not None:
                card._request_user = user
            card.save()
            moved += 1
        return moved
    return cards_qs.update(status=to_stage_key)


def _sprint_efetivamente_fechada(sprint):
    """Sprint fechada: flag `finalizada` OU já passou do `fechamento_em`
    (mesma regra do frontend `isSprintPastFechamento`)."""
    if sprint is None:
        return False
    if sprint.finalizada:
        return True
    return sprint.fechamento_em is not None and sprint.fechamento_em <= timezone.now()


def _card_edicao_restrita(card):
    """True quando o card só pode ser editado/excluído por admin/supervisor:
    card finalizado/inviabilizado, ou pertencente a uma sprint já fechada."""
    if card.status in (CardStatus.FINALIZADO, CardStatus.INVIABILIZADO):
        return True
    sprint = getattr(card.projeto, 'sprint', None) if getattr(card, 'projeto_id', None) else None
    return _sprint_efetivamente_fechada(sprint)


def _ids_supervisao_prioridades():
    """IDs de quem supervisiona as prioridades em vez de executá-las.

    A página de Prioridades é uma lista de quem toca o trabalho: quem define e
    cobra as prioridades entra ali como leitor, não como linha da lista. Esse
    papel é justamente o de `manage_weekly_priorities` — direto no usuário,
    herdado pelo cargo Admin (accounts/auth_backends.py) ou implícito no
    superusuário, os três caminhos que `has_perm` reconhece.

    Retorna queryset de ids (subconsulta) para ser usado com `__in` sem trazer
    a lista para a memória.
    """
    from django.contrib.auth import get_user_model

    return get_user_model().objects.filter(
        Q(
            user_permissions__codename='manage_weekly_priorities',
            user_permissions__content_type__app_label='accounts',
        )
        | Q(role=Role.ADMIN)
        | Q(is_superuser=True)
    ).values_list('id', flat=True)


class SprintViewSet(CompartilhamentoSetorMixin, viewsets.ModelViewSet):
    queryset = Sprint.objects.all()
    serializer_class = SprintSerializer
    permission_classes = [IsAuthenticated, PodeVerConteudo]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ['supervisor']
    search_fields = ['nome']
    ordering_fields = ['data_inicio', 'fechamento_em', 'created_at']
    ordering = ['-data_inicio']

    def get_permissions(self):
        # Criar/editar/excluir sprint exige a permissão `manage_sprints`.
        # Restrições extras de sprint finalizada (manage_closed_sprints) ficam
        # em update/destroy.
        if self.action in ('create', 'update', 'partial_update', 'destroy'):
            return [PodeVerConteudo(), HasPerm('manage_sprints')()]
        return super().get_permissions()

    def update(self, request, *args, **kwargs):
        sprint = self.get_object()
        if _sprint_efetivamente_fechada(sprint) and not request.user.has_perm('accounts.manage_closed_sprints'):
            return Response(
                {'detail': 'Você não tem permissão para editar sprints finalizadas.'},
                status=status.HTTP_403_FORBIDDEN,
            )
        return super().update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        sprint = self.get_object()
        if _sprint_efetivamente_fechada(sprint) and not request.user.has_perm('accounts.manage_closed_sprints'):
            return Response(
                {'detail': 'Você não tem permissão para excluir sprints finalizadas.'},
                status=status.HTTP_403_FORBIDDEN,
            )
        return super().destroy(request, *args, **kwargs)

    def get_queryset(self):
        hoje = timezone.localdate()
        # Métricas agregadas excluem cards de projetos arquivados E sistêmicos
        # (Suporte/Sugestões/Descartados). Garante coerência com o frontend de
        # Métricas e com o CardViewSet.
        not_excluded = Q(projects__arquivado=False) & Q(projects__is_system=False)
        # Critério de atraso (alinhado com Metrics.tsx):
        # - Aberto atrasado: data_fim < hoje E status não-terminal
        # - Entregue atrasado: finalizado_em > data_fim (do próprio card)
        # NÃO comparamos com sprint.fechamento_em — a fonte de verdade é
        # `data_fim` do card. Inviabilizado nunca conta como entrega.
        qs = (
            Sprint.objects.all()
            .annotate(
                cards_total=Count('projects__cards', filter=not_excluded),
                cards_finalizados=Count(
                    'projects__cards',
                    filter=not_excluded
                    & Q(projects__cards__status='finalizado')
                    & Q(projects__cards__finalizado_em__isnull=False),
                ),
                cards_inviabilizados=Count(
                    'projects__cards',
                    filter=not_excluded & Q(projects__cards__status='inviabilizado'),
                ),
                cards_em_andamento=Count(
                    'projects__cards',
                    filter=not_excluded
                    & Q(projects__cards__status__in=['em_desenvolvimento', 'em_homologacao']),
                ),
                cards_em_atraso=Count(
                    'projects__cards',
                    filter=not_excluded & (
                        (
                            Q(projects__cards__data_fim__date__lt=hoje)
                            & ~Q(projects__cards__status__in=['finalizado', 'inviabilizado'])
                        )
                        | (
                            Q(projects__cards__status='finalizado')
                            & Q(projects__cards__finalizado_em__isnull=False)
                            & Q(projects__cards__finalizado_em__gt=F('projects__cards__data_fim'))
                        )
                    ),
                ),
                cards_entregues_atrasados=Count(
                    'projects__cards',
                    filter=not_excluded
                    & Q(projects__cards__status='finalizado')
                    & Q(projects__cards__finalizado_em__isnull=False)
                    & Q(projects__cards__finalizado_em__gt=F('projects__cards__data_fim')),
                ),
                cards_abertos_atrasados=Count(
                    'projects__cards',
                    filter=not_excluded
                    & Q(projects__cards__data_fim__date__lt=hoje)
                    & ~Q(projects__cards__status__in=['finalizado', 'inviabilizado']),
                ),
            )
        )
        return scope_sprints(qs, self.request.user)  # fail-open enquanto flag OFF

    @action(detail=True, methods=['get'], url_path='bundle', permission_classes=[HasPerm('view_metrics')])
    def bundle(self, request, pk=None):
        """
        Endpoint agregado da SprintDetails: retorna em UMA request tudo que a
        página precisa carregar de início — sprint + projects + cards (de
        todos os projetos da sprint) + kanban_configs (por projeto).

        Antes: 1 (sprint) + 1 (projects) + N (cards/projeto) + N (kanban-config/projeto)
              = 2 + 2*N requests, paginação interna torna pior.
        Depois: 1 request, sem paginação, queries otimizadas.

        Cache HTTP curto (30s) alinhado com SWR do frontend.
        """
        sprint = self.get_object()
        # Projetos não-arquivados da sprint, com contagens já anotadas
        # (espelham as do ProjectViewSet).
        #
        # O escopo é reaplicado AQUI e não herdado do `get_object()`: aquele
        # escopou a SPRINT (`scope_sprints`), e o conteúdo dela nem sempre vem
        # junto por cascata. Com a sprint COMPARTILHADA a cascata cobre tudo
        # (`scope_projects` aceita `sprint_id__in=<sprints compartilhadas>`) e
        # bundle e `/api/projects/` concordam. Mas numa sprint do PRÓPRIO setor
        # o projeto só entra pelo `setor_id` dele ou por compartilhamento
        # explícito — e um projeto pode ter sido movido isoladamente
        # (`POST /api/setores/<X>/atribuir-dados/ {"project_ids": [...]}` troca o
        # setor do projeto sem tocar na sprint). Sem o escopo, esse projeto some
        # da listagem e continua visível aqui, com todos os cards. Bundle é o
        # endpoint que a tela de sprint carrega, então é exatamente onde a
        # divergência apareceria para todo mundo.
        projects = scope_projects(  # fail-open enquanto flag OFF
            Project.objects.filter(sprint=sprint, arquivado=False)
            .select_related('sprint')
            .annotate(
                cards_entregues_count=Count(
                    'cards',
                    filter=Q(cards__status='finalizado') & Q(cards__finalizado_em__isnull=False),
                ),
                cards_em_desenvolvimento_count=Count(
                    'cards', filter=Q(cards__status='em_desenvolvimento'),
                ),
            )
            .order_by('id'),
            request.user,
        )
        # Derivado DEPOIS do escopo de propósito: `project_ids` alimenta cards e
        # kanban configs, então restringir aqui já restringe os dois.
        project_ids = list(projects.values_list('id', flat=True))

        # Todos os cards dos projetos da sprint — single query com select_related
        # e annotate(events_count) (evita N+1 do SerializerMethodField).
        #
        # `scope_cards` aqui é cinto e suspensório, NÃO o fecho de um furo: todo
        # card deste queryset está num projeto de `project_ids`, que já passou
        # por `scope_projects`, e `scope_cards` aceita qualquer card cujo
        # `projeto_id` esteja entre os projetos visíveis — a mesma expressão.
        # Hoje ele não remove nenhuma linha, e não existe caminho para card de
        # setor divergente: `Card.setor` é espelho do projeto (models.py,
        # `Card.save`) e `atribuir-dados` NÃO aceita `card_ids` — move sempre
        # projeto e cards juntos (accounts/views.py). Fica porque o Card tem
        # `setor_id` e compartilhamento próprios: se as duas expressões
        # divergirem, é aqui que a divergência é barrada.
        # Os helpers filtram por colunas locais (`setor_id`/`pk`/`projeto_id`),
        # sem join novo — o `events_count` anotado acima não infla.
        cards = scope_cards(  # fail-open enquanto flag OFF
            Card.objects.filter(projeto_id__in=project_ids)
            .select_related('projeto', 'projeto__sprint', 'responsavel', 'criado_por', 'score')
            .annotate(events_count=Count('events'))
            .order_by('projeto_id', 'id'),
            request.user,
        )

        # Kanban configs por projeto. Pré-popula configs default em projetos
        # legados (igual ProjectViewSet.kanban_config). Em uma única query
        # com select_related stage.
        #
        # Sem escopo próprio de propósito: `ProjectKanbanStageConfig` não tem
        # setor — ela É o projeto (a lista de colunas do board). Tanto o laço de
        # pré-população quanto a consulta abaixo saem de `projects`/`project_ids`
        # já escopados, então a configuração de projeto invisível não é criada
        # nem devolvida.
        for project in projects:
            self._ensure_project_default_kanban_config_for_bundle(project)

        configs = (
            ProjectKanbanStageConfig.objects.filter(project_id__in=project_ids)
            .select_related('stage')
            .order_by('project_id', 'order', 'stage__key')
        )
        kanban_configs: dict[int, list[dict]] = {pid: [] for pid in project_ids}
        for cfg in configs:
            kanban_configs[cfg.project_id].append({
                'key': cfg.stage.key,
                'label': cfg.stage.label,
                'order': cfg.order,
                'is_terminal': cfg.stage.is_terminal,
                'requires_required_data': cfg.stage.requires_required_data,
            })

        # `self.get_queryset()` já passa por `scope_sprints`, então a sprint sai
        # escopada. As contagens agregadas que ele anota (cards_total, em atraso
        # etc.) somam os cards da sprint SEM olhar setor — de propósito: é
        # exatamente o número que `/api/sprints/` devolve na listagem, e mudar
        # só aqui recriaria a divergência que esta action acabou de fechar.
        payload = {
            'sprint': SprintSerializer(self.get_queryset().get(pk=sprint.pk)).data,
            'projects': ProjectSerializer(projects, many=True).data,
            'cards': CardKanbanSerializer(cards, many=True, context={'request': request}).data,
            'kanban_configs': kanban_configs,
        }
        response = Response(payload)
        response['Cache-Control'] = 'private, max-age=30'
        return response

    def _ensure_project_default_kanban_config_for_bundle(self, project):
        """Cópia local do _ensure_project_default_kanban_config do ProjectViewSet.
        Mantida aqui para evitar acoplamento entre viewsets — o método original
        é privado e idempotente (no-op se já há configs)."""
        if ProjectKanbanStageConfig.objects.filter(project=project).exists():
            return
        default_stage_keys_order = [
            'a_desenvolver', 'em_desenvolvimento', 'parado_pendencias',
            'em_homologacao', 'finalizado', 'inviabilizado',
        ]
        for idx, stage_key in enumerate(default_stage_keys_order):
            stage = KanbanStage.objects.filter(key=stage_key).first()
            if not stage:
                continue
            ProjectKanbanStageConfig.objects.get_or_create(
                project=project, stage=stage, defaults={'order': idx},
            )

    @action(detail=True, methods=['post'], url_path='finalizar')
    def finalizar(self, request, pk=None):
        if not request.user.has_perm('accounts.finalize_sprints'):
            return Response(
                {'detail': 'Você não tem permissão para finalizar sprints.'},
                status=status.HTTP_403_FORBIDDEN
            )
        sprint = self.get_object()
        result = finalizar_sprint_replicacao(sprint, criado_por_user=request.user)
        if result is None:
            return Response(
                {'detail': 'Nenhuma sprint de destino encontrada (em andamento ou próxima por data).'},
                status=status.HTTP_400_BAD_REQUEST
            )
        if result.get('ja_finalizada'):
            return Response({
                'detail': 'Sprint já estava finalizada.',
                **result,
            }, status=status.HTTP_200_OK)
        return Response({
            'detail': f"Sprint finalizada. {result['projetos_criados']} projeto(s) e {result['cards_copiados']} card(s) replicados para a sprint '{result['proxima_sprint_nome']}'.",
            **result,
        }, status=status.HTTP_200_OK)


class ProjectViewSet(CompartilhamentoSetorMixin, viewsets.ModelViewSet):
    queryset = Project.objects.all()
    serializer_class = ProjectSerializer
    permission_classes = [IsAuthenticated, PodeVerConteudo]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    # `arquivado` NÃO entra em filterset_fields — fazemos handling manual em
    # get_queryset (que aceita 'all' além de true/false). Se entrasse aqui,
    # o BooleanFilter do django-filter rejeitaria valores não-booleanos com 400.
    filterset_fields = ['sprint', 'gerente_atribuido', 'desenvolvedor', 'status']
    search_fields = ['nome', 'descricao']
    ordering_fields = ['created_at', 'data_criacao', 'data_entrega', 'arquivado_em']
    ordering = ['-created_at']

    def get_permissions(self):
        # Criar/editar projeto exige `manage_projects`. Excluir é coberto por
        # `_ensure_can_manage(delete_projects)` no destroy.
        if self.action in ('create', 'update', 'partial_update'):
            return [PodeVerConteudo(), HasPerm('manage_projects')()]
        return super().get_permissions()

    def get_queryset(self):
        # Contagens agregadas para evitar download de cards no frontend.
        # `cards_entregues_count` NÃO inclui inviabilizado (regra de negócio:
        # inviabilizado é cancelamento, não entrega).
        qs = (
            Project.objects.all()
            .annotate(
                cards_entregues_count=Count(
                    'cards',
                    filter=Q(cards__status='finalizado') & Q(cards__finalizado_em__isnull=False),
                ),
                cards_em_desenvolvimento_count=Count(
                    'cards',
                    filter=Q(cards__status__in=['em_desenvolvimento']),
                ),
            )
        )
        qs = scope_projects(qs, self.request.user)  # fail-open enquanto flag OFF
        # Em ações de detalhe (retrieve/update/destroy/custom @action detail=True)
        # NÃO filtramos por arquivado — caso contrário, acessar a URL direta de
        # um projeto arquivado retornaria 404, impedindo até de desarquivar.
        if self.action != 'list':
            return qs
        # LIST: filtro de arquivamento explícito via query param.
        # Default exclui arquivados (operação diária só quer "vivos").
        # `?arquivado=true` traz somente arquivados (tab dedicada), com ordering
        # natural por `-arquivado_em` (recém-arquivados primeiro).
        # `?arquivado=all` mostra tudo.
        param = (self.request.query_params.get('arquivado') or '').strip().lower()
        if param == 'all':
            return qs
        if param in ('true', '1', 'yes'):
            return qs.filter(arquivado=True).order_by('-arquivado_em', '-created_at')
        return qs.filter(arquivado=False)

    def perform_create(self, serializer):
        """
        Garante que todo projeto novo já nasça com a configuração padrão de etapas,
        mantendo compatibilidade para quem não seleciona etapas no frontend.
        """
        checar_escrita_no_pai(self.request.user, serializer.validated_data.get('sprint'))
        project = serializer.save()

        default_stage_keys_order = [
            'a_desenvolver',
            'em_desenvolvimento',
            'parado_pendencias',
            'em_homologacao',
            'finalizado',
            'inviabilizado',
        ]

        for idx, stage_key in enumerate(default_stage_keys_order):
            stage = KanbanStage.objects.filter(key=stage_key).first()
            if not stage:
                continue
            cfg, _ = ProjectKanbanStageConfig.objects.get_or_create(project=project, stage=stage, defaults={'order': idx})
            if cfg.order != idx:
                ProjectKanbanStageConfig.objects.filter(project=project, stage=stage).update(order=idx)

    def _is_supervisor_editor(self, request):
        # Gerenciar colunas do kanban do projeto e mover cards em massa.
        return request.user.has_perm('accounts.manage_kanban_config')

    def _ensure_project_default_kanban_config(self, project: Project):
        """
        Garante compatibilidade para projetos legados que não possuem
        ProjectKanbanStageConfig persistido.
        """
        has_any = ProjectKanbanStageConfig.objects.filter(project=project).exists()
        if has_any:
            return

        default_stage_keys_order = [
            'a_desenvolver',
            'em_desenvolvimento',
            'parado_pendencias',
            'em_homologacao',
            'finalizado',
            'inviabilizado',
        ]

        for idx, stage_key in enumerate(default_stage_keys_order):
            stage = KanbanStage.objects.filter(key=stage_key).first()
            if not stage:
                continue
            ProjectKanbanStageConfig.objects.get_or_create(
                project=project,
                stage=stage,
                defaults={'order': idx},
            )

    @action(detail=True, methods=['get'], url_path='kanban-config')
    def kanban_config(self, request, pk=None):
        """
        Retorna as etapas/colunas configuradas para o projeto em ordem.
        """
        project = self.get_object()
        self._ensure_project_default_kanban_config(project)
        configs = (
            ProjectKanbanStageConfig.objects.select_related('stage')
            .filter(project=project)
            .order_by('order', 'stage__key')
        )
        stages = [
            {
                'key': cfg.stage.key,
                'label': cfg.stage.label,
                'order': cfg.order,
                'is_terminal': cfg.stage.is_terminal,
                'requires_required_data': cfg.stage.requires_required_data,
            }
            for cfg in configs
        ]
        return Response({'project': project.id, 'stages': stages})

    @action(detail=True, methods=['post'], url_path='kanban-config/reorder')
    def kanban_config_reorder(self, request, pk=None):
        if not self._is_supervisor_editor(request):
            return Response(
                {'detail': 'Apenas supervisor ou admin podem reordenar etapas.'},
                status=status.HTTP_403_FORBIDDEN,
            )

        project = self.get_object()
        stage_keys_order = request.data.get('stage_keys_order')
        if not isinstance(stage_keys_order, list) or not all(isinstance(k, str) for k in stage_keys_order):
            return Response({'detail': 'stage_keys_order deve ser uma lista de strings.'}, status=status.HTTP_400_BAD_REQUEST)

        # Apenas reordenar o que já está configurado para o projeto
        existing_keys = set(
            ProjectKanbanStageConfig.objects.filter(project=project).values_list('stage__key', flat=True)
        )
        stage_keys_order = [k for k in stage_keys_order if k in existing_keys]

        for idx, key in enumerate(stage_keys_order):
            ProjectKanbanStageConfig.objects.filter(project=project, stage__key=key).update(order=idx)

        return Response({'detail': 'Ordem atualizada.'})

    @action(detail=True, methods=['post'], url_path='kanban-config/add')
    def kanban_config_add(self, request, pk=None):
        if not self._is_supervisor_editor(request):
            return Response(
                {'detail': 'Apenas supervisor ou admin podem adicionar etapas.'},
                status=status.HTTP_403_FORBIDDEN,
            )

        project = self.get_object()
        stage_key = request.data.get('stage_key')
        if not isinstance(stage_key, str) or not stage_key.strip():
            return Response({'detail': 'stage_key é obrigatório.'}, status=status.HTTP_400_BAD_REQUEST)
        stage_key = stage_key.strip()

        try:
            stage = KanbanStage.objects.get(key=stage_key)
        except KanbanStage.DoesNotExist:
            return Response({'detail': 'Etapa global não encontrada.'}, status=status.HTTP_404_NOT_FOUND)

        last_order = (
            ProjectKanbanStageConfig.objects.filter(project=project).aggregate(Max('order'))['order__max']
            if ProjectKanbanStageConfig.objects.filter(project=project).exists()
            else None
        )
        next_order = (last_order + 1) if last_order is not None else 0

        cfg, created = ProjectKanbanStageConfig.objects.get_or_create(
            project=project,
            stage=stage,
            defaults={'order': next_order},
        )
        if not created:
            # Se já existe, ajusta a ordem para o final
            cfg.order = next_order
            cfg.save(update_fields=['order'])

        return Response({'detail': 'Etapa adicionada.'})

    @action(detail=True, methods=['post'], url_path='kanban-config/remove')
    def kanban_config_remove(self, request, pk=None):
        if not self._is_supervisor_editor(request):
            return Response(
                {'detail': 'Apenas supervisor ou admin podem remover etapas.'},
                status=status.HTTP_403_FORBIDDEN,
            )

        project = self.get_object()
        stage_key = request.data.get('stage_key')
        move_to_key = request.data.get('move_to_key')

        if not isinstance(stage_key, str) or not stage_key.strip():
            return Response({'detail': 'stage_key é obrigatório.'}, status=status.HTTP_400_BAD_REQUEST)
        stage_key = stage_key.strip()

        cfg = ProjectKanbanStageConfig.objects.filter(project=project, stage__key=stage_key).first()
        if not cfg:
            return Response({'detail': 'Etapa não está configurada para este projeto.'}, status=status.HTTP_404_NOT_FOUND)

        # Card CRU de propósito (não passa por `scope_cards`): remover a coluna é
        # uma operação do BOARD DO PROJETO, e o projeto já veio escopado do
        # `get_object()` — todo card dele é visível para `scope_cards`, então
        # escopar aqui não mudaria nada. E se um dia mudasse, seria para pior: o
        # move abaixo deixaria os cards de fora parados num `status` cuja coluna
        # acabou de ser apagada — órfãos invisíveis no kanban. Quem senta na
        # coluna tem de sair dela.
        cards_count = Card.objects.filter(projeto=project, status=stage_key).count()
        if cards_count > 0 and (move_to_key is None or not str(move_to_key).strip()):
            return Response(
                {
                    'detail': 'Esta etapa possui cards. Eles precisam ser movidos antes de remover.',
                    'cards_count': cards_count,
                    'stage_key': stage_key,
                },
                status=status.HTTP_409_CONFLICT,
            )

        if cards_count > 0:
            move_to_key = str(move_to_key).strip()
            # validar destino
            dest_cfg = ProjectKanbanStageConfig.objects.filter(project=project, stage__key=move_to_key).first()
            if not dest_cfg:
                return Response(
                    {'detail': 'move_to_key deve ser uma etapa que ainda esteja configurada no projeto.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            _move_project_cards_status(project, stage_key, move_to_key, user=request.user)

        cfg.delete()
        return Response({'detail': 'Etapa removida.'})

    @action(detail=True, methods=['post'], url_path='kanban-config/move-cards')
    def kanban_config_move_cards(self, request, pk=None):
        """
        Move cards em bulk entre etapas (status) dentro de um mesmo projeto.
        """
        if not self._is_supervisor_editor(request):
            return Response(
                {'detail': 'Apenas supervisor ou admin podem mover cards entre etapas.'},
                status=status.HTTP_403_FORBIDDEN,
            )

        project = self.get_object()
        from_stage_key = request.data.get('from_stage_key')
        to_stage_key = request.data.get('to_stage_key')

        if not isinstance(from_stage_key, str) or not from_stage_key.strip():
            return Response({'detail': 'from_stage_key é obrigatório.'}, status=status.HTTP_400_BAD_REQUEST)
        if not isinstance(to_stage_key, str) or not to_stage_key.strip():
            return Response({'detail': 'to_stage_key é obrigatório.'}, status=status.HTTP_400_BAD_REQUEST)

        from_stage_key = from_stage_key.strip()
        to_stage_key = to_stage_key.strip()

        from_cfg = ProjectKanbanStageConfig.objects.filter(project=project, stage__key=from_stage_key).first()
        to_cfg = ProjectKanbanStageConfig.objects.filter(project=project, stage__key=to_stage_key).first()

        if not from_cfg:
            return Response(
                {'detail': 'from_stage_key não está configurada neste projeto.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not to_cfg:
            return Response(
                {'detail': 'to_stage_key não está configurada neste projeto.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Idem `kanban_config_remove`: card CRU de propósito. Esvaziar uma coluna
        # do board é operação do projeto (já escopado pelo `get_object()`, e todo
        # card de projeto visível passa por `scope_cards`), e deixar alguém para
        # trás esvaziaria a coluna só pela metade. A resposta devolve apenas
        # `moved_count` — nenhum dado de card sai daqui.
        cards_qs = Card.objects.filter(projeto=project, status=from_stage_key).only('id', 'nome')
        cards = list(cards_qs)
        if not cards:
            return Response({'detail': 'Nenhum card encontrado para mover.', 'moved_count': 0})

        _move_project_cards_status(project, from_stage_key, to_stage_key, user=request.user)

        logs = [
            CardLog(
                card_id=card.id,
                tipo_evento=CardLogEventType.MOVIMENTADO,
                descricao=f'Status movido: {from_stage_key} -> {to_stage_key}',
                usuario=request.user,
            )
            for card in cards
        ]
        CardLog.objects.bulk_create(logs)

        return Response({'detail': 'Cards movidos.', 'moved_count': len(cards)})

    # ------------------------------------------------------------------
    # Arquivamento + delete em massa
    # ------------------------------------------------------------------
    # Regra: apenas supervisor/admin podem arquivar, desarquivar ou excluir
    # projetos. Espelha o padrão existente de `_is_supervisor_editor`.

    # Limite máximo de cards "em jogo" listados por projeto no preview de
    # exclusão. Acima disso, o JSON cresceria demais e o modal ficaria lento.
    _PREVIEW_CARDS_LIMIT = 100

    def _ensure_can_manage(self, request, codename):
        """Retorna `Response` 403 se o usuário não tem a permissão `codename`.
        Caso contrário, retorna None (segue o fluxo)."""
        if not request.user.has_perm(f'accounts.{codename}'):
            return Response(
                {'detail': 'Você não tem permissão para esta ação.'},
                status=status.HTTP_403_FORBIDDEN,
            )
        return None

    def _resolve_ids(self, request):
        """Extrai e valida `{ids: [int, ...]}` do body. Devolve (ids, error_response)."""
        raw = request.data.get('ids')
        if not isinstance(raw, list) or not raw:
            return None, Response(
                {'detail': 'Forneça uma lista não-vazia em `ids`.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            ids = [int(x) for x in raw]
        except (TypeError, ValueError):
            return None, Response(
                {'detail': '`ids` deve conter apenas inteiros.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        # Defesa contra payload absurdo (DoS) — limite generoso mas finito.
        if len(ids) > 200:
            return None, Response(
                {'detail': 'Máximo 200 projetos por operação em massa.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return ids, None

    def _safe_ids(self, ids, escrita=False):
        """Remove IDs de projetos sistêmicos (is_system=True) e IDs fora do
        escopo de setor do usuário. Retorna (safe_ids, blocked_count).

        Defesa server-side: o frontend já omite esses, mas garantimos aqui pra
        clientes API diretos. Usa a flag `is_system` (verdade canônica)
        em vez de comparar nome — robusto contra renomeações.

        O escopo entra AQUI, e não em cada action, porque este é o único ponto
        que as quatro ações em massa compartilham: nenhuma delas chama
        `get_object()`, então nem o `get_queryset()` escopado (que é onde vive o
        `scope_projects`) nem o gate de objeto do `CompartilhamentoSetorMixin`
        — que só engata em rota de detalhe — entram em jogo. Sem isto, um
        `{ids: [1..200]}` alcança projeto de qualquer setor, e `bulk_project_actions`
        é permissão de CARGO: ela não implica `view_cross_setor`.

        `escrita=True` nas ações que MUTAM (arquivar/desarquivar/excluir):
        projeto emprestado ao setor apenas para LEITURA aparece na tela, mas não
        pode ser arquivado nem apagado. `projetos_editaveis` responde por essa
        distinção e obedece à flag de ESCRITA — separada da de visibilidade de
        propósito, para que ligar uma não comece a barrar a outra.

        Id fora do escopo simplesmente some do conjunto, e o contador
        `requested` continua devolvendo o total pedido — a resposta não vira
        oráculo de "existe mas não é seu".

        Com as flags OFF, os dois helpers devolvem o queryset inteiro e `safe`
        passa a conter exatamente os ids QUE EXISTEM (antes, id inexistente
        seguia na lista). Nenhuma resposta muda por causa disso: as quatro
        actions só usam `safe` em `filter(id__in=...)`, onde id inexistente
        nunca contribuiu com nada."""
        if not ids:
            return [], 0
        blocked_ids = set(
            Project.objects.filter(id__in=ids, is_system=True)
            .values_list('id', flat=True)
        )
        # Os dois helpers são consultados já restritos a `ids` (no máximo 200,
        # por `_resolve_ids`): a resolução dos ids acontece antes do filtro, como
        # no resto do módulo de escopo, e nenhuma das consultas varre a tabela.
        permitidos = set(
            scope_projects(Project.objects.filter(id__in=ids), self.request.user)
            .values_list('id', flat=True)  # fail-open enquanto flag OFF
        )
        if escrita:
            permitidos &= set(
                projetos_editaveis(self.request.user)
                .filter(id__in=ids).values_list('id', flat=True)
            )
        # Preserva a ordem pedida pelo cliente (o filtro é por pertencimento).
        safe = [i for i in ids if i not in blocked_ids and i in permitidos]
        return safe, len(blocked_ids)

    def destroy(self, request, *args, **kwargs):
        # NOTA DE COMPATIBILIDADE: antes desta mudança, qualquer usuário
        # autenticado podia chamar DELETE /projects/<id>/. Agora exige a
        # permissão `delete_projects`.
        forbidden = self._ensure_can_manage(request, 'delete_projects')
        if forbidden:
            return forbidden
        instance = self.get_object()
        if instance.is_system:
            return Response(
                {'detail': f'O projeto "{instance.nome}" é interno do sistema e não pode ser excluído.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return super().destroy(request, *args, **kwargs)

    @action(detail=False, methods=['post'], url_path='bulk-archive')
    def bulk_archive(self, request):
        forbidden = self._ensure_can_manage(request, 'bulk_project_actions')
        if forbidden:
            return forbidden
        ids, err = self._resolve_ids(request)
        if err:
            return err
        safe_ids, blocked = self._safe_ids(ids, escrita=True)
        now = timezone.now()
        with transaction.atomic():
            projects = (
                Project.objects.select_for_update()
                .filter(id__in=safe_ids, arquivado=False)
            )
            count = projects.update(arquivado=True, arquivado_em=now, arquivado_por=request.user)
        return Response({
            'arquivados': count,
            'requested': len(ids),
            'blocked_system_projects': blocked,
        })

    @action(detail=False, methods=['post'], url_path='bulk-unarchive')
    def bulk_unarchive(self, request):
        forbidden = self._ensure_can_manage(request, 'bulk_project_actions')
        if forbidden:
            return forbidden
        ids, err = self._resolve_ids(request)
        if err:
            return err
        safe_ids, blocked = self._safe_ids(ids, escrita=True)
        with transaction.atomic():
            projects = (
                Project.objects.select_for_update()
                .filter(id__in=safe_ids, arquivado=True)
            )
            # Preserva `arquivado_em` e `arquivado_por` como histórico do último
            # arquivamento — se desarquivar e re-arquivar depois, os valores são
            # sobrescritos com a nova data/usuário. Único custo: não distinguimos
            # "nunca foi arquivado" de "foi arquivado e desarquivado".
            count = projects.update(arquivado=False)
        return Response({
            'desarquivados': count,
            'requested': len(ids),
            'blocked_system_projects': blocked,
        })

    @action(detail=False, methods=['post'], url_path='bulk-delete-preview')
    def bulk_delete_preview(self, request):
        """Resumo do impacto antes do delete — usado pelo modal de confirmação.

        Lista, por projeto: total de cards e até `_PREVIEW_CARDS_LIMIT` cards
        "em jogo" (sprint ativa AND status não-terminal). Inclui flag de
        truncamento quando há mais.
        """
        forbidden = self._ensure_can_manage(request, 'bulk_project_actions')
        if forbidden:
            return forbidden
        ids, err = self._resolve_ids(request)
        if err:
            return err
        # `escrita=True` mesmo sendo um GET disfarçado de POST: este preview
        # existe só para anunciar o que o `bulk_delete` vai apagar. Listar aqui
        # um projeto que lá seria recusado (emprestado apenas para leitura)
        # prometeria uma exclusão que não acontece — e ainda entregaria o
        # backlog dele (nome, sprint e até 100 cards) de brinde.
        safe_ids, blocked = self._safe_ids(ids, escrita=True)

        # Importa local pra evitar ciclo com realtime.
        from .realtime import _sprint_is_active

        # Os projetos já vêm escopados (`_safe_ids`), mas os CARDS do prefetch
        # vão crus de propósito. Escopar não mudaria nada hoje — card de projeto
        # visível é card visível para `scope_cards` —, e se um dia mudasse seria
        # pelo lado errado: o delete é no PROJETO e o banco cascateia, apagando
        # TODO card da tabela. Um preview escopado anunciaria MENOS do que o
        # `bulk_delete` destrói, e perder trabalho sem aviso é pior do que ver o
        # nome de um card que já se ia perder de qualquer jeito. Se um dia o
        # delete passar a POUPAR o card fora do escopo, este prefetch tem de ser
        # escopado JUNTO, no mesmo commit.
        projects = (
            Project.objects.filter(id__in=safe_ids)
            .select_related('sprint')
            .prefetch_related('cards')
        )
        terminal_statuses = {'finalizado', 'inviabilizado'}
        result = []
        for p in projects:
            sprint = p.sprint  # já carregado via select_related — sem query extra
            sprint_active = _sprint_is_active(sprint)
            cards_em_jogo = []
            cards_em_jogo_total = 0
            cards_total = 0
            for c in p.cards.all():
                cards_total += 1
                if c.status in terminal_statuses:
                    continue
                if not sprint_active:
                    continue
                cards_em_jogo_total += 1
                # Apenas os primeiros _PREVIEW_CARDS_LIMIT entram no JSON.
                if len(cards_em_jogo) < self._PREVIEW_CARDS_LIMIT:
                    cards_em_jogo.append({
                        'id': str(c.id),
                        'nome': c.nome,
                        'status': c.status,
                        'status_display': c.get_status_display(),
                        'sprint_nome': sprint.nome if sprint else None,
                    })
            result.append({
                'id': p.id,
                'nome': p.nome,
                'total_cards': cards_total,
                'em_sprint_ativa': sprint_active,
                'sprint_nome': sprint.nome if sprint else None,
                'cards_em_jogo': cards_em_jogo,
                'cards_em_jogo_total': cards_em_jogo_total,
                'cards_em_jogo_truncated': cards_em_jogo_total > len(cards_em_jogo),
            })

        return Response({
            'total_projects': len(result),
            'blocked_system_projects': blocked,
            'projects': result,
        })

    @action(detail=False, methods=['post'], url_path='bulk-delete')
    def bulk_delete(self, request):
        """Hard delete. CASCADE elimina cards/logs/etc do model — sem
        recuperação. O frontend obrigatoriamente passou pelo preview antes."""
        forbidden = self._ensure_can_manage(request, 'bulk_project_actions')
        if forbidden:
            return forbidden
        ids, err = self._resolve_ids(request)
        if err:
            return err
        safe_ids, blocked = self._safe_ids(ids, escrita=True)
        with transaction.atomic():
            projects = Project.objects.filter(id__in=safe_ids)
            existing_ids = list(projects.values_list('id', flat=True))
            deleted, _ = projects.delete()
        return Response({
            'deleted_projects': len(existing_ids),
            'cascade_total': deleted,
            'requested': len(ids),
            'blocked_system_projects': blocked,
        })


class KanbanStageViewSet(viewsets.ModelViewSet):
    queryset = KanbanStage.objects.all().order_by('key')
    serializer_class = KanbanStageSerializer
    permission_classes = [IsAuthenticated, PodeVerConteudo, NaoVisitanteEscreve]

    def _is_supervisor_editor(self, request):
        return request.user.has_perm('accounts.manage_global_kanban_stages')

    def perform_create(self, serializer):
        if not self._is_supervisor_editor(self.request):
            from rest_framework.exceptions import PermissionDenied

            raise PermissionDenied('Você não tem permissão para criar etapas globais do Kanban.')
        serializer.save()


class CardViewSet(CompartilhamentoSetorMixin, viewsets.ModelViewSet):
    queryset = Card.objects.all()
    serializer_class = CardSerializer
    permission_classes = [IsAuthenticated, PodeVerConteudo, NaoVisitanteEscreve]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ['projeto', 'responsavel', 'status', 'prioridade', 'area', 'tipo']
    search_fields = ['nome', 'descricao']
    ordering_fields = ['created_at', 'prioridade', 'data_inicio', 'data_fim']
    ordering = ['-created_at']
    
    def get_queryset(self):
        """Aplica filtros de permissão baseados no usuário"""
        queryset = Card.objects.select_related(
            'projeto', 'projeto__sprint', 'criado_por', 'responsavel', 'score'
        ).annotate(events_count=Count('events'))
        # Cards de projetos arquivados somem do app inteiro em queries
        # genéricas (Kanban global, Prioridades). EXCEÇÃO: quando o cliente
        # filtra explicitamente por `?projeto=<id>` ou pede um card específico
        # via `/cards/<id>/`, ele sabe o que quer (ex.: visualizar projeto
        # arquivado em ProjectDetails) e não escondemos.
        is_specific_project = bool(self.request.query_params.get('projeto'))
        is_detail = self.action != 'list'
        if not is_specific_project and not is_detail:
            queryset = queryset.filter(projeto__arquivado=False)
        # Filtro adicional para buscar cards por responsável (para página Meus Afazeres)
        responsavel_id = self.request.query_params.get('responsavel', None)
        if responsavel_id:
            queryset = queryset.filter(responsavel_id=responsavel_id)
        return scope_cards(queryset, self.request.user)  # fail-open enquanto flag OFF
    
    def perform_create(self, serializer):
        """Define o criado_por automaticamente ao criar um card"""
        checar_escrita_no_pai(self.request.user, serializer.validated_data.get('projeto'))
        serializer.save(criado_por=self.request.user)

    @action(detail=False, methods=['get'], url_path='metrics', permission_classes=[HasPerm('view_metrics')])
    def metrics(self, request):
        """
        Endpoint slim para a página de Métricas.

        Retorna TODOS os cards (sem paginação) com APENAS os campos usados
        pelos cálculos de métricas. Cerca de 75% menor que o /cards/ padrão
        e sem N+1 (events_count não é incluído).

        Inclui cards de projetos arquivados para o frontend filtrar via
        `projeto_arquivado` (regra: arquivados ficam fora das métricas).
        Excluir aqui economiza pouco e introduziria divergência com o
        ProjectViewSet que pode listar arquivados em outros contextos.
        """
        qs = (
            Card.objects.select_related('projeto', 'projeto__sprint')
            .only(
                'id', 'nome', 'status', 'area', 'tipo', 'responsavel',
                'data_inicio', 'data_fim', 'finalizado_em',
                'segundos_corridos_desenvolvimento', 'dias_uteis_desenvolvimento',
                'minutos_uteis_desenvolvimento',
                'created_at', 'updated_at',
                'projeto__id', 'projeto__nome',
                'projeto__is_system', 'projeto__arquivado',
                'projeto__sprint',
            )
            .order_by('-finalizado_em', '-created_at')
        )
        qs = scope_cards(qs, request.user)  # escopa métricas por setor (fail-open enquanto flag OFF)
        serializer = CardMetricsSerializer(qs, many=True)
        response = Response(serializer.data)
        # Cache HTTP curto (60s) — alinhado com o cache SWR do frontend.
        # `private` porque o conjunto pode variar por permissão (futuro).
        response['Cache-Control'] = 'private, max-age=60'
        return response

    def update(self, request, *args, **kwargs):
        """Permite atualização apenas se o usuário for o criador ou tiver a
        permissão granular correspondente."""
        instance = self.get_object()
        user = request.user
        pode_locked = user.has_perm('accounts.manage_locked_cards')
        pode_others = user.has_perm('accounts.manage_others_cards')

        # Card finalizado/inviabilizado ou de sprint fechada: só quem tem
        # `manage_locked_cards` pode editar (cobre PATCH/PUT, inclusive mover
        # status pelo board).
        if not pode_locked and _card_edicao_restrita(instance):
            return Response(
                {'detail': 'Você não tem permissão para editar cards finalizados/inviabilizados '
                           'ou de sprints finalizadas.'},
                status=status.HTTP_403_FORBIDDEN,
            )

        # Verificar se é uma demanda (card no projeto "Sugestões")
        try:
            is_demanda = instance.projeto and instance.projeto.nome == 'Sugestões'
        except Exception:
            # Se houver erro ao acessar projeto, recarregar com select_related
            instance = Card.objects.select_related('projeto', 'criado_por').get(pk=instance.pk)
            is_demanda = instance.projeto and instance.projeto.nome == 'Sugestões'

        if is_demanda:
            # Para demandas: apenas o criador pode editar (ou quem gerencia
            # cards de outros).
            if not pode_others:
                # Comparar IDs para evitar problemas de comparação de objetos
                criado_por_id = instance.criado_por.id if instance.criado_por else None
                user_id = user.id if user else None
                if criado_por_id != user_id:
                    return Response(
                        {'detail': 'Você só pode editar demandas que você mesmo criou.'},
                        status=status.HTTP_403_FORBIDDEN
                    )

        return super().update(request, *args, **kwargs)
    
    def destroy(self, request, *args, **kwargs):
        """Permite exclusão apenas se o usuário for o criador ou tiver a
        permissão granular correspondente."""
        instance = self.get_object()
        user = request.user
        pode_locked = user.has_perm('accounts.manage_locked_cards')
        pode_others = user.has_perm('accounts.manage_others_cards')

        # Card finalizado/inviabilizado ou de sprint fechada: só quem tem
        # `manage_locked_cards` exclui.
        if not pode_locked and _card_edicao_restrita(instance):
            return Response(
                {'detail': 'Você não tem permissão para excluir cards finalizados/inviabilizados '
                           'ou de sprints finalizadas.'},
                status=status.HTTP_403_FORBIDDEN,
            )

        # Verificar se é uma demanda (card no projeto "Sugestões")
        try:
            is_demanda = instance.projeto and instance.projeto.nome == 'Sugestões'
        except Exception:
            # Se houver erro ao acessar projeto, recarregar com select_related
            instance = Card.objects.select_related('projeto', 'criado_por').get(pk=instance.pk)
            is_demanda = instance.projeto and instance.projeto.nome == 'Sugestões'

        if is_demanda:
            # Para demandas: apenas o criador pode deletar (ou quem gerencia
            # cards de outros).
            if not pode_others:
                # Comparar IDs para evitar problemas de comparação de objetos
                criado_por_id = instance.criado_por.id if instance.criado_por else None
                user_id = user.id if user else None
                if criado_por_id != user_id:
                    return Response(
                        {'detail': 'Você só pode deletar demandas que você mesmo criou.'},
                        status=status.HTTP_403_FORBIDDEN
                    )

        return super().destroy(request, *args, **kwargs)
    
    @action(detail=False, methods=['get'], url_path='priorities_view', permission_classes=[HasPerm('view_metrics')])
    def priorities_view(self, request):
        """Retorna usuários com seus cards em desenvolvimento para a página de Prioridades"""
        from django.contrib.auth import get_user_model
        from django.utils import timezone
        from datetime import timedelta, datetime
        from .serializers import CardSerializer
        from .models import CardLog, CardLogEventType
        
        User = get_user_model()
        periodo = request.query_params.get('periodo', 'dia')  # 'dia' ou 'semana'
        
        # Definir filtro de data baseado no período
        hoje = timezone.localdate()  # data LOCAL: `now().date()` é UTC e, das 21h à meia-noite, já é o dia seguinte
        inicio_hoje = timezone.make_aware(datetime.combine(hoje, datetime.min.time()))
        fim_hoje = timezone.make_aware(datetime.combine(hoje, datetime.max.time()))
        
        # Buscar TODOS os usuários que executam trabalho (sem quem supervisiona)
        supervisao_ids = _ids_supervisao_prioridades()
        usuarios_ativos = scope_users(
            User.objects.filter(
                is_active=True
            ).exclude(
                id__in=supervisao_ids
            ),
            request.user,
        )  # fail-open enquanto flag OFF

        if periodo == 'dia':
            # Prioridades do dia: considerar apenas cards de sprints em andamento
            # Definição de sprint em andamento:
            # - sprint não finalizada
            # - data_inicio <= hoje <= dia de fechamento (data do fechamento_em)
            # E com status relevantes ou finalizados hoje
            cards_em_desenvolvimento = scope_cards(Card.objects.filter(
                Q(status='em_desenvolvimento') |  # Cards em desenvolvimento
                Q(status='em_homologacao') |  # Cards em homologação
                Q(status='parado_pendencias') |  # Cards parados por pendências
                Q(status='finalizado', updated_at__date=hoje)  # OU cards finalizados hoje
            ).filter(
                projeto__arquivado=False,
                projeto__sprint__finalizada=False,
                projeto__sprint__data_inicio__lte=timezone.now(),
                projeto__sprint__fechamento_em__date__gte=hoje,
            ).exclude(responsavel__isnull=True).exclude(
                responsavel_id__in=supervisao_ids
            ).select_related('responsavel', 'projeto'), request.user)  # fail-open enquanto flag OFF

            # Debug (sem PII em logs; ativável via logger.debug com handler dedicado)
            logger.debug("[Priorities] DIA cards=%d", cards_em_desenvolvimento.count())

        else:
            # Prioridades da semana: cards que vencem até o final da semana (7 dias)
            fim_semana = hoje + timedelta(days=7)
            cards_em_desenvolvimento = scope_cards(Card.objects.filter(
                status__in=['a_desenvolver', 'em_desenvolvimento', 'parado_pendencias', 'em_homologacao', 'finalizado']
            ).filter(projeto__arquivado=False).exclude(responsavel__isnull=True).exclude(
                responsavel_id__in=supervisao_ids
            ).filter(
                Q(data_fim__gte=hoje, data_fim__lte=fim_semana) |
                Q(status='finalizado', updated_at__date__gte=hoje, updated_at__date__lte=fim_semana)
            ), request.user)  # fail-open enquanto flag OFF
        
        # Agrupar cards por responsável
        cards_por_usuario = {}
        for card in cards_em_desenvolvimento:
            if card.responsavel:  # Verificação adicional de segurança
                user_id = int(card.responsavel.id)  # Garantir que é int
                if user_id not in cards_por_usuario:
                    cards_por_usuario[user_id] = []
                cards_por_usuario[user_id].append(card)
        
        # Ordenar cards por prioridade (absoluta > alta > media > baixa)
        prioridade_order = {'absoluta': 0, 'alta': 1, 'media': 2, 'baixa': 3}
        for user_id in cards_por_usuario:
            cards_por_usuario[user_id].sort(key=lambda c: (
                prioridade_order.get(c.prioridade, 99),
                c.data_fim or c.data_inicio or c.created_at
            ))
        
        # Criar resultado incluindo TODOS os usuários (mesmo sem cards)
        result = []
        usuarios_com_cards = 0
        for usuario in usuarios_ativos:
            # Garantir que estamos usando o mesmo tipo de ID (int)
            user_id = int(usuario.id)
            cards_do_usuario = cards_por_usuario.get(user_id, [])
            cards_serializados = CardSerializer(cards_do_usuario, many=True).data if cards_do_usuario else []
            
            if cards_serializados:
                usuarios_com_cards += 1
            
            result.append({
                'usuario': {
                    'id': usuario.id,
                    'username': usuario.username,
                    'first_name': usuario.first_name,
                    'last_name': usuario.last_name,
                    'email': usuario.email,
                    'role': usuario.role,
                    'role_display': usuario.get_role_display(),
                    'profile_picture_url': get_profile_picture_url(usuario, request=request),
                },
                'cards': cards_serializados
            })
        
        # Métrica agregada sem PII
        logger.debug(
            "[Priorities] usuarios_com_cards=%d/%d total_result=%d",
            usuarios_com_cards, len(usuarios_ativos), len(result),
        )

        # Ordenar: primeiro usuários com cards (por prioridade), depois sem cards
        result.sort(key=lambda x: (
            0 if x['cards'] else 1,  # Com cards primeiro
            prioridade_order.get(x['cards'][0]['prioridade'], 99) if x['cards'] else 99
        ))
        
        return Response(result)


class UserNoteViewSet(viewsets.ModelViewSet):
    """API CRUD para notas pessoais do usuário autenticado (substituto do
    sistema antigo de CardTodo). Cada usuário só vê/edita suas próprias notas."""
    serializer_class = UserNoteSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_fields = ['archived', 'pinned', 'color']
    ordering_fields = ['order', 'updated_at', 'created_at']
    ordering = ['-pinned', 'order', '-updated_at']
    pagination_class = None  # listagem completa — notas pessoais costumam ser poucas

    def get_queryset(self):
        return UserNote.objects.filter(user=self.request.user).prefetch_related('items')


class CardPinViewSet(viewsets.ModelViewSet):
    """Fixações pessoais de cards (página "Meus Afazeres → Cards Fixados").

    Lista apenas pins cujo card ainda esteja em uma sprint ativa e não tenha
    sido finalizado. Cards que migrarem para finalizado/inviabilizado têm
    seus pins removidos automaticamente via signal (`remove_pins_when_card_finalized`).
    """
    serializer_class = CardPinSerializer
    permission_classes = [IsAuthenticated, PodeVerConteudo]
    pagination_class = None
    http_method_names = ['get', 'post', 'delete']

    def get_queryset(self):
        now = timezone.now()
        qs = (
            CardPin.objects
            .filter(user=self.request.user)
            .exclude(card__status__in=[CardStatus.FINALIZADO, CardStatus.INVIABILIZADO])
            # Pins de cards de projetos arquivados somem da tab Cards Fixados —
            # coerente com o comportamento de CardViewSet (que também esconde).
            .filter(card__projeto__arquivado=False)
            .filter(card__projeto__sprint__finalizada=False)
            .filter(
                Q(card__projeto__sprint__fechamento_em__isnull=True)
                | Q(card__projeto__sprint__fechamento_em__gte=now)
            )
            .select_related(
                'card',
                'card__projeto',
                'card__projeto__sprint',
                'card__responsavel',
                'card__criado_por',
            )
        )
        # `user=self.request.user` responde "é meu pin?" — privacidade, não
        # segmentação. Sem o escopo, um pin criado sobre card de outro setor
        # (ou sobre um card que depois saiu do escopo) continuaria renderizando
        # o `card_detail` completo desse card a cada listagem.
        return scope_card_pins(qs, self.request.user)  # fail-open enquanto flag OFF

    def perform_create(self, serializer):
        # SEM gate de escrita aqui, de propósito. Fixar não escreve nada DENTRO
        # do card: o CardPin é uma linha pessoal (user + card) que só aparece
        # para quem fixou. O gate que importa é o de VISIBILIDADE, e ele já vive
        # em `CardPinSerializer.validate_card` (serializers.py), que chama
        # `scope_cards` com `editaveis_fn=None` justamente para que um card
        # emprestado ao setor apenas para LEITURA continue fixável por quem já o
        # enxerga. Repetir aqui um `checar_escrita_no_pai` contradiria essa
        # decisão e passaria a recusar 403 no botão "Fixar" assim que
        # SETOR_WRITE_ENFORCEMENT_ENABLED subisse — restringindo mais do que o
        # compartilhamento pediu.
        serializer.save()

    @action(detail=False, methods=['delete'], url_path='by-card/(?P<card_id>[^/.]+)')
    def delete_by_card(self, request, card_id=None):
        """DELETE /card-pins/by-card/<card_id>/ — atalho para desfixar sem
        precisar conhecer o id do CardPin.

        Sem escopo de propósito: apaga só o pin de QUEM PEDE (`user=request.user`)
        e desfixar precisa continuar possível mesmo depois de o card sair do
        escopo do usuário — senão o pin residual ficaria preso para sempre."""
        deleted, _ = CardPin.objects.filter(user=request.user, card_id=card_id).delete()
        if deleted == 0:
            return Response(status=status.HTTP_404_NOT_FOUND)
        return Response(status=status.HTTP_204_NO_CONTENT)


class EventViewSet(viewsets.ModelViewSet):
    serializer_class = EventSerializer
    permission_classes = [IsAuthenticated, PodeVerConteudo, NaoVisitanteEscreve]
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_fields = ['card', 'tipo', 'usuario']
    ordering_fields = ['data']
    ordering = ['-data']

    def get_queryset(self):
        # Eventos de cards em projetos arquivados ficam invisíveis em listagens
        # genéricas. Quando o cliente filtra explicitamente por `?card=<id>` ou
        # acessa /events/<id>/, retornamos mesmo assim (user acessou de propósito
        # via ProjectDetails arquivado).
        qs = Event.objects.all()
        if self.action == 'list' and not self.request.query_params.get('card'):
            qs = qs.filter(card__projeto__arquivado=False)
        # O evento não tem setor próprio: quem responde pela visibilidade é o
        # CARD dono. Sem isto, `?card=<id>` (o campo está em `filterset_fields`)
        # entrega as pendências/comentários de qualquer card — e o
        # `EventSerializer` ainda embute o `card_detail` inteiro em cada linha.
        return scope_events(qs, self.request.user)  # fail-open enquanto flag OFF

    def perform_create(self, serializer):
        # Comentar/abrir pendência é escrever DENTRO do card, e o card vem por
        # id do cliente: mesmo gate de pai do CardLogViewSet. Sobre o card, não
        # sobre o Event — `nivel_de_acesso` não conhece Event e devolveria None.
        checar_escrita_no_pai(self.request.user, serializer.validated_data.get('card'))
        # `usuario` é nulável para que o evento sobreviva à saída do autor, mas
        # evento CRIADO agora sempre nasce com autoria: sem isto, um POST que
        # omitisse o campo gravaria uma pendência/um comentário anônimo na tela
        # do time dono do card. Mesmo preenchimento do CardLogViewSet.
        if not serializer.validated_data.get('usuario'):
            serializer.save(usuario=self.request.user)
        else:
            serializer.save()

    def perform_update(self, serializer):
        # Este viewset é ModelViewSet sem `http_method_names`, então PATCH/PUT
        # e DELETE de detalhe existem. O gate tem de ser expresso sobre o CARD
        # (o pai), e não sobre o Event: `SetorPermiteEscrita`/`pode_editar`
        # perguntariam o nível de acesso do próprio evento, que não tem setor
        # nem compartilhamento — a resposta seria None e NEGARIA TUDO assim que
        # a flag de escrita subisse.
        checar_escrita_no_pai(self.request.user, serializer.instance.card)
        # `card` é gravável: mover o evento é escrever também no card DESTINO.
        destino = serializer.validated_data.get('card')
        if destino is not None and destino.pk != serializer.instance.card_id:
            checar_escrita_no_pai(self.request.user, destino)
        serializer.save()

    def perform_destroy(self, instance):
        # Apagar a pendência de um card é escrever nesse card. Idem acima:
        # o gate pergunta pelo pai.
        checar_escrita_no_pai(self.request.user, instance.card)
        instance.delete()


class CardLogViewSet(viewsets.ModelViewSet):
    """Timeline do card: escrita só por append.

    `PATCH` e `DELETE` estão fora de `http_method_names` de propósito. O log é
    a prova de o que aconteceu com o card — um histórico que pode ser reescrito
    não serve para auditar nada. Criar continua liberado: é assim que a tela
    registra comentários e mudanças de etapa.
    """
    serializer_class = CardLogSerializer
    permission_classes = [IsAuthenticated, PodeVerConteudo, NaoVisitanteEscreve]
    http_method_names = ['get', 'post', 'head', 'options']
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_fields = ['card', 'tipo_evento', 'usuario']
    ordering_fields = ['data']
    ordering = ['-data']

    def get_queryset(self):
        # Idem EventViewSet: filtra arquivados em listagens genéricas,
        # mantém visibilidade quando cliente filtra por card específico.
        qs = CardLog.objects.select_related('usuario')
        if self.action == 'list' and not self.request.query_params.get('card'):
            qs = qs.filter(card__projeto__arquivado=False)
        return scope_card_logs(qs, self.request.user)  # fail-open enquanto flag OFF

    def perform_create(self, serializer):
        # Escrever na timeline é escrever no card: quem recebeu o card só para
        # leitura não pode deixar registro nele.
        checar_escrita_no_pai(self.request.user, serializer.validated_data.get('card'))
        # Preencher o usuário automaticamente se não foi fornecido
        if not serializer.validated_data.get('usuario'):
            serializer.save(usuario=self.request.user)
        else:
            serializer.save()


# Slugs dos 11 tipos vivos (espelha campos de UserNotificationPreference).
# Tipos legados como `card_todo_updated` e `log_created` ficam DE FORA — registros
# antigos com esses tipos não aparecem mais na lista do usuário (são phased out).
ACTIVE_NOTIFICATION_TYPES = [
    'card_updated', 'card_deleted', 'project_created',
    'card_overdue', 'card_due_24h', 'card_due_1h', 'card_due_10min',
    'card_created', 'card_moved', 'sprint_created', 'role_changed',
]


def _enabled_types_for(user):
    """Retorna a lista de slugs habilitados pela preferência do usuário."""
    prefs, _ = UserNotificationPreference.objects.get_or_create(user=user)
    return [t for t in ACTIVE_NOTIFICATION_TYPES if getattr(prefs, t, False)]


class NotificationViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = NotificationSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_fields = ['tipo', 'lida']
    ordering_fields = ['data_criacao']
    ordering = ['-data_criacao']

    def get_queryset(self):
        user = self.request.user
        # Apenas tipos atualmente habilitados pela preferência do usuário.
        enabled = _enabled_types_for(user)
        return Notification.objects.filter(usuario=user, tipo__in=enabled)

    @action(detail=True, methods=['post'])
    def mark_as_read(self, request, pk=None):
        """Marcar uma notificação como lida"""
        notification = self.get_object()
        notification.lida = True
        notification.save()
        serializer = self.get_serializer(notification)
        return Response(serializer.data)

    @action(detail=False, methods=['post'])
    def mark_all_as_read(self, request):
        """Marcar todas as notificações VISÍVEIS (tipos habilitados) como lidas."""
        enabled = _enabled_types_for(request.user)
        count = Notification.objects.filter(
            usuario=request.user,
            lida=False,
            tipo__in=enabled,
        ).update(lida=True)
        return Response({'count': count})

    @action(detail=False, methods=['get'])
    def unread_count(self, request):
        """Contar notificações não lidas (somente tipos habilitados pela preferência)."""
        enabled = _enabled_types_for(request.user)
        total = Notification.objects.filter(
            usuario=request.user,
            lida=False,
            tipo__in=enabled,
        ).count()
        # `mine` mantido por compatibilidade do contrato (FE legado pode ler),
        # mas agora é igual a `total` pois "Minhas" foi removido da UI.
        return Response({'total': total, 'mine': total})


class NotificationPreferenceView(APIView):
    """GET retorna as preferências do usuário autenticado (cria com defaults se ausente).
    PATCH atualiza qualquer subset dos 11 booleans."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        prefs, _ = UserNotificationPreference.objects.get_or_create(user=request.user)
        return Response(NotificationPreferenceSerializer(prefs).data)

    def patch(self, request):
        prefs, _ = UserNotificationPreference.objects.get_or_create(user=request.user)
        serializer = NotificationPreferenceSerializer(prefs, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)


class WeeklyPriorityConfigViewSet(viewsets.ModelViewSet):
    """ViewSet para gerenciar a configuração do horário limite das prioridades semanais"""
    queryset = WeeklyPriorityConfig.objects.all()
    serializer_class = WeeklyPriorityConfigSerializer
    permission_classes = [IsAuthenticated, PodeVerConteudo, NaoVisitanteEscreve]
    
    def get_queryset(self):
        # Retornar apenas a configuração (sempre será apenas uma)
        return WeeklyPriorityConfig.objects.all()
    
    def list(self, request, *args, **kwargs):
        # Sempre retornar ou criar a configuração padrão
        config = WeeklyPriorityConfig.get_config()
        serializer = self.get_serializer(config)
        return Response(serializer.data)
    
    def retrieve(self, request, *args, **kwargs):
        # Sempre retornar ou criar a configuração padrão
        config = WeeklyPriorityConfig.get_config()
        serializer = self.get_serializer(config)
        return Response(serializer.data)
    
    def perform_create(self, serializer):
        # Verificar se o usuário é supervisor ou admin
        if not self.request.user.has_perm('accounts.manage_weekly_priorities'):
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied("Apenas supervisores e administradores podem criar configurações de prioridades semanais.")
        serializer.save()
    
    def perform_update(self, serializer):
        # Verificar se o usuário é supervisor ou admin
        if not self.request.user.has_perm('accounts.manage_weekly_priorities'):
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied("Apenas supervisores e administradores podem atualizar configurações de prioridades semanais.")
        serializer.save()
    
    def destroy(self, request, *args, **kwargs):
        # Verificar se o usuário é supervisor ou admin
        if not request.user.has_perm('accounts.manage_weekly_priorities'):
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied("Apenas supervisores e administradores podem remover configurações de prioridades semanais.")
        return super().destroy(request, *args, **kwargs)
    
    @action(detail=False, methods=['post'], url_path='close-week')
    def close_week(self, request):
        """Fecha a semana atual, marcando todos os cards não concluídos"""
        if not request.user.has_perm('accounts.manage_weekly_priorities'):
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied("Apenas supervisores e administradores podem fechar a semana.")
        
        hoje = timezone.localdate()
        dias_ate_segunda = hoje.weekday()  # 0 = segunda, 6 = domingo
        semana_inicio = hoje - timedelta(days=dias_ate_segunda)
        
        config = WeeklyPriorityConfig.get_config()
        config.fechar_semana(semana_inicio)
        
        return Response({
            'message': 'Semana fechada com sucesso.',
            'semana_inicio': semana_inicio.isoformat(),
            'semana_fechada': True
        })
    
    @action(detail=False, methods=['post'], url_path='clear-priorities')
    def clear_priorities(self, request):
        """Limpa todas as prioridades da semana atual (apenas se a semana estiver fechada)"""
        if not request.user.has_perm('accounts.manage_weekly_priorities'):
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied("Apenas supervisores e administradores podem limpar prioridades.")
        
        hoje = timezone.localdate()
        dias_ate_segunda = hoje.weekday()  # 0 = segunda, 6 = domingo
        semana_inicio = hoje - timedelta(days=dias_ate_segunda)
        
        config = WeeklyPriorityConfig.get_config()
        
        # Verificar se a semana está fechada
        if not config.is_semana_fechada(semana_inicio):
            raise ValidationError("A semana deve estar fechada antes de limpar as prioridades.")
        
        # Deletar as prioridades da semana atual que o operador ENXERGA: limpar
        # a semana não pode apagar o planejamento de um setor que ele nem vê.
        priorities = scope_weekly_priorities(
            WeeklyPriority.objects.filter(semana_inicio=semana_inicio),
            request.user,
        )  # fail-open enquanto flag OFF
        count = priorities.count()
        priorities.delete()
        
        # Abrir a semana novamente para permitir novas prioridades
        config.abrir_semana(semana_inicio)
        
        return Response({
            'message': f'{count} prioridade(s) removida(s) com sucesso.',
            'count': count
        })


class WeeklyPriorityViewSet(viewsets.ModelViewSet):
    """ViewSet para gerenciar as prioridades semanais"""
    queryset = WeeklyPriority.objects.all()
    serializer_class = WeeklyPrioritySerializer
    permission_classes = [IsAuthenticated, PodeVerConteudo, NaoVisitanteEscreve]
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_fields = ['usuario', 'semana_inicio', 'semana_fim']
    ordering_fields = ['semana_inicio', 'usuario']
    ordering = ['-semana_inicio', 'usuario']
    
    def get_queryset(self):
        queryset = WeeklyPriority.objects.select_related('usuario', 'card', 'definido_por')
        
        # Filtrar por semana atual se não especificado
        semana = self.request.query_params.get('semana', None)
        if semana:
            # semana deve estar no formato YYYY-MM-DD (segunda-feira)
            try:
                semana_inicio = datetime.strptime(semana, '%Y-%m-%d').date()
                semana_fim = semana_inicio + timedelta(days=4)  # Sexta-feira
                queryset = queryset.filter(semana_inicio=semana_inicio)
            except ValueError:
                pass
        else:
            # Por padrão, mostrar a semana atual
            hoje = timezone.localdate()
            # Calcular segunda-feira da semana atual
            dias_ate_segunda = hoje.weekday()  # 0 = segunda, 6 = domingo
            semana_inicio = hoje - timedelta(days=dias_ate_segunda)
            queryset = queryset.filter(semana_inicio=semana_inicio)

        return scope_weekly_priorities(queryset, self.request.user)  # fail-open enquanto flag OFF

    def perform_create(self, serializer):
        # Verificar se o usuário é supervisor ou admin
        if not self.request.user.has_perm('accounts.manage_weekly_priorities'):
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied("Apenas supervisores e administradores podem definir prioridades semanais.")
        
        # Validar dados antes de salvar
        validated_data = serializer.validated_data
        
        # Verificar se já existe uma prioridade com os mesmos dados (unique_together)
        usuario = validated_data.get('usuario')
        card = validated_data.get('card')
        semana_inicio = validated_data.get('semana_inicio')

        # Semana fechada = prioridades travadas (usar clear-priorities pra resetar).
        if semana_inicio and WeeklyPriorityConfig.get_config().is_semana_fechada(semana_inicio):
            from rest_framework.exceptions import ValidationError
            raise ValidationError({'non_field_errors': ['A semana está fechada; não é possível definir prioridades.']})

        existing = WeeklyPriority.objects.filter(
            usuario=usuario,
            card=card,
            semana_inicio=semana_inicio
        ).first()
        
        if existing:
            from rest_framework.exceptions import ValidationError
            raise ValidationError({
                'non_field_errors': ['Esta prioridade já existe para este usuário, card e semana.']
            })
        
        # Definir quem criou a prioridade
        serializer.save(definido_por=self.request.user)
    
    def perform_update(self, serializer):
        # Verificar se o usuário é supervisor ou admin
        if not self.request.user.has_perm('accounts.manage_weekly_priorities'):
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied("Apenas supervisores e administradores podem atualizar prioridades semanais.")
        semana_inicio = serializer.instance.semana_inicio
        if WeeklyPriorityConfig.get_config().is_semana_fechada(semana_inicio):
            from rest_framework.exceptions import ValidationError
            raise ValidationError({'non_field_errors': ['A semana está fechada; não é possível alterar prioridades.']})
        # Atualizar quem definiu a prioridade
        serializer.save(definido_por=self.request.user)

    def destroy(self, request, *args, **kwargs):
        # Verificar se o usuário é supervisor ou admin
        if not request.user.has_perm('accounts.manage_weekly_priorities'):
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied("Apenas supervisores e administradores podem remover prioridades semanais.")
        instance = self.get_object()
        if WeeklyPriorityConfig.get_config().is_semana_fechada(instance.semana_inicio):
            from rest_framework.exceptions import ValidationError
            raise ValidationError({'non_field_errors': ['A semana está fechada; use "limpar prioridades" para resetar.']})
        return super().destroy(request, *args, **kwargs)
    
    @action(detail=False, methods=['get'], url_path='current_week')
    def current_week(self, request):
        """Retorna as prioridades da semana atual"""
        hoje = timezone.localdate()
        # Calcular segunda-feira da semana atual
        dias_ate_segunda = hoje.weekday()  # 0 = segunda, 6 = domingo
        semana_inicio = hoje - timedelta(days=dias_ate_segunda)
        semana_fim = semana_inicio + timedelta(days=4)  # Sexta-feira
        
        priorities = scope_weekly_priorities(
            WeeklyPriority.objects.filter(
                semana_inicio=semana_inicio
            ).select_related('usuario', 'card', 'definido_por'),
            request.user,
        )  # fail-open enquanto flag OFF

        serializer = self.get_serializer(priorities, many=True)
        return Response(serializer.data)

    @action(detail=False, methods=['get'], url_path='define_priority_options')
    def define_priority_options(self, request):
        """Cards disponíveis + prioridades já definidas (uma request leve para o modal)."""
        from rest_framework.exceptions import PermissionDenied, ValidationError

        if not request.user.has_perm('accounts.manage_weekly_priorities'):
            raise PermissionDenied(
                'Apenas supervisores e administradores podem definir prioridades semanais.'
            )

        usuario_id = request.query_params.get('usuario')
        if not usuario_id:
            raise ValidationError({'usuario': 'Parâmetro obrigatório.'})

        hoje = timezone.localdate()
        semana_inicio = hoje - timedelta(days=hoje.weekday())

        # Escopo aqui também fecha a enumeração: o modal recebe `usuario` da
        # URL, então sem filtro dava para listar os cards de qualquer pessoa.
        cards = scope_cards(
            Card.objects.filter(
                responsavel_id=usuario_id,
                projeto__arquivado=False,
            )
            .exclude(status__in=[CardStatus.FINALIZADO, CardStatus.INVIABILIZADO])
            .select_related('projeto')
            .order_by('-created_at'),
            request.user,
        )  # fail-open enquanto flag OFF

        selected_ids = set(
            scope_weekly_priorities(
                WeeklyPriority.objects.filter(
                    usuario_id=usuario_id,
                    semana_inicio=semana_inicio,
                    card__projeto__arquivado=False,
                ),
                request.user,
            ).values_list('card_id', flat=True)
        )

        available_cards = []
        for card in cards:
            available_cards.append({
                'id': str(card.id),
                'nome': card.nome,
                'status': card.status,
                'status_display': card.get_status_display(),
                'projeto': card.projeto_id,
                'projeto_detail': (
                    {'id': card.projeto_id, 'nome': card.projeto.nome}
                    if card.projeto_id else None
                ),
                'responsavel': str(card.responsavel_id) if card.responsavel_id else None,
            })

        return Response({
            'available_cards': available_cards,
            'selected_card_ids': [str(cid) for cid in selected_ids],
            'semana_inicio': semana_inicio.isoformat(),
        })

    @action(detail=False, methods=['get'], url_path='priorities_view', permission_classes=[HasPerm('view_metrics')])
    def priorities_view(self, request):
        """Retorna usuários com prioridades semanais e cards fechados nos últimos 7 dias."""
        from django.contrib.auth import get_user_model

        User = get_user_model()
        hoje = timezone.localdate()
        dias_ate_segunda = hoje.weekday()
        semana_inicio = hoje - timedelta(days=dias_ate_segunda)
        limite_fechados = timezone.now() - timedelta(days=7)

        usuarios_ativos = scope_users(
            User.objects.filter(is_active=True).exclude(
                id__in=_ids_supervisao_prioridades()
            ),
            request.user,
        )  # fail-open enquanto flag OFF

        config = WeeklyPriorityConfig.get_config()
        semana_fechada = config.is_semana_fechada(semana_inicio)

        priorities = scope_weekly_priorities(
            WeeklyPriority.objects.filter(
                semana_inicio=semana_inicio,
                card__projeto__arquivado=False,
            ).select_related('usuario', 'card', 'definido_por', 'card__projeto'),
            request.user,
        )  # fail-open enquanto flag OFF

        priorities_por_usuario: dict[int, list] = {}
        priority_by_card_id: dict[int, WeeklyPriority] = {}
        for priority in priorities:
            user_id = int(priority.usuario.id)
            priorities_por_usuario.setdefault(user_id, []).append(priority)
            priority_by_card_id[priority.card_id] = priority

        cards_fechados = scope_cards(Card.objects.filter(
            responsavel__in=usuarios_ativos,
            status=CardStatus.FINALIZADO,
            projeto__arquivado=False,
        ).filter(
            Q(finalizado_em__gte=limite_fechados)
            | Q(finalizado_em__isnull=True, updated_at__gte=limite_fechados)
        ).select_related('projeto', 'responsavel'), request.user)  # fail-open enquanto flag OFF

        fechados_por_usuario: dict[int, list] = {}
        for card in cards_fechados:
            if card.responsavel_id:
                uid = int(card.responsavel_id)
                fechados_por_usuario.setdefault(uid, []).append(card)

        def serialize_card_with_priority(card, priority=None):
            card_data = CardSerializer(card).data
            if priority:
                card_data['weekly_priority'] = {
                    'id': str(priority.id),
                    'is_concluido': priority.is_concluido(),
                    'is_atrasado': priority.is_atrasado(),
                    'semana_inicio': priority.semana_inicio.isoformat(),
                    'semana_fim': priority.semana_fim.isoformat(),
                }
            return card_data

        result = []
        for usuario in usuarios_ativos:
            user_id = int(usuario.id)
            user_priorities = priorities_por_usuario.get(user_id, [])

            cards_by_id: dict[int, dict] = {}
            for priority in user_priorities:
                cards_by_id[priority.card_id] = serialize_card_with_priority(
                    priority.card, priority
                )

            for card in fechados_por_usuario.get(user_id, []):
                if card.id not in cards_by_id:
                    priority = priority_by_card_id.get(card.id)
                    cards_by_id[card.id] = serialize_card_with_priority(card, priority)

            cards_serializados = list(cards_by_id.values())

            result.append({
                'usuario': {
                    'id': usuario.id,
                    'username': usuario.username,
                    'first_name': usuario.first_name,
                    'last_name': usuario.last_name,
                    'email': usuario.email,
                    'role': usuario.role,
                    'role_display': usuario.get_role_display(),
                    'profile_picture_url': get_profile_picture_url(usuario, request=request),
                },
                'cards': cards_serializados,
            })

        result.sort(key=lambda x: (0 if x['cards'] else 1, x['usuario']['username']))

        return Response({
            'semana_fechada': semana_fechada,
            'semana_inicio': semana_inicio.isoformat(),
            'data': result,
        })


class CardDueDateChangeRequestViewSet(viewsets.ModelViewSet):
    """
    Solicitações de alteração de data de entrega do card.

    - Criação: apenas o responsável pelo card (card.responsavel) pode solicitar.
    - Avaliação (aprovar/recusar): apenas supervisor/admin.
    """
    serializer_class = CardDueDateChangeRequestSerializer
    permission_classes = [IsAuthenticated, PodeVerConteudo, NaoVisitanteEscreve]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ['status', 'requested_by', 'reviewed_by', 'card']
    search_fields = ['reason', 'card__nome', 'requested_by__username']
    ordering_fields = ['created_at', 'updated_at', 'reviewed_at', 'requested_date']
    ordering = ['-created_at']

    def get_queryset(self):
        qs = CardDueDateChangeRequest.objects.select_related(
            'card', 'card__projeto', 'requested_by', 'reviewed_by'
        )
        # Filtra projetos arquivados em listagens genéricas. Permite visualização
        # quando o cliente acessa via `?card=<id>` (workflow histórico).
        if self.action == 'list' and not self.request.query_params.get('card'):
            qs = qs.filter(card__projeto__arquivado=False)
        # A fila carrega o card inteiro (`card_detail`) e o `reason` em texto
        # livre — o motivo do atraso, escrito por gente do setor dono —, então
        # ela é tão sensível quanto o card e é o card que responde por ela.
        # Escopar aqui fecha o lado da VISIBILIDADE de uma vez: `approve`,
        # `reject`, `update` e `destroy` saem todos de `get_object()`, que passa
        # a dar 404 fora do escopo em vez de alterar o `data_fim` de um card
        # alheio. NÃO fecha o lado da ESCRITA: card emprestado em nível
        # 'leitura' continua VISÍVEL, então continua saindo do `get_object()` —
        # o gate de escrita mora no `approve` (ver lá), que é a única action
        # daqui que mexe no card.
        return scope_card_date_change_requests(qs, self.request.user)  # fail-open enquanto flag OFF

    def perform_create(self, serializer):
        card = serializer.validated_data.get('card')
        requested_date = serializer.validated_data.get('requested_date')
        from rest_framework.exceptions import ValidationError, PermissionDenied

        if not card:
            raise ValidationError({'card': 'Card é obrigatório.'})

        card = Card.objects.select_related('projeto__sprint').get(pk=card.pk)

        # Pedir reajuste de prazo é abrir um registro dentro do card, e o card
        # vem por id do cliente. A checagem de `responsavel` abaixo já cobre
        # quase tudo, mas não o caso do responsável emprestado: alguém do setor
        # A atribuído a um card que o setor B cedeu apenas para LEITURA.
        checar_escrita_no_pai(self.request.user, card)

        if card.responsavel_id != self.request.user.id:
            raise PermissionDenied('Você só pode solicitar mudança de data para cards atribuídos a você.')

        if not card.data_fim:
            raise ValidationError({'card': 'Este card não possui data de entrega registrada.'})

        if card.status in (CardStatus.FINALIZADO, CardStatus.INVIABILIZADO):
            raise ValidationError({
                'card': 'Não é possível solicitar reajuste para cards já finalizados ou inviabilizados.',
            })

        if not requested_date:
            raise ValidationError({'requested_date': 'requested_date é obrigatório.'})

        serializer.save(requested_by=self.request.user)

    def update(self, request, *args, **kwargs):
        # A avaliação (status) muda pelas actions approve/reject. PATCH/PUT direto
        # só quem gerencia solicitações de terceiros — evita burlar o fluxo pelo endpoint.
        if not request.user.has_perm('accounts.manage_others_due_date_requests'):
            return Response(
                {'detail': 'Apenas supervisor ou admin podem alterar solicitações.'},
                status=status.HTTP_403_FORBIDDEN,
            )
        return super().update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        is_privileged = request.user.has_perm('accounts.manage_others_due_date_requests')
        is_dono_pendente = (
            instance.requested_by_id == request.user.id and instance.status == 'pending'
        )
        if not is_privileged and not is_dono_pendente:
            return Response(
                {'detail': 'Sem permissão para excluir esta solicitação.'},
                status=status.HTTP_403_FORBIDDEN,
            )
        return super().destroy(request, *args, **kwargs)

    @action(detail=True, methods=['post'])
    def approve(self, request, pk=None):
        if not request.user.has_perm('accounts.approve_due_date_requests'):
            return Response({'detail': 'Apenas supervisor ou admin podem aprovar solicitações.'}, status=status.HTTP_403_FORBIDDEN)

        req = self.get_object()
        if req.status != 'pending':
            return Response({'detail': 'Esta solicitação não está pendente.'}, status=status.HTTP_400_BAD_REQUEST)

        # Aprovar é a única action daqui que escreve DENTRO do card: muda o
        # `data_fim` dele e ainda carimba um CardLog na timeline. O escopo do
        # `get_queryset()` não cobre este caso — card emprestado em nível
        # 'leitura' é VISÍVEL, então a solicitação sai normalmente do
        # `get_object()` e só aqui dá para recusar. Mesmo gate de pai do
        # `perform_create` logo acima, e pela mesma razão: `approve_due_date_requests`
        # é permissão de CARGO, ela diz O QUE a pessoa faz, não ONDE.
        # `reject`/`update`/`destroy` ficam de fora de propósito: mexem só na
        # linha da solicitação, não no card.
        checar_escrita_no_pai(request.user, req.card)

        with transaction.atomic():
            card = Card.objects.select_for_update().select_related('projeto__sprint').get(pk=req.card_id)
            if not card.data_fim:
                return Response({'detail': 'Card não possui data_fim atual.'}, status=status.HTTP_400_BAD_REQUEST)

            old_dt = card.data_fim
            new_dt = req.requested_date
            if timezone.is_naive(new_dt):
                new_dt = timezone.make_aware(new_dt, timezone.get_current_timezone())
            if old_dt and timezone.is_aware(old_dt) and timezone.is_aware(new_dt):
                new_dt = new_dt.astimezone(old_dt.tzinfo)

            card.data_fim = new_dt
            card.save()

            req.status = 'approved'
            req.reviewed_by = request.user
            req.reviewed_at = timezone.now()
            req.save(update_fields=['status', 'reviewed_by', 'reviewed_at', 'updated_at'])

        motivo = (req.reason or '').strip()
        motivo_txt = f"\n\nMotivo: {motivo}" if motivo else ""
        CardLog.objects.create(
            card=card,
            tipo_evento=CardLogEventType.ALTERACAO,
            descricao=f"Solicitação aprovada: data de entrega alterada de {old_dt} para {new_dt}.{motivo_txt}",
            usuario=request.user,
        )

        serializer = self.get_serializer(req)
        return Response(serializer.data, status=status.HTTP_200_OK)

    @action(detail=True, methods=['post'])
    def reject(self, request, pk=None):
        if not request.user.has_perm('accounts.approve_due_date_requests'):
            return Response({'detail': 'Apenas supervisor ou admin podem recusar solicitações.'}, status=status.HTTP_403_FORBIDDEN)

        req = self.get_object()
        if req.status != 'pending':
            return Response({'detail': 'Esta solicitação não está pendente.'}, status=status.HTTP_400_BAD_REQUEST)

        req.status = 'rejected'
        req.reviewed_by = request.user
        req.reviewed_at = timezone.now()
        req.save(update_fields=['status', 'reviewed_by', 'reviewed_at', 'updated_at'])

        serializer = self.get_serializer(req)
        return Response(serializer.data, status=status.HTTP_200_OK)


# ============================================================================
# Score (Pontuação de valor dos cards)
# ============================================================================

class ScoreCriterionViewSet(viewsets.ModelViewSet):
    """CRUD dos critérios configuráveis do formulário de Score.

    Restrito a quem tem a permissão `manage_score`.
    """
    serializer_class = ScoreCriterionSerializer
    permission_classes = [HasPerm('manage_score')]

    def get_queryset(self):
        qs = ScoreCriterion.objects.prefetch_related('opcoes').all()
        if self.request.query_params.get('ativos') in ('true', '1'):
            qs = qs.filter(ativo=True)
        return qs

    @action(detail=False, methods=['post'], url_path='reorder')
    def reorder(self, request):
        """Reordena os critérios pela lista de ids recebida (order[i] -> ordem=i).

        Usa ``update()`` (sem disparar o signal de recompute — a ordem não afeta
        o score)."""
        ids = request.data.get('order', [])
        if not isinstance(ids, list):
            return Response({'detail': 'O campo "order" deve ser uma lista de ids.'},
                            status=status.HTTP_400_BAD_REQUEST)
        for idx, cid in enumerate(ids):
            ScoreCriterion.objects.filter(pk=cid).update(ordem=idx)
        return Response({'detail': 'ok'})


class CardScoreViewSet(viewsets.ModelViewSet):
    """Scores atribuídos aos cards (tabela 7.4) + edição/exclusão com histórico."""
    serializer_class = CardScoreSerializer
    permission_classes = [HasPerm('manage_score')]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ['card', 'setor_solicitante']
    search_fields = ['card__nome']
    ordering_fields = ['score_final', 'updated_at', 'created_at']
    ordering = ['-score_final']

    def get_queryset(self):
        qs = (
            CardScore.objects
            .select_related(
                'card', 'card__projeto', 'card__projeto__sprint', 'card__responsavel',
                'criado_por', 'atualizado_por',
            )
            .prefetch_related(
                'valores__criterion',
                'card__score_historico__usuario',
            )
        )
        # Escopa por setor via o card dono (card__setor).
        return scope_card_scores(qs, self.request.user)  # fail-open enquanto flag OFF

    @action(detail=False, methods=['get'], url_path='pickable-cards')
    def pickable_cards(self, request):
        """Lista leve de cards para o seletor do modal (uma request, sem paginação).

        Só aparecem cards de sprints EM ANDAMENTO ou PLANEJADAS (não finalizadas e
        com fechamento ainda no futuro). Cards de sprints finalizadas/expiradas, ou
        de projetos sem sprint, não são atribuíveis e ficam de fora. Cards já
        FINALIZADOS também são excluídos (não faz sentido pontuar algo concluído).

        Action `detail=False`: NÃO passa pelo `get_queryset()` da classe (que é
        onde vive o `scope_card_scores`) e monta um queryset de Card próprio —
        por isso o escopo precisa ser reaplicado aqui, à mão. Sem ele, quem tem
        `manage_score` (permissão de cargo, que não implica `view_cross_setor`)
        recebia numa única requisição, sem paginação, o backlog vivo da empresa
        inteira: o `CardPickerSerializer` devolve nome, descrição, script_url e
        responsável de cada card."""
        sprint_ids = get_sprint_ids_atribuiveis()
        qs = (
            Card.objects
            .select_related('projeto', 'projeto__sprint', 'responsavel', 'score')
            .filter(projeto__arquivado=False, projeto__is_system=False)
            .filter(projeto__sprint_id__in=sprint_ids)
            .exclude(status=CardStatus.FINALIZADO)
            .order_by('-created_at')
        )
        qs = scope_cards(qs, request.user)  # fail-open enquanto flag OFF
        serializer = CardPickerSerializer(qs, many=True)
        return Response(serializer.data)

    def _aplicar_valores(self, card_score, valores):
        """Substitui os valores do score pelos informados. `valores` = lista de
        dicts {criterion, valor}."""
        card_score.valores.all().delete()
        criterios = {c.id: c for c in ScoreCriterion.objects.all()}
        for item in (valores or []):
            try:
                cid = int(item.get('criterion'))
                val = int(item.get('valor'))
            except (TypeError, ValueError):
                continue
            criterion = criterios.get(cid)
            if criterion is None:
                continue
            CardScoreValue.objects.create(
                card_score=card_score, criterion=criterion, valor=val
            )

    def _snapshot(self, card_score):
        return [
            {
                'criterion_id': v.criterion_id,
                'criterion_nome': v.criterion.nome,
                'peso': str(v.criterion.peso),
                'negativo': v.criterion.negativo,
                'valor': v.valor,
            }
            for v in card_score.valores.select_related('criterion').all()
        ]

    def _registrar_historico(self, card_score, acao, usuario, snapshot=None):
        ScoreHistory.objects.create(
            card=card_score.card,
            acao=acao,
            score_final=card_score.score_final,
            setor_solicitante=card_score.setor_solicitante,
            snapshot=snapshot if snapshot is not None else self._snapshot(card_score),
            usuario=usuario,
        )

    @staticmethod
    def _validar_setor(setor):
        """Retorna (ok, erro_response). Setor None é permitido (opcional)."""
        if setor is not None and setor not in SetorSolicitante.values:
            return False, Response(
                {'detail': 'Setor solicitante inválido.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return True, None

    def create(self, request, *args, **kwargs):
        card_id = request.data.get('card')
        try:
            card_id = int(card_id)
        except (TypeError, ValueError):
            return Response({'detail': 'O campo "card" é obrigatório e numérico.'},
                            status=status.HTTP_400_BAD_REQUEST)
        setor = request.data.get('setor_solicitante') or None
        ok, erro = self._validar_setor(setor)
        if not ok:
            return erro
        # `create` não tem `get_object()`, então nada aqui passa pelo
        # `get_queryset()` escopado: o card precisa ser resolvido DENTRO do
        # escopo, senão esta rota (que também EDITA, via get_or_create abaixo)
        # sobrescreve o score de um card de outro setor — e a transação commita
        # antes de a resposta estourar no `get_queryset().get()` do final.
        # Card fora do escopo responde igual a card inexistente, de propósito:
        # a resposta não deve distinguir "não existe" de "não é seu".
        card = scope_cards(Card.objects.filter(pk=card_id), request.user).first()
        if card is None:
            return Response({'detail': 'Card não encontrado.'},
                            status=status.HTTP_404_NOT_FOUND)
        # Pontuar é escrever no card: card emprestado só para leitura recusa.
        checar_escrita_no_pai(request.user, card)
        valores = request.data.get('valores', [])

        # OneToOne: um card tem no máximo um score. Se já existe, tratamos como edição.
        card_score, created = CardScore.objects.get_or_create(
            card_id=card_id,
            defaults={'criado_por': request.user, 'atualizado_por': request.user},
        )
        with transaction.atomic():
            card_score.setor_solicitante = setor
            card_score.atualizado_por = request.user
            card_score.save()
            self._aplicar_valores(card_score, valores)
            card_score.calcular_score()
            card_score.save(update_fields=['score_final', 'setor_solicitante',
                                           'atualizado_por', 'updated_at'])
            self._registrar_historico(
                card_score,
                ScoreHistoryAction.CRIADO if created else ScoreHistoryAction.EDITADO,
                request.user,
            )
        # Recarrega com prefetch fresco para a resposta refletir o histórico atual.
        fresh = self.get_queryset().get(pk=card_score.pk)
        serializer = self.get_serializer(fresh)
        return Response(
            serializer.data,
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )

    def update(self, request, *args, **kwargs):
        card_score = self.get_object()
        # O `get_object()` já dá 404 fora do escopo (o `get_queryset` usa
        # `scope_card_scores`); falta a recusa do card emprestado apenas para
        # LEITURA. Gate sobre o CARD dono, não sobre o CardScore, que não tem
        # setor próprio e daria None em `nivel_de_acesso`. Sem isto, o POST
        # ficaria fechado e o PUT/PATCH aberto para o mesmo efeito.
        checar_escrita_no_pai(request.user, card_score.card)
        valores = request.data.get('valores', None)
        if 'setor_solicitante' in request.data:
            ok, erro = self._validar_setor(request.data.get('setor_solicitante') or None)
            if not ok:
                return erro
        with transaction.atomic():
            if 'setor_solicitante' in request.data:
                card_score.setor_solicitante = request.data.get('setor_solicitante') or None
            card_score.atualizado_por = request.user
            card_score.save()
            if valores is not None:
                self._aplicar_valores(card_score, valores)
            card_score.calcular_score()
            card_score.save(update_fields=['score_final', 'setor_solicitante',
                                           'atualizado_por', 'updated_at'])
            self._registrar_historico(card_score, ScoreHistoryAction.EDITADO, request.user)
        fresh = self.get_queryset().get(pk=card_score.pk)
        return Response(self.get_serializer(fresh).data)

    def partial_update(self, request, *args, **kwargs):
        return self.update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        card_score = self.get_object()
        # Idem `update`: apagar a pontuação é escrever no card dono.
        checar_escrita_no_pai(request.user, card_score.card)
        snapshot = self._snapshot(card_score)
        # Registra o histórico de exclusão antes de apagar o score (o card permanece).
        ScoreHistory.objects.create(
            card=card_score.card,
            acao=ScoreHistoryAction.EXCLUIDO,
            score_final=card_score.score_final,
            setor_solicitante=card_score.setor_solicitante,
            snapshot=snapshot,
            usuario=request.user,
        )
        card_score.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class CardAnexoViewSet(viewsets.GenericViewSet):
    """Anexos de arquivo de um card (imagem, PDF, CSV, Excel, documento, etc.).

    GET    /api/card-anexos/?card=<id>            → lista os anexos do card.
    POST   /api/card-anexos/  (multipart)         → envia um anexo (campos: card, arquivo).
    DELETE /api/card-anexos/<id>/                 → remove um anexo.

    Permissão espelha a edição do card: em cards finalizados/inviabilizados ou de
    sprint já fechada, só admin/supervisor pode anexar/remover."""

    queryset = CardAnexo.objects.select_related(
        'card', 'card__projeto', 'card__projeto__sprint', 'enviado_por'
    ).all()
    serializer_class = CardAnexoSerializer
    permission_classes = [IsAuthenticated, PodeVerConteudo, NaoVisitanteEscreve]
    pagination_class = None
    http_method_names = ['get', 'post', 'delete', 'head', 'options']

    def get_queryset(self):
        """Anexos escopados pelo CARD dono.

        O anexo não tem setor próprio, e o escopo aqui protege mais do que
        metadado: o serializer devolve a `arquivo_url` absoluta e `/media/` só
        exige estar autenticado, então entregar a linha do anexo é entregar a
        planilha/o PDF/o print de outro setor. Escopar no queryset cobre de uma
        vez o `list` (que filtra por `?card=<id>` vindo do cliente) e o
        `destroy` (que sai de `get_object()` e passa a dar 404 fora do escopo).
        """
        return scope_card_anexos(self.queryset.all(), self.request.user)  # fail-open enquanto flag OFF

    def _pode_mutar(self, request, card):
        """True se o usuário pode anexar/remover neste card. Card travado
        (finalizado/inviabilizado/sprint fechada) exige a permissão
        `manage_locked_card_attachments`."""
        if not _card_edicao_restrita(card):
            return True
        return request.user.has_perm('accounts.manage_locked_card_attachments')

    def list(self, request, *args, **kwargs):
        card_id = request.query_params.get('card')
        try:
            card_id = int(card_id)
        except (TypeError, ValueError):
            return Response({'detail': 'Informe o parâmetro card (id numérico).'},
                            status=status.HTTP_400_BAD_REQUEST)
        # `get_queryset()` já está escopado: card de outro setor devolve lista
        # vazia, indistinguível de "card sem anexos" — nada de oráculo de ids.
        qs = self.get_queryset().filter(card_id=card_id)
        serializer = self.get_serializer(qs, many=True)
        return Response(serializer.data)

    def create(self, request, *args, **kwargs):
        try:
            card_id = int(request.data.get('card'))
        except (TypeError, ValueError):
            return Response({'detail': 'Card não encontrado.'},
                            status=status.HTTP_400_BAD_REQUEST)
        # O card vem por id do cliente e este viewset não usa o
        # `CompartilhamentoSetorMixin` (não há `get_object()` no POST), então
        # nenhum gate de objeto roda: resolver o card DENTRO do escopo é a única
        # barreira. Card fora do escopo responde como card inexistente.
        card = scope_cards(  # fail-open enquanto flag OFF
            Card.objects.select_related('projeto', 'projeto__sprint').filter(pk=card_id),
            request.user,
        ).first()
        if card is None:
            return Response({'detail': 'Card não encontrado.'},
                            status=status.HTTP_400_BAD_REQUEST)
        # Anexar arquivo é escrever DENTRO do card: gate de pai, sobre o card.
        checar_escrita_no_pai(request.user, card)
        if not self._pode_mutar(request, card):
            return Response(
                {'detail': 'Cards finalizados/inviabilizados ou de sprints finalizadas '
                           'só permitem anexos de supervisor ou admin.'},
                status=status.HTTP_403_FORBIDDEN,
            )
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        arquivo = serializer.validated_data['arquivo']
        instance = serializer.save(
            enviado_por=request.user,
            nome_original=os.path.basename(getattr(arquivo, 'name', '') or '')[:255],
            tamanho=getattr(arquivo, 'size', 0) or 0,
        )
        return Response(self.get_serializer(instance).data, status=status.HTTP_201_CREATED)

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        # Gate de escrita expresso sobre `instance.card`, JAMAIS sobre o anexo:
        # `nivel_de_acesso` não conhece CardAnexo (o model não tem `setor` nem
        # `compartilhamentos`), então perguntar pelo próprio anexo devolveria
        # None e negaria TODA remoção assim que a flag de escrita subisse.
        # Quem responde pelo anexo é o card dono — a mesma regra do `create`.
        checar_escrita_no_pai(request.user, instance.card)
        if not self._pode_mutar(request, instance.card):
            return Response(
                {'detail': 'Sem permissão para remover anexos deste card.'},
                status=status.HTTP_403_FORBIDDEN,
            )
        instance.arquivo.delete(save=False)  # remove o arquivo do storage
        instance.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

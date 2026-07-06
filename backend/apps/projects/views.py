import logging

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
from .services import finalizar_sprint_replicacao
from apps.accounts.profile_picture_utils import get_profile_picture_url
from apps.accounts.permissions import IsAdminOrSupervisor
from .serializers import (
    SprintSerializer, ProjectSerializer, CardSerializer, CardKanbanSerializer,
    CardMetricsSerializer,
    UserNoteSerializer, CardPinSerializer, EventSerializer,
    CardLogSerializer, NotificationSerializer, NotificationPreferenceSerializer,
    WeeklyPrioritySerializer, WeeklyPriorityConfigSerializer,
    CardDueDateChangeRequestSerializer,
    KanbanStageSerializer,
    ScoreCriterionSerializer, CardScoreSerializer, CardPickerSerializer,
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


class SprintViewSet(viewsets.ModelViewSet):
    queryset = Sprint.objects.all()
    serializer_class = SprintSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ['supervisor']
    search_fields = ['nome']
    ordering_fields = ['data_inicio', 'fechamento_em', 'created_at']
    ordering = ['-data_inicio']

    def get_permissions(self):
        # Criar/editar/excluir sprint: só supervisor/admin (espelha `canCreate`
        # no front). Restrições extras de sprint finalizada em update/destroy.
        if self.action in ('create', 'update', 'partial_update', 'destroy'):
            return [IsAdminOrSupervisor()]
        return super().get_permissions()

    def update(self, request, *args, **kwargs):
        sprint = self.get_object()
        if _sprint_efetivamente_fechada(sprint) and request.user.role != 'admin':
            return Response(
                {'detail': 'Sprints finalizadas só podem ser editadas por administrador.'},
                status=status.HTTP_403_FORBIDDEN,
            )
        return super().update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        sprint = self.get_object()
        if _sprint_efetivamente_fechada(sprint) and request.user.role != 'admin':
            return Response(
                {'detail': 'Apenas administradores podem excluir sprints finalizadas.'},
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
        return (
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

    @action(detail=True, methods=['get'], url_path='bundle')
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
        projects = (
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
            .order_by('id')
        )
        project_ids = list(projects.values_list('id', flat=True))

        # Todos os cards dos projetos da sprint — single query com select_related
        # e annotate(events_count) (evita N+1 do SerializerMethodField).
        cards = (
            Card.objects.filter(projeto_id__in=project_ids)
            .select_related('projeto', 'projeto__sprint', 'responsavel', 'criado_por', 'score')
            .annotate(events_count=Count('events'))
            .order_by('projeto_id', 'id')
        )

        # Kanban configs por projeto. Pré-popula configs default em projetos
        # legados (igual ProjectViewSet.kanban_config). Em uma única query
        # com select_related stage.
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
        if request.user.role not in ['supervisor', 'admin']:
            return Response(
                {'detail': 'Apenas supervisor ou admin podem finalizar a sprint.'},
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


class ProjectViewSet(viewsets.ModelViewSet):
    queryset = Project.objects.all()
    serializer_class = ProjectSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    # `arquivado` NÃO entra em filterset_fields — fazemos handling manual em
    # get_queryset (que aceita 'all' além de true/false). Se entrasse aqui,
    # o BooleanFilter do django-filter rejeitaria valores não-booleanos com 400.
    filterset_fields = ['sprint', 'gerente_atribuido', 'desenvolvedor', 'status']
    search_fields = ['nome', 'descricao']
    ordering_fields = ['created_at', 'data_criacao', 'data_entrega', 'arquivado_em']
    ordering = ['-created_at']

    def get_permissions(self):
        # Criar/editar projeto: só supervisor/admin (espelha `canManageProjects`
        # no front). Excluir já é coberto por `_ensure_can_manage` no destroy.
        if self.action in ('create', 'update', 'partial_update'):
            return [IsAdminOrSupervisor()]
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
        return request.user.role in ['supervisor', 'admin']

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

    def _ensure_can_manage(self, request):
        """Retorna `Response` 403 se o usuário não pode gerenciar projetos.
        Caso contrário, retorna None (segue o fluxo)."""
        if not self._is_supervisor_editor(request):
            return Response(
                {'detail': 'Apenas supervisores e administradores podem arquivar/excluir projetos.'},
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

    def _safe_ids(self, ids):
        """Remove IDs de projetos sistêmicos (is_system=True) do conjunto.
        Retorna (safe_ids, blocked_count).

        Defesa server-side: o frontend já omite esses, mas garantimos aqui pra
        clientes API diretos. Usa a flag `is_system` (verdade canônica)
        em vez de comparar nome — robusto contra renomeações."""
        if not ids:
            return [], 0
        blocked_ids = set(
            Project.objects.filter(id__in=ids, is_system=True)
            .values_list('id', flat=True)
        )
        safe = [i for i in ids if i not in blocked_ids]
        return safe, len(blocked_ids)

    def destroy(self, request, *args, **kwargs):
        # NOTA DE COMPATIBILIDADE: antes desta mudança, qualquer usuário
        # autenticado podia chamar DELETE /projects/<id>/. Agora exige
        # supervisor/admin — alinha com a regra das ações em massa.
        forbidden = self._ensure_can_manage(request)
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
        forbidden = self._ensure_can_manage(request)
        if forbidden:
            return forbidden
        ids, err = self._resolve_ids(request)
        if err:
            return err
        safe_ids, blocked = self._safe_ids(ids)
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
        forbidden = self._ensure_can_manage(request)
        if forbidden:
            return forbidden
        ids, err = self._resolve_ids(request)
        if err:
            return err
        safe_ids, blocked = self._safe_ids(ids)
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
        forbidden = self._ensure_can_manage(request)
        if forbidden:
            return forbidden
        ids, err = self._resolve_ids(request)
        if err:
            return err
        safe_ids, blocked = self._safe_ids(ids)

        # Importa local pra evitar ciclo com realtime.
        from .realtime import _sprint_is_active

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
        forbidden = self._ensure_can_manage(request)
        if forbidden:
            return forbidden
        ids, err = self._resolve_ids(request)
        if err:
            return err
        safe_ids, blocked = self._safe_ids(ids)
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
    permission_classes = [IsAuthenticated]

    def _is_supervisor_editor(self, request):
        return request.user.role in ['supervisor', 'admin']

    def perform_create(self, serializer):
        if not self._is_supervisor_editor(self.request):
            from rest_framework.exceptions import PermissionDenied

            raise PermissionDenied('Apenas supervisor ou admin podem criar etapas do Kanban.')
        serializer.save()


class CardViewSet(viewsets.ModelViewSet):
    queryset = Card.objects.all()
    serializer_class = CardSerializer
    permission_classes = [IsAuthenticated]
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
        return queryset
    
    def perform_create(self, serializer):
        """Define o criado_por automaticamente ao criar um card"""
        serializer.save(criado_por=self.request.user)

    @action(detail=False, methods=['get'], url_path='metrics')
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
        serializer = CardMetricsSerializer(qs, many=True)
        response = Response(serializer.data)
        # Cache HTTP curto (60s) — alinhado com o cache SWR do frontend.
        # `private` porque o conjunto pode variar por permissão (futuro).
        response['Cache-Control'] = 'private, max-age=60'
        return response

    def update(self, request, *args, **kwargs):
        """Permite atualização apenas se o usuário for o criador ou supervisor/admin"""
        instance = self.get_object()
        user = request.user
        is_privileged = user.role in ('supervisor', 'admin')

        # Card finalizado/inviabilizado ou de sprint fechada: só admin/supervisor
        # pode editar (cobre PATCH/PUT, inclusive mover status pelo board).
        if not is_privileged and _card_edicao_restrita(instance):
            return Response(
                {'detail': 'Cards finalizados/inviabilizados ou de sprints finalizadas '
                           'só podem ser editados por supervisor ou admin.'},
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
            # Para demandas: apenas o criador pode editar (ou supervisor/admin)
            if not is_privileged:
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
        """Permite exclusão apenas se o usuário for o criador ou supervisor/admin"""
        instance = self.get_object()
        user = request.user
        is_privileged = user.role in ('supervisor', 'admin')

        # Card finalizado/inviabilizado ou de sprint fechada: só admin/supervisor exclui.
        if not is_privileged and _card_edicao_restrita(instance):
            return Response(
                {'detail': 'Cards finalizados/inviabilizados ou de sprints finalizadas '
                           'só podem ser excluídos por supervisor ou admin.'},
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
            # Para demandas: apenas o criador pode deletar (ou supervisor/admin)
            if not is_privileged:
                # Comparar IDs para evitar problemas de comparação de objetos
                criado_por_id = instance.criado_por.id if instance.criado_por else None
                user_id = user.id if user else None
                if criado_por_id != user_id:
                    return Response(
                        {'detail': 'Você só pode deletar demandas que você mesmo criou.'},
                        status=status.HTTP_403_FORBIDDEN
                    )

        return super().destroy(request, *args, **kwargs)
    
    @action(detail=False, methods=['get'], url_path='priorities_view')
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
        hoje = timezone.now().date()
        inicio_hoje = timezone.make_aware(datetime.combine(hoje, datetime.min.time()))
        fim_hoje = timezone.make_aware(datetime.combine(hoje, datetime.max.time()))
        
        # Buscar TODOS os usuários com cargos abaixo de supervisor (gerente, desenvolvedor, dados)
        usuarios_ativos = User.objects.filter(
            is_active=True
        ).exclude(
            role__in=['supervisor', 'admin']
        )
        
        if periodo == 'dia':
            # Prioridades do dia: considerar apenas cards de sprints em andamento
            # Definição de sprint em andamento:
            # - sprint não finalizada
            # - data_inicio <= hoje <= dia de fechamento (data do fechamento_em)
            # E com status relevantes ou finalizados hoje
            cards_em_desenvolvimento = Card.objects.filter(
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
                responsavel__role__in=['supervisor', 'admin']
            ).select_related('responsavel', 'projeto')
            
            # Debug (sem PII em logs; ativável via logger.debug com handler dedicado)
            logger.debug("[Priorities] DIA cards=%d", cards_em_desenvolvimento.count())

        else:
            # Prioridades da semana: cards que vencem até o final da semana (7 dias)
            fim_semana = hoje + timedelta(days=7)
            cards_em_desenvolvimento = Card.objects.filter(
                status__in=['a_desenvolver', 'em_desenvolvimento', 'parado_pendencias', 'em_homologacao', 'finalizado']
            ).filter(projeto__arquivado=False).exclude(responsavel__isnull=True).exclude(
                responsavel__role__in=['supervisor', 'admin']
            ).filter(
                Q(data_fim__gte=hoje, data_fim__lte=fim_semana) |
                Q(status='finalizado', updated_at__date__gte=hoje, updated_at__date__lte=fim_semana)
            )
        
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
    permission_classes = [IsAuthenticated]
    pagination_class = None
    http_method_names = ['get', 'post', 'delete']

    def get_queryset(self):
        now = timezone.now()
        return (
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

    @action(detail=False, methods=['delete'], url_path='by-card/(?P<card_id>[^/.]+)')
    def delete_by_card(self, request, card_id=None):
        """DELETE /card-pins/by-card/<card_id>/ — atalho para desfixar sem
        precisar conhecer o id do CardPin."""
        deleted, _ = CardPin.objects.filter(user=request.user, card_id=card_id).delete()
        if deleted == 0:
            return Response(status=status.HTTP_404_NOT_FOUND)
        return Response(status=status.HTTP_204_NO_CONTENT)


class EventViewSet(viewsets.ModelViewSet):
    serializer_class = EventSerializer
    permission_classes = [IsAuthenticated]
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
        return qs


class CardLogViewSet(viewsets.ModelViewSet):
    serializer_class = CardLogSerializer
    permission_classes = [IsAuthenticated]
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
        return qs

    def perform_create(self, serializer):
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
    permission_classes = [IsAuthenticated]
    
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
        if self.request.user.role not in ['supervisor', 'admin']:
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied("Apenas supervisores e administradores podem criar configurações de prioridades semanais.")
        serializer.save()
    
    def perform_update(self, serializer):
        # Verificar se o usuário é supervisor ou admin
        if self.request.user.role not in ['supervisor', 'admin']:
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied("Apenas supervisores e administradores podem atualizar configurações de prioridades semanais.")
        serializer.save()
    
    def destroy(self, request, *args, **kwargs):
        # Verificar se o usuário é supervisor ou admin
        if request.user.role not in ['supervisor', 'admin']:
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied("Apenas supervisores e administradores podem remover configurações de prioridades semanais.")
        return super().destroy(request, *args, **kwargs)
    
    @action(detail=False, methods=['post'], url_path='close-week')
    def close_week(self, request):
        """Fecha a semana atual, marcando todos os cards não concluídos"""
        if request.user.role not in ['supervisor', 'admin']:
            raise PermissionDenied("Apenas supervisores e administradores podem fechar a semana.")
        
        hoje = timezone.now().date()
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
        if request.user.role not in ['supervisor', 'admin']:
            raise PermissionDenied("Apenas supervisores e administradores podem limpar prioridades.")
        
        hoje = timezone.now().date()
        dias_ate_segunda = hoje.weekday()  # 0 = segunda, 6 = domingo
        semana_inicio = hoje - timedelta(days=dias_ate_segunda)
        
        config = WeeklyPriorityConfig.get_config()
        
        # Verificar se a semana está fechada
        if not config.is_semana_fechada(semana_inicio):
            raise ValidationError("A semana deve estar fechada antes de limpar as prioridades.")
        
        # Deletar todas as prioridades da semana atual
        priorities = WeeklyPriority.objects.filter(semana_inicio=semana_inicio)
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
    permission_classes = [IsAuthenticated]
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
            hoje = timezone.now().date()
            # Calcular segunda-feira da semana atual
            dias_ate_segunda = hoje.weekday()  # 0 = segunda, 6 = domingo
            semana_inicio = hoje - timedelta(days=dias_ate_segunda)
            queryset = queryset.filter(semana_inicio=semana_inicio)
        
        return queryset
    
    def perform_create(self, serializer):
        # Verificar se o usuário é supervisor ou admin
        if self.request.user.role not in ['supervisor', 'admin']:
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
        if self.request.user.role not in ['supervisor', 'admin']:
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
        if request.user.role not in ['supervisor', 'admin']:
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
        hoje = timezone.now().date()
        # Calcular segunda-feira da semana atual
        dias_ate_segunda = hoje.weekday()  # 0 = segunda, 6 = domingo
        semana_inicio = hoje - timedelta(days=dias_ate_segunda)
        semana_fim = semana_inicio + timedelta(days=4)  # Sexta-feira
        
        priorities = WeeklyPriority.objects.filter(
            semana_inicio=semana_inicio
        ).select_related('usuario', 'card', 'definido_por')
        
        serializer = self.get_serializer(priorities, many=True)
        return Response(serializer.data)

    @action(detail=False, methods=['get'], url_path='define_priority_options')
    def define_priority_options(self, request):
        """Cards disponíveis + prioridades já definidas (uma request leve para o modal)."""
        from rest_framework.exceptions import PermissionDenied, ValidationError

        if request.user.role not in ['supervisor', 'admin']:
            raise PermissionDenied(
                'Apenas supervisores e administradores podem definir prioridades semanais.'
            )

        usuario_id = request.query_params.get('usuario')
        if not usuario_id:
            raise ValidationError({'usuario': 'Parâmetro obrigatório.'})

        hoje = timezone.now().date()
        semana_inicio = hoje - timedelta(days=hoje.weekday())

        cards = (
            Card.objects.filter(
                responsavel_id=usuario_id,
                projeto__arquivado=False,
            )
            .exclude(status__in=[CardStatus.FINALIZADO, CardStatus.INVIABILIZADO])
            .select_related('projeto')
            .order_by('-created_at')
        )

        selected_ids = set(
            WeeklyPriority.objects.filter(
                usuario_id=usuario_id,
                semana_inicio=semana_inicio,
                card__projeto__arquivado=False,
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

    @action(detail=False, methods=['get'], url_path='priorities_view')
    def priorities_view(self, request):
        """Retorna usuários com prioridades semanais e cards fechados nos últimos 7 dias."""
        from django.contrib.auth import get_user_model

        User = get_user_model()
        hoje = timezone.now().date()
        dias_ate_segunda = hoje.weekday()
        semana_inicio = hoje - timedelta(days=dias_ate_segunda)
        limite_fechados = timezone.now() - timedelta(days=7)

        usuarios_ativos = User.objects.filter(is_active=True).exclude(
            role__in=['supervisor', 'admin']
        )

        config = WeeklyPriorityConfig.get_config()
        semana_fechada = config.is_semana_fechada(semana_inicio)

        priorities = WeeklyPriority.objects.filter(
            semana_inicio=semana_inicio,
            card__projeto__arquivado=False,
        ).select_related('usuario', 'card', 'definido_por', 'card__projeto')

        priorities_por_usuario: dict[int, list] = {}
        priority_by_card_id: dict[int, WeeklyPriority] = {}
        for priority in priorities:
            user_id = int(priority.usuario.id)
            priorities_por_usuario.setdefault(user_id, []).append(priority)
            priority_by_card_id[priority.card_id] = priority

        cards_fechados = Card.objects.filter(
            responsavel__in=usuarios_ativos,
            status=CardStatus.FINALIZADO,
            projeto__arquivado=False,
        ).filter(
            Q(finalizado_em__gte=limite_fechados)
            | Q(finalizado_em__isnull=True, updated_at__gte=limite_fechados)
        ).select_related('projeto', 'responsavel')

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
    permission_classes = [IsAuthenticated]
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
        return qs

    def perform_create(self, serializer):
        card = serializer.validated_data.get('card')
        requested_date = serializer.validated_data.get('requested_date')
        from rest_framework.exceptions import ValidationError, PermissionDenied

        if not card:
            raise ValidationError({'card': 'Card é obrigatório.'})

        card = Card.objects.select_related('projeto__sprint').get(pk=card.pk)

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
        # só supervisor/admin — evita burlar o fluxo pelo endpoint.
        if request.user.role not in ('supervisor', 'admin'):
            return Response(
                {'detail': 'Apenas supervisor ou admin podem alterar solicitações.'},
                status=status.HTTP_403_FORBIDDEN,
            )
        return super().update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        is_privileged = request.user.role in ('supervisor', 'admin')
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
        if request.user.role not in ['supervisor', 'admin']:
            return Response({'detail': 'Apenas supervisor ou admin podem aprovar solicitações.'}, status=status.HTTP_403_FORBIDDEN)

        req = self.get_object()
        if req.status != 'pending':
            return Response({'detail': 'Esta solicitação não está pendente.'}, status=status.HTTP_400_BAD_REQUEST)

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
        if request.user.role not in ['supervisor', 'admin']:
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

    Restrito a Admin/Supervisor (feature de supervisão).
    """
    serializer_class = ScoreCriterionSerializer
    permission_classes = [IsAdminOrSupervisor]

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
    permission_classes = [IsAdminOrSupervisor]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ['card', 'setor_solicitante']
    search_fields = ['card__nome']
    ordering_fields = ['score_final', 'updated_at', 'created_at']
    ordering = ['-updated_at']

    def get_queryset(self):
        return (
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

    @action(detail=False, methods=['get'], url_path='pickable-cards')
    def pickable_cards(self, request):
        """Lista leve de cards para o seletor do modal (uma request, sem paginação)."""
        qs = (
            Card.objects
            .select_related('projeto', 'projeto__sprint', 'responsavel', 'score')
            .filter(projeto__arquivado=False, projeto__is_system=False)
            .order_by('-created_at')
        )
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
        if not Card.objects.filter(pk=card_id).exists():
            return Response({'detail': 'Card não encontrado.'},
                            status=status.HTTP_404_NOT_FOUND)
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

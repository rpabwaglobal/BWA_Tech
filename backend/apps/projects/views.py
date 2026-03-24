from rest_framework import viewsets, filters, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.decorators import action
from rest_framework.response import Response
from django_filters.rest_framework import DjangoFilterBackend
from django.db import transaction
from django.db.models import Q, Max, Count
from django.utils import timezone
from datetime import datetime, timedelta
from .models import (
    Sprint,
    Project,
    KanbanStage,
    ProjectKanbanStageConfig,
    Card,
    CardStatus,
    CardTodo,
    Event,
    CardLog,
    Notification,
    WeeklyPriority,
    WeeklyPriorityConfig,
    CardDueDateChangeRequest,
    CardLogEventType,
)
from .services import finalizar_sprint_replicacao
from .serializers import (
    SprintSerializer, ProjectSerializer, CardSerializer, CardTodoSerializer, EventSerializer, 
    CardLogSerializer, NotificationSerializer, WeeklyPrioritySerializer, WeeklyPriorityConfigSerializer,
    CardDueDateChangeRequestSerializer,
    KanbanStageSerializer,
)


class SprintViewSet(viewsets.ModelViewSet):
    queryset = Sprint.objects.all()
    serializer_class = SprintSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_fields = ['supervisor']
    search_fields = ['nome']
    ordering_fields = ['data_inicio', 'data_fim', 'created_at']
    ordering = ['-data_inicio']

    def get_queryset(self):
        hoje = timezone.localdate()
        return (
            Sprint.objects.all()
            .annotate(
                cards_total=Count('projects__cards'),
                cards_finalizados=Count(
                    'projects__cards',
                    filter=Q(projects__cards__status='finalizado'),
                ),
                cards_em_andamento=Count(
                    'projects__cards',
                    filter=Q(projects__cards__status__in=['em_desenvolvimento', 'em_homologacao']),
                ),
                cards_em_atraso=Count(
                    'projects__cards',
                    filter=Q(projects__cards__data_fim__date__lt=hoje)
                    & ~Q(projects__cards__status__in=['finalizado', 'inviabilizado']),
                ),
            )
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
    filterset_fields = ['sprint', 'gerente_atribuido', 'desenvolvedor', 'status']
    search_fields = ['nome', 'descricao']
    ordering_fields = ['created_at', 'data_criacao', 'data_entrega']
    ordering = ['-created_at']

    def get_queryset(self):
        # Contagens agregadas para evitar download de cards no frontend.
        return (
            Project.objects.all()
            .annotate(
                cards_entregues_count=Count(
                    'cards',
                    filter=Q(cards__status__in=['finalizado', 'inviabilizado']),
                ),
                cards_em_desenvolvimento_count=Count(
                    'cards',
                    filter=Q(cards__status__in=['em_desenvolvimento']),
                ),
            )
        )

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

    @action(detail=True, methods=['get'], url_path='kanban-config')
    def kanban_config(self, request, pk=None):
        """
        Retorna as etapas/colunas configuradas para o projeto em ordem.
        """
        project = self.get_object()
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

            Card.objects.filter(projeto=project, status=stage_key).update(status=move_to_key)

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

        Card.objects.filter(projeto=project, status=from_stage_key).update(status=to_stage_key)

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
            'projeto', 'projeto__sprint', 'criado_por', 'responsavel'
        ).all()
        # Filtro adicional para buscar cards por responsável (para página Meus Afazeres)
        responsavel_id = self.request.query_params.get('responsavel', None)
        if responsavel_id:
            queryset = queryset.filter(responsavel_id=responsavel_id)
        return queryset
    
    def perform_create(self, serializer):
        """Define o criado_por automaticamente ao criar um card"""
        serializer.save(criado_por=self.request.user)
    
    
    def update(self, request, *args, **kwargs):
        """Permite atualização apenas se o usuário for o criador ou supervisor/admin"""
        instance = self.get_object()
        user = request.user
        
        # Verificar se é uma demanda (card no projeto "Sugestões")
        try:
            is_demanda = instance.projeto and instance.projeto.nome == 'Sugestões'
        except Exception:
            # Se houver erro ao acessar projeto, recarregar com select_related
            instance = Card.objects.select_related('projeto', 'criado_por').get(pk=instance.pk)
            is_demanda = instance.projeto and instance.projeto.nome == 'Sugestões'
        
        if is_demanda:
            # Para demandas: apenas o criador pode editar (ou supervisor/admin)
            if user.role not in ['supervisor', 'admin']:
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
        
        # Verificar se é uma demanda (card no projeto "Sugestões")
        try:
            is_demanda = instance.projeto and instance.projeto.nome == 'Sugestões'
        except Exception:
            # Se houver erro ao acessar projeto, recarregar com select_related
            instance = Card.objects.select_related('projeto', 'criado_por').get(pk=instance.pk)
            is_demanda = instance.projeto and instance.projeto.nome == 'Sugestões'
        
        if is_demanda:
            # Para demandas: apenas o criador pode deletar (ou supervisor/admin)
            if user.role not in ['supervisor', 'admin']:
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
            # - data_inicio <= hoje <= data_fim
            # E com status relevantes ou finalizados hoje
            cards_em_desenvolvimento = Card.objects.filter(
                Q(status='em_desenvolvimento') |  # Cards em desenvolvimento
                Q(status='em_homologacao') |  # Cards em homologação
                Q(status='parado_pendencias') |  # Cards parados por pendências
                Q(status='finalizado', updated_at__date=hoje)  # OU cards finalizados hoje
            ).filter(
                projeto__sprint__finalizada=False,
                projeto__sprint__data_inicio__lte=hoje,
                projeto__sprint__data_fim__gte=hoje,
            ).exclude(responsavel__isnull=True).exclude(
                responsavel__role__in=['supervisor', 'admin']
            ).select_related('responsavel', 'projeto')
            
            # Debug
            print(f"[Priorities] Periodo: DIA - Cards encontrados: {cards_em_desenvolvimento.count()}")
            for card in cards_em_desenvolvimento:
                print(f"  - Card: {card.nome} | Status: {card.status} | Responsavel: {card.responsavel.username if card.responsavel else None} | Responsavel ID: {card.responsavel.id if card.responsavel else None}")
            
        else:
            # Prioridades da semana: cards que vencem até o final da semana (7 dias)
            fim_semana = hoje + timedelta(days=7)
            cards_em_desenvolvimento = Card.objects.filter(
                status__in=['a_desenvolver', 'em_desenvolvimento', 'parado_pendencias', 'em_homologacao', 'finalizado']
            ).exclude(responsavel__isnull=True).exclude(
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
                print(f"[Priorities] Card '{card.nome}' atribuído ao usuário {card.responsavel.username} (ID: {user_id})")
        
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
                    'profile_picture_url': request.build_absolute_uri(usuario.profile_picture.url if usuario.profile_picture.url.startswith('/') else '/' + usuario.profile_picture.url) if usuario.profile_picture else None,
                },
                'cards': cards_serializados
            })
        
        # Debug detalhado
        print(f"[Priorities] Usuarios com cards: {usuarios_com_cards} de {len(usuarios_ativos)}")
        print(f"[Priorities] Total de resultados: {len(result)}")
        print(f"[Priorities] Cards por usuario (dict): {list(cards_por_usuario.keys())}")
        for r in result:
            if r['cards']:
                print(f"  - {r['usuario']['username']} (ID: {r['usuario']['id']}): {len(r['cards'])} cards")
                for card in r['cards']:
                    print(f"    * {card.get('nome', 'N/A')} | Status: {card.get('status', 'N/A')}")
            elif r['usuario']['username'] in ['jefferson', 'italo', 'ilton']:  # Usuários que devem ter cards
                print(f"  - {r['usuario']['username']} (ID: {r['usuario']['id']}): SEM CARDS (esperado ter cards)")
                print(f"    Cards no dict para este usuario: {cards_por_usuario.get(r['usuario']['id'], [])}")
            
        # Ordenar: primeiro usuários com cards (por prioridade), depois sem cards
        result.sort(key=lambda x: (
            0 if x['cards'] else 1,  # Com cards primeiro
            prioridade_order.get(x['cards'][0]['prioridade'], 99) if x['cards'] else 99
        ))
        
        return Response(result)


class CardTodoViewSet(viewsets.ModelViewSet):
    queryset = CardTodo.objects.all()
    serializer_class = CardTodoSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_fields = ['card', 'status', 'is_original']
    ordering_fields = ['order', 'created_at']
    ordering = ['order', 'created_at']
    
    def perform_update(self, serializer):
        """Passar usuário da requisição para o signal e salvar dados anteriores"""
        instance = serializer.instance
        # Salvar dados anteriores antes de atualizar (para o signal)
        if instance.pk:
            instance._previous_status = instance.status
            instance._previous_comment = instance.comment
        instance = serializer.save()
        # O signal já será disparado automaticamente pelo post_save
    
    @action(detail=True, methods=['patch'], url_path='update-status')
    def update_status(self, request, pk=None):
        """Atualizar apenas o status de um TODO"""
        todo = self.get_object()
        new_status = request.data.get('status')
        
        if new_status not in ['pending', 'completed', 'blocked', 'warning']:
            from rest_framework.exceptions import ValidationError
            raise ValidationError({'status': 'Status inválido. Deve ser: pending, completed, blocked ou warning'})
        
        # Salvar dados anteriores antes de atualizar (para o signal)
        old_status = todo.status
        old_comment = todo.comment
        todo.status = new_status
        
        # Atribuir dados anteriores diretamente para garantir que o signal tenha acesso
        todo._previous_status = old_status
        todo._previous_comment = old_comment
        
        todo.save()  # Isso disparará o signal post_save
        
        serializer = self.get_serializer(todo)
        return Response(serializer.data)


class EventViewSet(viewsets.ModelViewSet):
    queryset = Event.objects.all()
    serializer_class = EventSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_fields = ['card', 'tipo', 'usuario']
    ordering_fields = ['data']
    ordering = ['-data']


class CardLogViewSet(viewsets.ModelViewSet):
    queryset = CardLog.objects.all()
    serializer_class = CardLogSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_fields = ['card', 'tipo_evento', 'usuario']
    ordering_fields = ['data']
    ordering = ['-data']

    def perform_create(self, serializer):
        # Preencher o usuário automaticamente se não foi fornecido
        if not serializer.validated_data.get('usuario'):
            serializer.save(usuario=self.request.user)
        else:
            serializer.save()


class NotificationViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = NotificationSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, filters.OrderingFilter]
    filterset_fields = ['tipo', 'lida']
    ordering_fields = ['data_criacao']
    ordering = ['-data_criacao']
    
    def get_queryset(self):
        # Retornar apenas notificações do usuário atual
        queryset = Notification.objects.filter(usuario=self.request.user)
        
        # Filtro adicional para "minhas" notificações (específicas do usuário)
        filter_type = self.request.query_params.get('filter', None)
        if filter_type == 'mine':
            # Notificações específicas do usuário (excluir gerais como sprint criada)
            from .models import NotificationType
            queryset = queryset.exclude(tipo__in=[
                NotificationType.SPRINT_CREATED
            ])
        
        return queryset
    
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
        """Marcar todas as notificações do usuário como lidas"""
        count = Notification.objects.filter(
            usuario=request.user,
            lida=False
        ).update(lida=True)
        return Response({'count': count})
    
    @action(detail=False, methods=['get'])
    def unread_count(self, request):
        """Contar notificações não lidas"""
        count = Notification.objects.filter(
            usuario=request.user,
            lida=False
        ).count()
        
        # Contar notificações específicas do usuário (excluindo gerais)
        from .models import NotificationType
        mine_count = Notification.objects.filter(
            usuario=request.user,
            lida=False
        ).exclude(tipo__in=[
            NotificationType.SPRINT_CREATED
        ]).count()
        
        return Response({
            'total': count,
            'mine': mine_count
        })


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
        # Atualizar quem definiu a prioridade
        serializer.save(definido_por=self.request.user)
    
    def destroy(self, request, *args, **kwargs):
        # Verificar se o usuário é supervisor ou admin
        if request.user.role not in ['supervisor', 'admin']:
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied("Apenas supervisores e administradores podem remover prioridades semanais.")
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
        return CardDueDateChangeRequest.objects.select_related(
            'card', 'card__projeto', 'requested_by', 'reviewed_by'
        ).all()

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
            new_dt = datetime.combine(req.requested_date, old_dt.time())
            if timezone.is_aware(old_dt):
                new_dt = timezone.make_aware(new_dt, old_dt.tzinfo or timezone.get_current_timezone())

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
    
    @action(detail=False, methods=['get'], url_path='priorities_view')
    def priorities_view(self, request):
        """Retorna usuários com suas prioridades semanais para a página de Prioridades"""
        hoje = timezone.now().date()
        # Calcular segunda-feira da semana atual
        dias_ate_segunda = hoje.weekday()  # 0 = segunda, 6 = domingo
        semana_inicio = hoje - timedelta(days=dias_ate_segunda)
        semana_fim = semana_inicio + timedelta(days=4)  # Sexta-feira
        
        # Buscar TODOS os usuários com cargos abaixo de supervisor
        from django.contrib.auth import get_user_model
        User = get_user_model()
        usuarios_ativos = User.objects.filter(
            is_active=True
        ).exclude(
            role__in=['supervisor', 'admin']
        )
        
        # Verificar se a semana está fechada
        config = WeeklyPriorityConfig.get_config()
        semana_fechada = config.is_semana_fechada(semana_inicio)
        
        # Buscar prioridades da semana atual
        priorities = WeeklyPriority.objects.filter(
            semana_inicio=semana_inicio
        ).select_related('usuario', 'card', 'definido_por', 'card__projeto')
        
        # Criar dicionário de prioridades por usuário (lista de prioridades)
        priorities_por_usuario = {}
        for priority in priorities:
            user_id = int(priority.usuario.id)
            if user_id not in priorities_por_usuario:
                priorities_por_usuario[user_id] = []
            priorities_por_usuario[user_id].append(priority)
        
        # Criar resultado incluindo TODOS os usuários
        result = []
        for usuario in usuarios_ativos:
            user_priorities = priorities_por_usuario.get(int(usuario.id), [])
            
            if user_priorities:
                # Serializar todos os cards das prioridades
                cards_serializados = []
                for priority in user_priorities:
                    card_data = CardSerializer(priority.card).data
                    priority_data = {
                        'id': str(priority.id),
                        'is_concluido': priority.is_concluido(),
                        'is_atrasado': priority.is_atrasado(),
                        'semana_inicio': priority.semana_inicio.isoformat(),
                        'semana_fim': priority.semana_fim.isoformat(),
                    }
                    card_data['weekly_priority'] = priority_data
                    cards_serializados.append(card_data)
            else:
                cards_serializados = []
            
            result.append({
                'usuario': {
                    'id': usuario.id,
                    'username': usuario.username,
                    'first_name': usuario.first_name,
                    'last_name': usuario.last_name,
                    'email': usuario.email,
                    'role': usuario.role,
                    'role_display': usuario.get_role_display(),
                    'profile_picture_url': request.build_absolute_uri(usuario.profile_picture.url if usuario.profile_picture.url.startswith('/') else '/' + usuario.profile_picture.url) if usuario.profile_picture else None,
                },
                'cards': cards_serializados
            })
        
        # Ordenar: primeiro usuários com cards, depois sem cards
        result.sort(key=lambda x: (
            0 if x['cards'] else 1,
            x['usuario']['username'] # Ordenar por nome de usuário se não tiver cards
        ))
        
        return Response({
            'semana_fechada': semana_fechada,
            'semana_inicio': semana_inicio.isoformat(),
            'data': result
        })

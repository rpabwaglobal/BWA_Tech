from rest_framework import serializers
from django.utils import timezone
import re
import unicodedata
from .models import (
    Sprint,
    Project,
    KanbanStage,
    ProjectKanbanStageConfig,
    Card,
    CardStatus,
    # CardTodo removido — substituído por UserNote
    UserNote,
    UserNoteItem,
    UserNoteItemKind,
    CardPin,
    Event,
    CardLog,
    Notification,
    UserNotificationPreference,
    WeeklyPriority,
    WeeklyPriorityConfig,
    CardArea,
    CardDueDateChangeRequest,
)
from apps.accounts.serializers import UserSerializer
from apps.accounts.profile_picture_utils import get_profile_picture_url
from .dev_time_format import format_minutos_uteis, format_segundos_corridos


class DevTimeFormattedMixin(serializers.Serializer):
    """Expõe valores brutos no banco e campos formatados para exibição."""
    dias_corridos_desenvolvimento = serializers.SerializerMethodField()
    horas_uteis_desenvolvimento = serializers.SerializerMethodField()

    def get_dias_corridos_desenvolvimento(self, obj):
        return format_segundos_corridos(obj.segundos_corridos_desenvolvimento)

    def get_horas_uteis_desenvolvimento(self, obj):
        return format_minutos_uteis(obj.minutos_uteis_desenvolvimento)


def format_user_name(user):
    """Formata o nome do usuário com first_name e last_name"""
    if not user:
        return None
    if user.first_name and user.last_name:
        return f"{user.first_name} {user.last_name}"
    elif user.first_name:
        return user.first_name
    elif user.last_name:
        return user.last_name
    return user.username


class SprintSerializer(serializers.ModelSerializer):
    supervisor_name = serializers.SerializerMethodField()
    # Sem input_formats restritivos: usa o padrão DRF (ISO 8601 / parse_datetime),
    # igual a fechamento_em — aceita strings do browser (ex.: ...Z de toISOString()).
    data_inicio = serializers.DateTimeField()
    fechamento_em = serializers.DateTimeField()
    # Compatível com telas antigas: só o dia final (derivado de fechamento_em)
    data_fim = serializers.SerializerMethodField(read_only=True)
    projects_count = serializers.IntegerField(source='projects.count', read_only=True)
    cards_total = serializers.IntegerField(read_only=True)
    cards_finalizados = serializers.IntegerField(read_only=True)
    cards_inviabilizados = serializers.IntegerField(read_only=True)
    cards_em_andamento = serializers.IntegerField(read_only=True)
    cards_em_atraso = serializers.IntegerField(read_only=True)
    cards_entregues_atrasados = serializers.IntegerField(read_only=True)
    cards_abertos_atrasados = serializers.IntegerField(read_only=True)

    def get_supervisor_name(self, obj):
        return format_user_name(obj.supervisor)

    def get_data_fim(self, obj):
        if obj.fechamento_em:
            return timezone.localtime(obj.fechamento_em).date().isoformat()
        return None

    @staticmethod
    def _duracao_dias(data_inicio, fechamento_em):
        fe = fechamento_em
        if timezone.is_naive(fe):
            fe = timezone.make_aware(fe, timezone.get_current_timezone())
        di = data_inicio
        if di is not None and timezone.is_naive(di):
            di = timezone.make_aware(di, timezone.get_current_timezone())
        end_d = timezone.localtime(fe).date()
        start_d = timezone.localtime(di).date() if di is not None else None
        if start_d is None:
            return 1
        return max(1, (end_d - start_d).days + 1)

    def validate(self, attrs):
        di = attrs.get('data_inicio')
        fe = attrs.get('fechamento_em')
        if self.instance:
            di = di if di is not None else self.instance.data_inicio
            fe = fe if fe is not None else self.instance.fechamento_em
        if di and fe:
            if timezone.is_naive(fe):
                fe = timezone.make_aware(fe, timezone.get_current_timezone())
            if timezone.is_naive(di):
                di = timezone.make_aware(di, timezone.get_current_timezone())
            if fe < di:
                raise serializers.ValidationError(
                    {'fechamento_em': 'A data/hora de fechamento não pode ser anterior ao início da sprint.'}
                )
        return attrs

    def create(self, validated_data):
        validated_data['duracao_dias'] = self._duracao_dias(
            validated_data['data_inicio'], validated_data['fechamento_em']
        )
        return super().create(validated_data)

    def update(self, instance, validated_data):
        inst = super().update(instance, validated_data)
        if 'data_inicio' in validated_data or 'fechamento_em' in validated_data:
            inst.duracao_dias = self._duracao_dias(inst.data_inicio, inst.fechamento_em)
            inst.save(update_fields=['duracao_dias'])
        return inst

    class Meta:
        model = Sprint
        fields = ['id', 'nome', 'data_inicio', 'fechamento_em', 'data_fim', 'duracao_dias',
                 'supervisor', 'supervisor_name', 'projects_count',
                 'cards_total', 'cards_finalizados', 'cards_inviabilizados',
                 'cards_em_andamento', 'cards_em_atraso',
                 'cards_entregues_atrasados', 'cards_abertos_atrasados',
                 'finalizada', 'created_at', 'updated_at']
        read_only_fields = [
            'created_at',
            'updated_at',
            'finalizada',
            'data_fim',
            'duracao_dias',  # calculado em create/update a partir de data_inicio e fechamento_em
        ]


class ProjectSerializer(serializers.ModelSerializer):
    sprint_detail = SprintSerializer(source='sprint', read_only=True)
    gerente_name = serializers.SerializerMethodField()
    desenvolvedor_name = serializers.SerializerMethodField()
    arquivado_por_name = serializers.SerializerMethodField()

    def get_gerente_name(self, obj):
        return format_user_name(obj.gerente_atribuido)

    def get_desenvolvedor_name(self, obj):
        return format_user_name(obj.desenvolvedor)

    def get_arquivado_por_name(self, obj):
        return format_user_name(obj.arquivado_por) if obj.arquivado_por_id else None

    status_display = serializers.CharField(source='get_status_display', read_only=True)
    cards_count = serializers.IntegerField(source='cards.count', read_only=True)
    cards_entregues_count = serializers.IntegerField(read_only=True)
    cards_em_desenvolvimento_count = serializers.IntegerField(read_only=True)

    def validate_nome(self, value):
        """
        Permite nomes duplicados desde que estejam em sprints diferentes.
        """
        if self.instance:
            # Se está editando, verificar se há outro projeto com o mesmo nome em sprint diferente
            existing = Project.objects.filter(nome=value).exclude(id=self.instance.id)
        else:
            # Se está criando, verificar se há outro projeto com o mesmo nome
            existing = Project.objects.filter(nome=value)
        
        if existing.exists():
            sprint_id = self.initial_data.get('sprint')
            if sprint_id:
                # Verificar se algum projeto existente está na mesma sprint
                same_sprint = existing.filter(sprint_id=sprint_id)
                if same_sprint.exists():
                    raise serializers.ValidationError(
                        f"Já existe um projeto com o nome '{value}' nesta sprint."
                    )
        
        return value

    class Meta:
        model = Project
        fields = ['id', 'nome', 'descricao', 'sprint', 'sprint_detail', 'gerente_atribuido',
                 'gerente_name', 'desenvolvedor', 'desenvolvedor_name', 'status', 'status_display',
                 'data_criacao', 'data_avaliacao', 'data_atribuicao_gerente',
                 'data_inicio_desenvolvimento', 'data_entrega', 'data_homologacao',
                 'data_adiamento_solicitada', 'nova_data_prevista', 'adiamento_aprovado',
                 'arquivado', 'arquivado_em', 'arquivado_por', 'arquivado_por_name',
                 'is_system',
                 'cards_count', 'cards_entregues_count', 'cards_em_desenvolvimento_count',
                 'created_at', 'updated_at']
        # `arquivado_em` e `arquivado_por` SÃO preenchidos pelo backend nas actions
        # archive/unarchive. O campo `arquivado` é também read-only para clientes —
        # mudanças passam pelas actions dedicadas (permitem audit + permission check).
        # `is_system` é gerenciado pelo backend (migração + futura action admin) —
        # nunca editável via API pública para evitar marcar projetos arbitrários.
        read_only_fields = ['created_at', 'updated_at', 'data_criacao',
                            'arquivado', 'arquivado_em', 'arquivado_por', 'arquivado_por_name',
                            'is_system']


class UserNoteItemSerializer(serializers.ModelSerializer):
    # `parent` é o PK do item-pai no DB. Read-only no output (IDs trocam a
    # cada save por causa da replace-strategy); na entrada usa-se
    # `parent_client_id` (ver UserNoteSerializer).
    parent = serializers.PrimaryKeyRelatedField(read_only=True)
    # Inputs auxiliares pra referência cruzada dentro do MESMO payload:
    # cada item pode declarar um `client_id` (string opaca) e referenciar
    # outro item via `parent_client_id`. O serializer resolve depois de criar.
    client_id = serializers.CharField(required=False, allow_blank=True, write_only=True)
    parent_client_id = serializers.CharField(
        required=False, allow_blank=True, allow_null=True, write_only=True,
    )

    class Meta:
        model = UserNoteItem
        fields = [
            'id', 'kind', 'text', 'done', 'order', 'parent',
            'client_id', 'parent_client_id',
            'created_at', 'updated_at',
        ]
        # `id` precisa ser read-only — o backend usa estratégia de replace (delete + create)
        # nos updates aninhados, então ids vindos do cliente seriam ignorados ou
        # piores: causariam IntegrityError ao tentar inserir com PK já existente.
        read_only_fields = ['id', 'created_at', 'updated_at']


class UserNoteSerializer(serializers.ModelSerializer):
    items = UserNoteItemSerializer(many=True, required=False)

    class Meta:
        model = UserNote
        fields = [
            'id', 'title', 'color', 'pinned', 'archived', 'order',
            'items', 'created_at', 'updated_at',
        ]
        read_only_fields = ['created_at', 'updated_at']

    def _create_items(self, note, items_data):
        """Cria itens em DUAS passadas pra suportar parent_client_id.

        Pass 1: cria todos os itens sem parent, guarda um mapa
        client_id → PK gerado.
        Pass 2: para cada item com `parent_client_id`, resolve o PK via
        o mapa e atualiza `parent` em bulk.
        """
        client_id_to_pk: dict[str, int] = {}
        created: list[tuple[UserNoteItem, dict]] = []
        for idx, item in enumerate(items_data):
            payload = {
                k: v for k, v in item.items()
                if k not in ('order', 'client_id', 'parent_client_id')
            }
            # `done` só faz sentido pra todos — zero para texto evita confusão no admin.
            if payload.get('kind') != UserNoteItemKind.TODO:
                payload['done'] = False
            obj = UserNoteItem.objects.create(
                note=note, order=item.get('order', idx), **payload,
            )
            client_id = (item.get('client_id') or '').strip()
            if client_id:
                client_id_to_pk[client_id] = obj.pk
            created.append((obj, item))

        # Pass 2: linka pais
        for obj, item in created:
            ref = (item.get('parent_client_id') or '').strip() if item.get('parent_client_id') else ''
            if ref and ref in client_id_to_pk:
                parent_pk = client_id_to_pk[ref]
                # Defesa: item não pode ser pai de si mesmo (defesa).
                if parent_pk != obj.pk:
                    obj.parent_id = parent_pk
                    obj.save(update_fields=['parent'])

    def create(self, validated_data):
        items_data = validated_data.pop('items', [])
        user = self.context['request'].user
        note = UserNote.objects.create(user=user, **validated_data)
        self._create_items(note, items_data)
        return note

    def update(self, instance, validated_data):
        items_data = validated_data.pop('items', None)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        if items_data is not None:
            # Replace strategy: deleta todos os blocos atuais e recria com os
            # enviados. O frontend manda a lista completa em cada PATCH com `items`.
            instance.items.all().delete()
            self._create_items(instance, items_data)
        return instance


class CardPinSerializer(serializers.ModelSerializer):
    """Serializer de CardPin com `card_detail` aninhado para uso direto em
    listagens — evita um round-trip extra para buscar os campos do Card."""
    card_detail = serializers.SerializerMethodField(read_only=True)

    class Meta:
        model = CardPin
        fields = ['id', 'card', 'card_detail', 'created_at']
        read_only_fields = ['created_at', 'card_detail']

    def get_card_detail(self, obj):
        # Import tardio para evitar referência circular (CardSerializer está abaixo).
        return CardSerializer(obj.card, context=self.context).data

    def validate_card(self, card):
        """Aceita apenas cards da sprint atual e ainda não concluídos."""
        if card.status in (CardStatus.FINALIZADO, CardStatus.INVIABILIZADO):
            raise serializers.ValidationError(
                'Não é possível fixar um card finalizado ou inviabilizado.'
            )
        if card.projeto_id and getattr(card.projeto, 'arquivado', False):
            raise serializers.ValidationError(
                'Não é possível fixar cards de projetos arquivados.'
            )
        sprint = getattr(card.projeto, 'sprint', None) if card.projeto_id else None
        if sprint is None:
            raise serializers.ValidationError('O card precisa estar vinculado a uma sprint.')
        if sprint.finalizada:
            raise serializers.ValidationError('A sprint do card já foi finalizada.')
        now = timezone.now()
        if sprint.fechamento_em and sprint.fechamento_em < now:
            raise serializers.ValidationError('A sprint do card já encerrou.')
        return card

    def create(self, validated_data):
        user = self.context['request'].user
        # get_or_create torna a operação idempotente.
        pin, _ = CardPin.objects.get_or_create(user=user, card=validated_data['card'])
        return pin


class CardSerializer(DevTimeFormattedMixin, serializers.ModelSerializer):
    projeto_detail = ProjectSerializer(source='projeto', read_only=True)
    responsavel_name = serializers.SerializerMethodField()
    responsavel_role = serializers.SerializerMethodField()
    responsavel_profile_picture_url = serializers.SerializerMethodField()
    criado_por_name = serializers.SerializerMethodField()
    criado_por_profile_picture_url = serializers.SerializerMethodField()

    def get_responsavel_name(self, obj):
        return format_user_name(obj.responsavel)

    def get_responsavel_role(self, obj):
        return getattr(obj.responsavel, 'role', None) if obj.responsavel else None
    
    def get_responsavel_profile_picture_url(self, obj):
        return get_profile_picture_url(obj.responsavel, request=self.context.get('request'))

    def get_criado_por_name(self, obj):
        return format_user_name(obj.criado_por)

    def get_criado_por_profile_picture_url(self, obj):
        return get_profile_picture_url(obj.criado_por, request=self.context.get('request'))
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    prioridade_display = serializers.CharField(source='get_prioridade_display', read_only=True)
    area_display = serializers.CharField(source='get_area_display', read_only=True)
    tipo_display = serializers.CharField(source='get_tipo_display', read_only=True)
    # Anotado no queryset via Count('events') — evita N+1 (uma query por card).
    # Fallback `obj.events.count()` apenas quando o objeto não vier do queryset
    # anotado (ex.: testes ou criação manual em scripts).
    events_count = serializers.SerializerMethodField()

    def get_events_count(self, obj):
        # Quando o queryset usa .annotate(events_count=Count('events')),
        # o atributo já existe no objeto. Verificação explícita pra não
        # confundir 0 (falsy mas válido) com ausência do atributo.
        annotated = getattr(obj, 'events_count', None)
        if annotated is not None:
            return annotated
        return obj.events.count()

    # Permite status que existam em `KanbanStage` (novo sistema), mantendo compatibilidade
    # com os status legados já persistidos.
    status = serializers.CharField(required=False, allow_blank=False)
    
    # Campos explícitos para garantir que sejam sempre processados
    complexidade_selected_items = serializers.JSONField(required=False, allow_null=False, default=list)
    complexidade_selected_development = serializers.CharField(required=False, allow_null=True, max_length=50, default=None)
    complexidade_custom_items = serializers.JSONField(required=False, allow_null=False, default=list)
    
    def validate_complexidade_selected_items(self, value):
        """Garantir que sempre seja uma lista"""
        if value is None:
            return []
        return value

    def validate_status(self, value):
        # Quando o campo não vem no payload, não validamos aqui.
        if value is None:
            return value

        # Aceitar tanto etapas globais cadastradas quanto status legados.
        legacy_statuses = {choice for choice, _ in CardStatus.choices}
        if value in legacy_statuses:
            return value

        if not KanbanStage.objects.filter(key=value).exists():
            raise serializers.ValidationError('Status inválido.')
        return value

    def validate(self, attrs):
        status = attrs.get('status')
        if status is None and self.instance is not None:
            status = self.instance.status
        if status == CardStatus.A_DESENVOLVER:
            attrs['data_inicio'] = None
        return attrs
    
    def validate_complexidade_custom_items(self, value):
        """Garantir que sempre seja uma lista"""
        if value is None:
            return []
        return value
    
    def validate_area(self, value):
        """Garantir que área seja sempre um valor válido"""
        if not value or (isinstance(value, str) and value.strip() == ''):
            # Se estiver vazio, usar o valor padrão do modelo
            return CardArea.BACKEND
        return value
    
    def create(self, validated_data):
        """Garantir valores padrão para campos de complexidade ao criar"""
        # Garantir que os campos sempre tenham valores
        validated_data.setdefault('complexidade_selected_items', [])
        validated_data.setdefault('complexidade_selected_development', None)
        validated_data.setdefault('complexidade_custom_items', [])
        
        # Passar usuário da requisição para o signal via thread-local (ANTES de criar)
        usuario = None
        try:
            from apps.projects import signals
            if self.context.get('request') and hasattr(self.context['request'], 'user'):
                usuario = self.context['request'].user
                signals._thread_locals.user = usuario
        except (ImportError, AttributeError):
            pass
        
        instance = super().create(validated_data)
        
        # Também passar como atributo da instância (fallback)
        if usuario:
            instance._request_user = usuario
        
        # Criar log diretamente aqui como garantia (o signal pode não estar sendo executado)
        try:
            from apps.projects.models import CardLog, CardLogEventType
            
            # Construir descrição completa
            def format_user_name(user):
                if not user:
                    return None
                if user.first_name and user.last_name:
                    return f"{user.first_name} {user.last_name}"
                elif user.first_name:
                    return user.first_name
                elif user.last_name:
                    return user.last_name
                return user.username
            
            prioridade_labels = {
                'baixa': 'Baixa', 'media': 'Média', 'alta': 'Alta', 'absoluta': 'Absoluta',
            }
            area_labels = {
                'rpa': 'RPA',
                'frontend': 'Frontend',
                'backend': 'Backend',
                'script': 'Script',
                'sistema': 'Sistema',
                'automacao': 'Automação',
            }
            tipo_labels = {
                'nova_robotizacao': 'Nova Robotização',
                'nova_automacao': 'Nova Automação',
                'feature': 'Feature',
                'bug': 'Bug',
                'refact_completo': 'Refact Completo',
                'refact_pontual': 'Refact Pontual',
                'otimizacao_processo': 'Otimização de Processo',
                'melhoria_fluxo': 'Melhoria de Fluxo',
                'novo_script': 'Novo Script',
                'ferramenta': 'Ferramenta',
                'qualidade': 'Qualidade',
                'teste_software': 'Teste de Software',
                'raspagem_dados': 'Raspagem de Dados',
                'novo_painel': 'Novo Painel',
                'ia': 'IA',
                'auditoria': 'Auditoria',
                'manutencao': 'Manutenção',
            }
            status_labels = {
                'a_desenvolver': 'A Desenvolver', 'em_desenvolvimento': 'Em Desenvolvimento',
                'parado_pendencias': 'Parado por Pendências', 'em_homologacao': 'Em Homologação',
                'finalizado': 'Concluído', 'inviabilizado': 'Inviabilizado',
            }
            
            descricao_parts = [f'Card "{instance.nome}" criado com os seguintes dados:']
            descricao_parts.append(f'• Nome: {instance.nome}')
            if instance.descricao:
                descricao_parts.append(f'• Descrição: {instance.descricao[:100]}{"..." if len(instance.descricao) > 100 else ""}')
            descricao_parts.append(f'• Status: {status_labels.get(instance.status, instance.status)}')
            descricao_parts.append(f'• Prioridade: {prioridade_labels.get(instance.prioridade, instance.prioridade)}')
            descricao_parts.append(f'• Área: {area_labels.get(instance.area, instance.area)}')
            descricao_parts.append(f'• Tipo: {tipo_labels.get(instance.tipo, instance.tipo)}')
            if instance.responsavel:
                descricao_parts.append(f'• Responsável: {format_user_name(instance.responsavel)}')
            else:
                descricao_parts.append('• Responsável: Não atribuído')
            if instance.data_inicio:
                descricao_parts.append(f'• Data de Início: {instance.data_inicio.strftime("%d/%m/%Y %H:%M")}')
            if instance.data_fim:
                descricao_parts.append(f'• Data de Fim: {instance.data_fim.strftime("%d/%m/%Y %H:%M")}')
            if instance.script_url:
                descricao_parts.append(f'• Script URL: {instance.script_url}')
            
            # Mapeamento de complexidade (ID -> label e horas)
            complexidade_map = {
                'ler_script': {'label': 'Ler script e conferir informações do video', 'hours': 1},
                'solicitar_usuario': {'label': 'Solicitar criação de usuário / vm', 'hours': 1},
                'testes_iniciais': {'label': 'Testes iniciais na maquina', 'hours': 3},
                'configurar_projeto': {'label': 'Configurar projeto na vm', 'hours': 1},
                'desenvolvimento_basico': {'label': 'Desenvolvimento básico', 'hours': 8},
                'desenvolvimento_medio': {'label': 'Desenvolvimento médio', 'hours': 24},
                'desenvolvimento_dificil': {'label': 'Desenvolvimento difícil', 'hours': 40},
            }
            
            # Complexidade do projeto
            has_complexidade = (
                instance.complexidade_selected_items or 
                instance.complexidade_selected_development or 
                instance.complexidade_custom_items
            )
            if has_complexidade:
                descricao_parts.append('• Complexidade do projeto:')
                
                # Itens selecionados
                if instance.complexidade_selected_items:
                    for item_id in instance.complexidade_selected_items:
                        if item_id in complexidade_map:
                            item_info = complexidade_map[item_id]
                            descricao_parts.append(f'  - {item_info["label"]}: {item_info["hours"]}h')
                        else:
                            # Fallback se não estiver no mapeamento
                            label = item_id.replace('_', ' ').title()
                            descricao_parts.append(f'  - {label}')
                
                # Desenvolvimento selecionado (como item de complexidade)
                if instance.complexidade_selected_development:
                    dev_id = instance.complexidade_selected_development
                    if dev_id in complexidade_map:
                        dev_info = complexidade_map[dev_id]
                        descricao_parts.append(f'  - {dev_info["label"]}: {dev_info["hours"]}h')
                    else:
                        # Fallback se não estiver no mapeamento
                        label = dev_id.replace('_', ' ').title()
                        descricao_parts.append(f'  - {label}')
                
                # Itens personalizados
                if instance.complexidade_custom_items:
                    for custom_item in instance.complexidade_custom_items:
                        if isinstance(custom_item, dict):
                            label = custom_item.get('label', 'Item personalizado')
                            hours = custom_item.get('hours', 0)
                            descricao_parts.append(f'  - {label}: {hours}h')
                        else:
                            descricao_parts.append(f'  - {custom_item}')
            
            descricao_completa = '\n'.join(descricao_parts)
            
            # Verificar se já existe um log (para evitar duplicação se o signal também criar)
            if not CardLog.objects.filter(card=instance, tipo_evento=CardLogEventType.CRIADO).exists():
                CardLog.objects.create(
                    card=instance,
                    tipo_evento=CardLogEventType.CRIADO,
                    descricao=descricao_completa,
                    usuario=usuario
                )
        except Exception as e:
            import logging
            logger = logging.getLogger(__name__)
            logger.error(f'Erro ao criar CardLog no serializer para card {instance.id}: {str(e)}', exc_info=True)
        
        # Bloco antigo de auto-criação de CardTodo removido — o sistema de
        # subtarefas por card foi descontinuado em favor de UserNote
        # (notas pessoais estilo Google Keep, geridas pela página /meus-afazeres).
        if False:
            todos_by_area = {
                'backend': [
                    {'id': 'modelagem_banco', 'label': 'Modelagem Do Banco De Dados (Models)'},
                    {'id': 'criacao_interfaces_repositories', 'label': 'Criação De Interfaces E Implementação De Repositories'},
                    {'id': 'criacao_use_cases', 'label': 'Criação De Use Cases'},
                    {'id': 'registro_dependencias', 'label': 'Registro De Dependências Em Containers (Di)'},
                    {'id': 'criacao_serializers', 'label': 'Criação De Serializers'},
                    {'id': 'criacao_views_urls', 'label': 'Criação De Views E Urls'},
                    {'id': 'criacao_permissoes', 'label': 'Criação E Aplicação De Permissões'},
                    {'id': 'testes_unitarios', 'label': 'Testes Unitários E De Cobertura'},
                    {'id': 'testes_manuais', 'label': 'Testes Manuais (Postman / Insomnia)'},
                    {'id': 'atualizacao_documentacao', 'label': 'Atualização Da Documentação Da Api'},
                    {'id': 'criacao_pr_code_review', 'label': 'Criação De Pr E Ajustes De Code Review'},
                    {'id': 'build_deploy_testes', 'label': 'Build E Deploy Em Ambiente De Testes'},
                    {'id': 'build_deploy_producao', 'label': 'Build E Deploy Em Produção'},
                    {'id': 'pull_aplicacao_vm', 'label': 'Pull Da Aplicação Na Vm'},
                ],
                'frontend': [
                    {'id': 'definicao_validacao_contratos', 'label': 'Definição E Validação De Contratos - Interfaces'},
                    {'id': 'construcao_repository_service', 'label': 'Construção Do Repository / Service'},
                    {'id': 'construcao_usecases', 'label': 'Construção Dos Usecases'},
                    {'id': 'garantir_independencia_ui', 'label': 'Garantir Independência Da Ui Em Relação Aos Usecases'},
                    {'id': 'implementacao_testes_unitarios', 'label': 'Implementação De Testes Unitários (Usecases / Services / Repositories)'},
                    {'id': 'ajustes_contratos_regras', 'label': 'Ajustes De Contratos E Regras De Negócio (Se Necessário)'},
                    {'id': 'construcao_componentes_complementares', 'label': 'Construção De Componentes Complementares (Shared / Design System)'},
                    {'id': 'construcao_tela', 'label': 'Construção Da Tela'},
                    {'id': 'tratamento_estados', 'label': 'Tratamento De Estados (Loading, Erro, Empty)'},
                    {'id': 'ajustes_responsividade', 'label': 'Ajustes De Responsividade'},
                    {'id': 'integracao_backend', 'label': 'Integração Com O Backend'},
                    {'id': 'mapeamento_dto_adapter', 'label': 'Mapeamento Dto, Via Adapter'},
                    {'id': 'testar_funcionalidades', 'label': 'Testar Funcionalidades (Fluxos Principais E Edge Cases)'},
                    {'id': 'validacao_visual_ux', 'label': 'Validação Visual E De Ux'},
                    {'id': 'code_review', 'label': 'Code Review'},
                    {'id': 'aplicar_correcoes_code_review', 'label': 'Aplicar Correções Do Code Review'},
                    {'id': 'build_deploy_producao', 'label': 'Build E Deploy Em Produção'},
                    {'id': 'pull_aplicacao_vm', 'label': 'Pull Da Aplicação Na Vm'},
                ],
                'rpa': [
                    {'id': 'ler_script_conferir', 'label': 'Ler Script E Conferir Informações Do Vídeo'},
                    {'id': 'solicitar_usuario_vm', 'label': 'Solicitar Usuário Para Acessar A Vm'},
                    {'id': 'testes_iniciais_local', 'label': 'Testes Iniciais Na Máquina Local'},
                    {'id': 'configurar_projeto_vm', 'label': 'Configurar Projeto Na Vm'},
                    {'id': 'desenvolvimento_basico', 'label': 'Desenvolvimento (Básico)'},
                    {'id': 'desenvolvimento_medio', 'label': 'Desenvolvimento (Médio)'},
                    {'id': 'desenvolvimento_dificil', 'label': 'Desenvolvimento (Dificl)'},
                    {'id': 'testes_homologacao_mapeamento', 'label': 'Testes/Homologação E Mapeamento De Erros'},
                    {'id': 'documentacao', 'label': 'Documentação'},
                    {'id': 'correcoes_code_review', 'label': 'Correções Code Review'},
                ],
                # Automação compartilha o mesmo conjunto de TODOs de RPA por enquanto.
                'automacao': [
                    {'id': 'ler_script_conferir', 'label': 'Ler Script E Conferir Informações Do Vídeo'},
                    {'id': 'solicitar_usuario_vm', 'label': 'Solicitar Usuário Para Acessar A Vm'},
                    {'id': 'testes_iniciais_local', 'label': 'Testes Iniciais Na Máquina Local'},
                    {'id': 'configurar_projeto_vm', 'label': 'Configurar Projeto Na Vm'},
                    {'id': 'desenvolvimento_basico', 'label': 'Desenvolvimento (Básico)'},
                    {'id': 'desenvolvimento_medio', 'label': 'Desenvolvimento (Médio)'},
                    {'id': 'desenvolvimento_dificil', 'label': 'Desenvolvimento (Dificl)'},
                    {'id': 'testes_homologacao_mapeamento', 'label': 'Testes/Homologação E Mapeamento De Erros'},
                    {'id': 'documentacao', 'label': 'Documentação'},
                    {'id': 'correcoes_code_review', 'label': 'Correções Code Review'},
                ],
                'sistema': [
                    {'id': 'ler_script_conferir', 'label': 'Ler Script E Conferir Informações Do Vídeo'},
                    {'id': 'solicitar_usuario_vm', 'label': 'Solicitar Usuário Para Acessar A Vm'},
                    {'id': 'testes_iniciais_local', 'label': 'Testes Iniciais Na Máquina Local'},
                    {'id': 'configurar_projeto_vm', 'label': 'Configurar Projeto Na Vm'},
                    {'id': 'desenvolvimento_basico', 'label': 'Desenvolvimento (Básico)'},
                    {'id': 'desenvolvimento_medio', 'label': 'Desenvolvimento (Médio)'},
                    {'id': 'desenvolvimento_dificil', 'label': 'Desenvolvimento (Dificl)'},
                    {'id': 'testes_homologacao_mapeamento', 'label': 'Testes/Homologação E Mapeamento De Erros'},
                    {'id': 'documentacao', 'label': 'Documentação'},
                    {'id': 'correcoes_code_review', 'label': 'Correções Code Review'},
                ],
                'script': [
                    {'id': 'ler_script_conferir', 'label': 'Ler Script E Conferir Informações Do Vídeo'},
                    {'id': 'solicitar_usuario_vm', 'label': 'Solicitar Usuário Para Acessar A Vm'},
                    {'id': 'testes_iniciais_local', 'label': 'Testes Iniciais Na Máquina Local'},
                    {'id': 'configurar_projeto_vm', 'label': 'Configurar Projeto Na Vm'},
                    {'id': 'desenvolvimento_basico', 'label': 'Desenvolvimento (Básico)'},
                    {'id': 'desenvolvimento_medio', 'label': 'Desenvolvimento (Médio)'},
                    {'id': 'desenvolvimento_dificil', 'label': 'Desenvolvimento (Dificl)'},
                    {'id': 'testes_homologacao_mapeamento', 'label': 'Testes/Homologação E Mapeamento De Erros'},
                    {'id': 'documentacao', 'label': 'Documentação'},
                    {'id': 'correcoes_code_review', 'label': 'Correções Code Review'},
                ],
            }
            
            # Obter lista de TODOs para a área do card
            area = instance.area
            todos_list = todos_by_area.get(area, [])
            
            # IDs de desenvolvimento que devem ser verificados se foram selecionados
            development_ids = ['desenvolvimento_basico', 'desenvolvimento_medio', 'desenvolvimento_dificil']
            
            # Criar TODOs para todos os itens da área
            # Todos os TODOs devem aparecer, exceto os de desenvolvimento que só aparecem se selecionados
            order = 0
            selected_items = instance.complexidade_selected_items or []
            selected_development = instance.complexidade_selected_development
            
            for todo_item in todos_list:
                todo_id = todo_item['id']
                todo_label = todo_item['label']
                
                # Verificar se é um TODO de desenvolvimento
                is_development = todo_id in development_ids
                
                # Se for desenvolvimento, verificar se foi selecionado na complexidade
                # Se não for desenvolvimento, sempre criar
                should_create = True
                if is_development:
                    # Só criar se foi selecionado em complexidade_selected_items ou complexidade_selected_development
                    should_create = todo_id in selected_items or todo_id == selected_development
                
                if should_create:
                    order += 1
        # fim do bloco descontinuado (CardTodo removido)

        return instance
    
    def update(self, instance, validated_data):
        """Atualizar card e passar usuário para o signal"""
        # Passar usuário da requisição para o signal
        if self.context.get('request') and hasattr(self.context['request'], 'user'):
            instance._request_user = self.context['request'].user
        return super().update(instance, validated_data)

    def validate_nome(self, value):
        """
        Nome é apenas exibição; o identificador único do card é o id.
        Nomes duplicados são permitidos.
        """
        return value

    class Meta:
        model = Card
        fields = ['id', 'nome', 'descricao', 'script_url', 'projeto', 'projeto_detail', 
                 'area', 'area_display', 'tipo', 'tipo_display',
                 'responsavel', 'responsavel_name', 'responsavel_role', 'responsavel_profile_picture_url',
                 'criado_por', 'criado_por_name', 'criado_por_profile_picture_url',
                 'status', 'status_display', 'prioridade', 'prioridade_display',
                 'data_inicio', 'data_fim', 'finalizado_em',
                 'segundos_corridos_desenvolvimento', 'dias_corridos_desenvolvimento',
                 'dias_uteis_desenvolvimento',
                 'minutos_uteis_desenvolvimento', 'horas_uteis_desenvolvimento',
                 'complexidade_selected_items', 'complexidade_selected_development', 'complexidade_custom_items',
                 'card_comment', 'links', 'events_count', 'created_at', 'updated_at']
        read_only_fields = [
            'created_at', 'updated_at', 'criado_por', 'finalizado_em',
            'segundos_corridos_desenvolvimento', 'dias_corridos_desenvolvimento',
            'dias_uteis_desenvolvimento',
            'minutos_uteis_desenvolvimento', 'horas_uteis_desenvolvimento',
        ]


class CardKanbanSerializer(DevTimeFormattedMixin, serializers.ModelSerializer):
    """
    Serializer otimizado pra renderizar cards no KANBAN da SprintDetails.

    Diferenças vs CardSerializer:
    - Sem `projeto_detail` aninhado (a página já tem a lista de projects).
      Economiza ~70% do tamanho de cada card e elimina queries de cards.count
      do ProjectSerializer aninhado (chamado 1x por card).
    - Sem campos `criado_por_*` (Kanban não exibe quem criou — evita 2 leituras
      filesystem por card pra checar profile picture).
    - `events_count` lido via annotation (sem N+1).

    Mantém todos os campos visuais do Kanban: nome, descrição, badges (área/
    tipo/prioridade/status display), responsável + foto, datas, complexidade,
    links, comentário.
    """
    area_display = serializers.CharField(source='get_area_display', read_only=True)
    tipo_display = serializers.CharField(source='get_tipo_display', read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    prioridade_display = serializers.CharField(source='get_prioridade_display', read_only=True)
    responsavel_name = serializers.SerializerMethodField()
    responsavel_role = serializers.SerializerMethodField()
    responsavel_profile_picture_url = serializers.SerializerMethodField()
    events_count = serializers.SerializerMethodField()

    def get_responsavel_name(self, obj):
        return format_user_name(obj.responsavel) if obj.responsavel_id else None

    def get_responsavel_role(self, obj):
        return obj.responsavel.role if obj.responsavel_id else None

    def get_responsavel_profile_picture_url(self, obj):
        return get_profile_picture_url(obj.responsavel, request=self.context.get('request'))

    def get_events_count(self, obj):
        annotated = getattr(obj, 'events_count', None)
        if annotated is not None:
            return annotated
        return obj.events.count()

    class Meta:
        model = Card
        fields = [
            'id', 'nome', 'descricao', 'script_url', 'projeto',
            'area', 'area_display', 'tipo', 'tipo_display',
            'responsavel', 'responsavel_name', 'responsavel_role',
            'responsavel_profile_picture_url',
            'status', 'status_display', 'prioridade', 'prioridade_display',
            'data_inicio', 'data_fim', 'finalizado_em',
            'segundos_corridos_desenvolvimento', 'dias_corridos_desenvolvimento',
            'dias_uteis_desenvolvimento',
            'minutos_uteis_desenvolvimento', 'horas_uteis_desenvolvimento',
            'complexidade_selected_items', 'complexidade_selected_development',
            'complexidade_custom_items',
            'card_comment', 'links', 'events_count',
            'created_at', 'updated_at',
        ]
        read_only_fields = fields


class CardMetricsSerializer(DevTimeFormattedMixin, serializers.ModelSerializer):
    """
    Serializer SLIM do Card para a página de Métricas.

    Retorna APENAS os campos usados pelos cálculos de métricas + o mínimo
    necessário para o modal de drill-down (clique em barra → lista de cards).
    Sem nested completos, sem SerializerMethodField, sem display_X. Reduz o
    payload em ~70% vs CardSerializer e elimina o N+1 do events_count.

    Campos denormalizados via select_related('projeto', 'projeto__sprint'):
    - projeto_nome, projeto_is_system, projeto_arquivado
    - sprint (id da sprint do projeto)

    display_X e nomes de área/tipo são derivados no frontend a partir de
    CARD_AREAS/CARD_TYPES (constantes), evitando duplicação no payload.
    """
    projeto_nome = serializers.CharField(source='projeto.nome', read_only=True)
    projeto_is_system = serializers.BooleanField(source='projeto.is_system', read_only=True)
    projeto_arquivado = serializers.BooleanField(source='projeto.arquivado', read_only=True)
    sprint = serializers.PrimaryKeyRelatedField(source='projeto.sprint', read_only=True)

    class Meta:
        model = Card
        fields = [
            'id',
            'nome',
            'status',
            'area',
            'tipo',
            'responsavel',
            'projeto',
            'projeto_nome',
            'projeto_is_system',
            'projeto_arquivado',
            'sprint',
            'data_inicio',
            'data_fim',
            'finalizado_em',
            'segundos_corridos_desenvolvimento',
            'dias_corridos_desenvolvimento',
            'dias_uteis_desenvolvimento',
            'minutos_uteis_desenvolvimento',
            'horas_uteis_desenvolvimento',
            'created_at',
            'updated_at',
        ]
        read_only_fields = fields


class EventSerializer(serializers.ModelSerializer):
    card_detail = CardSerializer(source='card', read_only=True)
    usuario_name = serializers.SerializerMethodField()
    
    def get_usuario_name(self, obj):
        return format_user_name(obj.usuario)
    tipo_display = serializers.CharField(source='get_tipo_display', read_only=True)

    class Meta:
        model = Event
        fields = ['id', 'card', 'card_detail', 'tipo', 'tipo_display', 'descricao', 
                 'motivo', 'usuario', 'usuario_name', 'data']
        read_only_fields = ['data']


class CardLogSerializer(serializers.ModelSerializer):
    card_detail = CardSerializer(source='card', read_only=True)
    usuario_name = serializers.SerializerMethodField()
    usuario_role = serializers.SerializerMethodField()
    usuario_role_display = serializers.SerializerMethodField()
    tipo_evento_display = serializers.CharField(source='get_tipo_evento_display', read_only=True)
    
    def get_usuario_name(self, obj):
        return format_user_name(obj.usuario)
    
    def get_usuario_role(self, obj):
        return obj.usuario.role if obj.usuario else None
    
    def get_usuario_role_display(self, obj):
        return obj.usuario.get_role_display() if obj.usuario else None

    class Meta:
        model = CardLog
        fields = ['id', 'card', 'card_detail', 'tipo_evento', 'tipo_evento_display', 
                 'descricao', 'usuario', 'usuario_name', 'usuario_role', 'usuario_role_display', 'data']
        read_only_fields = ['data']


class NotificationSerializer(serializers.ModelSerializer):
    tipo_display = serializers.CharField(source='get_tipo_display', read_only=True)

    class Meta:
        model = Notification
        fields = ['id', 'tipo', 'tipo_display', 'titulo', 'mensagem', 'lida',
                 'data_criacao', 'card_id', 'sprint_id', 'project_id', 'metadata']
        read_only_fields = ['data_criacao']


class NotificationPreferenceSerializer(serializers.ModelSerializer):
    """Preferências do usuário sobre quais tipos de notificação receber.
    Read/write nos 11 booleans (4 default OFF + 7 default ON)."""

    class Meta:
        model = UserNotificationPreference
        fields = [
            # 7 default ON
            'card_updated', 'card_deleted', 'project_created',
            'card_overdue', 'card_due_24h', 'card_due_1h', 'card_due_10min',
            # 4 default OFF
            'card_created', 'card_moved', 'sprint_created', 'role_changed',
            # read-only
            'updated_at',
        ]
        read_only_fields = ['updated_at']


class WeeklyPriorityConfigSerializer(serializers.ModelSerializer):
    class Meta:
        model = WeeklyPriorityConfig
        fields = ['id', 'horario_limite', 'fechamento_automatico', 'semana_fechada', 'created_at', 'updated_at']
        read_only_fields = ['created_at', 'updated_at']


class WeeklyPrioritySerializer(serializers.ModelSerializer):
    card_detail = CardSerializer(source='card', read_only=True)
    usuario_name = serializers.SerializerMethodField()
    definido_por_name = serializers.SerializerMethodField()
    is_concluido = serializers.BooleanField(read_only=True)
    is_atrasado = serializers.BooleanField(read_only=True)
    
    def get_usuario_name(self, obj):
        return format_user_name(obj.usuario)
    
    def get_definido_por_name(self, obj):
        return format_user_name(obj.definido_por)
    
    class Meta:
        model = WeeklyPriority
        fields = ['id', 'usuario', 'usuario_name', 'card', 'card_detail', 
                 'semana_inicio', 'semana_fim', 'definido_por', 'definido_por_name',
                 'is_concluido', 'is_atrasado', 'created_at', 'updated_at']
        read_only_fields = ['created_at', 'updated_at', 'is_concluido', 'is_atrasado']


class CardDueDateChangeRequestSerializer(serializers.ModelSerializer):
    card_detail = CardSerializer(source='card', read_only=True)
    requested_by_name = serializers.SerializerMethodField()
    reviewed_by_name = serializers.SerializerMethodField()
    status_display = serializers.CharField(source='get_status_display', read_only=True)

    def get_requested_by_name(self, obj):
        return format_user_name(obj.requested_by)

    def get_reviewed_by_name(self, obj):
        return format_user_name(obj.reviewed_by) if obj.reviewed_by else None

    class Meta:
        model = CardDueDateChangeRequest
        fields = [
            'id',
            'card', 'card_detail',
            'requested_by', 'requested_by_name',
            'requested_date',
            'reason',
            'status', 'status_display',
            'reviewed_by', 'reviewed_by_name', 'reviewed_at',
            'created_at', 'updated_at',
        ]
        # requested_by deve ser preenchido pelo backend (perform_create).
        read_only_fields = ['requested_by', 'status', 'reviewed_by', 'reviewed_at', 'created_at', 'updated_at']


class KanbanStageSerializer(serializers.ModelSerializer):
    # `key` é gerada a partir do `label` quando não for enviada pelo frontend.
    key = serializers.CharField(required=False, allow_blank=True)

    class Meta:
        model = KanbanStage
        fields = [
            'id',
            'key',
            'label',
            'is_terminal',
            'requires_required_data',
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']

    def validate(self, attrs):
        label = attrs.get('label')
        key = attrs.get('key')
        if label and (not key or not str(key).strip()):
            # slug simples compatível com status atuais (underscore + lowercase)
            normalized = unicodedata.normalize('NFKD', label)
            without_accents = ''.join(ch for ch in normalized if not unicodedata.combining(ch))
            slug = re.sub(r'[^a-zA-Z0-9]+', '_', without_accents).strip('_').lower()
            attrs['key'] = slug
        return attrs


class ProjectKanbanStageConfigSerializer(serializers.ModelSerializer):
    stage = KanbanStageSerializer(read_only=True)
    stage_key = serializers.CharField(source='stage.key', read_only=True)
    stage_label = serializers.CharField(source='stage.label', read_only=True)

    class Meta:
        model = ProjectKanbanStageConfig
        fields = [
            'id',
            'project',
            'order',
            'stage',
            'stage_key',
            'stage_label',
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['id', 'project', 'created_at', 'updated_at', 'stage']

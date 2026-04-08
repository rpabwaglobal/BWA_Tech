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
    CardTodo,
    Event,
    CardLog,
    Notification,
    WeeklyPriority,
    WeeklyPriorityConfig,
    CardArea,
    CardDueDateChangeRequest,
)
from apps.accounts.serializers import UserSerializer


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
    cards_em_andamento = serializers.IntegerField(read_only=True)
    cards_em_atraso = serializers.IntegerField(read_only=True)

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
                 'cards_total', 'cards_finalizados', 'cards_em_andamento', 'cards_em_atraso',
                 'finalizada', 'created_at', 'updated_at']
        read_only_fields = ['created_at', 'updated_at', 'finalizada', 'data_fim']


class ProjectSerializer(serializers.ModelSerializer):
    sprint_detail = SprintSerializer(source='sprint', read_only=True)
    gerente_name = serializers.SerializerMethodField()
    desenvolvedor_name = serializers.SerializerMethodField()
    
    def get_gerente_name(self, obj):
        return format_user_name(obj.gerente_atribuido)
    
    def get_desenvolvedor_name(self, obj):
        return format_user_name(obj.desenvolvedor)
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
                 'cards_count', 'cards_entregues_count', 'cards_em_desenvolvimento_count',
                 'created_at', 'updated_at']
        read_only_fields = ['created_at', 'updated_at', 'data_criacao']


class CardTodoSerializer(serializers.ModelSerializer):
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    
    class Meta:
        model = CardTodo
        fields = ['id', 'card', 'label', 'is_original', 'status', 'status_display', 
                 'comment', 'order', 'created_at', 'updated_at']
        read_only_fields = ['created_at', 'updated_at']


class CardSerializer(serializers.ModelSerializer):
    projeto_detail = ProjectSerializer(source='projeto', read_only=True)
    responsavel_name = serializers.SerializerMethodField()
    responsavel_profile_picture_url = serializers.SerializerMethodField()
    criado_por_name = serializers.SerializerMethodField()
    criado_por_profile_picture_url = serializers.SerializerMethodField()
    todos = CardTodoSerializer(many=True, read_only=True)
    
    def get_responsavel_name(self, obj):
        return format_user_name(obj.responsavel)
    
    def get_responsavel_profile_picture_url(self, obj):
        if not obj.responsavel or not obj.responsavel.profile_picture:
            return None
        url = obj.responsavel.profile_picture.url
        path = url if url.startswith('/') else '/' + url
        request = self.context.get('request')
        if request:
            return request.build_absolute_uri(path)
        return path
    
    def get_criado_por_name(self, obj):
        return format_user_name(obj.criado_por)
    
    def get_criado_por_profile_picture_url(self, obj):
        if not obj.criado_por or not obj.criado_por.profile_picture:
            return None
        url = obj.criado_por.profile_picture.url
        path = url if url.startswith('/') else '/' + url
        request = self.context.get('request')
        if request:
            return request.build_absolute_uri(path)
        return path
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    prioridade_display = serializers.CharField(source='get_prioridade_display', read_only=True)
    area_display = serializers.CharField(source='get_area_display', read_only=True)
    tipo_display = serializers.CharField(source='get_tipo_display', read_only=True)
    events_count = serializers.IntegerField(source='events.count', read_only=True)

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
        
        # Criar TODOs baseados na área do card
        try:
            from apps.projects.models import CardTodo, CardTodoStatus
            
            # Mapeamento de área para TODOs (baseado no frontend)
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
                    # Verificar se já existe para evitar duplicatas
                    if not CardTodo.objects.filter(card=instance, label=todo_label, is_original=True).exists():
                        CardTodo.objects.create(
                            card=instance,
                            label=todo_label,
                            is_original=True,
                            status=CardTodoStatus.PENDING,
                            order=order,
                        )
                    order += 1
                    
        except Exception as e:
            import logging
            logger = logging.getLogger(__name__)
            logger.error(f'Erro ao criar TODOs para card {instance.id}: {str(e)}', exc_info=True)
        
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
                 'responsavel', 'responsavel_name', 'responsavel_profile_picture_url', 
                 'criado_por', 'criado_por_name', 'criado_por_profile_picture_url',
                 'status', 'status_display', 'prioridade', 'prioridade_display',
                 'data_inicio', 'data_fim',
                 'complexidade_selected_items', 'complexidade_selected_development', 'complexidade_custom_items',
                 'card_comment', 'todos', 'events_count', 'created_at', 'updated_at']
        read_only_fields = ['created_at', 'updated_at', 'criado_por']


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

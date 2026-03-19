# Generated migration to populate CardTodo for existing cards

from django.db import migrations


def populate_card_todos(apps, schema_editor):
    """Criar TODOs retroativos para todos os cards existentes"""
    Card = apps.get_model('projects', 'Card')
    CardTodo = apps.get_model('projects', 'CardTodo')
    # CardTodoStatus é uma classe de escolhas, não um modelo, então usamos o valor direto
    TODO_STATUS_PENDING = 'pending'
    
    # Mapeamento de área para TODOs (mesmo do serializer)
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
    
    # IDs de desenvolvimento que devem ser verificados se foram selecionados
    development_ids = ['desenvolvimento_basico', 'desenvolvimento_medio', 'desenvolvimento_dificil']
    
    # Buscar todos os cards
    cards = Card.objects.all()
    total_cards = cards.count()
    cards_processed = 0
    todos_created = 0
    
    print(f'[Migration] Processando {total_cards} cards...')
    
    for card in cards:
        # Verificar se o card já tem TODOs originais
        existing_todos_count = CardTodo.objects.filter(card=card, is_original=True).count()
        
        if existing_todos_count > 0:
            # Se já tem TODOs, pular
            continue
        
        # Obter lista de TODOs para a área do card
        area = card.area
        todos_list = todos_by_area.get(area, [])
        
        if not todos_list:
            # Se não há TODOs para essa área, pular
            continue
        
        # Obter dados de complexidade do card
        selected_items = card.complexidade_selected_items or []
        selected_development = card.complexidade_selected_development
        
        # Criar TODOs para todos os itens da área
        order = 0
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
                if not CardTodo.objects.filter(card=card, label=todo_label, is_original=True).exists():
                    CardTodo.objects.create(
                        card=card,
                        label=todo_label,
                        is_original=True,
                        status=TODO_STATUS_PENDING,
                        order=order,
                    )
                    todos_created += 1
                order += 1
        
        cards_processed += 1
        if cards_processed % 10 == 0:
            print(f'[Migration] Processados {cards_processed}/{total_cards} cards, {todos_created} TODOs criados...')
    
    print(f'[Migration] Concluído! {cards_processed} cards processados, {todos_created} TODOs criados.')


def reverse_populate_card_todos(apps, schema_editor):
    """Remover TODOs originais criados por esta migração"""
    CardTodo = apps.get_model('projects', 'CardTodo')
    # Remover apenas TODOs originais (os criados automaticamente)
    # Não remover TODOs criados manualmente pelo usuário (is_original=False)
    CardTodo.objects.filter(is_original=True).delete()


class Migration(migrations.Migration):

    dependencies = [
        ('projects', '0019_populate_criado_por'),
    ]

    operations = [
        migrations.RunPython(populate_card_todos, reverse_populate_card_todos),
    ]

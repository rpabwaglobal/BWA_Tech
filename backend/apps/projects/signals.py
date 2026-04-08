from django.db.models.signals import pre_save, post_save, post_delete
from django.dispatch import receiver
from django.contrib.auth import get_user_model
from django.db import transaction
from .models import Card, Sprint, Project, CardLog, CardLogEventType, Notification, NotificationType, CardTodo
from .notification_utils import send_notification, send_notification_to_multiple_users

User = get_user_model()

# Thread-local storage para passar o usuário da requisição para o signal
import threading
_thread_locals = threading.local()


def format_user_name(user):
    """Formata o nome do usuário"""
    if not user:
        return None
    if user.first_name and user.last_name:
        return f"{user.first_name} {user.last_name}"
    elif user.first_name:
        return user.first_name
    elif user.last_name:
        return user.last_name
    return user.username


@receiver(pre_save, sender=Card)
def card_pre_save(sender, instance, **kwargs):
    """Salvar dados anteriores antes de salvar para detectar mudanças"""
    if instance.pk:
        try:
            old_instance = Card.objects.get(pk=instance.pk)
            instance._previous_status = old_instance.status
            instance._previous_data = {
                'nome': old_instance.nome,
                'descricao': old_instance.descricao,
                'status': old_instance.status,
                'prioridade': old_instance.prioridade,
                'area': old_instance.area,
                'tipo': old_instance.tipo,
                'responsavel_id': old_instance.responsavel.id if old_instance.responsavel else None,
                'data_inicio': old_instance.data_inicio,
                'data_fim': old_instance.data_fim,
                'complexidade_selected_items': old_instance.complexidade_selected_items or [],
                'complexidade_selected_development': old_instance.complexidade_selected_development,
                'complexidade_custom_items': old_instance.complexidade_custom_items or [],
                'card_comment': old_instance.card_comment,
            }
        except Card.DoesNotExist:
            instance._previous_status = None
            instance._previous_data = None
    else:
        instance._previous_status = None
        instance._previous_data = None


@receiver(pre_save, sender=User)
def user_pre_save(sender, instance, **kwargs):
    """Salvar role anterior antes de salvar"""
    if instance.pk:
        try:
            old_instance = User.objects.get(pk=instance.pk)
            instance._previous_role = old_instance.role
        except User.DoesNotExist:
            instance._previous_role = None
    else:
        instance._previous_role = None


@receiver(post_save, sender=Card)
def card_created_or_updated(sender, instance, created, **kwargs):
    """Notificar quando um card é criado ou atualizado"""
    import logging
    logger = logging.getLogger(__name__)
    logger.info(f'[CardSignal] Signal executado! Card ID: {instance.id}, Nome: {instance.nome}, Created: {created}')
    
    if created:
        logger.info(f'[CardSignal] Card criado! ID: {instance.id}, Nome: {instance.nome}')
        # Obter usuário da requisição se disponível
        usuario = None
        # Tentar obter de múltiplas fontes
        if hasattr(instance, '_request_user'):
            usuario = instance._request_user
        elif hasattr(_thread_locals, 'user'):
            usuario = _thread_locals.user
        
        # Mapeamento de valores para labels
        prioridade_labels = {
            'baixa': 'Baixa',
            'media': 'Média',
            'alta': 'Alta',
            'absoluta': 'Absoluta',
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
            'a_desenvolver': 'A Desenvolver',
            'em_desenvolvimento': 'Em Desenvolvimento',
            'parado_pendencias': 'Parado por Pendências',
            'em_homologacao': 'Em Homologação',
            'finalizado': 'Concluído',
            'inviabilizado': 'Inviabilizado',
        }
        
        # Construir descrição detalhada
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
        
        # Criar CardLog apenas se ainda não existir (para evitar duplicação se o serializer também criar)
        import logging
        logger = logging.getLogger(__name__)
        logger.info(f'[CardLog] Tentando criar log para card {instance.id} (nome: {instance.nome})')
        print(f'[CardLog DEBUG] Criando log para card {instance.id} - {instance.nome}')
        
        # Verificar se já existe um log (o serializer pode ter criado)
        if CardLog.objects.filter(card=instance, tipo_evento=CardLogEventType.CRIADO).exists():
            logger.info(f'[CardLog] Log já existe para card {instance.id}, pulando criação no signal')
            print(f'[CardLog DEBUG] Log já existe, pulando')
            return
        
        try:
            log = CardLog.objects.create(
                card=instance,
                tipo_evento=CardLogEventType.CRIADO,
                descricao=descricao_completa,
                usuario=usuario
            )
            logger.info(f'[CardLog] Log criado com sucesso! ID: {log.id}, Card: {instance.id}')
            print(f'[CardLog DEBUG] Log criado! ID: {log.id}')
        except Exception as e:
            # Log o erro mas não interrompa o processo
            logger.error(f'[CardLog] Erro ao criar CardLog para card {instance.id}: {str(e)}', exc_info=True)
            print(f'[CardLog DEBUG] Erro: {str(e)}')
            # Tentar criar sem usuário
            try:
                log = CardLog.objects.create(
                    card=instance,
                    tipo_evento=CardLogEventType.CRIADO,
                    descricao=descricao_completa,
                    usuario=None
                )
                logger.info(f'[CardLog] Log criado sem usuário! ID: {log.id}, Card: {instance.id}')
                print(f'[CardLog DEBUG] Log criado sem usuário! ID: {log.id}')
            except Exception as e2:
                logger.error(f'[CardLog] Erro ao criar CardLog sem usuário para card {instance.id}: {str(e2)}', exc_info=True)
                print(f'[CardLog DEBUG] Erro ao criar sem usuário: {str(e2)}')
        
        # Card criado - notificações
        if instance.responsavel:
            send_notification(
                user_id=instance.responsavel.id,
                tipo=NotificationType.CARD_CREATED,
                titulo='Novo Card Atribuído',
                mensagem=f'Um novo card "{instance.nome}" foi criado e atribuído a você.',
                card_id=instance.id,
                project_id=instance.projeto.id,
                metadata={'card_nome': instance.nome, 'project_nome': instance.projeto.nome}
            )
        
        # Notificar gerente do projeto
        if instance.projeto.gerente_atribuido:
            send_notification(
                user_id=instance.projeto.gerente_atribuido.id,
                tipo=NotificationType.CARD_CREATED,
                titulo='Novo Card Criado',
                mensagem=f'Um novo card "{instance.nome}" foi criado no projeto "{instance.projeto.nome}".',
                card_id=instance.id,
                project_id=instance.projeto.id,
                metadata={'card_nome': instance.nome, 'project_nome': instance.projeto.nome}
            )
        
        # Se for uma demanda (card no projeto "Sugestões"), notificar todos os supervisores
        if instance.projeto.nome == 'Sugestões':
            supervisores = User.objects.filter(role__in=['supervisor', 'admin'], is_active=True)
            criador_nome = format_user_name(instance.criado_por) if instance.criado_por else 'Usuário desconhecido'
            for supervisor in supervisores:
                send_notification(
                    user_id=supervisor.id,
                    tipo=NotificationType.CARD_CREATED,
                    titulo='Nova Demanda Criada',
                    mensagem=f'Uma nova demanda "{instance.nome}" foi criada por {criador_nome} e aguarda avaliação.',
                    card_id=instance.id,
                    project_id=instance.projeto.id,
                    metadata={'card_nome': instance.nome, 'criador': criador_nome}
                )
    else:
        # Card atualizado - verificar se o status mudou (card movido)
        old_status = None
        if hasattr(instance, '_previous_status'):
            old_status = instance._previous_status
        
        if old_status and old_status != instance.status:
            # Card foi movido para outra etapa
            status_labels = {
                'a_desenvolver': 'A Desenvolver',
                'em_desenvolvimento': 'Em Desenvolvimento',
                'parado_pendencias': 'Parado por Pendências',
                'em_homologacao': 'Em Homologação',
                'finalizado': 'Concluído',
                'inviabilizado': 'Inviabilizado',
            }
            old_label = status_labels.get(old_status, old_status)
            new_label = status_labels.get(instance.status, instance.status)
            
            user_ids = []
            if instance.responsavel:
                user_ids.append(instance.responsavel.id)
            if instance.projeto.gerente_atribuido:
                user_ids.append(instance.projeto.gerente_atribuido.id)
            
            for user_id in user_ids:
                send_notification(
                    user_id=user_id,
                    tipo=NotificationType.CARD_MOVED,
                    titulo='Card Movido',
                    mensagem=f'O card "{instance.nome}" foi movido de "{old_label}" para "{new_label}".',
                    card_id=instance.id,
                    project_id=instance.projeto.id,
                    metadata={
                        'card_nome': instance.nome,
                        'project_nome': instance.projeto.nome,
                        'old_status': old_status,
                        'new_status': instance.status
                    }
                )
        else:
            # Card atualizado (sem mudança de status) - detectar campos alterados
            changes = []
            if hasattr(instance, '_previous_data') and instance._previous_data:
                old_data = instance._previous_data
                
                # Mapeamento de campos para labels
                field_labels = {
                    'nome': 'Nome',
                    'descricao': 'Descrição',
                    'prioridade': 'Prioridade',
                    'area': 'Área',
                    'tipo': 'Tipo',
                    'responsavel_id': 'Responsável',
                    'data_inicio': 'Data de Início',
                    'data_fim': 'Data de Fim',
                }
                
                # Mapeamento de valores para labels
                prioridade_labels = {
                    'baixa': 'Baixa',
                    'media': 'Média',
                    'alta': 'Alta',
                    'absoluta': 'Absoluta',
                }
                
                area_labels = {
                    'rpa': 'RPA',
                    'frontend': 'Frontend',
                    'backend': 'Backend',
                    'script': 'Script',
                    'sistema': 'Sistema',
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
                
                # Verificar cada campo
                if old_data.get('nome') != instance.nome:
                    changes.append(f'Nome: "{old_data.get("nome")}" → "{instance.nome}"')
                
                if old_data.get('descricao') != instance.descricao:
                    old_desc = old_data.get('descricao') or '(vazio)'
                    new_desc = instance.descricao or '(vazio)'
                    changes.append(f'Descrição: "{old_desc[:50]}..." → "{new_desc[:50]}..."')
                
                if old_data.get('prioridade') != instance.prioridade:
                    old_prior = prioridade_labels.get(old_data.get('prioridade'), old_data.get('prioridade'))
                    new_prior = prioridade_labels.get(instance.prioridade, instance.prioridade)
                    changes.append(f'Prioridade: {old_prior} → {new_prior}')
                
                if old_data.get('area') != instance.area:
                    old_area = area_labels.get(old_data.get('area'), old_data.get('area'))
                    new_area = area_labels.get(instance.area, instance.area)
                    changes.append(f'Área: {old_area} → {new_area}')
                
                if old_data.get('tipo') != instance.tipo:
                    old_tipo = tipo_labels.get(old_data.get('tipo'), old_data.get('tipo'))
                    new_tipo = tipo_labels.get(instance.tipo, instance.tipo)
                    changes.append(f'Tipo: {old_tipo} → {new_tipo}')
                
                if old_data.get('responsavel_id') != (instance.responsavel.id if instance.responsavel else None):
                    old_resp = None
                    if old_data.get('responsavel_id'):
                        try:
                            old_user = User.objects.get(id=old_data.get('responsavel_id'))
                            old_resp = format_user_name(old_user)
                        except User.DoesNotExist:
                            old_resp = 'N/A'
                    else:
                        old_resp = 'Ninguém'
                    
                    new_resp = format_user_name(instance.responsavel) if instance.responsavel else 'Ninguém'
                    changes.append(f'Responsável: {old_resp} → {new_resp}')
                
                if old_data.get('data_inicio') != instance.data_inicio:
                    old_date = old_data.get('data_inicio').strftime('%d/%m/%Y %H:%M') if old_data.get('data_inicio') else 'Não definida'
                    new_date = instance.data_inicio.strftime('%d/%m/%Y %H:%M') if instance.data_inicio else 'Não definida'
                    changes.append(f'Data de Início: {old_date} → {new_date}')
                
                if old_data.get('data_fim') != instance.data_fim:
                    old_date = old_data.get('data_fim').strftime('%d/%m/%Y') if old_data.get('data_fim') else 'Não definida'
                    new_date = instance.data_fim.strftime('%d/%m/%Y') if instance.data_fim else 'Não definida'
                    changes.append(f'Data de Fim: {old_date} → {new_date}')
                
                # Verificar se card_comment mudou (tratando None e string vazia como equivalentes)
                old_card_comment = str(old_data.get('card_comment')) if old_data.get('card_comment') else ''
                new_card_comment = str(instance.card_comment) if instance.card_comment else ''
                card_comment_changed = old_card_comment.strip() != new_card_comment.strip()
                
                import logging
                logger = logging.getLogger(__name__)
                logger.info(f'[Card Signal] Card {instance.id} - card_comment mudou: {card_comment_changed}')
                logger.info(f'[Card Signal] Comentário antigo: "{old_card_comment}", Comentário novo: "{new_card_comment}"')
                
                if card_comment_changed:
                    # Notificar supervisores e gerentes sobre mudança no comentário do card
                    supervisors_and_managers = User.objects.filter(
                        role__in=['supervisor', 'gerente', 'admin'],
                        is_active=True
                    )
                    
                    user_ids = [user.id for user in supervisors_and_managers]
                    
                    # Também notificar o responsável do card e o gerente do projeto
                    if instance.responsavel:
                        if instance.responsavel.id not in user_ids:
                            user_ids.append(instance.responsavel.id)
                    
                    if instance.projeto and instance.projeto.gerente_atribuido:
                        if instance.projeto.gerente_atribuido.id not in user_ids:
                            user_ids.append(instance.projeto.gerente_atribuido.id)
                    
                    if user_ids:
                        send_notification_to_multiple_users(
                            user_ids=user_ids,
                            tipo=NotificationType.CARD_UPDATED,
                            titulo='Comentário do Card Atualizado',
                            mensagem=f'O comentário do card "{instance.nome}" foi atualizado.',
                            card_id=instance.id,
                            project_id=instance.projeto.id if instance.projeto else None,
                            metadata={
                                'card_nome': instance.nome,
                                'comment_changed': True
                            }
                        )
                
                # Mapeamento de complexidade (ID -> label e horas) - mesmo usado no log de criação
                complexidade_map = {
                    'ler_script': {'label': 'Ler script e conferir informações do video', 'hours': 1},
                    'solicitar_usuario': {'label': 'Solicitar criação de usuário / vm', 'hours': 1},
                    'testes_iniciais': {'label': 'Testes iniciais na maquina', 'hours': 3},
                    'configurar_projeto': {'label': 'Configurar projeto na vm', 'hours': 1},
                    'desenvolvimento_basico': {'label': 'Desenvolvimento básico', 'hours': 8},
                    'desenvolvimento_medio': {'label': 'Desenvolvimento médio', 'hours': 24},
                    'desenvolvimento_dificil': {'label': 'Desenvolvimento difícil', 'hours': 40},
                }
                
                # Função auxiliar para formatar lista de complexidade
                def format_complexidade_items(items, dev_item=None):
                    """Formata itens de complexidade no formato do log de criação"""
                    if not items and not dev_item:
                        return 'Nenhum'
                    
                    formatted = []
                    # Adicionar itens selecionados
                    if items:
                        for item_id in items:
                            if item_id in complexidade_map:
                                item_info = complexidade_map[item_id]
                                formatted.append(f'{item_info["label"]}: {item_info["hours"]}h')
                            else:
                                label = item_id.replace('_', ' ').title()
                                formatted.append(label)
                    
                    # Adicionar desenvolvimento selecionado (se não estiver já na lista de items)
                    if dev_item and dev_item not in items:
                        if dev_item in complexidade_map:
                            dev_info = complexidade_map[dev_item]
                            formatted.append(f'{dev_info["label"]}: {dev_info["hours"]}h')
                        else:
                            label = dev_item.replace('_', ' ').title()
                            formatted.append(label)
                    
                    return ', '.join(formatted) if formatted else 'Nenhum'
                
                # Verificar mudanças nos campos de complexidade
                old_selected_items = old_data.get('complexidade_selected_items') or []
                new_selected_items = instance.complexidade_selected_items or []
                old_selected_dev = old_data.get('complexidade_selected_development')
                new_selected_dev = instance.complexidade_selected_development
                old_custom_items = old_data.get('complexidade_custom_items') or []
                new_custom_items = instance.complexidade_custom_items or []
                
                # Verificar se houve mudança em qualquer campo de complexidade
                has_complexidade_change = (
                    old_selected_items != new_selected_items or
                    old_selected_dev != new_selected_dev or
                    old_custom_items != new_custom_items
                )
                
                if has_complexidade_change:
                    # Formatar complexidade antiga e nova no formato do log de criação
                    old_complexidade = []
                    new_complexidade = []
                    
                    # Itens selecionados antigos
                    if old_selected_items:
                        for item_id in old_selected_items:
                            if item_id in complexidade_map:
                                item_info = complexidade_map[item_id]
                                old_complexidade.append(f'{item_info["label"]}: {item_info["hours"]}h')
                            else:
                                label = item_id.replace('_', ' ').title()
                                old_complexidade.append(label)
                    
                    # Desenvolvimento antigo (se não estiver já na lista)
                    if old_selected_dev and old_selected_dev not in old_selected_items:
                        if old_selected_dev in complexidade_map:
                            dev_info = complexidade_map[old_selected_dev]
                            old_complexidade.append(f'{dev_info["label"]}: {dev_info["hours"]}h')
                        else:
                            label = old_selected_dev.replace('_', ' ').title()
                            old_complexidade.append(label)
                    
                    # Itens personalizados antigos
                    if old_custom_items:
                        for custom_item in old_custom_items:
                            if isinstance(custom_item, dict):
                                label = custom_item.get('label', 'Item personalizado')
                                hours = custom_item.get('hours', 0)
                                old_complexidade.append(f'{label}: {hours}h')
                            else:
                                old_complexidade.append(str(custom_item))
                    
                    # Itens selecionados novos
                    if new_selected_items:
                        for item_id in new_selected_items:
                            if item_id in complexidade_map:
                                item_info = complexidade_map[item_id]
                                new_complexidade.append(f'{item_info["label"]}: {item_info["hours"]}h')
                            else:
                                label = item_id.replace('_', ' ').title()
                                new_complexidade.append(label)
                    
                    # Desenvolvimento novo (se não estiver já na lista)
                    if new_selected_dev and new_selected_dev not in new_selected_items:
                        if new_selected_dev in complexidade_map:
                            dev_info = complexidade_map[new_selected_dev]
                            new_complexidade.append(f'{dev_info["label"]}: {dev_info["hours"]}h')
                        else:
                            label = new_selected_dev.replace('_', ' ').title()
                            new_complexidade.append(label)
                    
                    # Itens personalizados novos
                    if new_custom_items:
                        for custom_item in new_custom_items:
                            if isinstance(custom_item, dict):
                                label = custom_item.get('label', 'Item personalizado')
                                hours = custom_item.get('hours', 0)
                                new_complexidade.append(f'{label}: {hours}h')
                            else:
                                new_complexidade.append(str(custom_item))
                    
                    # Criar mensagem formatada como no log de criação (mostrando apenas o estado atual)
                    complexidade_change = ['Complexidade do projeto:']
                    if new_complexidade:
                        for item in new_complexidade:
                            complexidade_change.append(f'  - {item}')
                    else:
                        complexidade_change.append('  - Nenhum')
                    
                    changes.append('\n'.join(complexidade_change))
            
            # Criar mensagem com as mudanças
            if changes:
                mensagem = f'O card "{instance.nome}" foi atualizado:\n' + '\n'.join(f'• {change}' for change in changes)
            else:
                mensagem = f'O card "{instance.nome}" foi atualizado.'
            
            # Criar CardLog se houver mudanças
            if changes:
                # Obter usuário da requisição se disponível
                usuario = None
                if hasattr(instance, '_request_user'):
                    usuario = instance._request_user
                elif hasattr(instance, '_updated_by'):
                    usuario = instance._updated_by
                
                CardLog.objects.create(
                    card=instance,
                    tipo_evento=CardLogEventType.ALTERACAO,
                    descricao=mensagem,
                    usuario=usuario
                )
            
            # Notificar responsável
            if instance.responsavel:
                send_notification(
                    user_id=instance.responsavel.id,
                    tipo=NotificationType.CARD_UPDATED,
                    titulo='Card Atualizado',
                    mensagem=mensagem,
                    card_id=instance.id,
                    project_id=instance.projeto.id,
                    metadata={
                        'card_nome': instance.nome,
                        'project_nome': instance.projeto.nome,
                        'changes': changes
                    }
                )
            
            # Notificar gerente do projeto
            if instance.projeto.gerente_atribuido:
                send_notification(
                    user_id=instance.projeto.gerente_atribuido.id,
                    tipo=NotificationType.CARD_UPDATED,
                    titulo='Card Atualizado',
                    mensagem=mensagem,
                    card_id=instance.id,
                    project_id=instance.projeto.id,
                    metadata={
                        'card_nome': instance.nome,
                        'project_nome': instance.projeto.nome,
                        'changes': changes
                    }
                )
            
            # Se for uma demanda (card no projeto "Sugestões"), notificar todos os supervisores
            if instance.projeto.nome == 'Sugestões':
                from django.contrib.auth import get_user_model
                supervisores = User.objects.filter(role__in=['supervisor', 'admin'], is_active=True)
                criador_nome = format_user_name(instance.criado_por) if instance.criado_por else 'Usuário desconhecido'
                for supervisor in supervisores:
                    send_notification(
                        user_id=supervisor.id,
                        tipo=NotificationType.CARD_UPDATED,
                        titulo='Demanda Atualizada',
                        mensagem=f'A demanda "{instance.nome}" criada por {criador_nome} foi atualizada.',
                        card_id=instance.id,
                        project_id=instance.projeto.id,
                        metadata={'card_nome': instance.nome, 'criador': criador_nome, 'changes': changes}
                    )


@receiver(post_delete, sender=Card)
def card_deleted(sender, instance, **kwargs):
    """Notificar quando um card é deletado"""
    user_ids = []
    
    if instance.responsavel:
        user_ids.append(instance.responsavel.id)
    
    if instance.projeto.gerente_atribuido:
        user_ids.append(instance.projeto.gerente_atribuido.id)
    
    if user_ids:
        send_notification_to_multiple_users(
            user_ids=user_ids,
            tipo=NotificationType.CARD_DELETED,
            titulo='Card Deletado',
            mensagem=f'O card "{instance.nome}" foi deletado.',
            project_id=instance.projeto.id,
            metadata={'card_nome': instance.nome, 'project_nome': instance.projeto.nome}
        )


@receiver(post_save, sender=Sprint)
def sprint_created(sender, instance, created, **kwargs):
    """Notificar quando uma sprint é criada"""
    if created:
        try:
            users = User.objects.filter(is_active=True)
            user_ids = [user.id for user in users]
            if user_ids:
                send_notification_to_multiple_users(
                    user_ids=user_ids,
                    tipo=NotificationType.SPRINT_CREATED,
                    titulo='Nova Sprint Criada',
                    mensagem=f'A sprint "{instance.nome}" foi criada.',
                    sprint_id=int(instance.id) if instance.id is not None else None,
                    metadata={'sprint_nome': instance.nome}
                )
        except Exception as e:
            import logging
            logging.getLogger(__name__).exception('Erro ao enviar notificação de sprint criada: %s', e)


@receiver(post_save, sender=Project)
def project_created(sender, instance, created, **kwargs):
    """Notificar quando um projeto é criado"""
    if created:
        # Notificar gerente atribuído
        if instance.gerente_atribuido:
            send_notification(
                user_id=instance.gerente_atribuido.id,
                tipo=NotificationType.PROJECT_CREATED,
                titulo='Novo Projeto Atribuído',
                mensagem=f'Um novo projeto "{instance.nome}" foi criado e atribuído a você.',
                project_id=instance.id,
                sprint_id=instance.sprint.id,
                metadata={'project_nome': instance.nome, 'sprint_nome': instance.sprint.nome}
            )


@receiver(post_save, sender=User)
def user_role_changed(sender, instance, created, **kwargs):
    """Notificar quando o cargo de um usuário é alterado"""
    if not created:
        # Verificar se o role mudou
        if hasattr(instance, '_previous_role'):
            if instance._previous_role != instance.role:
                send_notification(
                    user_id=instance.id,
                    tipo=NotificationType.ROLE_CHANGED,
                    titulo='Cargo Alterado',
                    mensagem=f'Seu cargo foi alterado para {instance.get_role_display()}.',
                    metadata={'old_role': instance._previous_role, 'new_role': instance.role}
                )


# Signal de CardLog removido - logs não geram mais notificações
# As notificações de atualização de card já mostram os dados alterados


@receiver(pre_save, sender=CardTodo)
def card_todo_pre_save(sender, instance, **kwargs):
    """Salvar dados anteriores antes de salvar para detectar mudanças"""
    if instance.pk:
        try:
            old_instance = CardTodo.objects.get(pk=instance.pk)
            instance._previous_status = old_instance.status
            instance._previous_comment = old_instance.comment
            import logging
            logger = logging.getLogger(__name__)
            logger.info(f'[CardTodo Pre-Save] TODO {instance.pk} - Status anterior: {old_instance.status}, Novo status: {instance.status}')
        except CardTodo.DoesNotExist:
            instance._previous_status = None
            instance._previous_comment = None
    else:
        instance._previous_status = None
        instance._previous_comment = None


@receiver(post_delete, sender=CardTodo)
def card_todo_deleted(sender, instance, **kwargs):
    """Notificar quando um TODO é deletado"""
    import logging
    logger = logging.getLogger(__name__)
    
    # Salvar informações do TODO antes de ser deletado
    todo_label = instance.label
    todo_id = instance.id
    
    # Tentar obter o card_id antes que o objeto seja completamente removido
    # O Django mantém o card_id disponível mesmo após a deleção
    try:
        card_id = instance.card_id
    except AttributeError:
        # Se não tiver card_id diretamente, tentar acessar via relacionamento
        try:
            card_id = instance.card.id
        except:
            logger.warning(f'[CardTodo Signal] Não foi possível obter card_id do TODO deletado {instance.id}')
            return
    
    # Buscar o card com relacionamentos
    try:
        card = Card.objects.select_related('projeto', 'responsavel', 'projeto__gerente_atribuido').get(id=card_id)
    except Card.DoesNotExist:
        logger.warning(f'[CardTodo Signal] Card {card_id} não encontrado para TODO deletado {instance.id}')
        return
    except Exception as e:
        logger.error(f'[CardTodo Signal] Erro ao buscar card para TODO deletado {instance.id}: {e}')
        return
    
    # Buscar supervisores e gerentes
    supervisors_and_managers = User.objects.filter(
        role__in=['supervisor', 'gerente', 'admin'],
        is_active=True
    )
    
    user_ids = [user.id for user in supervisors_and_managers]
    
    # Também notificar o responsável do card e o gerente do projeto
    if card.responsavel:
        if card.responsavel.id not in user_ids:
            user_ids.append(card.responsavel.id)
    
    if card.projeto and card.projeto.gerente_atribuido:
        if card.projeto.gerente_atribuido.id not in user_ids:
            user_ids.append(card.projeto.gerente_atribuido.id)
    
    if user_ids:
        logger.info(f'[CardTodo Signal] TODO {todo_id} deletado. Notificando {len(user_ids)} usuários. Card ID: {card.id}')
        
        send_notification_to_multiple_users(
            user_ids=user_ids,
            tipo=NotificationType.CARD_TODO_UPDATED,
            titulo='TODO Removido',
            mensagem=f'O TODO "{todo_label}" foi removido do card "{card.nome}".',
            card_id=int(card.id) if hasattr(card.id, '__int__') else card.id,
            project_id=int(card.projeto.id) if card.projeto and hasattr(card.projeto.id, '__int__') else (card.projeto.id if card.projeto else None),
            metadata={
                'card_nome': card.nome,
                'todo_label': todo_label,
                'todo_id': todo_id,
                'is_deleted': True
            }
        )


@receiver(post_save, sender=CardTodo)
def card_todo_updated(sender, instance, created, **kwargs):
    """Notificar quando um TODO é criado ou atualizado"""
    import logging
    logger = logging.getLogger(__name__)
    
    # Recarregar o card com relacionamentos para evitar problemas
    try:
        card = Card.objects.select_related('projeto', 'responsavel', 'projeto__gerente_atribuido').get(id=instance.card.id)
    except Card.DoesNotExist:
        return
    
    # Buscar supervisores e gerentes
    supervisors_and_managers = User.objects.filter(
        role__in=['supervisor', 'gerente', 'admin'],
        is_active=True
    )
    
    user_ids = [user.id for user in supervisors_and_managers]
    
    # Também notificar o responsável do card e o gerente do projeto
    if card.responsavel:
        if card.responsavel.id not in user_ids:
            user_ids.append(card.responsavel.id)
    
    if card.projeto and card.projeto.gerente_atribuido:
        if card.projeto.gerente_atribuido.id not in user_ids:
            user_ids.append(card.projeto.gerente_atribuido.id)
    
    if not user_ids:
        return
    
    if created:
        # TODO foi criado - notificar
        logger.info(f'[CardTodo Signal] TODO {instance.id} criado. Notificando {len(user_ids)} usuários. Card ID: {card.id}')
        
        send_notification_to_multiple_users(
            user_ids=user_ids,
            tipo=NotificationType.CARD_TODO_UPDATED,
            titulo='Novo TODO Adicionado',
            mensagem=f'Um novo TODO "{instance.label}" foi adicionado ao card "{card.nome}".',
            card_id=int(card.id) if hasattr(card.id, '__int__') else card.id,
            project_id=int(card.projeto.id) if card.projeto and hasattr(card.projeto.id, '__int__') else (card.projeto.id if card.projeto else None),
            metadata={
                'card_nome': card.nome,
                'todo_label': instance.label,
                'todo_id': instance.id,
                'is_new': True
            }
        )
    else:
        # Verificar se o status ou comentário mudou
        old_status = getattr(instance, '_previous_status', None)
        old_comment = getattr(instance, '_previous_comment', None)
        logger.info(f'[CardTodo Post-Save] TODO {instance.id} - Created: {created}, Old status: {old_status}, New status: {instance.status}')
        
        status_changed = old_status and old_status != instance.status
        # Verificar mudança no comentário (tratando None e string vazia como equivalentes)
        old_comment_str = str(old_comment) if old_comment else ''
        new_comment_str = str(instance.comment) if instance.comment else ''
        comment_changed = old_comment_str.strip() != new_comment_str.strip()
        
        logger.info(f'[CardTodo Signal] TODO {instance.id} - Status mudou: {status_changed}, Comentário mudou: {comment_changed}')
        logger.info(f'[CardTodo Signal] Comentário antigo: "{old_comment_str}", Comentário novo: "{new_comment_str}"')
        
        if status_changed or comment_changed:
            # Construir mensagem baseada no que mudou
            status_labels = {
                'pending': 'Pendente',
                'completed': 'Concluído',
                'blocked': 'Bloqueado',
                'warning': 'Aviso',
            }
            
            if status_changed and comment_changed:
                old_label = status_labels.get(old_status, old_status)
                new_label = status_labels.get(instance.status, instance.status)
                mensagem = f'O TODO "{instance.label}" do card "{card.nome}" foi alterado de "{old_label}" para "{new_label}" e o comentário foi atualizado.'
            elif status_changed:
                old_label = status_labels.get(old_status, old_status)
                new_label = status_labels.get(instance.status, instance.status)
                mensagem = f'O TODO "{instance.label}" do card "{card.nome}" foi alterado de "{old_label}" para "{new_label}".'
            else:  # comment_changed
                mensagem = f'O comentário do TODO "{instance.label}" do card "{card.nome}" foi atualizado.'
            
            logger.info(f'[CardTodo Signal] TODO {instance.id} atualizado. Status mudou: {status_changed}, Comentário mudou: {comment_changed}. Notificando {len(user_ids)} usuários. Card ID: {card.id}')
            
            send_notification_to_multiple_users(
                user_ids=user_ids,
                tipo=NotificationType.CARD_TODO_UPDATED,
                titulo='TODO Atualizado',
                mensagem=mensagem,
                card_id=int(card.id) if hasattr(card.id, '__int__') else card.id,
                project_id=int(card.projeto.id) if card.projeto and hasattr(card.projeto.id, '__int__') else (card.projeto.id if card.projeto else None),
                metadata={
                    'card_nome': card.nome,
                    'todo_label': instance.label,
                    'old_status': old_status if status_changed else None,
                    'new_status': instance.status if status_changed else None,
                    'comment_changed': comment_changed,
                    'todo_id': instance.id
                }
            )

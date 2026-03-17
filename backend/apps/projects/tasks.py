import logging
from celery import shared_task
from datetime import datetime, timedelta, time
from django.utils import timezone
from django.db.models import Q
from .models import Card, Notification, NotificationType, Sprint, WeeklyPriorityConfig
from .notification_utils import send_notification
from .services import finalizar_sprint_replicacao

logger = logging.getLogger(__name__)


@shared_task
def check_card_deadlines():
    """
    Verifica cards com data_fim próxima e cria notificações de alerta.
    Roda a cada minuto.
    """
    now = timezone.now()
    
    # Buscar cards com data_fim definida e que não estão finalizados/inviabilizados
    cards = Card.objects.filter(
        data_fim__isnull=False,
    ).exclude(
        status__in=['finalizado', 'inviabilizado']
    ).select_related('responsavel', 'projeto', 'projeto__gerente_atribuido')
    
    for card in cards:
        if not card.data_fim:
            continue
        
        time_remaining = card.data_fim - now
        
        # Verificar se já existe notificação do mesmo tipo criada recentemente (últimas 2 horas)
        recent_threshold = now - timedelta(hours=2)
        
        # Card atrasado
        if card.data_fim < now:
            # Verificar se já existe notificação de atraso recente
            existing = Notification.objects.filter(
                card_id=card.id,
                tipo=NotificationType.CARD_OVERDUE,
                data_criacao__gte=recent_threshold
            ).exists()
            
            if not existing:
                user_ids = []
                if card.responsavel:
                    user_ids.append(card.responsavel.id)
                if card.projeto.gerente_atribuido:
                    user_ids.append(card.projeto.gerente_atribuido.id)
                
                for user_id in user_ids:
                    send_notification(
                        user_id=user_id,
                        tipo=NotificationType.CARD_OVERDUE,
                        titulo='Card Atrasado',
                        mensagem=f'O card "{card.nome}" está atrasado. Data de entrega: {card.data_fim.strftime("%d/%m/%Y %H:%M")}',
                        card_id=card.id,
                        project_id=card.projeto.id,
                        metadata={
                            'card_nome': card.nome,
                            'project_nome': card.projeto.nome,
                            'data_fim': card.data_fim.isoformat()
                        }
                    )
        
        # Faltam 24 horas
        elif timedelta(hours=23, minutes=50) <= time_remaining <= timedelta(hours=24, minutes=10):
            existing = Notification.objects.filter(
                card_id=card.id,
                tipo=NotificationType.CARD_DUE_24H,
                data_criacao__gte=recent_threshold
            ).exists()
            
            if not existing:
                user_ids = []
                if card.responsavel:
                    user_ids.append(card.responsavel.id)
                if card.projeto.gerente_atribuido:
                    user_ids.append(card.projeto.gerente_atribuido.id)
                
                for user_id in user_ids:
                    send_notification(
                        user_id=user_id,
                        tipo=NotificationType.CARD_DUE_24H,
                        titulo='Card Vence em 24 Horas',
                        mensagem=f'O card "{card.nome}" vence em 24 horas. Data de entrega: {card.data_fim.strftime("%d/%m/%Y %H:%M")}',
                        card_id=card.id,
                        project_id=card.projeto.id,
                        metadata={
                            'card_nome': card.nome,
                            'project_nome': card.projeto.nome,
                            'data_fim': card.data_fim.isoformat()
                        }
                    )
        
        # Faltam 1 hora
        elif timedelta(minutes=50) <= time_remaining <= timedelta(hours=1, minutes=10):
            existing = Notification.objects.filter(
                card_id=card.id,
                tipo=NotificationType.CARD_DUE_1H,
                data_criacao__gte=recent_threshold
            ).exists()
            
            if not existing:
                user_ids = []
                if card.responsavel:
                    user_ids.append(card.responsavel.id)
                if card.projeto.gerente_atribuido:
                    user_ids.append(card.projeto.gerente_atribuido.id)
                
                for user_id in user_ids:
                    send_notification(
                        user_id=user_id,
                        tipo=NotificationType.CARD_DUE_1H,
                        titulo='Card Vence em 1 Hora',
                        mensagem=f'O card "{card.nome}" vence em 1 hora. Data de entrega: {card.data_fim.strftime("%d/%m/%Y %H:%M")}',
                        card_id=card.id,
                        project_id=card.projeto.id,
                        metadata={
                            'card_nome': card.nome,
                            'project_nome': card.projeto.nome,
                            'data_fim': card.data_fim.isoformat()
                        }
                    )
        
        # Faltam 10 minutos
        elif timedelta(minutes=5) <= time_remaining <= timedelta(minutes=15):
            existing = Notification.objects.filter(
                card_id=card.id,
                tipo=NotificationType.CARD_DUE_10MIN,
                data_criacao__gte=recent_threshold
            ).exists()
            
            if not existing:
                user_ids = []
                if card.responsavel:
                    user_ids.append(card.responsavel.id)
                if card.projeto.gerente_atribuido:
                    user_ids.append(card.projeto.gerente_atribuido.id)
                
                for user_id in user_ids:
                    send_notification(
                        user_id=user_id,
                        tipo=NotificationType.CARD_DUE_10MIN,
                        titulo='Card Vence em 10 Minutos',
                        mensagem=f'O card "{card.nome}" vence em 10 minutos. Data de entrega: {card.data_fim.strftime("%d/%m/%Y %H:%M")}',
                        card_id=card.id,
                        project_id=card.projeto.id,
                        metadata={
                            'card_nome': card.nome,
                            'project_nome': card.projeto.nome,
                            'data_fim': card.data_fim.isoformat()
                        }
                    )
    
    return f'Verificados {cards.count()} cards'


@shared_task
def verificar_fechamento_automatico_semana():
    """
    Verifica se chegou no horário limite de sexta-feira e fecha a semana automaticamente.
    Roda a cada minuto.
    """
    agora = timezone.now()
    
    # Verificar se é sexta-feira
    if agora.weekday() != 4:  # 4 = sexta-feira
        return 'Não é sexta-feira'
    
    # Obter configuração
    config = WeeklyPriorityConfig.get_config()
    
    # Verificar se o fechamento automático está habilitado
    if not config.fechamento_automatico:
        return 'Fechamento automático desabilitado'
    
    # Calcular início da semana (segunda-feira)
    dias_ate_segunda = agora.weekday()  # 0 = segunda, 4 = sexta
    semana_inicio = agora.date() - timedelta(days=dias_ate_segunda)
    
    # Verificar se a semana já está fechada
    if config.is_semana_fechada(semana_inicio):
        return 'Semana já está fechada'
    
    # Verificar se chegou no horário limite
    horario_atual = agora.time()
    horario_limite = config.horario_limite
    
    # Comparar horários
    if horario_atual >= horario_limite:
        # Fechar a semana
        config.fechar_semana(semana_inicio)
        return f'Semana fechada automaticamente às {horario_atual.strftime("%H:%M:%S")}'
    
    return f'Aguardando horário limite ({horario_limite.strftime("%H:%M:%S")}). Horário atual: {horario_atual.strftime("%H:%M:%S")}'


@shared_task
def finalizar_sprints_por_data():
    """
    Finaliza sprints automaticamente apenas quando a data_fim JÁ PASSOU
    E o horário limite do dia também foi alcançado.

    - Usa o campo global WeeklyPriorityConfig.horario_limite como horário de corte.
    - Antes disso, mesmo após meia-noite, a sprint continua aberta.
    - A sprint também pode ser finalizada manualmente via botão na página da sprint.
    """
    from apps.projects.models import WeeklyPriorityConfig
    from datetime import datetime

    agora = timezone.localtime()  # datetime com timezone
    hoje = agora.date()

    # Horário limite configurado globalmente
    config = WeeklyPriorityConfig.get_config()
    horario_limite = config.horario_limite  # time

    # Considerar sprints cuja data_fim é ANTES de hoje,
    # OU data_fim é hoje mas o horário limite já passou
    sprints = Sprint.objects.filter(finalizada=False).order_by('data_fim')

    processadas = 0
    sem_destino = 0

    for sprint in sprints:
        data_fim = sprint.data_fim

        # Montar datetime limite da sprint (data_fim + horario_limite)
        limite_dt = timezone.make_aware(
            datetime.combine(data_fim, horario_limite),
            timezone.get_current_timezone(),
        )

        # Só finalizar automaticamente se já passou do limite
        if agora < limite_dt:
            continue

        result = finalizar_sprint_replicacao(sprint, criado_por_user=None)
        if result is None:
            sprint.finalizada = True
            sprint.save(update_fields=['finalizada', 'updated_at'])
            logger.warning(
                'Sprint %s (%s) finalizada por data mas nenhuma sprint de destino encontrada.',
                sprint.nome, sprint.id
            )
            sem_destino += 1
        else:
            processadas += 1

    return f'Sprints finalizadas por data: {processadas} replicadas, {sem_destino} sem destino.'

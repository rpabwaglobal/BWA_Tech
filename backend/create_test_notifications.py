"""
Script para criar dados reais e gerar notificações de teste
"""
import os
import django
from datetime import datetime, timedelta
from django.utils import timezone

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from django.contrib.auth import get_user_model
from apps.projects.models import (
    Sprint, Project, Card, CardLog, Notification, NotificationType
)
from apps.projects.notification_utils import send_notification

User = get_user_model()

print("=" * 60)
print("CRIANDO DADOS REAIS PARA TESTE DE NOTIFICAÇÕES")
print("=" * 60)

# 1. Encontrar ou criar usuário Italo
try:
    italo = User.objects.get(username__icontains='italo')
    print(f"\n[OK] Usuario encontrado: {italo.username} (ID: {italo.id})")
except User.DoesNotExist:
    print("\n[INFO] Usuario 'Italo' nao encontrado. Criando...")
    italo = User.objects.create_user(
        username='italo',
        email='italo@test.com',
        first_name='Italo',
        last_name='Teste',
        role='desenvolvedor'
    )
    print(f"[OK] Usuario criado: {italo.username} (ID: {italo.id})")

# 2. Encontrar ou criar outros usuários necessários
try:
    supervisor = User.objects.filter(role='supervisor').first()
    if not supervisor:
        supervisor = User.objects.create_user(
            username='supervisor_test',
            email='supervisor@test.com',
            first_name='Supervisor',
            role='supervisor'
        )
        print(f"[OK] Supervisor criado: {supervisor.username}")
    else:
        print(f"[OK] Supervisor encontrado: {supervisor.username}")
except Exception as e:
    print(f"[ERRO] Erro ao criar supervisor: {e}")
    supervisor = italo

try:
    gerente = User.objects.filter(role='gerente').first()
    if not gerente:
        gerente = User.objects.create_user(
            username='gerente_test',
            email='gerente@test.com',
            first_name='Gerente',
            role='gerente'
        )
        print(f"[OK] Gerente criado: {gerente.username}")
    else:
        print(f"[OK] Gerente encontrado: {gerente.username}")
except Exception as e:
    print(f"[ERRO] Erro ao criar gerente: {e}")
    gerente = italo

# 3. Criar Sprint (dispara notificação de sprint criada)
print("\n--- Criando Sprint ---")
sprint = Sprint.objects.create(
    nome='Sprint de Teste - Notificações',
    data_inicio=timezone.now().date(),
    fechamento_em=timezone.now() + timedelta(days=14),
    duracao_dias=14,
    supervisor=supervisor
)
print(f"[OK] Sprint criada: {sprint.nome} (ID: {sprint.id})")
print("  -> Notificacao 'sprint_created' sera gerada automaticamente para todos os usuarios")

# 4. Criar Projeto (dispara notificação de projeto criado)
print("\n--- Criando Projeto ---")
project = Project.objects.create(
    nome='Projeto de Teste - Notificações',
    descricao='Projeto para testar sistema de notificações',
    sprint=sprint,
    gerente_atribuido=gerente,
    status='criado'
)
print(f"[OK] Projeto criado: {project.nome} (ID: {project.id})")
print("  -> Notificacao 'project_created' sera gerada para o gerente")

# 5. Criar Cards com diferentes cenários
print("\n--- Criando Cards ---")

# Card 1: Criado e atribuído ao Italo (dispara notificação card_created)
card1 = Card.objects.create(
    nome='Card de Teste - Criado',
    descricao='Card criado para testar notificação de criação',
    projeto=project,
    responsavel=italo,
    status='a_desenvolver',
    prioridade='alta',
    area='backend',
    tipo='feature'
)
print(f"[OK] Card 1 criado: {card1.nome} (ID: {card1.id})")
print("  -> Notificacao 'card_created' sera gerada para o Italo e gerente")

# Card 2: Atualizar (dispara notificação card_updated)
card1.nome = 'Card de Teste - Atualizado'
card1.descricao = 'Card atualizado para testar notificação de atualização'
card1.save()
print(f"[OK] Card 1 atualizado")
print("  -> Notificacao 'card_updated' sera gerada para o Italo e gerente")

# Card 3: Mover para outra etapa (dispara notificação card_moved)
card1.status = 'em_desenvolvimento'
card1.data_inicio = timezone.now()
card1.save()
print(f"[OK] Card 1 movido para 'em_desenvolvimento'")
print("  -> Notificacao 'card_moved' sera gerada para o Italo e gerente")

# Card 4: Criar outro card para deletar
card2 = Card.objects.create(
    nome='Card de Teste - Para Deletar',
    descricao='Card que será deletado',
    projeto=project,
    responsavel=italo,
    status='a_desenvolver',
    prioridade='media',
    area='frontend',
    tipo='bug'
)
print(f"[OK] Card 2 criado: {card2.nome} (ID: {card2.id})")

# Deletar card (dispara notificação card_deleted)
card2_id = card2.id
card2.delete()
print(f"[OK] Card 2 deletado")
print("  -> Notificacao 'card_deleted' sera gerada para o Italo e gerente")

# 6. Criar Log de Card (dispara notificação log_created)
print("\n--- Criando Log de Card ---")
card_log = CardLog.objects.create(
    card=card1,
    tipo_evento='comentario',
    descricao='Comentário de teste no card',
    usuario=gerente
)
print(f"[OK] Log criado no card {card1.nome}")
print("  -> Notificacao 'log_created' sera gerada para o Italo")

# 7. Alterar cargo do Italo (dispara notificação role_changed)
print("\n--- Alterando Cargo do Italo ---")
old_role = italo.role
italo.role = 'gerente'
italo.save()
print(f"[OK] Cargo do Italo alterado de '{old_role}' para '{italo.role}'")
print("  -> Notificacao 'role_changed' sera gerada para o Italo")

# 8. Criar Cards com prazos para notificações de alerta
print("\n--- Criando Cards com Prazos ---")

# Card vencendo em 24 horas
card_24h = Card.objects.create(
    nome='Card Vence em 24 Horas',
    descricao='Card para testar notificação de 24h',
    projeto=project,
    responsavel=italo,
    status='em_desenvolvimento',
    prioridade='alta',
    area='backend',
    tipo='feature',
    data_inicio=timezone.now() - timedelta(days=5),
    data_fim=timezone.now() + timedelta(hours=24)
)
print(f"[OK] Card criado: {card_24h.nome} (data_fim: {card_24h.data_fim})")
print("  -> Notificacao 'card_due_24h' sera criada pela tarefa Celery")

# Card vencendo em 1 hora
card_1h = Card.objects.create(
    nome='Card Vence em 1 Hora',
    descricao='Card para testar notificação de 1h',
    projeto=project,
    responsavel=italo,
    status='em_desenvolvimento',
    prioridade='alta',
    area='frontend',
    tipo='bug',
    data_inicio=timezone.now() - timedelta(days=3),
    data_fim=timezone.now() + timedelta(hours=1)
)
print(f"[OK] Card criado: {card_1h.nome} (data_fim: {card_1h.data_fim})")
print("  -> Notificacao 'card_due_1h' sera criada pela tarefa Celery")

# Card vencendo em 10 minutos
card_10min = Card.objects.create(
    nome='Card Vence em 10 Minutos',
    descricao='Card para testar notificação de 10min',
    projeto=project,
    responsavel=italo,
    status='em_desenvolvimento',
    prioridade='absoluta',
    area='backend',
    tipo='feature',
    data_inicio=timezone.now() - timedelta(days=2),
    data_fim=timezone.now() + timedelta(minutes=10)
)
print(f"[OK] Card criado: {card_10min.nome} (data_fim: {card_10min.data_fim})")
print("  -> Notificacao 'card_due_10min' sera criada pela tarefa Celery")

# Card atrasado
card_atrasado = Card.objects.create(
    nome='Card Atrasado',
    descricao='Card para testar notificação de atraso',
    projeto=project,
    responsavel=italo,
    status='em_desenvolvimento',
    prioridade='alta',
    area='backend',
    tipo='bug',
    data_inicio=timezone.now() - timedelta(days=10),
    data_fim=timezone.now() - timedelta(days=2)
)
print(f"[OK] Card criado: {card_atrasado.nome} (data_fim: {card_atrasado.data_fim})")
print("  -> Notificacao 'card_overdue' sera criada pela tarefa Celery")

# 9. Executar tarefa Celery manualmente para criar notificações de prazo
print("\n--- Executando Verificação de Prazos ---")
from apps.projects.tasks import check_card_deadlines
result = check_card_deadlines()
print(f"[OK] Tarefa executada: {result}")

# 10. Verificar notificações criadas
print("\n" + "=" * 60)
print("RESUMO DAS NOTIFICACOES CRIADAS")
print("=" * 60)

notifications = Notification.objects.filter(usuario=italo).order_by('-data_criacao')
print(f"\nTotal de notificacoes para {italo.username}: {notifications.count()}")

for notif in notifications:
    status = "[LIDA]" if notif.lida else "[NAO LIDA]"
    print(f"\n[{notif.tipo}] {notif.titulo}")
    print(f"  {status} | {notif.data_criacao.strftime('%d/%m/%Y %H:%M:%S')}")
    print(f"  {notif.mensagem[:80]}...")

print("\n" + "=" * 60)
print("[OK] DADOS DE TESTE CRIADOS COM SUCESSO!")
print("=" * 60)
print("\nProximos passos:")
print("1. Abra o frontend e faca login como Italo")
print("2. As notificacoes devem aparecer no botao de notificacoes")
print("3. Clique no botao para ver o painel de notificacoes")
print("4. Teste os filtros: Todas, Minhas, Nao lidas")
print("5. Clique nas notificacoes para navegar aos itens relacionados")

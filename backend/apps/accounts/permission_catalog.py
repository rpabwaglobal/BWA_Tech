from django.db import models

# Fonte única da verdade: usada tanto no Meta.permissions (gera as linhas em
# auth_permission na migração) quanto no endpoint de catálogo e no seed de
# permissões por role (migration 0009).
PERMISSION_CATALOG = [
    # (codename, label PT-BR, área — pra agrupar na UI)
    ('manage_sprints', 'Criar, editar e excluir sprints', 'Sprints'),
    ('manage_closed_sprints', 'Editar/excluir sprints já finalizadas', 'Sprints'),
    ('finalize_sprints', 'Finalizar sprints', 'Sprints'),
    ('manage_projects', 'Criar e editar projetos', 'Projetos'),
    ('delete_projects', 'Excluir projetos', 'Projetos'),
    ('manage_kanban_config', 'Gerenciar colunas do kanban e mover cards em massa', 'Projetos'),
    ('bulk_project_actions', 'Ações em massa em projetos (arquivar/excluir)', 'Projetos'),
    ('manage_global_kanban_stages', 'Criar/editar colunas globais do kanban', 'Projetos'),
    ('manage_others_cards', 'Editar/excluir cards de outros usuários', 'Cards'),
    ('manage_locked_cards', 'Editar/excluir cards finalizados, inviabilizados ou em sprint fechada', 'Cards'),
    ('manage_locked_card_attachments', 'Anexar/remover anexos em cards travados', 'Cards'),
    ('manage_weekly_priorities', 'Gerenciar prioridades semanais (criar/editar/excluir/fechar semana)', 'Prioridades'),
    ('approve_due_date_requests', 'Aprovar/rejeitar solicitações de mudança de data', 'Prioridades'),
    ('manage_others_due_date_requests', 'Editar/excluir solicitações de data de outros usuários', 'Prioridades'),
    ('manage_score', 'Gerenciar critérios e notas de Score', 'Score'),
    ('view_all_tickets', 'Ver todos os chamados de suporte (não só os próprios)', 'Suporte'),
    ('manage_ticket_resolution', 'Editar status, responsável e resolução de chamados', 'Suporte'),
    ('notify_ticket_user', 'Notificar usuário sobre chamado', 'Suporte'),
    # Ver o Geek Day é separado de operá-lo: o time inteiro acompanha o sorteio
    # e o histórico do ciclo, e só quem organiza sorteia. Antes disso, ver o
    # Geek Day exigia `view_metrics` — permissão de dados consolidados da
    # empresa, larga demais para uma brincadeira interna.
    ('view_geekday', 'Ver o Geek Day e o histórico de sorteios', 'Geek Day'),
    ('manage_geekday', 'Realizar sorteio, marcar sorteados e resetar Geek Day', 'Geek Day'),
    # Piso de leitura do trabalho. Sem ela a pessoa entra, vê o próprio perfil e
    # as próprias notificações, e mais nada — é o que faz "visitante sem acesso
    # a nada até receber cargo e setor" valer também para LEITURA (o
    # `NaoVisitanteEscreve` sempre cobriu só a escrita). Separada de
    # `view_metrics` de propósito: uma coisa é enxergar a sprint em que se
    # trabalha, outra é ver métricas consolidadas da empresa.
    ('view_content', 'Ver sprints, projetos e cards', 'Acesso'),
    ('view_metrics', 'Ver métricas, relatórios e dados consolidados/sensíveis', 'Acesso'),
    ('view_cross_setor', 'Ver dados de todos os setores (ignora a segmentação por setor)', 'Acesso'),
    ('manage_setor_sharing', 'Definir o setor e o compartilhamento de dados entre setores', 'Acesso'),
    # Administração delegável: permitem que um cargo criado pelo admin (CEO,
    # Supervisor, Gerente...) administre a plataforma, em vez de o privilégio
    # ficar cravado no código para os codenames 'admin'/'supervisor'.
    ('manage_users', 'Gerenciar usuários (ativar/desativar, atribuir cargo e setor)', 'Administração'),
    ('manage_user_permissions', 'Conceder e revogar permissões de outros usuários', 'Administração'),
    ('manage_cargos', 'Criar, editar e excluir cargos', 'Administração'),
    ('manage_setores', 'Criar, editar e excluir setores', 'Administração'),
]

PERMISSION_AREA_BY_CODENAME = {codename: area for codename, _label, area in PERMISSION_CATALOG}


class PermissaoPlataforma(models.Model):
    """Modelo 'fantasma' sem tabela própria — existe só para registrar, via
    Meta.permissions, o catálogo de permissões granulares customizadas da
    plataforma (não ligadas a nenhum model real). O Django cria as linhas
    correspondentes em auth_permission automaticamente na migração."""

    class Meta:
        managed = False
        default_permissions = ()
        permissions = [(codename, label) for codename, label, _area in PERMISSION_CATALOG]

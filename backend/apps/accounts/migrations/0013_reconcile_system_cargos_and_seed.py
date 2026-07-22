from django.db import migrations

from ..permission_catalog import PERMISSION_CATALOG

ALL_CODENAMES = [c for c, _l, _a in PERMISSION_CATALOG]

# Cargos de SISTEMA finais (is_system=True, protegidos).
SYSTEM_KEEP = {
    'admin': 'Administrador BWA Tech',
    'supervisor': 'Supervisor',
    'visitante': 'Visitante',
}
# Cargos que deixam de ser de sistema (viram criados/editáveis) — NUNCA deletados.
DEMOTE = ['gerente', 'desenvolvedor', 'dados', 'processos']

# Template do cargo "Desenvolvedor" = união das permissões que os cargos
# legados têm hoje (decisão do usuário). Na prática, as 4 operacionais que o
# ex-gerente tinha (os demais tinham zero).
DEV_TEMPLATE = [
    'view_all_tickets',
    'manage_ticket_resolution',
    'notify_ticket_user',
    'manage_geekday',
    # Pós-seed, TODOS os usuários atuais têm view_metrics (bloco abaixo) e o
    # kanban bundle/prioridades passou a exigi-la — a "união do que existe
    # hoje" inclui view_metrics; sem ela, um dev novo criado com o template
    # perderia o kanban.
    'view_metrics',
]
# `view_metrics` vai para TODOS os usuários existentes (hoje qualquer
# autenticado vê métricas → preservamos esse acesso; só FUTUROS visitantes
# não recebem). `view_cross_setor`/`manage_setor_sharing` são de gestão →
# só admin/supervisor.
PERMS_FOR_EVERYONE = ['view_metrics']
NEW_PERMS_FOR_PRIVILEGED = ['view_cross_setor', 'manage_setor_sharing']


def forwards(apps, schema_editor):
    # Garante que os auth.Permission das 3 novas permissões existam antes de
    # semear (post_migrate ainda não rodou nesta transação).
    from django.apps import apps as global_apps
    from django.contrib.auth.management import create_permissions
    create_permissions(global_apps.get_app_config('accounts'), apps=global_apps, verbosity=0)

    Cargo = apps.get_model('accounts', 'Cargo')
    User = apps.get_model('accounts', 'User')
    Permission = apps.get_model('auth', 'Permission')
    ContentType = apps.get_model('contenttypes', 'ContentType')

    # 1) Cargos de sistema: cria/renomeia e marca is_system=True.
    for codename, nome in SYSTEM_KEEP.items():
        Cargo.objects.update_or_create(
            codename=codename,
            defaults={'nome': nome, 'is_system': True},
        )
    # 2) Rebaixa os legados (não deleta).
    Cargo.objects.filter(codename__in=DEMOTE).update(is_system=False)

    # 3) Templates de permissões-padrão por cargo.
    Cargo.objects.filter(codename__in=['admin', 'supervisor']).update(permissoes_padrao=ALL_CODENAMES)
    Cargo.objects.filter(codename='visitante').update(permissoes_padrao=[])
    Cargo.objects.filter(codename='desenvolvedor').update(permissoes_padrao=DEV_TEMPLATE)

    # 4) Cores default distinguíveis (podem ser trocadas depois na UI).
    _cores = {
        'admin': '#c4b5fd', 'supervisor': '#93c5fd', 'visitante': '#9ca3af',
        'gerente': '#86efac', 'desenvolvedor': '#fdba74', 'dados': '#c4b5fd', 'processos': '#fca5a5',
    }
    for cn, cor in _cores.items():
        Cargo.objects.filter(codename=cn).update(cor=cor)

    # 5) Semeia permissões novas.
    try:
        ct = ContentType.objects.get(app_label='accounts', model='permissaoplataforma')
    except ContentType.DoesNotExist:
        return
    perms_all = list(Permission.objects.filter(content_type=ct, codename__in=PERMS_FOR_EVERYONE))
    perms_priv = list(Permission.objects.filter(content_type=ct, codename__in=NEW_PERMS_FOR_PRIVILEGED))
    # view_metrics: todos os usuários existentes (preserva acesso atual a métricas).
    if perms_all:
        for u in User.objects.all():
            u.user_permissions.add(*perms_all)
    # view_cross_setor + manage_setor_sharing: só admin/supervisor.
    if perms_priv:
        for u in User.objects.filter(role__in=['admin', 'supervisor']):
            u.user_permissions.add(*perms_priv)


def backwards(apps, schema_editor):
    Cargo = apps.get_model('accounts', 'Cargo')
    Cargo.objects.filter(codename__in=DEMOTE).update(is_system=True)
    Cargo.objects.filter(codename='admin').update(nome='Admin')
    # visitante permanece; não removemos usuários dele no rollback.


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0012_alter_permissaoplataforma_options_cargo_cor_and_more'),
    ]

    operations = [
        migrations.RunPython(forwards, backwards),
    ]

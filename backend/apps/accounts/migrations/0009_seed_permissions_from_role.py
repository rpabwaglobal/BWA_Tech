from django.db import migrations

from ..permission_catalog import PERMISSION_CATALOG

ALL_CODENAMES = [codename for codename, _label, _area in PERMISSION_CATALOG]

# Replica 1:1 o que cada role já pode fazer HOJE (antes desta migration), pra
# não mudar nenhum comportamento em produção no dia do deploy. A partir daqui
# as permissões passam a ser editáveis individualmente pela nova tela de
# Gerenciamento de Usuários, desacopladas do role.
ROLE_CODENAMES = {
    'admin': ALL_CODENAMES,
    'supervisor': ALL_CODENAMES,
    'gerente': [
        'view_all_tickets',
        'manage_ticket_resolution',
        'notify_ticket_user',
        'manage_geekday',
    ],
    'desenvolvedor': [],
    'dados': [],
    'processos': [],
}


def seed_permissions(apps, schema_editor):
    # As linhas de auth_permission pro catálogo novo só são garantidas depois
    # que o sinal post_migrate roda — o que só acontece após TODAS as
    # migrations do comando `migrate` terminarem, ou seja, depois desta
    # RunPython. Força a criação agora, senão a consulta abaixo vem vazia.
    from django.apps import apps as global_apps
    from django.contrib.auth.management import create_permissions

    create_permissions(global_apps.get_app_config('accounts'), apps=global_apps, verbosity=0)

    User = apps.get_model('accounts', 'User')
    Permission = apps.get_model('auth', 'Permission')
    ContentType = apps.get_model('contenttypes', 'ContentType')

    try:
        content_type = ContentType.objects.get(app_label='accounts', model='permissaoplataforma')
    except ContentType.DoesNotExist:
        # Catálogo vazio/não criado (ex.: banco de teste sem as permissões
        # customizadas) — nada a semear.
        return

    permissions_by_codename = {
        p.codename: p
        for p in Permission.objects.filter(content_type=content_type, codename__in=ALL_CODENAMES)
    }

    for user in User.objects.all():
        codenames = ROLE_CODENAMES.get(user.role, [])
        perms = [permissions_by_codename[c] for c in codenames if c in permissions_by_codename]
        if perms:
            user.user_permissions.set(perms)


def unseed_permissions(apps, schema_editor):
    User = apps.get_model('accounts', 'User')
    Permission = apps.get_model('auth', 'Permission')
    ContentType = apps.get_model('contenttypes', 'ContentType')

    try:
        content_type = ContentType.objects.get(app_label='accounts', model='permissaoplataforma')
    except ContentType.DoesNotExist:
        return

    catalog_perms = Permission.objects.filter(content_type=content_type, codename__in=ALL_CODENAMES)
    for user in User.objects.all():
        user.user_permissions.remove(*catalog_perms)


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0008_add_setor_and_permission_catalog'),
    ]

    operations = [
        migrations.RunPython(seed_permissions, unseed_permissions),
    ]

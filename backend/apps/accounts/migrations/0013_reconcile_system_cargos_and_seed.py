"""Catálogo inicial de cargos: APENAS "Admin" e "Visitante".

Todo o resto (Supervisor, Gerente, CEO, o que for) é criado manualmente pelo
admin, com as permissões que ele escolher — é isso que a tela de Setores e
Cargos existe para fazer.

Consequência para os usuários existentes: todos vão para `visitante` sem
permissão nenhuma, exceto os superusers do Django, que vão para `admin` com o
catálogo inteiro. Depois do deploy o admin reatribui cargo e permissões na mão.

Os codenames 'admin' e 'visitante' são LITERAIS e não podem mudar: `User.save()`
força role='admin' para superuser e `NaoVisitanteEscreve` compara com a string
'visitante'. Um cargo criado pela UI tem codename derivado do nome (slugify),
por isso estes dois precisam nascer aqui.
"""
from django.db import migrations

from ..permission_catalog import PERMISSION_CATALOG

ALL_CODENAMES = [c for c, _l, _a in PERMISSION_CATALOG]

# Cargos de SISTEMA (is_system=True, protegidos contra edição de codename e exclusão).
SYSTEM_CARGOS = {
    'admin': ('Administrador BWA Tech', '#c4b5fd', ALL_CODENAMES),
    'visitante': ('Visitante', '#9ca3af', []),
}


def forwards(apps, schema_editor):
    # As linhas de auth_permission do catálogo só são garantidas pelo sinal
    # post_migrate, que roda depois de TODAS as migrations. Força agora, senão
    # a consulta abaixo vem vazia.
    from django.apps import apps as global_apps
    from django.contrib.auth.management import create_permissions
    create_permissions(global_apps.get_app_config('accounts'), apps=global_apps, verbosity=0)

    Cargo = apps.get_model('accounts', 'Cargo')
    User = apps.get_model('accounts', 'User')
    Permission = apps.get_model('auth', 'Permission')
    ContentType = apps.get_model('contenttypes', 'ContentType')

    # 1) Cargos de sistema.
    for codename, (nome, cor, template) in SYSTEM_CARGOS.items():
        Cargo.objects.update_or_create(
            codename=codename,
            defaults={'nome': nome, 'cor': cor, 'is_system': True, 'permissoes_padrao': template},
        )

    # 2) Usuários: superuser -> admin (tudo), demais -> visitante (nada).
    #    Feito ANTES de apagar os cargos antigos: `validate_role` exige que o
    #    Cargo do usuário exista, e um role órfão quebraria qualquer edição.
    try:
        ct = ContentType.objects.get(app_label='accounts', model='permissaoplataforma')
    except ContentType.DoesNotExist:
        ct = None

    todas = list(Permission.objects.filter(content_type=ct, codename__in=ALL_CODENAMES)) if ct else []

    for u in User.objects.all():
        if u.is_superuser:
            u.role = 'admin'
            u.save(update_fields=['role'])
            if todas:
                u.user_permissions.add(*todas)
        else:
            u.role = 'visitante'
            u.save(update_fields=['role'])
            if todas:
                u.user_permissions.remove(*todas)

    # 3) Só agora remove qualquer cargo fora do catálogo inicial (bancos que
    #    chegaram aqui com o seed antigo aplicado). Nenhum usuário aponta mais
    #    para eles depois do passo 2.
    Cargo.objects.exclude(codename__in=SYSTEM_CARGOS.keys()).delete()


def backwards(apps, schema_editor):
    # Não há volta útil: os cargos antigos e a distribuição de permissões por
    # role foram descartados de propósito. Mantido reversível para não travar
    # um `migrate` para trás em dev.
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0012_alter_permissaoplataforma_options_cargo_cor_and_more'),
    ]

    operations = [
        migrations.RunPython(forwards, backwards),
    ]

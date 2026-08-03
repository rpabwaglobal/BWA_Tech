"""Divide `manage_catalog` em `manage_cargos` e `manage_setores`.

Administrar o catálogo de cargos e o de setores passou a ser delegável
separadamente: quem cuida do organograma não precisa poder mexer na
segmentação da plataforma, e vice-versa.

Quem já tinha a permissão antiga recebe as duas novas — a divisão não pode
tirar acesso de ninguém. Só depois a linha órfã é removida de auth_permission
(o Django não faz essa limpeza sozinho quando um codename sai do catálogo).
"""
from django.db import migrations

ANTIGA = 'manage_catalog'
NOVAS = ['manage_cargos', 'manage_setores']


def forwards(apps, schema_editor):
    Permission = apps.get_model('auth', 'Permission')
    ContentType = apps.get_model('contenttypes', 'ContentType')

    try:
        ct = ContentType.objects.get(app_label='accounts', model='permissaoplataforma')
    except ContentType.DoesNotExist:
        return

    antiga = Permission.objects.filter(content_type=ct, codename=ANTIGA).first()
    if antiga is None:
        return

    novas = list(Permission.objects.filter(content_type=ct, codename__in=NOVAS))
    if novas:
        User = apps.get_model('accounts', 'User')
        for user in User.objects.filter(user_permissions=antiga):
            user.user_permissions.add(*novas)

    antiga.delete()


def backwards(apps, schema_editor):
    # Sem volta: a permissão antiga foi substituída por duas mais específicas.
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0018_alter_permissaoplataforma_options'),
    ]

    operations = [
        migrations.RunPython(forwards, backwards),
    ]

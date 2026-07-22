from django.db import migrations


def forwards(apps, schema_editor):
    SetorCatalogo = apps.get_model('accounts', 'SetorCatalogo')
    SetorCatalogo.objects.get_or_create(
        codename='tecnologia',
        defaults={'nome': 'Tecnologia', 'is_system': False, 'cor': '#3b82f6'},
    )


def backwards(apps, schema_editor):
    # Não remove: pode já ter dados vinculados.
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0015_usersetor_user_setores'),
    ]

    operations = [
        migrations.RunPython(forwards, backwards),
    ]

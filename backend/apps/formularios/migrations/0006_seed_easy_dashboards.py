# Adiciona 2 novos SuporteTipo: Easy e Dashboards.
# RPA já existe (0002_seed_catalogo). Infraestrutura permanece no banco mas
# não é categoria nas 3 tabs do frontend.

from django.db import migrations


def seed_easy_dashboards(apps, schema_editor):
    SuporteTipo = apps.get_model('formularios', 'SuporteTipo')
    # update_or_create: garante que se o tipo já existir mas estiver inativo
    # (alguém desativou via admin), a migration REATIVA. Sem isso, get_or_create
    # ignoraria o `ativo` e o tipo continuaria escondido do /catalogo/.
    SuporteTipo.objects.update_or_create(nome='Easy', defaults={'ativo': True})
    SuporteTipo.objects.update_or_create(nome='Dashboards', defaults={'ativo': True})


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('formularios', '0005_timeline_tipo_pendencia'),
    ]

    operations = [
        migrations.RunPython(seed_easy_dashboards, noop_reverse),
    ]

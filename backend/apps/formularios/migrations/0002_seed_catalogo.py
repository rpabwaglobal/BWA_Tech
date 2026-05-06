# Generated manually — dados iniciais para desenvolvimento

from django.db import migrations


def seed_catalogo(apps, schema_editor):
    SuporteTipo = apps.get_model('formularios', 'SuporteTipo')
    SuporteItem = apps.get_model('formularios', 'SuporteItem')
    SuporteMotivo = apps.get_model('formularios', 'SuporteMotivo')

    if SuporteTipo.objects.exists():
        return

    t_infra = SuporteTipo.objects.create(nome='Infraestrutura', ativo=True)
    t_rpa = SuporteTipo.objects.create(nome='RPA', ativo=True)

    SuporteItem.objects.create(tipo=t_infra, nome='Acesso ao sistema', ativo=True)
    SuporteItem.objects.create(tipo=t_infra, nome='Relatórios', ativo=True)
    SuporteItem.objects.create(tipo=t_rpa, nome='Robô de conciliação', ativo=True)

    SuporteMotivo.objects.create(nome='Bug', ativo=True)
    SuporteMotivo.objects.create(nome='Dúvida operacional', ativo=True)
    SuporteMotivo.objects.create(nome='Melhoria urgente', ativo=True)


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('formularios', '0001_initial'),
    ]

    operations = [
        migrations.RunPython(seed_catalogo, noop_reverse),
    ]

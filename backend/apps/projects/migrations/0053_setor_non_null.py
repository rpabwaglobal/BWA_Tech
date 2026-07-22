"""Torna `setor` obrigatório (non-null) em Sprint/Project/Card com on_delete
PROTECT. SÓ aplicar após o backfill garantir zero órfãos (guard aborta se não).
"""
from django.db import migrations, models
import django.db.models.deletion


def guard_no_orphans(apps, schema_editor):
    Sprint = apps.get_model('projects', 'Sprint')
    Project = apps.get_model('projects', 'Project')
    Card = apps.get_model('projects', 'Card')
    orf = (Sprint.objects.filter(setor__isnull=True).count()
           + Project.objects.filter(setor__isnull=True).count()
           + Card.objects.filter(setor__isnull=True).count())
    if orf:
        raise RuntimeError(
            f'Existem {orf} registros sem setor. Rode "migrar_tudo_para_tecnologia" antes desta migração.')


def noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('projects', '0052_card_setor_project_setor_and_more'),
        ('accounts', '0016_seed_setor_tecnologia'),
    ]

    operations = [
        migrations.RunPython(guard_no_orphans, noop),
        migrations.AlterField(
            model_name='card',
            name='setor',
            field=models.ForeignKey(
                blank=True, db_index=True, on_delete=django.db.models.deletion.PROTECT,
                related_name='cards', to='accounts.setorcatalogo', verbose_name='Setor'),
        ),
        migrations.AlterField(
            model_name='project',
            name='setor',
            field=models.ForeignKey(
                blank=True, db_index=True, on_delete=django.db.models.deletion.PROTECT,
                related_name='projetos', to='accounts.setorcatalogo', verbose_name='Setor'),
        ),
        migrations.AlterField(
            model_name='sprint',
            name='setor',
            field=models.ForeignKey(
                blank=True, db_index=True, on_delete=django.db.models.deletion.PROTECT,
                related_name='sprints', to='accounts.setorcatalogo', verbose_name='Setor'),
        ),
    ]

"""Torna `setor` obrigatório (non-null) em Sprint/Project/Card, com PROTECT.

Faz o backfill sozinha: tudo que estiver sem setor vai para o setor padrão
("Sem Setor", semeado em accounts/0016). Isso é o que permite um
`migrate` corrido — inclusive o do entrypoint do container — sem depender de
alguém lembrar de rodar um command antes.

O guard depois do backfill é um assert: se ainda sobrar órfão, algo mudou de
forma inesperada e é melhor abortar do que gravar NOT NULL em cima de nulo.
"""
from django.db import migrations, models
import django.db.models.deletion

SETOR_PADRAO_CODENAME = 'sem_setor'


def backfill_setor_padrao(apps, schema_editor):
    SetorCatalogo = apps.get_model('accounts', 'SetorCatalogo')
    Sprint = apps.get_model('projects', 'Sprint')
    Project = apps.get_model('projects', 'Project')
    Card = apps.get_model('projects', 'Card')

    setor = SetorCatalogo.objects.filter(codename=SETOR_PADRAO_CODENAME).first()
    if setor is None:
        # Fallback defensivo: qualquer setor serve mais do que abortar o deploy,
        # e o admin reclassifica depois. Só acontece se o seed for alterado.
        setor = SetorCatalogo.objects.order_by('id').first()
    if setor is None:
        raise RuntimeError(
            'Nenhum setor no catálogo. A migration accounts/0016_seed_setor_padrao '
            'deveria ter criado "Sem Setor".')

    Sprint.objects.filter(setor__isnull=True).update(setor=setor)
    Project.objects.filter(setor__isnull=True).update(setor=setor)
    Card.objects.filter(setor__isnull=True).update(setor=setor)

    orf = (Sprint.objects.filter(setor__isnull=True).count()
           + Project.objects.filter(setor__isnull=True).count()
           + Card.objects.filter(setor__isnull=True).count())
    if orf:
        raise RuntimeError(f'Backfill de setor falhou: {orf} registros continuam sem setor.')


def noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('projects', '0052_card_setor_project_setor_and_more'),
        ('accounts', '0016_seed_setor_padrao'),
    ]

    operations = [
        migrations.RunPython(backfill_setor_padrao, noop),
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

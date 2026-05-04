from django.db import migrations, models
from django.db.models import F


def backfill_finalizado_em(apps, schema_editor):
    Card = apps.get_model('projects', 'Card')
    Card.objects.filter(status='finalizado', finalizado_em__isnull=True).update(
        finalizado_em=F('updated_at')
    )


class Migration(migrations.Migration):

    dependencies = [
        ('projects', '0031_sprint_data_inicio_datetime'),
    ]

    operations = [
        migrations.AddField(
            model_name='card',
            name='finalizado_em',
            field=models.DateTimeField(
                blank=True,
                null=True,
                verbose_name='Finalizado em',
                help_text='Instante em que o card passou a finalizado pela última vez (métricas de prazo).',
            ),
        ),
        migrations.RunPython(backfill_finalizado_em, migrations.RunPython.noop),
    ]

from decimal import Decimal

from django.db import migrations, models


def horas_para_minutos(apps, schema_editor):
    Card = apps.get_model('projects', 'Card')
    for card in Card.objects.exclude(horas_uteis_desenvolvimento__isnull=True):
        card.minutos_uteis_desenvolvimento = int(
            round(float(card.horas_uteis_desenvolvimento) * 60)
        )
        card.save(update_fields=['minutos_uteis_desenvolvimento'])


class Migration(migrations.Migration):

    dependencies = [
        ('projects', '0045_cachedholiday_card_dev_time'),
    ]

    operations = [
        migrations.AddField(
            model_name='card',
            name='minutos_uteis_desenvolvimento',
            field=models.PositiveIntegerField(
                blank=True,
                null=True,
                verbose_name='Minutos úteis em desenvolvimento',
            ),
        ),
        migrations.RunPython(horas_para_minutos, migrations.RunPython.noop),
        migrations.RemoveField(
            model_name='card',
            name='horas_uteis_desenvolvimento',
        ),
    ]

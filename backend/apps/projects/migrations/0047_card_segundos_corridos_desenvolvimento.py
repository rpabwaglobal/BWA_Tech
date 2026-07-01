from django.db import migrations, models


def dias_para_segundos(apps, schema_editor):
    Card = apps.get_model('projects', 'Card')
    for card in Card.objects.exclude(dias_corridos_desenvolvimento__isnull=True):
        card.segundos_corridos_desenvolvimento = int(
            round(float(card.dias_corridos_desenvolvimento) * 86400)
        )
        card.save(update_fields=['segundos_corridos_desenvolvimento'])


class Migration(migrations.Migration):

    dependencies = [
        ('projects', '0046_card_minutos_uteis_desenvolvimento'),
    ]

    operations = [
        migrations.AddField(
            model_name='card',
            name='segundos_corridos_desenvolvimento',
            field=models.PositiveIntegerField(
                blank=True,
                null=True,
                verbose_name='Segundos corridos em desenvolvimento',
            ),
        ),
        migrations.RunPython(dias_para_segundos, migrations.RunPython.noop),
        migrations.RemoveField(
            model_name='card',
            name='dias_corridos_desenvolvimento',
        ),
    ]

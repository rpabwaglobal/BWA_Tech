# Generated manually: fechamento da sprint passa a ser data+hora na própria sprint (não Prioridades).

from datetime import datetime, time
import zoneinfo

from django.conf import settings
from django.db import migrations, models
from django.utils import timezone


def populate_fechamento_em(apps, schema_editor):
    Sprint = apps.get_model('projects', 'Sprint')
    WeeklyPriorityConfig = apps.get_model('projects', 'WeeklyPriorityConfig')
    cfg = WeeklyPriorityConfig.objects.order_by('pk').first()
    hl = getattr(cfg, 'horario_limite', None) or time(9, 0, 0)
    tz = zoneinfo.ZoneInfo(settings.TIME_ZONE)
    for s in Sprint.objects.all():
        if getattr(s, 'fechamento_em', None):
            continue
        df = s.data_fim
        if not df:
            continue
        dt = datetime.combine(df, hl)
        s.fechamento_em = timezone.make_aware(dt, tz)
        s.save(update_fields=['fechamento_em'])


class Migration(migrations.Migration):

    dependencies = [
        ('projects', '0029_alter_card_area_add_automacao'),
    ]

    operations = [
        migrations.AddField(
            model_name='sprint',
            name='fechamento_em',
            field=models.DateTimeField(
                null=True,
                blank=True,
                verbose_name='Data e hora de fechamento',
            ),
        ),
        migrations.RunPython(populate_fechamento_em, migrations.RunPython.noop),
        migrations.RemoveField(model_name='sprint', name='data_fim'),
        migrations.AlterField(
            model_name='sprint',
            name='fechamento_em',
            field=models.DateTimeField(verbose_name='Data e hora de fechamento'),
        ),
    ]

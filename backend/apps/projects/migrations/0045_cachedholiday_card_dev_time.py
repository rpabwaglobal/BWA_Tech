from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('projects', '0044_cardlog_transferido_sprint'),
    ]

    operations = [
        migrations.CreateModel(
            name='CachedHoliday',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('date', models.DateField(verbose_name='Data')),
                ('year', models.PositiveSmallIntegerField(verbose_name='Ano')),
                ('name', models.CharField(max_length=200, verbose_name='Nome')),
                ('tipo', models.CharField(max_length=20, verbose_name='Tipo')),
                ('ibge', models.PositiveIntegerField(default=2408102, verbose_name='Código IBGE')),
                ('synced_at', models.DateTimeField(auto_now=True, verbose_name='Sincronizado em')),
            ],
            options={
                'verbose_name': 'Feriado em cache',
                'verbose_name_plural': 'Feriados em cache',
                'ordering': ['date'],
            },
        ),
        migrations.AddConstraint(
            model_name='cachedholiday',
            constraint=models.UniqueConstraint(fields=('date', 'ibge'), name='projects_cachedholiday_date_ibge_uniq'),
        ),
        migrations.AddField(
            model_name='card',
            name='dias_corridos_desenvolvimento',
            field=models.DecimalField(blank=True, decimal_places=2, max_digits=10, null=True, verbose_name='Dias corridos em desenvolvimento'),
        ),
        migrations.AddField(
            model_name='card',
            name='dias_uteis_desenvolvimento',
            field=models.PositiveSmallIntegerField(blank=True, null=True, verbose_name='Dias úteis em desenvolvimento'),
        ),
        migrations.AddField(
            model_name='card',
            name='horas_uteis_desenvolvimento',
            field=models.DecimalField(blank=True, decimal_places=2, max_digits=10, null=True, verbose_name='Horas úteis em desenvolvimento'),
        ),
    ]

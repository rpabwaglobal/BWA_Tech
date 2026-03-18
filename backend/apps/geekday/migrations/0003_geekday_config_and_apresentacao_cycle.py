from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('geekday', '0002_alter_geekdaydraw_unique_together'),
    ]

    operations = [
        migrations.CreateModel(
            name='GeekDayConfig',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('current_cycle', models.PositiveIntegerField(default=1, verbose_name='Ciclo Atual')),
                ('updated_at', models.DateTimeField(auto_now=True, verbose_name='Atualizado em')),
            ],
            options={
                'verbose_name': 'Configuração Geek Day',
                'verbose_name_plural': 'Configurações Geek Day',
            },
        ),
        migrations.AddField(
            model_name='geekdaydraw',
            name='cycle',
            field=models.PositiveIntegerField(default=1, help_text='Ciclo do sorteio para permitir reset sem apagar histórico', verbose_name='Ciclo'),
        ),
        migrations.AddField(
            model_name='geekdaydraw',
            name='data_apresentacao',
            field=models.DateField(blank=True, null=True, verbose_name='Data de Apresentação'),
        ),
    ]


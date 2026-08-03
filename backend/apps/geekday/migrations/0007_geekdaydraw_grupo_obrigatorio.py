"""Fecha `GeekDayDraw.grupo` como NOT NULL, depois do backfill de 0006.

Sorteio sem grupo não tem fila, ciclo nem histórico a que pertencer — deixar a
coluna nula manteria viva a ideia de "sorteio da empresa", que é justamente o
que esta mudança revoga.
"""
import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('geekday', '0006_migra_sorteios_para_grupo'),
    ]

    operations = [
        migrations.AlterField(
            model_name='geekdaydraw',
            name='grupo',
            field=models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='sorteios', to='geekday.geekdaygrupo', verbose_name='Grupo do Geek Day'),
        ),
    ]

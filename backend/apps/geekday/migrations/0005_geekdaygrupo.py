"""GeekDayConfig (singleton da empresa) vira GeekDayGrupo (conjunto de setores).

RENAME de verdade, não CreateModel: a tabela `geekday_geekdayconfig` existe em
produção com o ciclo corrente, e recriar o model perderia esse estado (e com
ele a noção de quem já foi sorteado no ciclo em curso).

A FK `grupo` do sorteio nasce NULA aqui de propósito — 0006 preenche os
sorteios existentes e 0007 fecha a coluna como NOT NULL. Fazer isso em três
passos é o que permite migrar uma base com histórico sem perder linha nenhuma.
"""
import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0016_seed_setor_padrao'),
        ('geekday', '0004_alter_geekdaydraw_usuario'),
    ]

    operations = [
        migrations.RenameModel(
            old_name='GeekDayConfig',
            new_name='GeekDayGrupo',
        ),
        migrations.AlterModelOptions(
            name='geekdaygrupo',
            options={
                'ordering': ['nome'],
                'verbose_name': 'Grupo de Geek Day',
                'verbose_name_plural': 'Grupos de Geek Day',
            },
        ),
        migrations.AddField(
            model_name='geekdaygrupo',
            name='nome',
            # default temporário só para a linha que já existe; 0006 dá o nome
            # definitivo. `preserve_default=False` evita que o default entre no
            # estado do model.
            field=models.CharField(default='Geek Day', max_length=80, verbose_name='Nome do grupo'),
            preserve_default=False,
        ),
        migrations.CreateModel(
            name='GeekDayGrupoSetor',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('added_at', models.DateTimeField(auto_now_add=True, verbose_name='Vinculado em')),
                ('grupo', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='vinculos_setor', to='geekday.geekdaygrupo', verbose_name='Grupo')),
                # OneToOne = UNIQUE no banco: um setor não entra em dois grupos.
                ('setor', models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name='geekday_vinculo', to='accounts.setorcatalogo', verbose_name='Setor')),
            ],
            options={
                'verbose_name': 'Setor do grupo de Geek Day',
                'verbose_name_plural': 'Setores dos grupos de Geek Day',
            },
        ),
        migrations.AddField(
            model_name='geekdaygrupo',
            name='setores',
            field=models.ManyToManyField(blank=True, related_name='geekday_grupos', through='geekday.GeekDayGrupoSetor', to='accounts.setorcatalogo', verbose_name='Setores do grupo'),
        ),
        migrations.AddField(
            model_name='geekdaydraw',
            name='grupo',
            field=models.ForeignKey(null=True, on_delete=django.db.models.deletion.PROTECT, related_name='sorteios', to='geekday.geekdaygrupo', verbose_name='Grupo do Geek Day'),
        ),
    ]

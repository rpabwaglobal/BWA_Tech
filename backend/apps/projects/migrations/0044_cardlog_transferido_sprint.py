from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('projects', '0043_add_usernoteitem_parent'),
    ]

    operations = [
        migrations.AlterField(
            model_name='cardlog',
            name='tipo_evento',
            field=models.CharField(
                choices=[
                    ('criado', 'Card Criado'),
                    ('movimentado', 'Movimentado'),
                    ('transferido_sprint', 'Transferido de Sprint'),
                    ('pendencia', 'Pendência'),
                    ('atualizado', 'Atualizado'),
                    ('alteracao', 'Alteração no Card'),
                    ('responsavel_alterado', 'Responsável Alterado'),
                    ('comentario', 'Comentário'),
                ],
                max_length=30,
                verbose_name='Tipo de Evento',
            ),
        ),
    ]

# Generated manually for ChamadoSuporteTimelineTipo.PENDENCIA

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('formularios', '0004_expand_timeline_tipos'),
    ]

    operations = [
        migrations.AlterField(
            model_name='chamadosuportetimeline',
            name='tipo_evento',
            field=models.CharField(
                choices=[
                    ('criado', 'Ticket criado'),
                    ('etapa_alterada', 'Etapa alterada'),
                    ('responsavel_alterado', 'Responsável alterado'),
                    ('notificacao', 'Notificação ao solicitante'),
                    ('pendencia', 'Pendência no quadro'),
                    ('comentario', 'Comentário'),
                ],
                default='comentario',
                max_length=30,
            ),
        ),
    ]

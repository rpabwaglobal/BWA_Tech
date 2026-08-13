"""
Uma resposta por link → VÁRIAS. Pedido do usuário: "mais de um usuário deve
poder responder o feedback, o link do formulário não deve expirar."

ZERO PERDA DE LINHA, e é por isso que a operação é `AlterField` e nunca um par
RemoveField/AddField: `AlterField` mantém a MESMA coluna `pedido_id`. No
Postgres o SQL gerado é só DROP CONSTRAINT ...key (a unicidade do OneToOne) +
CREATE INDEX comum. Nenhum dado é reescrito, nenhuma linha é tocada.

Conferido com `sqlmigrate feedbacks 0008` ANTES de aplicar — não há DROP COLUMN
nem ADD COLUMN. Em produção existem respostas reais; um drop-and-create as
apagaria em silêncio.

A unicidade some DE PROPÓSITO. O que a substitui como freio é o teto
`MAX_RESPOSTAS_POR_PEDIDO`, conferido no POST antes do INSERT.
"""

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('feedbacks', '0007_seed_formulario_v3'),
    ]

    operations = [
        migrations.AlterModelOptions(
            name='respostafeedback',
            options={'ordering': ['-enviado_em', '-id'], 'verbose_name': 'Resposta de feedback', 'verbose_name_plural': 'Respostas de feedback'},
        ),
        migrations.AlterField(
            model_name='respostafeedback',
            name='pedido',
            field=models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='respostas', to='feedbacks.pedidofeedback'),
        ),
    ]

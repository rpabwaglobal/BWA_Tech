"""
Schema da FASE 2 do feedback pós-entrega: três campos, uma migration.

Os três nascem juntos porque respondem à MESMA feature e são inseparáveis dela:

  - `Sprint.is_system`            âncora oculta do fluxo de monitoramento (a
                                  sprint que nunca fecha e nunca conta métrica);
  - `Card.gerar_formulario_feedback`  o checkbox do pedido original;
  - `KanbanStage.oculta_no_catalogo`  tira as 3 etapas de feedback do seletor
                                  "adicionar coluna" dos projetos comuns.

Os três são booleanos com `default=False`, então o ALTER TABLE não reescreve
linha nenhuma no Postgres (default constante desde a versão 11) e a migration é
segura em tabela grande.

O SEED da estrutura (sprint + projeto + 3 etapas + 3 configs) NÃO está aqui: ele
é data migration do app de feedbacks (`feedbacks/0003_seed_monitoramento`), que
depende desta. Assim `apps.projects` continua sem saber que `apps.feedbacks`
existe.
"""
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('projects', '0060_desatribuir_cards_de_inativos'),
    ]

    operations = [
        migrations.AddField(
            model_name='sprint',
            name='is_system',
            field=models.BooleanField(
                db_index=True,
                default=False,
                help_text='Sprints sistêmicas ancoram fluxos internos (ex.: Monitoramento de '
                          'feedbacks) e são excluídas de listagens, métricas, fechamento '
                          'automático e replicação.',
                verbose_name='Sprint Sistêmica',
            ),
        ),
        migrations.AddField(
            model_name='card',
            name='gerar_formulario_feedback',
            field=models.BooleanField(
                default=False,
                help_text='Quando o projeto for marcado como Entregue, este card gera um pedido '
                          'de feedback com link público próprio.',
                verbose_name='Gerar formulário de feedback',
            ),
        ),
        migrations.AddField(
            model_name='kanbanstage',
            name='oculta_no_catalogo',
            field=models.BooleanField(
                default=False,
                help_text='Etapas de fluxos internos (ex.: monitoramento de feedbacks) não '
                          'podem ser adicionadas a projetos comuns pela tela de etapas.',
                verbose_name='Oculta no catálogo global',
            ),
        ),
    ]

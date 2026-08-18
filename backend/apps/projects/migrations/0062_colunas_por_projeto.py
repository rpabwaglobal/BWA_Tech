"""
AS COLUNAS CUSTOMIZADAS DO KANBAN PASSAM A PERTENCER AO PROJETO.

Antes, `KanbanStage` era um catálogo global com `key` única no sistema inteiro:
a coluna "Backlog" do projeto A e a do projeto B eram a MESMA linha. Renomear
numa renomeava em todas, e não existia como ter duas colunas homônimas
independentes. Os CARDS já eram separados (o quadro filtra por projeto), mas a
identidade da coluna era compartilhada.

Agora `KanbanStage.projeto` decide o dono: NULL = global, preenchido = do
projeto. As dez chaves de sistema (as seis do ciclo de vida e as quatro do fluxo
de feedback) continuam globais, porque são comparadas como string crua em
métricas, relatórios e no gatilho que gera o pedido de feedback.

A ORDEM DAS OPERAÇÕES AQUI NÃO É A QUE O `makemigrations` GEROU, e a diferença
importa duas vezes:

1. O backfill de `stage_key` vem ANTES da constraint que o usa. Na ordem
   automática, a constraint entraria com todas as linhas em branco — e branco é
   igual a branco, então o primeiro projeto com duas etapas derrubaria a
   migração.

2. As constraints e a conversão dos dados ficam na migração SEGUINTE, e não
   por organização: o Postgres recusa criar índice numa tabela que tem "pending
   trigger events" da mesma transação, e o backfill acima é exatamente isso.
   Separar dá uma transação para cada metade. A ordem pretendida se mantém —
   constraints antes da conversão — porque 0063 as cria antes de converter.

Medido no acervo de produção antes de escrever isto: zero keys com mais de 20
caracteres, zero etapas órfãs, zero projeto com key repetida, e 10 cópias a
criar (code_review em 7 projetos, backlog em 2, documentacao em 1).
"""
import django.db.models.deletion
from django.db import migrations, models


def preencher_stage_key(apps, schema_editor):
    """Copia a key da etapa para a config, que é onde a constraint consegue vê-la."""
    Config = apps.get_model('projects', 'ProjectKanbanStageConfig')
    for cfg in Config.objects.select_related('stage').iterator():
        if not cfg.stage_key:
            cfg.stage_key = cfg.stage.key
            cfg.save(update_fields=['stage_key'])


def limpar_stage_key(apps, schema_editor):
    apps.get_model('projects', 'ProjectKanbanStageConfig').objects.update(stage_key='')





class Migration(migrations.Migration):

    dependencies = [
        ('projects', '0061_feedback_fase2'),
    ]

    operations = [
        migrations.AddField(
            model_name='kanbanstage',
            name='projeto',
            field=models.ForeignKey(
                blank=True,
                help_text='Vazio = etapa global do catálogo. Preenchido = coluna deste projeto.',
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name='etapas_proprias',
                to='projects.project',
                verbose_name='Projeto dono',
            ),
        ),
        migrations.AddField(
            model_name='projectkanbanstageconfig',
            name='stage_key',
            field=models.CharField(blank=True, max_length=50, verbose_name='Key da etapa'),
        ),
        migrations.AlterField(
            model_name='kanbanstage',
            name='key',
            field=models.CharField(max_length=50, verbose_name='Key (status)'),
        ),

        # Preenche ANTES da constraint que depende dele.
        migrations.RunPython(preencher_stage_key, limpar_stage_key),

    ]

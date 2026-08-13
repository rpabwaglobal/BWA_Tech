"""A quarta etapa do fluxo: "Feedback Finalizado" (`feedback_encerrado`).

Duas operações, e elas resolvem coisas diferentes:

  1. AlterField em `estado` — só as CHOICES. Nenhuma coluna muda de tipo e
     nenhuma linha é reescrita: `max_length` continua 20 e a key nova tem 18
     caracteres (é por isso que ela não é 'feedback_finalizado', com 19, nem
     'finalizado', que já pertence à etapa terminal dos projetos comuns — ver o
     comentário de `EstadoPedido.ENCERRADO`).

  2. RunPython — cria a `KanbanStage` e a amarra SÓ ao projeto de monitoramento.

>>> ESTA MIGRATION É GÊMEA DE `etapas_monitoramento()` EM `estrutura.py`. <<<
Mesma regra do gêmeo anterior (0003): migration é retrato congelado e não importa
código de app, então a lista está escrita aqui de novo, com `apps.get_model`. A
diferença em relação à 0003 é que aqui NÃO existe o caminho "pular por falta de
supervisor": esta migration não cria sprint nem projeto — ela só ACRESCENTA uma
coluna à estrutura que já existe. Se a estrutura ainda não existe (banco novo,
onde a 0003 pulou), não há nada a acrescentar e a auto-cura de
`garantir_estrutura_monitoramento` cria as QUATRO etapas de uma vez na primeira
entrega.

NENHUMA LINHA DE PEDIDO É TOCADA. Nenhum pedido nasce encerrado e nenhum é
migrado para o estado novo: quem encerra é uma pessoa, arrastando o card.
"""
from django.db import migrations, models

KEY = 'feedback_encerrado'
LABEL = 'Feedback Finalizado'
# Depois de 'respondido' (order 2), porque é o fim da linha do fluxo.
ORDEM = 3


def semear(apps, schema_editor):
    Sprint = apps.get_model('projects', 'Sprint')
    Project = apps.get_model('projects', 'Project')
    KanbanStage = apps.get_model('projects', 'KanbanStage')
    ProjectKanbanStageConfig = apps.get_model('projects', 'ProjectKanbanStageConfig')

    stage, criada = KanbanStage.objects.get_or_create(
        key=KEY,
        defaults={
            'label': LABEL,
            # Terminal como 'respondido': é rótulo de leitura do board, não trava
            # de movimento (quem trava é `Card.status` em `_card_edicao_restrita`,
            # e 'feedback_encerrado' não está lá de propósito — o requisito é
            # justamente poder arrastar o card de volta).
            'is_terminal': True,
            'requires_required_data': False,
            # Fora do seletor "adicionar coluna" dos projetos comuns.
            'oculta_no_catalogo': True,
        },
    )
    if not criada and not stage.oculta_no_catalogo:
        KanbanStage.objects.filter(pk=stage.pk).update(oculta_no_catalogo=True)

    # A identidade do projeto é "o único projeto da sprint sistêmica", NUNCA o
    # nome — mesma regra da 0003. Sem estrutura, nada a configurar.
    sprint = Sprint.objects.filter(is_system=True).order_by('id').first()
    if sprint is None:
        return
    projeto = Project.objects.filter(sprint_id=sprint.id).order_by('id').first()
    if projeto is None:
        return

    # SÓ NESTE PROJETO: é este recorte — e não a existência da etapa — que decide
    # quais colunas um board desenha.
    ProjectKanbanStageConfig.objects.update_or_create(
        project_id=projeto.id, stage_id=stage.id, defaults={'order': ORDEM},
    )


def remover(apps, schema_editor):
    """Reversão conservadora: só apaga a etapa se ela não estiver em uso.

    "Em uso" aqui é ter card parado nela — apagar a etapa com card dentro
    deixaria o board sem a coluna e os cards invisíveis. A config do projeto sai
    junto com a etapa (FK em cascata); se houver card, nada é removido e a
    reversão é um no-op deliberado.
    """
    Card = apps.get_model('projects', 'Card')
    KanbanStage = apps.get_model('projects', 'KanbanStage')

    if Card.objects.filter(status=KEY).exists():
        return
    KanbanStage.objects.filter(key=KEY).delete()


class Migration(migrations.Migration):

    dependencies = [
        ('feedbacks', '0008_respostas_multiplas'),
        # `KanbanStage.oculta_no_catalogo` precisa existir — é o mesmo pré-requisito
        # que a 0003 declara para o seed original das 3 etapas.
        ('projects', '0061_feedback_fase2'),
    ]

    operations = [
        migrations.AlterField(
            model_name='pedidofeedback',
            name='estado',
            field=models.CharField(
                choices=[
                    ('aguardando_prazo', 'Aguardando 30 dias'),
                    ('aguardando_resposta', 'Aguardando Feedback'),
                    ('respondido', 'Feedback colhido'),
                    ('feedback_encerrado', 'Feedback Finalizado'),
                ],
                db_index=True,
                default='aguardando_prazo',
                max_length=20,
            ),
        ),
        migrations.RunPython(semear, remover),
    ]

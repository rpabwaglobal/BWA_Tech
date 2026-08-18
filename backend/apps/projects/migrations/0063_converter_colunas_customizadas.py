"""
Segunda metade de 0062: as constraints e a conversão dos dados.

A separação não é organizacional. O Postgres recusa criar índice numa tabela com
"pending trigger events" da mesma transação, e o backfill de `stage_key` da 0062
gera exatamente isso — a migração unificada morria em
`cannot CREATE INDEX "projects_kanbanstage" because it has pending trigger
events`. Cada metade agora tem a sua transação.

AS CONSTRAINTS VÊM ANTES DA CONVERSÃO, de propósito: se a conversão gerar
duplicata, o erro sai no ato e a transação inteira volta, em vez de deixar dado
torto passar e reaparecer depois como coluna fantasma no quadro de alguém.
"""
from django.db import migrations, models


def _keys_reservadas(apps):
    """As chaves que continuam globais.

    As seis do ciclo de vida estão escritas pelo valor porque migração não pode
    importar `CardStatus` do código vivo — o enum de hoje pode não ser o de
    quando esta migração rodar num banco atrasado. As de fluxo interno saem de
    `oculta_no_catalogo`, e não de uma lista: é o mesmo motivo pelo qual o campo
    existe, não cravar conhecimento do app `feedbacks` dentro de `projects`.
    """
    Stage = apps.get_model('projects', 'KanbanStage')
    reservadas = {
        'a_desenvolver', 'em_desenvolvimento', 'parado_pendencias',
        'em_homologacao', 'finalizado', 'inviabilizado',
    }
    reservadas |= set(
        Stage.objects.filter(oculta_no_catalogo=True).values_list('key', flat=True)
    )
    return reservadas


def converter_customizadas(apps, schema_editor):
    """Cada etapa customizada vira uma cópia por projeto que a usa.

    `Card.status` NÃO é tocado: a cópia nasce com a MESMA key, então todo card
    continua exatamente na coluna onde estava. É isso que torna a conversão
    invisível para quem usa o sistema.
    """
    Stage = apps.get_model('projects', 'KanbanStage')
    Config = apps.get_model('projects', 'ProjectKanbanStageConfig')
    reservadas = _keys_reservadas(apps)

    # `projeto__isnull=True` também é a guarda de reentrância: numa segunda
    # passada as customizadas já têm dono e não entram no filtro.
    customizadas = Stage.objects.filter(projeto__isnull=True).exclude(key__in=reservadas)

    for etapa in list(customizadas):
        configs = list(Config.objects.filter(stage=etapa).select_related('project'))
        if not configs:
            # Customizada que nenhum projeto usa. Não há dono a quem entregá-la,
            # e deixá-la global bloquearia um projeto de criar a própria coluna
            # com esse nome — a key global é exclusiva.
            etapa.delete()
            continue

        for cfg in configs:
            copia = Stage.objects.create(
                key=etapa.key,
                label=etapa.label,
                is_terminal=etapa.is_terminal,
                requires_required_data=etapa.requires_required_data,
                oculta_no_catalogo=etapa.oculta_no_catalogo,
                projeto=cfg.project,
            )
            cfg.stage = copia
            cfg.stage_key = copia.key
            cfg.save(update_fields=['stage', 'stage_key'])

        # Só depois de todas as configs apontarem para as cópias: apagar antes
        # levaria as configs junto por CASCADE.
        etapa.delete()


def desconverter(apps, schema_editor):
    """Volta as etapas de projeto a uma global por key.

    Reversão de emergência, e não simétrica: rótulos editados de forma diferente
    em projetos diferentes convergem para um só, porque a forma global não
    comporta dois. Os cards continuam intactos — a key nunca muda.
    """
    Stage = apps.get_model('projects', 'KanbanStage')
    Config = apps.get_model('projects', 'ProjectKanbanStageConfig')

    for etapa in list(Stage.objects.filter(projeto__isnull=False)):
        global_, _ = Stage.objects.get_or_create(
            key=etapa.key,
            projeto=None,
            defaults={
                'label': etapa.label,
                'is_terminal': etapa.is_terminal,
                'requires_required_data': etapa.requires_required_data,
                'oculta_no_catalogo': etapa.oculta_no_catalogo,
            },
        )
        Config.objects.filter(stage=etapa).update(stage=global_, stage_key=global_.key)
        etapa.delete()


class Migration(migrations.Migration):

    dependencies = [
        ('projects', '0062_colunas_por_projeto'),
    ]

    operations = [
        migrations.AddConstraint(
            model_name='kanbanstage',
            constraint=models.UniqueConstraint(
                condition=models.Q(('projeto__isnull', True)),
                fields=('key',),
                name='kanbanstage_key_global_unica',
            ),
        ),
        migrations.AddConstraint(
            model_name='kanbanstage',
            constraint=models.UniqueConstraint(
                condition=models.Q(('projeto__isnull', False)),
                fields=('projeto', 'key'),
                name='kanbanstage_key_unica_por_projeto',
            ),
        ),
        migrations.AddConstraint(
            model_name='projectkanbanstageconfig',
            constraint=models.UniqueConstraint(
                fields=('project', 'stage_key'),
                name='config_key_unica_por_projeto',
            ),
        ),
        migrations.RunPython(converter_customizadas, desconverter),
    ]

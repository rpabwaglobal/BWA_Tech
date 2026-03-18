# Generated seed migration for KanbanStage / ProjectKanbanStageConfig

from django.db import migrations


def seed_kanban_stages(apps, schema_editor):
    Project = apps.get_model('projects', 'Project')
    KanbanStage = apps.get_model('projects', 'KanbanStage')
    ProjectKanbanStageConfig = apps.get_model('projects', 'ProjectKanbanStageConfig')

    stage_defs = [
        {'key': 'a_desenvolver', 'label': 'A Desenvolver', 'is_terminal': False, 'requires_required_data': False},
        {'key': 'em_desenvolvimento', 'label': 'Em Desenvolvimento', 'is_terminal': False, 'requires_required_data': True},
        {'key': 'parado_pendencias', 'label': 'Parado por Pendências', 'is_terminal': False, 'requires_required_data': True},
        {'key': 'em_homologacao', 'label': 'Em Homologação', 'is_terminal': False, 'requires_required_data': True},
        {'key': 'finalizado', 'label': 'Concluído', 'is_terminal': True, 'requires_required_data': True},
        {'key': 'inviabilizado', 'label': 'Inviabilizado', 'is_terminal': True, 'requires_required_data': False},
    ]

    order_keys = [d['key'] for d in stage_defs]
    stage_by_key = {}

    for d in stage_defs:
        stage, created = KanbanStage.objects.get_or_create(
            key=d['key'],
            defaults={
                'label': d['label'],
                'is_terminal': d['is_terminal'],
                'requires_required_data': d['requires_required_data'],
            },
        )
        # Atualizar se algo mudou em ambiente já migrado
        if not created:
            stage.label = d['label']
            stage.is_terminal = d['is_terminal']
            stage.requires_required_data = d['requires_required_data']
            stage.save(update_fields=['label', 'is_terminal', 'requires_required_data'])
        stage_by_key[d['key']] = stage

    # Inicializar config padrão em todos os projetos existentes
    projects = Project.objects.all().only('id')
    for project in projects:
        for idx, key in enumerate(order_keys):
            stage = stage_by_key[key]
            ProjectKanbanStageConfig.objects.update_or_create(
                project_id=project.id,
                stage_id=stage.id,
                defaults={'order': idx},
            )


class Migration(migrations.Migration):
    dependencies = [
        ('projects', '0027_kanban_stage_models'),
    ]

    operations = [
        migrations.RunPython(seed_kanban_stages, migrations.RunPython.noop),
    ]


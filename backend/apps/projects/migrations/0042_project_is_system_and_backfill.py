"""
Adiciona o campo `is_system` em Project e:
1. Marca como sistêmicos os projetos com nome em SYSTEM_NAMES (case-insensitive,
   normalizando acentos).
2. Faz backfill de `Card.finalizado_em = updated_at` para cards finalizados
   legados que ainda não têm `finalizado_em` preenchido.

Operações são idempotentes: rodar de novo não causa efeito colateral.
"""

import unicodedata

from django.db import migrations, models


SYSTEM_NAMES = {'suporte', 'sugestoes', 'projetos descartados'}


def _normalize(value: str) -> str:
    """lowercase + strip + sem acentos."""
    if not value:
        return ''
    s = value.strip().lower()
    s = unicodedata.normalize('NFD', s)
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn')
    return s


def mark_system_projects(apps, schema_editor):
    Project = apps.get_model('projects', 'Project')
    # Em vez de filtrar no SQL (acentos atrapalham), trazemos todos e
    # marcamos em Python. A tabela de projetos é pequena (<1000 linhas).
    for project in Project.objects.all().only('id', 'nome', 'is_system'):
        if _normalize(project.nome) in SYSTEM_NAMES:
            if not project.is_system:
                project.is_system = True
                project.save(update_fields=['is_system'])


def unmark_system_projects(apps, schema_editor):
    Project = apps.get_model('projects', 'Project')
    Project.objects.filter(is_system=True).update(is_system=False)


def backfill_finalizado_em(apps, schema_editor):
    """
    Para todo card com status='finalizado' e finalizado_em IS NULL,
    define finalizado_em = updated_at. Garante que métricas posteriores
    contabilizem corretamente entregas históricas.
    """
    Card = apps.get_model('projects', 'Card')
    # Update em bloco usando F() — uma única query.
    Card.objects.filter(status='finalizado', finalizado_em__isnull=True).update(
        finalizado_em=models.F('updated_at')
    )


def noop_backfill_finalizado_em(apps, schema_editor):
    """Backfill é irreversível na prática — não desfazer."""
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('projects', '0041_project_archive_fields'),
    ]

    operations = [
        migrations.AddField(
            model_name='project',
            name='is_system',
            field=models.BooleanField(
                default=False,
                db_index=True,
                help_text=(
                    'Projetos sistêmicos (Suporte, Sugestões, Projetos Descartados) '
                    'são excluídos de métricas e operações em massa.'
                ),
                verbose_name='Projeto Sistêmico',
            ),
        ),
        migrations.RunPython(mark_system_projects, unmark_system_projects),
        migrations.RunPython(backfill_finalizado_em, noop_backfill_finalizado_em),
    ]

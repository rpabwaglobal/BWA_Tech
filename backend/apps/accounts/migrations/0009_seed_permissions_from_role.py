"""Placeholder histórico: as permissões não são mais distribuídas por role.

Esta migration replicava, em `user_permissions`, o que cada role legado
(admin/supervisor/gerente/...) podia fazer. Com o catálogo inicial reduzido a
Admin + Visitante, distribuir permissão por role legado deixou de fazer
sentido: quem define quem pode o quê é o admin, na mão.

A regra atual vive em `0013_reconcile_system_cargos_and_seed`: superuser
recebe o catálogo inteiro, todo o resto vai para Visitante sem permissão.

Mantida como no-op (em vez de removida) porque outras migrations dependem
dela pelo nome.
"""
from django.db import migrations


def noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0008_add_setor_and_permission_catalog'),
    ]

    operations = [
        migrations.RunPython(noop, noop),
    ]

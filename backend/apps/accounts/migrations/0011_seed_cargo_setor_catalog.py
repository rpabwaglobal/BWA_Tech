"""Placeholder histórico: o catálogo inicial NÃO é semeado aqui.

Esta migration semeava 6 cargos (admin, supervisor, gerente, desenvolvedor,
dados, processos) e 8 setores (fiscal, contábil, marketing, legalização,
pessoal, diretoria, novos negócios, RH). A decisão passou a ser outra: o
sistema nasce com catálogo mínimo e o resto é criado manualmente pelo admin.

- Cargos iniciais (admin + visitante): `0013_reconcile_system_cargos_and_seed`.
- Setor inicial ("Sem Setor"): `0016_seed_setor_padrao`.

Mantida como no-op (em vez de removida) porque outras migrations dependem
dela pelo nome — apagá-la quebraria o grafo em qualquer banco já migrado.
"""
from django.db import migrations


def noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0010_cargo_setorcatalogo_alter_user_role_alter_user_setor'),
    ]

    operations = [
        migrations.RunPython(noop, noop),
    ]

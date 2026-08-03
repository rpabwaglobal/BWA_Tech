"""Ressincroniza a sequência de ids de `GeekDayGrupo`.

Enquanto o model era singleton, a única linha entrava por
`get_or_create(pk=1)` — um INSERT com id EXPLÍCITO, que no Postgres não avança
a identity da coluna. A sequência ficou em 1 e ninguém notou, porque nunca se
criava um segundo registro.

Agora o model é o grupo e novas linhas nascem sozinhas (`grupo_do_setor` cria o
grupo do setor no primeiro acesso). Sem este ajuste, o PRIMEIRO grupo novo
tentaria nascer com id=1 e estouraria "duplicate key value violates unique
constraint" — reproduzido neste banco antes de existir esta migração.

`sequence_reset_sql` é a forma portável de fazer isso (no SQLite vira lista
vazia, e lá o problema não existe).
"""
from django.core.management.color import no_style
from django.db import migrations


def sincroniza_sequencia(apps, schema_editor):
    GeekDayGrupo = apps.get_model('geekday', 'GeekDayGrupo')
    connection = schema_editor.connection
    comandos = connection.ops.sequence_reset_sql(no_style(), [GeekDayGrupo])
    if not comandos:
        return
    with connection.cursor() as cursor:
        for sql in comandos:
            cursor.execute(sql)


class Migration(migrations.Migration):

    dependencies = [
        ('geekday', '0007_geekdaydraw_grupo_obrigatorio'),
    ]

    operations = [
        # Reverso é noop: uma sequência correta não atrapalha o estado antigo.
        migrations.RunPython(sincroniza_sequencia, migrations.RunPython.noop),
    ]

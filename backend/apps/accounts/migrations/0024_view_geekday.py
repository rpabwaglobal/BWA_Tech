"""Dá `view_geekday` a quem já enxergava o Geek Day.

Até aqui, ver o Geek Day exigia `view_metrics` — permissão de dados
consolidados da empresa, larga demais para uma brincadeira interna. Agora
existe `view_geekday`, e sem esta migration todo cargo que via a tela pela
`view_metrics` a perderia no instante do deploy.

Recebe todo cargo cujo template já tem `view_metrics` OU `manage_geekday`.
O segundo caso é defensivo: o gate de leitura aceita as duas
(`HasQualquerPerm`), então quem organiza já entra de qualquer forma — mas ter
a permissão explícita no template faz a tela de permissões contar a verdade
sobre o que aquele cargo concede.

`visitante` e `admin` ficam de fora pelas razões de sempre: o primeiro é o
cargo de quem ainda não foi liberado, o segundo já recebe o catálogo inteiro
pelo `AdminRolePermissionBackend`.
"""
from django.db import migrations

NOVA = 'view_geekday'
GATILHOS = ('view_metrics', 'manage_geekday')
VISITANTE = 'visitante'
ADMIN = 'admin'


def conceder(apps, schema_editor):
    Cargo = apps.get_model('accounts', 'Cargo')
    for cargo in Cargo.objects.all():
        if cargo.codename in (VISITANTE, ADMIN):
            continue
        atuais = list(cargo.permissoes_padrao or [])
        if NOVA in atuais or not any(g in atuais for g in GATILHOS):
            continue
        cargo.permissoes_padrao = atuais + [NOVA]
        cargo.save(update_fields=['permissoes_padrao'])


def revogar(apps, schema_editor):
    Cargo = apps.get_model('accounts', 'Cargo')
    for cargo in Cargo.objects.all():
        atuais = list(cargo.permissoes_padrao or [])
        if NOVA in atuais:
            cargo.permissoes_padrao = [p for p in atuais if p != NOVA]
            cargo.save(update_fields=['permissoes_padrao'])


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0023_alter_permissaoplataforma_options'),
    ]

    operations = [
        migrations.RunPython(conceder, revogar),
    ]

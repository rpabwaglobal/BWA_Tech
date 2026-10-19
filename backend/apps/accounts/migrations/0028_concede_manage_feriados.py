"""Dá `manage_feriados` a quem já administra setores.

A permissão nasce com a tela de Feriados em Configurações. Sem esta migration,
no instante do deploy a aba apareceria com um botão de cadastrar que ninguém —
fora quem tem papel `admin` — teria direito de usar, e alguém teria de sair
editando cargo por cargo à mão.

QUEM RECEBE: todo `Cargo` cujo template já tem `manage_setores`. É a mesma área
do catálogo ('Administração') e a mesma natureza de trabalho — manter listas que
o sistema inteiro consulta. Continua sendo só um PONTO DE PARTIDA: as duas
permissões são independentes, e quem quiser tirar esta de um cargo é só
desmarcar na tela de cargos.

`visitante` e `admin` ficam de fora pelas razões de sempre: o primeiro é o cargo
de quem ainda não foi liberado, o segundo já recebe o catálogo inteiro pelo
`AdminRolePermissionBackend`.

NÃO alcança concessões INDIVIDUAIS: quem tem `manage_setores` por
`user_permissions`, e não pelo cargo, não ganha esta aqui. Copiar concessão
individual seria decidir, em nome de quem administra, sobre uma exceção que
alguém abriu à mão para UMA pessoa e para UM fim.

O QUE ESTA PERMISSÃO NÃO DÁ: mexer nos feriados NACIONAIS. Eles são calculados
em `apps/projects/feriados.py` e não existem como linha no banco — não há o que
editar, e o serializer recusa cadastrar um dia que já é nacional.
"""
from django.db import migrations

NOVA = 'manage_feriados'
GATILHO = 'manage_setores'
VISITANTE = 'visitante'
ADMIN = 'admin'


def conceder(apps, schema_editor):
    Cargo = apps.get_model('accounts', 'Cargo')
    for cargo in Cargo.objects.all():
        if cargo.codename in (VISITANTE, ADMIN):
            continue
        atuais = list(cargo.permissoes_padrao or [])
        if NOVA in atuais or GATILHO not in atuais:
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
        ('accounts', '0027_permissao_manage_feriados'),
    ]

    operations = [
        migrations.RunPython(conceder, revogar),
    ]

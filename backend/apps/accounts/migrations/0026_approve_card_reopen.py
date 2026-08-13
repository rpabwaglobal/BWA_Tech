"""Dá `approve_card_reopen` a quem já avalia solicitações de prazo.

A permissão nasce com o fluxo de REABERTURA DE CARD. Ela é separada de
`approve_due_date_requests` de propósito — mudar prazo e ressuscitar trabalho
encerrado são decisões diferentes, e o dono precisa poder delegar uma sem a
outra. Mas separada e VAZIA são coisas distintas: sem esta migration, no
instante do deploy a nova aba de "Reabertura de cards" nasceria com uma fila que
ninguém no sistema teria direito de aprovar, e alguém teria de sair editando
cargo por cargo à mão para destravar.

Quem recebe: todo `Cargo` cujo template já tem `approve_due_date_requests` — é
o mesmo conjunto de pessoas que hoje decide sobre o prazo dos cards do time, e a
reabertura chega à mesma mesa. Continua sendo só um PONTO DE PARTIDA: como as
duas permissões são independentes, quem quiser tirar a de reabertura de um cargo
depois é só desmarcar na tela de cargos.

`visitante` e `admin` ficam de fora pelas razões de sempre: o primeiro é o cargo
de quem ainda não foi liberado (e nem teria o gatilho), o segundo já recebe o
catálogo inteiro pelo `AdminRolePermissionBackend`.

NÃO alcança concessões INDIVIDUAIS: quem tem `approve_due_date_requests` por
`user_permissions` (e não pelo cargo) não ganha a de reabertura aqui. Copiar
concessão individual seria decidir, em nome de quem administra, sobre uma
exceção que alguém abriu à mão para UMA pessoa e para UM fim.
"""
from django.db import migrations

NOVA = 'approve_card_reopen'
GATILHO = 'approve_due_date_requests'
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
        ('accounts', '0025_alter_permissaoplataforma_options'),
    ]

    operations = [
        migrations.RunPython(conceder, revogar),
    ]

"""Dá `view_content` a todo cargo que não seja o Visitante.

A permissão nasce nesta onda como PISO DE LEITURA: sem ela, `PodeVerConteudo`
recusa sprints, projetos e cards. Antes dela, ler exigia apenas estar
autenticado — então, no instante em que o código novo sobe, TODO MUNDO perderia
o acervo de vista se ninguém preenchesse os templates. Esta migration é o que
evita isso, e por isso depende da 0021, que é quem cria a linha da permissão.

Quem recebe:
  - todo `Cargo` que não seja `visitante` nem `admin`. Como
    `CargoPermissionBackend` concede o template em tempo de `has_perm`, isso
    alcança de uma vez todos os portadores, sem tocar em `user_permissions`.
  - quem tem `role` que não corresponde a Cargo nenhum (dado legado): recebe a
    permissão INDIVIDUAL, porque não há template de onde herdar e a conta
    ficaria sem acesso sem que ninguém entendesse por quê.

Quem NÃO recebe, de propósito:
  - `visitante`, que é justamente o cargo de quem ainda não foi liberado;
  - `admin`, que não precisa — `AdminRolePermissionBackend` concede o catálogo
    inteiro a ele, e incluir na lista criaria duas fontes para a mesma coisa.
"""
from django.db import migrations

PERMISSAO = 'view_content'
VISITANTE = 'visitante'
ADMIN = 'admin'


def conceder(apps, schema_editor):
    Cargo = apps.get_model('accounts', 'Cargo')
    User = apps.get_model('accounts', 'User')
    Permission = apps.get_model('auth', 'Permission')

    conhecidos = set()
    for cargo in Cargo.objects.all():
        conhecidos.add(cargo.codename)
        if cargo.codename in (VISITANTE, ADMIN):
            continue
        atuais = list(cargo.permissoes_padrao or [])
        if PERMISSAO not in atuais:
            cargo.permissoes_padrao = atuais + [PERMISSAO]
            cargo.save(update_fields=['permissoes_padrao'])

    perm = Permission.objects.filter(
        content_type__app_label='accounts', codename=PERMISSAO).first()
    if perm is None:
        return

    orfaos = (User.objects
              .exclude(role__in=conhecidos)
              .exclude(role=VISITANTE)
              .exclude(role=ADMIN)
              .exclude(role=''))
    for user in orfaos:
        user.user_permissions.add(perm)


def revogar(apps, schema_editor):
    Cargo = apps.get_model('accounts', 'Cargo')
    for cargo in Cargo.objects.all():
        atuais = list(cargo.permissoes_padrao or [])
        if PERMISSAO in atuais:
            cargo.permissoes_padrao = [p for p in atuais if p != PERMISSAO]
            cargo.save(update_fields=['permissoes_padrao'])


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0021_alter_permissaoplataforma_options'),
    ]

    operations = [
        migrations.RunPython(conceder, revogar),
    ]

"""Setor inicial do sistema: APENAS "Sem Setor".

Todo setor real (Tecnologia, Fiscal, Contábil, ...) é criado manualmente pelo
admin. Este aqui é o destino de tudo que ainda não foi classificado, e é o
fallback usado quando um usuário sem setor primário cria uma sprint.

`is_system=True` de propósito: a API força `is_system=False` em tudo que ela
cria, então só o seed consegue marcar. Sendo de sistema, o setor padrão não
pode ser excluído pela UI — o que é desejável, já que ele segura todo o
conteúdo ainda não classificado e as FKs são PROTECT.

Também vincula os usuários existentes (UserSetor + CharField), senão eles
ficariam sem setor primário e cairiam no fail-closed do scoping.
"""
from django.db import migrations

SETOR_PADRAO_CODENAME = 'sem_setor'
SETOR_PADRAO_NOME = 'Sem Setor'


def forwards(apps, schema_editor):
    SetorCatalogo = apps.get_model('accounts', 'SetorCatalogo')
    UserSetor = apps.get_model('accounts', 'UserSetor')
    User = apps.get_model('accounts', 'User')

    setor, _ = SetorCatalogo.objects.update_or_create(
        codename=SETOR_PADRAO_CODENAME,
        defaults={
            'nome': SETOR_PADRAO_NOME,
            'is_system': True,
            'cor': '#94a3b8',
            'descricao': 'Destino do conteúdo ainda não classificado em um setor.',
        },
    )

    # Todo usuário precisa de vínculo: o M2M é a autoridade do escopo, e sem
    # ele o usuário não enxerga nada com a segmentação ligada.
    for u in User.objects.all():
        UserSetor.objects.get_or_create(
            user=u, setor=setor, defaults={'is_primary': True},
        )
        if not u.setor:
            u.setor = setor.codename
            u.save(update_fields=['setor'])

    # Remove os setores do seed antigo. Seguro nesta ordem: nada aponta para
    # eles ainda (projects/0053 é quem faz o backfill do conteúdo) e os
    # vínculos de usuário acabaram de ser recriados no setor padrão.
    SetorCatalogo.objects.exclude(codename=SETOR_PADRAO_CODENAME).delete()


def backwards(apps, schema_editor):
    # Não remove: a essa altura já há conteúdo e vínculos apontando para o
    # setor padrão, e as FKs são PROTECT.
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0015_usersetor_user_setores'),
    ]

    operations = [
        migrations.RunPython(forwards, backwards),
    ]

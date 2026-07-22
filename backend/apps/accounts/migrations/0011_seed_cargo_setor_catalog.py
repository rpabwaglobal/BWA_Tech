from django.db import migrations

SYSTEM_CARGOS = [
    ('admin', 'Admin'),
    ('supervisor', 'Supervisor'),
    ('gerente', 'Gerente de Projetos'),
    ('desenvolvedor', 'Desenvolvedor'),
    ('dados', 'Dados'),
    ('processos', 'Processos'),
]

SYSTEM_SETORES = [
    ('fiscal', 'Fiscal'),
    ('contabil', 'Contábil'),
    ('marketing', 'Marketing'),
    ('legalizacao', 'Legalização'),
    ('pessoal', 'Pessoal'),
    ('diretoria', 'Diretoria'),
    ('novos_negocios', 'Novos Negócios'),
    ('rh', 'RH'),
]


def seed_catalog(apps, schema_editor):
    Cargo = apps.get_model('accounts', 'Cargo')
    SetorCatalogo = apps.get_model('accounts', 'SetorCatalogo')

    for codename, nome in SYSTEM_CARGOS:
        Cargo.objects.get_or_create(codename=codename, defaults={'nome': nome, 'is_system': True})

    for codename, nome in SYSTEM_SETORES:
        SetorCatalogo.objects.get_or_create(codename=codename, defaults={'nome': nome, 'is_system': True})


def unseed_catalog(apps, schema_editor):
    Cargo = apps.get_model('accounts', 'Cargo')
    SetorCatalogo = apps.get_model('accounts', 'SetorCatalogo')
    Cargo.objects.filter(codename__in=[c for c, _ in SYSTEM_CARGOS], is_system=True).delete()
    SetorCatalogo.objects.filter(codename__in=[c for c, _ in SYSTEM_SETORES], is_system=True).delete()


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0010_cargo_setorcatalogo_alter_user_role_alter_user_setor'),
    ]

    operations = [
        migrations.RunPython(seed_catalog, unseed_catalog),
    ]

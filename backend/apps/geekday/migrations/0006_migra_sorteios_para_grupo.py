"""Leva o Geek Day da empresa inteira para o primeiro GRUPO, sem perder sorteio.

O antigo `GeekDayConfig` pk=1 (agora `GeekDayGrupo`) passa a se chamar
"Geek Day", recebe o setor padrão do sistema e adota TODOS os sorteios já
registrados. É a leitura fiel do que aquelas linhas significavam: até aqui
existia um único ritual, e ele era do setor em que todo mundo estava.
"""
from django.db import migrations


def _setor_padrao(SetorCatalogo):
    """Mesma regra de `apps.accounts.scoping.setor_padrao_do_sistema`
    ('sem_setor', senão o primeiro do catálogo), porém executada sobre o model
    HISTÓRICO desta migração.

    Chamar a função de runtime aqui faria a migração fazer SELECT em todas as
    colunas que `SetorCatalogo` tiver NO FUTURO — numa base criada do zero, em
    que uma migração posterior de accounts ainda não rodou, isso quebraria com
    "column does not exist". O codename vem do módulo de escopo para as duas
    definições não divergirem.
    """
    from apps.accounts.scoping import SETOR_PADRAO_CODENAME

    return (SetorCatalogo.objects.filter(codename=SETOR_PADRAO_CODENAME).first()
            or SetorCatalogo.objects.order_by('id').first())


def migra_para_grupo(apps, schema_editor):
    GeekDayGrupo = apps.get_model('geekday', 'GeekDayGrupo')
    GeekDayGrupoSetor = apps.get_model('geekday', 'GeekDayGrupoSetor')
    GeekDayDraw = apps.get_model('geekday', 'GeekDayDraw')
    SetorCatalogo = apps.get_model('accounts', 'SetorCatalogo')

    sorteios_orfaos = GeekDayDraw.objects.filter(grupo__isnull=True)

    # A linha do singleton, se existir (só é criada no primeiro get_config()).
    grupo = GeekDayGrupo.objects.order_by('id').first()
    if grupo is None:
        if not sorteios_orfaos.exists():
            return  # base sem Geek Day nenhum: nada a migrar
        grupo = GeekDayGrupo.objects.create(nome='Geek Day', current_cycle=1)
    if not (grupo.nome or '').strip():
        grupo.nome = 'Geek Day'
        grupo.save(update_fields=['nome'])

    setor = _setor_padrao(SetorCatalogo)
    if setor is not None and not GeekDayGrupoSetor.objects.filter(setor_id=setor.pk).exists():
        GeekDayGrupoSetor.objects.create(grupo=grupo, setor_id=setor.pk)

    # `update` em massa: são sorteios históricos, sem save() a disparar.
    sorteios_orfaos.update(grupo=grupo)


class Migration(migrations.Migration):

    dependencies = [
        ('geekday', '0005_geekdaygrupo'),
    ]

    operations = [
        # Sem reverse: desfazer significaria decidir de quem é cada sorteio, e
        # a resposta é a própria coluna que estaríamos apagando. O rollback
        # possível é o de 0007 (coluna volta a aceitar NULL) + 0005.
        migrations.RunPython(migra_para_grupo, migrations.RunPython.noop),
    ]

"""Renomeia o fluxo para "Monitoramento de Feedbacks" (F maiúsculo).

POR QUE PRECISA DE MIGRATION, e não bastou trocar a constante em `estrutura.py`:
o seed (0003) e o `garantir_estrutura_monitoramento` criam projeto e sprint com
`get_or_create`, e o nome vive nos `defaults` — que só se aplicam na CRIAÇÃO.
Num banco onde a estrutura já existe, mudar a constante não renomeia nada; o
nome antigo ficaria na tela para sempre.

POR QUE NÃO EDITEI A 0003: migration já aplicada é história — o Django não a
reexecuta, e reescrevê-la deixaria os bancos existentes divergindo do código.

A IDENTIFICAÇÃO É PELO PAR DE FLAGS (`is_system` no projeto E na sprint), nunca
pelo nome antigo: é o mesmo critério do `_projeto_do_fluxo_de_feedback` e do
`isProjetoMonitoramento`. Casar pelo nome falharia justamente num banco onde
alguém já tivesse renomeado à mão — que é o caso que esta migration existe para
resolver.

Reversível: volta ao nome anterior. Nada além do rótulo muda — nenhuma FK,
nenhum id, nenhuma referência depende desta string.
"""
from django.db import migrations

NOME_NOVO = 'Monitoramento de Feedbacks'
NOME_ANTIGO = 'Monitoramento de feedbacks'


def _renomear(apps, para):
    Project = apps.get_model('projects', 'Project')
    Sprint = apps.get_model('projects', 'Sprint')

    projetos = Project.objects.filter(is_system=True, sprint__is_system=True)
    sprints = Sprint.objects.filter(
        is_system=True, pk__in=projetos.values_list('sprint_id', flat=True),
    )
    # `.update()` de propósito: não dispara `save()`, então não republica a task
    # de fechamento da sprint sistêmica nem mexe em `updated_at` de nada mais.
    return sprints.update(nome=para), projetos.update(nome=para)


def para_maiusculo(apps, schema_editor):
    _renomear(apps, NOME_NOVO)


def para_minusculo(apps, schema_editor):
    _renomear(apps, NOME_ANTIGO)


class Migration(migrations.Migration):

    dependencies = [
        ('feedbacks', '0005_seed_formulario_v2'),
        ('projects', '0061_feedback_fase2'),
    ]

    operations = [
        migrations.RunPython(para_maiusculo, para_minusculo),
    ]

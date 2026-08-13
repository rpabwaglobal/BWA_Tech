"""
Semeia o formulário de exemplo: UM campo de texto, só para o usuário validar.

Esta migration é a DEMONSTRAÇÃO de que trocar o formulário não exige migration
de schema. O caminho é uma data migration nova que:

    1. desativa a linha atual  -> FeedbackFormulario.objects.filter(slug='padrao', ativo=True).update(ativo=False)
    2. cria a versão seguinte  -> mesmo slug, versao=2, campos novos, ativo=True

JÁ FOI EXECUTADO: o formulário definitivo é a `0005_seed_formulario_v2`, que
segue este procedimento à risca. Leia-a como exemplo real antes de escrever a
versão 3.

Nunca EDITAR a linha antiga: as respostas já gravadas precisam continuar
legíveis contra a definição que a pessoa de fato viu na tela. A constraint
parcial `uniq_formulario_ativo_por_slug` garante que os dois passos aconteçam
juntos — o banco recusa duas versões ativas do mesmo slug.

TÍTULO E LABEL SÃO PROVISÓRIOS: o texto exato ainda é decisão do usuário.
Trocá-los é exatamente o procedimento de 2 passos acima.
"""
from django.db import migrations

SLUG = 'padrao'
VERSAO = 1
TITULO = 'Sua opinião sobre o projeto entregue'
CAMPOS = [
    {
        'key': 'comentario',
        'label': 'Conte como foi sua experiência com o projeto entregue.',
        'tipo': 'texto_longo',
        'obrigatorio': True,
        'max_length': 2000,
    },
]


def semear(apps, schema_editor):
    FeedbackFormulario = apps.get_model('feedbacks', 'FeedbackFormulario')
    # get_or_create pela chave única (slug, versao): rodar a migration duas
    # vezes (ou num banco que já a recebeu por outro caminho) não duplica nem
    # sobrescreve uma edição feita pelo admin.
    FeedbackFormulario.objects.get_or_create(
        slug=SLUG,
        versao=VERSAO,
        defaults={'titulo': TITULO, 'campos': CAMPOS, 'ativo': True},
    )


def remover(apps, schema_editor):
    FeedbackFormulario = apps.get_model('feedbacks', 'FeedbackFormulario')
    # Só remove se ninguém apontar para ela: a FK do pedido é PROTECT, e apagar
    # a definição tornaria as respostas gravadas ilegíveis.
    FeedbackFormulario.objects.filter(
        slug=SLUG, versao=VERSAO, pedidos__isnull=True,
    ).delete()


class Migration(migrations.Migration):

    dependencies = [
        ('feedbacks', '0001_initial'),
    ]

    operations = [
        migrations.RunPython(semear, remover),
    ]

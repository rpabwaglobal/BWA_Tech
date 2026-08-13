"""
Versão 3 do formulário: acrescenta "Seu setor:" na Identificação.

MESMO PROCEDIMENTO DE 2 PASSOS da 0002/0005, e pelos mesmos motivos:
    1. desativar a versão atual  (UPDATE, statement SEPARADO e ANTERIOR)
    2. criar a versão seguinte   (mesmo slug, versao+1, ativo=True)

`uniq_formulario_ativo_por_slug` é UniqueConstraint PARCIAL e NÃO DEFERRABLE:
inverter a ordem é IntegrityError em produção, e passaria calado num teste que
semeasse na ordem certa por acaso.

A v2 NÃO É EDITADA — só perde o `ativo`. É isso que mantém as respostas já
gravadas legíveis contra a definição que a pessoa DE FATO viu na tela.

CONSEQUÊNCIA, a mesma da 0005 e que precisa ser dita de novo: pedidos JÁ
CRIADOS continuam apontando para a v2 e nunca mostrarão o campo de setor. A FK
do formulário é congelada nos `defaults` do `get_or_create` (services.py), e
`defaults` só vale na CRIAÇÃO. Para ver o campo novo é preciso um pedido NOVO.

A LISTA ABAIXO É LITERAL de propósito (migration é retrato congelado e não
importa código de app). Ela foi COPIADA da v2 com um único item inserido na
posição 1 — nada mais mudou.

TETO AGREGADO: a soma dos `max_length` passou de 8.245 para 8.365, contra
MAX_PAYLOAD_CHARS=20000. Folga de 2,4x, inalterada na prática.
"""
from django.db import migrations

SLUG = 'padrao'
VERSAO = 3

TITULO = 'Feedback de Entrega de Projeto - BWA'
SUBTITULO = (
    'Olá! Queremos melhorar continuamente nossos projetos. '
    'Seu feedback é essencial e leva menos de 2 minutos'
)

CAMPOS = [   {   'key': 'respondente',
        'label': 'Seu nome:',
        'tipo': 'texto',
        'obrigatorio': False,
        'max_length': 120,
        'secao': '1. Identificação'},
    {   'key': 'setor_respondente',
        'label': 'Seu setor:',
        'tipo': 'texto',
        'obrigatorio': False,
        'max_length': 120,
        'secao': '1. Identificação'},
    {   'key': 'atendeu_objetivo',
        'label': 'O projeto atendeu ao objetivo esperado?',
        'tipo': 'escolha_unica',
        'obrigatorio': True,
        'opcoes': ['Sim', 'Parcialmente', 'Não'],
        'max_length': 60,
        'secao': '2. Avaliação Geral'},
    {   'key': 'indicaria_time',
        'label': 'De 0 a 10, o quanto você indicaria esse time para novos projetos?',
        'tipo': 'escala',
        'obrigatorio': True,
        'minimo': 0,
        'maximo': 10,
        'max_length': 2,
        'secao': '2. Avaliação Geral'},
    {   'key': 'qualidade_entrega',
        'label': 'Como você avalia a qualidade da entrega?',
        'tipo': 'escala',
        'obrigatorio': True,
        'minimo': 1,
        'maximo': 5,
        'rotulos': {   '1': 'Péssimo',
                       '2': 'Ruim',
                       '3': 'Bom',
                       '4': 'Ótimo',
                       '5': 'Excelente'},
        'max_length': 1,
        'secao': '3. Qualidade da Entrega'},
    {   'key': 'o_que_agradou',
        'label': 'O que mais te agradou na entrega?',
        'tipo': 'texto_longo',
        'obrigatorio': False,
        'max_length': 2000,
        'secao': '3. Qualidade da Entrega'},
    {   'key': 'comunicacao_clara',
        'label': 'A comunicação durante o projeto foi clara?',
        'tipo': 'escala',
        'obrigatorio': True,
        'minimo': 1,
        'maximo': 5,
        'max_length': 1,
        'secao': '4. Comunicação e Processo'},
    {   'key': 'prazo_adequado',
        'label': 'O prazo de entrega foi adequado?',
        'tipo': 'escala',
        'obrigatorio': True,
        'minimo': 1,
        'maximo': 5,
        'max_length': 1,
        'secao': '4. Comunicação e Processo'},
    {   'key': 'o_que_melhorar',
        'label': 'O que poderia ser melhor neste projeto?',
        'tipo': 'texto_longo',
        'obrigatorio': False,
        'max_length': 2000,
        'secao': '5. Melhorias'},
    {   'key': 'faria_diferente',
        'label': 'Se você fosse o responsável por esse projeto, o que faria diferente?',
        'tipo': 'texto_longo',
        'obrigatorio': False,
        'max_length': 2000,
        'secao': '5. Melhorias'},
    {   'key': 'status_final',
        'label': 'Considerando sua necessidade, o projeto está:',
        'tipo': 'escolha_unica',
        'obrigatorio': True,
        'opcoes': [   'Pronto para uso',
                      'Precisa de pequenos ajustes',
                      'Precisa de melhorias relevantes'],
        'max_length': 60,
        'secao': '6. Status Final'},
    {   'key': 'ajustes_necessarios',
        'label': 'Se precisar de ajustes, descreva quais:',
        'tipo': 'texto_longo',
        'obrigatorio': False,
        'max_length': 2000,
        'secao': '6. Status Final'}]


def semear(apps, schema_editor):
    FeedbackFormulario = apps.get_model('feedbacks', 'FeedbackFormulario')

    # PASSO 1 — statement SEPARADO e ANTERIOR (ver cabeçalho).
    FeedbackFormulario.objects.filter(slug=SLUG, ativo=True).update(ativo=False)

    # PASSO 2 — LINHA NOVA. `update_or_create` pela chave única (slug, versao):
    # rodar duas vezes não duplica nem deixa a versão nova inativa.
    FeedbackFormulario.objects.update_or_create(
        slug=SLUG,
        versao=VERSAO,
        defaults={
            'titulo': TITULO,
            'subtitulo': SUBTITULO,
            'campos': CAMPOS,
            'ativo': True,
        },
    )


def desfazer(apps, schema_editor):
    """Volta a ativa para a v2. A linha da v3 fica, inativa: apagá-la quebraria
    a FK PROTECT de qualquer pedido que já tenha nascido apontando para ela."""
    FeedbackFormulario = apps.get_model('feedbacks', 'FeedbackFormulario')
    FeedbackFormulario.objects.filter(slug=SLUG, versao=VERSAO).update(ativo=False)
    FeedbackFormulario.objects.filter(slug=SLUG, versao=2).update(ativo=True)


class Migration(migrations.Migration):

    dependencies = [
        ('feedbacks', '0006_renomear_monitoramento'),
    ]

    operations = [
        migrations.RunPython(semear, desfazer),
    ]

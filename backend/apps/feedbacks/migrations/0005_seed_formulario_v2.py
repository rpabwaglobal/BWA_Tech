"""
O FORMULÁRIO DEFINITIVO — versão 2, pelo PROCEDIMENTO DE 2 PASSOS da 0002.

Esta migration é a prova de que o desenho da fase 1 funcionou: onze perguntas,
seis seções e dois tipos de campo novos entram no sistema SEM UMA LINHA de
schema. É RunPython puro.

O PROCEDIMENTO, e por que a ORDEM dentro de `semear` é obrigatória:

    1. desativar a versão atual  (UPDATE, statement separado e ANTERIOR)
    2. criar a versão seguinte   (mesmo slug, versao+1, ativo=True)

`uniq_formulario_ativo_por_slug` (models.py) é uma UniqueConstraint PARCIAL e
NÃO é DEFERRABLE: o Postgres a avalia no próprio statement. Um INSERT com
ativo=True antes do UPDATE levanta IntegrityError na migração de PRODUÇÃO — e
passaria calado em qualquer teste que semeasse na ordem certa por acaso.

A LINHA DA VERSÃO 1 NUNCA É EDITADA. Só o flag `ativo` muda. É isso que mantém
uma resposta gravada há meses legível contra a definição que a pessoa DE FATO
VIU na tela — e é a garantia inteira que o versionamento existe para dar.

>>> CONSEQUÊNCIA QUE PRECISA SER DITA EM VOZ ALTA: nenhum pedido JÁ CRIADO muda
    de versão. A FK do formulário é congelada nos `defaults` do `get_or_create`
    (services.py), e `defaults` só se aplica na CRIAÇÃO. Todo link já gerado —
    inclusive os que foram usados para testar — continuará mostrando o único
    campo `comentario` da versão 1, PARA SEMPRE. Só projetos levados a
    "Entregue" DEPOIS desta migration recebem o formulário novo. Para validar
    visualmente é preciso um card marcado NOVO, num projeto NOVO, entregue
    agora.

RETROCOMPATIBILIDADE: `campos` continua sendo uma LISTA PLANA. A seção é uma
chave OPCIONAL de cada item, não uma estrutura aninhada — a ordem da lista
continua sendo a única fonte da ordem da tela. A definição da versão 1 (um campo
`comentario`, sem `secao`) segue sendo uma definição válida e COMPLETA: nada
nela precisa ser migrado.

TETO AGREGADO: a soma dos `max_length` é 8.245 caracteres, contra
MAX_PAYLOAD_CHARS=20000. Folga de 2,4x. NÃO subir o `max_length` dos cinco
campos longos: 4000 cada levaria a soma a 18.245 e um respondente prolixo
tomaria o 400 genérico "Resposta muito longa." sem saber qual campo cortar.
"""
from django.db import migrations

SLUG = 'padrao'
VERSAO = 2

TITULO = 'Feedback de Entrega de Projeto - BWA'
SUBTITULO = (
    'Olá! Queremos melhorar continuamente nossos projetos. '
    'Seu feedback é essencial e leva menos de 2 minutos'
)

# SEÇÃO 1 — o campo 1.1 ("Nome do projeto:") NÃO ENTRA AQUI de propósito.
# Ele é EXIBIÇÃO, não resposta, e o motor já tem o lugar dele: a coluna
# `referencia_publica`, cópia congelada que a página pública já mostra. Zero
# campo novo, zero valor gravado.
#
# OBRIGATORIEDADE — 6 obrigatórias, e TODAS de um clique. A regra que gerou a
# lista: obrigatório só o que, faltando, torna a resposta inútil como métrica;
# e TODO campo de texto livre é opcional. Resultado: ZERO campo de digitação
# obrigatório, 6 cliques fecham o formulário — o que torna verdadeiro o próprio
# subtítulo ("leva menos de 2 minutos"). Texto livre obrigatório é o que faz a
# pessoa escrever '-' e abandonar, e um '-' gravado é pior que um campo vazio
# porque contamina a leitura.
CAMPOS = [
    # 1.2 — OPCIONAL, e não é só taxa de resposta: é dado pessoal, e o próprio
    # model declara o oposto como princípio ("nenhum deles identifica quem
    # respondeu"). O feedback já é identificado pelo card via token, então de
    # quem veio é conhecido do lado de negócio sem precisar do nome.
    {
        'key': 'respondente',
        'label': 'Seu nome:',
        'tipo': 'texto',
        'obrigatorio': False,
        'max_length': 120,
        'secao': '1. Identificação',
    },
    # 2.1 — a pergunta-âncora.
    {
        'key': 'atendeu_objetivo',
        'label': 'O projeto atendeu ao objetivo esperado?',
        'tipo': 'escolha_unica',
        'obrigatorio': True,
        'opcoes': ['Sim', 'Parcialmente', 'Não'],
        'max_length': 60,
        'secao': '2. Avaliação Geral',
    },
    # 2.2 — a única métrica comparável ENTRE projetos. Sem ela não há série
    # histórica, por isso é obrigatória.
    {
        'key': 'indicaria_time',
        'label': 'De 0 a 10, o quanto você indicaria esse time para novos projetos?',
        'tipo': 'escala',
        'obrigatorio': True,
        'minimo': 0,
        'maximo': 10,
        'max_length': 2,
        'secao': '2. Avaliação Geral',
    },
    # 3.1 — a única escala com rótulos: são os do formulário, palavra por palavra.
    {
        'key': 'qualidade_entrega',
        'label': 'Como você avalia a qualidade da entrega?',
        'tipo': 'escala',
        'obrigatorio': True,
        'minimo': 1,
        'maximo': 5,
        'rotulos': {'1': 'Péssimo', '2': 'Ruim', '3': 'Bom', '4': 'Ótimo', '5': 'Excelente'},
        'max_length': 1,
        'secao': '3. Qualidade da Entrega',
    },
    {
        'key': 'o_que_agradou',
        'label': 'O que mais te agradou na entrega?',
        'tipo': 'texto_longo',
        'obrigatorio': False,
        'max_length': 2000,
        'secao': '3. Qualidade da Entrega',
    },
    # 4.1 e 4.2 — escalas 1-5 SEM rótulos. O formulário não deu rótulos para
    # estas duas e não os inventamos: a pergunta já orienta que maior = melhor.
    {
        'key': 'comunicacao_clara',
        'label': 'A comunicação durante o projeto foi clara?',
        'tipo': 'escala',
        'obrigatorio': True,
        'minimo': 1,
        'maximo': 5,
        'max_length': 1,
        'secao': '4. Comunicação e Processo',
    },
    {
        'key': 'prazo_adequado',
        'label': 'O prazo de entrega foi adequado?',
        'tipo': 'escala',
        'obrigatorio': True,
        'minimo': 1,
        'maximo': 5,
        'max_length': 1,
        'secao': '4. Comunicação e Processo',
    },
    {
        'key': 'o_que_melhorar',
        'label': 'O que poderia ser melhor neste projeto?',
        'tipo': 'texto_longo',
        'obrigatorio': False,
        'max_length': 2000,
        'secao': '5. Melhorias',
    },
    {
        'key': 'faria_diferente',
        'label': 'Se você fosse o responsável por esse projeto, o que faria diferente?',
        'tipo': 'texto_longo',
        'obrigatorio': False,
        'max_length': 2000,
        'secao': '5. Melhorias',
    },
    # 6.1 — é o que FECHA o ciclo do card: diz se a entrega está encerrada.
    {
        'key': 'status_final',
        'label': 'Considerando sua necessidade, o projeto está:',
        'tipo': 'escolha_unica',
        'obrigatorio': True,
        'opcoes': [
            'Pronto para uso',
            'Precisa de pequenos ajustes',
            'Precisa de melhorias relevantes',
        ],
        'max_length': 60,
        'secao': '6. Status Final',
    },
    # 6.2 — OPCIONAL POR CONSTRUÇÃO: o enunciado já é condicional ("SE precisar
    # de ajustes"). Obrigatório aqui seria cobrar texto de quem respondeu
    # "Pronto para uso". A alternativa "obrigatório quando 6.1 != Pronto para
    # uso" foi RECUSADA: exige dependência entre campos no schema, que é o
    # primeiro passo do form builder que este desenho evita de propósito.
    {
        'key': 'ajustes_necessarios',
        'label': 'Se precisar de ajustes, descreva quais:',
        'tipo': 'texto_longo',
        'obrigatorio': False,
        'max_length': 2000,
        'secao': '6. Status Final',
    },
]


def semear(apps, schema_editor):
    FeedbackFormulario = apps.get_model('feedbacks', 'FeedbackFormulario')

    # PASSO 1 — statement SEPARADO e ANTERIOR. Ver o cabeçalho: a constraint
    # parcial não é DEFERRABLE, então inverter esta ordem é IntegrityError em
    # produção.
    FeedbackFormulario.objects.filter(slug=SLUG, ativo=True).update(ativo=False)

    # PASSO 2 — LINHA NOVA. A versão 1 não foi editada; só perdeu o `ativo`.
    # `update_or_create` pela chave única (slug, versao): rodar duas vezes, ou
    # num banco que já recebeu a migration por outro caminho, converge em vez
    # de duplicar.
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


def remover(apps, schema_editor):
    """TRÊS statements, e a ordem também é obrigatória aqui."""
    FeedbackFormulario = apps.get_model('feedbacks', 'FeedbackFormulario')

    # (a) desativar a v2 PRIMEIRO libera a constraint parcial. Sem isto, se a v2
    #     já tiver pedidos, o delete de (b) não acontece (a FK é PROTECT e o
    #     filtro `pedidos__isnull` a preserva) e (c) criaria DUAS ativas —
    #     IntegrityError no meio de um rollback.
    FeedbackFormulario.objects.filter(slug=SLUG, versao=VERSAO).update(ativo=False)

    # (b) só apaga se ninguém apontar para ela: apagar uma definição com pedidos
    #     tornaria as respostas já gravadas ilegíveis.
    FeedbackFormulario.objects.filter(
        slug=SLUG, versao=VERSAO, pedidos__isnull=True,
    ).delete()

    # (c) reativar a v1 é OBRIGATÓRIO. Sem isto `services.formulario_ativo`
    #     levanta DoesNotExist, e essa exceção é ENGOLIDA pelo try/except de
    #     `estrutura.gerar_pedidos_do_projeto` (que roda em on_commit e não pode
    #     deixar nada subir). A feature ficaria INERTE, em silêncio, sem nenhum
    #     erro visível na tela.
    FeedbackFormulario.objects.filter(slug=SLUG, versao=1).update(ativo=True)


class Migration(migrations.Migration):

    dependencies = [
        ('feedbacks', '0004_formulario_subtitulo'),
    ]

    operations = [
        migrations.RunPython(semear, remover),
    ]

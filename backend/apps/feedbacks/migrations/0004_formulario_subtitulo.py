"""
Schema para o formulário definitivo. TROCAR OS CAMPOS CONTINUA SENDO SÓ DADO.

Esta migration é a ÚNICA de schema da entrega, e nada nela é sobre "quais são as
perguntas" — as perguntas vivem na 0005, que é RunPython puro. A promessa da
fase 1 ("trocar o formulário não exige migration de schema") continua valendo
palavra por palavra.

O que muda, e por quê:

  1. AddField `subtitulo` — a intro da página. É conteúdo do FORMULÁRIO: muda
     junto com as perguntas, fica acima delas e precisa ficar congelada com a
     versão. Título no banco e subtítulo num arquivo .tsx seria a incoerência
     que faz alguém trocar o formulário daqui a seis meses e deixar uma intro
     descrevendo perguntas que não existem mais. `blank/default=''`: as versões
     já gravadas continuam válidas sem backfill.

  2. AlterField `referencia_publica` 120 → 200. É o `max_length` de
     `Card.nome` (e também o de `Project.nome`), a origem do valor. Com 120,
     `services.criar_pedido_feedback` cortava em SILÊNCIO — e o valor é o nome
     do CARD, exibido ao cliente sob o rótulo "Nome do projeto:" do formulário.
     Ver o nome da própria entrega cortado no meio é pior do que uma coluna 80
     bytes maior. Alargar coluna de texto no Postgres não reescreve a tabela.

  3. Dois AlterField de HELP_TEXT (`campos` e `valores`), que passariam a
     mentir: os dois diziam "Tipos aceitos: texto, texto_longo" e
     '{"key": "<texto>"}'. São no-op no banco, mas o baseline exige
     `makemigrations --check` limpo — sem eles o check acusa migration pendente.
"""

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('feedbacks', '0003_seed_monitoramento'),
    ]

    operations = [
        migrations.AddField(
            model_name='feedbackformulario',
            name='subtitulo',
            field=models.CharField(blank=True, default='', help_text='Intro da página pública. Texto fixo nosso — nunca dado do projeto.', max_length=300),
        ),
        migrations.AlterField(
            model_name='feedbackformulario',
            name='campos',
            field=models.JSONField(default=list, help_text='Schema dos campos: [{"key": "comentario", "label": "...", "tipo": "texto_longo", "obrigatorio": true, "max_length": 2000}]. A ORDEM é a da lista. Tipos aceitos: "texto", "texto_longo", "escala" (com "minimo"/"maximo" e "rotulos" opcionais) e "escolha_unica" (com "opcoes"). Chave opcional "secao" agrupa campos CONSECUTIVOS sob um cabeçalho na página pública.'),
        ),
        migrations.AlterField(
            model_name='pedidofeedback',
            name='referencia_publica',
            field=models.CharField(max_length=200),
        ),
        migrations.AlterField(
            model_name='respostafeedback',
            name='valores',
            field=models.JSONField(default=dict, help_text='{"<key do campo>": <valor>} — validado ESTRITAMENTE contra pedido.formulario.campos. Texto e escolha única gravam STRING; escala grava INTEIRO (7, não "7"), para a leitura render média e distribuição sem parsing. Chave desconhecida, valor fora do intervalo, opção inexistente e valor acima do max_length são REJEITADOS (não truncados, não coagidos). Campo OPCIONAL não respondido fica AUSENTE do dicionário.'),
        ),
    ]

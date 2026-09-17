"""Entregue no prazo, ou fora dele — a regra, num lugar só.

O PRAZO É MARCADO EM MINUTOS; A ENTREGA É REGISTRADA EM SEGUNDOS. O seletor de
data da tela grava `YYYY-MM-DDTHH:mm` e completa os segundos com zero; a
conclusão é o instante exato do clique. Medido no banco de producao: **1074 de
1074** prazos terminam em segundo zero, e **0 de 902** conclusões terminam.

São dois relógios de precisão diferente, e compará-los com `>` cru marcava como
atrasado quem entregou DENTRO do minuto combinado. Quatro cards estavam assim,
errados por 12, 21, 26 e 35 segundos — todos exibindo, na tela, exatamente o
mesmo horário do prazo.

A distribuição dos 104 atrasos mostra que não é questão de gosto: havia 4 abaixo
de um minuto, **nenhum** entre um minuto e uma hora, e 100 de horas ou dias. Os
quatro não eram "quase atrasados"; eram o arredondamento aparecendo.

POR QUE UM MÓDULO, E NÃO UM CONSERTO NO LUGAR ONDE APARECEU: a comparação estava
escrita em oito lugares — duas vezes no ORM das métricas de sprint, quatro nos
geradores de relatório e uma no frontend. Consertar um faria as telas
discordarem entre si, que é pior que o erro original: números diferentes para a
mesma pergunta destroem a confiança em todos eles. Mesmo motivo de
`apps/reports/periodo.py` existir.
"""
from datetime import timedelta

from django.db.models import DateTimeField, ExpressionWrapper, F, Q

# O prazo "18:30" vale até 18:30:59. Um minuto inteiro, porque é essa a unidade
# que a pessoa consegue escolher na tela — não há como marcar segundos.
TOLERANCIA_DO_PRAZO = timedelta(minutes=1)


def _limite(data_fim):
    """O instante em que o prazo realmente expira."""
    return data_fim + TOLERANCIA_DO_PRAZO


def entregue_no_prazo(card) -> bool:
    """O card foi concluído dentro do minuto do prazo?

    Devolve False quando falta uma das duas datas: sem prazo não há promessa a
    cumprir, e sem conclusão não houve entrega. Quem precisa distinguir "não se
    aplica" de "atrasou" deve checar os campos antes de chamar.
    """
    if not card.data_fim or not card.finalizado_em:
        return False
    return card.finalizado_em < _limite(card.data_fim)


def entregue_atrasado(card) -> bool:
    """Entregue DEPOIS do minuto do prazo.

    Não é a negação de `entregue_no_prazo`: card sem prazo ou sem conclusão não
    é atrasado nem no prazo — ele está fora da pergunta.
    """
    if not card.data_fim or not card.finalizado_em:
        return False
    return card.finalizado_em >= _limite(card.data_fim)


def dias_de_atraso(card) -> int:
    """Quantos dias o card passou do prazo. Zero se entregou dentro dele."""
    if not entregue_atrasado(card):
        return 0
    return (card.finalizado_em - _limite(card.data_fim)).days


def q_entregue_atrasado(prefixo: str = '') -> Q:
    """A mesma regra, para o ORM.

    `prefixo` permite atravessar relações — por exemplo
    `q_entregue_atrasado('projects__cards__')` a partir de `Sprint`.

    `ExpressionWrapper` com `output_field` é obrigatório: somar um `timedelta` a
    um `F` de data sem declarar o tipo faz o Django não saber o que está
    comparando.

    Os dois `isnull=False` são EXPLÍCITOS, não necessários: em SQL, comparação
    com NULL resulta em desconhecido e a linha já fica fora do `WHERE`.
    Escrevi-os achando que eram a trava, e a mutação provou que não — removê-los
    não muda resultado nenhum. Ficam porque dizem a intenção em voz alta e
    espelham as guardas do caminho em Python, que ali sim são obrigatórias.
    """
    campo_fim = f'{prefixo}data_fim'
    campo_conclusao = f'{prefixo}finalizado_em'
    limite = ExpressionWrapper(
        F(campo_fim) + TOLERANCIA_DO_PRAZO, output_field=DateTimeField(),
    )
    return (
        Q(**{f'{campo_fim}__isnull': False})
        & Q(**{f'{campo_conclusao}__isnull': False})
        & Q(**{f'{campo_conclusao}__gte': limite})
    )

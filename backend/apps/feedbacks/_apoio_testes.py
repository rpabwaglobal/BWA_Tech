"""
Apoio aos testes: monta uma resposta VÁLIDA a partir da própria definição.

Por que isto existe. Os testes do MOTOR (prazo, oráculo, throttle, retenção,
transição de coluna) nunca foram sobre o CONTEÚDO do formulário — eles postavam
`{'comentario': …}` só porque era o único campo que a versão 1 tinha. Quando a
versão 2 entrou, trinta testes de motor quebraram de uma vez, todos pelo mesmo
motivo bobo: chave desconhecida.

Com este apoio, o payload é DERIVADO da definição ativa. A versão 3 pode ter
outras perguntas amanhã que nenhum teste de motor precisa mudar — e os testes
que são DE FATO sobre o conteúdo (contrato do GET, tipos, validação estrita)
continuam escrevendo o payload à mão, que é onde escrever à mão é o ponto.

O nome do arquivo NÃO começa com `test`: o runner do Django descobre por
`test*.py`, então este módulo é importado como apoio e nunca coletado.
"""
from __future__ import annotations

from .serializers import TIPOS_TEXTO, campos_publicos


def chave_de_texto(definicao: list) -> str | None:
    """A key do PRIMEIRO campo de texto da definição, ou None se não houver.

    Serve às asserções do tipo "o que eu escrevi foi gravado" sem cravar o nome
    de um campo que a próxima versão do formulário pode não ter.
    """
    for campo in campos_publicos(definicao):
        if campo['tipo'] in TIPOS_TEXTO:
            return campo['key']
    return None


def resposta_valida(definicao: list, texto: str | None = None, **sobrescreve) -> dict:
    """Um `valores` que a validação estrita ACEITA para esta definição.

    Preenche TODO campo obrigatório com um valor legítimo do domínio dele
    (o mínimo da escala, a primeira opção da escolha) e, quando `texto` é dado,
    preenche também os campos de texto — inclusive os opcionais, para que o
    teste tenha o que conferir depois.

    `sobrescreve` entra por último e vence, que é como um teste injeta o valor
    inválido que ele quer ver recusado.
    """
    valores: dict[str, str] = {}
    for campo in campos_publicos(definicao):
        key = campo['key']
        tipo = campo['tipo']

        if tipo == 'escala':
            if campo['obrigatorio']:
                # String, e não int, de propósito: é EXATAMENTE o que o
                # navegador manda (o estado da página é Record<string,string>,
                # porque o rascunho em localStorage só sobrevive como string).
                valores[key] = str(campo['minimo'])
        elif tipo == 'escolha_unica':
            if campo['obrigatorio']:
                valores[key] = campo['opcoes'][0]
        elif texto is not None or campo['obrigatorio']:
            valores[key] = (texto if texto is not None else 'ok')[:campo['max_length']]

    valores.update(sobrescreve)
    return valores

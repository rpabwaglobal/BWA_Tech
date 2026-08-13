"""
Serializers do app de feedback.

Dois públicos completamente diferentes, e por isso dois serializers separados:

  - FormularioPublicoSerializer  → o que um ANÔNIMO vê. Campos declarados um a
    um, NUNCA `__all__` e nunca `depth`: é assim que um campo interno não vaza
    por engano num refactor futuro.
  - PedidoFeedbackInternoSerializer → o que a fase 2 usa para montar o botão de
    copiar link. Autenticado e sob `view_content`.

A validação da resposta fica aqui como FUNÇÃO (e não como Serializer) porque o
schema não é estático: ele vem de `pedido.formulario.campos`, que é dado.
"""
from __future__ import annotations

import math
import re
from datetime import timedelta

from django.conf import settings
from django.utils import timezone
from rest_framework import serializers

from .models import EstadoPedido, PedidoFeedback

# Tipos de campo que o motor sabe validar. Um `tipo` desconhecido na definição
# é tratado como texto — o que degrada para o comportamento seguro (validar como
# string com teto) em vez de aceitar qualquer coisa.
#
# Esta constante deixou de ser decorativa: `validar_valores` faz dispatch por
# tipo e é ela que separa "tipo que tem validação própria" de "tipo que cai no
# ramo texto". Antes ela só documentava uma intenção que ninguém executava.
TIPOS_CONHECIDOS = {'texto', 'texto_longo', 'escala', 'escolha_unica'}

# Os dois tipos que se validam por comprimento de string. Os demais têm domínio
# próprio (intervalo, lista de opções) e são validados ESTRITAMENTE.
TIPOS_TEXTO = {'texto', 'texto_longo'}

# Teto por campo quando a definição não declara `max_length`.
MAX_LENGTH_PADRAO = 2000

# Teto do payload inteiro, bem abaixo de DATA_UPLOAD_MAX_MEMORY_SIZE (2,5 MB).
# Sem isto, `valores` é uma coluna JSON escrita por alguém SEM LOGIN: vira
# storage grátis para quem tiver o link.
MAX_PAYLOAD_CHARS = 20000

# Quantos campos uma definição pode ter. Guarda contra uma definição mal
# semeada transformar um POST em N validações caras.
MAX_CAMPOS = 50

# Mesmo motivo de MAX_CAMPOS, um nível abaixo: a definição é JSON livre, e uma
# definição mal semeada não pode despejar uma lista sem fim na rota anônima.
MAX_OPCOES = 30
MAX_LENGTH_OPCAO = 120

# Teto do nome da seção (cabeçalho de agrupamento na página pública).
MAX_LENGTH_SECAO = 120

# Quantos dígitos uma escala pode ter na ENTRADA. Não é preferência de estilo:
# é o que impede um ValueError de virar 500 nesta rota.
#
# MEDIDO: `int('9' * 4301)` levanta ValueError no CPython >= 3.11 (o limite de
# conversão int<->str de 4300 dígitos, CVE-2020-10735). O regex antigo `^-?\d+$`
# casava a string inteira — ela É um inteiro decimal exato — e o `int()` logo
# abaixo explodia. Cinco quilobytes de dígitos num corpo que cabe folgado em
# DATA_UPLOAD_MAX_MEMORY_SIZE derrubavam a requisição, e um 500 nesta rota tem
# duas consequências que um 400 não tem: a exceção NÃO passa por
# `finalize_response` (então `Internal Server Error: /api/feedback/<TOKEN>/` vai
# para o log com a credencial inteira) e é DISTINGUÍVEL do 404 único, o que
# devolve à rota o oráculo de enumeração que ela foi desenhada para não ter.
#
# 12 dígitos é folga absurda para uma escala (o domínio real é 0-10 e 1-5) e
# mantém o `int()` barato por CONSTRUÇÃO, sem depender de um `try` a mais.
MAX_DIGITOS_ESCALA = 12

# Só dígitos ASCII, com sinal de menos opcional e COM TETO. É deliberadamente
# ESTREITO: '+7', '7.0', '7,0', '7a' e 'sete' NÃO casam. O cliente manda string
# (o rascunho em localStorage só sobrevive como string), então aceitar string é
# necessário — aceitar "quase um número" não é.
#
# `re.ASCII` porque `\d` do `re` casa DÍGITO UNICODE por padrão: '٧'
# (árabe-índico) passava e virava 7. Ninguém digita isso num campo de nota; e o
# docstring desta constante prometia estreiteza que ela não tinha.
_INTEIRO_EXATO = re.compile(rf'^-?\d{{1,{MAX_DIGITOS_ESCALA}}}$', re.ASCII)

# Quantos BITS um número JSON pode ter para virar texto. Mesmo limite de 4300
# dígitos, do OUTRO lado da conversão: `str(10 ** 5000)` também levanta
# ValueError. Um campo de TEXTO recebendo `{"respondente": 999…}` sem aspas
# derrubava a requisição pelo mesmo caminho.
#
# 128 bits ≈ 39 dígitos decimais: cabe qualquer número que uma pessoa digite
# (telefone, CNPJ, ano) e o `str()` fica O(1) na prática.
MAX_BITS_NUMERO = 128

# Caracteres que NENHUM humano digita e que o BANCO não aceita. Recusar em vez
# de limpar é a regra que este módulo já segue para tudo (rejeitar, nunca
# truncar): remover em silêncio gravaria um texto que a pessoa não escreveu.
#
#   \x00        → MEDIDO: o Postgres levanta `unsupported Unicode escape
#                 sequence` (psycopg2.errors.UntranslatableCharacter) ao gravar
#                 esse byte em jsonb. Isso vira `django.db.utils.DataError`, que
#                 NÃO é IntegrityError e portanto passava direto pelo único
#                 `except` da view — 500 na rota anônima, com o token no log.
#   \ud800-\udfff → surrogate solto. É JSON válido, sobrevive ao parse do Python
#                 e explode em UnicodeEncodeError na hora de codificar para o
#                 driver. Mesmo desfecho, por um caminho diferente.
#   demais C0/DEL → nem chegam ao banco, mas também não são resposta; \t, \n e
#                 \r ficam de fora da lista porque um texto_longo legítimo tem
#                 quebra de linha.
_CARACTERE_PROIBIDO = re.compile(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\ud800-\udfff]')


def _inteiro(valor, padrao: int) -> int:
    """Coerção tolerante para uso na ROTA ANÔNIMA.

    Uma definição malformada (semeada à mão, `minimo: "abc"`) não pode virar
    ValueError num GET sem login — isso seria um 500 numa rota pública. Aqui ela
    degrada para o padrão e a guarda de faixa impossível decide o resto.
    """
    try:
        return int(valor)
    except (TypeError, ValueError):
        return padrao


def _opcoes_publicas(bruto) -> list[str]:
    """Limpa a lista de opções: str, sem vazias, sem duplicatas, com teto.

    Deduplica PRESERVANDO A ORDEM porque a ordem da lista é a ordem da tela —
    a mesma promessa que `FeedbackFormulario.campos` já faz.
    """
    saida: list[str] = []
    vistas: set[str] = set()
    for item in (bruto or [])[:MAX_OPCOES] if isinstance(bruto, (list, tuple)) else []:
        texto = str(item).strip()[:MAX_LENGTH_OPCAO]
        if not texto or texto in vistas:
            continue
        vistas.add(texto)
        saida.append(texto)
    return saida


def _rotulos_publicos(bruto) -> dict[str, str]:
    """Rótulos de uma escala ({'1': 'Péssimo'}). Opcional; vazio some do payload."""
    if not isinstance(bruto, dict):
        return {}
    saida: dict[str, str] = {}
    for chave, valor in list(bruto.items())[:MAX_OPCOES]:
        texto = str(valor).strip()[:MAX_LENGTH_OPCAO]
        if texto:
            saida[str(chave)] = texto
    return saida


def campos_publicos(definicao: list) -> list[dict]:
    """Reduz a definição ao mínimo que a página anônima precisa.

    Reescreve campo a campo em vez de devolver o JSON cru: se um dia alguém
    guardar uma anotação interna dentro da definição, ela não vaza para a rota
    pública sem que este arquivo seja alterado.

    CINCO chaves são SEMPRE emitidas (key, label, tipo, obrigatorio,
    max_length). As demais são emitidas CONDICIONALMENTE, pelo tipo:

      secao    → só quando a definição traz uma, não vazia;
      opcoes   → só em 'escolha_unica';
      minimo/maximo → só em 'escala';
      rotulos  → só em 'escala' e só quando o dict não é vazio.

    A assimetria é intencional e tem consequência mensurável: um campo de texto
    sai com as MESMAS 5 chaves de sempre, byte a byte. Uma definição da versão 1
    (que não conhece nenhuma chave nova) continua produzindo o payload de antes
    — é assim que a retrocompatibilidade é estrutural, e não disciplina.

    Um campo cujo domínio ficou IMPOSSÍVEL não é emitido:
      - escala com `maximo <= minimo` (nenhum valor seria aceitável);
      - escolha_unica sem nenhuma opção válida (pergunta obrigatória sem
        nenhuma resposta possível QUEIMARIA o link: a pessoa nunca conseguiria
        enviar).
    Omitir é a menor guarda que impede uma definição quebrada de chegar à tela.
    """
    saida = []
    for campo in (definicao or [])[:MAX_CAMPOS]:
        if not isinstance(campo, dict) or not campo.get('key'):
            continue

        tipo = str(campo.get('tipo') or 'texto')
        publico = {
            'key': str(campo.get('key')),
            'label': str(campo.get('label') or ''),
            'tipo': tipo,
            'obrigatorio': bool(campo.get('obrigatorio')),
            'max_length': int(_inteiro(campo.get('max_length'), 0) or MAX_LENGTH_PADRAO),
        }

        secao = str(campo.get('secao') or '').strip()[:MAX_LENGTH_SECAO]
        if secao:
            publico['secao'] = secao

        if tipo == 'escolha_unica':
            opcoes = _opcoes_publicas(campo.get('opcoes'))
            if not opcoes:
                continue
            publico['opcoes'] = opcoes
        elif tipo == 'escala':
            minimo = _inteiro(campo.get('minimo'), 0)
            maximo = _inteiro(campo.get('maximo'), 0)
            if maximo <= minimo:
                continue
            publico['minimo'] = minimo
            publico['maximo'] = maximo
            rotulos = _rotulos_publicos(campo.get('rotulos'))
            if rotulos:
                publico['rotulos'] = rotulos

        saida.append(publico)
    return saida


def _vazio(bruto) -> bool:
    """"Não respondeu" para qualquer tipo: None, '' ou só espaço."""
    return bruto is None or (isinstance(bruto, str) and not bruto.strip())


def validar_valores(definicao: list, valores) -> tuple[dict, list[str]]:
    """Valida `valores` ESTRITAMENTE contra a definição. Devolve (limpos, erros).

    Whitelist, não blacklist: só passa o que a definição declara. Chave
    desconhecida é REJEITADA (não ignorada — ignorar esconderia um formulário
    desatualizado no cliente), e valor acima do `max_length` é REJEITADO (não
    truncado — truncar gravaria um texto que a pessoa não escreveu).

    DISPATCH POR TIPO. A rota é ANÔNIMA: sem validação de domínio, um campo
    declarado "escala 0 a 10" aceitaria 2000 caracteres de texto livre e a
    coluna JSON viraria storage grátis para quem tivesse o link. Cada tipo com
    domínio próprio tem o seu ramo; o ramo `else` é o comportamento de texto de
    sempre, para onde um `tipo` DESCONHECIDO também cai (degradação segura).

    O QUE É GRAVADO, e por quê:
      escala        → INTEIRO (7, não '7'). É o que torna a leitura útil sem
                      parsing posterior — média de NPS, distribuição de 1 a 5.
      escolha_unica → a STRING EXATA da opção, nunca um código numérico: a
                      resposta continua auto-explicativa no banco mesmo que uma
                      versão futura renomeie a opção.
      texto         → a string, `strip`ada, como sempre foi.

    Campo OPCIONAL não respondido é OMITIDO de `limpos` (antes era gravado como
    string vazia). Com um formulário de 11 perguntas, 5 delas opcionais, gravar
    '' seria cinco linhas vazias na tela de leitura; e gravar '' numa escala
    opcional seria gravar string onde o tipo é inteiro.

    AS MENSAGENS DE ERRO NUNCA ECOAM O VALOR RECEBIDO. A resposta 400 desta rota
    é montada a partir de conteúdo arbitrário de um anônimo — refleti-lo de
    volta é superfície de graça.
    """
    erros: list[str] = []

    if not isinstance(valores, dict):
        return {}, ['Formato inválido.']

    campos = campos_publicos(definicao)
    conhecidas = {c['key'] for c in campos}

    # CONTA, não LISTA. As keys são 100% controladas por quem posta, e a versão
    # anterior devolvia todas elas concatenadas na mensagem: MEDIDO, 200 chaves
    # de 300 bytes viravam um 400 de 60 KB de conteúdo do atacante, e o teto
    # real era o `DATA_UPLOAD_MAX_MEMORY_SIZE` de 2,5 MB. Isso é amplificação de
    # graça e contradiz a regra que este módulo já aplica aos VALORES ("as
    # mensagens de erro nunca ecoam o valor recebido") — as chaves tinham
    # escapado dela.
    #
    # A contagem preserva o que a mensagem existe para dizer: que o formulário
    # do cliente está desatualizado. Qual chave sobrou é diagnóstico de
    # desenvolvimento, e o cliente legítimo tem a definição inteira no GET.
    desconhecidas = len(set(map(str, valores.keys())) - conhecidas)
    if desconhecidas:
        erros.append(f'Campos não reconhecidos: {desconhecidas}.')

    limpos: dict[str, str | int] = {}
    total = 0
    for campo in campos:
        key = campo['key']
        rotulo = campo['label'] or key
        bruto = valores.get(key, '')
        tipo = campo['tipo']

        if tipo == 'escala':
            valor, erro = _validar_escala(campo, bruto, rotulo)
        elif tipo == 'escolha_unica':
            valor, erro = _validar_escolha_unica(campo, bruto, rotulo)
        else:
            valor, erro = _validar_texto(campo, bruto, rotulo)

        if erro:
            erros.append(erro)
            continue
        if valor is None:
            # Opcional não respondido: some do JSON em vez de virar ''.
            continue

        total += len(str(valor))
        limpos[key] = valor

    if total > MAX_PAYLOAD_CHARS:
        erros.append('Resposta muito longa.')

    return limpos, erros


def _texto_de(bruto) -> str | None:
    """Converte para `str` SEM confiar no tamanho nem na finitude do número.

    `str(bruto)` cru era uma bomba de dois gatilhos numa rota anônima:

      - int gigante  → ValueError acima de 4300 dígitos (o mesmo limite do
        `int()` da escala, na direção contrária). 500 garantido.
      - float não finito → `1e400` no JSON vira `inf` no parse do Python, e
        `str(inf)` grava a string 'inf' como se a pessoa tivesse digitado isso.
        `Infinity`, `-Infinity` e `NaN` são literais que o parser do Python
        aceita (não são JSON padrão) e chegavam pelo mesmo caminho.

    Devolve None quando o valor não é convertível — quem decide a mensagem é
    quem chamou.
    """
    if isinstance(bruto, bool):
        # `isinstance(True, int)` é True em Python: sem este teste ANTES, `true`
        # no JSON virava a string 'True'. Os outros ramos já testam bool antes
        # de int pelo mesmo motivo.
        return None
    if isinstance(bruto, str):
        return bruto
    if isinstance(bruto, int):
        return str(bruto) if bruto.bit_length() <= MAX_BITS_NUMERO else None
    if isinstance(bruto, float):
        return str(bruto) if math.isfinite(bruto) else None
    return None


def _validar_texto(campo: dict, bruto, rotulo: str) -> tuple[str | None, str | None]:
    """O ramo de texto: converte com segurança, recusa caractere impossível, mede.

    A ordem importa. A conversão vem primeiro porque é onde mora o 500 (ver
    `_texto_de`); a varredura de caracteres proibidos vem ANTES do teto porque
    um NUL cabe em qualquer `max_length` e mesmo assim derruba o INSERT.
    """
    if bruto is None:
        bruto = ''

    texto = _texto_de(bruto)
    if texto is None:
        return None, f'"{rotulo}": formato inválido.'

    texto = texto.strip()
    if not texto:
        return (None, f'"{rotulo}": obrigatório.') if campo['obrigatorio'] else (None, None)

    # Sem ecoar o caractere de volta: o 400 desta rota é montado a partir de
    # conteúdo arbitrário de um anônimo, e devolver o byte ofensivo seria
    # justamente reintroduzir o eco que o resto do módulo evita.
    if _CARACTERE_PROIBIDO.search(texto):
        return None, f'"{rotulo}": contém caracteres não permitidos.'

    teto = min(campo['max_length'] or MAX_LENGTH_PADRAO, MAX_PAYLOAD_CHARS)
    if len(texto) > teto:
        return None, f'"{rotulo}": máximo de {teto} caracteres.'
    return texto, None


def _validar_escala(campo: dict, bruto, rotulo: str) -> tuple[int | None, str | None]:
    """Inteiro DENTRO do intervalo declarado. Qualquer outra coisa é recusada.

    ACEITA: int puro (7), e string decimal com espaço às bordas (' 7 ') ou zero
    à esquerda ('07'), porque o cliente manda string — o rascunho em
    localStorage só sobrevive como string, então converter no cliente perderia a
    resposta ao reabrir o link. Quem converte é o servidor, que é a única
    autoridade sobre o tipo gravado.

    RECUSA: bool (testado ANTES de int, senão `True` viraria 1), float, list,
    dict, e toda string que não seja um inteiro exato ('sete', '7.0', '7,0',
    '+7'). E recusa o inteiro fora de [minimo, maximo] — 11 num 0-10, 0 num 1-5.

    RECUSA TAMBÉM, e é o que fecha o 500: string com mais de
    `MAX_DIGITOS_ESCALA` dígitos, e dígito não-ASCII. O teto de dígitos está no
    PRÓPRIO regex, então o `int()` abaixo é seguro por construção — não por um
    `try` que alguém precise lembrar de manter.

    O caminho do int JÁ era seguro e continua: um número gigante SEM aspas cai
    direto na comparação de intervalo, e a mensagem de erro nunca o converte
    para string. Não acrescente o valor recebido a `fora_do_intervalo`: além de
    virar eco, o `str()` de um int de 5000 dígitos levanta ValueError.
    """
    minimo = campo.get('minimo', 0)
    maximo = campo.get('maximo', 0)
    fora_do_intervalo = f'"{rotulo}": escolha um valor entre {minimo} e {maximo}.'

    if _vazio(bruto):
        return (None, f'"{rotulo}": obrigatório.') if campo['obrigatorio'] else (None, None)

    if isinstance(bruto, bool):
        return None, fora_do_intervalo
    if isinstance(bruto, int):
        numero = bruto
    elif isinstance(bruto, str):
        texto = bruto.strip()
        if not _INTEIRO_EXATO.fullmatch(texto):
            return None, fora_do_intervalo
        numero = int(texto)
    else:
        return None, fora_do_intervalo

    if numero < minimo or numero > maximo:
        return None, fora_do_intervalo
    return numero, None


def _validar_escolha_unica(campo: dict, bruto, rotulo: str) -> tuple[str | None, str | None]:
    """A string tem de ser EXATAMENTE um item de `opcoes`. Byte a byte.

    Sem case-insensitive, sem normalização de acento, sem fuzzy: 'sim', 'SIM',
    'Nao' sem til e 'Parcialmente.' são todos recusados. A comparação frouxa é
    que transformaria o campo em texto livre disfarçado — e a leitura depende de
    o valor gravado ser um dos rótulos que a pessoa de fato viu.

    `Sim ` (com espaço) é aceito porque há `strip`: o espaço não é resposta.
    """
    invalida = f'"{rotulo}": escolha uma das opções apresentadas.'

    if _vazio(bruto):
        return (None, f'"{rotulo}": obrigatório.') if campo['obrigatorio'] else (None, None)

    # Nem int, nem float, nem bool, nem lista: 1 e True viravam '1'/'True'.
    if not isinstance(bruto, str):
        return None, invalida

    texto = bruto.strip()
    if texto not in campo.get('opcoes', ()):
        return None, invalida
    return texto, None


class FormularioPublicoSerializer(serializers.Serializer):
    """O que a rota anônima devolve: EXATAMENTE {titulo, subtitulo, referencia, campos}.

    `referencia` sai da coluna `referencia_publica` — uma string copiada na
    criação do pedido. O serializer NUNCA faz join em Card, Project ou Sprint,
    então não há responsável, sprint, setor, id de card, id do pedido, valores
    nem outros cards para vazar. Não é disciplina: é que o dado não está aqui.

    `subtitulo` é a intro da página e vem do BANCO, não de um arquivo do
    frontend: ela é conteúdo do FORMULÁRIO (muda junto com as perguntas, fica
    acima delas) e precisa ficar congelada com a versão. Título no banco e
    subtítulo num .tsx seria a incoerência que faz alguém trocar o formulário
    daqui a seis meses e deixar uma intro descrevendo perguntas que não existem
    mais.

    Chave de TOPO é estável e SEMPRE emitida (mesmo vazia); chave de CAMPO é
    dependente do tipo. A assimetria é intencional — emitir `opcoes: []` num
    campo de texto seria ruído no payload da rota anônima.
    """

    titulo = serializers.SerializerMethodField()
    subtitulo = serializers.SerializerMethodField()
    referencia = serializers.CharField(source='referencia_publica', read_only=True)
    # A DATA DE ENTREGA, para a tela de apresentação dizer "entregue em X".
    #
    # É a `data_referencia` do pedido — a mesma que conta os 30 dias —, e sai
    # como DateField ISO puro: quem formata para o humano é o navegador de quem
    # responde, no fuso e no idioma DELE. Formatar aqui obrigaria o servidor a
    # adivinhar o locale de um anônimo.
    #
    # Por que expor não é vazamento: o respondente é justamente a pessoa que
    # recebeu a entrega — a data é dela também. E continua não havendo join:
    # `data_referencia` é coluna do próprio pedido, como `referencia_publica`.
    data_entrega = serializers.DateField(source='data_referencia', read_only=True)
    campos = serializers.SerializerMethodField()

    def get_titulo(self, pedido) -> str:
        return pedido.formulario.titulo

    def get_subtitulo(self, pedido) -> str:
        # Sempre string: uma versão antiga (sem subtítulo) devolve '' e a página
        # simplesmente não renderiza o parágrafo.
        return pedido.formulario.subtitulo or ''

    def get_campos(self, pedido) -> list[dict]:
        return campos_publicos(pedido.formulario.campos)


# AS DUAS CHAVES QUE IDENTIFICAM QUEM RESPONDEU — e elas são OPCIONAIS.
#
# Não existe usuário, sessão nem e-mail do outro lado: a rota é anônima. O que
# há é o que a própria pessoa digitou nos campos "Seu nome:" e "Seu setor:" da
# seção 1 do formulário (feedbacks/0005 e /0007), ambos `obrigatorio: False`.
# A versão 1 do formulário (feedbacks/0002) nem tinha esses campos — respostas
# daquela época simplesmente não têm as chaves, e é por isso que a leitura aqui
# usa `.get()` e trata ausência como o caso NORMAL, não como erro.
KEY_RESPONDENTE = 'respondente'
KEY_SETOR_RESPONDENTE = 'setor_respondente'

# O rótulo honesto de quem não se identificou. NUNCA inventar um nome (nem "Não
# informado" disfarçado de pessoa, nem o nome do card, nem "Cliente"): a lista da
# tela é lida como "quem respondeu", e preencher esse espaço com qualquer coisa
# que pareça identificação seria mentir sobre um dado que o sistema
# deliberadamente não coleta.
ROTULO_ANONIMO = 'Anônimo'


def _texto_identificacao(valores: dict, key: str) -> str:
    """Lê uma chave de identificação da resposta. String limpa, ou ''.

    Só aceita STRING: os campos de identificação são `tipo: 'texto'` e a
    whitelist da gravação já garante isso, mas uma linha editada à mão no banco
    não passaria por ela — e um número virando nome na tela seria pior do que
    "Anônimo".
    """
    bruto = valores.get(key)
    return bruto.strip() if isinstance(bruto, str) else ''


def resposta_legivel(pedido, resposta) -> dict:
    """Casa label ↔ valor NO SERVIDOR, contra a definição DAQUELE pedido.

    RECEBE a linha já escolhida. Antes ela também ACHAVA a resposta
    (`pedido.resposta`, o OneToOne reverso), mas com várias respostas por pedido
    "achar" deixou de ser uma coisa só — quem escolhe é o serializer, que itera
    `pedido.respostas`. O formato CRESCEU sem quebrar:
    `enviado_em` e `itens` continuam idênticos (o componente do frontend e os
    testes que casam item a item seguem valendo) e junto deles vêm `id`,
    `respondente`, `anonimo` e `setor_respondente` — o cabeçalho de cada linha na
    lista "quem respondeu". Ver o bloco que os monta, no fim desta função.

    É a diferença entre um dado guardado e um dado legível. Devolver o dict cru
    `{key: valor}` obrigaria a interface a casar as chaves contra ALGUMA
    definição — e a única que ela tem à mão é a ATIVA. Uma resposta gravada na
    versão 1 apareceria sob os rótulos da versão 2, que é exatamente o defeito
    que o versionamento de 2 passos existe para impedir.

    A iteração é sobre `campos_publicos(pedido.formulario.campos)` — a MESMA
    função da rota anônima, sem alteração. Daí saem de graça: label, tipo,
    seção, domínio (opções/intervalo/rótulos) e a ORDEM DA DEFINIÇÃO.

    Chave da definição sem valor gravado (campo opcional não respondido) sai com
    `valor: None`, e a tela mostra "não respondido". O contrário — chave gravada
    fora da definição — não pode existir, porque a whitelist da gravação a
    rejeita; se aparecer (edição à mão no banco), é IGNORADA aqui.

    "Não há resposta" deixou de ser um caso desta função: ela recebe uma linha
    que existe. Pedido sem resposta (nunca respondido, ou já apagado pela
    política de retenção, que deleta a linha inteira e deixa o pedido com
    `estado='respondido'`) simplesmente produz LISTA VAZIA no serializer.
    """
    valores = resposta.valores if isinstance(resposta.valores, dict) else {}
    itens = []
    for campo in campos_publicos(pedido.formulario.campos):
        item = {
            'key': campo['key'],
            'label': campo['label'],
            'tipo': campo['tipo'],
            'secao': campo.get('secao', ''),
            'valor': valores.get(campo['key']),
        }
        # O domínio acompanha o item para a tela poder escrever "4 - Ótimo" e
        # "8 de 10" sem consultar o formulário por fora.
        if campo['tipo'] == 'escala':
            item['minimo'] = campo['minimo']
            item['maximo'] = campo['maximo']
            if campo.get('rotulos'):
                item['rotulos'] = campo['rotulos']
        itens.append(item)

    # `localtime` e JAMAIS `.isoformat()` direto. Com USE_TZ=True o campo está em
    # UTC, e o helper de data do frontend (`formatDateTime`) casa o regex ISO,
    # fatia hora e minuto MANUALMENTE e monta um Date local — DESCARTANDO o
    # offset. Uma resposta enviada às 14h03 apareceria como 17h03. É a mesma
    # classe de bug UTC-vs-local que `estrutura.py` já documenta no cálculo dos
    # 30 dias, e a correção segue o mesmo precedente (`timezone.localdate`).
    #
    # Também é o que torna este campo COERENTE com o vizinho: `respondido_em`
    # sai do mesmo payload por um DateTimeField do DRF, que já converte para o
    # fuso corrente. Sem esta linha, duas datas do MESMO objeto vinham em fusos
    # diferentes — e a que estava errada era justamente a construída à mão.
    # QUEM RESPONDEU, no topo do payload e não escondido dentro de `itens`.
    #
    # O dado é o MESMO (as duas chaves continuam saindo em `itens`, com os
    # rótulos da versão do formulário — nada foi movido nem removido); o que se
    # acrescenta é o ATALHO. Sem ele, a lista "quem respondeu" da tela teria de
    # varrer os itens de cada resposta procurando uma key por nome — reimplementando
    # no cliente uma regra que é do servidor, e que muda quando o formulário muda.
    #
    # `respondente` já vem PRONTO para exibir (nome ou "Anônimo") e `anonimo` diz
    # QUAL dos dois é, para a tela poder estilizar sem comparar string com o
    # rótulo. Emitir só um dos dois obrigaria o cliente a adivinhar o outro.
    nome = _texto_identificacao(valores, KEY_RESPONDENTE)
    setor = _texto_identificacao(valores, KEY_SETOR_RESPONDENTE)
    return {
        # `id` da LINHA: é a chave estável da lista no React e o que permite
        # abrir "a resposta 3 de 7" sem depender do índice, que muda se uma
        # resposta for apagada pela retenção.
        'id': resposta.pk,
        'enviado_em': timezone.localtime(resposta.enviado_em).isoformat(),
        'respondente': nome or ROTULO_ANONIMO,
        'anonimo': not nome,
        # Vazio quando a pessoa não preencheu — a tela omite a linha em vez de
        # escrever "Setor: —".
        'setor_respondente': setor,
        'itens': itens,
    }


class PedidoFeedbackInternoSerializer(serializers.ModelSerializer):
    """Payload do endpoint AUTENTICADO — é daqui que sai o link para copiar.

    Existe já na fase 1 justamente para que a fase 2 não precise embutir o link
    no CardSerializer (projects/serializers.py está travado, e continuaria sendo
    o arquivo errado para isso depois).

    `respostas` é uma LISTA — várias pessoas respondem o mesmo link, e cada uma
    é uma linha própria. Mostrar só a mais recente seria um defeito de produto:
    o valor da feature é ter várias opiniões sobre a MESMA entrega, e um contador
    dizendo 3 com o diálogo mostrando 1 é confusão garantida. A chave singular
    `resposta` NÃO foi mantida em paralelo — duplicaria o payload inteiro e só
    adiaria o trabalho.

    Cada item é o que a pessoa respondeu, JÁ CASADO com os rótulos da versão do
    formulário daquele pedido (ver `resposta_legivel`). Sem isto o requisito
    "os formulários preenchidos devem ser armazenados no banco" ficava
    tecnicamente atendido e praticamente inútil: `RespostaFeedback.valores` era
    escrito e não era lido em NENHUM ponto de produção — não havia serializer,
    não havia rota, não havia admin. O dado estava guardado e ilegível fora de
    um psql.

    POR QUE ELE PODE VIVER NESTE MESMO PAYLOAD, sob o mesmo gate: este endpoint
    JÁ entrega `url_publica`, que carrega o TOKEN — a credencial inteira da rota
    anônima. Quem tem o link pode RESPONDER NO LUGAR DO CLIENTE. Ler o texto é
    estritamente MENOS poderoso do que o que já sai daqui; um gate mais estreito
    só para o texto, mantendo o link no gate largo, seria uma proteção que não
    protege.

    PORTO INEGOCIÁVEL: `respostas` NÃO entra em `CardSerializer` nem em nenhuma
    listagem de card. É a mesma regra que o link já segue por escrito, e vale
    igual (ou mais) para nome de pessoa e crítica aberta à entrega. O CONTADOR
    também não: nem em `CardSerializer`, nem na rota anônima.
    """

    url_publica = serializers.SerializerMethodField()
    respostas = serializers.SerializerMethodField()
    # Vem do `.annotate(Count('respostas'))` do queryset — não é uma coluna.
    # É o número que o preview do card mostra ("N feedbacks colhidos"), e sai
    # daqui e do resumo pelo MESMO campo, para os dois nunca divergirem.
    total_respostas = serializers.IntegerField(read_only=True)

    class Meta:
        model = PedidoFeedback
        # Lista explícita, nunca `__all__` — o token cru não é campo desta API;
        # ele só sai embutido na URL, que é o que se copia.
        fields = [
            'id', 'estado', 'data_referencia', 'respondido_em', 'url_publica',
            'respostas', 'total_respostas',
        ]
        read_only_fields = fields

    def get_url_publica(self, pedido) -> str:
        # Com FEEDBACK_PUBLIC_BASE_URL configurada (produção), a URL é sempre a
        # canônica em https. Sem ela (dev), cai em build_absolute_uri para o
        # link ainda ser clicável na máquina de quem está testando.
        base = (getattr(settings, 'FEEDBACK_PUBLIC_BASE_URL', '') or '').rstrip('/')
        if base:
            return pedido.url_publica
        request = self.context.get('request')
        caminho = f'/feedback/{pedido.token}'
        return request.build_absolute_uri(caminho) if request is not None else caminho

    def get_respostas(self, pedido) -> list[dict]:
        # `Meta.ordering = ['-enviado_em', '-id']` já entrega da mais recente
        # para a mais antiga; `.all()` aproveita o prefetch da view em vez de
        # disparar uma consulta por pedido.
        return [resposta_legivel(pedido, r) for r in pedido.respostas.all()]


class PedidoFeedbackResumoSerializer(PedidoFeedbackInternoSerializer):
    """O que o BOARD recebe (`?cards=`): link e contador, sem o texto.

    Subclasse só para estreitar `fields`. A diferença que justifica os dois
    formatos é `respostas`: o diálogo de UM card precisa do texto; um board com
    100 cards que baixasse o texto de todos estaria despejando megabytes de dado
    pessoal na tela para desenhar 100 botões de copiar.

    `card` e `card_kanban` existem AQUI e não no detalhe: sem eles o lote é
    inútil, porque o frontend não teria como casar pedido ↔ card (quem pergunta
    por UM card já sabe qual é). São ids internos que quem chama já possui — foi
    ele quem os mandou no parâmetro.
    """

    dias_restantes = serializers.SerializerMethodField()
    ultima_resposta_em = serializers.SerializerMethodField()

    def get_ultima_resposta_em(self, pedido):
        """Data (ISO) da resposta mais recente. `None` quando não há nenhuma.

        DATA, não datetime: a tag do card mostra dia/mês/ano, e mandar hora seria
        expor precisão que a tela não usa. Convertida em fuso LOCAL — `enviado_em`
        é gravado em UTC, e `.date()` cru mostraria o dia anterior à noite.

        Vem da ANNOTATION `ultima_resposta` (Max) que a view já calcula junto do
        Count. Ler `pedido.respostas.all()` aqui traria o JSON de todas as
        respostas de todos os cards do quadro — megabytes de dado pessoal para
        desenhar uma data. O `getattr` cobre o modo singular, que não anota.
        """
        quando = getattr(pedido, 'ultima_resposta', None)
        if quando is None:
            return None
        return timezone.localdate(quando).isoformat()

    def get_dias_restantes(self, pedido) -> int | None:
        """Dias que faltam para o formulário ser liberado. `None` fora da espera.

        Calculado AQUI, e não no frontend, porque a regra tem de ser a MESMA da
        varredura que promove o pedido (`liberar_pedidos_no_prazo`): mesmo
        `FEEDBACK_ESPERA_DIAS`, mesma `data_referencia`, mesmo
        `timezone.localdate()`. Reimplementar no cliente faria a tela dizer
        "faltam 2 dias" enquanto o servidor já teria promovido — e o pior é que
        divergiria só perto da meia-noite, que é quando ninguém está olhando.

        `None` (e não 0) quando o pedido já saiu da espera: 0 significaria
        "libera hoje", que é uma informação diferente de "não se aplica".
        """
        if pedido.estado != EstadoPedido.AGUARDANDO_PRAZO:
            return None
        dias = getattr(settings, 'FEEDBACK_ESPERA_DIAS', 30)
        liberacao = pedido.data_referencia + timedelta(days=dias)
        # `max(0, ...)`: um pedido atrasado (a varredura ainda não rodou) mostra
        # 0 — "sai na próxima varredura" —, nunca um número negativo.
        return max(0, (liberacao - timezone.localdate()).days)

    class Meta(PedidoFeedbackInternoSerializer.Meta):
        fields = [
            'id', 'card', 'card_kanban', 'estado', 'url_publica',
            'total_respostas', 'dias_restantes', 'ultima_resposta_em',
        ]
        read_only_fields = fields

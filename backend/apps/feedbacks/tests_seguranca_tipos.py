"""
ATAQUE À ROTA ANÔNIMA depois que os tipos novos ampliaram a superfície.

Os outros arquivos de teste provam que o motor faz a coisa certa com entrada
PLAUSÍVEL. Este provou o contrário: que ele não QUEBRA com entrada hostil. A
distinção importa porque `/api/feedback/<token>/` é a única rota do sistema sem
autenticação fora de login/recover, e `RespostaFeedback.valores` é uma coluna
JSON escrita por alguém SEM LOGIN.

O critério de aprovação aqui NÃO é "recusa": é **recusa com 400**. Um 500 é
falha de segurança nesta rota por dois motivos concretos e medidos:

  1. Uma exceção não tratada NÃO passa por `FeedbackPublicoView.finalize_response`,
     que é onde `_has_been_logged = True` suprime o log. O handler de exceção do
     Django loga `Internal Server Error: /api/feedback/<TOKEN>/` — ou seja, a
     CREDENCIAL INTEIRA da rota anônima vai para o log da aplicação, que é
     exatamente o que aquele método existe para impedir.
  2. 500 é distinguível de 404 por qualquer sonda, então vira oráculo: só um
     token VÁLIDO chega até a validação de campo. Quem varre descobre quais
     tokens existem pela diferença entre "404" e "erro do servidor".

Quatro assuntos, um por classe, mais o payload público conferido campo a campo.
"""
from __future__ import annotations

import json

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Permission
from django.test import override_settings
from django.utils import timezone

from apps.accounts.models import SetorCatalogo, UserSetor
from apps.projects.models import Card, Project, Sprint

from .models import (
    MAX_RESPOSTAS_POR_PEDIDO,
    EstadoPedido,
    PedidoFeedback,
    RespostaFeedback,
)
from .serializers import MAX_PAYLOAD_CHARS, campos_publicos, validar_valores
from .tests_formulario_v2 import VALIDO_MINIMO, BaseV2
from .views import MSG_INDISPONIVEL

User = get_user_model()

# O limite de conversão int<->str do CPython (PEP 4300 / CVE-2020-10735),
# ativo por padrão desde o 3.11. `int('9' * 4301)` e `str(10 ** 5000)` levantam
# ValueError — não OverflowError, não MemoryError: ValueError, que ninguém
# escreve `except` para pegar por acidente.
DIGITOS_ACIMA_DO_LIMITE = 4301


def _paia(valores) -> dict:
    """Um corpo válido no resto, com só o campo atacado trocado."""
    corpo = dict(VALIDO_MINIMO)
    corpo.update(valores)
    return corpo


# =========================================================================== #
# 1. LIXO EM CADA TIPO NOVO — pela rota HTTP real, não pela função
# =========================================================================== #
class LixoNaRotaAnonimaTests(BaseV2):
    """Cada payload aqui é postado no endpoint anônimo de verdade.

    Testar `validar_valores` direto não bastaria: metade das armadilhas está no
    caminho entre o JSON e a coluna (o `str()` do teto agregado, o INSERT no
    Postgres), e nenhuma delas aparece chamando a função isolada.
    """

    def setUp(self):
        super().setUp()
        # Só para os testes que postam UMA vez; quem varre casos usa
        # `afirmar_recusa`, que cria o seu.
        self.pedido = self.novo_pedido()

    def postar_cru(self, corpo: str):
        """POST com o JSON escrito à mão — para literais que `json.dumps` não gera."""
        pedido = self.novo_pedido(card=self.novo_card(f'Card cru {corpo[:40]}'))
        r = self.client.post(
            self.url(pedido.token), corpo, content_type='application/json',
        )
        return r, pedido

    def afirmar_recusa(self, valores, contexto=''):
        """Recusado com 400, nada gravado, e o token FORA do corpo da resposta.

        PEDIDO NOVO A CADA CHAMADA. O motivo original era que o pedido era
        CONSUMÍVEL (OneToOne com a resposta): reusando um só, a primeira chamada
        que ACEITASSE por engano queimava o link e todas as seguintes voltavam
        404 — o teste passava verde reportando "recusou". Esse motivo acabou (o
        link não expira e aceita várias respostas), mas a prática FICA: um pedido
        por caso mantém a asserção `filter(pedido=pedido).exists()` afirmando
        exatamente o caso que ela nomeia. Reusar um pedido só obrigaria a contar
        linhas acumuladas e tornaria a falha mais difícil de ler, não mais fácil.
        """
        pedido = self.novo_pedido(card=self.novo_card(f'Card {contexto}'[:200]))
        r = self.postar(pedido.token, valores)
        self.assertEqual(
            r.status_code, 400,
            f'{contexto}: esperava 400 e veio {r.status_code}. '
            f'Qualquer coisa fora de 400 nesta rota é furo — 500 leva o token '
            f'para o log e vira oráculo de enumeração; 201 gravou o lixo.',
        )
        self.assertFalse(
            RespostaFeedback.objects.filter(pedido=pedido).exists(),
            f'{contexto}: recusou mas GRAVOU.',
        )
        self.assertNotIn(pedido.token, r.content.decode())
        return r

    # --- escala ------------------------------------------------------------

    def test_escala_recusa_numero_gigante_como_string(self):
        """O FURO PRINCIPAL: `int(texto)` sem teto de dígitos.

        `_INTEIRO_EXATO` casa `'9' * 5000` — é um inteiro decimal exato, o regex
        está certo. Quem explode é o `int()` logo depois, contra o limite de
        4300 dígitos do CPython. Resultado antes da correção: ValueError não
        tratada = 500 na rota anônima, com o token no log.

        O corpo cabe folgado em DATA_UPLOAD_MAX_MEMORY_SIZE (2,5 MB): 5 KB de
        dígitos derrubam a requisição.
        """
        for tamanho in (DIGITOS_ACIMA_DO_LIMITE, 5000, 100000):
            with self.subTest(digitos=tamanho):
                self.afirmar_recusa(
                    _paia({'indicaria_time': '9' * tamanho}),
                    f'escala com {tamanho} dígitos',
                )

    def test_escala_recusa_numero_gigante_negativo_como_string(self):
        """O sinal de menos entra em `_INTEIRO_EXATO` e chega ao mesmo `int()`."""
        self.afirmar_recusa(
            _paia({'indicaria_time': '-' + '9' * 5000}), 'escala negativa gigante',
        )

    def test_escala_recusa_numero_gigante_como_numero_json(self):
        """Sem aspas o JSON já vira int gigante no parse — outro caminho.

        Aqui a comparação de intervalo resolve sem converter para string, então
        este caminho já estava correto. O teste existe para que continue: basta
        alguém acrescentar o valor recebido à mensagem de erro (`f'... {numero}'`)
        para o `str()` de um int de 5000 dígitos voltar a explodir.
        """
        # JSON escrito à mão: `json.dumps` também levanta ValueError com um int
        # de 5000 dígitos, então nem dá para montar o corpo pelo caminho normal.
        # É a mesma armadilha, do lado do cliente — e a prova de que a entrada
        # é REALISTA: quem ataca escreve o corpo à mão.
        interno = json.dumps(_paia({}), ensure_ascii=False)[:-1]
        corpo = f'{{"valores": {interno}, "indicaria_time": {"9" * 5000}}}}}'
        r, pedido = self.postar_cru(corpo)
        self.assertEqual(r.status_code, 400)
        self.assertFalse(RespostaFeedback.objects.filter(pedido=pedido).exists())

    def test_escala_recusa_tipos_errados_e_fora_do_intervalo(self):
        casos = {
            'float': 7.0,
            'float_fracionario': 7.5,
            'bool_true': True,
            'bool_false': False,
            'lista': [7],
            'dict': {'v': 7},
            'string_decimal': '7.0',
            'string_com_mais': '+7',
            'string_virgula': '7,0',
            'palavra': 'sete',
            'notacao_cientifica': '1e2',
            'hexadecimal': '0x7',
            'acima': 11,
            'abaixo': -1,
            'acima_string': '11',
            'abaixo_string': '-1',
            # `int()` do Python aceita separador de milhar por underscore, e o
            # `\d` do `re` casa DÍGITO UNICODE por padrão: '٧' (árabe-índico)
            # passava e era gravado como 7. `re.ASCII` no regex fecha o segundo.
            # 'espaco_unicode' é NBSP, que o `.strip()` do Python NÃO remove.
            'underscore': '1_0',
            'digito_devanagari': '७',
            'digito_unicode': '٧',
            # NBSP NAO entra na lista: `str.strip()` do Python trata
            # ' ' como espaco (`.isspace()` e True), entao ele e
            # removido igual a um espaco comum e o valor vira 7 legitimo.
            # Coberto como ACEITO em test_escala_aceita_espaco_e_nbsp.
            'controle': '\x07',
            'nul': '7\x00',
        }
        for nome, valor in casos.items():
            with self.subTest(caso=nome):
                self.afirmar_recusa(
                    _paia({'indicaria_time': valor}), f'escala {nome}',
                )

    def test_escala_aceita_espaco_e_nbsp_e_grava_inteiro(self):
        """O contraponto do teste acima — e a razão de NBSP não estar na lista.

        `str.strip()` do Python trata '\\xa0' como espaço (`'\\xa0'.isspace()` é
        True), então o NBSP é removido exatamente como um espaço comum e sobra
        um '7' legítimo. Recusá-lo seria recusar quem colou o número de um
        documento — e o que é gravado continua sendo o INTEIRO 7, que é a
        garantia que importa para média de NPS.
        """
        for bruto in ('  9  ', ' 9', '09'):
            with self.subTest(valor=repr(bruto)):
                pedido = self.novo_pedido(card=self.novo_card(f'Card ok {bruto!r}'))
                r = self.postar(pedido.token, _paia({'indicaria_time': bruto}))
                self.assertEqual(r.status_code, 201)
                gravado = RespostaFeedback.objects.get(pedido=pedido).valores
                self.assertEqual(gravado['indicaria_time'], 9)
                self.assertIsInstance(gravado['indicaria_time'], int)

    def test_escala_obrigatoria_recusa_vazio_e_null(self):
        for valor in (None, '', '   ', '\t\n'):
            with self.subTest(valor=repr(valor)):
                self.afirmar_recusa(
                    _paia({'indicaria_time': valor}), 'escala vazia obrigatória',
                )

    def test_escala_de_1_a_5_recusa_o_zero(self):
        """Zero é falsy e é o valor default de `_inteiro` — a combinação clássica."""
        for key in ('qualidade_entrega', 'comunicacao_clara', 'prazo_adequado'):
            with self.subTest(campo=key):
                self.afirmar_recusa(_paia({key: '0'}), f'{key} = 0')
                self.afirmar_recusa(_paia({key: '6'}), f'{key} = 6')

    # --- escolha_unica -----------------------------------------------------

    def test_escolha_unica_recusa_qualquer_coisa_fora_da_lista(self):
        casos = {
            'minusculo': 'sim',
            'maiusculo': 'SIM',
            'sem_acento': 'Nao',
            'com_ponto': 'Parcialmente.',
            'inteiro': 0,
            'inteiro_um': 1,
            'bool': True,
            'lista': ['Sim'],
            'dict': {'v': 'Sim'},
            'float': 1.0,
            'nul_no_meio': 'Si\x00m',
            'nul_no_fim': 'Sim\x00',
            'zero_width': 'S​im',
            'rtl_override': '‮Sim',
            'homoglifo_cirilico': 'Ѕim',
            'texto_enorme': 'S' * 100000,
            'json_serializado': '["Sim"]',
        }
        for nome, valor in casos.items():
            with self.subTest(caso=nome):
                self.afirmar_recusa(
                    _paia({'atendeu_objetivo': valor}), f'escolha {nome}',
                )

    def test_escolha_unica_aceita_so_a_string_exata(self):
        """O contraponto: o que É da lista passa, inclusive com espaço às bordas."""
        r = self.postar(
            self.pedido.token, _paia({'atendeu_objetivo': '  Parcialmente  '}),
        )
        self.assertEqual(r.status_code, 201)
        gravado = RespostaFeedback.objects.get(pedido=self.pedido).valores
        self.assertEqual(gravado['atendeu_objetivo'], 'Parcialmente')

    # --- texto -------------------------------------------------------------

    def test_texto_recusa_numero_json_gigante(self):
        """`_validar_texto` faz `str(bruto)` — e `str()` de int gigante explode.

        Mesmo limite de 4300 dígitos, do outro lado da conversão. Um número sem
        aspas num campo de TEXTO derrubava a requisição com ValueError.
        """
        interno = json.dumps(_paia({}), ensure_ascii=False)[:-1]
        corpo = f'{{"valores": {interno}, "respondente": {"9" * 5000}}}}}'
        r, pedido = self.postar_cru(corpo)
        self.assertEqual(r.status_code, 400)
        self.assertFalse(RespostaFeedback.objects.filter(pedido=pedido).exists())

    def test_texto_recusa_caractere_nul(self):
        """NUL não é texto que alguém digita, e o Postgres não guarda em jsonb.

        `\\u0000` é válido em JSON e sobrevive ao `.strip()`. Chegando ao
        INSERT, o Postgres levanta `unsupported Unicode escape sequence` —
        DataError, que NÃO é IntegrityError e portanto passa direto pelo
        `except` que a view tem. 500 na rota anônima.
        """
        for nome, valor in {
            'no_meio': 'ola\x00mundo',
            'no_fim': 'ola\x00',
            'sozinho': '\x00',
            'escapado_repetido': '\x00' * 50,
        }.items():
            with self.subTest(caso=nome):
                self.afirmar_recusa(
                    _paia({'respondente': valor}), f'texto com NUL {nome}',
                )

    def test_texto_recusa_tipos_que_nao_sao_texto(self):
        for nome, valor in {
            'bool': True,
            'lista': ['a'],
            'dict': {'a': 1},
            'lista_vazia': [],
            'dict_vazio': {},
        }.items():
            with self.subTest(caso=nome):
                self.afirmar_recusa(
                    _paia({'respondente': valor}), f'texto {nome}',
                )

    def test_texto_recusa_acima_do_max_length(self):
        campo = self.campo('respondente')
        self.afirmar_recusa(
            _paia({'respondente': 'a' * (campo['max_length'] + 1)}),
            'texto acima do max_length',
        )

    def test_texto_recusa_infinito_e_nan(self):
        """`float('inf')` gravava a string 'inf' como se a pessoa a tivesse digitado.

        O JSON padrão não tem Infinity, mas o parser do Python aceita `1e400`
        (vira `inf`) e os literais `Infinity`/`NaN`. Nenhum deles é resposta.
        """
        for nome, literal in {
            'overflow': '1e400',
            'infinity': 'Infinity',
            'menos_infinity': '-Infinity',
            'nan': 'NaN',
        }.items():
            with self.subTest(caso=nome):
                interno = json.dumps(_paia({}), ensure_ascii=False)[:-1]
                corpo = f'{{"valores": {interno}, "respondente": {literal}}}}}'
                r, pedido = self.postar_cru(corpo)
                self.assertEqual(
                    r.status_code, 400,
                    f'{nome}: esperava 400, veio {r.status_code}',
                )
                self.assertFalse(
                    RespostaFeedback.objects.filter(pedido=pedido).exists(),
                )

    def test_surrogate_solto_nao_derruba_a_requisicao(self):
        """`"\\ud800"` é JSON válido, sobrevive ao parse e explode ao codificar.

        Caminho diferente do NUL (UnicodeEncodeError em vez de DataError do
        Postgres), mesmo desfecho: 500 na rota anônima com o token no log.
        """
        interno = json.dumps(_paia({}), ensure_ascii=False)[:-1]
        corpo = f'{{"valores": {interno}, "respondente": "ola\\ud800mundo"}}}}'
        r, pedido = self.postar_cru(corpo)
        self.assertEqual(r.status_code, 400)
        self.assertFalse(RespostaFeedback.objects.filter(pedido=pedido).exists())

    # --- transversais ------------------------------------------------------

    def test_um_campo_podre_nao_grava_o_resto(self):
        """Erro em um campo aborta a resposta INTEIRA — nada de gravação parcial.

        A justificativa original era que a gravação parcial CONSUMIA o pedido
        (OneToOne) e o cliente legítimo perdia o link para sempre. O link não é
        mais consumível, mas a regra continua valendo por si: meio formulário
        gravado faz a leitura MENTIR sobre o que a pessoa respondeu, e agora essa
        linha meia-boca ficaria no meio das opiniões das outras pessoas.
        """
        self.afirmar_recusa(
            _paia({'indicaria_time': 'sete', 'o_que_agradou': 'texto legítimo'}),
            'parcial',
        )

    def test_valores_nao_dict_nao_derruba(self):
        for valor in ([], 'texto', 7, None, True, [{'a': 1}]):
            with self.subTest(valor=repr(valor)):
                r = self.postar(self.pedido.token, valor)
                self.assertEqual(r.status_code, 400)


# =========================================================================== #
# 2. TETO DO PAYLOAD — dá para inflar o banco?
# =========================================================================== #
class TetoDoPayloadTests(BaseV2):
    """A pergunta é quantitativa: qual é o MÁXIMO que um anônimo grava?

    A resposta tem de sair de uma conta feita sobre a definição, não de uma
    constante que alguém lembrou de conferir.
    """

    def setUp(self):
        super().setUp()
        self.pedido = self.novo_pedido()

    def test_a_soma_dos_max_length_cabe_no_teto_agregado(self):
        """Se a soma passasse do teto, um respondente prolixo tomaria o 400
        genérico "Resposta muito longa." sem saber qual campo cortar."""
        soma = sum(c['max_length'] for c in campos_publicos(self.ativo().campos))
        self.assertLessEqual(soma, MAX_PAYLOAD_CHARS)
        # Documenta o número medido: 5 campos longos de 2000 + os demais.
        # 8365 e não 8245 desde a migration 0007 — os 120 chars a mais são
        # exatamente o `max_length` do campo novo 'setor_respondente' da v3.
        self.assertEqual(soma, 8365)

    def test_o_maximo_gravavel_por_resposta_e_a_soma_dos_campos(self):
        """Enche TODO campo de texto no limite e mede a coluna resultante."""
        valores = dict(VALIDO_MINIMO)
        for campo in campos_publicos(self.ativo().campos):
            if campo['tipo'] in ('texto', 'texto_longo'):
                valores[campo['key']] = 'x' * campo['max_length']

        r = self.postar(self.pedido.token, valores)
        self.assertEqual(r.status_code, 201)

        gravado = RespostaFeedback.objects.filter(pedido=self.pedido).first().valores
        bytes_json = len(json.dumps(gravado, ensure_ascii=False).encode())
        # 8365 de conteúdo + as chaves e a pontuação do JSON. O teto real por
        # RESPOSTA é da ordem de 10 KB. O teto por PEDIDO é este número vezes
        # MAX_RESPOSTAS_POR_PEDIDO (~1,2 MB) — ver o teste do teto abaixo, que é
        # quem sustenta essa multiplicação depois que a unicidade saiu.
        self.assertLess(bytes_json, 12000)

    def test_teto_agregado_recusa_soma_acima_do_limite(self):
        """Prova o teto agregado com uma definição própria (a v2 não alcança).

        Publicada aqui e não semeada: o assunto é a GUARDA, não o formulário.
        """
        definicao = [
            {'key': f'c{i}', 'label': f'C{i}', 'tipo': 'texto_longo',
             'obrigatorio': False, 'max_length': 2000}
            for i in range(15)
        ]
        limpos, erros = validar_valores(
            definicao, {f'c{i}': 'x' * 2000 for i in range(15)},
        )
        self.assertEqual(erros, ['Resposta muito longa.'])

    def test_o_teto_por_pedido_e_o_que_substitui_o_indice_unico(self):
        """O MESMO assunto quantitativo, com o mecanismo trocado.

        Este teste afirmava "uma resposta por pedido, e o índice único é quem
        garante". O pedido do usuário removeu a unicidade de propósito ("mais de
        um usuário deve poder responder"), e com ela a única barreira ESTRUTURAL
        de gravação: um link público, perene e sem login passaria a aceitar
        escrita ilimitada dentro da taxa, e o balde do rate limit zera a cada
        restart do Redis.

        O que restaura um limite finito e calculável é `MAX_RESPOSTAS_POR_PEDIDO`
        — e a conta que sustenta o desenho volta a fechar: 100 × ~12 KB (o teste
        acima) = ~1,2 MB por pedido no pior caso, e cada pedido continua exigindo
        um CARD.

        A recusa é o MESMO 404 de token inexistente, e isso é a metade
        importante: um status ou uma mensagem própria fariam a rota virar
        oráculo ("este token existe e está cheio").
        """
        # O NÚMERO CRAVADO, e não só a constante. Sem esta linha o teste seria
        # tautológico: ele monta a fixture a partir da própria constante, então
        # elevá-la para 100.000 continuaria passando — e o teto voltaria a ser
        # decorativo sem nenhum teste ficar vermelho. É este valor que sustenta
        # a conta de ~1,2 MB por pedido do teste acima.
        self.assertEqual(MAX_RESPOSTAS_POR_PEDIDO, 100)
        self.assertLess(MAX_RESPOSTAS_POR_PEDIDO * 12000, 2 * 1024 * 1024)

        # As 100 primeiras entram (bulk_create para o teste não custar 100 POSTs
        # nem esbarrar no balde de escrita, que é assunto de outro teste).
        RespostaFeedback.objects.bulk_create([
            RespostaFeedback(pedido=self.pedido, valores={})
            for _ in range(MAX_RESPOSTAS_POR_PEDIDO)
        ])

        recusada = self.postar(self.pedido.token, VALIDO_MINIMO)

        self.assertEqual(recusada.status_code, 404)
        self.assertEqual(recusada.json(), {'detail': MSG_INDISPONIVEL})
        self.assertEqual(
            RespostaFeedback.objects.filter(pedido=self.pedido).count(),
            MAX_RESPOSTAS_POR_PEDIDO,
        )

    def test_abaixo_do_teto_varias_pessoas_respondem_o_mesmo_link(self):
        """O lado positivo do teto: ele não estorva o uso real.

        Sem este par, elevar o teto a 1 faria o teste acima passar e a feature
        inteira parar de funcionar em silêncio.
        """
        for i in range(3):
            self.assertEqual(
                self.postar(self.pedido.token, VALIDO_MINIMO).status_code, 201,
                f'resposta {i} deveria ser aceita',
            )
        self.assertEqual(
            RespostaFeedback.objects.filter(pedido=self.pedido).count(), 3,
        )

    def test_erro_de_chave_desconhecida_nao_ecoa_payload_sem_teto(self):
        """A mensagem de erro NÃO pode devolver o que o anônimo mandou.

        As keys são inteiramente controladas por quem posta. Sem teto, um corpo
        de 2,5 MB (o que `DATA_UPLOAD_MAX_MEMORY_SIZE` deixa entrar) volta
        refletido no 400 — amplificação de graça e conteúdo arbitrário dentro
        de uma resposta nossa. É a mesma regra que o resto do módulo já segue
        para os VALORES ("as mensagens nunca ecoam o valor recebido"); as
        chaves ficaram de fora.
        """
        lixo = {'K' * 300 + str(i): 'x' for i in range(200)}
        r = self.postar(self.pedido.token, _paia(lixo))
        self.assertEqual(r.status_code, 400)
        corpo = r.content.decode()
        self.assertLess(
            len(corpo), 2000,
            f'o 400 devolveu {len(corpo)} bytes de conteúdo do atacante',
        )


# =========================================================================== #
# 3. QUEM CONSEGUE LER A RESPOSTA
# =========================================================================== #
class QuemLeARespostaTests(BaseV2):
    """A leitura é conteúdo NOVO no payload: nome de pessoa (1.2) e crítica
    aberta à entrega (5.1/5.2). Três camadas, provadas uma a uma."""

    def setUp(self):
        super().setUp()
        self.pedido = self.novo_pedido()
        self.assertEqual(self.postar(self.pedido.token, _paia({
            'respondente': 'Fulana de Tal',
            'o_que_melhorar': 'A comunicação do gerente foi ruim.',
        })).status_code, 201)
        self.rota = f'/api/feedbacks/pedidos/?card={self.card.id}'

    def dar_view_content(self, user):
        user.user_permissions.add(Permission.objects.get(codename='view_content'))
        return user

    def afirmar_nao_vaza(self, resposta):
        corpo = resposta.content.decode()
        self.assertNotIn('Fulana de Tal', corpo)
        self.assertNotIn('comunicação do gerente', corpo)
        self.assertNotIn(self.pedido.token, corpo)

    def test_visitante_anonimo_nao_le(self):
        r = self.client.get(self.rota)
        self.assertIn(r.status_code, (401, 403))
        self.afirmar_nao_vaza(r)

    def test_logado_sem_view_content_nao_le(self):
        User.objects.create_user(username='sem-perm', password='y' * 12)
        self.client.login(username='sem-perm', password='y' * 12)
        r = self.client.get(self.rota)
        self.assertEqual(r.status_code, 403)
        self.afirmar_nao_vaza(r)

    def test_com_view_content_le(self):
        self.dar_view_content(self.user)
        self.client.force_login(self.user)
        r = self.client.get(self.rota)
        self.assertEqual(r.status_code, 200)
        item = r.json()['results'][0]
        self.assertEqual(len(item['respostas']), 1)
        self.assertEqual(item['total_respostas'], 1)
        chaves = {i['key']: i['valor'] for i in item['respostas'][0]['itens']}
        self.assertEqual(chaves['respondente'], 'Fulana de Tal')

    def test_outro_setor_nao_le_com_escopo_ligado(self):
        """A prova que importa: `resposta` acompanha `scope_cards`.

        Com a flag DESLIGADA o sistema inteiro é fail-open e qualquer conta com
        `view_content` lê — isso é o estado de hoje e está declarado. O que este
        teste trava é que ligar a flag SEGMENTA também o conteúdo da resposta,
        e não só o link.
        """
        outro_setor = SetorCatalogo.objects.create(codename='outro', nome='Outro')
        intruso = self.dar_view_content(
            User.objects.create_user(username='intruso', password='z' * 12),
        )
        UserSetor.objects.create(user=intruso, setor=outro_setor, is_primary=True)
        self.client.force_login(intruso)

        with override_settings(SETOR_SCOPING_ENABLED=True):
            r = self.client.get(self.rota)
            self.assertEqual(r.status_code, 200)
            self.assertEqual(r.json()['count'], 0)
            self.afirmar_nao_vaza(r)

    def test_sem_card_na_query_nao_entrega_resposta_nenhuma(self):
        self.dar_view_content(self.user)
        self.client.force_login(self.user)
        r = self.client.get('/api/feedbacks/pedidos/')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()['count'], 0)
        self.afirmar_nao_vaza(r)

    def test_a_resposta_nao_entra_em_nenhuma_listagem_de_card(self):
        """PORTO INEGOCIÁVEL: `resposta` só existe no endpoint estreito.

        `/api/cards/` é paginado e amplo — uma resposta ali seria o conteúdo de
        todos os clientes numa requisição.
        """
        self.dar_view_content(self.user)
        self.client.force_login(self.user)
        for rota in ('/api/cards/', f'/api/cards/{self.card.id}/'):
            with self.subTest(rota=rota):
                r = self.client.get(rota)
                if r.status_code != 200:
                    continue
                self.afirmar_nao_vaza(r)

    def test_a_rota_anonima_nao_devolve_a_resposta_de_volta(self):
        """Quem tem o link não pode LER o que já foi respondido.

        O DIA CHEGOU: o teste antigo dizia que a asserção era sobre o CORPO
        "para o dia em que alguém afrouxar o estado", e o estado foi afrouxado de
        propósito — o link não expira e o GET devolve 200 com o formulário. A
        garantia que importava continua de pé e agora é exercitada pelo caminho
        que de fato existe.

        E o CONTADOR também não sai daqui: quantas pessoas já responderam é
        informação interna e influenciaria quem está prestes a responder.
        """
        r = self.client.get(self.url(self.pedido.token))
        self.assertEqual(r.status_code, 200)
        self.afirmar_nao_vaza(r)
        # O contrato público inteiro, sem `total_respostas` nem `respostas`.
        self.assertEqual(
            set(r.json()),
            {'titulo', 'subtitulo', 'referencia', 'data_entrega', 'campos'},
        )


# =========================================================================== #
# 4. A RESPOSTA VOLTA ESCAPADA? (XSS no painel)
# =========================================================================== #
class RespostaNaoViraHtmlTests(BaseV2):
    """O risco real não é o valor gravado — é COMO ele volta e como é renderizado.

    O que estes testes travam é o que depende do servidor: o corpo é JSON (não
    HTML), o valor sai VERBATIM (sem tentativa de sanitização, que daria falsa
    sensação de segurança e mutilaria texto legítimo), e nenhuma rota devolve o
    conteúdo dentro de um documento HTML.
    """

    PAYLOAD_XSS = '<img src=x onerror=alert(1)>"\'`</script>'

    def setUp(self):
        super().setUp()
        self.pedido = self.novo_pedido()
        self.postar(self.pedido.token, _paia({
            'respondente': self.PAYLOAD_XSS,
            'o_que_agradou': '<script>fetch("//evil")</script>',
        }))
        self.user.user_permissions.add(
            Permission.objects.get(codename='view_content'),
        )
        self.client.force_login(self.user)

    def test_a_leitura_sai_como_json_e_nao_como_html(self):
        r = self.client.get(f'/api/feedbacks/pedidos/?card={self.card.id}')
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r['Content-Type'].startswith('application/json'))
        # `X-Content-Type-Options: nosniff` impede o navegador de reinterpretar
        # o corpo como HTML mesmo que alguém abra a URL na barra de endereços.
        self.assertEqual(r.get('X-Content-Type-Options'), 'nosniff')

    def test_o_valor_volta_verbatim_e_o_json_escapa_o_que_precisa(self):
        r = self.client.get(f'/api/feedbacks/pedidos/?card={self.card.id}')
        itens = {i['key']: i['valor'] for i in r.json()['results'][0]['respostas'][0]['itens']}
        # Verbatim: o que a pessoa escreveu é o que se lê. Sanitizar no servidor
        # mutilaria crítica legítima ("o prazo < 2 semanas não deu") e daria
        # falsa sensação de segurança — quem escapa é a camada de render.
        self.assertEqual(itens['respondente'], self.PAYLOAD_XSS)

        # E a aspa dupla SAI ESCAPADA no JSON — ou seja, o payload não quebra a
        # string que o contém e não vira estrutura. Esse é o limite honesto do
        # que o servidor garante: `</script>` sai CRU no corpo (o JSONRenderer
        # do DRF não escapa `<`), e por isso a defesa que importa é a de cima
        # (application/json + nosniff) somada ao fato de que NENHUMA rota
        # embute isto em HTML — coberto pelo teste seguinte.
        corpo = r.content.decode()
        self.assertIn('\\"', corpo)

    def test_o_texto_nao_aparece_em_nenhuma_pagina_html(self):
        """Nenhuma rota do sistema renderiza a resposta dentro de HTML.

        Se um dia alguém montar um relatório server-side, este teste quebra e a
        conversa sobre escaping acontece ANTES do deploy.
        """
        for rota in (f'/api/feedbacks/pedidos/?card={self.card.id}',
                     self.url(self.pedido.token)):
            with self.subTest(rota=rota):
                r = self.client.get(rota)
                self.assertNotIn('text/html', r.get('Content-Type', ''))


# =========================================================================== #
# 5. O PAYLOAD PÚBLICO, CAMPO A CAMPO, CONTRA O FORMULÁRIO NOVO
# =========================================================================== #
class PayloadPublicoSemDadoInternoTests(BaseV2):
    """As 11 perguntas multiplicaram o payload por onze. A conferência é campo
    a campo porque `campos_publicos` agora emite chaves CONDICIONAIS por tipo —
    e chave condicional é onde um campo interno entra sem ninguém notar."""

    CHAVES_DE_TOPO = {'titulo', 'subtitulo', 'referencia', 'data_entrega', 'campos'}
    CHAVES_SEMPRE = {'key', 'label', 'tipo', 'obrigatorio', 'max_length'}
    CHAVES_OPCIONAIS = {'secao', 'opcoes', 'minimo', 'maximo', 'rotulos'}

    def setUp(self):
        super().setUp()
        self.pedido = self.novo_pedido()

    def test_o_topo_tem_exatamente_quatro_chaves(self):
        r = self.client.get(self.url(self.pedido.token))
        self.assertEqual(set(r.json().keys()), self.CHAVES_DE_TOPO)

    def test_nenhum_campo_traz_chave_fora_da_lista_permitida(self):
        r = self.client.get(self.url(self.pedido.token))
        permitidas = self.CHAVES_SEMPRE | self.CHAVES_OPCIONAIS
        for campo in r.json()['campos']:
            with self.subTest(campo=campo['key']):
                self.assertTrue(self.CHAVES_SEMPRE <= set(campo))
                self.assertEqual(set(campo) - permitidas, set())

    def test_chave_condicional_so_aparece_no_tipo_certo(self):
        r = self.client.get(self.url(self.pedido.token))
        for campo in r.json()['campos']:
            with self.subTest(campo=campo['key']):
                if campo['tipo'] == 'escala':
                    self.assertIn('minimo', campo)
                    self.assertNotIn('opcoes', campo)
                elif campo['tipo'] == 'escolha_unica':
                    self.assertIn('opcoes', campo)
                    self.assertNotIn('minimo', campo)
                else:
                    self.assertNotIn('opcoes', campo)
                    self.assertNotIn('minimo', campo)
                    self.assertNotIn('rotulos', campo)

    def test_uma_anotacao_interna_na_definicao_nao_vaza(self):
        """A definição é JSON livre. Se alguém guardar contexto interno lá
        dentro, `campos_publicos` tem de reescrever e descartar — não repassar.
        """
        formulario = self.ativo()
        formulario.campos[0]['observacao_interna'] = 'cliente reclamou do setor X'
        formulario.campos[0]['setor_id'] = 42
        formulario.save(update_fields=['campos'])

        r = self.client.get(self.url(self.pedido.token))
        corpo = r.content.decode()
        self.assertNotIn('observacao_interna', corpo)
        self.assertNotIn('cliente reclamou', corpo)
        self.assertNotIn('setor_id', corpo)

    def test_nada_de_card_projeto_sprint_setor_ou_id_no_corpo(self):
        """`referencia` é a ÚNICA string do sistema que um anônimo vê.

        A lista é de VALORES e de NOMES DE CHAVE, nunca de palavras soltas: a
        palavra "projeto" aparece de forma legítima em quatro das onze
        perguntas, e proibi-la faria o teste quebrar ao trocar o formulário em
        vez de quebrar ao vazar dado.
        """
        r = self.client.get(self.url(self.pedido.token))
        corpo = r.content.decode()
        self.assertEqual(r.json()['referencia'], self.card.nome)
        for proibido in (
            # valores internos da cadeia deste pedido
            'Projeto V2', 'Sprint V2', 'Setor V2', 'v2-tester',
            # nomes de chave que denunciariam um join
            'card_id', 'card_kanban', 'data_referencia', 'setor_id',
            'sprint_id', 'projeto_id', 'responsavel', 'token', 'estado',
        ):
            with self.subTest(proibido=proibido):
                self.assertNotIn(proibido, corpo)

    def test_o_id_do_pedido_e_do_card_nao_aparecem(self):
        r = self.client.get(self.url(self.pedido.token))
        dados = r.json()
        self.assertNotIn('id', dados)
        self.assertNotIn(self.pedido.token, r.content.decode())

    def test_pedido_de_outro_card_nao_e_alcancavel_pelo_mesmo_link(self):
        outro = self.novo_pedido(card=self.novo_card('Card sigiloso'))
        r = self.client.get(self.url(self.pedido.token))
        self.assertNotIn('Card sigiloso', r.content.decode())
        self.assertNotIn(outro.token, r.content.decode())

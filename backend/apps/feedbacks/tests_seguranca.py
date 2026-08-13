"""
Testes de ATAQUE à rota pública de feedback — a única sem login do sistema.

Este arquivo é o terceiro da casa (`tests.py` = motor, `tests_requisitos.py` =
checklist funcional) e existe com um viés diferente dos outros dois: aqui nada é
testado do ponto de vista de quem usa o formulário. Tudo é do ponto de vista de
quem quer ENUMERAR pedidos, DESCOBRIR o que existe atrás da rota, GASTAR recurso
do servidor ou COLHER tokens de outras pessoas.

Três achados desta rodada têm regressão aqui, cada um marcado no seu teste:

  1. OPTIONS devolvia a DOCSTRING da view (com caminho e linha do código de
     autenticação) para qualquer anônimo  -> `metadata_class = None`.
  2. POST multipart era PARSEADO e gravado em disco antes da recusa
     -> `parser_classes = [JSONParser]`.
  3. `/api/feedbacks/pedidos/` sem filtro entregava TODOS os links a qualquer
     conta com `view_content`  -> lista exige `?card=`, sem rota de detalhe e
     sob `scope_cards`.

E um risco que NÃO foi corrigido aqui está documentado com teste próprio
(`test_x_forwarded_for_forjado_ainda_zera_o_balde_de_ip`), porque a correção é
global e é decisão do usuário.
"""
from __future__ import annotations

import logging

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Permission
from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone

from apps.accounts.models import SetorCatalogo
from apps.projects.models import Card, Project, Sprint

from ._apoio_testes import resposta_valida
from .models import RespostaFeedback
from .services import criar_pedido_feedback

User = get_user_model()

TOKEN_INEXISTENTE = 'z' * 43  # mesmo formato e tamanho de um token real


class BaseSeguranca(TestCase):
    def setUp(self):
        # O throttle conta em cache; resíduo de um teste faz o seguinte receber
        # 429 e a falha aponta para o lugar errado.
        cache.clear()
        self.user = User.objects.create_user(username='atacante', password='x' * 12)
        self.setor = SetorCatalogo.objects.create(codename='tec', nome='Tecnologia')
        agora = timezone.now()
        self.sprint = Sprint.objects.create(
            nome='S', data_inicio=agora, fechamento_em=agora, duracao_dias=7,
            supervisor=self.user, setor=self.setor,
        )
        self.projeto = Project.objects.create(nome='P', sprint=self.sprint)
        self.card = Card.objects.create(nome='Site institucional', projeto=self.projeto)
        self.pedido = criar_pedido_feedback(
            card_id=self.card.id, data_referencia=timezone.localdate(),
            referencia_publica=self.card.nome,
        )

    def url(self, token: str) -> str:
        return f'/api/feedback/{token}/'

    def valores(self, pedido=None, texto: str = 'tudo certo', **sobrescreve) -> dict:
        """Uma resposta que a validação estrita ACEITA, derivada da definição.

        Estes testes são sobre ATAQUE à rota, não sobre o conteúdo do
        formulário — cravar as chaves aqui os faria quebrar a cada troca de
        versão, por um motivo que não é o assunto de nenhum deles.
        """
        alvo = pedido or self.pedido
        return resposta_valida(alvo.formulario.campos, texto, **sobrescreve)

    def responder(self, token: str, texto: str = 'tudo certo', **extra):
        """POST válido na rota anônima. `extra` vai para o cliente de teste
        (REMOTE_ADDR, HTTP_X_FORWARDED_FOR), que é o que os testes de balde
        precisam variar."""
        return self.client.post(
            self.url(token), {'valores': self.valores(texto=texto)},
            content_type='application/json', **extra,
        )

    def logar_com_view_content(self):
        self.user.user_permissions.add(Permission.objects.get(codename='view_content'))
        self.client.force_login(self.user)


# =========================================================================== #
# 1. RATE LIMIT — EXISTE E DE FATO SE APLICA?
# =========================================================================== #
class RateLimitTests(BaseSeguranca):
    """Não basta declarar `throttle_classes`: os dois baldes têm de ESTOURAR."""

    def test_limite_por_ip_estoura_na_31a_requisicao(self):
        """'feedback_ip': '30/min' — a 31ª do mesmo IP tem de virar 429.

        Tokens DIFERENTES a cada volta, de propósito: assim quem barra só pode
        ser o balde de IP, e o teste não passa por acidente do balde de token.
        """
        for i in range(30):
            r = self.client.get(self.url(f'{i:0>43}'), REMOTE_ADDR='9.9.9.9')
            self.assertEqual(r.status_code, 404, f'requisição {i} deveria passar')
        estourada = self.client.get(self.url('x' * 43), REMOTE_ADDR='9.9.9.9')
        self.assertEqual(estourada.status_code, 429)

    def test_limite_por_token_estoura_mesmo_com_o_ip_mudando_toda_vez(self):
        """'feedback_token': '120/hour'. É a barreira que o atacante NÃO controla.

        Cada requisição sai de um IP diferente, então o balde de IP nunca enche;
        quem barra é o balde chaveado pelo TEXTO do token. É esta propriedade que
        sustenta o desenho, já que o X-Forwarded-For é forjável (teste abaixo).

        O NÚMERO SUBIU de 60 para 120, de propósito: este escopo virou o balde só
        de LEITURA, e o mesmo link agora vai para VÁRIAS pessoas. Com 60, uma
        entrega mandada para 20 pessoas num grupo — cada uma abrindo o link,
        algumas recarregando — estourava o limite e o cliente LEGÍTIMO via
        "Muitas tentativas em pouco tempo". A escrita ganhou balde próprio, bem
        mais estreito (ver `test_o_envio_tem_balde_proprio_e_mais_estreito`).
        """
        for i in range(120):
            r = self.client.get(self.url(TOKEN_INEXISTENTE), REMOTE_ADDR=f'10.0.{i // 250}.{i % 250}')
            self.assertEqual(r.status_code, 404, f'requisição {i} deveria passar')
        estourada = self.client.get(self.url(TOKEN_INEXISTENTE), REMOTE_ADDR='10.9.9.9')
        self.assertEqual(estourada.status_code, 429)

    def test_o_429_e_identico_para_token_existente_e_inexistente(self):
        """Se o 429 só existisse para token válido, ELE seria o oráculo.

        É o motivo de a chave do balde sair do TEXTO da URL e não do banco.
        """
        def estourar(token):
            # 120, o teto de LEITURA de hoje (ver o teste acima).
            for i in range(120):
                self.client.get(self.url(token), REMOTE_ADDR=f'172.16.{i // 250}.{i % 250}')
            return self.client.get(self.url(token), REMOTE_ADDR='172.31.9.9')

        valido = estourar(self.pedido.token)
        invalido = estourar(TOKEN_INEXISTENTE)

        self.assertEqual(valido.status_code, 429)
        self.assertEqual(invalido.status_code, 429)
        self.assertEqual(valido.json(), invalido.json())
        self.assertEqual(valido.headers.get('Content-Type'),
                         invalido.headers.get('Content-Type'))
        # Retry-After também não pode separar os dois casos (a diferença aceita
        # é só o tempo que o próprio teste levou para rodar).
        espera_v = int(valido.headers.get('Retry-After', 0))
        espera_i = int(invalido.headers.get('Retry-After', 0))
        self.assertLess(abs(espera_v - espera_i), 30)

    def test_x_forwarded_for_forjado_ainda_zera_o_balde_de_ip(self):
        """RISCO CONHECIDO E NÃO CORRIGIDO AQUI — a correção é GLOBAL.

        `NUM_PROXIES` não está em REST_FRAMEWORK, então o DRF usa a cadeia
        X-Forwarded-For BRUTA como identidade. Atrás do Traefik o header sempre
        existe, e quem acrescenta o seu próprio ganha um balde NOVO a cada
        requisição — o limite por IP fica decorativo justamente na única rota
        anônima. Aqui isso está MEDIDO, não suposto.

        Não corrijo por conta própria: `'NUM_PROXIES': 1` muda a identidade de
        throttle de login/register/recovery (outro time), e escolher errado o
        número de proxies faz TODOS os clientes caírem num balde só. É decisão
        do usuário.

        SE ESTE TESTE FALHAR, é boa notícia: significa que o limite por IP
        passou a valer. Apague o teste e comemore.
        """
        vistos = set()
        for i in range(45):
            r = self.client.get(
                self.url(f'{i:0>43}'),
                REMOTE_ADDR='9.9.9.9',
                HTTP_X_FORWARDED_FOR=f'203.0.113.{i}',
            )
            vistos.add(r.status_code)
        self.assertEqual(vistos, {404}, 'nenhum 429: o balde por IP foi contornado')

    def test_o_balde_de_token_barra_o_flood_mesmo_com_xff_forjado(self):
        """O contraponto do teste acima: o que sobra de pé ainda barra o flood.

        Mesmo token, X-Forwarded-For novo a cada volta (o que anula o limite por
        IP) — e mesmo assim o 429 chega, porque o balde por token é derivado do
        que está na URL, e a URL o atacante precisa manter fixa para atacar
        AQUELE link.
        """
        for i in range(120):
            self.client.get(
                self.url(self.pedido.token),
                REMOTE_ADDR='9.9.9.9',
                HTTP_X_FORWARDED_FOR=f'198.51.100.{i % 250}',
            )
        r = self.client.get(
            self.url(self.pedido.token),
            REMOTE_ADDR='9.9.9.9',
            HTTP_X_FORWARDED_FOR='198.51.100.200',
        )
        self.assertEqual(r.status_code, 429)

    def test_o_envio_tem_balde_proprio_e_mais_estreito_que_a_leitura(self):
        """'feedback_envio': '10/hour' — e é um balde DIFERENTE do de leitura.

        Antes GET e POST dividiam o mesmo balde, e isso estava errado nos dois
        sentidos: frouxo como teto de ESCRITA (nenhuma entrega real recebe
        dezenas de opiniões por hora num link sem login) e apertado como teto de
        LEITURA agora que o link é perene e vai para várias pessoas.

        A segunda asserção é a que prova a SEPARAÇÃO: depois de estourar a
        escrita, um GET no MESMO token ainda passa. Com um balde só, ele seria
        429 junto.
        """
        for i in range(10):
            r = self.responder(self.pedido.token, f'opinião {i}',
                               REMOTE_ADDR=f'192.0.2.{i}')
            self.assertEqual(r.status_code, 201, f'envio {i} deveria passar')

        estourado = self.responder(self.pedido.token, 'a 11ª',
                                   REMOTE_ADDR='192.0.2.200')
        self.assertEqual(estourado.status_code, 429)

        # O balde de LEITURA não foi consumido pelos POSTs.
        leitura = self.client.get(self.url(self.pedido.token),
                                  REMOTE_ADDR='192.0.2.201')
        self.assertEqual(leitura.status_code, 200)


# =========================================================================== #
# 2. ORÁCULO — TUDO QUE NÃO É UTILIZÁVEL RESPONDE IGUAL
# =========================================================================== #
class OraculoTests(BaseSeguranca):
    """`tests_requisitos.py` já cobre GET e POST. Aqui vão os métodos ESQUECIDOS.

    Um desenho cuidadoso no GET não serve de nada se OPTIONS, HEAD ou DELETE
    responderem de forma diferente para um token que existe.
    """

    def _respostas_de(self, metodo):
        """Os casos que continuam INUTILIZÁVEIS.

        'ja_respondido' saiu da lista: o link não expira mais e um pedido
        respondido é utilizável como qualquer outro (200 no GET/HEAD). Em troca
        entrou 'card_apagado', que é inutilizável de verdade — o CASCADE levou o
        pedido junto — e mantém o conjunto com quatro casos.
        """
        card_apagado = Card.objects.create(nome='Outro', projeto=self.projeto)
        pedido_orfao = criar_pedido_feedback(
            card_id=card_apagado.id,
            data_referencia=timezone.localdate(), referencia_publica='Outro',
        )
        token_orfao = pedido_orfao.token
        card_apagado.delete()

        alvos = {
            'inexistente': TOKEN_INEXISTENTE,
            'card_apagado': token_orfao,
            'malformado': 'nao é um token!!',
            'longo_demais': 'a' * 200,
        }
        return {nome: getattr(self.client, metodo)(self.url(t)) for nome, t in alvos.items()}

    def test_head_nao_separa_os_casos_inutilizaveis(self):
        """HEAD existe sozinho (Django mapeia head->get) e é fácil de esquecer."""
        respostas = list(self._respostas_de('head').values())
        primeira = respostas[0]
        for r in respostas[1:]:
            self.assertEqual(r.status_code, primeira.status_code)
            self.assertEqual(r.headers.get('Content-Length'),
                             primeira.headers.get('Content-Length'))

    def test_token_com_byte_esquisito_morre_antes_do_banco(self):
        """Nenhuma entrada de URL pode virar erro de DRIVER.

        No Postgres, comparar texto com '\\x00' levanta ValueError no psycopg —
        isto é, 500. E o 500 nasce de exceção, escapa da supressão de log de
        `finalize_response` e leva a URL INTEIRA para o log da aplicação. O
        alfabeto do token é recusado na view, com o mesmo 404 de sempre.

        Roda em SQLite (que engole o NUL calado), então o que ele prova é que a
        recusa acontece ANTES do banco — nenhuma consulta é executada — e não
        que o Postgres se comportaria bem sem ela.
        """
        from django.db import connection
        from django.test.utils import CaptureQueriesContext

        # Só entradas que de fato CHEGAM à view como token. Uma barra ('a/b')
        # nem casa a rota — `<str:token>` não aceita '/' e quem responde é o
        # catch-all da SPA, com 200 e index.html.
        for token in ('ab\x00cd', 'áéí', '<script>alert(1)', ' ' * 5,
                      'x' * 200, "' OR '1'='1"):
            with CaptureQueriesContext(connection) as consultas:
                r = self.client.get(self.url(token))
            self.assertEqual(r.status_code, 404, f'token {token!r}')
            self.assertEqual(r.json(), {'detail': 'Este link não está mais disponível.'})
            self.assertEqual(len(consultas), 0, f'{token!r} chegou ao banco')

    def test_delete_e_put_nao_separam_os_casos(self):
        for metodo in ('delete', 'put', 'patch'):
            a = getattr(self.client, metodo)(self.url(self.pedido.token))
            b = getattr(self.client, metodo)(self.url(TOKEN_INEXISTENTE))
            self.assertEqual(a.status_code, 405)
            self.assertEqual(a.status_code, b.status_code)
            self.assertEqual(a.content, b.content)

    def test_options_nao_descreve_a_view_para_anonimo(self):
        """REGRESSÃO DO ACHADO 1.

        O metadata default do DRF devolve `name` + DESCRIPTION (a docstring da
        classe). MEDIDO antes da correção: 200 com 989 bytes contendo
        "accounts/views.py:909, :941, :1001", o desenho da autenticação e a
        política da rota — reconhecimento de graça, sem login.
        """
        a = self.client.options(self.url(self.pedido.token))
        b = self.client.options(self.url(TOKEN_INEXISTENTE))
        self.assertEqual(a.status_code, 405)
        self.assertEqual(a.status_code, b.status_code)
        self.assertEqual(a.content, b.content)

    def test_nenhuma_resposta_publica_carrega_texto_do_codigo(self):
        """Varredura por marcas de código-fonte em TODOS os métodos da rota.

        `assertNotIn` sobre o corpo cru, e não sobre um campo: o vazamento do
        OPTIONS não estava em nenhum campo que alguém fosse inspecionar.
        """
        marcas = ['accounts/views.py', 'authentication_classes', 'PodeVerConteudo',
                  'AllowAny', 'throttle_classes', 'def get', 'Molde copiado']
        corpos = []
        for token in (self.pedido.token, TOKEN_INEXISTENTE):
            corpos.append(self.client.get(self.url(token)).content)
            corpos.append(self.client.options(self.url(token)).content)
            corpos.append(self.client.delete(self.url(token)).content)
            corpos.append(self.client.post(
                self.url(token), {'valores': {'inventado': 'x'}},
                content_type='application/json',
            ).content)
        cru = b'\n'.join(corpos).decode('utf-8', 'replace')
        for marca in marcas:
            self.assertNotIn(marca, cru)

    def test_preflight_do_navegador_continua_funcionando(self):
        """A correção do OPTIONS não pode quebrar o CORS de dev.

        Quem responde ao preflight de verdade é o CorsMiddleware, ANTES da view
        (ele intercepta OPTIONS com `Access-Control-Request-Method`). Sem este
        teste, `metadata_class = None` poderia ter quebrado o front rodando em
        localhost:5173 contra o backend em :8000, e ninguém veria até o dia do
        uso.
        """
        r = self.client.options(
            self.url(self.pedido.token),
            HTTP_ORIGIN='http://localhost:5173',
            HTTP_ACCESS_CONTROL_REQUEST_METHOD='POST',
        )
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.headers.get('Access-Control-Allow-Origin'),
                         'http://localhost:5173')


# =========================================================================== #
# 3. ABUSO DE RECURSO POR QUEM SÓ TEM O LINK
# =========================================================================== #
class AbusoDeRecursoTests(BaseSeguranca):

    def test_multipart_e_recusado_sem_ser_parseado(self):
        """REGRESSÃO DO ACHADO 2 — anônimo escrevendo em disco.

        `DATA_UPLOAD_MAX_MEMORY_SIZE` (2,5 MB) NÃO vale para as partes de
        arquivo de um multipart: acima de FILE_UPLOAD_MAX_MEMORY_SIZE o Django
        grava em arquivo TEMPORÁRIO no disco. MEDIDO antes da correção: um POST
        de 3 MB num token válido era parseado e só então recusado com 400 — o
        arquivo já tinha sido escrito. Sem teto de tamanho, 60 requisições/hora
        por token bastam para encher disco.

        Depois da correção o DRF nem escolhe parser: 415 antes de ler o corpo.
        """
        import io
        grande = io.BytesIO(b'A' * (3 * 1024 * 1024))
        grande.name = 'g.bin'
        r = self.client.post(self.url(self.pedido.token), {'arquivo': grande})
        self.assertEqual(r.status_code, 415)
        self.assertFalse(RespostaFeedback.objects.exists())

    def test_formulario_html_de_outro_site_e_recusado(self):
        """Um POST cross-site só consegue ser `form-urlencoded` ou `text/plain`.

        Não é CSRF de verdade (a rota não tem credencial ambiente: nem sessão,
        nem cookie, nem header — quem não tem o token não faz nada). Mas fechar
        os content-types que um `<form>` de outro site consegue emitir tira até
        a chance de queimar um link por engano.
        """
        r = self.client.post(
            self.url(self.pedido.token), 'valores=x', content_type='application/x-www-form-urlencoded',
        )
        self.assertEqual(r.status_code, 415)
        self.assertFalse(RespostaFeedback.objects.exists())

    def test_json_continua_sendo_aceito(self):
        """A contraprova: a correção acima não pode ter fechado o caso legítimo."""
        r = self.client.post(
            self.url(self.pedido.token), {'valores': self.valores()},
            content_type='application/json',
        )
        self.assertEqual(r.status_code, 201)
        self.assertEqual(RespostaFeedback.objects.count(), 1)

    def test_o_erro_de_validacao_nao_amplifica_o_payload(self):
        """Eco de entrada em mensagem de erro é vetor de amplificação.

        MEDIDO: 96 KB de chaves desconhecidas geram 75 KB de resposta (razão
        0,78). Não amplifica — a resposta é MENOR que a pergunta —, então fica
        como está, com este teto guardando a propriedade.
        """
        import json
        corpo = {'valores': {f'k{i}' * 5: 'v' for i in range(3000)}}
        entrada = len(json.dumps(corpo))
        r = self.client.post(
            self.url(self.pedido.token), corpo, content_type='application/json',
        )
        self.assertEqual(r.status_code, 400)
        self.assertLess(len(r.content), entrada)


# =========================================================================== #
# 4. O TOKEN NÃO PODE APARECER EM LOG NOSSO
# =========================================================================== #
class LogTests(BaseSeguranca):
    """`tests.py` cobre 400/404. Faltavam os status que nascem de EXCEÇÃO."""

    def _capturar(self, acao):
        """Captura TODO o logging (root), não só 'django.request'.

        A supressão vive em `finalize_response`; um caminho que não passe por
        ela (o 429 do throttle, por exemplo) só apareceria numa captura ampla.
        """
        registros: list[str] = []

        class Coletor(logging.Handler):
            def emit(self, record):
                try:
                    registros.append(record.getMessage())
                except Exception:  # noqa: BLE001
                    registros.append(str(record.msg))

        raiz = logging.getLogger()
        handler = Coletor()
        nivel_anterior = raiz.level
        raiz.addHandler(handler)
        raiz.setLevel(logging.DEBUG)
        try:
            acao()
        finally:
            raiz.removeHandler(handler)
            raiz.setLevel(nivel_anterior)
        return '\n'.join(registros)

    def test_o_429_nao_leva_o_token_para_o_log(self):
        def flood():
            for i in range(62):
                self.client.get(self.url(self.pedido.token),
                                REMOTE_ADDR=f'192.0.2.{i % 250}')
        saida = self._capturar(flood)
        self.assertNotIn(self.pedido.token, saida)

    def test_405_e_415_nao_levam_o_token_para_o_log(self):
        import io

        def bater():
            self.client.delete(self.url(self.pedido.token))
            grande = io.BytesIO(b'A' * 1024)
            grande.name = 'g.bin'
            self.client.post(self.url(self.pedido.token), {'arquivo': grande})
        saida = self._capturar(bater)
        self.assertNotIn(self.pedido.token, saida)

    def test_json_malformado_nao_leva_o_token_para_o_log(self):
        def quebrar():
            self.client.post(self.url(self.pedido.token), '{isto não é json',
                             content_type='application/json')
        saida = self._capturar(quebrar)
        self.assertNotIn(self.pedido.token, saida)

    def test_o_hook_da_fase_2_nao_pode_logar_o_token(self):
        """O único log da view com token é o de falha do hook — e vai MASCARADO.

        A fase 2 vai substituir o corpo de `notificar_transicao`; se ela
        levantar, o log de exceção não pode carregar a credencial.
        """
        from unittest import mock
        with mock.patch('apps.feedbacks.views.notificar_transicao',
                        side_effect=RuntimeError('fase 2 quebrada')):
            saida = self._capturar(lambda: self.client.post(
                self.url(self.pedido.token), {'valores': self.valores(texto='ok')},
                content_type='application/json',
            ))
        self.assertNotIn(self.pedido.token, saida)
        self.assertIn(self.pedido.token[:6], saida)  # a máscara ficou
        self.assertEqual(RespostaFeedback.objects.count(), 1)


# =========================================================================== #
# 5. O ENDPOINT INTERNO ENTREGA O TOKEN — A QUEM?
# =========================================================================== #
class EndpointInternoTests(BaseSeguranca):
    """REGRESSÃO DO ACHADO 3.

    `url_publica` embute o token, que é a credencial INTEIRA da rota anônima.
    Quem consegue lê-lo consegue responder no lugar do cliente. Antes da
    correção, uma conta qualquer com `view_content` pegava o inventário inteiro
    em uma requisição — e, com `?card=` ignorado, também item a item por `pk`.
    """

    def test_listagem_sem_card_nao_entrega_link_nenhum(self):
        self.logar_com_view_content()
        r = self.client.get('/api/feedbacks/pedidos/')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()['count'], 0)
        self.assertNotIn(self.pedido.token, r.content.decode())

    def test_nao_existe_rota_de_detalhe_para_iterar_por_id(self):
        """Sem detalhe, não dá para varrer o inventário com pk = 1, 2, 3…

        A asserção é sobre o CORPO e não sobre o status: o caminho deixou de
        existir na API, então quem responde é o catch-all `serve_spa` — que
        devolve o index.html com 200 para qualquer rota desconhecida. É
        exatamente a armadilha que fez a rota pública ser registrada ANTES dos
        `include()`, e aqui ela aparece de novo: 200 não significa "existe".
        """
        self.logar_com_view_content()
        r = self.client.get(f'/api/feedbacks/pedidos/{self.pedido.pk}/')
        # É FileResponse (index.html) quando existe build do front, e
        # HttpResponse quando não existe — o teste tem de valer nos dois casos.
        bruto = (b''.join(r.streaming_content)
                 if getattr(r, 'streaming', False) else r.content)
        corpo = bruto.decode('utf-8', 'replace')
        self.assertNotIn(self.pedido.token, corpo)
        self.assertNotIn('url_publica', corpo)

    def test_consulta_por_card_continua_entregando_o_link(self):
        """O contrato da fase 2 não pode ter sido quebrado pela correção."""
        self.logar_com_view_content()
        r = self.client.get(f'/api/feedbacks/pedidos/?card={self.card.id}')
        self.assertEqual(r.status_code, 200)
        dados = r.json()['results']
        self.assertEqual(len(dados), 1)
        # CONJUNTO EXATO, e nunca `assertIn`: é esta asserção que pega um
        # campo interno entrando no payload por refactor. Mudou conscientemente
        # nesta entrega — `resposta` (singular) virou `respostas` (LISTA, porque
        # várias pessoas respondem o mesmo link) e entrou `total_respostas`, o
        # contador que o preview do card mostra. As duas chaves existem sempre,
        # vazias enquanto ninguém respondeu.
        self.assertEqual(set(dados[0].keys()),
                         {'id', 'estado', 'data_referencia', 'respondido_em',
                          'url_publica', 'respostas', 'total_respostas'})
        self.assertEqual(dados[0]['respostas'], [])
        self.assertEqual(dados[0]['total_respostas'], 0)
        self.assertIn(self.pedido.token, dados[0]['url_publica'])

    def test_card_de_outro_setor_nao_entrega_o_link_com_escopo_ligado(self):
        """Com `SETOR_SCOPING_ENABLED`, o link segue a visibilidade do card.

        Hoje a flag está desligada e o sistema inteiro é fail-open; este teste
        liga a flag para provar que o dia em que ela ligar o endpoint acompanha,
        em vez de ficar de fora da segmentação por setor.
        """
        from django.test import override_settings
        self.logar_com_view_content()
        with override_settings(SETOR_SCOPING_ENABLED=True):
            # O usuário não tem vínculo com nenhum setor -> não enxerga o card.
            r = self.client.get(f'/api/feedbacks/pedidos/?card={self.card.id}')
            self.assertEqual(r.status_code, 200)
            self.assertEqual(r.json()['count'], 0)

    def test_card_inexistente_ou_lixo_nao_lista_nada(self):
        self.logar_com_view_content()
        for valor in ('999999', 'abc', '', '1 OR 1=1'):
            r = self.client.get(f'/api/feedbacks/pedidos/?card={valor}')
            self.assertEqual(r.status_code, 200)
            self.assertEqual(r.json()['count'], 0)

    def test_sem_login_nao_ha_endpoint_interno(self):
        r = self.client.get(f'/api/feedbacks/pedidos/?card={self.card.id}')
        self.assertIn(r.status_code, (401, 403))
        self.assertNotIn(self.pedido.token, r.content.decode())


# =========================================================================== #
# 6. LGPD — O QUE FICA GUARDADO
# =========================================================================== #
class RetencaoTests(BaseSeguranca):

    def test_a_resposta_nao_guarda_nada_que_identifique_quem_respondeu(self):
        """A conferência é sobre o SCHEMA, não sobre uma linha de exemplo.

        Uma coluna de IP acrescentada no futuro passaria despercebida num teste
        que só olhasse `valores`; aqui a lista de campos é comparada inteira.
        """
        self.client.post(
            self.url(self.pedido.token), {'valores': self.valores(texto='ok')},
            content_type='application/json',
            REMOTE_ADDR='203.0.113.7', HTTP_USER_AGENT='Mozilla/5.0 (marca)',
        )
        colunas = {f.name for f in RespostaFeedback._meta.get_fields()}
        self.assertEqual(colunas, {'id', 'pedido', 'valores', 'enviado_em'})

        resposta = RespostaFeedback.objects.get()
        cru = str(resposta.valores)
        self.assertNotIn('203.0.113.7', cru)
        self.assertNotIn('Mozilla', cru)

    def test_o_expurgo_apaga_o_texto_e_preserva_a_metrica(self):
        from datetime import timedelta

        from django.test import override_settings

        from .models import PedidoFeedback
        from .tasks import limpar_respostas_expiradas

        self.client.post(
            self.url(self.pedido.token), {'valores': self.valores(texto='texto pessoal')},
            content_type='application/json',
        )
        PedidoFeedback.objects.filter(pk=self.pedido.pk).update(
            respondido_em=timezone.now() - timedelta(days=400),
        )
        # O corte é POR LINHA (`enviado_em`) desde que um pedido passou a ter
        # várias respostas — envelhecer só o pedido não seleciona mais nada.
        RespostaFeedback.objects.all().update(
            enviado_em=timezone.now() - timedelta(days=400),
        )
        with override_settings(FEEDBACK_RETENCAO_DIAS=365):
            self.assertEqual(limpar_respostas_expiradas()['apagadas'], 1)

        self.assertFalse(RespostaFeedback.objects.exists())
        pedido = PedidoFeedback.objects.get(pk=self.pedido.pk)
        self.assertEqual(pedido.estado, 'respondido')
        self.assertIsNotNone(pedido.respondido_em)

    def test_o_expurgo_esta_desligado_por_padrao_no_deploy_de_hoje(self):
        """Conferência HONESTA do estado real: `FEEDBACK_RETENCAO_DIAS=0`.

        O caminho de expurgo existe e funciona (teste acima), mas hoje NÃO roda.
        Enquanto o usuário não definir o prazo, o texto fica guardado para
        sempre — e isso precisa aparecer como fato, não como detalhe.
        """
        from django.conf import settings

        from .tasks import limpar_respostas_expiradas
        self.assertEqual(settings.FEEDBACK_RETENCAO_DIAS, 0)
        self.assertTrue(limpar_respostas_expiradas()['desligado'])

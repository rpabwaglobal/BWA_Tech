"""
O FORMULÁRIO DEFINITIVO (versão 2): conteúdo, tipos novos, leitura e a v1 viva.

Por que este arquivo existe separado dos outros seis. Os tipos `escala` e
`escolha_unica` entraram no motor SEM UMA ÚNICA ASSERÇÃO: um `grep` por
'escolha_unica' nos arquivos de teste voltava vazio, e a validação estrita que
protege a rota ANÔNIMA — recusar bool, float, '7.0', '+7', valor fora do
intervalo, opção com acento errado, chave desconhecida — estava inteiramente
sem cobertura. Um `elif` trocado no dispatch de `validar_valores` passaria verde.

Seis assuntos, nesta ordem, e cada um responde a uma pergunta diferente:

  1. O CONTEÚDO é o do formulário pedido? (as 12 perguntas, as 6 seções, os
     rótulos palavra por palavra — travados aqui e em NENHUM outro lugar, para
     não existirem duas cópias da mesma lista para manter em dia.)
  2. A PUBLICAÇÃO emite as chaves certas por tipo, e omite campo de domínio
     impossível?
  3. A VALIDAÇÃO recusa o que tem de recusar, e GRAVA o tipo certo?
  4. A LEITURA devolve o que a pessoa respondeu, sob os rótulos da versão que
     ELA viu?
  5. A VERSÃO 1 continua viva e legível depois da troca?
  6. O PROCEDIMENTO DE 2 PASSOS funciona NOS DOIS SENTIDOS — inclusive no
     rollback, que é quando ninguém está olhando?

O 4 é o que fecha o requisito "os formulários preenchidos devem ser armazenados
no banco": guardar sem conseguir ler não serve. O 5 é o que dá sentido ao 6.
"""
from __future__ import annotations

import datetime as dt
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Permission
from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils import timezone

from apps.accounts.models import SetorCatalogo
from apps.projects.models import Card, Project, Sprint

from .models import (
    EstadoPedido,
    FeedbackFormulario,
    PedidoFeedback,
    RespostaFeedback,
)
from .serializers import (
    MAX_PAYLOAD_CHARS,
    campos_publicos,
    resposta_legivel,
    validar_valores,
)
from .services import criar_pedido_feedback

User = get_user_model()

# As SEIS seções do formulário, na ordem. Fora de ordem, os cabeçalhos da página
# pública mentem — o agrupamento é por RUN CONSECUTIVO, não por conjunto.
SECOES = [
    '1. Identificação',
    '2. Avaliação Geral',
    '3. Qualidade da Entrega',
    '4. Comunicação e Processo',
    '5. Melhorias',
    '6. Status Final',
]

# As 12 perguntas de RESPOSTA. A 1.1 ("Nome do projeto:") não está aqui de
# propósito: ela é EXIBIÇÃO (`PedidoFeedback.referencia_publica`), não resposta.
#
# ERAM 11 até a migration 0007, que semeou a VERSÃO 3 acrescentando "Seu setor:"
# na Identificação. A lista abaixo descreve a definição ATIVA — é ela que a rota
# pública publica e contra a qual as respostas novas são validadas.
PERGUNTAS = [
    ('respondente', 'Seu nome:', 'texto', False, '1. Identificação'),
    ('setor_respondente', 'Seu setor:', 'texto', False, '1. Identificação'),
    ('atendeu_objetivo', 'O projeto atendeu ao objetivo esperado?',
     'escolha_unica', True, '2. Avaliação Geral'),
    ('indicaria_time',
     'De 0 a 10, o quanto você indicaria esse time para novos projetos?',
     'escala', True, '2. Avaliação Geral'),
    ('qualidade_entrega', 'Como você avalia a qualidade da entrega?',
     'escala', True, '3. Qualidade da Entrega'),
    ('o_que_agradou', 'O que mais te agradou na entrega?',
     'texto_longo', False, '3. Qualidade da Entrega'),
    ('comunicacao_clara', 'A comunicação durante o projeto foi clara?',
     'escala', True, '4. Comunicação e Processo'),
    ('prazo_adequado', 'O prazo de entrega foi adequado?',
     'escala', True, '4. Comunicação e Processo'),
    ('o_que_melhorar', 'O que poderia ser melhor neste projeto?',
     'texto_longo', False, '5. Melhorias'),
    ('faria_diferente',
     'Se você fosse o responsável por esse projeto, o que faria diferente?',
     'texto_longo', False, '5. Melhorias'),
    ('status_final', 'Considerando sua necessidade, o projeto está:',
     'escolha_unica', True, '6. Status Final'),
    ('ajustes_necessarios', 'Se precisar de ajustes, descreva quais:',
     'texto_longo', False, '6. Status Final'),
]

# Um payload mínimo e VÁLIDO: só as 6 obrigatórias, todas de um clique. Escrito
# à mão, e não derivado da definição — aqui as perguntas SÃO o assunto.
VALIDO_MINIMO = {
    'atendeu_objetivo': 'Sim',
    'indicaria_time': '9',
    'qualidade_entrega': '5',
    'comunicacao_clara': '4',
    'prazo_adequado': '4',
    'status_final': 'Pronto para uso',
}


class BaseV2(TestCase):
    """Cadeia mínima Sprint -> Project -> Card, com o formulário SEMEADO ativo.

    Nada aqui publica formulário: o assunto é justamente a definição que a
    migration 0005 deixou no banco. Um `setUp` que semeasse à mão testaria a
    própria fixture em vez do que vai para produção.
    """

    def setUp(self):
        # O throttle da rota anônima conta em cache; resíduo de outro teste vira
        # 429 e a falha aponta para o lugar errado.
        cache.clear()
        self.user = User.objects.create_user(username='v2-tester', password='x' * 12)
        self.setor = SetorCatalogo.objects.create(codename='v2', nome='Setor V2')
        agora = timezone.now()
        self.sprint = Sprint.objects.create(
            nome='Sprint V2', data_inicio=agora,
            fechamento_em=agora + timedelta(days=7), duracao_dias=7,
            supervisor=self.user, setor=self.setor,
        )
        self.projeto = Project.objects.create(nome='Projeto V2', sprint=self.sprint)
        self.card = Card.objects.create(nome='Tela de login', projeto=self.projeto)

    # --- utilidades --------------------------------------------------------

    def ativo(self) -> FeedbackFormulario:
        return FeedbackFormulario.objects.get(slug='padrao', ativo=True)

    def url(self, token: str) -> str:
        return f'/api/feedback/{token}/'

    def novo_pedido(self, card=None, **kwargs) -> PedidoFeedback:
        card = card or self.card
        defaults = {
            'card_id': card.id,
            'data_referencia': timezone.localdate(),
            'referencia_publica': card.nome,
        }
        defaults.update(kwargs)
        return criar_pedido_feedback(**defaults)

    def novo_card(self, nome: str) -> Card:
        return Card.objects.create(nome=nome, projeto=self.projeto)

    def postar(self, token: str, valores):
        return self.client.post(
            self.url(token), {'valores': valores}, content_type='application/json',
        )

    def campo(self, key: str) -> dict:
        """O campo PUBLICADO (não o cru da definição) daquela key."""
        for c in campos_publicos(self.ativo().campos):
            if c['key'] == key:
                return c
        self.fail(f'campo {key!r} não está na definição ativa')


# =========================================================================== #
# 1. O CONTEÚDO — as 12 perguntas e as 6 seções, palavra por palavra
# =========================================================================== #
class ConteudoDoFormularioTests(BaseV2):
    """Este é o único lugar onde a lista de perguntas está escrita à mão.

    Duplicá-la num segundo arquivo criaria duas cópias para manter em dia, e a
    que fosse esquecida passaria verde descrevendo um formulário que não existe.
    """

    def test_a_versao_ativa_e_a_semeada_pela_migration(self):
        ativo = self.ativo()
        # 3 desde a migration 0007 (a v3 acrescentou "Seu setor:"). Número
        # CRAVADO: comparar com "a última semeada" faria o teste concordar
        # consigo mesmo em vez de descrever o formulário que está no ar.
        self.assertEqual(ativo.versao, 3)
        self.assertEqual(ativo.titulo, 'Feedback de Entrega de Projeto - BWA')
        self.assertEqual(
            ativo.subtitulo,
            'Olá! Queremos melhorar continuamente nossos projetos. '
            'Seu feedback é essencial e leva menos de 2 minutos',
        )

    def test_as_doze_perguntas_na_ordem_com_rotulo_tipo_e_secao(self):
        publicados = campos_publicos(self.ativo().campos)
        self.assertEqual(len(publicados), 12)

        for esperado, obtido in zip(PERGUNTAS, publicados, strict=True):
            key, label, tipo, obrigatorio, secao = esperado
            with self.subTest(campo=key):
                self.assertEqual(obtido['key'], key)
                self.assertEqual(obtido['label'], label)
                self.assertEqual(obtido['tipo'], tipo)
                self.assertEqual(obtido['obrigatorio'], obrigatorio)
                self.assertEqual(obtido['secao'], secao)

    def test_as_seis_secoes_aparecem_em_runs_consecutivos(self):
        """A ordem da lista É a ordem da tela, e a seção é agrupada por RUN.

        Um `set` das seções passaria mesmo com os campos embaralhados. O que
        este teste trava é que cada seção aparece UMA vez e em BLOCO — que é a
        condição para o agrupamento por run consecutivo produzir seis
        cabeçalhos, e não nove.
        """
        runs = []
        for campo in campos_publicos(self.ativo().campos):
            if not runs or runs[-1] != campo['secao']:
                runs.append(campo['secao'])
        self.assertEqual(runs, SECOES)

    def test_seis_obrigatorias_e_todas_de_um_clique(self):
        """ZERO campo de digitação obrigatório — é o que torna verdadeiro o
        próprio subtítulo ("leva menos de 2 minutos")."""
        obrigatorias = [
            c for c in campos_publicos(self.ativo().campos) if c['obrigatorio']
        ]
        self.assertEqual(len(obrigatorias), 6)
        for campo in obrigatorias:
            with self.subTest(campo=campo['key']):
                self.assertIn(campo['tipo'], {'escala', 'escolha_unica'})

    def test_dominios_das_escalas_e_das_escolhas(self):
        self.assertEqual(
            (self.campo('indicaria_time')['minimo'],
             self.campo('indicaria_time')['maximo']),
            (0, 10),
        )
        for key in ('qualidade_entrega', 'comunicacao_clara', 'prazo_adequado'):
            with self.subTest(campo=key):
                self.assertEqual((self.campo(key)['minimo'],
                                  self.campo(key)['maximo']), (1, 5))

        self.assertEqual(
            self.campo('qualidade_entrega')['rotulos'],
            {'1': 'Péssimo', '2': 'Ruim', '3': 'Bom', '4': 'Ótimo', '5': 'Excelente'},
        )
        self.assertEqual(
            self.campo('atendeu_objetivo')['opcoes'], ['Sim', 'Parcialmente', 'Não'],
        )
        self.assertEqual(
            self.campo('status_final')['opcoes'],
            ['Pronto para uso', 'Precisa de pequenos ajustes',
             'Precisa de melhorias relevantes'],
        )

    def test_o_nome_do_projeto_nao_e_pergunta_e_sim_o_nome_do_card(self):
        """O campo 1.1 do formulário é EXIBIÇÃO, e o valor exibido é o do CARD.

        Duas asserções distintas de propósito: que ele NÃO virou um campo de
        resposta (nada a gravar), e que o valor que o anônimo vê é o nome do
        card marcado — decisão explícita do usuário, e a que torna cinco links
        do mesmo projeto distinguíveis entre si.
        """
        keys = {c['key'] for c in campos_publicos(self.ativo().campos)}
        self.assertNotIn('nome_do_projeto', keys)
        self.assertNotIn('projeto', keys)

        pedido = self.novo_pedido()
        corpo = self.client.get(self.url(pedido.token)).json()
        self.assertEqual(corpo['referencia'], self.card.nome)
        self.assertNotEqual(corpo['referencia'], self.projeto.nome)

    def test_o_teto_agregado_cabe_com_folga_no_limite_do_payload(self):
        """Soma dos `max_length` bem abaixo de MAX_PAYLOAD_CHARS.

        Sem folga, um respondente prolixo tomaria o 400 genérico "Resposta muito
        longa." sem saber QUAL campo cortar — e o erro não ecoa o valor.
        """
        soma = sum(c['max_length'] for c in campos_publicos(self.ativo().campos))
        self.assertLess(soma, MAX_PAYLOAD_CHARS)


# =========================================================================== #
# 2. A PUBLICAÇÃO — quais chaves saem, por tipo
# =========================================================================== #
class PublicacaoPorTipoTests(BaseV2):

    CHAVES_SEMPRE = {'key', 'label', 'tipo', 'obrigatorio', 'max_length'}

    def test_campo_de_texto_sai_com_as_cinco_chaves_de_sempre_mais_secao(self):
        """A assimetria é o que dá retrocompatibilidade ESTRUTURAL: um campo de
        texto não ganhou `opcoes: []` nem `minimo: 0` por existirem tipos novos.
        """
        campo = self.campo('o_que_agradou')
        self.assertEqual(set(campo), self.CHAVES_SEMPRE | {'secao'})

    def test_escala_com_e_sem_rotulos(self):
        com = self.campo('qualidade_entrega')
        sem = self.campo('prazo_adequado')
        self.assertEqual(set(com), self.CHAVES_SEMPRE | {'secao', 'minimo', 'maximo', 'rotulos'})
        # `rotulos` vazio SOME do payload em vez de sair como {}.
        self.assertEqual(set(sem), self.CHAVES_SEMPRE | {'secao', 'minimo', 'maximo'})

    def test_escolha_unica_traz_opcoes_e_nao_traz_intervalo(self):
        campo = self.campo('status_final')
        self.assertEqual(set(campo), self.CHAVES_SEMPRE | {'secao', 'opcoes'})

    def test_o_get_publico_entrega_o_formulario_inteiro_e_nada_alem(self):
        pedido = self.novo_pedido()
        corpo = self.client.get(self.url(pedido.token)).json()

        self.assertEqual(set(corpo), {'titulo', 'subtitulo', 'referencia', 'data_entrega', 'campos'})
        self.assertEqual([c['key'] for c in corpo['campos']],
                         [p[0] for p in PERGUNTAS])
        # Nem o token de volta, nem id, nem nome de projeto, nem setor.
        bruto = self.client.get(self.url(pedido.token)).content.decode()
        for interno in (pedido.token, 'Projeto V2', 'Setor V2', 'Sprint V2',
                        'v2-tester'):
            with self.subTest(interno=interno):
                self.assertNotIn(interno, bruto)

    def test_escala_de_dominio_impossivel_e_omitida_em_vez_de_queimar_o_link(self):
        """Obrigatória sem NENHUM valor aceitável = link impossível de enviar."""
        publicados = campos_publicos([
            {'key': 'ok', 'label': 'Vale', 'tipo': 'texto', 'max_length': 10},
            {'key': 'impossivel', 'label': 'Não vale', 'tipo': 'escala',
             'obrigatorio': True, 'minimo': 5, 'maximo': 5, 'max_length': 1},
            {'key': 'invertida', 'label': 'Também não', 'tipo': 'escala',
             'obrigatorio': True, 'minimo': 10, 'maximo': 0, 'max_length': 2},
        ])
        self.assertEqual([c['key'] for c in publicados], ['ok'])

    def test_escolha_unica_sem_opcao_valida_e_omitida(self):
        publicados = campos_publicos([
            {'key': 'vazia', 'label': 'Sem opção', 'tipo': 'escolha_unica',
             'obrigatorio': True, 'opcoes': ['', '   '], 'max_length': 10},
            {'key': 'sem_lista', 'label': 'Nem lista', 'tipo': 'escolha_unica',
             'obrigatorio': True, 'max_length': 10},
        ])
        self.assertEqual(publicados, [])

    def test_opcoes_sao_limpas_deduplicadas_e_a_ordem_e_preservada(self):
        publicados = campos_publicos([
            {'key': 'x', 'label': 'X', 'tipo': 'escolha_unica', 'max_length': 20,
             'opcoes': ['  Sim  ', 'Não', 'Sim', '', 'Talvez', 'Não']},
        ])
        self.assertEqual(publicados[0]['opcoes'], ['Sim', 'Não', 'Talvez'])

    def test_definicao_malformada_nao_vira_500_na_rota_anonima(self):
        """`minimo`/`maximo` lixo degradam para o padrão em vez de ValueError."""
        publicados = campos_publicos([
            {'key': 'ruim', 'label': 'Ruim', 'tipo': 'escala',
             'minimo': 'abc', 'maximo': 'def', 'max_length': 'nada'},
            {'key': 'meio_ruim', 'label': 'Meio ruim', 'tipo': 'escala',
             'minimo': None, 'maximo': 7, 'max_length': 1},
        ])
        # A primeira vira 0..0 (domínio impossível) e some; a segunda sobrevive.
        self.assertEqual([c['key'] for c in publicados], ['meio_ruim'])
        self.assertEqual((publicados[0]['minimo'], publicados[0]['maximo']), (0, 7))


# =========================================================================== #
# 3. A VALIDAÇÃO ESTRITA — a rota é ANÔNIMA
# =========================================================================== #
class ValidacaoEstritaEscalaTests(BaseV2):
    """Sem isto, "escala 0 a 10" aceita 2000 caracteres de texto livre e a
    coluna JSON vira storage grátis para quem tiver o link."""

    def responder_com(self, **sobrescreve):
        pedido = self.novo_pedido(card=self.novo_card(f'C{len(sobrescreve)}'))
        valores = dict(VALIDO_MINIMO)
        valores.update(sobrescreve)
        return pedido, self.postar(pedido.token, valores)

    def test_o_payload_minimo_e_aceito_e_grava_inteiro(self):
        pedido, resposta = self.responder_com()
        self.assertEqual(resposta.status_code, 201)

        pedido.refresh_from_db()
        valores = pedido.respostas.first().valores
        # INTEIRO, não '9'. É o que torna média de NPS e distribuição de 1 a 5
        # possíveis sem parsing posterior.
        self.assertEqual(valores['indicaria_time'], 9)
        self.assertIsInstance(valores['indicaria_time'], int)
        self.assertNotIsInstance(valores['indicaria_time'], bool)

    def test_aceita_string_com_espaco_e_zero_a_esquerda(self):
        """Aceitar string é NECESSÁRIO, não frouxidão: o rascunho em localStorage
        só sobrevive como string, então converter no cliente perderia a resposta
        ao reabrir o link. Quem converte é o SERVIDOR."""
        pedido, resposta = self.responder_com(indicaria_time=' 07 ')
        self.assertEqual(resposta.status_code, 201)
        pedido.refresh_from_db()
        self.assertEqual(pedido.respostas.first().valores['indicaria_time'], 7)

    def test_aceita_int_puro_do_json(self):
        pedido, resposta = self.responder_com(indicaria_time=3)
        self.assertEqual(resposta.status_code, 201)
        pedido.refresh_from_db()
        self.assertEqual(pedido.respostas.first().valores['indicaria_time'], 3)

    def test_recusa_fora_do_intervalo(self):
        for valor in ('11', '-1', 11, -1, '100'):
            with self.subTest(valor=valor):
                _, resposta = self.responder_com(indicaria_time=valor)
                self.assertEqual(resposta.status_code, 400)

    def test_recusa_fora_do_intervalo_tambem_na_escala_de_um_a_cinco(self):
        """0 é válido no NPS e INVÁLIDO aqui: o intervalo é POR CAMPO."""
        for valor in ('0', '6', 0, 6):
            with self.subTest(valor=valor):
                _, resposta = self.responder_com(qualidade_entrega=valor)
                self.assertEqual(resposta.status_code, 400)

    def test_recusa_bool_antes_de_int(self):
        """`isinstance(True, int)` é True em Python: sem o teste de bool ANTES,
        `true` viraria 1 e seria gravado como se a pessoa tivesse escolhido 1."""
        for valor in (True, False):
            with self.subTest(valor=valor):
                _, resposta = self.responder_com(qualidade_entrega=valor)
                self.assertEqual(resposta.status_code, 400)

    def test_recusa_float_e_strings_que_sao_quase_um_numero(self):
        for valor in (7.0, 7.5, '7.0', '7,0', '+7', 'sete', 'NaN', '', '  ',
                      '0x7', '7 8'):
            with self.subTest(valor=valor):
                _, resposta = self.responder_com(indicaria_time=valor)
                self.assertEqual(resposta.status_code, 400)

    def test_recusa_estrutura_no_lugar_de_numero(self):
        for valor in ([7], {'v': 7}, [], {}):
            with self.subTest(valor=valor):
                _, resposta = self.responder_com(indicaria_time=valor)
                self.assertEqual(resposta.status_code, 400)

    def test_a_mensagem_de_erro_nao_ecoa_o_valor_recebido(self):
        """O 400 desta rota é montado a partir de conteúdo arbitrário de um
        anônimo — refleti-lo de volta é superfície de graça."""
        veneno = '<script>SEGREDO-ECOADO</script>'
        _, resposta = self.responder_com(indicaria_time=veneno)
        self.assertEqual(resposta.status_code, 400)
        self.assertNotIn('SEGREDO-ECOADO', resposta.content.decode())
        self.assertIn('entre 0 e 10', str(resposta.json()))

    def test_escala_obrigatoria_vazia_e_recusada_com_o_rotulo_da_pergunta(self):
        for valor in ('', '   ', None):
            with self.subTest(valor=valor):
                _, resposta = self.responder_com(prazo_adequado=valor)
                self.assertEqual(resposta.status_code, 400)
                self.assertIn('obrigatório', str(resposta.json()))


class ValidacaoEstritaEscolhaUnicaTests(BaseV2):
    """A comparação frouxa é o que transformaria o campo em texto livre
    disfarçado — e a LEITURA depende de o valor gravado ser um dos rótulos que a
    pessoa DE FATO VIU na tela."""

    def responder_com(self, **sobrescreve):
        pedido = self.novo_pedido(card=self.novo_card(f'C{len(sobrescreve)}'))
        valores = dict(VALIDO_MINIMO)
        valores.update(sobrescreve)
        return pedido, self.postar(pedido.token, valores)

    def test_grava_a_string_exata_da_opcao(self):
        """Nunca um código numérico: a resposta continua auto-explicativa no
        banco mesmo que uma versão futura renomeie a opção."""
        pedido, resposta = self.responder_com(atendeu_objetivo='Parcialmente')
        self.assertEqual(resposta.status_code, 201)
        pedido.refresh_from_db()
        self.assertEqual(pedido.respostas.first().valores['atendeu_objetivo'], 'Parcialmente')

    def test_aceita_com_espaco_nas_bordas_porque_espaco_nao_e_resposta(self):
        pedido, resposta = self.responder_com(atendeu_objetivo='  Não  ')
        self.assertEqual(resposta.status_code, 201)
        pedido.refresh_from_db()
        self.assertEqual(pedido.respostas.first().valores['atendeu_objetivo'], 'Não')

    def test_recusa_variacao_de_caixa_de_acento_e_de_pontuacao(self):
        for valor in ('sim', 'SIM', 'Nao', 'NÃO', 'Parcialmente.',
                      'Pronto pra uso', 'parcialmente'):
            with self.subTest(valor=valor):
                _, resposta = self.responder_com(atendeu_objetivo=valor)
                self.assertEqual(resposta.status_code, 400)

    def test_recusa_opcao_de_outro_campo(self):
        """As opções são POR CAMPO: 'Pronto para uso' não vale em 2.1."""
        _, resposta = self.responder_com(atendeu_objetivo='Pronto para uso')
        self.assertEqual(resposta.status_code, 400)

    def test_recusa_tipo_que_nao_seja_string(self):
        """1 e True virariam '1'/'True' num `str()` descuidado."""
        for valor in (0, 1, True, False, 1.0, ['Sim'], {'v': 'Sim'}):
            with self.subTest(valor=valor):
                _, resposta = self.responder_com(status_final=valor)
                self.assertEqual(resposta.status_code, 400)

    def test_a_mensagem_nao_devolve_a_lista_de_opcoes_nem_o_recebido(self):
        _, resposta = self.responder_com(status_final='SEGREDO-ECOADO')
        self.assertEqual(resposta.status_code, 400)
        corpo = resposta.content.decode()
        self.assertNotIn('SEGREDO-ECOADO', corpo)
        self.assertNotIn('Precisa de pequenos ajustes', corpo)
        self.assertIn('escolha uma das opções apresentadas', corpo)


class GuardasTransversaisTests(BaseV2):
    """O que vale para TODOS os tipos e fecha a rota anônima."""

    def test_chave_desconhecida_e_rejeitada_e_nao_ignorada(self):
        """Ignorar esconderia um cliente com formulário desatualizado — e
        deixaria a coluna JSON aceitar qualquer chave de quem tem o link.

        A mensagem CONTA as chaves em vez de listá-las, e o teste passou a
        afirmar isso: ecoar as chaves recebidas transformava o 400 num
        amplificador (200 chaves de 300 bytes = 60 KB de conteúdo do atacante de
        volta), e contradizia a regra que o módulo já aplicava aos VALORES. Ou
        seja, a asserção antiga (`assertIn('campo_inventado', ...)`) pedia
        justamente o que o produto passou a recusar — agora ela prova o
        contrário, o que é mais forte do que só conferir o 400.
        """
        pedido = self.novo_pedido()
        valores = dict(VALIDO_MINIMO, campo_inventado='lixo')
        resposta = self.postar(pedido.token, valores)

        self.assertEqual(resposta.status_code, 400)
        self.assertEqual(resposta.json()['valores'], ['Campos não reconhecidos: 1.'])
        # A chave enviada NÃO volta no corpo — o 400 não ecoa entrada.
        self.assertNotIn('campo_inventado', resposta.content.decode())
        pedido.refresh_from_db()
        self.assertEqual(pedido.estado, EstadoPedido.AGUARDANDO_PRAZO)
        self.assertFalse(RespostaFeedback.objects.filter(pedido=pedido).exists())

    def test_payload_que_nao_e_dict_e_recusado(self):
        pedido = self.novo_pedido()
        for valores in (['Sim'], 'Sim', 7, None):
            with self.subTest(valores=valores):
                self.assertEqual(self.postar(pedido.token, valores).status_code, 400)

    def test_texto_acima_do_max_length_e_recusado_e_nao_truncado(self):
        """Truncar gravaria um texto que a pessoa não escreveu."""
        pedido = self.novo_pedido()
        valores = dict(VALIDO_MINIMO, respondente='n' * 121)
        resposta = self.postar(pedido.token, valores)
        self.assertEqual(resposta.status_code, 400)
        self.assertIn('120', str(resposta.json()))

    def test_teto_agregado_do_payload(self):
        """A soma dos campos que passaram tem teto próprio: sem ele, `valores` é
        uma coluna JSON escrita por alguém SEM LOGIN."""
        limpos, erros = validar_valores(
            [{'key': f'c{i}', 'label': f'C{i}', 'tipo': 'texto_longo',
              'max_length': 2000} for i in range(15)],
            {f'c{i}': 'x' * 2000 for i in range(15)},
        )
        self.assertIn('Resposta muito longa.', erros)

    def test_opcional_nao_respondido_fica_AUSENTE_em_vez_de_string_vazia(self):
        """Com 5 opcionais, gravar '' seria cinco linhas vazias na leitura — e
        numa escala opcional seria gravar string onde o tipo é inteiro."""
        pedido = self.novo_pedido()
        self.assertEqual(self.postar(pedido.token, VALIDO_MINIMO).status_code, 201)

        pedido.refresh_from_db()
        self.assertEqual(set(pedido.respostas.first().valores), set(VALIDO_MINIMO))
        for opcional in ('respondente', 'o_que_agradou', 'o_que_melhorar',
                         'faria_diferente', 'ajustes_necessarios'):
            with self.subTest(campo=opcional):
                self.assertNotIn(opcional, pedido.respostas.first().valores)

    def test_tipo_desconhecido_degrada_para_texto_em_vez_de_explodir(self):
        """Nem 500 nem "aceita qualquer coisa": vira texto com teto."""
        definicao = [{'key': 'futuro', 'label': 'De amanhã', 'tipo': 'matriz',
                      'obrigatorio': True, 'max_length': 10}]
        limpos, erros = validar_valores(definicao, {'futuro': 'ok'})
        self.assertEqual((limpos, erros), ({'futuro': 'ok'}, []))

        _, erros_longos = validar_valores(definicao, {'futuro': 'x' * 11})
        self.assertTrue(erros_longos)

    def test_nada_e_gravado_quando_qualquer_campo_erra(self):
        """Meio formulário gravado é pior que nenhum: a leitura ficaria mentindo
        sobre o que a pessoa respondeu."""
        pedido = self.novo_pedido()
        valores = dict(VALIDO_MINIMO, indicaria_time='99', respondente='Fulana')
        self.assertEqual(self.postar(pedido.token, valores).status_code, 400)

        pedido.refresh_from_db()
        self.assertEqual(pedido.estado, EstadoPedido.AGUARDANDO_PRAZO)
        self.assertIsNone(pedido.respondido_em)


# =========================================================================== #
# 4. A LEITURA — guardar sem conseguir ler não serve
# =========================================================================== #
class LeituraDaRespostaTests(BaseV2):

    def setUp(self):
        super().setUp()
        self.user.user_permissions.add(
            Permission.objects.get(codename='view_content')
        )
        self.user = User.objects.get(pk=self.user.pk)  # limpa o cache de permissões
        self.client.force_login(self.user)

    def ler(self, card_id: int) -> dict:
        resposta = self.client.get(f'/api/feedbacks/pedidos/?card={card_id}')
        self.assertEqual(resposta.status_code, 200)
        return resposta.json()['results'][0]

    def ler_resposta(self, card_id: int, indice: int = 0) -> dict:
        """UMA resposta da lista, a mais recente primeiro.

        O payload deixou de ter a chave singular `resposta` e passou a ter
        `respostas` (lista), porque várias pessoas respondem o mesmo link — ver
        o pedido do usuário. Os testes de FORMATO abaixo continuam valendo item a
        item; só mudou de onde o item sai.
        """
        return self.ler(card_id)['respostas'][indice]

    def test_sem_resposta_a_lista_existe_e_e_vazia(self):
        """A chave existe SEMPRE, para a tela não distinguir "campo ausente" de
        "ninguém respondeu". Antes ela era `resposta: None`; virou lista vazia
        com a mudança para várias respostas por pedido.
        """
        pedido = self.novo_pedido()
        linha = self.ler(self.card.id)
        self.assertIn('respostas', linha)
        self.assertEqual(linha['respostas'], [])
        self.assertEqual(linha['total_respostas'], 0)

    def test_a_leitura_casa_rotulo_com_valor_na_ordem_da_definicao(self):
        pedido = self.novo_pedido()
        self.client.logout()
        self.assertEqual(self.postar(pedido.token, dict(
            VALIDO_MINIMO,
            respondente='Fulana de Tal',
            o_que_agradou='O prazo.\nE a comunicação.',
        )).status_code, 201)
        self.client.force_login(self.user)

        leitura = self.ler_resposta(self.card.id)
        self.assertEqual(
            [i['key'] for i in leitura['itens']], [p[0] for p in PERGUNTAS],
        )
        por_key = {i['key']: i for i in leitura['itens']}

        self.assertEqual(por_key['respondente']['label'], 'Seu nome:')
        self.assertEqual(por_key['respondente']['valor'], 'Fulana de Tal')
        self.assertEqual(por_key['respondente']['secao'], '1. Identificação')
        # As quebras de linha chegam à tela — `whitespace-pre-wrap` do lado dela.
        self.assertIn('\n', por_key['o_que_agradou']['valor'])
        self.assertEqual(por_key['atendeu_objetivo']['valor'], 'Sim')
        self.assertEqual(por_key['indicaria_time']['valor'], 9)

    def test_o_dominio_da_escala_acompanha_o_item(self):
        """É o que deixa a tela escrever "5 - Excelente" e "9 de 10" sem
        consultar o formulário por fora."""
        pedido = self.novo_pedido()
        self.client.logout()
        self.postar(pedido.token, VALIDO_MINIMO)
        self.client.force_login(self.user)

        por_key = {i['key']: i for i in self.ler_resposta(self.card.id)['itens']}

        com_rotulos = por_key['qualidade_entrega']
        self.assertEqual((com_rotulos['minimo'], com_rotulos['maximo']), (1, 5))
        self.assertEqual(com_rotulos['rotulos']['5'], 'Excelente')

        sem_rotulos = por_key['indicaria_time']
        self.assertEqual((sem_rotulos['minimo'], sem_rotulos['maximo']), (0, 10))
        self.assertNotIn('rotulos', sem_rotulos)

    def test_opcional_nao_respondido_aparece_com_valor_none_e_nao_some(self):
        """Omitir o item apagaria o fato de que a pergunta existia — com 5
        opcionais, isso distorceria a leitura inteira."""
        pedido = self.novo_pedido()
        self.client.logout()
        self.postar(pedido.token, VALIDO_MINIMO)
        self.client.force_login(self.user)

        itens = self.ler_resposta(self.card.id)['itens']
        self.assertEqual(len(itens), 12)
        por_key = {i['key']: i for i in itens}
        self.assertIsNone(por_key['ajustes_necessarios']['valor'])
        self.assertEqual(por_key['ajustes_necessarios']['label'],
                         'Se precisar de ajustes, descreva quais:')

    def test_enviado_em_sai_em_fuso_LOCAL_e_nao_em_UTC(self):
        """BUG REAL, 3 horas de erro. O helper de data do frontend casa o regex
        ISO, fatia hora e minuto MANUALMENTE e monta um Date local — DESCARTANDO
        o offset. Com o ISO em UTC, uma resposta das 14h03 renderiza 17h03.
        """
        pedido = self.novo_pedido()
        self.client.logout()
        self.postar(pedido.token, VALIDO_MINIMO)
        self.client.force_login(self.user)

        pedido.refresh_from_db()
        iso = self.ler_resposta(self.card.id)['enviado_em']
        esperado = timezone.localtime(pedido.respostas.first().enviado_em)

        # PRÉ-CONDIÇÃO: sem offset, este teste não prova nada — passaria igual
        # com o bug, porque em UTC a hora local e a UTC coincidem. É a mesma
        # precaução que os testes de prazo tomam com o relógio congelado.
        self.assertNotEqual(esperado.utcoffset(), dt.timedelta(0))

        # A hora que o frontend vai FATIAR da string tem de ser a hora local.
        self.assertEqual(iso[11:16], esperado.strftime('%H:%M'))
        self.assertNotIn('+00:00', iso)
        # E, mesmo com a hora trocada, o INSTANTE continua o mesmo — a correção
        # é de representação, não de valor.
        self.assertEqual(dt.datetime.fromisoformat(iso), pedido.respostas.first().enviado_em)

    def test_respondido_com_conteudo_apagado_pela_retencao_devolve_lista_vazia(self):
        """Esconder o caso faria parecer bug: a tela precisa dizer a verdade.

        E o CONTADOR cai junto: ele conta linhas VIVAS. É deliberado — o
        conteúdo some, o FATO fica no estado 'respondido' e em `respondido_em`,
        exatamente a política que a retenção já pratica.
        """
        pedido = self.novo_pedido()
        self.client.logout()
        self.postar(pedido.token, VALIDO_MINIMO)
        self.client.force_login(self.user)

        pedido.refresh_from_db()
        pedido.respostas.first().delete()  # é o que a política de retenção faz

        linha = self.ler(self.card.id)
        self.assertEqual(linha['estado'], EstadoPedido.RESPONDIDO)
        self.assertEqual(linha['respostas'], [])
        self.assertEqual(linha['total_respostas'], 0)

    def test_chave_gravada_fora_da_definicao_e_ignorada_na_leitura(self):
        """A whitelist da gravação impede que isso exista; se aparecer (edição à
        mão no banco), a leitura não pode mostrá-la sob rótulo nenhum."""
        pedido = self.novo_pedido()
        self.client.logout()
        self.postar(pedido.token, VALIDO_MINIMO)
        self.client.force_login(self.user)

        pedido.refresh_from_db()
        # A linha vai para uma VARIÁVEL. Antes eram dois acessos a
        # `pedido.resposta`, e só funcionava porque o OneToOne CACHEIA a
        # instância — com um manager, `pedido.respostas.first()` duas vezes são
        # dois objetos DIFERENTES, e o `save()` gravaria um objeto sem a
        # mutação. O teste passaria a não testar nada, sem erro nenhum.
        gravada = pedido.respostas.first()
        gravada.valores['injetado_a_mao'] = 'SEGREDO-INJETADO'
        gravada.save(update_fields=['valores'])

        leitura = self.ler_resposta(self.card.id)
        self.assertEqual(len(leitura['itens']), 12)
        self.assertNotIn('injetado_a_mao', [i['key'] for i in leitura['itens']])

    def test_a_leitura_exige_login_e_permissao(self):
        pedido = self.novo_pedido()
        self.client.logout()
        self.assertIn(
            self.client.get(f'/api/feedbacks/pedidos/?card={self.card.id}').status_code,
            (401, 403),
        )

        sem_permissao = User.objects.create_user(username='curioso', password='x' * 12)
        self.client.force_login(sem_permissao)
        self.assertIn(
            self.client.get(f'/api/feedbacks/pedidos/?card={self.card.id}').status_code,
            (401, 403),
        )

    def test_sem_parametro_card_a_lista_sai_vazia(self):
        """O endpoint entrega o TOKEN: "listar tudo" aqui é o chaveiro inteiro.
        Vale igual para a resposta, que agora traz nome de pessoa e crítica."""
        self.novo_pedido()
        for query in ('', '?card=', '?card=abc', '?card=0'):
            with self.subTest(query=query):
                corpo = self.client.get(f'/api/feedbacks/pedidos/{query}').json()
                self.assertEqual(corpo['results'], [])

    def test_a_resposta_nao_vaza_por_nenhuma_listagem_de_card(self):
        """PORTO INEGOCIÁVEL: `resposta` não entra em CardSerializer."""
        from apps.projects.serializers import CardSerializer

        self.assertNotIn('resposta', CardSerializer().fields)


# =========================================================================== #
# 5. A VERSÃO 1 CONTINUA VIVA E LEGÍVEL
# =========================================================================== #
class RetrocompatibilidadeComAVersao1Tests(BaseV2):
    """O procedimento de 2 passos só vale alguma coisa se a v1 continuar sendo
    LIDA sem erro. Aqui isso é provado contra a linha REAL que a migration 0002
    semeou e a 0005 desativou — nenhuma fixture."""

    def versao_1(self) -> FeedbackFormulario:
        return FeedbackFormulario.objects.get(slug='padrao', versao=1)

    def pedido_na_v1(self) -> PedidoFeedback:
        """Um pedido apontando para a v1 — que é o estado real de todo link
        gerado ANTES da 0005, já que a FK é congelada nos `defaults` do
        `get_or_create` e `defaults` só se aplica na CRIAÇÃO."""
        pedido = self.novo_pedido()
        PedidoFeedback.objects.filter(pk=pedido.pk).update(
            formulario=self.versao_1(),
        )
        pedido.refresh_from_db()
        return pedido

    def test_a_linha_da_v1_nao_foi_editada_so_perdeu_o_flag(self):
        v1 = self.versao_1()
        self.assertFalse(v1.ativo)
        self.assertEqual(v1.titulo, 'Sua opinião sobre o projeto entregue')
        self.assertEqual([c['key'] for c in v1.campos], ['comentario'])
        self.assertEqual(v1.subtitulo, '')

    def test_o_get_de_um_pedido_da_v1_sai_como_sempre_saiu(self):
        """Byte a byte: as MESMAS cinco chaves de campo, sem `secao`, sem
        `opcoes`, sem `minimo`. É a retrocompatibilidade ESTRUTURAL — não
        depende de ninguém lembrar de nada."""
        pedido = self.pedido_na_v1()
        corpo = self.client.get(self.url(pedido.token)).json()

        self.assertEqual(set(corpo), {'titulo', 'subtitulo', 'referencia', 'data_entrega', 'campos'})
        self.assertEqual(corpo['titulo'], 'Sua opinião sobre o projeto entregue')
        # Versão sem subtítulo devolve '' — a página só não renderiza o parágrafo.
        self.assertEqual(corpo['subtitulo'], '')
        self.assertEqual(corpo['campos'], [{
            'key': 'comentario',
            'label': 'Conte como foi sua experiência com o projeto entregue.',
            'tipo': 'texto_longo',
            'obrigatorio': True,
            'max_length': 2000,
        }])

    def test_a_v1_continua_respondivel_com_a_chave_dela(self):
        pedido = self.pedido_na_v1()
        resposta = self.postar(pedido.token, {'comentario': 'foi ótimo'})
        self.assertEqual(resposta.status_code, 201)

        pedido.refresh_from_db()
        self.assertEqual(pedido.respostas.first().valores, {'comentario': 'foi ótimo'})

    def test_a_chave_da_v2_e_recusada_num_pedido_da_v1(self):
        """A validação segue a definição DAQUELE pedido, não a ativa."""
        pedido = self.pedido_na_v1()
        self.assertEqual(self.postar(pedido.token, VALIDO_MINIMO).status_code, 400)

    def test_uma_resposta_da_v1_e_lida_sob_os_rotulos_da_v1(self):
        """O defeito que o versionamento existe para impedir: a resposta velha
        aparecer sob os rótulos do formulário NOVO."""
        pedido = self.pedido_na_v1()
        self.postar(pedido.token, {'comentario': 'respondi no formulário velho'})

        pedido.refresh_from_db()
        leitura = resposta_legivel(pedido, pedido.respostas.first())

        self.assertEqual(len(leitura['itens']), 1)
        item = leitura['itens'][0]
        self.assertEqual(item['key'], 'comentario')
        self.assertEqual(
            item['label'], 'Conte como foi sua experiência com o projeto entregue.',
        )
        self.assertEqual(item['valor'], 'respondi no formulário velho')
        # Campo sem `secao` na definição sai com '' — e a tela o renderiza solto.
        self.assertEqual(item['secao'], '')

    def test_a_resposta_da_v1_e_lida_PELO_ENDPOINT_e_nao_so_pela_funcao(self):
        """O teste acima chama `resposta_legivel` direto; este passa pelo HTTP.

        A diferença não é cerimônia: o viewset traz `select_related('formulario',
        'resposta')` e o serializer monta o item — é aí que uma definição ANTIGA
        (sem `secao`, sem domínio, com uma chave só) encontraria o código escrito
        para doze campos. Se isso quebrasse, quebraria para todo link já enviado.
        """
        pedido = self.pedido_na_v1()
        self.postar(pedido.token, {'comentario': 'do formulário velho'})

        self.user.user_permissions.add(
            Permission.objects.get(codename='view_content')
        )
        self.user = User.objects.get(pk=self.user.pk)  # limpa o cache de permissões
        self.client.force_login(self.user)

        corpo = self.client.get(f'/api/feedbacks/pedidos/?card={self.card.id}')
        self.assertEqual(corpo.status_code, 200)
        leitura = corpo.json()['results'][0]['respostas'][0]

        self.assertEqual(leitura['itens'], [{
            'key': 'comentario',
            'label': 'Conte como foi sua experiência com o projeto entregue.',
            'tipo': 'texto_longo',
            'secao': '',
            'valor': 'do formulário velho',
        }])
        # E NADA da versão 2 encosta nesta leitura — é o defeito inteiro que o
        # versionamento existe para impedir.
        self.assertNotIn('Seu nome:', corpo.content.decode())

    def test_a_v1_e_a_v2_convivem_no_mesmo_banco_cada_uma_com_a_sua_leitura(self):
        """Duas respostas, duas definições, duas leituras — simultâneas."""
        velho = self.pedido_na_v1()
        self.postar(velho.token, {'comentario': 'da versão 1'})

        novo = self.novo_pedido(card=self.novo_card('Card da v2'))
        self.assertEqual(novo.formulario.versao, 3)
        self.postar(novo.token, dict(VALIDO_MINIMO, respondente='Beltrano'))

        velho.refresh_from_db()
        novo.refresh_from_db()

        self.assertEqual(
            [i['key'] for i in resposta_legivel(velho, velho.respostas.first())['itens']], ['comentario'],
        )
        self.assertEqual(
            [i['key'] for i in resposta_legivel(novo, novo.respostas.first())['itens']],
            [p[0] for p in PERGUNTAS],
        )


# =========================================================================== #
# 6. O PROCEDIMENTO DE 2 PASSOS, NOS DOIS SENTIDOS
# =========================================================================== #
class ProcedimentoDeDoisPassosTests(BaseV2):
    """O `semear` da 0005 já é exercitado por toda a suíte (é ele que deixa a v2
    ativa no banco de teste). O `remover` NÃO era exercitado por nada — e ele é
    o mais perigoso dos dois.

    Se o reverse esquecer de REATIVAR a v1, `services.formulario_ativo` levanta
    `DoesNotExist`, e essa exceção é ENGOLIDA pelo try/except de
    `estrutura.gerar_pedidos_do_projeto` (que roda em `on_commit` e não pode
    deixar nada subir). A feature ficaria INERTE, em silêncio, sem um único erro
    na tela. Um rollback de deploy é exatamente quando ninguém está olhando.
    """

    def migration(self):
        """A 0005 de verdade, importada pelo nome.

        `apps.get_model` do registro REAL serve no lugar do histórico: os campos
        de `FeedbackFormulario` não mudaram desde a 0005, então o model
        histórico dela e o atual são a mesma coisa. Reescrever `semear`/`remover`
        no teste provaria o teste, não a migration.

        A frase que estava aqui — "a 0005 é a última migration do app" — é FALSA
        desde a 0006/0007, e era a CAUSA da quebra desta classe: reverter só a
        0005 com a v3 ainda ativa viola `uniq_formulario_ativo_por_slug`, porque
        o passo (c) reativa a v1 e ficam DUAS ativas. O Django nunca faz isso —
        ele reverte 0007 antes. Ver `reverter_ate_a_v1`.
        """
        from importlib import import_module

        return import_module('apps.feedbacks.migrations.0005_seed_formulario_v2')

    def migration_v3(self):
        """A 0007, que hoje é quem deixa a v3 ativa."""
        from importlib import import_module

        return import_module('apps.feedbacks.migrations.0007_seed_formulario_v3')

    def reverter_ate_a_v1(self):
        """O rollback na ORDEM REAL: da migration mais nova para a mais velha.

        É assim que o Django desfaz, e é a única ordem em que a constraint
        parcial (não deferrable) nunca fica com duas ativas no mesmo slug.
        """
        from django.apps import apps as registro

        self.migration_v3().desfazer(registro, None)   # v3 → v2 ativa
        self.migration().remover(registro, None)       # v2 → v1 ativa

    def test_o_reverse_reativa_a_versao_1_e_a_feature_continua_de_pe(self):
        from .services import formulario_ativo

        self.reverter_ate_a_v1()

        ativo = formulario_ativo('padrao')
        self.assertEqual(ativo.versao, 1)
        # E o motor volta a conseguir criar pedido — que é o que "inerte" nega.
        pedido = self.novo_pedido(card=self.novo_card('Depois do rollback'))
        self.assertEqual(pedido.formulario.versao, 1)

    def test_o_reverse_preserva_a_definicao_que_tem_pedido_apontando(self):
        """Apagar uma definição com pedidos tornaria as respostas ilegíveis — e
        a FK é PROTECT, então a alternativa seria estourar no meio do rollback.
        """
        pedido = self.novo_pedido()
        # O pedido nasce na versão ATIVA, que desde a 0007 é a 3.
        self.assertEqual(pedido.formulario.versao, 3)

        self.reverter_ate_a_v1()

        # A definição que o pedido usa sobreviveu (só saiu de `ativo`), e a
        # leitura dele continua possível.
        self.assertTrue(
            FeedbackFormulario.objects.filter(slug='padrao', versao=3).exists(),
        )
        pedido.refresh_from_db()
        self.assertEqual(pedido.formulario.versao, 3)
        self.assertFalse(pedido.formulario.ativo)

    def test_semear_e_idempotente_e_converge_em_vez_de_duplicar(self):
        from django.apps import apps as registro

        # Re-semear a 0007 (a última): rodar duas vezes tem de convergir, não
        # duplicar. É a propriedade que interessa em migration de dado, e quem a
        # exerce hoje é a v3 — re-semear a 0005 com a v3 ativa seria encenar uma
        # ordem que o Django nunca executa.
        migration = self.migration_v3()
        migration.semear(registro, None)
        migration.semear(registro, None)

        self.assertEqual(
            FeedbackFormulario.objects.filter(slug='padrao').count(), 3,
        )
        self.assertEqual(
            FeedbackFormulario.objects.filter(slug='padrao', ativo=True).count(), 1,
        )
        self.assertEqual(self.ativo().versao, 3)


# =========================================================================== #
# 7. O CONTRATO DA ROTA ANÔNIMA COM O FORMULÁRIO NOVO — o dicionário INTEIRO
# =========================================================================== #

# O payload EXATO da versão 2, escrito à mão. Existe uma versão deste contrato
# em `tests_requisitos.Req08` — mas ela publica uma definição própria de UM campo
# de texto, de propósito, porque lá o assunto é a FORMA do payload. Nenhum teste
# do sistema afirmava o que sai na rota ANÔNIMA com as doze perguntas de verdade,
# e é justamente nelas que estão as chaves condicionais (`opcoes`, `minimo`,
# `maximo`, `rotulos`, `secao`) — as únicas que podem carregar dado da definição
# para fora.
#
# `assertEqual` do dicionário inteiro, e nunca `assertIn`: uma chave NOVA em
# qualquer um dos doze campos quebra aqui. É o formato de asserção que transforma
# "não vaza dado interno" em algo verificável, porque o teste falha tanto por
# falta quanto por SOBRA.
#
# A duplicação com `PERGUNTAS` é deliberada e está travada por
# `test_as_duas_copias_deste_arquivo_nao_podem_divergir`: uma lista descreve o
# QUE foi perguntado (5 atributos), a outra descreve o que VAI NO FIO (todas as
# chaves, incluindo as que `PERGUNTAS` não carrega). Ficam no mesmo arquivo para
# que uma pergunta alterada quebre as duas de uma vez, no mesmo lugar.
CAMPOS_PUBLICOS_ESPERADOS = [
    {
        'key': 'respondente',
        'label': 'Seu nome:',
        'tipo': 'texto',
        'obrigatorio': False,
        'max_length': 120,
        'secao': '1. Identificação',
    },
    # Campo da VERSÃO 3 (migration 0007), inserido na posição 1 — nada mais da
    # definição mudou.
    {
        'key': 'setor_respondente',
        'label': 'Seu setor:',
        'tipo': 'texto',
        'obrigatorio': False,
        'max_length': 120,
        'secao': '1. Identificação',
    },
    {
        'key': 'atendeu_objetivo',
        'label': 'O projeto atendeu ao objetivo esperado?',
        'tipo': 'escolha_unica',
        'obrigatorio': True,
        'max_length': 60,
        'secao': '2. Avaliação Geral',
        'opcoes': ['Sim', 'Parcialmente', 'Não'],
    },
    {
        'key': 'indicaria_time',
        'label': 'De 0 a 10, o quanto você indicaria esse time para novos projetos?',
        'tipo': 'escala',
        'obrigatorio': True,
        'max_length': 2,
        'secao': '2. Avaliação Geral',
        'minimo': 0,
        'maximo': 10,
    },
    {
        'key': 'qualidade_entrega',
        'label': 'Como você avalia a qualidade da entrega?',
        'tipo': 'escala',
        'obrigatorio': True,
        'max_length': 1,
        'secao': '3. Qualidade da Entrega',
        'minimo': 1,
        'maximo': 5,
        'rotulos': {
            '1': 'Péssimo', '2': 'Ruim', '3': 'Bom', '4': 'Ótimo', '5': 'Excelente',
        },
    },
    {
        'key': 'o_que_agradou',
        'label': 'O que mais te agradou na entrega?',
        'tipo': 'texto_longo',
        'obrigatorio': False,
        'max_length': 2000,
        'secao': '3. Qualidade da Entrega',
    },
    {
        'key': 'comunicacao_clara',
        'label': 'A comunicação durante o projeto foi clara?',
        'tipo': 'escala',
        'obrigatorio': True,
        'max_length': 1,
        'secao': '4. Comunicação e Processo',
        'minimo': 1,
        'maximo': 5,
    },
    {
        'key': 'prazo_adequado',
        'label': 'O prazo de entrega foi adequado?',
        'tipo': 'escala',
        'obrigatorio': True,
        'max_length': 1,
        'secao': '4. Comunicação e Processo',
        'minimo': 1,
        'maximo': 5,
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
    {
        'key': 'status_final',
        'label': 'Considerando sua necessidade, o projeto está:',
        'tipo': 'escolha_unica',
        'obrigatorio': True,
        'max_length': 60,
        'secao': '6. Status Final',
        'opcoes': [
            'Pronto para uso',
            'Precisa de pequenos ajustes',
            'Precisa de melhorias relevantes',
        ],
    },
    {
        'key': 'ajustes_necessarios',
        'label': 'Se precisar de ajustes, descreva quais:',
        'tipo': 'texto_longo',
        'obrigatorio': False,
        'max_length': 2000,
        'secao': '6. Status Final',
    },
]


class ContratoPublicoDaVersao2Tests(BaseV2):
    """O que um ANÔNIMO recebe. Nem um byte a mais."""

    def test_o_corpo_do_get_e_o_dicionario_inteiro_do_formulario_novo(self):
        pedido = self.novo_pedido()
        corpo = self.client.get(self.url(pedido.token)).json()

        self.assertEqual(corpo, {
            'titulo': 'Feedback de Entrega de Projeto - BWA',
            'subtitulo': (
                'Olá! Queremos melhorar continuamente nossos projetos. '
                'Seu feedback é essencial e leva menos de 2 minutos'
            ),
            # Rótulo do formulário ("Nome do projeto:"), VALOR do card — e é
            # `referencia_publica`, cópia congelada, não um join em Card.
            'referencia': self.card.nome,
            # 5ª chave do contrato público: a data de entrega, para a tela de
            # apresentação dizer "entregue em X". É `data_referencia`, coluna do
            # próprio pedido — continua sem join em Card/Project/Sprint.
            'data_entrega': pedido.data_referencia.isoformat(),
            'campos': CAMPOS_PUBLICOS_ESPERADOS,
        })

    def test_as_duas_copias_deste_arquivo_nao_podem_divergir(self):
        """Trava `PERGUNTAS` e `CAMPOS_PUBLICOS_ESPERADOS` uma na outra.

        Sem isto, alterar uma pergunta em só uma das listas deixaria a outra
        passando verde descrevendo um formulário que não existe — exatamente o
        risco que o cabeçalho deste arquivo levanta sobre duplicar a lista.
        """
        self.assertEqual(
            [(c['key'], c['label'], c['tipo'], c['obrigatorio'], c['secao'])
             for c in CAMPOS_PUBLICOS_ESPERADOS],
            PERGUNTAS,
        )

    def test_o_corpo_cru_nao_traz_nenhum_dado_interno_do_card_marcado(self):
        """Com doze campos a superfície do payload cresceu; a regra não mudou.

        O pedido aqui tem CARD DE KANBAN (o caso da fase 2, mais rico que o da
        fase 1 pura) — se algum join nascesse num refactor, é neste caminho que
        ele apareceria primeiro.
        """
        kanban = self.novo_card('SEGREDO-CARD-KANBAN')
        pedido = self.novo_pedido(card_kanban_id=kanban.id)

        bruto = self.client.get(self.url(pedido.token)).content.decode()
        for interno in ('SEGREDO-CARD-KANBAN', pedido.token, 'Projeto V2',
                        'Sprint V2', 'Setor V2', 'v2-tester'):
            with self.subTest(interno=interno):
                self.assertNotIn(interno, bruto)


# =========================================================================== #
# 8. O ARMAZENAMENTO — "os forms preenchidos devem ser armazenados no banco"
# =========================================================================== #

# O formulário INTEIRO respondido, exatamente como o navegador o envia: TUDO
# string, porque o estado da página é Record<string,string> (o rascunho em
# localStorage só sobrevive como string). Os espaços em ' 03 ' e '  Fulana… '
# são de propósito — é assim que chega de um campo de verdade.
ENVIADO_COMPLETO = {
    'respondente': '  Fulana de Tal  ',
    # Campo da v3 (migration 0007), com espaços para provar o `strip` também nele.
    'setor_respondente': '  Financeiro  ',
    'atendeu_objetivo': 'Parcialmente',
    'indicaria_time': '9',
    'qualidade_entrega': '4',
    'o_que_agradou': 'A entrega veio no prazo.\nO time foi atencioso.',
    'comunicacao_clara': '5',
    'prazo_adequado': ' 03 ',
    'o_que_melhorar': 'Alinhar o escopo antes de começar.',
    'faria_diferente': 'Faria uma reunião de kickoff logo no primeiro dia.',
    'status_final': 'Precisa de pequenos ajustes',
    'ajustes_necessarios': 'Ajustar o rodapé e o e-mail de contato.',
}

# O que tem de estar NA COLUNA depois. As diferenças em relação ao enviado são o
# assunto: escala vira INTEIRO (9, não '9'; 3, não ' 03 ') e texto vem
# `strip`ado. Escolha única guarda a STRING EXATA da opção, nunca um código.
GRAVADO_ESPERADO = {
    'respondente': 'Fulana de Tal',
    'setor_respondente': 'Financeiro',
    'atendeu_objetivo': 'Parcialmente',
    'indicaria_time': 9,
    'qualidade_entrega': 4,
    'o_que_agradou': 'A entrega veio no prazo.\nO time foi atencioso.',
    'comunicacao_clara': 5,
    'prazo_adequado': 3,
    'o_que_melhorar': 'Alinhar o escopo antes de começar.',
    'faria_diferente': 'Faria uma reunião de kickoff logo no primeiro dia.',
    'status_final': 'Precisa de pequenos ajustes',
    'ajustes_necessarios': 'Ajustar o rodapé e o e-mail de contato.',
}

OPCIONAIS = ('respondente', 'setor_respondente', 'o_que_agradou', 'o_que_melhorar',
             'faria_diferente', 'ajustes_necessarios')
OBRIGATORIAS = ('atendeu_objetivo', 'indicaria_time', 'qualidade_entrega',
                'comunicacao_clara', 'prazo_adequado', 'status_final')


class ArmazenamentoNoBancoTests(BaseV2):
    """O pedido LITERAL do usuário: "os forms preenchidos devem ser armazenados
    no banco".

    A conferência é feita NA COLUNA, por uma consulta NOVA — `values_list` do
    campo `valores`, não o objeto que ficou na memória depois do POST. É a
    diferença entre provar que o serializer devolveu 201 e provar que o dado
    atravessou o commit e está no Postgres.
    """

    def gravado(self, pedido) -> dict:
        """O conteúdo da coluna `valores`, lido do banco e de mais nada.

        `.filter(...).first()` e não `.get()`: um pedido pode ter VÁRIAS
        respostas agora, e o `.get()` levantaria `MultipleObjectsReturned`. A
        ordenação do model já entrega a mais recente primeiro.
        """
        return RespostaFeedback.objects.filter(
            pedido_id=pedido.pk,
        ).values_list('valores', flat=True).first()

    def responder_tudo(self, card=None, **sobrescreve):
        pedido = self.novo_pedido(card=card)
        valores = dict(ENVIADO_COMPLETO)
        valores.update(sobrescreve)
        return pedido, self.postar(pedido.token, valores)

    def test_as_doze_respostas_ficam_no_banco_chave_por_chave(self):
        pedido, resposta = self.responder_tudo()
        self.assertEqual(resposta.status_code, 201)

        gravado = self.gravado(pedido)
        # As ONZE chaves, e nenhuma além delas.
        self.assertEqual(set(gravado), {p[0] for p in PERGUNTAS})
        # E os doze VALORES, um a um — o dicionário inteiro, não `assertIn`.
        self.assertEqual(gravado, GRAVADO_ESPERADO)
        self.assertEqual(RespostaFeedback.objects.count(), 1)

    def test_o_tipo_gravado_e_o_do_dominio_e_nao_o_que_o_navegador_mandou(self):
        """Quem converte é o SERVIDOR. Sem isto, a leitura teria de fazer
        parsing para calcular média de NPS ou distribuição de 1 a 5 — e um dia
        alguém compararia '10' < '9' como string."""
        pedido, _ = self.responder_tudo()
        gravado = self.gravado(pedido)

        for key in ('indicaria_time', 'qualidade_entrega', 'comunicacao_clara',
                    'prazo_adequado'):
            with self.subTest(campo=key):
                self.assertIsInstance(gravado[key], int)
                # `isinstance(True, int)` é True: sem esta linha, um bool
                # gravado passaria pela asserção acima.
                self.assertNotIsInstance(gravado[key], bool)

        for key in ('atendeu_objetivo', 'status_final', 'respondente',
                    'o_que_agradou', 'o_que_melhorar', 'faria_diferente',
                    'ajustes_necessarios'):
            with self.subTest(campo=key):
                self.assertIsInstance(gravado[key], str)

    def test_a_resposta_fica_ligada_ao_card_e_a_versao_que_a_pessoa_viu(self):
        """Guardar sem saber DE QUE entrega é, e contra QUAL definição, não serve.

        As duas pontas são o que tornam a linha legível daqui a seis meses: o
        card diz o assunto, a versão do formulário diz sob quais rótulos aqueles
        valores foram respondidos.
        """
        pedido, _ = self.responder_tudo()

        # `.filter().first()` e não `.get()`: com várias respostas por pedido o
        # `.get()` levanta MultipleObjectsReturned.
        linha = RespostaFeedback.objects.select_related(
            'pedido__formulario',
        ).filter(pedido_id=pedido.pk).first()
        self.assertEqual(linha.pedido.card_id, self.card.id)
        # 3 CRAVADO, e nunca "a versão ativa": a FK do formulário é CONGELADA na
        # criação do pedido, e é exatamente isso que este teste prova. Compará-la
        # com a ativa destruiria a asserção. O número subiu para 3 na migration
        # 0007, que semeou a v3 com o campo "Seu setor:".
        self.assertEqual(linha.pedido.formulario.versao, 3)
        self.assertIsNotNone(linha.enviado_em)

        # E a máquina de estados acompanhou: é o que leva o card para
        # "Feedback colhido".
        pedido.refresh_from_db()
        self.assertEqual(pedido.estado, EstadoPedido.RESPONDIDO)
        self.assertIsNotNone(pedido.respondido_em)
        carimbo = pedido.respondido_em

        # E a SEGUNDA resposta não redefine nada: o card entra em "Feedback
        # colhido" na primeira e fica lá; as seguintes só somam ao contador.
        # `respondido_em` é o corte da retenção e não pode ser reiniciado por um
        # anônimo com o link.
        self.assertEqual(self.postar(pedido.token, ENVIADO_COMPLETO).status_code, 201)
        pedido.refresh_from_db()
        self.assertEqual(pedido.respostas.count(), 2)
        self.assertEqual(pedido.estado, EstadoPedido.RESPONDIDO)
        self.assertEqual(pedido.respondido_em, carimbo)

    def test_o_conteudo_nao_e_apagado_pela_varredura_diaria_de_retencao(self):
        """A única rotina do sistema que apaga resposta roda TODO DIA.

        As duas configurações entram EXPLÍCITAS, e nenhuma asserção depende do
        setting ambiente: definir o prazo de retenção é decisão de negócio que o
        próprio código convida a tomar, e um teste ancorado no valor de hoje
        falharia no dia em que o usuário tomasse essa decisão — sem que nada
        estivesse quebrado.

        Os testes de retenção que já existiam usam o formulário de UM campo;
        aqui o assunto é o de ONZE, que é o que o usuário pediu para guardar.
        """
        from .tasks import limpar_respostas_expiradas

        pedido, _ = self.responder_tudo()

        with override_settings(FEEDBACK_RETENCAO_DIAS=0):
            self.assertTrue(limpar_respostas_expiradas()['desligado'])

        with override_settings(FEEDBACK_RETENCAO_DIAS=30):
            # Respondido HOJE, prazo de 30 dias: está longe do corte.
            self.assertEqual(limpar_respostas_expiradas()['apagadas'], 0)

        self.assertEqual(self.gravado(pedido), GRAVADO_ESPERADO)

    def test_obrigatoria_AUSENTE_do_payload_e_recusada_e_nada_e_gravado(self):
        """Chave FORA do dicionário, e não string vazia: é o que chega de um
        cliente antigo, de um script, ou de um curl à mão na rota anônima."""
        for key in OBRIGATORIAS:
            with self.subTest(campo=key):
                valores = {k: v for k, v in ENVIADO_COMPLETO.items() if k != key}
                pedido = self.novo_pedido(card=self.novo_card(f'Sem {key}'))
                resposta = self.postar(pedido.token, valores)

                self.assertEqual(resposta.status_code, 400)
                self.assertIn('obrigatório', str(resposta.json()))

        # Seis tentativas, nenhuma linha: meio formulário gravado seria pior que
        # nenhum, porque a leitura ficaria mentindo sobre o que foi respondido.
        self.assertEqual(RespostaFeedback.objects.count(), 0)

    def test_opcional_ausente_e_opcional_vazio_sao_os_dois_ACEITOS(self):
        """Duas formas de "não respondi", e as duas têm de valer.

        A chave FORA do payload é o cliente que nunca tocou no campo; a chave
        presente com '' (ou só espaço) é o que a PÁGINA manda, porque o estado
        dela é Record<string,string> e todo campo nasce ''. Se a segunda fosse
        recusada, o formulário seria impossível de enviar sem preencher os cinco
        opcionais — e a validação que recusa vazio é a MESMA das obrigatórias.
        """
        so_obrigatorias = {
            k: v for k, v in ENVIADO_COMPLETO.items() if k not in OPCIONAIS
        }
        pedido_ausente = self.novo_pedido(card=self.novo_card('Opcionais ausentes'))
        self.assertEqual(
            self.postar(pedido_ausente.token, so_obrigatorias).status_code, 201,
        )

        # Metade '' e metade só espaço: `strip` é o que faz '   ' NÃO ser
        # resposta — sem ele, três espaços virariam texto gravado.
        vazios = dict(ENVIADO_COMPLETO)
        vazios.update({
            key: ('' if indice % 2 else '   ')
            for indice, key in enumerate(OPCIONAIS)
        })
        pedido_vazio = self.novo_pedido(card=self.novo_card('Opcionais vazios'))
        self.assertEqual(self.postar(pedido_vazio.token, vazios).status_code, 201)

        for pedido in (pedido_ausente, pedido_vazio):
            with self.subTest(pedido=pedido.pk):
                gravado = self.gravado(pedido)
                # As seis obrigatórias, e SÓ elas: o opcional não respondido fica
                # AUSENTE em vez de virar '' — cinco linhas vazias na leitura, e
                # string num campo cujo tipo é inteiro.
                self.assertEqual(set(gravado), set(OBRIGATORIAS))
                for key in OPCIONAIS:
                    self.assertNotIn(key, gravado)


class LeituraDasDozeRespostasTests(BaseV2):
    """Item que fecha o requisito: guardar sem conseguir ler não serve.

    A leitura sai do MESMO payload que a fase 2 já busca para montar o botão de
    copiar link (`GET /api/feedbacks/pedidos/?card=<id>`), sob o MESMO gate —
    zero requisição nova, zero rota nova.
    """

    def setUp(self):
        super().setUp()
        self.user.user_permissions.add(
            Permission.objects.get(codename='view_content')
        )
        self.user = User.objects.get(pk=self.user.pk)  # limpa o cache de permissões

    def responder(self, pedido):
        return self.postar(pedido.token, ENVIADO_COMPLETO)

    def ler(self, card_id: int):
        return self.client.get(f'/api/feedbacks/pedidos/?card={card_id}')

    def test_quem_tem_acesso_le_as_doze_respostas_sob_os_rotulos_certos(self):
        pedido = self.novo_pedido()
        self.assertEqual(self.responder(pedido).status_code, 201)

        self.client.force_login(self.user)
        corpo = self.ler(self.card.id).json()['results'][0]

        itens = corpo['respostas'][0]['itens']
        self.assertEqual(len(itens), 12)
        # Rótulo, seção e valor casados NO SERVIDOR, contra a definição DAQUELE
        # pedido — e na ordem da definição, que é a ordem em que a pessoa
        # respondeu.
        self.assertEqual(
            [(i['key'], i['label'], i['secao'], i['valor']) for i in itens],
            [(c['key'], c['label'], c['secao'], GRAVADO_ESPERADO[c['key']])
             for c in CAMPOS_PUBLICOS_ESPERADOS],
        )

    def test_quem_nao_tem_acesso_nao_le(self):
        pedido = self.novo_pedido()
        self.responder(pedido)

        # Anônimo.
        self.assertIn(self.ler(self.card.id).status_code, (401, 403))

        # Logado, mas sem `view_content` — o gate do resto da plataforma.
        curioso = User.objects.create_user(username='curioso-v2', password='x' * 12)
        self.client.force_login(curioso)
        self.assertIn(self.ler(self.card.id).status_code, (401, 403))

    def test_a_resposta_de_um_card_nao_aparece_na_consulta_de_outro(self):
        """O texto respondido traz NOME DE PESSOA e crítica aberta à entrega.

        O endpoint é por card — perguntar por outro card não pode devolver, nem
        de raspão, o que foi respondido neste.
        """
        respondido = self.novo_pedido()
        self.responder(respondido)

        outro = self.novo_card('Outra entrega')
        pedido_outro = self.novo_pedido(card=outro)

        self.client.force_login(self.user)
        corpo = self.ler(outro.id)
        bruto = corpo.content.decode()

        self.assertEqual(corpo.json()['results'][0]['id'], pedido_outro.pk)
        self.assertEqual(corpo.json()['results'][0]['respostas'], [])
        self.assertEqual(corpo.json()['results'][0]['total_respostas'], 0)
        self.assertNotIn('Fulana de Tal', bruto)
        self.assertNotIn('Alinhar o escopo', bruto)

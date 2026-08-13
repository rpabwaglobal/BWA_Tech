"""
VÁRIAS RESPOSTAS POR LINK, e o contador que o preview do card mostra.

Pedido literal do usuário: "mais de um usuário deve poder responder o feedback,
o link do formulário não deve expirar" e "quando houver feedback colhido, coloque
um campo mostrando o número de feedbacks colhidos".

Os arquivos irmãos já cobrem cada regra no seu contexto (a rota pública em
`tests_requisitos`, o ataque em `tests_seguranca*`, o formulário em
`tests_formulario_v2`). O que mora AQUI é o que nasceu com esta entrega e não
tem dono natural em nenhum deles:

  1. o CONTADOR — de onde ele sai, e o que ele conta;
  2. o LOTE (`?cards=`) que o preview do board usa, e o que ele NÃO carrega;
  3. `resposta_legivel` como unidade, agora que ela recebe a linha;
  4. a MIGRATION 0008, que precisa preservar as respostas já gravadas.

O contador é dado INTERNO. Nenhum teste aqui é sobre a rota anônima devolvê-lo —
a garantia contrária está travada em `tests_seguranca_tipos` e em `tests.py`.
"""
from __future__ import annotations

from datetime import timedelta

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Permission
from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone

from apps.accounts.models import SetorCatalogo
from apps.projects.models import Card, Project, Sprint

from ._apoio_testes import chave_de_texto, resposta_valida
from .models import PedidoFeedback, RespostaFeedback
from .serializers import resposta_legivel
from .services import criar_pedido_feedback

User = get_user_model()


class BaseMultiplas(TestCase):
    """Cadeia mínima Sprint -> Project -> Card, com quem lê já autenticado."""

    def setUp(self):
        # O throttle da rota anônima conta em cache; resíduo de outro teste vira
        # 429 e a falha aponta para o lugar errado.
        cache.clear()
        self.user = User.objects.create_user(username='leitor', password='x' * 12)
        self.setor = SetorCatalogo.objects.create(codename='tec', nome='Tecnologia')
        agora = timezone.now()
        self.sprint = Sprint.objects.create(
            nome='Sprint N', data_inicio=agora,
            fechamento_em=agora + timedelta(days=7), duracao_dias=7,
            supervisor=self.user, setor=self.setor,
        )
        self.projeto = Project.objects.create(nome='Projeto N', sprint=self.sprint)
        self.card = Card.objects.create(nome='Tela de login', projeto=self.projeto)
        self.pedido = self.novo_pedido(self.card)

    # --- utilidades --------------------------------------------------------

    def novo_card(self, nome: str) -> Card:
        return Card.objects.create(nome=nome, projeto=self.projeto)

    def novo_pedido(self, card) -> PedidoFeedback:
        return criar_pedido_feedback(
            card_id=card.id,
            data_referencia=timezone.localdate(),
            referencia_publica=card.nome,
        )

    def url(self, token: str) -> str:
        return f'/api/feedback/{token}/'

    def responder(self, pedido, texto='tudo certo'):
        return self.client.post(
            self.url(pedido.token),
            {'valores': resposta_valida(pedido.formulario.campos, texto)},
            content_type='application/json',
        )

    def logar(self):
        self.user.user_permissions.add(
            Permission.objects.get(codename='view_content'))
        self.user = User.objects.get(pk=self.user.pk)  # limpa o cache de permissões
        self.client.force_login(self.user)

    def ler_um(self, card_id: int) -> dict:
        r = self.client.get(f'/api/feedbacks/pedidos/?card={card_id}')
        self.assertEqual(r.status_code, 200)
        return r.json()['results'][0]


# =========================================================================== #
# 1. O CONTADOR
# =========================================================================== #
class ContadorDeRespostasTests(BaseMultiplas):

    def test_o_contador_conta_as_linhas_vivas(self):
        """DECISÃO EXPLÍCITA: o contador é `Count('respostas')`, não uma coluna.

        A alternativa (coluna acumulada, incrementada no POST) faria a métrica
        sobreviver ao expurgo da retenção, como `respondido_em`. Ela foi
        descartada: é maior (coluna + backfill + F()+1 + risco de divergir das
        linhas reais), a retenção está DESLIGADA hoje, e cair junto com o texto é
        coerente com o que a tela já pratica — o conteúdo some, o FATO fica na
        coluna "Feedback colhido".

        A segunda metade deste teste é o que prende essa decisão: apagar uma
        linha (que é exatamente o que a retenção faz) TEM de baixar o contador.
        """
        for i in range(3):
            self.assertEqual(self.responder(self.pedido, f'opinião {i}').status_code, 201)

        self.logar()
        self.assertEqual(self.ler_um(self.card.id)['total_respostas'], 3)

        self.pedido.respostas.first().delete()

        self.assertEqual(self.ler_um(self.card.id)['total_respostas'], 2)

    def test_o_contador_e_o_numero_de_respostas_do_payload_nao_divergem(self):
        """O diálogo e o preview mostram o MESMO número.

        Os dois saem do mesmo campo de propósito: o preview lê `total_respostas`
        e o diálogo desenha `respostas`. Um contador dizendo 3 com o diálogo
        mostrando 1 seria confusão garantida.
        """
        for i in range(2):
            self.responder(self.pedido, f'opinião {i}')

        self.logar()
        linha = self.ler_um(self.card.id)

        self.assertEqual(linha['total_respostas'], len(linha['respostas']))
        self.assertEqual(linha['total_respostas'], 2)

    def test_as_respostas_saem_da_mais_recente_para_a_mais_antiga(self):
        """A ordem é load-bearing: é a ordem em que as opiniões aparecem."""
        self.responder(self.pedido, 'a primeira')
        self.responder(self.pedido, 'a segunda')

        self.logar()
        chave = chave_de_texto(self.pedido.formulario.campos)
        textos = [
            {i['key']: i['valor'] for i in r['itens']}[chave]
            for r in self.ler_um(self.card.id)['respostas']
        ]

        self.assertEqual(textos, ['a segunda', 'a primeira'])

    def test_o_payload_publico_nao_conta_quantos_ja_responderam(self):
        """O contador é interno: na rota anônima ele vazaria informação da
        empresa E influenciaria quem está prestes a responder."""
        for i in range(3):
            self.responder(self.pedido, f'opinião secreta {i}')

        r = self.client.get(self.url(self.pedido.token))

        self.assertEqual(r.status_code, 200)
        self.assertEqual(
            set(r.json()),
            {'titulo', 'subtitulo', 'referencia', 'data_entrega', 'campos'},
        )
        corpo = r.content.decode()
        self.assertNotIn('total_respostas', corpo)
        self.assertNotIn('opinião secreta', corpo)


# =========================================================================== #
# 2. O LOTE QUE O PREVIEW DO BOARD USA
# =========================================================================== #
class LoteDoBoardTests(BaseMultiplas):
    """`?cards=1,2,3` — a MESMA pergunta de `?card=`, para N cards de uma vez.

    Sem ele, desenhar o link em cada card do board seria uma requisição POR CARD
    a cada render (um board de 40 cards, 40 chamadas).
    """

    def setUp(self):
        super().setUp()
        self.outro_card = self.novo_card('Relatório mensal')
        self.outro_pedido = self.novo_pedido(self.outro_card)

    def lote(self, ids):
        param = ','.join(str(i) for i in ids)
        return self.client.get(f'/api/feedbacks/pedidos/?cards={param}')

    def test_o_lote_devolve_os_pedidos_dos_cards_pedidos(self):
        self.logar()
        r = self.lote([self.card.id, self.outro_card.id])

        self.assertEqual(r.status_code, 200)
        self.assertEqual(
            {p['id'] for p in r.json()['results']},
            {self.pedido.pk, self.outro_pedido.pk},
        )

    def test_o_resumo_do_board_nao_carrega_o_texto_das_respostas(self):
        """As 8 chaves EXATAS, sem `respostas`.

        Um board com 100 cards que baixasse o texto de todos estaria despejando
        megabytes de dado pessoal na tela para desenhar 100 botões de copiar.
        `card`/`card_kanban` entram conscientemente: sem eles o frontend não tem
        como casar pedido ↔ card e o lote é inútil.

        ERAM 6. `dias_restantes` e `ultima_resposta_em` entraram para as TAGS do
        card ("Faltam X dias para o formulário" e "N feedbacks colhidos | Último
        em DD/MM/AAAA") — são METADADO derivado (um inteiro e um timestamp),
        nunca conteúdo de resposta, então não ferem a regra que este teste
        protege.

        O conjunto continua EXATO de propósito: é um tripwire. Trocá-lo por um
        `assertNotIn('respostas', ...)` pareceria equivalente e não seria — só o
        conjunto fechado pega o campo que alguém acrescentar SEM PENSAR ao
        serializer do lote. Quem acrescentar um campo legítimo aqui atualiza esta
        linha e, ao atualizá-la, é obrigado a justificar o campo.
        """
        self.responder(self.pedido, 'crítica aberta à entrega')

        self.logar()
        r = self.lote([self.card.id])
        linha = r.json()['results'][0]

        self.assertEqual(
            set(linha),
            {
                'id', 'card', 'card_kanban', 'estado', 'url_publica',
                'total_respostas', 'dias_restantes', 'ultima_resposta_em',
            },
        )
        # O contador vem (é o que o preview mostra), o TEXTO não.
        self.assertEqual(linha['total_respostas'], 1)
        self.assertNotIn('crítica aberta', r.content.decode())

    def test_o_lote_ignora_id_invisivel_e_id_podre(self):
        """Um id que não é visível não entra na lista — sem erro, sem dizer que
        existe. E um pedaço não-numérico não pode derrubar o lote inteiro nem
        virar "lista tudo"."""
        from django.test import override_settings

        from apps.accounts.models import UserSetor

        # Sem vínculo, o escopo ligado esconderia TAMBÉM o card visível e o
        # teste passaria por vacuidade — provando nada.
        UserSetor.objects.create(user=self.user, setor=self.setor)
        Card.objects.filter(pk=self.card.pk).update(setor=self.setor)

        outro_setor = SetorCatalogo.objects.create(codename='outro', nome='Outro')
        sprint_alheia = Sprint.objects.create(
            nome='Alheia', data_inicio=timezone.now(),
            fechamento_em=timezone.now() + timedelta(days=7), duracao_dias=7,
            supervisor=self.user, setor=outro_setor,
        )
        projeto_alheio = Project.objects.create(
            nome='Alheio', sprint=sprint_alheia, setor=outro_setor)
        card_alheio = Card.objects.create(nome='De outro setor', projeto=projeto_alheio)
        pedido_alheio = self.novo_pedido(card_alheio)

        self.logar()
        with override_settings(SETOR_SCOPING_ENABLED=True):
            r = self.lote([self.card.id, card_alheio.id, 'lixo'])

        self.assertEqual(r.status_code, 200)
        ids = {p['id'] for p in r.json()['results']}
        self.assertIn(self.pedido.pk, ids)
        self.assertNotIn(pedido_alheio.pk, ids)

    def test_o_lote_tem_teto_de_ids_por_chamada(self):
        """O parâmetro novo não pode virar "peça o chaveiro inteiro de uma vez".

        Este endpoint ENTREGA O TOKEN, que é a credencial da rota anônima. O
        teto é de política (o frontend fatia acima dele), e a prova é posicional:
        um id além do centésimo é IGNORADO.
        """
        from .views import PedidoFeedbackViewSet

        self.assertEqual(PedidoFeedbackViewSet.MAX_CARDS_POR_LOTE, 100)

        # 100 ids inexistentes ocupam a cota inteira; o card real vem no 101º.
        enchimento = list(range(900000, 900000 + PedidoFeedbackViewSet.MAX_CARDS_POR_LOTE))

        self.logar()
        cortado = self.lote(enchimento + [self.card.id])
        self.assertEqual(cortado.json()['results'], [])

        # E o MESMO id, dentro da cota, aparece — senão o teste acima passaria
        # por qualquer motivo (id errado, escopo, card sem pedido).
        dentro = self.lote(enchimento[:99] + [self.card.id])
        self.assertEqual(
            [p['id'] for p in dentro.json()['results']], [self.pedido.pk],
        )

    def test_sem_parametro_nenhum_a_lista_continua_vazia(self):
        """A garantia que torna este endpoint estreito não pode ter sido
        afrouxada pelo parâmetro novo: ele ENTREGA O TOKEN."""
        self.logar()

        self.assertEqual(self.client.get('/api/feedbacks/pedidos/').json()['results'], [])
        self.assertEqual(
            self.client.get('/api/feedbacks/pedidos/?cards=').json()['results'], [])

    def test_o_lote_exige_login_e_permissao(self):
        self.assertIn(self.lote([self.card.id]).status_code, (401, 403))

        curioso = User.objects.create_user(username='curioso', password='y' * 12)
        self.client.force_login(curioso)
        self.assertIn(self.lote([self.card.id]).status_code, (401, 403))


# =========================================================================== #
# 3. `resposta_legivel` COMO UNIDADE
# =========================================================================== #
class RespostaLegivelTests(BaseMultiplas):
    """Ela passou a RECEBER a linha em vez de achá-la.

    `enviado_em` e `itens` continuam idênticos — é isso que mantém os testes de
    item a item e o componente do frontend válidos. O que CRESCEU foi o cabeçalho
    da linha (`id`, `respondente`, `anonimo`, `setor_respondente`), pedido pela
    lista "quem respondeu" do modal consolidado.
    """

    def test_duas_respostas_geram_dois_dicts_casados_com_a_definicao_do_pedido(self):
        self.responder(self.pedido, 'a primeira')
        self.responder(self.pedido, 'a segunda')

        self.pedido.refresh_from_db()
        lidas = [resposta_legivel(self.pedido, r) for r in self.pedido.respostas.all()]

        self.assertEqual(len(lidas), 2)
        chave = chave_de_texto(self.pedido.formulario.campos)
        for lida in lidas:
            with self.subTest(enviado_em=lida['enviado_em']):
                # Cada dict é casado com a definição DAQUELE pedido, na ordem
                # dela — a mesma garantia de quando havia uma resposta só.
                self.assertEqual(
                    [i['key'] for i in lida['itens']],
                    [c['key'] for c in self.pedido.formulario.campos],
                )
                # Conjunto EXATO, e não `assertIn`: é o contrato do payload que
                # o frontend consome. Uma chave a mais aqui é dado pessoal a
                # mais saindo do servidor, e tem de ser uma decisão, não um
                # acidente.
                self.assertEqual(
                    set(lida),
                    {'id', 'enviado_em', 'respondente', 'anonimo',
                     'setor_respondente', 'itens'},
                )

        por_texto = [
            {i['key']: i['valor'] for i in lida['itens']}[chave] for lida in lidas
        ]
        self.assertEqual(por_texto, ['a segunda', 'a primeira'])

    def test_pedido_sem_resposta_produz_lista_vazia_e_nao_erro(self):
        """Sem OneToOne não há `ObjectDoesNotExist` para capturar — o manager
        devolve queryset vazio. É a razão de o `except` ter saído da função."""
        self.assertEqual(
            [resposta_legivel(self.pedido, r) for r in self.pedido.respostas.all()],
            [],
        )


# =========================================================================== #
# 4. A MIGRATION 0008 — ZERO PERDA DE LINHA
# =========================================================================== #
class MigracaoPreservaRespostasTests(TestCase):
    """A prova contra um RemoveField/AddField silencioso.

    `AlterField` (OneToOne -> FK) mantém a MESMA coluna `pedido_id`: o SQL é DROP
    CONSTRAINT da unicidade + CREATE INDEX, e nenhuma linha é reescrita. Se
    alguém "simplificar" a 0008 para um par remover/criar campo, TODA resposta
    de produção seria apagada em silêncio — e este teste fica vermelho.
    """

    def test_a_0008_e_alterfield_e_nao_um_par_remove_add(self):
        from importlib import import_module

        from django.db import migrations as m

        migration = import_module(
            'apps.feedbacks.migrations.0008_respostas_multiplas').Migration

        tipos = [type(op) for op in migration.operations]
        self.assertIn(m.AlterField, tipos)
        self.assertNotIn(m.RemoveField, tipos)
        self.assertNotIn(m.AddField, tipos)

        alter = next(op for op in migration.operations if isinstance(op, m.AlterField))
        # A COLUNA continua sendo a mesma, e o campo continua se chamando
        # `pedido` — é isso que faz o dado sobreviver.
        self.assertEqual(alter.name, 'pedido')
        self.assertEqual(alter.field.remote_field.related_name, 'respostas')

    def test_a_linha_ja_gravada_sobrevive_com_o_mesmo_pedido_e_os_mesmos_valores(self):
        """O estado DEPOIS da migration, com dado real atravessando.

        A suíte roda com a 0008 já aplicada, então o que se prova aqui é o que
        importa em produção: uma linha gravada continua ligada ao seu pedido,
        com os mesmos `valores`, e agora convive com outras do MESMO pedido — o
        que o índice único proibia.
        """
        user = User.objects.create_user(username='migrador', password='x' * 12)
        setor = SetorCatalogo.objects.create(codename='mig', nome='Mig')
        agora = timezone.now()
        sprint = Sprint.objects.create(
            nome='S', data_inicio=agora, fechamento_em=agora + timedelta(days=7),
            duracao_dias=7, supervisor=user, setor=setor,
        )
        projeto = Project.objects.create(nome='P', sprint=sprint)
        card = Card.objects.create(nome='C', projeto=projeto)
        pedido = criar_pedido_feedback(
            card_id=card.id, data_referencia=timezone.localdate(),
            referencia_publica=card.nome,
        )

        antiga = RespostaFeedback.objects.create(
            pedido=pedido, valores={'comentario': 'gravada antes da 0008'})

        # A segunda linha no MESMO pedido — o INSERT que o índice único recusava.
        RespostaFeedback.objects.create(
            pedido=pedido, valores={'comentario': 'gravada depois'})

        antiga.refresh_from_db()
        self.assertEqual(antiga.pedido_id, pedido.pk)
        self.assertEqual(antiga.valores, {'comentario': 'gravada antes da 0008'})
        self.assertEqual(pedido.respostas.count(), 2)

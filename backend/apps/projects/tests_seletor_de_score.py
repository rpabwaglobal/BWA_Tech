"""Quais cards o seletor do modal de Score oferece: TODOS.

O Score apenas atribui pontuação segundo os critérios configurados. Decidir
*quais* cards merecem nota nao e papel deste endpoint, e por isso ele nao recusa
status, sprint nem projeto.

NAO ERA ASSIM, e o que havia era duas camadas de recorte somadas:

1. Card FINALIZADO ficava de fora, com o argumento "nao faz sentido pontuar algo
   concluido". O efeito era o oposto do que a tela promete: pontuar virava algo
   que alguem tinha de LEMBRAR de fazer antes de concluir, porque na conclusao o
   card saia da lista e nao voltava. Medido na base: 132 entregues fora do
   alcance na sprint vigente, contra 59 dentro.

2. Sprint encerrada, projeto arquivado e projeto de sistema tambem ficavam fora,
   e INVIABILIZADO vazava por descuido — o `exclude` pegava so `FINALIZADO`,
   metade de `CARD_STATUS_FECHADOS`.

Esta suite fixa a ausencia de recorte. Nao e um detalhe: "a lista ficou maior"
nao parece defeito, entao um recorte reintroduzido por engano passaria calado.

O que este endpoint AINDA recorta e `scope_cards`, que e permissao por setor e
nao escopo de pontuacao — ver `test_o_escopo_por_setor_continua_valendo`.
"""
import datetime as dt

from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.accounts.models import SetorCatalogo
from apps.projects.models import Card, CardStatus, Project, Sprint

User = get_user_model()

ROTA = '/api/card-scores/pickable-cards/'


class SeletorDeCardsDoScoreTests(APITestCase):

    def setUp(self):
        self.admin = User.objects.create_user(
            username='admin_seletor', email='admin.seletor@example.com',
            password='x' * 12, role='admin', is_superuser=True, is_staff=True)
        self.setor = SetorCatalogo.objects.create(
            codename='setor_seletor', nome='Seletor')

        agora = timezone.now()
        self.sprint_atual = Sprint.objects.create(
            nome='Sprint vigente', data_inicio=agora - dt.timedelta(days=2),
            fechamento_em=agora + dt.timedelta(days=5), duracao_dias=7,
            supervisor=self.admin, setor=self.setor)
        self.sprint_velha = Sprint.objects.create(
            nome='Sprint encerrada', data_inicio=agora - dt.timedelta(days=30),
            fechamento_em=agora - dt.timedelta(days=20), duracao_dias=10,
            supervisor=self.admin, setor=self.setor, finalizada=True)

        self.projeto = Project.objects.create(
            nome='Projeto do seletor', sprint=self.sprint_atual, setor=self.setor)
        self.projeto_velho = Project.objects.create(
            nome='Projeto encerrado', sprint=self.sprint_velha, setor=self.setor)

        self.client.force_authenticate(self.admin)

    def _card(self, status, nome, projeto=None):
        return Card.objects.create(
            nome=nome, projeto=projeto or self.projeto, status=status,
            criado_por=self.admin)

    def _nomes(self):
        # `page_size` no teto: os cenarios desta classe tem poucos cards, e a
        # pergunta aqui e "entra ou nao entra", nao "em que pagina".
        resposta = self.client.get(ROTA, {'page_size': 200})
        self.assertEqual(resposta.status_code, 200, resposta.content[:300])
        return {item['nome'] for item in resposta.json()['results']}

    # -- nenhum status e recusado -----------------------------------------

    def test_todos_os_status_podem_receber_score(self):
        """Inclui os dois que ja foram recusados: finalizado e inviabilizado."""
        todos = [s for s, _ in CardStatus.choices]
        self.assertIn(CardStatus.FINALIZADO, todos)
        self.assertIn(CardStatus.INVIABILIZADO, todos)

        for status in todos:
            self._card(status, 'Card %s' % status)

        nomes = self._nomes()

        faltando = ['Card %s' % s for s in todos if 'Card %s' % s not in nomes]
        self.assertEqual(
            faltando, [],
            'status recusado(s) pelo seletor: %s. O Score nao filtra por '
            'status.' % faltando)

    def test_card_concluido_pode_ser_pontuado(self):
        """O caso que motivou a mudanca, isolado para o erro ser legivel."""
        self._card(CardStatus.FINALIZADO, 'Entregue')

        self.assertIn('Entregue', self._nomes())

    def test_card_inviabilizado_pode_ser_pontuado(self):
        """Ja vazava por descuido; agora entra por decisao."""
        self._card(CardStatus.INVIABILIZADO, 'Inviavel')

        self.assertIn('Inviavel', self._nomes())

    # -- nenhuma sprint nem projeto e recusado ----------------------------

    def test_card_de_sprint_encerrada_pode_ser_pontuado(self):
        self._card(CardStatus.FINALIZADO, 'Entregue na sprint velha',
                   projeto=self.projeto_velho)

        self.assertIn('Entregue na sprint velha', self._nomes())

    def test_card_de_projeto_arquivado_pode_ser_pontuado(self):
        arquivado = Project.objects.create(
            nome='Arquivado', sprint=self.sprint_atual, setor=self.setor,
            arquivado=True)
        self._card(CardStatus.FINALIZADO, 'De projeto arquivado', projeto=arquivado)

        self.assertIn('De projeto arquivado', self._nomes())

    def test_card_de_projeto_de_sistema_NAO_pode_ser_pontuado(self):
        """O unico recorte de conteudo que existe, e o porque dele.

        "Sugestoes", "Suporte", "Descartados" e "Monitoramento de Feedbacks" nao
        sao trabalho entregue. O card de monitoramento e o caso mais claro: e uma
        PROJECAO de um pedido de feedback, com a coluna controlada pelo sistema e
        sem ninguem que possa arrasta-lo.

        Note que arquivado ENTRA e sistemico NAO: sao coisas diferentes, apesar
        de terem virado uma so no filtro que existia antes.
        """
        sistemico = Project.objects.create(
            nome='Sistemico', sprint=self.sprint_atual, setor=self.setor,
            is_system=True)
        self._card(CardStatus.FINALIZADO, 'De projeto sistemico', projeto=sistemico)

        self.assertNotIn('De projeto sistemico', self._nomes())

    def test_a_flag_e_o_que_decide_e_nao_o_nome(self):
        """A trava do conserto de raiz.

        A replicacao de sprint nao copiava `is_system`, entao cada virada criava
        uma copia de "Sugestoes" como projeto de trabalho comum: 11 projetos
        estavam assim na base, com 5 cards. Filtrar por NOME resolveria o sintoma
        e criaria outra divida, porque a documentacao do produto pede para nao
        renomear projeto de sistema justamente por causa de regras assim.

        Este teste prova que a decisao e pela flag: um projeto com nome comum,
        marcado, fica fora; um com nome de sistema, desmarcado, entra.
        """
        marcado_com_nome_comum = Project.objects.create(
            nome='Projeto Qualquer', sprint=self.sprint_atual, setor=self.setor,
            is_system=True)
        desmarcado_com_nome_de_sistema = Project.objects.create(
            nome='Sugestões', sprint=self.sprint_atual, setor=self.setor,
            is_system=False)
        self._card(CardStatus.A_DESENVOLVER, 'Marcado, nome comum',
                   projeto=marcado_com_nome_comum)
        self._card(CardStatus.A_DESENVOLVER, 'Desmarcado, nome de sistema',
                   projeto=desmarcado_com_nome_de_sistema)

        nomes = self._nomes()

        self.assertNotIn('Marcado, nome comum', nomes)
        self.assertIn('Desmarcado, nome de sistema', nomes)

    def test_nenhum_card_de_trabalho_fica_fora(self):
        """A trava geral: pega um recorte novo de qualquer natureza.

        Conta contra o banco em vez de listar casos, entao um `exclude`
        reintroduzido por status, sprint, projeto arquivado ou data cai aqui.

        O universo comparado exclui projeto de sistema, porque esse recorte E
        intencional — e o unico. Comparar contra `Card.objects.count()` cru faria
        este teste falhar pelo motivo certo mas com a mensagem errada.
        """
        self._card(CardStatus.FINALIZADO, 'A', projeto=self.projeto_velho)
        self._card(CardStatus.INVIABILIZADO, 'B')
        self._card(CardStatus.A_DESENVOLVER, 'C')
        sistemico = Project.objects.create(
            nome='Sistemico', sprint=self.sprint_atual, setor=self.setor,
            is_system=True)
        self._card(CardStatus.A_DESENVOLVER, 'D', projeto=sistemico)

        corpo = self.client.get(ROTA).json()

        esperado = Card.objects.filter(projeto__is_system=False).count()
        self.assertEqual(
            corpo['count'], esperado,
            'o seletor devolveu menos cards de trabalho do que existem na base')
        self.assertEqual(esperado, 3, 'o cenario nao ficou como o teste precisa')

    # -- o que continua recortando, e por que nao e o mesmo assunto -------

    def test_o_escopo_por_setor_continua_valendo(self):
        """`scope_cards` e PERMISSAO, nao escopo de pontuacao.

        A action e `detail=False`, entao nao passa pelo `get_queryset()` da
        classe e o escopo tem de ser reaplicado a mao. Este teste existe para que
        remover o recorte de sprint — que foi o que aconteceu — nao arraste o
        escopo junto por descuido: sem ele, quem tem `manage_score` sem
        `view_cross_setor` recebe o backlog da empresa inteira, com descricao e
        script_url de cada card, numa request sem paginacao.
        """
        import inspect

        from apps.projects import views

        # O escopo mora em `_cards_pontuaveis`, a base compartilhada pelos DOIS
        # endpoints do seletor. Conferir os dois: deixar so um escopado seria o
        # jeito silencioso de vazar — o endpoint de filtros entrega nome de
        # pessoa, e o de cards entrega descricao e script_url.
        fonte_base = inspect.getsource(views.CardScoreViewSet._cards_pontuaveis)
        self.assertIn(
            'scope_cards', fonte_base,
            'o escopo por setor saiu de `_cards_pontuaveis`. Ele nao e recorte '
            'de quais cards podem ser pontuados, e quem pode ve-los.')

        for nome_da_action in ('pickable_cards', 'pickable_filters'):
            fonte = inspect.getsource(getattr(views.CardScoreViewSet, nome_da_action))
            self.assertIn(
                '_cards_pontuaveis', fonte,
                '`%s` deixou de usar a base escopada.' % nome_da_action)

    # -- o que o preview precisa -----------------------------------------

    def test_o_seletor_traz_o_que_o_preview_precisa(self):
        """Faltando um campo, o card aparece pelado no modal.

        Foi o que aconteceu no modo EDITAR, por outro caminho: o card nao estava
        na lista e o preview caia num texto com o nome.
        """
        self._card(CardStatus.FINALIZADO, 'Entregue')

        item = next(i for i in self.client.get(ROTA).json()['results']
                    if i['nome'] == 'Entregue')

        for campo in ('id', 'nome', 'prioridade', 'status', 'area', 'area_display',
                      'tipo', 'tipo_display', 'data_fim', 'responsavel_name',
                      'responsavel_role', 'score_final'):
            self.assertIn(campo, item, 'o preview perde `%s`' % campo)


class SeletorPaginadoEFiltradoNoServidorTests(APITestCase):
    """A paginacao e a filtragem do seletor, e a razao de a segunda existir.

    Quando o seletor deixou de recusar card concluido e sprint encerrada, a lista
    foi de 190 para 1515 cards e a resposta para ~1 MB. O modal desenha um
    preview por card, entao paginar era inevitavel.

    E PAGINAR OBRIGA A FILTRAR NO SERVIDOR. Paginando e filtrando em memoria, a
    busca enxerga apenas a pagina carregada: digitar o nome de um card da pagina
    20 nao acha nada, e o resultado parece "esse card nao existe" — pior que a
    lentidao que a paginacao veio resolver. Os testes abaixo fixam isso.
    """

    def setUp(self):
        self.admin = User.objects.create_user(
            username='admin_pag', email='admin.pag@example.com',
            password='x' * 12, role='admin', is_superuser=True, is_staff=True)
        self.dev = User.objects.create_user(
            username='dev_pag', email='dev.pag@example.com',
            password='x' * 12, role='desenvolvedor',
            first_name='Dev', last_name='Pag')
        self.setor = SetorCatalogo.objects.create(
            codename='setor_pag', nome='Paginacao')

        agora = timezone.now()
        self.sprint_a = Sprint.objects.create(
            nome='Sprint A', data_inicio=agora - dt.timedelta(days=40),
            fechamento_em=agora - dt.timedelta(days=30), duracao_dias=10,
            supervisor=self.admin, setor=self.setor, finalizada=True)
        self.sprint_b = Sprint.objects.create(
            nome='Sprint B', data_inicio=agora - dt.timedelta(days=2),
            fechamento_em=agora + dt.timedelta(days=8), duracao_dias=10,
            supervisor=self.admin, setor=self.setor)

        self.projeto_a = Project.objects.create(
            nome='Projeto A', sprint=self.sprint_a, setor=self.setor)
        self.projeto_b = Project.objects.create(
            nome='Projeto B', sprint=self.sprint_b, setor=self.setor)

        self.client.force_authenticate(self.admin)

    def _muitos(self, quantos, projeto, prefixo='Card', responsavel=None):
        return [
            Card.objects.create(
                nome='%s %03d' % (prefixo, i), projeto=projeto,
                status=CardStatus.A_DESENVOLVER, criado_por=self.admin,
                responsavel=responsavel)
            for i in range(quantos)
        ]

    # -- a paginacao ------------------------------------------------------

    def test_a_resposta_e_paginada(self):
        self._muitos(45, self.projeto_b)

        corpo = self.client.get(ROTA).json()

        self.assertIn('count', corpo, 'a resposta voltou a ser uma lista crua')
        self.assertIn('next', corpo)
        self.assertEqual(corpo['count'], 45)
        self.assertLess(len(corpo['results']), 45,
                        'a pagina trouxe tudo: a paginacao nao esta agindo')
        self.assertIsNotNone(corpo['next'])

    def test_rolando_as_paginas_chega_a_todos_sem_repetir(self):
        """A rolagem infinita depende disto: nenhum card some nem duplica.

        A REPLICACAO DE SPRINT COPIA `created_at`, entao cards empatam na
        ordenacao. Ordenar so por `-created_at` faria o banco decidir o desempate
        a cada consulta, e um card apareceria duas vezes ou nenhuma entre
        paginas. Por isso o `-id` como segundo campo.
        """
        criados = self._muitos(50, self.projeto_b)
        Card.objects.filter(pk__in=[c.pk for c in criados]).update(
            created_at=timezone.now())

        vistos, url = [], ROTA + '?page_size=10'
        while url:
            corpo = self.client.get(url).json()
            vistos += [i['id'] for i in corpo['results']]
            url = corpo['next']
            if url:
                url = url[url.index('/api/'):]

        self.assertEqual(len(vistos), 50)
        self.assertEqual(len(set(vistos)), 50, 'houve card repetido entre paginas')
        self.assertEqual(set(vistos), {c.id for c in criados})

    # -- a busca alcanca a BASE, nao a pagina -----------------------------

    def test_a_busca_acha_card_que_nao_esta_na_primeira_pagina(self):
        """O teste que importa nesta classe."""
        self._muitos(60, self.projeto_b, prefixo='Comum')
        agulha = Card.objects.create(
            nome='Agulha no palheiro', projeto=self.projeto_b,
            status=CardStatus.A_DESENVOLVER, criado_por=self.admin)
        Card.objects.filter(pk=agulha.pk).update(
            created_at=timezone.now() - dt.timedelta(days=365))

        primeira = self.client.get(ROTA, {'page_size': 20}).json()
        self.assertNotIn(agulha.id, [i['id'] for i in primeira['results']],
                         'o cenario nao ficou como o teste precisa')

        busca = self.client.get(ROTA, {'q': 'Agulha'}).json()

        self.assertEqual(busca['count'], 1)
        self.assertEqual(busca['results'][0]['id'], agulha.id)

    def test_a_busca_tambem_olha_a_descricao(self):
        Card.objects.create(
            nome='Nome que nao casa', projeto=self.projeto_b,
            descricao='texto escondido na descricao',
            status=CardStatus.A_DESENVOLVER, criado_por=self.admin)

        corpo = self.client.get(ROTA, {'q': 'escondido'}).json()

        self.assertEqual(corpo['count'], 1)

    # -- os filtros -------------------------------------------------------

    def test_filtro_de_sprint(self):
        self._muitos(3, self.projeto_a)
        self._muitos(7, self.projeto_b)

        a = self.client.get(ROTA, {'sprint': self.sprint_a.id}).json()
        b = self.client.get(ROTA, {'sprint': self.sprint_b.id}).json()

        self.assertEqual(a['count'], 3)
        self.assertEqual(b['count'], 7)

    def test_filtro_de_responsavel_e_de_sem_responsavel(self):
        self._muitos(4, self.projeto_b, prefixo='Com', responsavel=self.dev)
        self._muitos(6, self.projeto_b, prefixo='Sem', responsavel=None)

        com = self.client.get(ROTA, {'responsavel': self.dev.id}).json()
        sem = self.client.get(ROTA, {'responsavel': '__sem__'}).json()

        self.assertEqual(com['count'], 4)
        self.assertEqual(sem['count'], 6)

    def test_os_filtros_se_combinam(self):
        self._muitos(5, self.projeto_a, prefixo='Alvo', responsavel=self.dev)
        self._muitos(5, self.projeto_b, prefixo='Alvo', responsavel=self.dev)
        self._muitos(5, self.projeto_a, prefixo='Outro', responsavel=None)

        corpo = self.client.get(ROTA, {
            'q': 'Alvo', 'sprint': self.sprint_a.id, 'responsavel': self.dev.id,
        }).json()

        self.assertEqual(corpo['count'], 5)

    # -- as OPCOES dos filtros -------------------------------------------

    def test_as_opcoes_nao_vem_da_pagina_carregada(self):
        """O endpoint de filtros existe exatamente para isto.

        Antes o modal montava a lista de responsaveis varrendo os cards em maos.
        Paginando, ele veria so os das paginas buscadas, e um nome que falta num
        filtro nao parece defeito: parece que a pessoa nao tem card.
        """
        self._muitos(60, self.projeto_b, prefixo='Enche', responsavel=None)
        so_dele = Card.objects.create(
            nome='O unico dele', projeto=self.projeto_a,
            status=CardStatus.A_DESENVOLVER, criado_por=self.admin,
            responsavel=self.dev)
        Card.objects.filter(pk=so_dele.pk).update(
            created_at=timezone.now() - dt.timedelta(days=365))

        primeira = self.client.get(ROTA, {'page_size': 20}).json()
        self.assertNotIn(so_dele.id, {i['id'] for i in primeira['results']},
                         'o cenario nao ficou como o teste precisa')

        opcoes = self.client.get('/api/card-scores/pickable-filters/').json()
        valores = {r['value'] for r in opcoes['responsaveis']}

        self.assertIn(str(self.dev.id), valores,
                      'o responsavel de um card fora da primeira pagina '
                      'desapareceu das opcoes')

    def test_as_opcoes_nao_repetem(self):
        """`.distinct()` com a ordenacao do model nao basta.

        `Card.Meta.ordering` poe tres colunas no SELECT, e o DISTINCT passa a
        distinguir por elas: o endpoint devolvia uma "sprint distinta" por card.
        O `.order_by()` vazio antes do `values_list` e o que conserta, e este
        teste e o que impede de tira-lo.
        """
        self._muitos(30, self.projeto_a, responsavel=self.dev)
        self._muitos(30, self.projeto_b, responsavel=self.dev)

        opcoes = self.client.get('/api/card-scores/pickable-filters/').json()

        self.assertEqual(len(opcoes['sprints']), 2,
                         'sprints repetidas: %s' % opcoes['sprints'])
        self.assertEqual(len(opcoes['responsaveis']), 1,
                         'responsaveis repetidos: %s' % opcoes['responsaveis'])

    def test_as_sprints_vem_em_ordem_cronologica_decrescente(self):
        """Por DATA e nao por nome: Sprint 10 vem antes de Sprint 2 no ABC."""
        self._muitos(1, self.projeto_a)
        self._muitos(1, self.projeto_b)

        sprints = self.client.get(
            '/api/card-scores/pickable-filters/').json()['sprints']

        self.assertEqual([s['label'] for s in sprints], ['Sprint B', 'Sprint A'])

    def test_as_opcoes_respeitam_o_recorte_de_projeto_de_sistema(self):
        sistemico = Project.objects.create(
            nome='Sistemico', sprint=self.sprint_b, setor=self.setor,
            is_system=True)
        Card.objects.create(
            nome='De sistema', projeto=sistemico,
            status=CardStatus.A_DESENVOLVER, criado_por=self.admin,
            responsavel=self.dev)

        opcoes = self.client.get('/api/card-scores/pickable-filters/').json()

        self.assertEqual(opcoes['responsaveis'], [],
                         'o responsavel de um card de projeto de sistema entrou '
                         'nas opcoes')

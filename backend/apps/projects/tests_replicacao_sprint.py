"""O card que atravessa a virada da sprint leva TUDO consigo.

Quando uma sprint e finalizada, o trabalho pendente e replicado para a sprint
seguinte. A copia nascia perdendo coisas em silencio: nao ha erro, nao ha log —
o card simplesmente aparece do outro lado sem os links que alguem anexou.

O teste que mais importa aqui NAO e nenhum dos que conferem um campo especifico.
E o `test_nenhum_campo_novo_escapa_da_replicacao`: ele compara o modelo INTEIRO
contra o que a replicacao copia, e falha quando alguem acrescenta um campo ao
`Card` e esquece de decidir se ele atravessa a virada. Foi exatamente assim que
`links` se perdeu — o campo entrou depois da funcao de replicacao, e nada avisou.

Campos derivados ficam numa lista explicita, e a lista existe para OBRIGAR a
decisao: para sair do teste, o campo novo precisa aparecer na replicacao ou ser
declarado aqui como derivado, com o porque.
"""
import datetime as dt

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.accounts.models import SetorCatalogo
from apps.projects.models import (
    Card, CardAnexo, CardStatus, Project, Sprint,
)
from apps.projects.services import _replicar_card_para_sprint

User = get_user_model()

# Campos que NAO devem ser copiados, e a razao de cada um. Mexer aqui e uma
# decisao de produto, nao um detalhe: tirar um campo desta lista sem po-lo na
# replicacao faz o dado sumir na virada da sprint.
DERIVADOS = {
    # Recalculado pelo `save()` a partir do projeto novo.
    'setor',
    # `auto_now`.
    'updated_at',
    # A copia NAO esta finalizada: ela existe justamente porque o trabalho
    # continua. O signal preenche quando ela for concluida de verdade.
    'finalizado_em',
    # Metricas de tempo, derivadas de `data_inicio` -> `finalizado_em`. Como
    # `data_inicio` atravessa, o calculo na conclusao ja cobre o periodo inteiro;
    # copiar o valor antigo contaria o mesmo tempo duas vezes.
    'segundos_corridos_desenvolvimento',
    'dias_uteis_desenvolvimento',
    'minutos_uteis_desenvolvimento',
}


class ReplicacaoDeCardEntreSprintsTests(APITestCase):

    def setUp(self):
        self.admin = User.objects.create_user(
            username='admin_repl', email='admin.repl@example.com',
            password='x' * 12, role='admin', is_superuser=True, is_staff=True)
        self.dev = User.objects.create_user(
            username='dev_repl', email='dev.repl@example.com',
            password='x' * 12, role='desenvolvedor')
        self.setor = SetorCatalogo.objects.create(
            codename='setor_repl', nome='Replicacao')
        self.outro_setor = SetorCatalogo.objects.create(
            codename='setor_convidado', nome='Convidado')

        agora = timezone.now()
        self.sprint_velha = Sprint.objects.create(
            nome='Sprint que encerra', data_inicio=agora - dt.timedelta(days=10),
            fechamento_em=agora - dt.timedelta(days=1), duracao_dias=9,
            supervisor=self.admin, setor=self.setor)
        self.sprint_nova = Sprint.objects.create(
            nome='Sprint seguinte', data_inicio=agora - dt.timedelta(hours=1),
            fechamento_em=agora + dt.timedelta(days=7), duracao_dias=8,
            supervisor=self.admin, setor=self.setor)

        self.projeto_velho = Project.objects.create(
            nome='Projeto', sprint=self.sprint_velha, setor=self.setor)
        self.projeto_novo = Project.objects.create(
            nome='Projeto', sprint=self.sprint_nova, setor=self.setor)

    def _card(self, **extra):
        campos = dict(
            nome='Card que atravessa', descricao='segue na proxima sprint',
            projeto=self.projeto_velho, status=CardStatus.EM_DESENVOLVIMENTO,
            responsavel=self.dev, criado_por=self.admin,
        )
        campos.update(extra)
        return Card.objects.create(**campos)

    def _replicar(self, card):
        return _replicar_card_para_sprint(
            card, self.projeto_novo, self.sprint_velha, self.sprint_nova,
            usuario_fechamento=self.admin,
        )

    # -- o que foi relatado ----------------------------------------------

    def test_os_links_atravessam_a_virada(self):
        """O bug relatado: links anexados ao card ficavam para tras."""
        links = [
            {'url': 'https://docs.google.com/spreadsheets/d/abc', 'label': 'Planilha'},
            {'url': 'https://exemplo.com/prd.pdf', 'label': 'PRD'},
        ]
        novo = self._replicar(self._card(links=links))

        self.assertEqual(novo.links, links)

    def test_card_sem_links_atravessa_com_lista_vazia(self):
        """O caso comum: a maioria dos cards nao tem link nenhum.

        Escrevi este teste primeiro com `links=None`, imaginando linhas antigas
        anteriores ao campo. O banco recusou: `links` e `JSONField(default=list)`
        e NOT NULL, entao esse estado nao existe. O cenario real e a lista vazia.
        """
        novo = self._replicar(self._card())
        self.assertEqual(novo.links, [])

    # -- anexos ----------------------------------------------------------

    def test_os_anexos_atravessam_apontando_para_o_mesmo_arquivo(self):
        """A linha e nova; o arquivo em disco e o mesmo.

        Copiar os bytes duplicaria dezenas de megabytes a cada virada de sprint
        para um conteudo identico.
        """
        card = self._card()
        CardAnexo.objects.create(
            card=card,
            arquivo=SimpleUploadedFile('prd.txt', b'conteudo do anexo'),
            nome_original='prd.txt', tamanho=17, enviado_por=self.dev)

        novo = self._replicar(card)

        self.assertEqual(novo.anexos.count(), 1)
        copia = novo.anexos.first()
        original = card.anexos.first()
        self.assertNotEqual(copia.pk, original.pk, 'a linha deveria ser nova')
        self.assertEqual(copia.arquivo.name, original.arquivo.name,
                         'deveria apontar para o MESMO arquivo')
        self.assertEqual(copia.nome_original, 'prd.txt')
        self.assertEqual(copia.enviado_por, self.dev)

    def test_o_card_de_origem_mantem_os_anexos(self):
        """A sprint encerrada e historico; um historico sem o anexo mente."""
        card = self._card()
        CardAnexo.objects.create(
            card=card, arquivo=SimpleUploadedFile('nota.txt', b'x'),
            nome_original='nota.txt', tamanho=1)

        self._replicar(card)

        self.assertEqual(card.anexos.count(), 1)

    # -- compartilhamento por setor --------------------------------------

    def test_os_setores_compartilhados_atravessam(self):
        """Sem isto, quem via o card por compartilhamento o perde de vista na
        virada — e nao ha aviso nenhum de que deixou de enxergar."""
        card = self._card()
        card.setores_compartilhados.set([self.outro_setor])

        novo = self._replicar(card)

        self.assertEqual(
            list(novo.setores_compartilhados.values_list('codename', flat=True)),
            ['setor_convidado'])

    # -- a trava que pega o proximo campo esquecido ----------------------

    def test_nenhum_campo_novo_escapa_da_replicacao(self):
        """Compara o modelo INTEIRO contra o que a replicacao copia.

        Este e o teste que importa. Os outros conferem campos que ja sabemos que
        faltavam; este falha no dia em que alguem acrescentar um campo ao `Card`
        e nao decidir se ele atravessa a virada da sprint — que foi exatamente
        como `links` se perdeu.

        Para faze-lo passar ha dois caminhos honestos: copiar o campo na
        replicacao, ou declara-lo em `DERIVADOS` aqui em cima, com o porque.
        """
        import inspect
        import re

        from apps.projects import services

        fonte = inspect.getsource(services._replicar_card_para_sprint)
        copiados = set(re.findall(r'^\s{8}(\w+)=', fonte, re.M))
        copiados |= set(re.findall(r'update\((\w+)=', fonte))
        copiados |= set(re.findall(r'novo\.(\w+)\.set\(', fonte))

        esquecidos = []
        for campo in Card._meta.get_fields():
            if campo.auto_created and not campo.concrete:
                continue  # relacao reversa, nao e campo do card
            if not (campo.concrete or campo.many_to_many):
                continue
            if campo.name == 'id':
                continue
            if campo.name in copiados or campo.name in DERIVADOS:
                continue
            esquecidos.append(campo.name)

        self.assertEqual(
            esquecidos, [],
            'Campo(s) do Card fora da replicacao de sprint: %s. Copie em '
            '`_replicar_card_para_sprint` ou declare em DERIVADOS explicando '
            'por que nao atravessa a virada.' % ', '.join(esquecidos))

    # -- o que ja funcionava, para nao regredir --------------------------

    def test_o_essencial_do_card_continua_atravessando(self):
        card = self._card(
            descricao='texto', card_comment='comentario',
            complexidade_custom_items=[{'nome': 'x'}],
            gerar_formulario_feedback=True)

        novo = self._replicar(card)

        self.assertEqual(novo.nome, card.nome)
        self.assertEqual(novo.descricao, 'texto')
        self.assertEqual(novo.card_comment, 'comentario')
        self.assertEqual(novo.complexidade_custom_items, [{'nome': 'x'}])
        self.assertTrue(novo.gerar_formulario_feedback)
        self.assertEqual(novo.responsavel, self.dev)
        self.assertEqual(novo.projeto, self.projeto_novo)
        self.assertEqual(novo.created_at, card.created_at)


# O PONTO CEGO DA TRAVA ACIMA. `test_nenhum_campo_novo_escapa_da_replicacao`
# pula relacoes reversas de proposito ("relacao reversa, nao e campo do card"),
# e foi exatamente ali que o SCORE se perdeu: um OneToOne que ficava no card da
# sprint encerrada, fazendo a tela de Score exibir o status congelado no
# fechamento. Quatro scores apareciam como em desenvolvimento / em homologacao /
# a desenvolver para trabalho ja entregue.
#
# Cada relacao abaixo tem a razao VERIFICADA de nao atravessar. Onde o
# comportamento e so o atual e nao uma decisao, esta escrito que e.
RELACOES_QUE_NAO_ATRAVESSAM = {
    'events': (
        'Tabela sem uso: 0 linhas na base inteira quando isto foi medido.'
    ),
    'weekly_priorities': (
        'Prioridade e da SEMANA, nao do card. Atravessar faria a prioridade de '
        'uma semana encerrada reaparecer na seguinte sem ninguem escolher.'
    ),
    'pedido_feedback': (
        'O pedido nasce na CONCLUSAO do card. A copia existe justamente porque '
        'o trabalho nao terminou, entao nao ha pedido para levar.'
    ),
    'pedido_exibido': (
        'Mesmo motivo de `pedido_feedback` — e a outra ponta do mesmo OneToOne.'
    ),
    'reopen_requests': (
        'Pedido de reabertura e de um card concluido, e card concluido nao e '
        'replicado. Medido: 0 linhas na base.'
    ),
    'due_date_change_requests': (
        'Pedido resolvido e historico e fica com o card da sprint em que foi '
        'decidido. Medido na base: 101 aprovados, 9 recusados, ZERO pendentes. '
        'ATENCAO: se um dia houver pendente, ele fica orfao no card morto. '
        'Isso e o comportamento atual, nao uma decisao tomada.'
    ),
    'pins': (
        'COMPORTAMENTO ATUAL, NAO DECISAO. O pin e do usuario (tela Meus '
        'Afazeres). Se um card fixado for replicado, o pin fica no card da '
        'sprint encerrada e a pessoa passa a acompanhar o card morto: o mesmo '
        'defeito do score. Medido: 3 pins na base, todos em cards que sao o '
        'ultimo da propria cadeia, entao HOJE nao ha ninguem afetado.'
    ),
}

# Relacoes que ATRAVESSAM, mas por um caminho que a varredura nao reconhece
# sozinha. Ficam separadas de proposito: por-las no dicionario acima diria que
# nao atravessam, e seria mentira.
RELACOES_COBERTAS_INDIRETAMENTE = {
    'compartilhamentos': (
        'E a tabela `through` do M2M `setores_compartilhados`, que a replicacao '
        'copia com `novo.setores_compartilhados.set(...)`. A relacao reversa '
        'nunca e tocada pelo nome.'
    ),
}


class ScoreAtravessaAViradaTests(APITestCase):
    """O score acompanha o TRABALHO, nao a linha de banco daquela semana."""

    def setUp(self):
        self.admin = User.objects.create_user(
            username='admin_score_repl', email='admin.score.repl@example.com',
            password='x' * 12, role='admin', is_superuser=True, is_staff=True)
        self.setor = SetorCatalogo.objects.create(
            codename='setor_score_repl', nome='Score Repl')

        agora = timezone.now()
        self.sprint_velha = Sprint.objects.create(
            nome='Encerra', data_inicio=agora - dt.timedelta(days=10),
            fechamento_em=agora - dt.timedelta(days=1), duracao_dias=9,
            supervisor=self.admin, setor=self.setor)
        self.sprint_nova = Sprint.objects.create(
            nome='Seguinte', data_inicio=agora - dt.timedelta(hours=1),
            fechamento_em=agora + dt.timedelta(days=7), duracao_dias=8,
            supervisor=self.admin, setor=self.setor)
        self.projeto_velho = Project.objects.create(
            nome='Projeto', sprint=self.sprint_velha, setor=self.setor)
        self.projeto_novo = Project.objects.create(
            nome='Projeto', sprint=self.sprint_nova, setor=self.setor)

    def _card_com_score(self, nota='7.50'):
        from decimal import Decimal

        from apps.projects.models import (
            CardScore, ScoreHistory, ScoreHistoryAction,
        )

        card = Card.objects.create(
            nome='Trabalho pontuado', projeto=self.projeto_velho,
            status=CardStatus.EM_DESENVOLVIMENTO, criado_por=self.admin)
        score = CardScore.objects.create(
            card=card, score_final=Decimal(nota), setor_solicitante='comercial',
            criado_por=self.admin)
        ScoreHistory.objects.create(
            card=card, acao=ScoreHistoryAction.choices[0][0],
            score_final=Decimal(nota), usuario=self.admin)
        return card, score

    def _replicar(self, card):
        return _replicar_card_para_sprint(
            card, self.projeto_novo, self.sprint_velha, self.sprint_nova,
            usuario_fechamento=self.admin,
        )

    # -- o defeito relatado ----------------------------------------------

    def test_o_score_acompanha_o_card_na_virada(self):
        """O caso da tela: score no card novo, nao no da sprint encerrada."""
        from apps.projects.models import CardScore

        card, score = self._card_com_score()
        novo = self._replicar(card)

        score.refresh_from_db()
        self.assertEqual(
            score.card_id, novo.id,
            'o score ficou no card da sprint encerrada')
        self.assertFalse(
            CardScore.objects.filter(card=card).exists(),
            'o score foi COPIADO em vez de movido: a nota apareceria duas '
            'vezes na tela e contaria duas vezes em qualquer soma')

    def test_o_status_que_a_tela_mostra_e_o_do_card_vivo(self):
        """A consequencia visivel, e a razao da reclamacao.

        O card antigo congela em 'em_desenvolvimento' no fechamento. Se o score
        ficasse nele, a tela de Score mostraria isso para sempre, mesmo depois
        de o trabalho ser entregue na sprint seguinte.
        """
        card, score = self._card_com_score()
        novo = self._replicar(card)

        novo.status = CardStatus.FINALIZADO
        novo.save(update_fields=['status'])

        score.refresh_from_db()
        self.assertEqual(score.card.status, CardStatus.FINALIZADO)
        self.assertEqual(
            card.status, CardStatus.EM_DESENVOLVIMENTO,
            'o card da sprint encerrada deve continuar congelado, ele e '
            'historico')

    def test_o_historico_do_score_vai_junto(self):
        """A coluna Historico do Score sai de `card.score_historico`.

        Deixa-lo atras esvaziaria a coluna no card que passou a carregar o
        score: o dado existiria, mas em nome de ninguem.
        """
        from apps.projects.models import ScoreHistory

        card, _ = self._card_com_score()
        novo = self._replicar(card)

        self.assertEqual(ScoreHistory.objects.filter(card=novo).count(), 1)
        self.assertEqual(ScoreHistory.objects.filter(card=card).count(), 0)

    def test_card_sem_score_nao_quebra_a_replicacao(self):
        """A maioria dos cards nao tem score; o caminho tem de ser silencioso."""
        from apps.projects.models import CardScore

        card = Card.objects.create(
            nome='Sem nota', projeto=self.projeto_velho,
            status=CardStatus.EM_DESENVOLVIMENTO, criado_por=self.admin)

        novo = self._replicar(card)

        self.assertIsNotNone(novo.pk)
        self.assertFalse(CardScore.objects.filter(card=novo).exists())
        self.assertFalse(CardScore.objects.filter(card=card).exists())

    def test_mover_o_score_nao_marca_como_reavaliado(self):
        """`updated_at` do score nao sobe: mover o ponteiro nao e reavaliar.

        Se subisse, a ordenacao da tela (`-updated_at`) colocaria todo card
        replicado no topo como se alguem tivesse acabado de pontuar.
        """
        card, score = self._card_com_score()
        antes = score.updated_at

        self._replicar(card)

        score.refresh_from_db()
        self.assertEqual(
            score.updated_at, antes,
            'o `update()` virou `save()` em algum lugar e o auto_now disparou')

    # -- a trava, agora cobrindo o que faltava ---------------------------

    def test_nenhuma_relacao_nova_escapa_da_replicacao(self):
        """O irmao de `test_nenhum_campo_novo_escapa_da_replicacao`.

        Aquele cobre CAMPOS e pula relacoes reversas de proposito. Este cobre as
        relacoes reversas, que e onde o score se perdeu. Para passar, a relacao
        nova precisa ser tratada na replicacao ou declarada em
        `RELACOES_QUE_NAO_ATRAVESSAM` com a razao.
        """
        import inspect

        from apps.projects import services

        fonte = inspect.getsource(services)
        esquecidas = []
        for rel in Card._meta.get_fields():
            if not (rel.auto_created and not rel.concrete):
                continue  # campo do card, coberto pelo outro teste
            nome = rel.get_accessor_name()
            if nome in RELACOES_QUE_NAO_ATRAVESSAM:
                continue
            if nome in RELACOES_COBERTAS_INDIRETAMENTE:
                continue
            # Tratada na replicacao? O accessor ou o modelo tem de aparecer em
            # services.py.
            modelo = rel.related_model.__name__
            if ('origem.' + nome) in fonte or (modelo + '.objects') in fonte:
                continue
            esquecidas.append(nome + ' (' + modelo + ')')

        self.assertEqual(
            esquecidas, [],
            'Relacao(oes) do Card fora da replicacao de sprint: %s. Trate em '
            '`_replicar_card_para_sprint` ou declare em '
            '`RELACOES_QUE_NAO_ATRAVESSAM` explicando por que nao atravessa.'
            % ', '.join(esquecidas))

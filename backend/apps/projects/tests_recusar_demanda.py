"""Recusar uma demanda na fila "Demandas a avaliar".

Ate aqui a avaliacao tinha uma saida so: "Avaliar", que abre o formulario de
sprint e projeto - ou seja, so dava para ACEITAR. Negar exigia conhecer o
caminho de descarte, que a tela mostrava apenas ao AUTOR da demanda.

Os testes que mais importam neste arquivo nao sao os do caminho feliz. Sao os
tres que guardam efeitos colaterais silenciosos:

- `test_o_projeto_de_descarte_nasce_marcado_como_sistemico`, porque
  "Projetos Descartados" nao existe no banco e a API de projetos trata
  `is_system` como somente leitura. Feita pelo cliente, a primeira recusa
  criaria um projeto COMUM, e cada demanda recusada viraria card em aberto em
  relatorio e dashboard, para sempre.
- `test_a_demanda_recusada_sai_das_contagens_de_trabalho_em_aberto`, porque
  mover sem encerrar deixa a recusa contando como trabalho a fazer.
- `test_recusar_nao_apaga_a_demanda`, porque recusar e arquivar, nao deletar.
"""
import datetime as dt

from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.accounts.models import SetorCatalogo
from apps.projects.models import Card, CardStatus, Project, Sprint

User = get_user_model()


def rota(card_id):
    return f'/api/cards/{card_id}/recusar/'


class RecusarDemandaTests(APITestCase):

    def setUp(self):
        self.avaliador = User.objects.create_user(
            username='avaliador_dem', email='avaliador.dem@example.com',
            password='x' * 12, role='admin', is_superuser=True, is_staff=True)
        self.autor = User.objects.create_user(
            username='autor_dem', email='autor.dem@example.com',
            password='x' * 12, role='desenvolvedor')
        self.setor = SetorCatalogo.objects.create(codename='setor_dem', nome='Dem')

        agora = timezone.now()
        self.sprint = Sprint.objects.create(
            nome='Sprint das demandas', data_inicio=agora - dt.timedelta(days=1),
            fechamento_em=agora + dt.timedelta(days=7), duracao_dias=8,
            supervisor=self.avaliador, setor=self.setor)

        # A fila da tela e "cards de Sugestoes com status a_desenvolver".
        self.sugestoes = Project.objects.create(
            nome='Sugestões', sprint=self.sprint, is_system=True)
        self.demanda = Card.objects.create(
            nome='Automatizar conferencia de notas', projeto=self.sugestoes,
            status=CardStatus.A_DESENVOLVER, criado_por=self.autor)

        self.client.force_authenticate(user=self.avaliador)

    def _descartados(self):
        return Project.objects.filter(
            nome__iexact='Projetos Descartados', sprint=self.sprint).first()

    # ---------- o que a recusa faz ----------

    def test_recusar_arquiva_a_demanda_e_a_tira_da_fila(self):
        r = self.client.post(rota(self.demanda.id))
        self.assertEqual(r.status_code, 200, r.content)

        self.demanda.refresh_from_db()
        self.assertEqual(self.demanda.projeto, self._descartados())
        self.assertEqual(self.demanda.status, CardStatus.INVIABILIZADO)

        # A fila e derivada: nao ha flag "recusada" a conferir, a demanda
        # simplesmente deixa de satisfazer o filtro da tela.
        na_fila = Card.objects.filter(
            projeto=self.sugestoes, status=CardStatus.A_DESENVOLVER)
        self.assertNotIn(self.demanda, na_fila)

    def test_recusar_nao_apaga_a_demanda(self):
        """Recusar e arquivar. O texto que o avaliador confirma promete que da
        para recuperar depois, e o card precisa existir para isso ser verdade."""
        self.client.post(rota(self.demanda.id))

        self.demanda.refresh_from_db()
        self.assertEqual(self.demanda.nome, 'Automatizar conferencia de notas')
        self.assertEqual(self.demanda.criado_por, self.autor,
                         'a autoria da demanda recusada se perdeu')

    def test_o_projeto_de_descarte_nasce_marcado_como_sistemico(self):
        """`is_system` e somente leitura na API de projetos, de proposito.

        Por isso a recusa e uma action do servidor e nao dois `update` do
        cliente: criado pelo cliente, "Projetos Descartados" nasceria como
        projeto de trabalho comum e entraria nos relatorios.
        """
        self.assertIsNone(self._descartados(), 'o cenario ja comecava com o projeto')

        self.client.post(rota(self.demanda.id))

        descartados = self._descartados()
        self.assertIsNotNone(descartados, 'o projeto de descarte nao foi criado')
        self.assertTrue(descartados.is_system,
                        'projeto de descarte nasceu contando como trabalho real')
        self.assertEqual(descartados.sprint, self.sprint,
                         'o descarte deve acompanhar a sprint da demanda')

    def test_remarca_o_projeto_de_descarte_que_perdeu_a_marca_na_virada(self):
        """A replicacao de sprint NAO carrega `is_system`.

        Conferido no acervo real: "Sugestoes" e "Suporte" chegam marcados ate a
        sprint 10 e desmarcados da 11 em diante. Sem esta remarcacao, a copia
        feita na virada voltaria a contar como projeto de trabalho e a recusa
        tornaria a poluir os numeros.
        """
        Project.objects.create(
            nome='Projetos Descartados', sprint=self.sprint, is_system=False)

        self.client.post(rota(self.demanda.id))

        self.assertTrue(self._descartados().is_system,
                        'a copia da virada continuou contando como projeto real')

    def test_a_demanda_recusada_sai_das_contagens_de_trabalho_em_aberto(self):
        """Mover sem encerrar deixaria a recusa contando como trabalho a fazer.

        O dashboard so descarta um projeto quando ELE e a sprint sao sistemicos,
        e a sprint de uma demanda e real - entao mover para "Projetos
        Descartados" mantendo `a_desenvolver` nao resolveria sozinho.
        """
        antes = self.client.get('/api/dashboard/resumo/')
        self.assertEqual(antes.data['cards']['a_desenvolver'], 1)

        self.client.post(rota(self.demanda.id))

        depois = self.client.get('/api/dashboard/resumo/')
        self.assertEqual(depois.data['cards']['a_desenvolver'], 0,
                         'demanda recusada continuou contando como card a desenvolver')

    # ---------- o que a recusa NAO pode fazer ----------

    def test_sem_permissao_nao_recusa(self):
        self.client.force_authenticate(user=self.autor)
        r = self.client.post(rota(self.demanda.id))

        self.assertEqual(r.status_code, 403, r.content)
        self.demanda.refresh_from_db()
        self.assertEqual(self.demanda.status, CardStatus.A_DESENVOLVER)
        self.assertEqual(self.demanda.projeto, self.sugestoes)

    def test_nao_recusa_card_que_nao_e_demanda(self):
        """Sem esta trava o endpoint seria um "encerre qualquer card" com nome
        simpatico: um POST bastaria para inviabilizar trabalho de verdade."""
        projeto_real = Project.objects.create(nome='Projeto de verdade', sprint=self.sprint)
        card = Card.objects.create(
            nome='Trabalho em andamento', projeto=projeto_real,
            status=CardStatus.A_DESENVOLVER, criado_por=self.autor)

        r = self.client.post(rota(card.id))

        self.assertEqual(r.status_code, 400, r.content)
        card.refresh_from_db()
        self.assertEqual(card.status, CardStatus.A_DESENVOLVER)
        self.assertEqual(card.projeto, projeto_real)

    def test_recusar_duas_vezes_nao_passa(self):
        """Duplo clique, ou duas pessoas avaliando a mesma fila ao mesmo tempo."""
        self.assertEqual(self.client.post(rota(self.demanda.id)).status_code, 200)

        r = self.client.post(rota(self.demanda.id))

        self.assertEqual(r.status_code, 400, r.content)
        self.assertEqual(
            Project.objects.filter(nome__iexact='Projetos Descartados').count(), 1,
            'a segunda recusa criou um projeto de descarte duplicado')

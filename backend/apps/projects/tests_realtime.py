"""Prova EXECUTÁVEL do pedido do dono do produto:

    "Ao solicitar a reabertura, o painel de demandas e solicitações deve
     atualizar sem precisar recarregar a página."

POR QUE ESTE ARQUIVO É ESCRITO ASSIM (o mesmo raciocínio de
`apps/accounts/tests_realtime.py`, o único outro teste de tempo real da casa):

Testar `broadcast_solicitacoes_changed` isolado não provaria nada — a função
pode estar perfeita e a view simplesmente não chamá-la, que é exatamente o
defeito que esta rodada conserta. Por isso cada cenário faz a REQUISIÇÃO HTTP DE
VERDADE contra a view real (`django.test.AsyncClient` → URLconf → DRF) com um
socket real aberto no consumer real (`WebsocketCommunicator` →
`config.asgi.application`, incluindo o OriginValidator). O que se afirma aqui é
o que o navegador do usuário veria.

Dois cenários vão além do evento e conferem o EFEITO: refazem o GET da fila —
que é o que o cliente faz ao receber o evento — e verificam que a linha JÁ
sumiu. Sem isso, um broadcast disparado de dentro do `transaction.atomic()`
passaria no teste e mentiria em produção (o cliente leria o estado pré-commit).

Camada de canais EM MEMÓRIA: determinismo, e nenhuma conversa com o Redis de
dev (os ids do banco de teste colidiriam com os grupos `user_{id}` de sessões
reais abertas na máquina). Não há classe gêmea contra channels_redis porque o
que mudaria entre as duas é só o TRANSPORTE, e ele já está provado em
`accounts/tests_realtime.py::TempoRealComChannelsRedisTests`.
"""
import asyncio
import json
from datetime import timedelta

from asgiref.sync import sync_to_async
from channels.layers import InMemoryChannelLayer
from channels.testing import WebsocketCommunicator
from django.contrib.auth.models import Permission
from django.core.cache import cache
from django.test import TransactionTestCase, override_settings
from django.test.client import AsyncClient
from django.utils import timezone
from rest_framework.authtoken.models import Token

from config.asgi import application

from apps.accounts.models import (
    CARGO_CHOICES_CACHE_KEY,
    SETOR_CHOICES_CACHE_KEY,
    Cargo,
    SetorCatalogo,
    User,
    UserSetor,
)

from .models import (
    Card,
    CardCompartilhamento,
    CardReopenRequest,
    CardStatus,
    Project,
    ProjectCompartilhamento,
    Sprint,
    SprintCompartilhamento,
)

CANAL_EM_MEMORIA = {'default': {'BACKEND': 'channels.layers.InMemoryChannelLayer'}}

# O consumer entra pelo OriginValidator do config/asgi.py: sem `Origin` válida a
# conexão é recusada antes de chegar ao consumer.
ORIGEM = [(b'origin', b'http://localhost')]

EVENTO = 'solicitacoes_changed'


class _CamadaQueGrava(InMemoryChannelLayer):
    """Camada em memória que ANOTA cada `group_send` antes de entregar de fato.

    Existe para os cenários de COBERTURA, onde a pergunta não é "chegou?" (isso
    os cenários de socket real já respondem) e sim "chegou para EXATAMENTE quem
    o `get_queryset` do viewset deixa ver?". Responder isso com sockets exigiria
    abrir um por usuário da população e provar ausência por timeout — dez
    esperas de 1s para medir um conjunto que o próprio emissor já calculou.
    Lendo os grupos `user_{id}` que saíram, o conjunto é exato e sem corrida.

    Continua chamando `super()`: a entrega acontece de verdade, então nada aqui
    substitui o consumer por um dublê.
    """

    enviados = []

    @classmethod
    def zerar(cls):
        cls.enviados = []

    async def group_send(self, group, message):
        type(self).enviados.append((group, (message or {}).get('type')))
        await super().group_send(group, message)

    @classmethod
    def destinatarios_de(cls, tipo):
        """Ids dos usuários para quem `tipo` foi empurrado (grupos `user_{id}`)."""
        return {
            int(grupo[len('user_'):])
            for grupo, msg_tipo in cls.enviados
            if msg_tipo == tipo and grupo.startswith('user_')
        }


class _CamadaQuebrada(InMemoryChannelLayer):
    """A camada de canais aceita a conexão e explode no envio — o Redis que caiu
    DEPOIS de o processo subir, que é como ele costuma cair."""

    async def group_send(self, group, message):
        raise ConnectionError('camada de canais fora do ar (simulado)')


class _CamadaImpossivel(InMemoryChannelLayer):
    """A camada nem se constrói: `get_channel_layer()` LEVANTA em vez de
    devolver None.

    É o caso que passa despercebido na leitura do código, porque todo mundo
    escreve `if not channel_layer: return` supondo que o pior caso seja None.
    Acontece com `CHANNEL_LAYERS` mal configurado (BACKEND inexistente, CONFIG
    inválida) — um erro de deploy, não de código.
    """

    def __init__(self, *args, **kwargs):
        raise ConnectionError('camada de canais impossível de construir (simulado)')


_AQUI = 'apps.projects.tests_realtime'
CANAL_QUE_GRAVA = {'default': {'BACKEND': f'{_AQUI}._CamadaQueGrava'}}
CANAL_QUEBRADO = {'default': {'BACKEND': f'{_AQUI}._CamadaQuebrada'}}
CANAL_IMPOSSIVEL = {'default': {'BACKEND': f'{_AQUI}._CamadaImpossivel'}}
# Nenhuma camada configurada: `get_channel_layer()` devolve None.
SEM_CANAL = {}


class _CenariosDoPainelDeSolicitacoes:
    """Fixture + helpers + cenários. Mixin, e não classe base de teste, para não
    ser coletado e rodado sozinho com a camada de canais do ambiente (o Redis de
    dev) — que é justamente o que este arquivo evita.

    A classe concreta herda `(mixin, TransactionTestCase)`. `TransactionTestCase`
    e não `TestCase` porque o consumer abre a conexão pelo caminho assíncrono:
    `database_sync_to_async` chama `close_old_connections()`, que fecha a conexão
    presa no atomic block do `TestCase` e derruba a request seguinte com
    "connection already closed".
    """

    def setUp(self):
        # `get_cargo_choices`/`get_setor_choices` são cacheados; sem limpar, o
        # catálogo criado aqui não apareceria nas choices.
        cache.delete(CARGO_CHOICES_CACHE_KEY)
        cache.delete(SETOR_CHOICES_CACHE_KEY)

        Cargo.objects.get_or_create(
            codename='admin', defaults={'nome': 'Administrador', 'is_system': True})
        Cargo.objects.update_or_create(
            codename='visitante',
            defaults={'nome': 'Visitante', 'is_system': True, 'permissoes_padrao': []})
        # `view_content` é o PISO de visibilidade do painel (`PodeVerConteudo`) —
        # é ele, e não `approve_card_reopen`, que define quem precisa do evento.
        Cargo.objects.update_or_create(
            codename='desenvolvedor',
            defaults={'nome': 'Desenvolvedor', 'permissoes_padrao': ['view_content']})

        SetorCatalogo.objects.get_or_create(
            codename='sem_setor', defaults={'nome': 'Sem Setor', 'is_system': True})
        self.setor_tec, _ = SetorCatalogo.objects.get_or_create(
            codename='tecnologia', defaults={'nome': 'Tecnologia'})
        self.setor_com, _ = SetorCatalogo.objects.get_or_create(
            codename='comercial', defaults={'nome': 'Comercial'})

        # Ninguém é superusuário de propósito: `usuarios_com_perm_qs` inclui
        # `is_superuser=True` incondicionalmente, e um superusuário na fixture
        # esconderia um erro de recorte por trás de um destinatário universal.
        self.solicitante = self._criar('solicitante', self.setor_tec)
        self.aprovador = self._criar('aprovador', self.setor_tec)
        # O espectador é o personagem central do teste de destinatário: vê o
        # painel (e os contadores), mas NÃO pode aprovar nada.
        self.espectador = self._criar('espectador', self.setor_tec)
        self.visitante = self._criar('visitante.sem.acesso', self.setor_tec,
                                     cargo='visitante')
        self.forasteiro = self._criar('forasteiro', self.setor_com)
        self.atravessador = self._criar('atravessador', self.setor_com)

        self._conceder(self.aprovador, 'approve_card_reopen',
                       'approve_due_date_requests', 'manage_others_due_date_requests')
        self._conceder(self.atravessador, 'view_cross_setor')

        agora = timezone.now()
        self.sprint = Sprint.objects.create(
            nome='Sprint em andamento',
            data_inicio=agora - timedelta(days=1),
            fechamento_em=agora + timedelta(days=10),
            duracao_dias=11,
            supervisor=self.aprovador,
            setor=self.setor_tec,
        )
        self.projeto = Project.objects.create(
            nome='Projeto de teste', sprint=self.sprint, setor=self.setor_tec)
        # Card FECHADO: é a pré-condição do pedido de reabertura.
        self.card_fechado = Card.objects.create(
            nome='Card fechado', projeto=self.projeto, responsavel=self.solicitante,
            status=CardStatus.FINALIZADO, data_fim=agora - timedelta(days=2),
            finalizado_em=agora - timedelta(days=2),
        )
        # Card ABERTO com prazo: pré-condição da fila IRMÃ (mudança de data).
        self.card_aberto = Card.objects.create(
            nome='Card aberto', projeto=self.projeto, responsavel=self.solicitante,
            status=CardStatus.A_DESENVOLVER, data_fim=agora + timedelta(days=3),
        )

        self.tokens = {
            u.username: Token.objects.create(user=u).key
            for u in (self.solicitante, self.aprovador, self.espectador,
                      self.visitante, self.forasteiro, self.atravessador)
        }
        self.api = AsyncClient()

    # ---- fixture ----------------------------------------------------------

    def _criar(self, username, setor, cargo='desenvolvedor'):
        user = User.objects.create_user(
            username=username, password='SenhaForte!123', role=cargo)
        UserSetor.objects.create(user=user, setor=setor, is_primary=True)
        return user

    def _conceder(self, user, *codenames):
        perms = Permission.objects.filter(
            content_type__app_label='accounts', codename__in=codenames)
        self.assertEqual(perms.count(), len(codenames),
                         f'catálogo incompleto para {codenames}')
        user.user_permissions.add(*perms)

    # ---- utilitários ------------------------------------------------------

    def _auth(self, username):
        return {'authorization': f'Token {self.tokens[username]}'}

    async def _abrir_socket(self, username):
        """Abre o WebSocket exatamente como o frontend abre: token na query
        string, contra o `application` do config/asgi.py."""
        comm = WebsocketCommunicator(
            application,
            f'/ws/notifications/?token={self.tokens[username]}',
            headers=ORIGEM,
        )
        # timeout generoso: o `connect()` do consumer consulta o banco, e o
        # padrão de 1s vira falha intermitente em máquina ocupada (o teste mede
        # o EVENTO, não a latência do handshake).
        conectado, _ = await comm.connect(timeout=15)
        self.assertTrue(conectado, f'WebSocket de {username} não conectou')
        return comm

    async def _post(self, path, payload=None, como='solicitante'):
        return await self.api.post(
            path, data=json.dumps(payload or {}), content_type='application/json',
            headers=self._auth(como))

    async def _patch(self, path, payload, como='aprovador'):
        return await self.api.patch(
            path, data=json.dumps(payload), content_type='application/json',
            headers=self._auth(como))

    async def _linhas(self, path, como='aprovador'):
        resp = await self.api.get(path, headers=self._auth(como))
        self.assertEqual(resp.status_code, 200, resp.content)
        dados = resp.json()
        return dados['results'] if isinstance(dados, dict) and 'results' in dados else dados

    async def _esperar(self, socket, quem, quantos=1):
        """Espera `quantos` eventos `solicitacoes_changed`, IGNORANDO os demais.

        Pelo MESMO socket `user_{id}` trafegam também as notificações
        persistidas (card movido, desfecho da avaliação). Afirmar sobre a
        PRIMEIRA mensagem tornaria o teste refém dessa ordem — e o que se quer
        provar é a CHEGADA do evento, não a posição dele na fila.
        """
        vistos = []
        encontrados = 0
        while encontrados < quantos:
            try:
                evento = await socket.receive_json_from(timeout=5)
            except asyncio.TimeoutError:
                self.fail(f'{quem} não recebeu {quantos}x {EVENTO} (recebeu: {vistos})')
            vistos.append(evento.get('type'))
            if evento.get('type') == EVENTO:
                encontrados += 1

    async def _nada_de_painel(self, socket, quem):
        """Nenhum evento do painel para quem não enxerga o painel.

        Verificado DEPOIS dos positivos de propósito: se os destinatários certos
        já receberam, o broadcast comprovadamente rodou — então "nada aqui"
        significa recorte, e não corrida."""
        self.assertTrue(
            await socket.receive_nothing(timeout=1),
            f'{quem} foi avisado sem motivo — o recorte de destinatário falhou')

    async def _pedir_reabertura(self, card=None, como='solicitante'):
        resp = await self._post('/api/card-reopen-requests/', {
            'card': (card or self.card_fechado).id,
            'nova_data_entrega': (timezone.now() + timedelta(days=5)).isoformat(),
            'reason': 'faltou um ajuste',
        }, como=como)
        self.assertEqual(resp.status_code, 201, resp.content)
        return resp.json()['id']

    # ---- 1. criação: o pedido literal do dono do produto ------------------

    async def test_1_solicitar_reabertura_avisa_quem_ve_o_painel(self):
        """O cenário do pedido, e o que prova a decisão de DESTINATÁRIO: quem só
        VÊ a fila (espectador) precisa do evento tanto quanto quem a aprova —
        as três abas e seus contadores são renderizados para todos. Trocar
        `view_content` por `approve_card_reopen` no emissor quebra aqui."""
        s_sol = await self._abrir_socket('solicitante')
        s_apr = await self._abrir_socket('aprovador')
        s_esp = await self._abrir_socket('espectador')
        s_vis = await self._abrir_socket('visitante.sem.acesso')
        try:
            await self._pedir_reabertura()

            await self._esperar(s_sol, 'solicitante')
            await self._esperar(s_apr, 'aprovador')
            await self._esperar(s_esp, 'espectador')
            # Quem não tem `view_content` não enxerga o painel: avisá-lo seria
            # gastar ~7 requisições da sessão dele para mudar zero pixel.
            await self._nada_de_painel(s_vis, 'visitante')
        finally:
            for s in (s_sol, s_apr, s_esp, s_vis):
                await s.disconnect()

    # ---- 2. aprovação: evento E estado já commitado -----------------------

    async def test_2_aprovar_avisa_e_a_fila_ja_volta_sem_a_linha(self):
        """Evento + EFEITO: o GET que o cliente refaz ao receber o aviso já volta
        sem a linha aprovada.

        LIMITE HONESTO deste assert: ele NÃO prova a ordem em relação ao commit.
        O teste é sequencial — a resposta do POST é aguardada antes do GET, então
        a transação já fechou de qualquer jeito. Provar o `on_commit` exigiria o
        GET do cliente CORRENDO com a transação ainda aberta no servidor, coisa
        que um teste sequencial não encena. O que se garante aqui é que o evento
        sai e o estado que ele manda buscar já é o novo.
        """
        # A fila já nasce cheia e o socket abre DEPOIS: o que se mede aqui é só
        # o evento da aprovação.
        req_id = await self._pedir_reabertura()
        s_esp = await self._abrir_socket('espectador')
        try:
            resp = await self._post(f'/api/card-reopen-requests/{req_id}/approve/',
                                    como='aprovador')
            self.assertEqual(resp.status_code, 200, resp.content)

            await self._esperar(s_esp, 'espectador')
            self.assertEqual(
                await self._linhas('/api/card-reopen-requests/?status=pending'), [],
                'o GET que o cliente refaz ao receber o evento ainda via a linha '
                'aprovada — broadcast pré-commit')
        finally:
            await s_esp.disconnect()

    # ---- 3. recusa --------------------------------------------------------

    async def test_3_recusar_avisa_e_esvazia_a_fila(self):
        req_id = await self._pedir_reabertura()
        s_esp = await self._abrir_socket('espectador')
        try:
            resp = await self._post(f'/api/card-reopen-requests/{req_id}/reject/',
                                    como='aprovador')
            self.assertEqual(resp.status_code, 200, resp.content)

            await self._esperar(s_esp, 'espectador')
            self.assertEqual(
                await self._linhas('/api/card-reopen-requests/?status=pending'), [])
        finally:
            await s_esp.disconnect()

    # ---- 4. desistência do próprio dono -----------------------------------

    async def test_4_excluir_pendente_avisa_o_painel(self):
        """Apagar uma linha pendente tira um item do painel de todo mundo — é o
        ponto que se esquece com mais facilidade, porque não tem action própria."""
        req_id = await self._pedir_reabertura()
        s_esp = await self._abrir_socket('espectador')
        try:
            resp = await self.api.delete(f'/api/card-reopen-requests/{req_id}/',
                                         headers=self._auth('solicitante'))
            self.assertEqual(resp.status_code, 204, resp.content)

            await self._esperar(s_esp, 'espectador')
            self.assertEqual(
                await self._linhas('/api/card-reopen-requests/?status=pending'), [])
        finally:
            await s_esp.disconnect()

    # ---- 5. PATCH que troca o card ----------------------------------------

    async def test_5_trocar_o_card_no_patch_avisa_os_dois_lados(self):
        """`card` é campo gravável: trocá-lo move a linha entre escopos de
        setor. Um aviso só (o do card novo) deixaria o painel de quem via o card
        ANTIGO com uma linha que já não está mais lá."""
        req_id = await self._pedir_reabertura()
        s_esp = await self._abrir_socket('espectador')
        try:
            resp = await self._patch(f'/api/card-reopen-requests/{req_id}/',
                                     {'card': self.card_aberto.id})
            self.assertEqual(resp.status_code, 200, resp.content)

            await self._esperar(s_esp, 'espectador', quantos=2)
        finally:
            await s_esp.disconnect()

    # ---- 6. a fila IRMÃ (solicitações de data) ----------------------------

    async def test_6_fila_de_datas_emite_o_mesmo_evento(self):
        """O painel é UM só e o cliente reage com UMA função — por isso as duas
        filas emitem o MESMO tipo. A aba de datas entra de graça, e seria
        visivelmente incoerente a de reabertura atualizar sozinha."""
        s_esp = await self._abrir_socket('espectador')
        try:
            resp = await self._post('/api/card-date-change-requests/', {
                'card': self.card_aberto.id,
                'requested_date': (timezone.now() + timedelta(days=9)).isoformat(),
                'reason': 'dependência externa atrasou',
            })
            self.assertEqual(resp.status_code, 201, resp.content)
            req_id = resp.json()['id']
            await self._esperar(s_esp, 'espectador')

            resp = await self._post(f'/api/card-date-change-requests/{req_id}/approve/',
                                    como='aprovador')
            self.assertEqual(resp.status_code, 200, resp.content)
            await self._esperar(s_esp, 'espectador')
            self.assertEqual(
                await self._linhas('/api/card-date-change-requests/?status=pending'), [])
        finally:
            await s_esp.disconnect()

    async def test_6b_recusa_na_fila_de_datas_tambem_avisa(self):
        s_esp = await self._abrir_socket('espectador')
        try:
            resp = await self._post('/api/card-date-change-requests/', {
                'card': self.card_aberto.id,
                'requested_date': (timezone.now() + timedelta(days=9)).isoformat(),
            })
            self.assertEqual(resp.status_code, 201, resp.content)
            await self._esperar(s_esp, 'espectador')

            resp = await self._post(
                f'/api/card-date-change-requests/{resp.json()["id"]}/reject/',
                como='aprovador')
            self.assertEqual(resp.status_code, 200, resp.content)
            await self._esperar(s_esp, 'espectador')
        finally:
            await s_esp.disconnect()

    # ---- 7. o bug DORMENTE de segmentação ---------------------------------

    @override_settings(SETOR_SCOPING_ENABLED=True)
    async def test_7_com_escopo_ligado_outro_setor_nao_e_avisado(self):
        """Único teste que protege o vazamento dormente.

        Com a flag desligada (o estado de hoje) os dois conjuntos coincidem e
        este cenário passaria mesmo sem recorte nenhum. Ligada, o evento sem
        payload ainda revelaria CADÊNCIA: alguém do comercial mediria a
        frequência de reaberturas da tecnologia. Quem tem `view_cross_setor`
        continua recebendo, porque essa permissão existe para atravessar a
        segmentação.

        O cenário PROVA A PRÓPRIA PREMISSA em vez de supô-la: antes de afirmar
        "o forasteiro não pode ser avisado", ele mostra pelo GET real que o
        `get_queryset` do viewset de fato não entrega a linha a ele — e que
        entrega ao espectador. Sem esses dois GETs, o teste continuaria verde
        num dia em que o escopo do queryset mudasse e o silêncio virasse bug.
        """
        s_esp = await self._abrir_socket('espectador')
        s_atr = await self._abrir_socket('atravessador')
        s_for = await self._abrir_socket('forasteiro')
        try:
            req_id = await self._pedir_reabertura()

            fila = '/api/card-reopen-requests/?status=pending'
            self.assertEqual(
                [linha['id'] for linha in await self._linhas(fila, como='espectador')],
                [req_id],
                'premissa quebrada: o espectador precisa ENXERGAR a linha')
            self.assertEqual(
                await self._linhas(fila, como='forasteiro'), [],
                'premissa quebrada: o forasteiro não pode enxergar a linha — sem '
                'isso o silêncio dele no socket não prova recorte nenhum')

            await self._esperar(s_esp, 'espectador')
            await self._esperar(s_atr, 'atravessador')
            await self._nada_de_painel(s_for, 'forasteiro (outro setor)')
        finally:
            for s in (s_esp, s_atr, s_for):
                await s.disconnect()

    # ---- 8. projeto arquivado: nada a atualizar ---------------------------

    async def test_8_projeto_arquivado_nao_dispara_recarga(self):
        """`list` filtra `card__projeto__arquivado=False`, então a linha não
        aparece no painel de ninguém. Emitir custaria ~7 requisições em toda
        sessão aberta para mudar zero pixel."""
        req_id = await self._pedir_reabertura()
        s_esp = await self._abrir_socket('espectador')
        try:
            await Project.objects.filter(pk=self.projeto.pk).aupdate(arquivado=True)
            # A linha continua acessível por id (a fila só some da LISTAGEM),
            # então a recusa vem do broadcast, não de um 404.
            resp = await self._post(f'/api/card-reopen-requests/{req_id}/reject/',
                                    como='aprovador')
            self.assertEqual(resp.status_code, 200, resp.content)
            self.assertTrue(
                await CardReopenRequest.objects.filter(
                    pk=req_id, status='rejected').aexists())

            await self._nada_de_painel(s_esp, 'espectador (projeto arquivado)')
        finally:
            await s_esp.disconnect()

    # ---- 9 a 11. a camada de canais fora do ar ----------------------------
    #
    # O contrato dos três: tempo real é MELHORIA de UX. A solicitação foi pedida
    # por uma pessoa e já está commitada quando o aviso sai — perder o aviso
    # custa um F5, e derrubar a request custa o trabalho dela. Nenhum socket é
    # aberto aqui de propósito: com a camada quebrada não há como conectar, e o
    # que se mede é justamente o que sobra quando o tempo real não funciona.

    @override_settings(CHANNEL_LAYERS=CANAL_QUEBRADO)
    async def test_9_camada_que_explode_no_envio_nao_derruba_a_request(self):
        """Redis que cai DEPOIS de o processo subir: `group_send` levanta.

        Cobre o ciclo inteiro (criar e aprovar), porque a aprovação passa por
        três emissores diferentes — o do painel, o do kanban e a notificação
        persistida — e basta um deles deixar a exceção escapar para o usuário
        ver 500 numa operação que o banco já aceitou.
        """
        req_id = await self._pedir_reabertura()
        self.assertTrue(
            await CardReopenRequest.objects.filter(pk=req_id, status='pending').aexists(),
            'a solicitação precisa existir mesmo sem ninguém ter sido avisado')

        resp = await self._post(f'/api/card-reopen-requests/{req_id}/approve/',
                                como='aprovador')
        self.assertEqual(resp.status_code, 200, resp.content)
        card = await Card.objects.aget(pk=self.card_fechado.pk)
        self.assertEqual(
            card.status, CardStatus.A_DESENVOLVER,
            'a reabertura precisa acontecer de verdade com a camada fora do ar')

    @override_settings(CHANNEL_LAYERS=CANAL_IMPOSSIVEL)
    async def test_10_camada_que_nem_se_constroi_nao_derruba_a_request(self):
        """O caso que o `if not channel_layer: return` NÃO cobre.

        `get_channel_layer()` devolve None só quando não há camada configurada;
        quando há e ela não pode ser construída, ele LEVANTA. Era assim que uma
        `CHANNEL_LAYERS` mal configurada derrubava a aprovação: o
        `broadcast_card_moved`, chamado do post_save do Card, resolvia a camada
        FORA do próprio try/except e a exceção subia pelo signal até a view
        (regressão corrigida junto com este teste — ver `projects/realtime.py`).
        """
        req_id = await self._pedir_reabertura()
        self.assertTrue(
            await CardReopenRequest.objects.filter(pk=req_id, status='pending').aexists())

        resp = await self._post(f'/api/card-reopen-requests/{req_id}/approve/',
                                como='aprovador')
        self.assertEqual(
            resp.status_code, 200, resp.content)
        card = await Card.objects.aget(pk=self.card_fechado.pk)
        self.assertEqual(card.status, CardStatus.A_DESENVOLVER)

    @override_settings(CHANNEL_LAYERS=SEM_CANAL)
    async def test_11_sem_camada_configurada_a_solicitacao_e_criada(self):
        """Ambiente sem WebSocket nenhum (um `manage.py shell`, um worker, um
        deploy sem Redis): o fluxo tem de continuar inteiro, só sem tempo real."""
        req_id = await self._pedir_reabertura()
        self.assertTrue(
            await CardReopenRequest.objects.filter(pk=req_id, status='pending').aexists())

    # ---- 12 e 13. cobertura: destinatários × quem o GET deixa ver ---------

    def _montar_populacao_de_cobertura(self):
        """Gente cuja visibilidade entra por um ramo DIFERENTE do queryset.

        O queryset das duas filas é uma disjunção de três condições
        (`scope_card_reopen_requests`): setor do card, card emprestado, projeto
        visível — e o terceiro é ele mesmo uma disjunção (projeto do setor,
        projeto emprestado, projeto dentro de sprint emprestada). Uma população
        só de "mesmo setor / outro setor" exercitaria um ramo e deixaria os
        outros por conta da leitura. Aqui cada empréstimo cria um usuário que
        SÓ enxerga por aquele caminho — se o emissor esquecer um deles, o
        conjunto de destinatários fica menor que o de quem vê, e é exatamente
        essa diferença que os dois cenários abaixo medem.

        Método síncrono de propósito: os cenários são `async` e o ORM aqui é
        criação em lote, mais legível assim do que em `a*` encadeado.
        """
        def setor(codename, nome):
            obj, _ = SetorCatalogo.objects.get_or_create(
                codename=codename, defaults={'nome': nome})
            return obj

        # Card emprestado avulso (ramo `card_id__in=_cards_compartilhados`).
        design = setor('design', 'Design')
        self.emprestado_card = self._criar('emprestado.card', design)
        CardCompartilhamento.objects.create(card=self.card_fechado, setor=design)
        # Projeto emprestado (ramo `card__projeto_id__in=_projetos_visiveis_ids`,
        # sub-ramo `ProjectCompartilhamento`).
        marketing = setor('marketing', 'Marketing')
        self.emprestado_projeto = self._criar('emprestado.projeto', marketing)
        ProjectCompartilhamento.objects.create(project=self.projeto, setor=marketing)
        # Sprint emprestada: a CASCATA — empresta a sprint, alcança os cards.
        financeiro = setor('financeiro', 'Financeiro')
        self.emprestado_sprint = self._criar('emprestado.sprint', financeiro)
        SprintCompartilhamento.objects.create(sprint=self.sprint, setor=financeiro)
        # Sem setor nenhum: `scope_*` devolve `qs.none()` para ele. Está aqui
        # para o cenário ter também um caso em que ver NADA é o certo.
        self.orfao = User.objects.create_user(
            username='sem.setor.algum', password='SenhaForte!123', role='desenvolvedor')

        novos = [self.emprestado_card, self.emprestado_projeto,
                 self.emprestado_sprint, self.orfao]
        for user in novos:
            self.tokens[user.username] = Token.objects.create(user=user).key

        return [self.solicitante, self.aprovador, self.espectador, self.visitante,
                self.forasteiro, self.atravessador] + novos

    async def _medir_cobertura(self):
        """Devolve (população, quem VÊ, quem foi AVISADO) para o mesmo pedido.

        "Quem vê" sai do GET real de cada usuário contra a view real — inclusive
        o 403 de quem não tem `view_content`, que é a forma como o painel some
        para ele. Não é uma releitura do `scope_*` no teste: se fosse, o teste
        provaria só que sei copiar a expressão do produto.
        """
        populacao = await sync_to_async(self._montar_populacao_de_cobertura)()

        _CamadaQueGrava.zerar()
        req_id = await self._pedir_reabertura()
        avisados = _CamadaQueGrava.destinatarios_de(EVENTO)

        veem = set()
        for user in populacao:
            resp = await self.api.get('/api/card-reopen-requests/?status=pending',
                                      headers=self._auth(user.username))
            if resp.status_code != 200:
                continue
            dados = resp.json()
            linhas = dados['results'] if isinstance(dados, dict) and 'results' in dados else dados
            if any(linha['id'] == req_id for linha in linhas):
                veem.add(user.pk)
        return populacao, veem, avisados

    def _conferir(self, populacao, veem, avisados, esperado_ve):
        nome = {u.pk: u.username for u in populacao}
        traduz = lambda ids: sorted(nome.get(i, f'<id {i}>') for i in ids)  # noqa: E731

        # Sem esta âncora o resto seria vácuo: dois conjuntos vazios também
        # satisfazem "ninguém que vê ficou de fora".
        self.assertEqual(
            traduz(veem), sorted(esperado_ve),
            'o cenário deixou de exercitar algum ramo do queryset escopado — '
            'conserte a população antes de acreditar nas comparações abaixo')

        self.assertEqual(
            traduz(veem - avisados), [],
            'DEFEITO: essas pessoas ENXERGAM a solicitação na fila e NÃO foram '
            'avisadas — o painel delas fica velho até um F5, que é exatamente o '
            'bug que este trabalho conserta')
        self.assertEqual(
            traduz(avisados - veem), [],
            'essas pessoas foram avisadas sem enxergar a linha. Não é vazamento '
            '(o evento não tem payload e o GET delas volta filtrado), mas nesta '
            'população nenhum ramo de fail-open se aplica — então sobra alguém '
            'só se o recorte de destinatário parou de recortar')

    @override_settings(CHANNEL_LAYERS=CANAL_QUE_GRAVA, SETOR_SCOPING_ENABLED=True)
    async def test_12_com_escopo_ligado_avisados_batem_com_quem_ve(self):
        """A comparação que fecha a pergunta "ninguém fica de fora?".

        Com a segmentação ligada, quem vê são os cinco caminhos de alcance
        (setor dono, card emprestado, projeto emprestado, sprint emprestada e o
        bypass de `view_cross_setor`) — e o conjunto avisado tem de ser o mesmo.
        """
        populacao, veem, avisados = await self._medir_cobertura()
        self._conferir(populacao, veem, avisados, esperado_ve={
            'solicitante', 'aprovador', 'espectador', 'atravessador',
            'emprestado.card', 'emprestado.projeto', 'emprestado.sprint',
        })

    @override_settings(CHANNEL_LAYERS=CANAL_QUE_GRAVA, SETOR_SCOPING_ENABLED=False)
    async def test_13_com_escopo_desligado_avisados_batem_com_quem_ve(self):
        """O MESMO confronto no estado de HOJE (flag desligada), onde a fila é
        visível para todo mundo que tem `view_content` — inclusive quem não tem
        setor e quem está em outro setor.

        É este cenário que morde se alguém decidir que o destinatário certo é
        "quem tem `approve_card_reopen`": o conjunto avisado encolheria para uma
        pessoa e as outras seis ficariam com o contador velho.
        """
        populacao, veem, avisados = await self._medir_cobertura()
        self._conferir(populacao, veem, avisados, esperado_ve={
            'solicitante', 'aprovador', 'espectador', 'forasteiro', 'atravessador',
            'emprestado.card', 'emprestado.projeto', 'emprestado.sprint',
            'sem.setor.algum',
        })

    # ---- 14. aprovar MOVE o card: o alcance de antes também precisa saber ----

    def _preparar_reancoramento(self):
        """Sprint de origem cedida ao financeiro e já FECHADA, mais a sprint
        atual do mesmo setor para receber o card reaberto.

        É a única situação em que aprovar MUDA o alcance da própria linha: o
        card sai do projeto da sprint emprestada e vai para um projeto novo na
        sprint atual, que não carrega aquele empréstimo (a cópia de
        `ProjectCompartilhamento` em `reancorar_card_na_sprint` só replica o que
        estava no PROJETO — o empréstimo da SPRINT fica para trás).
        """
        financeiro, _ = SetorCatalogo.objects.get_or_create(
            codename='financeiro', defaults={'nome': 'Financeiro'})
        self.emprestado_sprint = self._criar('emprestado.sprint', financeiro)
        self.tokens[self.emprestado_sprint.username] = Token.objects.create(
            user=self.emprestado_sprint).key
        SprintCompartilhamento.objects.create(sprint=self.sprint, setor=financeiro)

        agora = timezone.now()
        # `.update()` e não `.save()`: fechar a sprint aqui é cenário, não
        # comportamento — o `save()` ainda reagenda o fechamento automático.
        Sprint.objects.filter(pk=self.sprint.pk).update(
            data_inicio=agora - timedelta(days=20),
            fechamento_em=agora - timedelta(days=1))
        return Sprint.objects.create(
            nome='Sprint atual', data_inicio=agora - timedelta(days=1),
            fechamento_em=agora + timedelta(days=10), duracao_dias=11,
            supervisor=self.aprovador, setor=self.setor_tec)

    @override_settings(CHANNEL_LAYERS=CANAL_QUE_GRAVA, SETOR_SCOPING_ENABLED=True)
    async def test_14_aprovar_movendo_o_card_avisa_quem_via_pelo_caminho_antigo(self):
        """O confronto dos cenários 12/13, mas no instante da APROVAÇÃO.

        Lá o alcance do card é o mesmo antes e depois; aqui a aprovação REANCORA
        o card noutra sprint e o alcance muda no meio da operação. Resolver os
        destinatários só sobre o card já movido calaria justamente quem via a
        linha pela sprint antiga — a pessoa fica com a solicitação aprovada no
        painel até um F5, que é o bug que esta rodada existe para fechar.
        """
        sprint_nova = await sync_to_async(self._preparar_reancoramento)()
        req_id = await self._pedir_reabertura()

        fila = '/api/card-reopen-requests/?status=pending'
        self.assertEqual(
            [linha['id'] for linha in await self._linhas(fila, como='emprestado.sprint')],
            [req_id],
            'premissa quebrada: quem tem a sprint emprestada precisa ENXERGAR a '
            'linha ANTES da aprovação — sem isso o teste não prova nada')

        _CamadaQueGrava.zerar()
        resp = await self._post(f'/api/card-reopen-requests/{req_id}/approve/',
                                como='aprovador')
        self.assertEqual(resp.status_code, 200, resp.content)

        card = await Card.objects.select_related('projeto').aget(pk=self.card_fechado.pk)
        self.assertEqual(
            card.projeto.sprint_id, sprint_nova.pk,
            'premissa quebrada: sem o reancoramento o alcance não muda e o '
            'cenário vira um duplicado do 12')

        self.assertIn(
            self.emprestado_sprint.pk, _CamadaQueGrava.destinatarios_de(EVENTO),
            'DEFEITO: quem enxergava a solicitação pela sprint emprestada não '
            'foi avisado de que ela saiu da fila — o card mudou de sprint na '
            'própria aprovação e o aviso só olhou o destino')


@override_settings(CHANNEL_LAYERS=CANAL_EM_MEMORIA)
class PainelDeSolicitacoesTempoRealTests(
        _CenariosDoPainelDeSolicitacoes, TransactionTestCase):

    """Todos os cenários, camada em memória (rápida e determinística)."""

    # RESTAURA O SEED DAS MIGRAÇÕES DEPOIS DO FLUSH.
    #
    # `TransactionTestCase` não usa transação: faz TRUNCATE em todas as tabelas
    # ao terminar. Isso apaga o que as migrações semearam (o formulário de
    # feedback ativo, o catálogo de etapas), e quem roda depois quebra com um
    # `DoesNotExist` que não tem nenhuma relação com o que estava sendo testado
    # — foi esse o efeito de 48 erros aparentemente aleatórios.
    #
    # O QUE ISTO CONSERTA E O QUE NÃO CONSERTA: o Django serializa o banco no
    # início da execução e devolve esse retrato no `_fixture_setup` seguinte.
    # Logo, protege de uma classe para a outra DENTRO da mesma execução. NÃO
    # protege ENTRE execuções com `--keepdb`: o último flush fica gravado no
    # banco reaproveitado, e a rodada seguinte serializa o estado já vazio.
    # Rodando `--keepdb` depois de uma suíte completa, recrie o banco de teste.
    serialized_rollback = True

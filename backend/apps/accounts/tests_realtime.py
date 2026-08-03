"""Prova EXECUTÁVEL do requisito de tempo real do pedido do dono do produto:

    "Todas as alterações de permissão devem surtir efeito em tempo real e
     imediato sem que o Italo ou quaisquer outro usuário precise recarregar
     a página."

POR QUE este arquivo existe e por que ele é escrito assim:

Testar `notify_permissions_changed` isoladamente não prova nada — a função pode
estar perfeita e a view simplesmente não chamá-la (foi exatamente o buraco do
caminho novo: editar `Cargo.permissoes_padrao` mudava o acesso de todo mundo e
ninguém era avisado). Por isso cada cenário aqui faz a REQUISIÇÃO HTTP DE
VERDADE contra a view real (`django.test.AsyncClient` → URLconf → DRF) com um
socket real aberto no consumer real (`channels.testing.WebsocketCommunicator`
→ `config.asgi.application`, incluindo o OriginValidator). O que se afirma é o
que o navegador do usuário veria.

Além do evento, os cenários que mudam acesso conferem o EFEITO: refazem
GET /users/me/ como o usuário afetado — que é o que o cliente faz ao receber o
evento — e verificam que `permissions`/`setores` já vieram diferentes. Evento
que chega sem a mudança ter surtido efeito seria tempo real de mentira.

O grosso roda com a camada de canais EM MEMÓRIA, por determinismo e para não
conversar com o Redis de dev (os IDs do banco de teste colidiriam com os grupos
`user_{id}` de sessões reais abertas na máquina). Mas em produção a camada é o
channels_redis, e um teste que só passa em memória não provaria o caminho real
— por isso `TempoRealComChannelsRedisTests` repete os cenários decisivos contra
o Redis de verdade, num índice de banco isolado (ver `_camada_redis_isolada`).
"""
import json
import unittest
from urllib.parse import urlparse, urlunparse

from channels.testing import WebsocketCommunicator
from django.conf import settings
from django.core.cache import cache
from django.test import TransactionTestCase, override_settings
from django.test.client import AsyncClient
from rest_framework.authtoken.models import Token

from config.asgi import application

from .models import (
    CARGO_CHOICES_CACHE_KEY,
    SETOR_CHOICES_CACHE_KEY,
    Cargo,
    SetorCatalogo,
    User,
)

CANAL_EM_MEMORIA = {'default': {'BACKEND': 'channels.layers.InMemoryChannelLayer'}}

# Índice de banco do Redis reservado ao teste. O servidor de dev fala no 0; se o
# teste usasse o mesmo, um `user_{id}` do banco de teste poderia coincidir com o
# de alguém logado na máquina e derrubar a sessão dessa pessoa (o cenário de
# desativação empurra `account_deactivated`). Índice próprio = isolamento total.
_DB_REDIS_DE_TESTE = 9


def _camada_redis_isolada():
    """A configuração REAL de channels_redis do projeto, apontada para um índice
    de banco só do teste. Devolve None quando o ambiente não está configurado
    com Redis — aí a classe correspondente é pulada em vez de falhar."""
    config = (settings.CHANNEL_LAYERS or {}).get('default') or {}
    if 'redis' not in (config.get('BACKEND') or '').lower():
        return None
    hosts = []
    for host in config.get('CONFIG', {}).get('hosts') or []:
        if isinstance(host, str):
            partes = urlparse(host)
            hosts.append(urlunparse(partes._replace(path=f'/{_DB_REDIS_DE_TESTE}')))
        elif isinstance(host, (tuple, list)) and len(host) >= 2:
            hosts.append(f'redis://{host[0]}:{host[1]}/{_DB_REDIS_DE_TESTE}')
    if not hosts:
        return None
    return {'default': {'BACKEND': config['BACKEND'], 'CONFIG': {'hosts': hosts}}}


_CAMADA_REDIS = _camada_redis_isolada()

# O consumer entra pelo OriginValidator do config/asgi.py: sem `Origin` válida a
# conexão é recusada antes de chegar ao consumer. 'localhost' está em
# ALLOWED_HOSTS, então é a origem que um cliente de dev usaria.
ORIGEM = [(b'origin', b'http://localhost')]


class _CenariosDeTempoReal:
    """Fixture + helpers + cenários. Mixin, e não uma classe de teste base, para
    não ser coletado e rodado sozinho com a camada de canais do ambiente (o
    Redis de dev, índice 0) — que é exatamente o que este arquivo evita.

    As classes concretas herdam `(_CenariosDeTempoReal, TransactionTestCase)` e
    só trocam a camada de canais. `TransactionTestCase` (e não `TestCase`)
    porque o consumer abre a conexão pelo caminho assíncrono:
    `database_sync_to_async` chama `close_old_connections()`, que fecha a
    conexão presa no atomic block do `TestCase` e derruba a request seguinte com
    "connection already closed".
    """

    def setUp(self):
        # `get_cargo_choices`/`get_setor_choices` são cacheados; sem limpar, o
        # catálogo criado aqui não apareceria nas choices e `get_role_display`
        # devolveria valores de outra rodada.
        cache.delete(CARGO_CHOICES_CACHE_KEY)
        cache.delete(SETOR_CHOICES_CACHE_KEY)

        Cargo.objects.get_or_create(
            codename='admin', defaults={'nome': 'Administrador', 'is_system': True})
        self.cargo_dev, _ = Cargo.objects.get_or_create(
            codename='desenvolvedor',
            defaults={'nome': 'Desenvolvedor', 'permissoes_padrao': []})
        self.cargo_analista, _ = Cargo.objects.get_or_create(
            codename='analista', defaults={'nome': 'Analista', 'permissoes_padrao': []})

        # 'sem_setor' é o balde de não classificados (accounts/scoping.py); a
        # regra do setor padrão só roda se ele existir.
        SetorCatalogo.objects.get_or_create(
            codename='sem_setor', defaults={'nome': 'Sem Setor', 'is_system': True})
        self.setor_tec, _ = SetorCatalogo.objects.get_or_create(
            codename='tecnologia', defaults={'nome': 'Tecnologia'})

        # A gestora tem role='admin' (e não is_superuser) de propósito: assim a
        # autorização dela passa pelo AdminRolePermissionBackend, o caminho real.
        self.gestora = User.objects.create_user(
            username='gestora', password='SenhaForte!123', role='admin')
        self.italo = User.objects.create_user(
            username='italo.martins', password='SenhaForte!123', role='desenvolvedor')
        self.colega = User.objects.create_user(
            username='colega', password='SenhaForte!123', role='desenvolvedor')
        self.forasteiro = User.objects.create_user(
            username='forasteiro', password='SenhaForte!123', role='analista')

        self.tokens = {
            u.username: Token.objects.create(user=u).key
            for u in (self.gestora, self.italo, self.colega, self.forasteiro)
        }
        self.api = AsyncClient()

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
        # timeout generoso: o `connect()` do consumer faz consulta ao banco e o
        # padrão de 1s do communicator vira falha intermitente numa máquina
        # ocupada (o teste mede o EVENTO, não a latência do handshake).
        conectado, _ = await comm.connect(timeout=15)
        self.assertTrue(conectado, f'WebSocket de {username} não conectou')
        return comm

    async def _post(self, path, payload, como='gestora'):
        return await self.api.post(
            path, data=json.dumps(payload), content_type='application/json',
            headers=self._auth(como))

    async def _patch(self, path, payload, como='gestora'):
        return await self.api.patch(
            path, data=json.dumps(payload), content_type='application/json',
            headers=self._auth(como))

    async def _me(self, username):
        resp = await self.api.get('/api/users/me/', headers=self._auth(username))
        self.assertEqual(resp.status_code, 200, resp.content)
        return resp.json()

    async def _esperar(self, socket, tipo, quem):
        evento = await socket.receive_json_from(timeout=5)
        self.assertEqual(
            evento.get('type'), tipo,
            f'{quem} recebeu {evento!r} em vez de {tipo}')
        return evento

    # ---- 1. permissão individual -----------------------------------------

    async def test_1_permissao_individual_avisa_o_usuario(self):
        socket = await self._abrir_socket('italo.martins')
        try:
            antes = await self._me('italo.martins')
            self.assertNotIn('view_metrics', antes['permissions'])

            resp = await self._post(
                f'/api/users/{self.italo.pk}/set-permissions/',
                {'codenames': ['view_metrics']})
            self.assertEqual(resp.status_code, 200, resp.content)

            await self._esperar(socket, 'permissions_changed', 'italo')
            depois = await self._me('italo.martins')
            self.assertIn('view_metrics', depois['permissions'])
        finally:
            await socket.disconnect()

    # ---- 2. troca de cargo do usuário ------------------------------------

    async def test_2_troca_de_cargo_do_usuario_avisa_o_usuario(self):
        self.cargo_analista.permissoes_padrao = ['view_metrics']
        await self.cargo_analista.asave(update_fields=['permissoes_padrao'])

        socket = await self._abrir_socket('italo.martins')
        try:
            resp = await self._patch(
                f'/api/users/{self.italo.pk}/', {'role': 'analista'})
            self.assertEqual(resp.status_code, 200, resp.content)

            await self._esperar(socket, 'permissions_changed', 'italo')
            # O cargo novo concede de verdade (CargoPermissionBackend), então o
            # payload que o cliente busca ao receber o evento já vem diferente.
            depois = await self._me('italo.martins')
            self.assertEqual(depois['role'], 'analista')
            self.assertIn('view_metrics', depois['permissions'])
        finally:
            await socket.disconnect()

    # ---- 3. edição das permissões do CARGO (caminho novo) ----------------

    async def test_3_editar_permissoes_do_cargo_avisa_todos_os_portadores(self):
        """O caminho mais fácil de esquecer: quem edita o cargo não mexe em
        nenhum usuário, mas muda o acesso de todos os portadores de uma vez."""
        s_italo = await self._abrir_socket('italo.martins')
        s_colega = await self._abrir_socket('colega')
        s_fora = await self._abrir_socket('forasteiro')
        try:
            resp = await self._patch(
                f'/api/cargos/{self.cargo_dev.pk}/',
                {'permissoes_padrao': ['view_metrics', 'manage_others_cards']})
            self.assertEqual(resp.status_code, 200, resp.content)

            await self._esperar(s_italo, 'permissions_changed', 'italo')
            await self._esperar(s_colega, 'permissions_changed', 'colega')
            # Quem NÃO tem o cargo não pode ser avisado à toa: aviso indevido
            # vira GET /users/me/ de toda a empresa a cada edição de cargo.
            self.assertTrue(
                await s_fora.receive_nothing(timeout=1),
                'usuário de outro cargo foi avisado sem motivo')

            for username in ('italo.martins', 'colega'):
                depois = await self._me(username)
                self.assertIn('view_metrics', depois['permissions'], username)
                self.assertIn('manage_others_cards', depois['permissions'], username)
            self.assertNotIn('view_metrics', (await self._me('forasteiro'))['permissions'])
        finally:
            for s in (s_italo, s_colega, s_fora):
                await s.disconnect()

    async def test_3b_permissao_do_cargo_soma_com_a_personalizada(self):
        """A soma exigida pelo pedido, nas duas ordens, com o evento em cada
        etapa — é a garantia de que nada é sobrescrito."""
        socket = await self._abrir_socket('italo.martins')
        try:
            # personalizada PRIMEIRO
            resp = await self._post(
                f'/api/users/{self.italo.pk}/set-permissions/',
                {'codenames': ['manage_geekday']})
            self.assertEqual(resp.status_code, 200, resp.content)
            await self._esperar(socket, 'permissions_changed', 'italo')

            # cargo DEPOIS
            resp = await self._patch(
                f'/api/cargos/{self.cargo_dev.pk}/',
                {'permissoes_padrao': ['view_metrics']})
            self.assertEqual(resp.status_code, 200, resp.content)
            await self._esperar(socket, 'permissions_changed', 'italo')

            perms = (await self._me('italo.martins'))['permissions']
            self.assertIn('manage_geekday', perms)
            self.assertIn('view_metrics', perms)
        finally:
            await socket.disconnect()

    # ---- 4. mudança de setor ---------------------------------------------

    async def test_4_mudanca_de_setor_avisa_o_usuario(self):
        socket = await self._abrir_socket('italo.martins')
        try:
            resp = await self._patch(
                f'/api/users/{self.italo.pk}/', {'setor': 'tecnologia'})
            self.assertEqual(resp.status_code, 200, resp.content)

            await self._esperar(socket, 'permissions_changed', 'italo')
            depois = await self._me('italo.martins')
            self.assertEqual(
                [s['codename'] for s in depois['setores']], ['tecnologia'],
                'a lista de setores do payload precisa refletir o vínculo novo')
        finally:
            await socket.disconnect()

    # ---- 5. desativação ---------------------------------------------------

    async def test_5_desativar_avisa_e_revoga_o_token(self):
        socket = await self._abrir_socket('colega')
        try:
            resp = await self._post(
                f'/api/users/{self.colega.pk}/set-active/', {'is_active': False})
            self.assertEqual(resp.status_code, 200, resp.content)

            await self._esperar(socket, 'account_deactivated', 'colega')
            self.assertFalse(
                await Token.objects.filter(user=self.colega).aexists(),
                'o token do usuário desativado precisa ser revogado no servidor')
            # E a sessão morre de fato: a próxima chamada não passa mais.
            resp = await self.api.get('/api/users/me/', headers=self._auth('colega'))
            self.assertEqual(resp.status_code, 401, resp.content)
        finally:
            await socket.disconnect()

    # ---- 6. operação em lote ---------------------------------------------

    async def test_6_operacao_em_lote_avisa_todos_os_alvos(self):
        s_italo = await self._abrir_socket('italo.martins')
        s_colega = await self._abrir_socket('colega')
        try:
            resp = await self._post('/api/users/bulk-assign-cargo/', {
                'cargo_codename': 'analista',
                'user_ids': [self.italo.pk, self.colega.pk],
            })
            self.assertEqual(resp.status_code, 200, resp.content)
            self.assertEqual(resp.json()['updated'], 2, resp.content)

            await self._esperar(s_italo, 'permissions_changed', 'italo')
            await self._esperar(s_colega, 'permissions_changed', 'colega')
        finally:
            for s in (s_italo, s_colega):
                await s.disconnect()

    async def test_6b_lote_de_permissoes_avisa_todos_os_alvos(self):
        s_italo = await self._abrir_socket('italo.martins')
        s_colega = await self._abrir_socket('colega')
        try:
            resp = await self._post('/api/users/bulk-set-permissions/', {
                'codenames': ['view_metrics'],
                'mode': 'add',
                'user_ids': [self.italo.pk, self.colega.pk],
            })
            self.assertEqual(resp.status_code, 200, resp.content)

            await self._esperar(s_italo, 'permissions_changed', 'italo')
            await self._esperar(s_colega, 'permissions_changed', 'colega')
            self.assertIn('view_metrics', (await self._me('colega'))['permissions'])
        finally:
            for s in (s_italo, s_colega):
                await s.disconnect()

    # ---- 7. remoção de setor (única porta que tira vínculo) --------------

    async def test_7_remover_setor_avisa_o_usuario(self):
        resp = await self._patch(f'/api/users/{self.italo.pk}/', {'setor': 'tecnologia'})
        self.assertEqual(resp.status_code, 200, resp.content)

        socket = await self._abrir_socket('italo.martins')
        try:
            resp = await self.api.delete(
                f'/api/users/{self.italo.pk}/setores/tecnologia/',
                headers=self._auth('gestora'))
            self.assertEqual(resp.status_code, 200, resp.content)

            await self._esperar(socket, 'permissions_changed', 'italo')
            depois = await self._me('italo.martins')
            self.assertEqual(
                [s['codename'] for s in depois['setores']], ['sem_setor'],
                'quem perde o último setor volta para o balde de não classificados')
        finally:
            await socket.disconnect()

    # ---- 8. revogação (a direção que importa para segurança) -------------

    async def test_8_revogacao_tambem_e_imediata(self):
        """Conceder tarde é incômodo; revogar tarde é falha de segurança.

        Cobre também o cache do `CargoPermissionBackend`, que é chaveado pelo
        `role`: como o role NÃO muda quando se edita a lista do cargo, um cache
        que sobrevivesse à request continuaria autorizando o que acabou de ser
        revogado.
        """
        # ponto de partida: uma do cargo e uma personalizada
        resp = await self._patch(f'/api/cargos/{self.cargo_dev.pk}/',
                                 {'permissoes_padrao': ['view_metrics']})
        self.assertEqual(resp.status_code, 200, resp.content)
        resp = await self._post(f'/api/users/{self.italo.pk}/set-permissions/',
                                {'codenames': ['manage_geekday']})
        self.assertEqual(resp.status_code, 200, resp.content)
        perms = (await self._me('italo.martins'))['permissions']
        self.assertIn('view_metrics', perms)
        self.assertIn('manage_geekday', perms)

        socket = await self._abrir_socket('italo.martins')
        try:
            # revoga a do CARGO
            resp = await self._patch(f'/api/cargos/{self.cargo_dev.pk}/',
                                     {'permissoes_padrao': []})
            self.assertEqual(resp.status_code, 200, resp.content)
            await self._esperar(socket, 'permissions_changed', 'italo')
            perms = (await self._me('italo.martins'))['permissions']
            self.assertNotIn('view_metrics', perms,
                             'permissão revogada no cargo continuou valendo')
            self.assertIn('manage_geekday', perms,
                          'revogar no cargo não pode levar junto a personalizada')

            # revoga a PERSONALIZADA
            resp = await self._post(f'/api/users/{self.italo.pk}/set-permissions/',
                                    {'codenames': []})
            self.assertEqual(resp.status_code, 200, resp.content)
            await self._esperar(socket, 'permissions_changed', 'italo')
            self.assertNotIn('manage_geekday',
                             (await self._me('italo.martins'))['permissions'])
        finally:
            await socket.disconnect()


@override_settings(CHANNEL_LAYERS=CANAL_EM_MEMORIA)
class TempoRealDeAcessoTests(_CenariosDeTempoReal, TransactionTestCase):
    """Todos os cenários, camada em memória (rápida e determinística)."""


@unittest.skipIf(_CAMADA_REDIS is None,
                 'Ambiente sem channels_redis configurado — nada a provar aqui.')
@override_settings(CHANNEL_LAYERS=_CAMADA_REDIS or CANAL_EM_MEMORIA)
class TempoRealComChannelsRedisTests(_CenariosDeTempoReal, TransactionTestCase):
    """Os mesmos cenários contra o channels_redis REAL — a camada de produção.

    Existe porque a camada em memória vive dentro do processo do teste e não
    exercita nada do que pode quebrar em produção: serialização da mensagem,
    reuso de conexão do `channels_redis` entre o loop do envio (`async_to_sync`
    dentro da view síncrona) e o do consumer. Um tempo real que só funciona em
    memória não é tempo real.

    Roda num índice de banco só dele (`_DB_REDIS_DE_TESTE`) para não empurrar
    evento nenhum para as sessões abertas no servidor de dev.
    """

    # Só os cenários decisivos: o caminho novo (cargo → todos os portadores),
    # o individual e o de lote. Repetir os nove dobraria o tempo sem cobrir
    # nenhuma linha nova — o que muda entre as duas classes é o transporte.
    test_2_troca_de_cargo_do_usuario_avisa_o_usuario = None
    test_3b_permissao_do_cargo_soma_com_a_personalizada = None
    test_4_mudanca_de_setor_avisa_o_usuario = None
    test_6b_lote_de_permissoes_avisa_todos_os_alvos = None
    test_7_remover_setor_avisa_o_usuario = None
    test_8_revogacao_tambem_e_imediata = None

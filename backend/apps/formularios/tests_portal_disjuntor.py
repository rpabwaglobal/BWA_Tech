"""O disjuntor do portal de formularios.

O teste que mais importa aqui e o do RELIGAMENTO. Um disjuntor que so abre troca
uma queda por outra: em vez de o sistema travar, a tela de Suporte fica fora para
sempre e alguem precisa reiniciar o container. O valor esta em ele fechar sozinho
quando o outro lado volta, e e isso que `test_religa_sozinho_quando_o_portal_volta`
guarda.

Contexto: em 24/08/2026 o portal ficou inalcancavel e derrubou o BWA Tech
inteiro. Cada pedido segurava uma instancia do daphne por ate 90s esperando
resposta; em minutos nao sobrou instancia para servir NENHUMA tela, e o traefik
passou a devolver 404. O processo continuou travado mesmo depois de o portal
voltar.
"""
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import SimpleTestCase, override_settings
from rest_framework.test import APITestCase

from apps.formularios.portal_disjuntor import (
    FALHAS_PARA_ABRIR,
    JANELA_ABERTA_SEG,
    PortalIndisponivel,
    disjuntor,
)

User = get_user_model()


class _Relogio:
    """Relogio controlado, usado do inicio ao fim do teste.

    Precisa cobrir TAMBEM o momento em que o circuito abre: o instante de
    abertura e gravado com `time.monotonic()`, e se ele vier do relogio real
    enquanto a leitura seguinte vem de um valor fixo menor, a janela nunca
    "vence" — foi assim que a primeira versao destes testes falhou.
    """

    def __init__(self, t: float = 1000.0):
        self.t = t

    def __call__(self) -> float:
        return self.t

    def avancar(self, segundos: float) -> None:
        self.t += segundos


class DisjuntorDoPortalTests(SimpleTestCase):
    """`SimpleTestCase`: o disjuntor vive em memoria e nao toca no banco."""

    def setUp(self):
        disjuntor._reiniciar()

    def tearDown(self):
        disjuntor._reiniciar()

    def _derrubar(self):
        """Leva o disjuntor ao estado ABERTO pelo caminho real."""
        for _ in range(FALHAS_PARA_ABRIR):
            disjuntor.antes_de_tentar()
            disjuntor.registrar_falha()

    # ---------- abrir ----------

    def test_uma_falha_isolada_nao_abre(self):
        """Soluco de rede nao pode tirar a tela do ar: uma falha e ruido."""
        disjuntor.antes_de_tentar()
        disjuntor.registrar_falha()

        self.assertFalse(disjuntor.aberto)
        disjuntor.antes_de_tentar()  # nao levanta

    def test_abre_apos_falhas_seguidas_e_barra_sem_tocar_a_rede(self):
        self._derrubar()

        self.assertTrue(disjuntor.aberto)
        with self.assertRaises(PortalIndisponivel):
            disjuntor.antes_de_tentar()

    def test_sucesso_no_meio_zera_a_contagem(self):
        """Duas falhas e um acerto nao podem somar com uma falha futura — senao
        um sistema instavel abriria o circuito por acumulo, e nao por queda."""
        for _ in range(FALHAS_PARA_ABRIR - 1):
            disjuntor.antes_de_tentar()
            disjuntor.registrar_falha()
        disjuntor.registrar_sucesso()

        disjuntor.antes_de_tentar()
        disjuntor.registrar_falha()

        self.assertFalse(disjuntor.aberto)

    # ---------- religar ----------

    def test_religa_sozinho_quando_o_portal_volta(self):
        """O REQUISITO CENTRAL: ninguem precisa intervir.

        Passada a janela, a proxima chamada vira sonda e vai de fato a rede. Se o
        portal responder, o circuito fecha e tudo volta ao normal.
        """
        relogio = _Relogio()
        with patch('apps.formularios.portal_disjuntor.time.monotonic', relogio):
            self._derrubar()

            with self.assertRaises(PortalIndisponivel):
                disjuntor.antes_de_tentar()

            relogio.avancar(JANELA_ABERTA_SEG + 1)

            disjuntor.antes_de_tentar()    # a sonda passa
            disjuntor.registrar_sucesso()  # o portal respondeu

            self.assertFalse(disjuntor.aberto)
            disjuntor.antes_de_tentar()    # e o trafego normal volta

    def test_se_a_sonda_falha_o_circuito_reabre_por_outra_janela(self):
        relogio = _Relogio()
        with patch('apps.formularios.portal_disjuntor.time.monotonic', relogio):
            self._derrubar()
            relogio.avancar(JANELA_ABERTA_SEG + 1)

            disjuntor.antes_de_tentar()
            disjuntor.registrar_falha()

            self.assertTrue(disjuntor.aberto)
            with self.assertRaises(PortalIndisponivel):
                disjuntor.antes_de_tentar()

    def test_so_uma_sonda_por_vez(self):
        """Se todas as chamadas passassem ao vencer a janela, o religamento seria
        exatamente o empilhamento que o disjuntor existe para evitar."""
        relogio = _Relogio()
        with patch('apps.formularios.portal_disjuntor.time.monotonic', relogio):
            self._derrubar()
            relogio.avancar(JANELA_ABERTA_SEG + 1)

            disjuntor.antes_de_tentar()  # a sonda

            with self.assertRaises(PortalIndisponivel):
                disjuntor.antes_de_tentar()

    # ---------- o que NAO conta ----------

    def test_erro_http_do_portal_nao_abre_o_circuito(self):
        """Um 404 do portal prova que ele esta VIVO. O disjuntor protege do caso
        em que nao ha ninguem do outro lado — nao de resposta que nao agradou."""
        for _ in range(FALHAS_PARA_ABRIR * 2):
            disjuntor.antes_de_tentar()
            disjuntor.registrar_sucesso()

        self.assertFalse(disjuntor.aberto)


class SuporteForaNaoDerrubaOSiteTests(APITestCase):
    """O REQUISITO, dito pelo usuario: "se a pagina de suporte nao conecta, ela
    nao deve derrubar o site todo. O site deve carregar normalmente."

    O que derrubava o site nao era o erro — era a ESPERA. Cada pedido ao portal
    segurava uma instancia do daphne, e o daphne serve TODAS as telas. Entao o
    que este teste guarda nao e "responde erro", e sim "responde erro SEM IR A
    REDE": e nao ir a rede que devolve a instancia na hora e mantem o resto do
    sistema de pe.
    """

    def setUp(self):
        disjuntor._reiniciar()
        self.user = User.objects.create_user(
            username='suporte_disj', email='suporte.disj@example.com',
            password='x' * 12, role='admin', is_superuser=True, is_staff=True)
        self.client.force_authenticate(user=self.user)

    def tearDown(self):
        disjuntor._reiniciar()

    @override_settings(PORTAL_BASE_URL='https://portal.example.com')
    def test_com_o_circuito_aberto_a_resposta_sai_sem_tocar_a_rede(self):
        for _ in range(FALHAS_PARA_ABRIR):
            disjuntor.antes_de_tentar()
            disjuntor.registrar_falha()

        # `_is_internal_host` barra host que o DNS não resolve — padrão seguro
        # correto, e sem relação com o que este teste mede.
        with patch('apps.formularios.portal_proxy_views._is_internal_host', return_value=False),                 patch('apps.formularios.portal_proxy_views.requests') as rede:
            r = self.client.get('/api/portal-formularios/suporte/por-usuario/')

        self.assertEqual(r.status_code, 503)
        self.assertEqual(r.data['reason'], 'portal_circuito_aberto')
        # O CORACAO DO TESTE: nenhuma chamada de rede saiu.
        rede.request.assert_not_called()
        rede.get.assert_not_called()

    @override_settings(PORTAL_BASE_URL='https://portal.example.com')
    def test_o_patch_tambem_e_barrado_antes_da_rede(self):
        """O enriquecimento do PATCH faz um GET PROPRIO ao portal, e ja esteve
        ANTES da verificacao do disjuntor: com o circuito aberto, todo PATCH
        continuava gastando o tempo de conexao segurando uma instancia."""
        for _ in range(FALHAS_PARA_ABRIR):
            disjuntor.antes_de_tentar()
            disjuntor.registrar_falha()

        with patch('apps.formularios.portal_proxy_views._is_internal_host', return_value=False),                 patch('apps.formularios.portal_proxy_views.requests') as rede:
            r = self.client.patch(
                '/api/portal-formularios/suporte/7/',
                data='{"tipo_id": 3}',
                content_type='application/json',
            )

        self.assertEqual(r.status_code, 503)
        rede.get.assert_not_called()
        rede.request.assert_not_called()

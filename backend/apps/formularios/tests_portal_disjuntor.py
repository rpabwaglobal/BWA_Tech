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

from django.test import SimpleTestCase

from apps.formularios.portal_disjuntor import (
    FALHAS_PARA_ABRIR,
    JANELA_ABERTA_SEG,
    PortalIndisponivel,
    disjuntor,
)


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

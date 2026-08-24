"""
O DISJUNTOR DO PORTAL DE FORMULÁRIOS.

Os chamados de suporte não moram no BWA Tech: eles vivem no portal
(`PORTAL_BASE_URL`), e este servidor apenas repassa. Isso significa que a tela de
Suporte depende de um sistema que não controlamos — e em 24/08/2026 essa
dependência derrubou o BWA Tech INTEIRO.

O QUE ACONTECEU, porque a correção só faz sentido à luz disso: o portal ficou
inalcançável às 08:02. Cada pedido do proxy segurava uma instância do daphne por
até 90 segundos esperando uma resposta que não vinha. A tela de Suporte recarrega
sozinha, então os pedidos se acumulavam. Em minutos não sobrou instância livre —
e o daphne não serve só o Suporte, serve TUDO. A home, o kanban e o login ficaram
na fila atrás de pedidos presos num sistema de terceiro, e o traefik, sem resposta
do upstream, passou a devolver 404. O processo continuou travado mesmo depois de o
portal voltar; só um restart resolveu.

A LIÇÃO: o problema não é o portal cair — é o BWA Tech cair JUNTO. Uma tela que
depende de fora não pode levar as outras quinze com ela.

COMO ESTE MÓDULO IMPEDE ISSO. Depois de algumas falhas de rede seguidas, o
disjuntor ABRE: os pedidos seguintes falham na hora, sem tocar na rede e sem
segurar instância nenhuma. A tela de Suporte passa a dizer que o portal está fora
— que é a verdade — enquanto o resto do sistema segue de pé.

E RELIGA SOZINHO. Passada a janela, o próximo pedido vira uma SONDA: ele tenta de
verdade. Se o portal responder, o disjuntor fecha e tudo volta ao normal sem
ninguém mexer em nada. Se falhar, abre de novo por mais uma janela. O tempo entre
o portal voltar e o sistema perceber é, no pior caso, a janela — 30 segundos.

ESTADO EM MEMÓRIA, e não em cache compartilhado, pelo mesmo motivo que
`portal_auth` guarda o JWT assim: cada processo protege a si mesmo. Um worker que
ainda não viu falha nenhuma não deve ser impedido de tentar pela experiência de
outro, e a sonda de cada processo é barata — um pedido a cada 30 segundos.
"""
from __future__ import annotations

import logging
import threading
import time

logger = logging.getLogger(__name__)

#: Falhas de rede seguidas antes de abrir. Duas podem ser um soluço da rede; a
#: partir da terceira o padrão é indisponibilidade, e insistir só empilha pedido.
FALHAS_PARA_ABRIR = 3

#: Quanto tempo o disjuntor fica aberto antes de deixar passar a sonda.
#: Curto de propósito: é ELE que define quanto o sistema demora a perceber que o
#: portal voltou. Trinta segundos custa uma sonda por meio minuto e devolve o
#: Suporte quase imediatamente depois que o outro lado se recupera.
JANELA_ABERTA_SEG = 30.0


class PortalIndisponivel(Exception):
    """O disjuntor está aberto — nem se tentou a rede.

    Existe para o proxy responder na hora, com uma razão própria, em vez de
    devolver o mesmo erro de quem de fato tentou e falhou. A tela consegue
    distinguir "o portal está fora" de "a sua requisição falhou".
    """


class _Disjuntor:
    def __init__(self) -> None:
        self._trava = threading.Lock()
        self._falhas = 0
        self._aberto_em: float | None = None
        self._sondando = False

    def antes_de_tentar(self) -> None:
        """Chamado antes de ir à rede. Levanta `PortalIndisponivel` se aberto.

        Quando a janela vence, deixa passar UMA sonda. As outras chamadas
        continuam falhando na hora — se todas passassem, o religamento seria
        exatamente o empilhamento que este módulo existe para evitar.
        """
        with self._trava:
            if self._aberto_em is None:
                return
            if time.monotonic() - self._aberto_em < JANELA_ABERTA_SEG:
                raise PortalIndisponivel(
                    'Portal indisponível — novas tentativas suspensas por instantes.',
                )
            if self._sondando:
                raise PortalIndisponivel(
                    'Portal indisponível — uma verificação já está em andamento.',
                )
            self._sondando = True
            logger.info('Disjuntor do portal: janela vencida, enviando sonda.')

    def registrar_sucesso(self) -> None:
        """O portal respondeu. Fecha o disjuntor e zera o histórico."""
        with self._trava:
            estava_aberto = self._aberto_em is not None
            self._falhas = 0
            self._aberto_em = None
            self._sondando = False
        if estava_aberto:
            logger.warning('Disjuntor do portal FECHADO: o portal voltou a responder.')

    def registrar_falha(self) -> None:
        """Falha de REDE (timeout, conexão recusada).

        Erro HTTP do portal NÃO conta: um 400 ou um 404 significam que ele está
        vivo e respondendo, e o disjuntor existe para o caso de não haver
        ninguém do outro lado.
        """
        with self._trava:
            self._sondando = False
            self._falhas += 1
            if self._falhas >= FALHAS_PARA_ABRIR and self._aberto_em is None:
                self._aberto_em = time.monotonic()
                logger.error(
                    'Disjuntor do portal ABERTO após %s falhas de rede seguidas. '
                    'As chamadas ao portal falharão na hora pelos próximos %.0fs, '
                    'para não travar o restante do sistema.',
                    self._falhas,
                    JANELA_ABERTA_SEG,
                )
            elif self._aberto_em is not None:
                # A sonda falhou: reinicia a janela.
                self._aberto_em = time.monotonic()

    # -- para os testes, e só para eles --------------------------------------
    def _reiniciar(self) -> None:
        with self._trava:
            self._falhas = 0
            self._aberto_em = None
            self._sondando = False

    @property
    def aberto(self) -> bool:
        return self._aberto_em is not None


disjuntor = _Disjuntor()

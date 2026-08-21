import { useEffect, useRef, type ReactNode } from 'react';
import { useDndContext } from '@dnd-kit/core';

/**
 * A TORÇÃO DO CARD ARRASTADO — ele se inclina na direção do movimento.
 *
 * Portado do desenho "Kanban — animação Estilingue", com uma diferença que vale
 * registrar porque muda o que o componente É.
 *
 * O DESENHO DERIVAVA A INCLINAÇÃO DE UM ATRASO. O clone perseguia o ponteiro
 * (`s += (p - s) * k`) em vez de acompanhá-lo, e a inclinação era a distância
 * entre os dois: quanto mais para trás o card ficava, mais torto ele ficava. Era
 * elegante — uma conta só produzia peso e torção — e foi rejeitado no uso: o
 * card não fica debaixo do dedo, e o que se sente é aceleração, não peso. Num
 * mockup de cinco cards isso passa; arrastando de verdade, incomoda a cada
 * gesto.
 *
 * AGORA A INCLINAÇÃO VEM DA VELOCIDADE DO PONTEIRO, medida direto. O card fica
 * travado no cursor, 1 para 1, e continua se inclinando na direção do
 * movimento — a inclinação segue sendo a velocidade, que era a ideia do
 * desenho; o que saiu foi o atraso, que era o meio, não o fim.
 *
 * A VELOCIDADE É SUAVIZADA, A POSIÇÃO NÃO. É a distinção que faz isto
 * funcionar: suavizar a posição atrasa o card (o problema); suavizar só a
 * velocidade tira o tremor da inclinação sem mover o card um pixel do lugar.
 * O próprio desenho já calculava essa velocidade suavizada — só não a usava
 * para a torção.
 *
 * POR QUE ISTO NÃO SUBSTITUI O DND-KIT. Quem posiciona o clone, detecta a
 * coluna e resolve a queda continua sendo o dnd-kit — este componente só escreve
 * `rotate`/`scale` no filho, a cada quadro. O `handleDragEnd` do kanban carrega
 * as regras de negócio, as permissões e o estado otimista; nada disso passa por
 * aqui.
 */

/**
 * Quanto a velocidade do quadro pesa contra a acumulada.
 *
 * 0.18 é o valor do desenho. Baixo o bastante para a inclinação não tremer a
 * cada solavanco do mouse, alto o bastante para ela responder na hora quando a
 * direção muda.
 */
const PESO_DA_VELOCIDADE = 0.18;

/**
 * Converte velocidade (px por quadro) em graus.
 *
 * Calibrado para bater com a inclinação do desenho: lá o ângulo era
 * `distância_do_atraso * 0.42`, e com atraso de 0.16 essa distância se estabiliza
 * em cerca de 5,25x a velocidade — ou seja, ~2,2 graus por pixel/quadro. O card
 * se inclina igual ao mockup; o que mudou foi de onde o número sai.
 */
const GRAUS_POR_VELOCIDADE = 2.2;

/** Duração da queda. Espelha `ANIMACAO_DE_SOLTAR_ESTILINGUE` em
 *  `lib/arrastar.ts` — as duas precisam terminar juntas, senão a torção se
 *  desfaz antes de o card pousar, ou continua depois de ele já ter parado. */
const QUEDA_MS = 460;

const limita = (v: number, max: number) => Math.max(-max, Math.min(max, v));

export function ArrastoEstilingue({
  children,
  intensidade = 1,
}: {
  children: ReactNode;
  /** Multiplica a torção. O desenho expõe isto como controle de 0.4 a 1.8. */
  intensidade?: number;
}) {
  const { activeNodeRect } = useDndContext();
  const noRef = useRef<HTMLDivElement>(null);

  // Tudo o que muda a cada quadro vive em ref, e não em estado: são ~60
  // atualizações por segundo, e cada uma virando render arrastaria a árvore
  // inteira do quadro junto.
  const dados = useRef({
    ponteiro: null as { x: number; y: number } | null,
    anterior: null as { x: number; y: number } | null,
    velX: 0,
    velY: 0,
    ultimoQuadro: 0,
    quedaEm: 0,
  });

  useEffect(() => {
    const d = dados.current;
    if (!activeNodeRect) return;
    // QUEM PEDIU MENOS MOVIMENTO NÃO RECEBE A TORÇÃO. Sem o laço, o clone
    // continua colado ao ponteiro pelo próprio dnd-kit e o arrasto segue
    // inteiro — o que sai é a inclinação, não a função.
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return;

    d.ponteiro = null;
    d.anterior = null;
    d.velX = 0;
    d.velY = 0;
    d.ultimoQuadro = performance.now();
    d.quedaEm = 0;

    const aoMover = (e: PointerEvent) => {
      d.ponteiro = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener('pointermove', aoMover, { passive: true });

    let quadro = 0;
    const desenhar = () => {
      quadro = requestAnimationFrame(desenhar);
      const no = noRef.current;
      if (!no) return;

      const agora = performance.now();
      // Normalizado para 60fps: num quadro perdido o deslocamento é maior, e sem
      // dividir por ele a inclinação daria um pico em máquina que engasga.
      const passo = Math.max(0.2, Math.min(3, (agora - d.ultimoQuadro) / 16.667));
      d.ultimoQuadro = agora;

      // A QUEDA é detectada pela classe que o `dropAnimation` põe no invólucro.
      // Não há evento para "a animação de soltar começou", e perguntar ao React
      // custaria um render por quadro.
      const inv = no.parentElement;
      const caindo = !!inv?.classList.contains('card-pousando');
      if (caindo && !d.quedaEm) d.quedaEm = agora;
      const p = d.quedaEm ? Math.min(1, (agora - d.quedaEm) / QUEDA_MS) : 0;
      const resto = 1 - p;

      if (!caindo && d.ponteiro) {
        const ant = d.anterior ?? d.ponteiro;
        // Velocidade em px POR QUADRO, para o ângulo não depender da taxa de
        // atualização da tela.
        const dx = (d.ponteiro.x - ant.x) / passo;
        const dy = (d.ponteiro.y - ant.y) / passo;
        d.velX = d.velX * (1 - PESO_DA_VELOCIDADE) + dx * PESO_DA_VELOCIDADE;
        d.velY = d.velY * (1 - PESO_DA_VELOCIDADE) + dy * PESO_DA_VELOCIDADE;
        d.anterior = d.ponteiro;
      }

      const grau = GRAUS_POR_VELOCIDADE * intensidade;
      const torcaoY = limita(d.velX * grau, 20) * resto;
      const torcaoX = limita(-d.velY * grau, 14) * resto;

      // SÓ ROTAÇÃO E ESCALA. Nada de `translate`: a posição do clone é do
      // dnd-kit, e ele a trava no ponteiro. Era aqui que morava o atraso, e
      // tirá-lo é o que faz o card acompanhar o mouse na mesma velocidade.
      no.style.transform =
        `perspective(900px) rotateY(${torcaoY}deg) rotateX(${torcaoX}deg) ` +
        `scale(${1 + 0.03 * resto})`;
    };

    quadro = requestAnimationFrame(desenhar);
    return () => {
      cancelAnimationFrame(quadro);
      window.removeEventListener('pointermove', aoMover);
    };
  }, [activeNodeRect, intensidade]);

  return (
    // `will-change` porque este nó recebe transform a cada quadro: sem ele o
    // navegador repinta a camada em vez de compor.
    <div ref={noRef} style={{ willChange: 'transform' }}>
      {children}
    </div>
  );
}

import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useDndContext } from '@dnd-kit/core';

/**
 * O ARRASTO "ESTILINGUE" — o clone não gruda no dedo, ele é PUXADO por ele.
 *
 * Portado do desenho "Kanban — animação Estilingue". Três coisas acontecem ao
 * mesmo tempo enquanto o card está no ar, e as três saem do mesmo cálculo:
 *
 * 1. ATRASO ELÁSTICO. A posição do clone persegue o ponteiro em vez de igualá-lo
 *    (`s += (p - s) * k`). É o que dá peso: um clone travado no cursor parece um
 *    adesivo, um clone que arrasta atrás parece um objeto sendo puxado.
 * 2. TORÇÃO. A diferença entre onde o ponteiro está e onde o clone chegou vira
 *    rotação em Y e X. Quanto mais rápido o gesto, mais o card se inclina — a
 *    inclinação É a velocidade, não um enfeite fixo.
 * 3. A FAIXA. Uma parábola tracejada liga a ETAPA DE ORIGEM ao clone. É a única
 *    parte que responde uma pergunta em vez de decorar: de onde este card saiu.
 *    Numa tela com quatro colunas e o quadro rolado, isso deixa de ser óbvio no
 *    meio do gesto.
 *
 * POR QUE ISTO NÃO SUBSTITUI O DND-KIT. O desenho traz o motor inteiro — captura
 * de ponteiro, detecção de coluna, índice de inserção, voo de queda. Aqui esse
 * papel continua sendo do dnd-kit, porque o `handleDragEnd` do kanban carrega as
 * regras de negócio (sprint fechada, card finalizado, dados obrigatórios, fluxo
 * de feedback), as permissões e o estado otimista, além da acessibilidade por
 * teclado. O que este componente faz é desenhar por cima do que o dnd-kit já
 * resolve.
 *
 * COMO OS DOIS CONVIVEM. O dnd-kit trava o INVÓLUCRO do clone no ponteiro, de
 * forma rígida. O atraso é aplicado no FILHO, como a diferença entre onde o
 * desenho quer o card e onde o invólucro de fato está. Somados, dão a posição
 * do desenho — sem brigar com quem posiciona.
 */

/** Quanto da distância até o ponteiro é vencida por quadro (a 60fps). Menor =
 *  mais preguiçoso. 0.16 é o valor do desenho. */
const ATRASO = 0.16;

/** O clone é puxado 10% de volta na direção da origem: é o "elástico" esticado.
 *  Some na queda, e é isso que faz o card partir com um tranco. */
const PUXAO_DA_ORIGEM = 0.1;

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
  const { activeNodeRect, activatorEvent } = useDndContext();
  const noRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const trilhaRef = useRef<SVGPathElement>(null);
  const sombraRef = useRef<SVGPathElement>(null);

  // Tudo o que muda a cada quadro vive em ref, e não em estado: são ~60
  // atualizações por segundo, e cada uma virando render arrastaria a árvore
  // inteira do quadro junto.
  const dados = useRef({
    origem: null as { x: number; y: number } | null,
    pegada: { x: 0, y: 0 },
    ponteiro: { x: 0, y: 0 },
    suave: { x: 0, y: 0 },
    tamanho: { w: 0, h: 0 },
    torcaoY: 0,
    torcaoX: 0,
    ultimoQuadro: 0,
    inicio: 0,
    quedaEm: 0,
  });

  useEffect(() => {
    const d = dados.current;
    if (!activeNodeRect) return;
    // QUEM PEDIU MENOS MOVIMENTO NÃO RECEBE O ESTILINGUE.
    //
    // Não é uma animação decorativa que dá para suavizar: são três movimentos
    // simultâneos, um deles com rotação em dois eixos. Sem o laço, o clone
    // continua colado ao ponteiro pelo próprio dnd-kit e o arrasto segue
    // inteiro — o que sai é o movimento, não a função. O resto do sistema trata
    // `prefers-reduced-motion` assim, no index.css; aqui a regra tem de estar no
    // JS porque quem anima é o JS.
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return;

    // A ORIGEM É CONGELADA NO INÍCIO. Ela marca de onde o card saiu, então tem
    // de ficar parada mesmo que a coluna se reorganize embaixo — é justamente
    // isso que a faixa está dizendo.
    d.origem = {
      x: activeNodeRect.left + activeNodeRect.width / 2,
      y: activeNodeRect.top + activeNodeRect.height / 2,
    };
    d.tamanho = { w: activeNodeRect.width, h: activeNodeRect.height };

    // Onde dentro do card o dedo pegou. Sem isto o card saltaria para centralizar
    // no cursor no primeiro quadro.
    const ev = activatorEvent as PointerEvent | MouseEvent | null;
    const px = ev && 'clientX' in ev ? ev.clientX : d.origem.x;
    const py = ev && 'clientY' in ev ? ev.clientY : d.origem.y;
    d.pegada = { x: px - activeNodeRect.left, y: py - activeNodeRect.top };
    d.ponteiro = { x: px, y: py };
    d.suave = { x: px, y: py };
    d.inicio = performance.now();
    d.ultimoQuadro = d.inicio;
    d.quedaEm = 0;

    const aoMover = (e: PointerEvent) => {
      d.ponteiro = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener('pointermove', aoMover, { passive: true });

    let quadro = 0;
    const desenhar = () => {
      quadro = requestAnimationFrame(desenhar);
      const no = noRef.current;
      const inv = no?.parentElement;
      if (!no || !inv || !d.origem) return;

      const agora = performance.now();
      // Normalizado para 60fps: num quadro perdido o avanço é maior, então a
      // suavização não fica mais lenta em máquina que engasga.
      const passo = Math.min(50, agora - d.ultimoQuadro) / 16.667;
      d.ultimoQuadro = agora;

      // A QUEDA é detectada pela classe que o `dropAnimation` põe no invólucro.
      // Não há evento para "a animação de soltar começou", e perguntar ao React
      // custaria um render por quadro.
      const caindo = inv.classList.contains('card-pousando');
      if (caindo && !d.quedaEm) d.quedaEm = agora;
      const p = d.quedaEm ? Math.min(1, (agora - d.quedaEm) / QUEDA_MS) : 0;
      // Na queda tudo o que é "estilingue" se desfaz: a torção volta a zero e o
      // puxão da origem solta. É o tranco de partida do desenho.
      const resto = 1 - p;

      const k = 1 - Math.pow(1 - ATRASO, passo);
      if (!caindo) {
        d.suave.x += (d.ponteiro.x - d.suave.x) * k;
        d.suave.y += (d.ponteiro.y - d.suave.y) * k;
        d.torcaoY = limita((d.ponteiro.x - d.suave.x) * 0.42 * intensidade, 20);
        d.torcaoX = limita(-(d.ponteiro.y - d.suave.y) * 0.3 * intensidade, 14);
      }

      // Onde o DESENHO quer o card, em coordenadas de viewport.
      let x = d.suave.x - d.pegada.x;
      let y = d.suave.y - d.pegada.y;
      const centroX = x + d.tamanho.w / 2;
      const centroY = y + d.tamanho.h / 2;
      x += (d.origem.x - centroX) * PUXAO_DA_ORIGEM * resto;
      y += (d.origem.y - centroY) * PUXAO_DA_ORIGEM * resto;

      // Onde o invólucro DE FATO está — é o dnd-kit quem o posiciona. A
      // diferença entre os dois é o que este nó precisa compensar.
      const r = inv.getBoundingClientRect();
      no.style.transform =
        `translate3d(${x - r.left}px, ${y - r.top}px, 0) ` +
        `perspective(900px) rotateY(${d.torcaoY * resto}deg) ` +
        `rotateX(${d.torcaoX * resto}deg) ` +
        `scale(${1 + 0.03 * resto})`;

      desenharFaixa(
        d.origem,
        x + d.tamanho.w / 2,
        y + d.tamanho.h / 2,
        (agora - d.inicio) / 1000,
        p,
        !!d.quedaEm,
      );
    };

    const desenharFaixa = (
      origem: { x: number; y: number },
      cx: number,
      cy: number,
      t: number,
      p: number,
      caindo: boolean,
    ) => {
      const svg = svgRef.current;
      const trilha = trilhaRef.current;
      if (!svg || !trilha) return;
      const dist = Math.hypot(origem.x - cx, origem.y - cy);
      // O ponto de controle sobe com a distância: perto, a faixa é quase reta;
      // longe, ela arqueia. É o que faz a corda parecer ter comprimento.
      const mx = (origem.x + cx) / 2;
      const my = (origem.y + cy) / 2 - (26 + dist * 0.15);
      const espessura = Math.max(4, 6.5 - dist * 0.003);
      const marcha = String(-t * 22);
      trilha.setAttribute('d', `M${origem.x} ${origem.y} Q${mx} ${my} ${cx} ${cy}`);
      trilha.setAttribute('stroke-width', String(espessura));
      trilha.setAttribute('stroke-dashoffset', marcha);
      const sombra = sombraRef.current;
      if (sombra) {
        sombra.setAttribute('d', `M${origem.x} ${origem.y + 14} L${cx} ${cy + 14}`);
        sombra.setAttribute('stroke-width', String(espessura + 3));
        sombra.setAttribute('stroke-dashoffset', marcha);
      }
      // Some MAIS RÁPIDO que a queda (fator 2.2): a corda tem de sair de cena
      // antes de o card assentar, senão ela fica visível ligando dois pontos
      // que já são o mesmo.
      svg.style.opacity = String(caindo ? Math.max(0, 1 - p * 2.2) * 0.95 : 0.95);
    };

    quadro = requestAnimationFrame(desenhar);
    return () => {
      cancelAnimationFrame(quadro);
      window.removeEventListener('pointermove', aoMover);
    };
  }, [activeNodeRect, activatorEvent, intensidade]);

  return (
    <>
      {/* A FAIXA VAI PARA O `body`, pelo mesmo motivo do clone: ela é
          `position: fixed` em coordenadas de viewport, e a tela vive dentro de
          `.pagina-entra`, cuja animação de `transform` cria um containing block.
          Renderizada no lugar, ela apareceria deslocada junto com tudo. */}
      {createPortal(
        <svg
          ref={svgRef}
          aria-hidden
          style={{
            position: 'fixed',
            inset: 0,
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
            overflow: 'visible',
            zIndex: 60,
            opacity: 0,
          }}
        >
          <path
            ref={sombraRef}
            d="M0 0"
            fill="none"
            strokeLinecap="round"
            strokeDasharray="9 13"
            stroke="rgba(40,32,60,.16)"
            style={{ filter: 'blur(6px)' }}
          />
          <path
            ref={trilhaRef}
            d="M0 0"
            fill="none"
            strokeLinecap="round"
            strokeDasharray="9 13"
            stroke="var(--color-primary)"
          />
        </svg>,
        document.body,
      )}
      {/* `will-change` porque este nó recebe transform a cada quadro: sem ele o
          navegador repinta a camada em vez de compor. */}
      <div ref={noRef} style={{ willChange: 'transform' }}>
        {children}
      </div>
    </>
  );
}

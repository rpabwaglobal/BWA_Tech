import {
  MeasuringStrategy,
  defaultDropAnimationSideEffects,
  type DropAnimation,
  type MeasuringConfiguration,
} from '@dnd-kit/core';

/**
 * O ARRASTO DE CARDS, CONFIGURADO NUM LUGAR SÓ.
 *
 * São dois quadros kanban no sistema — o do projeto e o do Suporte — e eles já
 * divergiam: um passava `dropAnimation={null}`, o outro não passava nada e
 * ficava com o padrão da biblioteca. Ninguém abre os dois lado a lado, então a
 * diferença nunca aparece como decisão; aparece como "aqui o card cai de um
 * jeito e ali de outro".
 *
 * O que mora aqui é só o que é configuração do dnd-kit. A aparência (levantar,
 * fantasma, coluna que recebe) é CSS, em `index.css`, porque é lá que o resto
 * das animações do projeto vive e é lá que a regra de `prefers-reduced-motion`
 * já é aplicada de forma consistente.
 */

/** A curva do projeto: quase todo o movimento no começo, fim longo e quase
 *  parado. É a mesma de `.card-entra` e `.pagina-entra`. */
const CURVA = 'cubic-bezier(0.22, 1, 0.36, 1)';

/**
 * Como o card ATERRISSA quando é solto.
 *
 * O padrão da biblioteca são 250 ms com `ease`, que sai rápido e chega freando
 * pouco — o card parece bater no lugar. Com a curva do projeto e um tempo
 * levemente maior, ele desacelera até assentar, que é o gesto que o resto do
 * sistema usa.
 *
 * `sideEffects` faz DUAS coisas aqui:
 *
 * 1. `className.dragOverlay` desfaz a inclinação na descida. O clone leva
 *    `scale(1.03) rotate(2deg)` enquanto está no ar (`.card-arrastado`), e essa
 *    transformação é `forwards` — sem desfazê-la, o card CHEGA torto e maior no
 *    destino e só então some, dando lugar ao card real, que está reto. O pulo
 *    aparece bem no fim do gesto, que é onde o olho está.
 * 2. `styles.active` mantém o card de ORIGEM invisível enquanto o clone voa.
 *    Sem isso há dois cards na tela durante a aterrissagem: `isDragging` já é
 *    falso — então o slot tracejado sumiu e o card real voltou sólido — mas o
 *    clone ainda está no ar.
 *
 * O ponto 2 é o comportamento PADRÃO da biblioteca, e está repetido aqui de
 * propósito: `createDefaultDropAnimation` mescla as opções com os padrões num
 * spread RASO (`{...padrão, ...opções}`), então informar um `sideEffects`
 * próprio substitui o padrão inteiro. Passar só `duration` e `easing`, por
 * outro lado, PRESERVA o efeito padrão — foi o que este comentário já afirmou
 * ao contrário, e a diferença importa para quem for copiar isto.
 */
export const ANIMACAO_DE_SOLTAR: DropAnimation = {
  duration: 260,
  easing: CURVA,
  sideEffects: defaultDropAnimationSideEffects({
    className: { dragOverlay: 'card-pousando' },
    styles: { active: { opacity: '0' } },
  }),
};

/**
 * A queda do arrasto "estilingue", no kanban do projeto.
 *
 * Mais longa que a do Suporte (460ms contra 260) porque aqui o voo tem MAIS
 * COISA acontecendo: além de percorrer a distância, o card desfaz a torção e
 * solta o puxão do elástico. Nos 260ms do outro quadro as duas se atropelariam
 * com a chegada.
 *
 * A curva passa do ponto de propósito (o `1.24` no terceiro parâmetro): o card
 * chega, ultrapassa um pouco e volta. É o que o desenho faz com a função
 * `1 + 2.4(p-1)³ + 1.5(p-1)²`, que sobe até ~1.08 na metade do caminho.
 *
 * `className.dragOverlay` NÃO é decoração aqui — é o sinal. Não existe evento de
 * "a animação de soltar começou", e `ArrastoEstilingue` precisa saber disso a
 * cada quadro para desfazer a torção junto. Ele lê essa classe no invólucro;
 * perguntar ao React custaria um render por quadro.
 */
export const ANIMACAO_DE_SOLTAR_ESTILINGUE: DropAnimation = {
  duration: 460,
  easing: 'cubic-bezier(0.34, 1.24, 0.48, 1)',
  sideEffects: defaultDropAnimationSideEffects({
    className: { dragOverlay: 'card-pousando' },
    styles: { active: { opacity: '0' } },
  }),
};

/**
 * O card ASSENTA no destino, depois que a lista já se reorganizou.
 *
 * Isto não é CSS na montagem porque o card não remonta ao mudar de coluna — é o
 * mesmo nó, com a mesma `key`, aparecendo noutro lugar. Uma animação declarada
 * na classe só rodaria uma vez e nunca mais. Aqui a animação é DISPARADA no
 * momento em que o movimento se confirma, que é quando ela tem significado.
 *
 * `requestAnimationFrame` duplo: o primeiro devolve o controle depois que o
 * React aplicou a mudança no DOM, o segundo garante que o navegador já calculou
 * o novo layout. Sem esperar, a animação rodaria sobre a posição ANTIGA e o
 * efeito seria um tremor no lugar errado.
 */
export function assentarCard(cardId: string | number) {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const no = document.querySelector<HTMLElement>(
        `[data-card-id="${CSS.escape(String(cardId))}"]`,
      );
      no?.classList.add('card-assentando');
      no?.addEventListener('animationend', () => no.classList.remove('card-assentando'), {
        once: true,
      });
    });
  });
}

/**
 * Quando o dnd-kit remede as colunas.
 *
 * O padrão (`WhileDragging`) mede uma vez, ao começar o arrasto. Num kanban
 * isso erra: mover um card para outra coluna muda a ALTURA das duas — a de
 * origem encolhe, a de destino cresce —, e as posições guardadas ficam
 * defasadas no meio do gesto. O sintoma é o card precisar ser levado além da
 * borda visível da coluna para ela reconhecer a entrega, e piora quanto mais
 * cards a coluna tem.
 *
 * `Always` remede também a cada mudança de layout. Custa mais, e é o preço de a
 * detecção continuar certa depois que a lista se reorganiza.
 */
export const MEDICAO_DO_ARRASTO: MeasuringConfiguration = {
  droppable: { strategy: MeasuringStrategy.Always },
};

/**
 * O cursor de "agarrado" durante o arrasto, na página inteira.
 *
 * Precisa ser no `body` e não no card: durante o arrasto o card REAL fica
 * parado e quem acompanha o ponteiro é o clone, então o ponteiro passa a maior
 * parte do tempo sobre outros elementos — e o cursor voltava a ser seta.
 *
 * Uma função e não um `useEffect` porque quem sabe que o arrasto começou e
 * terminou são os handlers do `DndContext`, e eles precisam desligar isso
 * também no CANCELAMENTO (Esc, ou soltar fora de qualquer coluna) — que não
 * passa por `onDragEnd` em todos os casos.
 */
export function marcarArrastoNoDocumento(arrastando: boolean) {
  document.body.classList.toggle('arrastando', arrastando);
}

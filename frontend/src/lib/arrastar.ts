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
 * O padrão da biblioteca são 250 ms com `ease`, que sai rápido e chega
 * frenando pouco — o card parece bater no lugar. Com a curva do projeto e um
 * tempo levemente maior, ele desacelera até assentar, que é o gesto que o resto
 * do sistema usa.
 *
 * O `sideEffects` mantém o card de ORIGEM invisível enquanto o clone voa. Sem
 * isso existem dois cards na tela durante a aterrissagem: `isDragging` já virou
 * falso — então o fantasma tracejado sumiu e o card real voltou sólido — mas o
 * clone ainda está no ar. É o padrão da biblioteca, e está aqui explícito
 * porque, escrito à mão, o `dropAnimation` substitui o objeto inteiro: passar
 * só `duration` e `easing` DESLIGA o efeito colateral e traz o card duplicado
 * de volta.
 */
export const ANIMACAO_DE_SOLTAR: DropAnimation = {
  duration: 260,
  easing: CURVA,
  sideEffects: defaultDropAnimationSideEffects({
    styles: { active: { opacity: '0' } },
  }),
};

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

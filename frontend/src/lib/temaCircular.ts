/**
 * A troca de tema como um círculo que abre a partir do botão.
 *
 * PORTADO DO BATELIER (`Gerenciador De Bats`, `src/app/theme.ts`), com a mesma
 * ideia central: em vez de empilhar duas cópias da tela e recortar uma delas —
 * o que dobraria a árvore inteira do React —, a imagem sai da View Transitions
 * API. O navegador tira o retrato de antes e o de depois, e nós animamos só o
 * `clip-path` do retrato novo.
 *
 * O QUE MUDA AQUI: o Batelier grava o tema em `data-theme`; o BWA Tech usa a
 * classe `dark` no `<html>` (Tailwind). Só o `commit` é diferente.
 */

/** 1700ms é do original. Mais curto e o círculo vira um estalo; mais longo e a
 *  pessoa espera para trabalhar. */
const DURACAO_MS = 1700;
const CURVA = 'cubic-bezier(.65,0,.35,1)';

/** Onde o círculo nasce — o centro do botão que foi clicado. */
export type OrigemDaTroca = { x: number; y: number };

/**
 * `startViewTransition` só existe no Chromium recente, e o TypeScript do
 * projeto não conhece a API. Declarar aqui evita um `any` solto no meio do
 * código e deixa explícito que é opcional.
 */
type DocumentoComTransicao = Document & {
  startViewTransition?: (callback: () => void) => { ready: Promise<void> };
};

export function aplicarTemaComCirculo(
  escuro: boolean,
  origem?: OrigemDaTroca | null,
): void {
  const raiz = document.documentElement;
  const doc = document as DocumentoComTransicao;

  const comprometer = () => {
    raiz.classList.toggle('dark', escuro);
    // `color-scheme` faz o navegador pintar barras de rolagem, campos e menus
    // nativos no tema certo. Sem isto, no escuro, as barras continuam claras.
    raiz.style.colorScheme = escuro ? 'dark' : 'light';
  };

  const menosMovimento = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // SEM ORIGEM, TROCA SECA. É o caminho da primeira pintura e o de quem mudou o
  // tema do sistema: não houve clique, então não há de onde o círculo nascer.
  if (!origem || menosMovimento || typeof doc.startViewTransition !== 'function') {
    comprometer();
    return;
  }

  const { x, y } = origem;
  // O raio tem de alcançar o canto MAIS DISTANTE da janela, senão sobra um
  // pedaço do tema antigo no canto oposto ao botão.
  const raio = Math.hypot(
    Math.max(x, window.innerWidth - x),
    Math.max(y, window.innerHeight - y),
  );

  // REDE DE SEGURANÇA: se a transição não chegar a rodar (aba em segundo plano,
  // compositor parado, janela minimizada), o tema ficaria pendurado no antigo
  // até a aba voltar. Este relógio garante a troca de qualquer jeito.
  const salvaguarda = window.setTimeout(() => {
    if (raiz.classList.contains('dark') !== escuro) comprometer();
  }, DURACAO_MS - 500);

  const transicao = doc.startViewTransition(() => {
    window.clearTimeout(salvaguarda);
    comprometer();
  });

  void transicao.ready.then(() => {
    raiz.animate(
      {
        clipPath: [
          `circle(0px at ${x}px ${y}px)`,
          `circle(${raio}px at ${x}px ${y}px)`,
        ],
      },
      {
        duration: DURACAO_MS,
        easing: CURVA,
        // Anima o retrato NOVO, que está por cima: ele é revelado pelo círculo
        // crescendo. Recortar o antigo daria o efeito invertido, com o novo
        // aparecendo por baixo de um buraco.
        pseudoElement: '::view-transition-new(root)',
      },
    );
  });
}

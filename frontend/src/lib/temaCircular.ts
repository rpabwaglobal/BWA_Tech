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

/**
 * O tamanho da janela para o cálculo do raio.
 *
 * `clientWidth/clientHeight` do `<html>` ANTES de `innerWidth/innerHeight`: o
 * primeiro é o viewport de layout, sem a barra de rolagem, e é contra ele que o
 * `clip-path` dos retratos da transição é resolvido. `innerWidth` INCLUI a
 * barra, e a diferença deixava um fio do tema antigo na borda direita.
 *
 * E há a guarda do zero. `innerWidth` pode responder 0 num instante ruim — vi
 * acontecer ao reproduzir isto num navegador embutido, e um raio calculado a
 * partir de zero vira um círculo minúsculo que nunca cobre a tela. Sem a
 * guarda, o sintoma é "a troca de tema não terminou".
 */
function tamanhoDaJanela(): { largura: number; altura: number } {
  const raiz = document.documentElement;
  const largura = raiz.clientWidth || window.innerWidth || 0;
  const altura = raiz.clientHeight || window.innerHeight || 0;
  // 1024x768 é chute de último caso, para o círculo ser grande demais em vez de
  // pequeno demais: exagerar no raio não se vê; faltar raio, sim.
  return {
    largura: largura > 0 ? largura : 1024,
    altura: altura > 0 ? altura : 768,
  };
}

/**
 * A origem, conferida contra a janela.
 *
 * O ponto vem de um `getBoundingClientRect()` no clique. Ele pode chegar
 * inválido — `NaN` se o elemento não estava no layout, ou fora da tela se a
 * janela foi redimensionada entre o clique e a troca. Nesses casos o
 * `circle(... at NaNpx NaNpx)` é descartado pelo navegador e vale a regra
 * padrão, `at center`: o círculo nasce no MEIO DA TELA em vez de no botão.
 *
 * Era esse o "sai de outro lugar". Aqui o ponto é validado e, no pior caso,
 * cai no canto superior direito — onde o botão de tema realmente fica.
 */
function origemValida(
  origem: OrigemDaTroca,
  largura: number,
  altura: number,
): OrigemDaTroca {
  const valido = (n: number, limite: number) =>
    Number.isFinite(n) && n >= 0 && n <= limite;

  if (valido(origem.x, largura) && valido(origem.y, altura)) return origem;
  return { x: largura - 52, y: 32 };
}

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

  const { largura, altura } = tamanhoDaJanela();
  const { x, y } = origemValida(origem, largura, altura);

  // O raio tem de alcançar o canto MAIS DISTANTE da janela, senão sobra um
  // pedaço do tema antigo no canto oposto ao botão.
  //
  // MAIS 2px DE FOLGA: o `clip-path` é arredondado para pixels do dispositivo e
  // a janela pode ter fração de pixel (monitor com escala 125%, zoom do
  // navegador). Sem a folga sobra um fio do tema antigo na borda, que é
  // exatamente o "não vai até o fim".
  const raio = Math.hypot(
    Math.max(x, largura - x),
    Math.max(y, altura - y),
  ) + 2;

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

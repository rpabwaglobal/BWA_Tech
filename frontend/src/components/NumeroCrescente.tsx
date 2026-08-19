import { useEffect, useRef, useState } from 'react';

/**
 * Um número que sobe de zero até o valor final, em vez de aparecer pronto.
 *
 * O ganho é de leitura, não de enfeite: quatro cartões trocando de "0" para o
 * número certo no mesmo quadro não dão ao olho tempo de perceber QUAIS
 * mudaram. Subindo, cada um puxa a atenção para si por um instante — que é
 * exatamente o que se quer de um painel de resumo.
 *
 * `requestAnimationFrame`, e não `setInterval`: a contagem acompanha a taxa de
 * quadros real da tela em vez de brigar com ela. Com intervalo fixo, um quadro
 * perdido vira salto visível, e em tela de 120 Hz a contagem fica granulada.
 *
 * A curva é `easeOutCubic` — rápida no começo, freando no fim. Linear parece
 * mecânico, e a desaceleração dá a impressão de que o número "assentou" no
 * lugar certo em vez de ter parado no meio.
 */
export function NumeroCrescente({
  valor,
  duracaoMs = 900,
  className,
}: {
  valor: number;
  duracaoMs?: number;
  className?: string;
}) {
  // QUEM PEDIU MENOS MOVIMENTO RECEBE O NÚMERO DIRETO.
  // Contagem animada é movimento por estética; a informação é o valor final.
  // Resolvido no estado inicial, e não dentro do efeito: escrever estado no
  // efeito só para "desanimar" custaria um render a mais em toda montagem, e é
  // o que a regra `react-hooks/set-state-in-effect` existe para impedir.
  const [reduzido] = useState(
    () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches,
  );
  const [exibido, setExibido] = useState(0);
  const quadroRef = useRef<number | null>(null);
  const anteriorRef = useRef(0);

  useEffect(() => {
    if (reduzido) return;

    // Anima a partir do que ESTÁ na tela, e não de zero: quando o valor muda
    // por atualização em tempo real, recomeçar do zero pareceria que o painel
    // se perdeu e recarregou.
    const inicio = anteriorRef.current;
    const delta = valor - inicio;
    if (delta === 0) return;

    const t0 = performance.now();
    const passo = (agora: number) => {
      const progresso = Math.min((agora - t0) / duracaoMs, 1);
      const suavizado = 1 - Math.pow(1 - progresso, 3);
      setExibido(Math.round(inicio + delta * suavizado));
      if (progresso < 1) {
        quadroRef.current = requestAnimationFrame(passo);
      } else {
        anteriorRef.current = valor;
      }
    };
    quadroRef.current = requestAnimationFrame(passo);

    return () => {
      if (quadroRef.current !== null) cancelAnimationFrame(quadroRef.current);
    };
  }, [valor, duracaoMs, reduzido]);

  // `tabular-nums` para os dígitos terem largura fixa: sem isso o número
  // TREME durante a contagem, porque "1" é mais estreito que "8" na maioria
  // das fontes e o texto ao lado se desloca a cada quadro.
  return (
    <span className={className} style={{ fontVariantNumeric: 'tabular-nums' }}>
      {reduzido ? valor : exibido}
    </span>
  );
}

import { useEffect, useState, type AnimationEvent } from 'react';

/**
 * O PAINEL DE TIMELINE QUE RECOLHE PARA UMA PASTILHA NO CANTO.
 *
 * São DOIS painéis com esse comportamento — o histórico do card e o do ticket de
 * suporte —, e eles já nasceram gêmeos: mesmas classes, mesmo tamanho, mesma
 * posição. Deixar a máquina de estados duplicada nos dois seria repetir o padrão
 * que este projeto vem pagando caro: quadros e painéis que divergem sem ninguém
 * ter decidido isso, porque ninguém abre os dois lado a lado para notar.
 *
 * O QUE ESTE HOOK RESOLVE, e por que não é só um booleano:
 *
 * Animação de SAÍDA exige que o nó continue montado enquanto ela roda. Trocar a
 * vista direto desmonta o painel no MESMO quadro em que a classe de saída
 * entraria, e a animação nunca chega a rodar — a armadilha que já mordeu o aviso
 * de carregamento deste projeto. Então a troca acontece em dois tempos:
 * `saindo` liga, a animação roda, e só no `animationend` a vista muda de fato.
 */
export function useTimelineRecolhivel({ reiniciarQuando }: {
  /**
   * Valores que, ao mudarem, devolvem o painel ao estado expandido.
   *
   * Cada item tem a sua própria timeline: abrir outro card ou outro ticket não
   * deve herdar o recolhimento do anterior, porque a pessoa não recolheu AQUELE.
   */
  reiniciarQuando: unknown[];
}) {
  const [recolhido, setRecolhido] = useState(false);
  const [saindo, setSaindo] = useState(false);

  useEffect(() => {
    setRecolhido(false);
    setSaindo(false);
    // As dependências são declaradas por quem chama, e o conteúdo do array é o
    // que importa — não a identidade dele.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, reiniciarQuando);

  /**
   * Começa a troca: recolher se está expandido, expandir se está recolhido.
   *
   * Quem pediu menos movimento troca DIRETO: sem animação não há
   * `animationend`, e esperar por ele deixaria a troca presa para sempre — o
   * painel não abriria nem fecharia.
   */
  const trocarVista = () => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) {
      setRecolhido((v) => !v);
      return;
    }
    setSaindo(true);
  };

  /**
   * Fim da animação de SAÍDA — é aqui que a vista realmente muda.
   *
   * Duas armadilhas, as duas tratadas:
   *
   * 1. `animationend` BORBULHA. A animação de qualquer filho dispararia este
   *    mesmo handler e trocaria a vista no meio do caminho; daí a conferência
   *    do alvo contra `currentTarget`.
   * 2. A animação de ENTRADA também passa por aqui. Por isso só age quando
   *    `saindo` está ligado.
   */
  const aoTerminarSaida = (e: AnimationEvent<HTMLElement>) => {
    if (e.target !== e.currentTarget || !saindo) return;
    setSaindo(false);
    setRecolhido((v) => !v);
  };

  return {
    recolhido,
    saindo,
    trocarVista,
    aoTerminarSaida,
    /** Classe do PAINEL: entra deslizando da direita, sai de volta para lá. */
    classeDoPainel: saindo ? 'painel-timeline-sai' : 'painel-timeline-entra',
    /** Classe da PASTILHA, o caminho inverso do painel. */
    classeDaPastilha: saindo ? 'timeline-pastilha-sai' : 'timeline-pastilha',
  };
}

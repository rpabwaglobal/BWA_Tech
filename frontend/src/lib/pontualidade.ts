/**
 * Percentual entregue no prazo, agrupado — a conta, num lugar só.
 *
 * DOIS GRÁFICOS USAM ISTO, e é essa a razão de o módulo existir: os cards de
 * projeto (agrupados por sprint ou por mês) e os chamados de suporte (por mês).
 * As duas perguntas são a mesma — "de tudo que dava para julgar neste grupo,
 * quanto saiu no prazo?" — e só o jeito de responder "saiu no prazo" muda.
 *
 * Escrever a conta duas vezes faria as duas telas divergirem no arredondamento,
 * no que entra no denominador ou no tratamento do que não dá para julgar. É o
 * mesmo motivo de `prazoDoCard`, `businessHours` e `feriados` existirem.
 *
 * O QUE NÃO DÁ PARA JULGAR FICA FORA DO DENOMINADOR, E É CONTADO. Um card sem
 * prazo definido não foi entregue atrasado — ninguém disse quando ele vencia.
 * Jogá-lo em qualquer um dos lados inventa informação. Mas ficar de fora em
 * silêncio é pior: o percentual pareceria sólido enquanto metade dos cards
 * nunca entrou nele. Por isso `semResposta` volta junto, para a tela mostrar.
 */

/** Um item já normalizado: a que grupo pertence e se saiu no prazo. */
export type ItemPontualidade = {
  /** O grupo. `null` = o item não pertence a grupo nenhum e fica fora. */
  chave: string | null;
  /** Como o grupo aparece na tela. */
  rotulo: string;
  /** Por onde ordenar os grupos. Sem ele, ordena pela `chave`. */
  ordem?: number;
  /** `true` no prazo, `false` fora, `null` = não dá para julgar. */
  noPrazo: boolean | null;
};

export type GrupoPontualidade = {
  chave: string;
  rotulo: string;
  noPrazo: number;
  atrasados: number;
  /** Só o que dava para julgar: `noPrazo + atrasados`. */
  total: number;
  /** 0 a 100, sem arredondar. Quem exibe decide as casas. */
  percentual: number;
};

export type ResumoPontualidade = {
  grupos: GrupoPontualidade[];
  /** Itens que não dá para julgar (sem prazo ou sem conclusão registrada). */
  semResposta: number;
  /** Itens sem grupo — por exemplo, card que não está em sprint nenhuma. */
  semGrupo: number;
};

/**
 * Agrupa e calcula o percentual no prazo de cada grupo.
 *
 * Grupo sem nenhum item julgável NÃO aparece: um ponto em 0% que na verdade
 * significa "não havia o que medir" leria como fracasso.
 *
 * `semResposta` conta sobre a lista INTEIRA, inclusive itens sem grupo. Se o
 * aviso contasse só os agrupados, ele esconderia justamente o caso que mais
 * importa — o item que sumiu por dois motivos ao mesmo tempo.
 */
export function resumirPontualidade(
  itens: readonly ItemPontualidade[],
): ResumoPontualidade {
  const porChave = new Map<string, GrupoPontualidade & { ordem?: number }>();
  let semResposta = 0;
  let semGrupo = 0;

  for (const item of itens) {
    if (item.noPrazo === null) semResposta += 1;
    if (item.chave === null) {
      semGrupo += 1;
      continue;
    }
    // Já contado em `semResposta` acima; aqui ele só não entra no denominador.
    if (item.noPrazo === null) continue;

    const atual =
      porChave.get(item.chave) ??
      {
        chave: item.chave,
        rotulo: item.rotulo,
        ordem: item.ordem,
        noPrazo: 0,
        atrasados: 0,
        total: 0,
        percentual: 0,
      };

    atual.total += 1;
    if (item.noPrazo) atual.noPrazo += 1;
    else atual.atrasados += 1;

    porChave.set(item.chave, atual);
  }

  const grupos = [...porChave.values()].map((g) => ({
    chave: g.chave,
    rotulo: g.rotulo,
    ordem: g.ordem,
    noPrazo: g.noPrazo,
    atrasados: g.atrasados,
    total: g.total,
    percentual: (g.noPrazo / g.total) * 100,
  }));

  grupos.sort((a, b) => {
    if (a.ordem !== undefined && b.ordem !== undefined && a.ordem !== b.ordem) {
      return a.ordem - b.ordem;
    }
    return a.chave.localeCompare(b.chave, 'pt-BR');
  });

  return {
    grupos: grupos.map(({ ordem: _ordem, ...g }) => g),
    semResposta,
    semGrupo,
  };
}

/**
 * A chave de mês de uma data ISO, no fuso LOCAL.
 *
 * `new Date('2026-10-01')` é meia-noite UTC, que em Brasília cai em 30/09 —
 * agrupar por `toISOString().slice(0, 7)` jogaria toda entrega da madrugada do
 * dia 1º para o mês anterior. A mesma armadilha de `chaveDoDia`, em
 * `@/lib/feriados`.
 */
export function chaveDoMes(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const MESES_CURTOS = [
  'jan', 'fev', 'mar', 'abr', 'mai', 'jun',
  'jul', 'ago', 'set', 'out', 'nov', 'dez',
];

/** "2026-10" vira "out/26". Curto porque vira rótulo de eixo. */
export function rotuloDoMes(chave: string): string {
  const [ano, mes] = chave.split('-');
  const i = Number(mes) - 1;
  if (!ano || Number.isNaN(i) || i < 0 || i > 11) return chave;
  return `${MESES_CURTOS[i]}/${ano.slice(2)}`;
}

/**
 * A conta de "% entregue no prazo" que os dois gráficos compartilham.
 *
 * POR QUE UM MÓDULO, E NÃO a conta dentro de cada gráfico: os cards de projeto
 * e os chamados de suporte fazem a MESMA pergunta, e escrevê-la duas vezes faria
 * as telas divergirem no denominador, no arredondamento ou no tratamento do que
 * não dá para julgar. Mesmo motivo de `prazoDoCard` e `businessHours`.
 *
 * O ponto mais delicado está em `semResposta`: um card sem prazo definido não é
 * atrasado — ninguém disse quando ele vencia. Ele sai do denominador, mas é
 * contado e mostrado, senão o percentual pareceria sólido enquanto metade dos
 * cards nunca entrou nele.
 */
import { describe, expect, it } from 'vitest';

import {
  chaveDoMes,
  resumirPontualidade,
  rotuloDoMes,
  type ItemPontualidade,
} from './pontualidade';

const item = (
  chave: string | null,
  noPrazo: boolean | null,
  extra: Partial<ItemPontualidade> = {},
): ItemPontualidade => ({ chave, rotulo: chave ?? '—', noPrazo, ...extra });

describe('resumirPontualidade', () => {
  it('calcula o percentual de cada grupo', () => {
    const { grupos } = resumirPontualidade([
      item('2026-09', true),
      item('2026-09', true),
      item('2026-09', false),
      item('2026-09', false),
      item('2026-10', true),
    ]);

    expect(grupos.map((g) => [g.chave, g.percentual])).toEqual([
      ['2026-09', 50],
      ['2026-10', 100],
    ]);
  });

  it('não arredonda — quem exibe decide as casas', () => {
    const { grupos } = resumirPontualidade([
      item('x', true),
      item('x', false),
      item('x', false),
    ]);

    expect(grupos[0].percentual).toBeCloseTo(33.333, 3);
  });

  it('separa no prazo, atrasados e total', () => {
    const { grupos } = resumirPontualidade([
      item('x', true),
      item('x', false),
      item('x', false),
    ]);

    expect(grupos[0]).toMatchObject({ noPrazo: 1, atrasados: 2, total: 3 });
  });
});

describe('o que não dá para julgar', () => {
  it('fica fora do denominador', () => {
    // Dois julgáveis, um deles no prazo: 50%. O terceiro não pode puxar para
    // 33% nem para 67% — ele não é nenhum dos dois.
    const { grupos } = resumirPontualidade([
      item('x', true),
      item('x', false),
      item('x', null),
    ]);

    expect(grupos[0].total).toBe(2);
    expect(grupos[0].percentual).toBe(50);
  });

  it('é CONTADO, para a tela poder avisar', () => {
    // A trava contra a omissão silenciosa. Sem este número, um grupo com 90%
    // de itens sem prazo pareceria tão sólido quanto um com nenhum.
    const { semResposta } = resumirPontualidade([
      item('x', true),
      item('x', null),
      item('y', null),
    ]);

    expect(semResposta).toBe(2);
  });

  it('conta também o que não tem grupo', () => {
    // Um item pode sumir por DOIS motivos ao mesmo tempo. Se o aviso só
    // contasse os agrupados, esconderia justamente esse caso.
    const { semResposta, semGrupo } = resumirPontualidade([item(null, null)]);

    expect(semResposta).toBe(1);
    expect(semGrupo).toBe(1);
  });

  it('grupo sem nada julgável não vira ponto de 0%', () => {
    // Um ponto zerado leria como fracasso, quando na verdade não havia o que
    // medir. O grupo simplesmente não aparece.
    const { grupos, semResposta } = resumirPontualidade([
      item('x', null),
      item('x', null),
    ]);

    expect(grupos).toEqual([]);
    expect(semResposta).toBe(2);
  });
});

describe('ordem dos grupos', () => {
  it('usa `ordem` quando ela vem', () => {
    // Sprints precisam sair em ordem cronológica, e o nome delas não ordena.
    const { grupos } = resumirPontualidade([
      item('sprint-b', true, { rotulo: 'Sprint 2', ordem: 2 }),
      item('sprint-a', true, { rotulo: 'Sprint 10', ordem: 10 }),
      item('sprint-c', true, { rotulo: 'Sprint 1', ordem: 1 }),
    ]);

    expect(grupos.map((g) => g.rotulo)).toEqual(['Sprint 1', 'Sprint 2', 'Sprint 10']);
  });

  it('sem `ordem`, ordena pela chave — que para mês já é cronológico', () => {
    const { grupos } = resumirPontualidade([
      item('2026-10', true),
      item('2026-02', true),
      item('2025-12', true),
    ]);

    expect(grupos.map((g) => g.chave)).toEqual(['2025-12', '2026-02', '2026-10']);
  });
});

describe('chaveDoMes', () => {
  it('usa o fuso LOCAL, não UTC', () => {
    // `new Date('2026-10-01T02:00:00Z')` em Brasília é 30/09 às 23h. Agrupar
    // por `toISOString()` jogaria a entrega para setembro. Mesma armadilha de
    // `chaveDoDia`, em `@/lib/feriados`.
    const madrugada = new Date(2026, 9, 1, 0, 30).toISOString();

    expect(chaveDoMes(madrugada)).toBe('2026-10');
  });

  it('devolve null para data inválida, em vez de inventar um mês', () => {
    expect(chaveDoMes('qualquer coisa')).toBeNull();
  });
});

describe('rotuloDoMes', () => {
  it('encurta para caber no eixo', () => {
    expect(rotuloDoMes('2026-10')).toBe('out/26');
    expect(rotuloDoMes('2026-01')).toBe('jan/26');
  });

  it('devolve a chave quando não reconhece', () => {
    expect(rotuloDoMes('coisa')).toBe('coisa');
  });
});

/**
 * A única regra de feriado do frontend.
 *
 * O QUE ELA SUBSTITUIU: `dateUtils.ts` tinha uma implementação privada que só
 * os cards usavam, e o SLA dos chamados de suporte não usava nenhuma — contava
 * feriado como dia normal. O 20/11 faltava nas duas desde que virou feriado
 * nacional, em 2024.
 *
 * As duas metades são testadas separadamente porque falham de jeitos
 * diferentes: a CALCULADA falha se o algoritmo estiver errado; a CARREGADA
 * falha se a resposta do servidor não chegar ao lugar certo.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import {
  chaveDoDia,
  definirFeriadosDoServidor,
  isDiaUtil,
  isFeriado,
  isFimDeSemana,
  nacionaisDoAno,
  pascoa,
  totalDeFeriadosDoServidor,
} from './feriados';

/** Data local, sem passar por string ISO — ver `chaveDoDia`. */
const dia = (a: number, m: number, d: number) => new Date(a, m - 1, d);

beforeEach(() => {
  // O registro do servidor é estado de módulo. Sem zerar, um teste contamina o
  // seguinte — e o sintoma seria um teste que passa sozinho e falha em suíte.
  definirFeriadosDoServidor([]);
});

describe('pascoa', () => {
  it('bate com os domingos de Páscoa publicados', () => {
    expect(chaveDoDia(pascoa(2023))).toBe('2023-04-09');
    expect(chaveDoDia(pascoa(2024))).toBe('2024-03-31');
    expect(chaveDoDia(pascoa(2025))).toBe('2025-04-20');
    expect(chaveDoDia(pascoa(2026))).toBe('2026-04-05');
    expect(chaveDoDia(pascoa(2027))).toBe('2027-03-28');
  });

  it('cai sempre num domingo, em qualquer ano', () => {
    // Uma propriedade vale mais que uma tabela: pega erro em ano que ninguém
    // pensou em listar.
    for (let ano = 2000; ano <= 2100; ano += 1) {
      expect(pascoa(ano).getDay(), `Páscoa de ${ano}`).toBe(0);
    }
  });
});

describe('feriados nacionais calculados', () => {
  it('traz os móveis de 2026', () => {
    const dias = nacionaisDoAno(2026);
    expect(dias.has('2026-02-16')).toBe(true); // carnaval, segunda
    expect(dias.has('2026-02-17')).toBe(true); // carnaval, terça
    expect(dias.has('2026-04-03')).toBe(true); // sexta-feira santa
    expect(dias.has('2026-06-04')).toBe(true); // corpus christi
  });

  it('traz os fixos de 2026', () => {
    const dias = nacionaisDoAno(2026);
    for (const d of ['2026-01-01', '2026-04-21', '2026-05-01', '2026-09-07',
                     '2026-10-12', '2026-11-02', '2026-11-15', '2026-12-25']) {
      expect(dias.has(d), d).toBe(true);
    }
  });

  it('conta o 20 de novembro a partir de 2024, e não antes', () => {
    // Lei 14.759/2023. Faltava nas duas implementações antigas. Contá-lo em
    // 2023 mudaria o histórico de cards já fechados.
    expect(nacionaisDoAno(2024).has('2024-11-20')).toBe(true);
    expect(nacionaisDoAno(2026).has('2026-11-20')).toBe(true);
    expect(nacionaisDoAno(2023).has('2023-11-20')).toBe(false);
  });

  it('não marca um dia comum', () => {
    expect(nacionaisDoAno(2026).has('2026-03-03')).toBe(false);
  });
});

describe('o dia é lido no fuso LOCAL', () => {
  it('não troca o feriado de dia por causa de UTC', () => {
    // `new Date('2026-06-29')` é meia-noite UTC, que em Brasília é dia 28 às
    // 21h. Comparar por `toISOString()` marcaria o feriado no dia errado — e o
    // erro só apareceria para quem estivesse a oeste de Greenwich, ou seja,
    // todos os usuários deste sistema.
    definirFeriadosDoServidor(['2026-06-29']);

    expect(isFeriado(dia(2026, 6, 29))).toBe(true);
    expect(isFeriado(dia(2026, 6, 28))).toBe(false);
  });

  it('chaveDoDia preenche mês e dia com zero à esquerda', () => {
    expect(chaveDoDia(dia(2026, 1, 5))).toBe('2026-01-05');
  });
});

describe('feriados carregados do servidor', () => {
  it('somam-se aos calculados, sem substituí-los', () => {
    definirFeriadosDoServidor(['2026-06-29']);

    expect(isFeriado(dia(2026, 6, 29))).toBe(true); // cadastrado
    expect(isFeriado(dia(2026, 5, 1))).toBe(true);  // nacional continua
  });

  it('começam vazios, e os nacionais já valem antes de qualquer resposta', () => {
    // A garantia que permite as funções serem síncronas: o sistema nunca fica
    // sem resposta esperando a rede.
    expect(totalDeFeriadosDoServidor()).toBe(0);
    expect(isFeriado(dia(2026, 5, 1))).toBe(true);
  });

  it('uma lista nova substitui a anterior', () => {
    definirFeriadosDoServidor(['2026-06-29']);
    definirFeriadosDoServidor(['2026-07-15']);

    expect(isFeriado(dia(2026, 6, 29))).toBe(false);
    expect(isFeriado(dia(2026, 7, 15))).toBe(true);
  });
});

describe('isFimDeSemana e isDiaUtil', () => {
  it('reconhece sábado e domingo', () => {
    expect(isFimDeSemana(dia(2026, 3, 7))).toBe(true); // sábado
    expect(isFimDeSemana(dia(2026, 3, 8))).toBe(true); // domingo
    expect(isFimDeSemana(dia(2026, 3, 3))).toBe(false); // terça
  });

  it('dia útil é o que não é fim de semana nem feriado', () => {
    expect(isDiaUtil(dia(2026, 3, 3))).toBe(true);  // terça comum
    expect(isDiaUtil(dia(2026, 3, 7))).toBe(false); // sábado
    expect(isDiaUtil(dia(2026, 5, 1))).toBe(false); // feriado nacional
  });

  it('fim de semana NÃO é tratado como feriado', () => {
    // As duas perguntas ficam separadas de propósito: juntá-las esconderia
    // qual delas tirou o dia.
    expect(isFeriado(dia(2026, 3, 7))).toBe(false);
  });
});

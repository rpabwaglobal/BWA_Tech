/**
 * O SLA do suporte desconta sábado e domingo — e as duas definições concordam.
 *
 * POR QUE ESTE É O PRIMEIRO TESTE DO FRONTEND: havia duas contas de SLA no
 * sistema e elas divergiam. A tela de Suporte descontava o fim de semana
 * (`add24BusinessHours`); a tabela de métricas media horas de relógio cru. Um
 * chamado aberto sexta 16h e resolvido segunda 10h saía "no prazo" numa tela e
 * "66 horas, atrasado" na outra.
 *
 * O conserto foi estrutural — o veredicto passou a sair da MESMA função nos dois
 * lugares — mas a medida exibida ainda é uma segunda função
 * (`businessHoursBetween`), e duas funções podem derivar. É isso que esta suíte
 * trava: para cada caso, verifica que "≤ 24h úteis" e "antes do prazo" dão a
 * mesma resposta.
 *
 * As datas são de outubro de 2026, com os dias da semana conferidos:
 * 15 = quinta, 16 = sexta, 17 = sábado, 18 = domingo, 19 = segunda, 20 = terça.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { add24BusinessHours, businessHoursBetween, isSuporteOverdue } from './businessHours';
import { definirFeriadosDoServidor } from './feriados';

const SEG = '2026-10-19T00:00:00';
const QUI_10H = new Date('2026-10-15T10:00:00');
const SEX_10H = new Date('2026-10-16T10:00:00');
const SEX_16H = new Date('2026-10-16T16:00:00');
const SAB_10H = new Date('2026-10-17T10:00:00');

/** Guarda contra erro de fixture: se uma data trocar, o teste todo mente. */
describe('as datas da suíte são os dias que o teste assume', () => {
  it('15/10/2026 é quinta e 19/10/2026 é segunda', () => {
    expect(QUI_10H.getDay()).toBe(4);
    expect(SEX_10H.getDay()).toBe(5);
    expect(SAB_10H.getDay()).toBe(6);
    expect(new Date(SEG).getDay()).toBe(1);
  });
});

describe('add24BusinessHours', () => {
  it('O CASO RELATADO: aberto sexta 16h vence na segunda 16h', () => {
    const prazo = add24BusinessHours(SEX_16H);
    expect(prazo.getDay()).toBe(1); // segunda
    expect(prazo.getHours()).toBe(16);
  });

  it('sem fim de semana no caminho, são 24h corridas', () => {
    const prazo = add24BusinessHours(QUI_10H);
    expect(prazo.getDay()).toBe(5); // sexta
    expect(prazo.getHours()).toBe(10);
  });

  it('data inválida entra, data inválida sai', () => {
    // NÃO é um teste do guard: medido por mutação, remover o guard mantém este
    // teste passando, porque `isWeekend` de uma data inválida devolve false e o
    // laço não roda. O que se afirma aqui é o CONTRATO — quem chamar com lixo
    // recebe lixo reconhecível em vez de uma data plausível e errada.
    const r = add24BusinessHours(new Date('nada disso'));
    expect(Number.isNaN(r.getTime())).toBe(true);
  });
});

describe('businessHoursBetween', () => {
  it('desconta o fim de semana inteiro', () => {
    // sex 16h → seg 10h = 66h de relógio, 18h úteis.
    expect(businessHoursBetween(SEX_16H, new Date('2026-10-19T10:00:00'))).toBeCloseTo(18, 1);
  });

  it('sem fim de semana, é igual ao relógio', () => {
    expect(businessHoursBetween(QUI_10H, new Date('2026-10-16T09:00:00'))).toBeCloseTo(23, 1);
  });

  it('um período inteiro dentro do fim de semana conta zero', () => {
    expect(businessHoursBetween(SAB_10H, new Date('2026-10-18T10:00:00'))).toBeCloseTo(0, 1);
  });

  it('fim antes do início devolve zero, não negativo', () => {
    expect(businessHoursBetween(new Date('2026-10-19T10:00:00'), SEX_10H)).toBe(0);
  });

  it('data inválida devolve NaN em vez de um número errado', () => {
    expect(Number.isNaN(businessHoursBetween(new Date('x'), SEX_10H))).toBe(true);
  });
});

/**
 * A TRAVA QUE IMPORTA.
 *
 * `add24BusinessHours` empurra o prazo em dias inteiros (preserva o horário);
 * `businessHoursBetween` desconta os milissegundos de fim de semana. São
 * caminhos diferentes para a mesma regra, e por isso podem divergir. Para cada
 * caso, as duas respostas têm de bater.
 */
describe('as duas definições de SLA concordam', () => {
  const casos: Array<[string, string, string]> = [
    ['sex 16h → seg 10h (o caso relatado)', '2026-10-16T16:00:00', '2026-10-19T10:00:00'],
    ['sex 16h → seg 17h (passou)', '2026-10-16T16:00:00', '2026-10-19T17:00:00'],
    ['sex 10h → seg 09h (no limite)', '2026-10-16T10:00:00', '2026-10-19T09:00:00'],
    ['sex 10h → seg 11h (1h além)', '2026-10-16T10:00:00', '2026-10-19T11:00:00'],
    ['qui 10h → sex 09h (sem fds)', '2026-10-15T10:00:00', '2026-10-16T09:00:00'],
    ['qui 10h → sex 11h (sem fds, atrasou)', '2026-10-15T10:00:00', '2026-10-16T11:00:00'],
    ['sáb 10h → seg 09h (aberto no fds)', '2026-10-17T10:00:00', '2026-10-19T09:00:00'],
    ['seg 09h → ter 08h', '2026-10-19T09:00:00', '2026-10-20T08:00:00'],
    ['qua 09h → qui 09h (exatamente 24h)', '2026-10-14T09:00:00', '2026-10-15T09:00:00'],
  ];

  it.each(casos)('%s', (_nome, inicio, fim) => {
    const abertura = new Date(inicio);
    const resolucao = new Date(fim);

    const porHorasUteis = businessHoursBetween(abertura, resolucao) <= 24;
    const antesDoPrazo = resolucao.getTime() <= add24BusinessHours(abertura).getTime();

    expect(porHorasUteis).toBe(antesDoPrazo);
  });

  it('o caso relatado especificamente dá NO PRAZO', () => {
    const abertura = SEX_16H;
    const resolucao = new Date('2026-10-19T10:00:00');

    // Pelo relógio cru seriam 66h — e era assim que a métrica o reprovava.
    expect((resolucao.getTime() - abertura.getTime()) / 3_600_000).toBeCloseTo(66, 0);
    // Pelas horas úteis são 18h, dentro das 24.
    expect(businessHoursBetween(abertura, resolucao)).toBeLessThanOrEqual(24);
    expect(resolucao.getTime()).toBeLessThanOrEqual(add24BusinessHours(abertura).getTime());
  });
});

describe('isSuporteOverdue', () => {
  it('chamado resolvido ou cancelado nunca está atrasado', () => {
    const base = { data_abertura: '2020-01-01T10:00:00' };
    expect(isSuporteOverdue({ ...base, status: 'Resolvido' })).toBe(false);
    expect(isSuporteOverdue({ ...base, status: 'Cancelado' })).toBe(false);
  });

  it('sem data de abertura não há prazo correndo', () => {
    expect(isSuporteOverdue({ status: 'Aberto', data_abertura: '' })).toBe(false);
  });

  it('aberto há muito tempo está atrasado', () => {
    expect(isSuporteOverdue({ status: 'Aberto', data_abertura: '2020-01-01T10:00:00' })).toBe(true);
  });

  it('aberto agora não está atrasado', () => {
    expect(isSuporteOverdue({ status: 'Aberto', data_abertura: new Date().toISOString() })).toBe(false);
  });
});

/**
 * FERIADO ENTROU NA REGRA DEPOIS DO FIM DE SEMANA, e pelo mesmo motivo: um
 * chamado aberto na véspera de um feriado prolongado nascia atrasado.
 *
 * Datas de 2026, dias da semana conferidos:
 *   20/04 segunda · 21/04 TERÇA, Tiradentes · 22/04 quarta
 *   19/11 quinta · 20/11 SEXTA, Consciência Negra · 21-22 fim de semana · 23/11 segunda
 */
describe('o SLA desconta feriado', () => {
  beforeEach(() => {
    definirFeriadosDoServidor([]);
  });

  it('empurra o prazo que cairia num feriado nacional', () => {
    const abertura = new Date('2026-04-20T10:00:00'); // segunda
    // 24h daria terça 21/04 10h, que é Tiradentes.
    expect(add24BusinessHours(abertura).toISOString())
      .toBe(new Date('2026-04-22T10:00:00').toISOString());
  });

  it('atravessa feriado E fim de semana de uma vez', () => {
    // Quinta 19/11 16h → sexta é feriado, sábado e domingo são fds.
    const abertura = new Date('2026-11-19T16:00:00');
    expect(add24BusinessHours(abertura).toISOString())
      .toBe(new Date('2026-11-23T16:00:00').toISOString());
  });

  it('não conta as horas do feriado na medida exibida', () => {
    const abertura = new Date('2026-11-19T16:00:00'); // quinta
    const resolucao = new Date('2026-11-23T10:00:00'); // segunda

    // 90h de relógio. Úteis: 8h de quinta + 10h de segunda. Sexta (feriado),
    // sábado e domingo saem inteiros.
    expect(businessHoursBetween(abertura, resolucao)).toBe(18);
  });

  it('o veredicto e a medida continuam concordando com feriado no meio', () => {
    // A trava central desta suíte, agora com feriado. Se as duas funções
    // derivarem, a tela volta a dizer "no prazo" ao lado de "90h".
    const abertura = new Date('2026-11-19T16:00:00');
    for (const resolucao of [
      new Date('2026-11-23T10:00:00'), // segunda cedo — dentro
      new Date('2026-11-23T15:59:00'), // um minuto antes do prazo
      new Date('2026-11-23T16:01:00'), // um minuto depois
      new Date('2026-11-24T09:00:00'), // terça — fora
    ]) {
      const dentroPelaMedida = businessHoursBetween(abertura, resolucao) <= 24;
      const dentroPeloPrazo = resolucao <= add24BusinessHours(abertura);
      expect(dentroPelaMedida, resolucao.toISOString()).toBe(dentroPeloPrazo);
    }
  });

  it('respeita feriado municipal vindo do servidor', () => {
    const abertura = new Date('2026-03-02T10:00:00'); // segunda comum
    expect(add24BusinessHours(abertura).toISOString())
      .toBe(new Date('2026-03-03T10:00:00').toISOString());

    definirFeriadosDoServidor(['2026-03-03']);

    expect(add24BusinessHours(abertura).toISOString())
      .toBe(new Date('2026-03-04T10:00:00').toISOString());
  });
});

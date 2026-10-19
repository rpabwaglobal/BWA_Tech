/**
 * Feriados — a única resposta do frontend para "este dia é útil?".
 *
 * HAVIA DUAS RESPOSTAS AQUI, E O SLA NÃO USAVA NENHUMA. `dateUtils.ts` tinha
 * uma implementação privada (fixos + móveis da Páscoa) que só os cards
 * consumiam; `businessHours.ts`, que decide o prazo dos chamados de suporte,
 * contava feriado como dia normal. Um chamado aberto na véspera de um feriado
 * nascia atrasado.
 *
 * DUAS METADES, ESPELHANDO O BACKEND (`apps/projects/feriados.py`):
 *
 *   CALCULADO — os nacionais. São lei ou prática universal e um algoritmo os
 *   produz exatamente, para qualquer ano. Ficam aqui, disponíveis de imediato,
 *   SEM depender de rede.
 *
 *   CARREGADO — estaduais do RN, municipais de Natal e recessos da empresa.
 *   Dependem de decisão humana, vivem no banco e chegam por `/api/feriados/`.
 *
 * POR QUE AS FUNÇÕES SÃO SÍNCRONAS E NÃO ESPERAM O SERVIDOR. `isSuporteOverdue`
 * é chamada durante a renderização de listas; torná-la assíncrona espalharia
 * estado de carregamento por meia dúzia de telas. Mais importante: este projeto
 * já introduziu um defeito exatamente assim — um card que dependia de uma
 * segunda requisição ficava vazio, sem explicação, enquanto ela não chegava.
 * Aqui o pior caso é um feriado municipal não descontado por alguns segundos
 * depois da abertura do app, nunca uma tela em branco.
 */

/** Feriados nacionais de data fixa, como [mês, dia] com mês começando em 1. */
const NACIONAIS_FIXOS: ReadonlyArray<readonly [number, number]> = [
  [1, 1],    // Confraternização Universal
  [4, 21],   // Tiradentes
  [5, 1],    // Dia do Trabalhador
  [9, 7],    // Independência do Brasil
  [10, 12],  // Nossa Senhora Aparecida
  [11, 2],   // Finados
  [11, 15],  // Proclamação da República
  [11, 20],  // Consciência Negra (Lei 14.759/2023, desde 2024)
  [12, 25],  // Natal
];

/**
 * Ano a partir do qual o 20/11 conta.
 *
 * ELE FALTAVA NAS DUAS IMPLEMENTAÇÕES ANTIGAS, aqui e no backend: virou feriado
 * nacional pela Lei 14.759/2023 e ninguém atualizou as listas, então todo 20/11
 * desde 2024 foi contado como dia útil. Antes de 2024 ele não era nacional, e
 * contá-lo mudaria o histórico de cards fechados em 2023.
 */
const ANO_CONSCIENCIA_NEGRA = 2024;

/** Chave local YYYY-MM-DD de uma data.
 *
 * O DIA É LIDO NO FUSO LOCAL, DE PROPÓSITO. `new Date('2026-06-29')` é
 * meia-noite UTC, que em Brasília é dia 28 às 21h: comparar por `toISOString()`
 * trocaria o feriado de dia. Todas as comparações deste módulo passam por aqui.
 */
export function chaveDoDia(d: Date): string {
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mes}-${dia}`;
}

/** Domingo de Páscoa pelo algoritmo de Meeus/Jones/Butcher. */
export function pascoa(ano: number): Date {
  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(ano, mes - 1, dia);
}

/** Cache por ano: o conjunto é o mesmo para todo chamador e não muda. */
const nacionaisPorAno = new Map<number, Set<string>>();

/**
 * Feriados nacionais do ano, como chaves YYYY-MM-DD.
 *
 * Carnaval e Corpus Christi entram embora sejam juridicamente PONTO
 * FACULTATIVO: a empresa não trabalha neles, e o cálculo dos cards já os
 * contava assim. Tirá-los mudaria o tempo de desenvolvimento de todo card já
 * fechado, sem ninguém ter pedido.
 */
export function nacionaisDoAno(ano: number): Set<string> {
  const emCache = nacionaisPorAno.get(ano);
  if (emCache) return emCache;

  const dias = new Set<string>();
  for (const [mes, dia] of NACIONAIS_FIXOS) {
    if (mes === 11 && dia === 20 && ano < ANO_CONSCIENCIA_NEGRA) continue;
    dias.add(chaveDoDia(new Date(ano, mes - 1, dia)));
  }

  const domingo = pascoa(ano);
  const deslocado = (dias_: number) =>
    new Date(domingo.getFullYear(), domingo.getMonth(), domingo.getDate() + dias_);
  dias.add(chaveDoDia(deslocado(-48))); // Carnaval, segunda
  dias.add(chaveDoDia(deslocado(-47))); // Carnaval, terça
  dias.add(chaveDoDia(deslocado(-2)));  // Sexta-feira Santa
  dias.add(chaveDoDia(deslocado(60)));  // Corpus Christi

  nacionaisPorAno.set(ano, dias);
  return dias;
}

/**
 * Feriados que vieram do servidor (estaduais, municipais, recessos).
 *
 * Começa VAZIO e nunca fica indefinido: antes de `/api/feriados/` responder, o
 * sistema desconta os nacionais e segue funcionando. Ver o cabeçalho do módulo.
 */
let doServidor: ReadonlySet<string> = new Set();

/** Guarda as datas vindas de `/api/feriados/`, no formato YYYY-MM-DD. */
export function definirFeriadosDoServidor(datas: readonly string[]): void {
  doServidor = new Set(datas);
}

/** Quantos feriados cadastrados estão carregados. Só para diagnóstico e teste. */
export function totalDeFeriadosDoServidor(): number {
  return doServidor.size;
}

/** True se a data é feriado — nacional calculado ou cadastrado no servidor. */
export function isFeriado(data: Date): boolean {
  if (Number.isNaN(data.getTime())) return false;
  const chave = chaveDoDia(data);
  return nacionaisDoAno(data.getFullYear()).has(chave) || doServidor.has(chave);
}

/** True se a data cai em sábado (6) ou domingo (0). */
export function isFimDeSemana(data: Date): boolean {
  const dia = data.getDay();
  return dia === 0 || dia === 6;
}

/** True se não é fim de semana nem feriado. */
export function isDiaUtil(data: Date): boolean {
  return !isFimDeSemana(data) && !isFeriado(data);
}

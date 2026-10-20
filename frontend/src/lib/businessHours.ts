/**
 * Helpers de prazo em "horas úteis" para SLA de chamados de suporte.
 *
 * Regra atual (combinada com o usuário):
 *  - 24h CORRIDAS a partir da data de abertura,
 *  - descontando sábado, domingo E FERIADO.
 *
 * FERIADO ENTROU DEPOIS, E A FALTA DELE TINHA EFEITO REAL. O comentário que
 * ficava aqui dizia "SEM feriados (pragmático — não dependemos de lib
 * externa)". Não era preciso lib externa nenhuma: `dateUtils.ts` já calculava
 * feriados brasileiros neste mesmo projeto, e o cálculo dos cards já os usava.
 * Só o SLA é que não — um chamado aberto na véspera de um feriado prolongado
 * nascia atrasado.
 *
 * A resposta vem de `@/lib/feriados`, única no frontend e espelhada no backend
 * (`apps/projects/feriados.py`). Os nacionais são calculados e valem de
 * imediato; estaduais, municipais e recessos chegam por `/api/feriados/`.
 *
 * Não tenta modelar horário comercial (9h-18h) — qualquer hora dentro do dia
 * conta.
 */
import { isFeriado, isFimDeSemana } from '@/lib/feriados';
import type { ChamadoSuporte } from '@/services/suporteService';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/** True se o dia não conta para o prazo: fim de semana ou feriado. */
function isNaoUtil(d: Date): boolean {
  return isFimDeSemana(d) || isFeriado(d);
}

/**
 * Adiciona 24h corridas a `start`, e enquanto o resultado cair em dia não útil
 * (fim de semana ou feriado), empurra um dia inteiro, no MESMO horário.
 *
 * Mais simples que "skipar enquanto conta" — cobre o caso comum em que a
 * abertura é numa véspera e o prazo bate no descanso. Empurrar em DIAS INTEIROS
 * é o que preserva o horário do dia, e é disso que depende a consistência com
 * `businessHoursBetween` descrita mais abaixo.
 */
export function add24BusinessHours(start: Date): Date {
  // Guard: data inválida entra, data inválida sai — quem chamou decide o que
  // fazer com ela.
  //
  // O comentário anterior dizia que sem este guard o `while` giraria para
  // sempre. NÃO GIRA, e foi medido: `getDay()` de uma data inválida é `NaN`,
  // `NaN === 0 || NaN === 6` é falso, e o laço nem chega a entrar. O guard fica
  // por ser explícito sobre a intenção, não por evitar travamento.
  if (Number.isNaN(start.getTime())) return start;
  const result = new Date(start.getTime() + ONE_DAY_MS);
  while (isNaoUtil(result)) {
    result.setTime(result.getTime() + ONE_DAY_MS);
  }
  return result;
}

/**
 * True se o chamado já estourou o SLA de 24h úteis. False se:
 *  - já foi resolvido ou cancelado (nesse caso não tem mais SLA correndo),
 *  - não tem data_abertura,
 *  - ainda está dentro do prazo.
 */
export function isSuporteOverdue(chamado: Pick<ChamadoSuporte, 'status' | 'data_abertura'>): boolean {
  if (chamado.status === 'Resolvido' || chamado.status === 'Cancelado') return false;
  if (!chamado.data_abertura) return false;
  const opened = new Date(chamado.data_abertura);
  if (Number.isNaN(opened.getTime())) return false;
  const deadline = add24BusinessHours(opened);
  return Date.now() > deadline.getTime();
}

/**
 * Horas decorridas entre dois instantes, DESCONTANDO sábado, domingo e feriado.
 *
 * Existe para a tabela de SLA mostrar um número coerente com o veredicto. O
 * veredicto sai de `add24BusinessHours` (a mesma função do selo "atrasado" da
 * tela de Suporte); se o número exibido fosse de relógio cru, a linha diria
 * "66h — no prazo" e ninguém entenderia.
 *
 * CONSISTENTE COM `add24BusinessHours` POR CONSTRUÇÃO, e isso não é acaso:
 * aquela empurra o prazo em DIAS INTEIROS, o que preserva o horário do dia;
 * esta desconta os milissegundos que caíram no fim de semana. As duas dão o
 * mesmo veredicto em qualquer entrada. Conferido na mão:
 *
 *   aberto sex 10h, resolvido seg 09h → 71h cruas − 48h de fds = 23h ≤ 24 ✓
 *                                        prazo = seg 10h, 09h < 10h    ✓
 *   aberto sex 10h, resolvido seg 11h → 73h − 48h = 25h > 24          ✗
 *                                        prazo = seg 10h, 11h > 10h    ✗
 *
 * Varre de hora em hora em vez de fazer aritmética de calendário: o período
 * aqui é de horas ou poucos dias, e a versão simples é a que se consegue
 * conferir lendo.
 */
export function businessHoursBetween(start: Date, end: Date): number {
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return NaN;
  if (end <= start) return 0;

  const UMA_HORA = 60 * 60 * 1000;
  let uteis = 0;
  let cursor = start.getTime();
  const fim = end.getTime();

  while (cursor < fim) {
    const passo = Math.min(UMA_HORA, fim - cursor);
    // O passo conta pelo dia em que COMEÇA. Com passo de uma hora, o erro
    // máximo é de uma hora na virada de um dia não útil para um útil — e o
    // veredicto não depende disso, porque quem decide é `add24BusinessHours`.
    if (!isNaoUtil(new Date(cursor))) uteis += passo / UMA_HORA;
    cursor += passo;
  }
  return uteis;
}

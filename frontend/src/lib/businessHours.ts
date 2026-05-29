/**
 * Helpers de prazo em "horas úteis" para SLA de chamados de suporte.
 *
 * Regra atual (combinada com o usuário):
 *  - 24h CORRIDAS a partir da data de abertura,
 *  - SE o prazo cair em sábado/domingo, soma o tempo que falta de fds + 24h.
 *  - SEM feriados (pragmático — não dependemos de lib externa).
 *
 * Não tenta modelar horário comercial (9h-18h) — qualquer hora dentro do dia
 * conta. Se um dia precisarmos disso, vale revisitar com uma lib (date-fns ou
 * dayjs) e arquivo de feriados.
 */
import type { ChamadoSuporte } from '@/services/suporteService';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/** True se a data cai em sábado (6) ou domingo (0). */
function isWeekend(d: Date): boolean {
  const day = d.getDay();
  return day === 0 || day === 6;
}

/**
 * Adiciona 24h corridas a `start`, mas se o resultado cair em fim de semana
 * (sáb ou dom), empurra pra próxima segunda no MESMO horário.
 *
 * Mais simples que "skipar enquanto conta" — cobre o caso comum em que a
 * abertura é numa quinta/sexta e o prazo bate no fds.
 */
export function add24BusinessHours(start: Date): Date {
  // Guard: se quem chamou passou uma data inválida (ex.: `new Date(undefined)`),
  // retorna a própria data inválida — caller decide o que fazer. Sem isso,
  // getTime() é NaN e o while gira infinitamente.
  if (Number.isNaN(start.getTime())) return start;
  const result = new Date(start.getTime() + ONE_DAY_MS);
  while (isWeekend(result)) {
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

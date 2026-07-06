import type { Sprint } from '@/services/sprintService';

/** ISO de fechamento (API) → valor para input `datetime-local` no fuso local */
export function fechamentoIsoToDatetimeLocal(iso: string | undefined | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** `datetime-local` → ISO UTC para enviar ao backend */
export function datetimeLocalToFechamentoIso(local: string): string {
  if (!local || !local.trim()) return '';
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString();
}

/** Bloqueia edição quando a sprint já foi fechada no backend ou já passou o instante de fechamento. */
export function isSprintPastFechamento(sprint: {
  finalizada?: boolean;
  fechamento_em?: string | null;
}): boolean {
  if (sprint.finalizada) return true;
  if (!sprint.fechamento_em) return false;
  return new Date(sprint.fechamento_em).getTime() <= Date.now();
}

/** Dia final da sprint em YYYY-MM-DD (API envia `data_fim` derivado; fallback a partir de `fechamento_em`). */
export function sprintFimDiaParaCalendario(s: {
  data_fim?: string | null;
  fechamento_em?: string | null;
}): string {
  if (s.data_fim) return s.data_fim;
  if (!s.fechamento_em) return '';
  const d = new Date(s.fechamento_em);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Dia de início da sprint em YYYY-MM-DD (local), a partir de `data_inicio` (datetime ISO). */
export function sprintInicioDiaParaCalendario(s: { data_inicio?: string | null }): string {
  if (!s.data_inicio) return '';
  const d = new Date(s.data_inicio);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Sprints com janela ativa (mesma regra do Dashboard): não finalizada,
 * o dia de hoje já é em ou após o início (meia-noite local) e o instante atual ainda não passou de `fechamento_em`.
 */
export function getSprintsEmAndamentoJanela(sprints: Sprint[]): Sprint[] {
  const now = new Date();
  return sprints.filter((sprint) => {
    if (sprint.finalizada) return false;
    const start = new Date(sprint.data_inicio);
    start.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const fechamento = new Date(sprint.fechamento_em);
    return today >= start && now <= fechamento;
  });
}

export function getSprintIdsEmAndamentoJanela(sprints: Sprint[]): Set<string> {
  return new Set(getSprintsEmAndamentoJanela(sprints).map((s) => String(s.id)));
}

/** Uma sprint está na janela ativa (em andamento). */
export function isSprintEmAndamentoJanela(sprint: Sprint): boolean {
  return getSprintsEmAndamentoJanela([sprint]).length > 0;
}

/** Sprint ativa principal (mais recente por `data_inicio` se houver legado com mais de uma). */
export function getSprintEmAndamentoPrincipal(sprints: Sprint[]): Sprint | null {
  const active = getSprintsEmAndamentoJanela(sprints);
  if (!active.length) return null;
  return [...active].sort(
    (a, b) => new Date(b.data_inicio).getTime() - new Date(a.data_inicio).getTime(),
  )[0];
}

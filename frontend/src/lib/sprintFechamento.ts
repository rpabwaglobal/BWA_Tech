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

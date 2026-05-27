/**
 * Persistência de preferências de relatórios em localStorage.
 *
 * Hoje só guarda o checkbox "incluir cabeçalho das colunas" por formato
 * tabular (XLSX/CSV) — o usuário pediu que o navegador lembrasse essa escolha.
 */
const KEY = 'reports:include-header';
type FormatTabular = 'xlsx' | 'csv';

/** Lê preferência. Default true (cabeçalho marcado). */
export function readIncludeHeader(fmt: FormatTabular): boolean {
  try {
    const raw = localStorage.getItem(`${KEY}:${fmt}`);
    if (raw == null) return true;
    return raw === '1';
  } catch {
    return true;
  }
}

/** Salva preferência. */
export function writeIncludeHeader(fmt: FormatTabular, value: boolean): void {
  try {
    localStorage.setItem(`${KEY}:${fmt}`, value ? '1' : '0');
  } catch {
    // Modo privado ou quota excedida — ignora silenciosamente.
  }
}

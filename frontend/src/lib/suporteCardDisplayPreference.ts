/**
 * Preferência do usuário: cores de status/etapa nos cards do Kanban de Suporte.
 * Independente da preferência das sprints (chaves separadas pra não acoplar).
 */
export const SHOW_COLORS_ON_SUPORTE_CARDS_KEY = 'bwa_suporte_show_card_colors_v1';

export function readShowColorsOnSuporteCards(): boolean {
  try {
    const raw = window.localStorage.getItem(SHOW_COLORS_ON_SUPORTE_CARDS_KEY);
    if (raw === 'false') return false;
    if (raw === 'true') return true;
  } catch {
    // localStorage indisponível (SSR, modo privado de Safari, etc.) — assume default.
  }
  return true;
}

export function writeShowColorsOnSuporteCards(value: boolean): void {
  try {
    window.localStorage.setItem(SHOW_COLORS_ON_SUPORTE_CARDS_KEY, value ? 'true' : 'false');
  } catch {
    // ignore
  }
}

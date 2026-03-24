/**
 * Preferência do usuário: cores de prioridade nos cards do Kanban.
 * Usada na página da sprint e na página do projeto (mesma chave = mesma escolha).
 */
export const SHOW_PRIORITY_COLORS_ON_KANBAN_CARDS_KEY = 'bwa_sprint_show_priority_card_colors_v1';

export function readShowPriorityColorsOnKanbanCards(): boolean {
  try {
    const raw = window.localStorage.getItem(SHOW_PRIORITY_COLORS_ON_KANBAN_CARDS_KEY);
    if (raw === 'false') return false;
    if (raw === 'true') return true;
  } catch {
    // ignore
  }
  return true;
}

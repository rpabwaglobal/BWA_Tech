import type { CSSProperties } from 'react';

const PRIORITY_BASE_COLORS: Record<string, string> = {
  baixa: '#acd89b',
  media: '#ffeeb0',
  alta: '#fea1a0',
  absoluta: '#888888',
};

export function getPriorityColor(prioridade: string): string {
  switch (prioridade) {
    case 'baixa':
      return 'border-l-[#acd89b] bg-[#acd89b]';
    case 'media':
      return 'border-l-[#ffeeb0] bg-[#ffeeb0]';
    case 'alta':
      return 'border-l-[#fea1a0] bg-[#fea1a0]';
    case 'absoluta':
      return 'border-l-[#888888] bg-[#888888]';
    default:
      return 'border-l-gray-300 bg-transparent';
  }
}

export function getPriorityLabel(prioridade: string): string {
  switch (prioridade) {
    case 'baixa':
      return 'Baixa';
    case 'media':
      return 'Media';
    case 'alta':
      return 'Alta';
    case 'absoluta':
      return 'Absoluta';
    default:
      return 'Media';
  }
}

export function getPriorityStyle(prioridade: string, _seed?: string): CSSProperties {
  const baseColor = PRIORITY_BASE_COLORS[prioridade];
  if (!baseColor) return {};

  return {
    backgroundColor: baseColor,
    borderLeftColor: baseColor,
    borderLeftStyle: 'solid',
  };
}

/** Texto do card com fundo de prioridade colorido: preto para contraste nos pastéis. */
export function kanbanCardInkTextClass(showPriorityColors: boolean): string {
  return showPriorityColors ? 'text-black' : 'text-[var(--color-foreground)]';
}

/**
 * Badge de área no Kanban. Com fundo pastel de prioridade, usa só o estilo claro
 * (sem `dark:`, para ficar igual ao modo claro e evitar tags escuras no tema escuro).
 */
export function getKanbanAreaBadgeClasses(area: string, onPastelPriorityBackground: boolean): string {
  switch (area) {
    case 'rpa':
    case 'automacao':
      return onPastelPriorityBackground
        ? 'bg-purple-100 text-purple-800'
        : 'bg-purple-100 text-purple-800 dark:bg-purple-950/55 dark:text-purple-100';
    case 'frontend':
      return onPastelPriorityBackground
        ? 'bg-blue-100 text-blue-800'
        : 'bg-blue-100 text-blue-800 dark:bg-blue-950/55 dark:text-blue-100';
    case 'backend':
      return onPastelPriorityBackground
        ? 'bg-green-100 text-green-800'
        : 'bg-green-100 text-green-800 dark:bg-green-950/55 dark:text-green-100';
    case 'script':
      return onPastelPriorityBackground
        ? 'bg-amber-100 text-amber-800'
        : 'bg-amber-100 text-amber-800 dark:bg-amber-950/55 dark:text-amber-100';
    default:
      return onPastelPriorityBackground
        ? 'bg-gray-100 text-gray-800'
        : 'bg-gray-100 text-gray-800 dark:bg-[var(--color-muted)] dark:text-[var(--color-foreground)]';
  }
}

/** Chips tipo / prioridade no card pastel: mesmo visual do modo claro. */
export const kanbanMutedChipOnPastelClass = 'bg-gray-100 text-gray-800';

/** Link Script no card pastel: igual ao claro. */
export const kanbanScriptLinkOnPastelClass = 'bg-blue-100 text-blue-800 hover:bg-blue-200';

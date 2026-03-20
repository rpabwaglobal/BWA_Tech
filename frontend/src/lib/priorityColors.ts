import type { CSSProperties } from 'react';

const PRIORITY_BASE_COLORS: Record<string, string> = {
  baixa: '#acd89b',
  media: '#ffeeb0',
  alta: '#fea1a0',
  absoluta: '#888888',
};

export function getPriorityGradientUrl(
  _prioridade: string,
  _variantIndex: number,
  _extension?: string
): string | null {
  // Gradientes temporariamente desabilitados.
  return null;
}

export async function preloadPriorityGradients(_options?: {
  priorities?: string[];
  variantsByPriority?: Partial<Record<string, number>>;
}): Promise<void> {
  // Sem preload enquanto gradientes estiverem desabilitados.
  return Promise.resolve();
}

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

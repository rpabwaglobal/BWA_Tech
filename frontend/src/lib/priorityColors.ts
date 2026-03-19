/**
 * Borda esquerda + fundo dos cards por prioridade.
 * Fundo baseado em imagens (01.png..08.png) em `frontend/public/gradients/<prioridade>/`.
 */
import type { CSSProperties } from 'react';

const PRIORITY_BASE_COLORS: Record<string, string> = {
  baixa: '#acd89b',
  media: '#ffeeb0',
  alta: '#fea1a0',
  absoluta: '#888888',
};

const GRADIENT_FOLDER_BY_PRIORITY: Record<string, string> = {
  baixa: 'baixa',
  media: 'media',
  alta: 'alta',
  absoluta: 'absoluta',
};

const VARIANTS_COUNT = 8;
const GRADIENT_EXTENSION = 'png';

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

function hashToUint32(input: string): number {
  // FNV-1a 32-bit
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function getPriorityStyle(prioridade: string, seed?: string): CSSProperties {
  const baseColor = PRIORITY_BASE_COLORS[prioridade];
  const folder = GRADIENT_FOLDER_BY_PRIORITY[prioridade];
  if (!baseColor || !folder) return {};

  const safeSeed = String(seed ?? prioridade);
  const variantIndex = (hashToUint32(safeSeed) % VARIANTS_COUNT) + 1; // 1..8
  const variantLabel = String(variantIndex).padStart(2, '0');

  // Pastas em public são servidas como /<path>
  const url = `/gradients/${folder}/${variantLabel}.${GRADIENT_EXTENSION}`;
  // Fallback: se a variante sorteada não existir, sempre exibir a variante 01.
  // O CSS aceita múltiplas imagens de background; se a primeira URL falhar, a próxima pode carregar.
  const fallbackUrl = `/gradients/${folder}/01.${GRADIENT_EXTENSION}`;

  return {
    backgroundColor: baseColor,
    backgroundImage: `url("${url}"), url("${fallbackUrl}")`,
    backgroundRepeat: 'no-repeat',
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    borderLeftColor: baseColor,
    borderLeftStyle: 'solid',
  };
}

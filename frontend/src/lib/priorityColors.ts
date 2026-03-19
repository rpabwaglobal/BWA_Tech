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
const preloadedGradientUrls = new Set<string>();

export function getPriorityGradientUrl(prioridade: string, variantIndex: number): string | null {
  const folder = GRADIENT_FOLDER_BY_PRIORITY[prioridade];
  if (!folder) return null;
  const variantLabel = String(variantIndex).padStart(2, '0');
  return `/gradients/${folder}/${variantLabel}.${GRADIENT_EXTENSION}`;
}

function preloadImage(url: string): Promise<void> {
  if (preloadedGradientUrls.has(url)) return Promise.resolve();

  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      preloadedGradientUrls.add(url);
      resolve();
    };
    img.onerror = () => resolve(); // silencioso para não quebrar bootstrap
    img.src = url;
  });
}

export async function preloadPriorityGradients(options?: {
  priorities?: string[];
  variantsByPriority?: Partial<Record<string, number>>;
}): Promise<void> {
  const priorities = options?.priorities ?? Object.keys(GRADIENT_FOLDER_BY_PRIORITY);
  const variantsByPriority = options?.variantsByPriority ?? {};
  const tasks: Promise<void>[] = [];

  for (const prioridade of priorities) {
    const variants = Math.max(1, variantsByPriority[prioridade] ?? VARIANTS_COUNT);
    for (let i = 1; i <= variants; i++) {
      const url = getPriorityGradientUrl(prioridade, i);
      if (url) tasks.push(preloadImage(url));
    }
  }

  await Promise.allSettled(tasks);
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

  // Pastas em public são servidas como /<path>
  const url = getPriorityGradientUrl(prioridade, variantIndex);
  // Fallback: se a variante sorteada não existir, sempre exibir a variante 01.
  // O CSS aceita múltiplas imagens de background; se a primeira URL falhar, a próxima pode carregar.
  const fallbackUrl = getPriorityGradientUrl(prioridade, 1);
  if (!url || !fallbackUrl) return {};

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

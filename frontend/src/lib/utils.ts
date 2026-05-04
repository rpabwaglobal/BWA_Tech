import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Garante que a URL tenha protocolo (http:// ou https://). Se o usuário digitar só
 * "exemplo.com", o navegador tratará como URL relativa e pode abrir como nova janela.
 * Prefixar com "https://" assegura que o link abra como URL externa em nova aba.
 */
export function normalizeExternalUrl(url: string | null | undefined): string {
  if (!url) return '';
  const trimmed = url.trim();
  if (!trimmed) return '';
  if (/^[a-z][a-z0-9+\-.]*:\/\//i.test(trimmed) || trimmed.startsWith('//')) {
    return trimmed;
  }
  return `https://${trimmed}`;
}

/** Cache client-side do catálogo de cargos e setores (cor + rótulo), para o
 * frontend usar cor/label vindos do backend em vez de mapas hard-coded.
 *
 * Populado uma vez no bootstrap (AuthContext) e re-populado quando um
 * cargo/setor é criado/editado. Os helpers têm fallback para a paleta legada
 * (`LEGACY_*`) e para cinza, então funcionam mesmo antes do cache carregar.
 */
import type { CatalogItem } from '@/services/userService';

const cargoMap = new Map<string, CatalogItem>();
const setorMap = new Map<string, CatalogItem>();

/** Paleta/rótulos legados (espelha o switch antigo de getRoleColor/Label) —
 * fallback para os 6 codenames originais quando o cache ainda não chegou. */
const LEGACY_CARGO_COR: Record<string, string> = {
  admin: '#c4b5fd', supervisor: '#93c5fd', visitante: '#9ca3af',
  gerente: '#86efac', desenvolvedor: '#fdba74', dados: '#c4b5fd', processos: '#fca5a5',
};
const LEGACY_CARGO_LABEL: Record<string, string> = {
  admin: 'Admin', supervisor: 'Super.', visitante: 'Visit.',
  gerente: 'G. Proj.', desenvolvedor: 'Dev.', dados: 'Dados', processos: 'Proc.',
};

const DEFAULT_COR = '#94a3b8';

export function setCargoCatalog(items: CatalogItem[]): void {
  cargoMap.clear();
  for (const c of items) cargoMap.set(c.codename, c);
}
export function setSetorCatalog(items: CatalogItem[]): void {
  setorMap.clear();
  for (const s of items) setorMap.set(s.codename, s);
}
export function upsertCargo(item: CatalogItem): void {
  cargoMap.set(item.codename, item);
}
export function upsertSetor(item: CatalogItem): void {
  setorMap.set(item.codename, item);
}

export function getCargoColor(codename?: string | null): string {
  if (!codename) return DEFAULT_COR;
  return cargoMap.get(codename)?.cor || LEGACY_CARGO_COR[codename] || DEFAULT_COR;
}
export function getCargoLabel(codename?: string | null): string {
  if (!codename) return '';
  const c = cargoMap.get(codename);
  return c?.label_curto || c?.nome || LEGACY_CARGO_LABEL[codename] || codename;
}
export function getSetorColor(codename?: string | null): string {
  if (!codename) return DEFAULT_COR;
  return setorMap.get(codename)?.cor || DEFAULT_COR;
}
export function getSetorLabel(codename?: string | null): string {
  if (!codename) return '';
  const s = setorMap.get(codename);
  return s?.label_curto || s?.nome || codename;
}

/** Estilo inline de badge/chip a partir de uma cor hex (usado onde antes havia
 * classe Tailwind fixa). Fundo translúcido + texto/borda na cor. */
export function chipStyle(cor: string): React.CSSProperties {
  return { backgroundColor: `${cor}20`, color: cor, borderColor: `${cor}55` };
}

/** Cache client-side do catálogo de cargos e setores (cor + rótulo), para o
 * frontend usar cor/label vindos do backend em vez de mapas hard-coded.
 *
 * Populado uma vez no bootstrap (AuthContext) e re-populado quando um
 * cargo/setor é criado/editado. Os helpers têm fallback para a paleta legada
 * (`LEGACY_*`) e para cinza, então funcionam mesmo antes do cache carregar.
 */
import type { CatalogItem, SetorDoUsuario } from '@/services/userService';

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

/** O mínimo que uma tela precisa de um usuário para desenhar os setores dele.
 * Estrutural de propósito: serve tanto para o `User` do userService quanto para
 * o do authService (o backend serializa os dois com o mesmo serializer). */
export type UsuarioComSetores = {
  setor?: string | null;
  setor_display?: string | null;
  setores?: SetorDoUsuario[] | null;
};

/** TODOS os setores da pessoa, prontos para virar tag.
 *
 * `setores` é a fonte da verdade: já vem ordenado do backend (primário na
 * frente) e carrega cor e rótulo dentro, então NÃO depende do cache acima — um
 * setor criado há dez segundos sai com a cor certa mesmo antes de o catálogo
 * ser recarregado.
 *
 * O fallback para `setor`/`setor_display` existe porque nem todo objeto de
 * usuário na tela veio de uma resposta recente (uma lista carregada antes do
 * deploy do campo, um objeto guardado em estado de página). Nesse caso mostrar
 * só o primário é melhor do que a pessoa aparecer sem setor nenhum. */
export function listarSetoresDoUsuario(
  usuario: UsuarioComSetores | null | undefined,
): SetorDoUsuario[] {
  if (!usuario) return [];
  if (usuario.setores && usuario.setores.length > 0) return usuario.setores;
  if (usuario.setor) {
    return [
      {
        codename: usuario.setor,
        nome: usuario.setor_display || getSetorLabel(usuario.setor) || usuario.setor,
        cor: getSetorColor(usuario.setor),
        label_curto: '',
        is_primary: true,
      },
    ];
  }
  return [];
}

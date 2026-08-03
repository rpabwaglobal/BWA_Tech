import api, { fetchAllPaginated } from './api';
import type { SetorBasico } from './setorSharingService';

/** Um setor do qual a pessoa faz parte, como vem em `User.setores`.
 *
 * É um superset de `SetorBasico` (o formato que o chip de compartilhamento já
 * consome), somando `label_curto` — rótulo curto para colunas estreitas, pode
 * vir "" — e `is_primary`, que marca o vínculo espelhado em `User.setor`. */
export type SetorDoUsuario = SetorBasico & {
  label_curto: string;
  is_primary: boolean;
};

export type User = {
  /** PK do user (bigint no Django). DRF serializa como número.
   * Tratado como `string | number` em comparações — SEMPRE normalize com
   * `String()` em find/get para evitar mismatches. */
  id: string | number;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  role: string;
  role_display: string;
  /** Codename do setor PRIMÁRIO ("" quando não há). Descreve UM setor — para
   * mostrar "o setor de alguém" na tela use `setores`. */
  setor?: string | null;
  /** Rótulo do setor primário. Mesma ressalva de `setor`. */
  setor_display?: string | null;
  /** TODOS os setores da pessoa. Vem ordenado do backend (o primário primeiro,
   * o resto em ordem alfabética), então dá para renderizar na ordem recebida.
   * No máximo um item com `is_primary` — e pode não haver nenhum, quando o
   * operador limpou o setor primário. Quem não tem setor real fica no balde
   * "sem_setor", que nunca aparece junto de outro setor. */
  setores?: SetorDoUsuario[];
  /** Somente leitura — editar via `userService.setActive`. */
  is_active?: boolean;
  /** Codenames das permissões granulares atribuídas ao usuário. */
  permissions?: string[];
  profile_picture_url?: string | null;
  date_joined?: string;
};

export type PermissionCatalogEntry = {
  codename: string;
  name: string;
  area: string;
};

/** Item do catálogo de Cargo ou Setor — `is_system` marca os itens
 * originais (protegidos); os demais foram criados por admin/supervisor. */
export type CatalogItem = {
  id: string | number;
  codename: string;
  nome: string;
  is_system: boolean;
  cor?: string;
  label_curto?: string;
  descricao?: string;
  /** Só em cargos: template de permissões-padrão (codenames). */
  permissoes_padrao?: string[];
  user_count?: number;
};

/** O que a atribuição em massa efetivamente moveu. As chaves só vêm quando o
 * tipo entrou na operação — daí serem todas opcionais. */
export type AtribuicaoDeDados = {
  sprints?: number;
  projetos?: number;
  cards?: number;
  compartilhamentos_redundantes_removidos?: number;
};

/** Alvo da atribuição: sprints e/ou projetos, ou o atalho `todos`. Não existe
 * `card_ids` — o setor do card é espelho do projeto. */
export type AtribuirDadosInput = {
  sprint_ids?: (string | number)[];
  project_ids?: (string | number)[];
  todos?: boolean;
};

export type AtribuirDadosResult = {
  /** Codename do setor de destino. */
  setor: string;
  atribuidos: AtribuicaoDeDados;
};

/** Payload de criação/edição de cargo ou setor. */
export type CatalogItemInput = {
  nome?: string;
  cor?: string;
  label_curto?: string;
  descricao?: string;
  permissoes_padrao?: string[];
};

export const userService = {
  async getAll(): Promise<User[]> {
    return fetchAllPaginated<User>('/users/');
  },

  async getDevelopers(): Promise<User[]> {
    return fetchAllPaginated<User>('/users/?role=desenvolvedor');
  },

  async getById(id: string): Promise<User> {
    const response = await api.get(`/users/${id}/`);
    return response.data;
  },

  async update(id: string, data: Partial<User>): Promise<User> {
    const response = await api.patch(`/users/${id}/`, data);
    return response.data;
  },

  /** Todos os usuários (inclusive admins) — só admin/supervisor acessam.
   * Usado na tela de Gerenciamento de Usuários. */
  async getAllManagement(search?: string): Promise<User[]> {
    const qs = search ? `?search=${encodeURIComponent(search)}` : '';
    return fetchAllPaginated<User>(`/users/all/${qs}`);
  },

  async getPermissionsCatalog(): Promise<PermissionCatalogEntry[]> {
    const response = await api.get('/users/permissions-catalog/');
    return response.data;
  },

  /** Substitui o conjunto de permissões granulares do usuário-alvo. */
  async setPermissions(id: string | number, codenames: string[]): Promise<User> {
    const response = await api.post(`/users/${id}/set-permissions/`, { codenames });
    return response.data;
  },

  /** Ativa/desativa o usuário-alvo (revoga tokens ao desativar). */
  async setActive(id: string | number, is_active: boolean): Promise<User> {
    const response = await api.post(`/users/${id}/set-active/`, { is_active });
    return response.data;
  },

  /** Redefine a senha do usuário-alvo e encerra as sessões dele. Omitindo
   * `newPassword`, o backend sorteia uma senha forte e a devolve em
   * `senha_gerada` — é a única vez que ela trafega, não há como relê-la. */
  async resetPassword(
    id: string | number,
    newPassword?: string,
  ): Promise<{ detail: string; senha_gerada?: string }> {
    const payload = newPassword ? { new_password: newPassword } : {};
    const response = await api.post(`/users/${id}/reset-password/`, payload);
    return response.data;
  },

  /** Catálogo de cargos atribuíveis — qualquer autenticado lê. */
  async getCargos(): Promise<CatalogItem[]> {
    return fetchAllPaginated<CatalogItem>('/cargos/');
  },

  /** Cria um novo cargo (admin/supervisor). Aceita nome + cor/rótulo. */
  async createCargo(data: CatalogItemInput): Promise<CatalogItem> {
    const response = await api.post('/cargos/', data);
    return response.data;
  },

  async updateCargo(id: string | number, data: CatalogItemInput): Promise<CatalogItem> {
    const response = await api.patch(`/cargos/${id}/`, data);
    return response.data;
  },

  async deleteCargo(id: string | number): Promise<void> {
    await api.delete(`/cargos/${id}/`);
  },

  /** Catálogo de setores atribuíveis — qualquer autenticado lê. */
  async getSetores(): Promise<CatalogItem[]> {
    return fetchAllPaginated<CatalogItem>('/setores/');
  },

  /** Cria um novo setor (admin/supervisor). */
  async createSetor(data: CatalogItemInput): Promise<CatalogItem> {
    const response = await api.post('/setores/', data);
    return response.data;
  },

  async updateSetor(id: string | number, data: CatalogItemInput): Promise<CatalogItem> {
    const response = await api.patch(`/setores/${id}/`, data);
    return response.data;
  },

  async deleteSetor(id: string | number): Promise<void> {
    await api.delete(`/setores/${id}/`);
  },

  /** Move sprints/projetos para este setor (exige `manage_setores`).
   *
   * A operação é transacional e desce a árvore: a sprint arrasta os projetos e
   * os cards dela, o projeto arrasta os cards dele. `todos: true` recolhe o que
   * ainda está no setor padrão do sistema ("Sem Setor").
   *
   * Responde 409 quando a mudança deixaria duas sprints em andamento ao mesmo
   * tempo no destino — a mensagem vem em `detail` e precisa chegar ao usuário.
   */
  async atribuirDados(
    id: string | number,
    data: AtribuirDadosInput,
  ): Promise<AtribuirDadosResult> {
    const response = await api.post(`/setores/${id}/atribuir-dados/`, data);
    return response.data;
  },

  // ---- Atribuição em massa -----------------------------------------------
  async bulkAssignCargo(userIds: (string | number)[], cargoCodename: string, applyTemplate = false) {
    const response = await api.post('/users/bulk-assign-cargo/', {
      user_ids: userIds, cargo_codename: cargoCodename, apply_template: applyTemplate,
    });
    return response.data as { updated: number; skipped: { id: number; motivo: string }[] };
  },

  async bulkAssignSetor(userIds: (string | number)[], setorCodename: string) {
    const response = await api.post('/users/bulk-assign-setor/', {
      user_ids: userIds, setor_codename: setorCodename,
    });
    return response.data as { updated: number; skipped: { id: number; motivo: string }[] };
  },

  async bulkSetPermissions(userIds: (string | number)[], codenames: string[], mode: 'set' | 'add' | 'remove') {
    const response = await api.post('/users/bulk-set-permissions/', {
      user_ids: userIds, codenames, mode,
    });
    return response.data as { updated: number; skipped: { id: number; motivo: string }[] };
  },
};

import api, { fetchAllPaginated } from './api';

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
  setor?: string | null;
  setor_display?: string | null;
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

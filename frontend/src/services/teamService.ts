/**
 * @deprecated Fase 6 — o organograma (ReactFlow + hierarquia Supervisor→Gerente→Dev)
 * foi substituído pelo mural read-only por setor em `pages/People.tsx`. Nenhum
 * componente consome mais este serviço. Mantido apenas como referência até o app
 * backend `teams` ser removido (migração de drop planejada). NÃO USAR em código novo —
 * a organização da equipe agora é por setor (SetorCatalogo / UserSetor).
 */
import api from './api';

export type Team = {
  id: string;
  nome: string;
  tipo: string;
  tipo_display?: string;
  supervisor: string;
  supervisor_name?: string;
  cor?: string;
  posicao_x?: number;
  posicao_y?: number;
  largura?: number;
  altura?: number;
  ordem?: number;
  created_at?: string;
  updated_at?: string;
};

export type TeamMember = {
  id: string;
  user: string;
  user_detail?: {
    id: string;
    username: string;
    email: string;
    first_name: string;
    last_name: string;
    role: string;
    role_display: string;
  };
  team: string;
  team_detail?: Team;
  role: string;
  role_display?: string;
  created_at?: string;
};

export type Hierarchy = {
  id: string;
  supervisor: string;
  supervisor_name?: string;
  gerente?: string | null;
  gerente_name?: string;
  desenvolvedor?: string | null;
  desenvolvedor_name?: string;
  created_at?: string;
};

export type NodePosition = {
  id: string;
  user: string;
  user_detail?: {
    id: string;
    username: string;
    email: string;
    first_name: string;
    last_name: string;
    role: string;
  };
  x: number;
  y: number;
  updated_at?: string;
};

type PaginatedResponse<T> = {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
};

export const teamService = {
  async getAll(): Promise<Team[]> {
    const response = await api.get<PaginatedResponse<Team> | Team[]>('/teams/');
    if (Array.isArray(response.data)) {
      return response.data;
    }
    return response.data.results || [];
  },

  async getById(id: string): Promise<Team> {
    const response = await api.get(`/teams/${id}/`);
    return response.data;
  },

  async create(data: { nome: string; tipo?: string; supervisor: string; cor?: string; posicao_x?: number; posicao_y?: number; largura?: number; altura?: number; ordem?: number }): Promise<Team> {
    const response = await api.post('/teams/', data);
    return response.data;
  },

  async update(id: string, data: Partial<Team>): Promise<Team> {
    const response = await api.patch(`/teams/${id}/`, data);
    return response.data;
  },

  async delete(id: string): Promise<void> {
    await api.delete(`/teams/${id}/`);
  },
};

export const teamMemberService = {
  async getAll(): Promise<TeamMember[]> {
    const response = await api.get<PaginatedResponse<TeamMember> | TeamMember[]>('/team-members/');
    if (Array.isArray(response.data)) {
      return response.data;
    }
    return response.data.results || [];
  },
};

export const hierarchyService = {
  async getAll(): Promise<Hierarchy[]> {
    const response = await api.get<PaginatedResponse<Hierarchy> | Hierarchy[]>('/hierarchies/');
    if (Array.isArray(response.data)) {
      return response.data;
    }
    return response.data.results || [];
  },

  async create(data: { supervisor: string; gerente?: string | null; desenvolvedor?: string | null }): Promise<Hierarchy> {
    const response = await api.post('/hierarchies/', data);
    return response.data;
  },

  async update(id: string, data: Partial<Hierarchy>): Promise<Hierarchy> {
    const response = await api.patch(`/hierarchies/${id}/`, data);
    return response.data;
  },

  async delete(id: string): Promise<void> {
    await api.delete(`/hierarchies/${id}/`);
  },
};

export const nodePositionService = {
  async getAll(): Promise<NodePosition[]> {
    const response = await api.get<NodePosition[]>('/node-positions/bulk/');
    return response.data;
  },

  async createOrUpdate(data: { user: string; x: number; y: number }): Promise<NodePosition> {
    const response = await api.post('/node-positions/', data);
    return response.data;
  },

  async update(id: string, data: Partial<NodePosition>): Promise<NodePosition> {
    const response = await api.patch(`/node-positions/${id}/`, data);
    return response.data;
  },
};

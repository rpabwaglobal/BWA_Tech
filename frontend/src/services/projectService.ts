import api from './api';

export type Project = {
  id: string; // UUID
  nome: string;
  descricao: string;
  sprint: string; // UUID
  sprint_name?: string;
  gerente_atribuido?: string | null; // UUID
  gerente_name?: string;
  desenvolvedor?: string | null; // UUID
  desenvolvedor_name?: string;
  status: string;
  status_display?: string;
  data_criacao?: string;
  data_avaliacao?: string | null;
  data_atribuicao_gerente?: string | null;
  data_inicio_desenvolvimento?: string | null;
  data_entrega?: string | null;
  data_homologacao?: string | null;
  data_adiamento_solicitada?: string | null;
  nova_data_prevista?: string | null;
  adiamento_aprovado?: boolean;
  cards_count?: number;
  cards_entregues_count?: number;
  cards_em_desenvolvimento_count?: number;
  created_at?: string;
  updated_at?: string;
};

export type ProjectCreate = {
  nome: string;
  descricao?: string;
  sprint: string; // UUID
  gerente_atribuido?: string | null; // UUID
  desenvolvedor?: string | null; // UUID
  status?: string;
};

// Tipo para resposta paginada
type PaginatedResponse<T> = {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
};

export const projectService = {
  async getAll(): Promise<Project[]> {
    const response = await api.get<PaginatedResponse<Project> | Project[]>('/projects/');
    // Verifica se é paginado ou array direto
    if (Array.isArray(response.data)) {
      return response.data;
    }
    return response.data.results || [];
  },

  async getById(id: string): Promise<Project> {
    const response = await api.get(`/projects/${id}/`);
    return response.data;
  },

  async create(data: ProjectCreate): Promise<Project> {
    const response = await api.post('/projects/', data);
    return response.data;
  },

  async update(id: string, data: Partial<ProjectCreate>): Promise<Project> {
    const response = await api.patch(`/projects/${id}/`, data);
    return response.data;
  },

  async delete(id: string): Promise<void> {
    await api.delete(`/projects/${id}/`);
  },

  async getKanbanConfig(projectId: string): Promise<{ project: string; stages: any[] }> {
    const response = await api.get(`/projects/${projectId}/kanban-config/`);
    return response.data;
  },

  async updateKanbanConfigReorder(
    projectId: string,
    stageKeysOrder: string[],
  ): Promise<{ detail?: string }> {
    const response = await api.post(`/projects/${projectId}/kanban-config/reorder/`, {
      stage_keys_order: stageKeysOrder,
    });
    return response.data;
  },

  async addKanbanStage(projectId: string, stageKey: string): Promise<{ detail?: string }> {
    const response = await api.post(`/projects/${projectId}/kanban-config/add/`, { stage_key: stageKey });
    return response.data;
  },

  async removeKanbanStage(
    projectId: string,
    stageKey: string,
    moveToKey?: string,
  ): Promise<any> {
    const payload: any = { stage_key: stageKey };
    if (moveToKey) payload.move_to_key = moveToKey;
    const response = await api.post(`/projects/${projectId}/kanban-config/remove/`, payload);
    return response.data;
  },

  async moveKanbanCards(
    projectId: string,
    fromStageKey: string,
    toStageKey: string,
  ): Promise<any> {
    const response = await api.post(`/projects/${projectId}/kanban-config/move-cards/`, {
      from_stage_key: fromStageKey,
      to_stage_key: toStageKey,
    });
    return response.data;
  },
};

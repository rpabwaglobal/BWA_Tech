import api from './api';

export type Sprint = {
  id: string; // UUID
  nome: string;
  data_inicio: string;
  data_fim: string;
  duracao_dias: number;
  supervisor: string; // UUID
  supervisor_name?: string;
  projects_count?: number;
  cards_total?: number;
  cards_finalizados?: number;
  cards_em_andamento?: number;
  cards_em_atraso?: number;
  finalizada?: boolean;
  created_at?: string;
  updated_at?: string;
};

export type SprintFinalizarResponse = {
  detail: string;
  ja_finalizada?: boolean;
  proxima_sprint_id?: string;
  proxima_sprint_nome?: string;
  projetos_criados?: number;
  cards_copiados?: number;
};

export type SprintCreate = {
  nome: string;
  data_inicio: string;
  data_fim: string;
  duracao_dias: number;
  supervisor: string; // UUID
};

// Tipo para resposta paginada
type PaginatedResponse<T> = {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
};

export const sprintService = {
  async getAll(): Promise<Sprint[]> {
    const response = await api.get<PaginatedResponse<Sprint> | Sprint[]>('/sprints/');
    // Verifica se é paginado ou array direto
    if (Array.isArray(response.data)) {
      return response.data;
    }
    return response.data.results || [];
  },

  async getById(id: string): Promise<Sprint> {
    const response = await api.get(`/sprints/${id}/`);
    return response.data;
  },

  async create(data: SprintCreate): Promise<Sprint> {
    const response = await api.post('/sprints/', data);
    return response.data;
  },

  async update(id: string, data: Partial<SprintCreate>): Promise<Sprint> {
    const response = await api.patch(`/sprints/${id}/`, data);
    return response.data;
  },

  async delete(id: string): Promise<void> {
    await api.delete(`/sprints/${id}/`);
  },

  async finalizar(id: string): Promise<SprintFinalizarResponse> {
    const response = await api.post<SprintFinalizarResponse>(`/sprints/${id}/finalizar/`);
    return response.data;
  },
};

import api from './api';

export type KanbanStage = {
  id: number;
  key: string;
  label: string;
  is_terminal: boolean;
  requires_required_data: boolean;
};

export const kanbanStageService = {
  async getAll(): Promise<KanbanStage[]> {
    const response = await api.get('/kanban-stages/');
    const data = response.data;

    // Dependendo de paginação DRF, pode vir como array ou como { results: [...] }
    if (Array.isArray(data)) return data as KanbanStage[];
    if (data && Array.isArray(data.results)) return data.results as KanbanStage[];

    return [];
  },

  async create(data: { label: string; is_terminal?: boolean; requires_required_data?: boolean }): Promise<KanbanStage> {
    const response = await api.post('/kanban-stages/', data);
    return response.data;
  },
};


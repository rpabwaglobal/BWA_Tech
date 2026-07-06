import api from './api';

export type WeeklyPriority = {
  id: string;
  usuario: string;
  usuario_name?: string;
  card: string;
  card_detail?: any;
  semana_inicio: string;
  semana_fim: string;
  definido_por?: string;
  definido_por_name?: string;
  is_concluido: boolean;
  is_atrasado: boolean;
  created_at?: string;
  updated_at?: string;
};

export type WeeklyPriorityConfig = {
  id: string;
  horario_limite: string; // HH:MM:SS
  fechamento_automatico?: boolean;
  semana_fechada?: { [key: string]: boolean }; // Dicionário de semanas fechadas
  created_at?: string;
  updated_at?: string;
};

export const weeklyPriorityService = {
  async getAll(params?: { semana?: string }): Promise<WeeklyPriority[]> {
    const response = await api.get('/weekly-priorities/', { params });
    return response.data.results || response.data || [];
  },

  async getById(id: string): Promise<WeeklyPriority> {
    const response = await api.get(`/weekly-priorities/${id}/`);
    return response.data;
  },

  async create(data: {
    usuario: string;
    card: string;
    semana_inicio: string;
    semana_fim: string;
  }): Promise<WeeklyPriority> {
    const response = await api.post('/weekly-priorities/', data);
    return response.data;
  },

  async update(id: string, data: {
    usuario?: string;
    card?: string;
    semana_inicio?: string;
    semana_fim?: string;
  }): Promise<WeeklyPriority> {
    const response = await api.patch(`/weekly-priorities/${id}/`, data);
    return response.data;
  },

  async delete(id: string): Promise<void> {
    await api.delete(`/weekly-priorities/${id}/`);
  },

  async getCurrentWeek(): Promise<WeeklyPriority[]> {
    const response = await api.get('/weekly-priorities/current_week/');
    return response.data || [];
  },

  async getPrioritiesView(): Promise<{ semana_fechada: boolean; semana_inicio: string; data: any[] }> {
    const response = await api.get('/weekly-priorities/priorities_view/');
    return response.data || { semana_fechada: false, semana_inicio: '', data: [] };
  },

  async getDefinePriorityOptions(usuarioId: string): Promise<{
    available_cards: Array<{
      id: string;
      nome: string;
      status: string;
      status_display?: string;
      projeto?: number;
      projeto_detail?: { id: number; nome: string };
      responsavel?: string | null;
    }>;
    selected_card_ids: string[];
    semana_inicio: string;
  }> {
    const response = await api.get('/weekly-priorities/define_priority_options/', {
      params: { usuario: usuarioId },
    });
    return response.data;
  },

  async closeWeek(): Promise<{ message: string; semana_inicio: string; semana_fechada: boolean }> {
    const response = await api.post('/weekly-priority-config/close-week/');
    return response.data;
  },

  async clearPriorities(): Promise<{ message: string; count: number }> {
    const response = await api.post('/weekly-priority-config/clear-priorities/');
    return response.data;
  },

  async getConfig(): Promise<WeeklyPriorityConfig> {
    const response = await api.get('/weekly-priority-config/');
    return Array.isArray(response.data) ? response.data[0] : response.data;
  },

  async updateConfig(data: { horario_limite: string; fechamento_automatico?: boolean }): Promise<WeeklyPriorityConfig> {
    const config = await this.getConfig();
    const response = await api.patch(`/weekly-priority-config/${config.id}/`, data);
    return response.data;
  },
};

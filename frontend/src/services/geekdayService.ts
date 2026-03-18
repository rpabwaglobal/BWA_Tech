import api from './api';

export type GeekDayUserStatus = {
  id: string;
  username: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  role: string;  // Adicionar role para cores na roleta
  profile_picture_url: string | null;
  ja_sorteado: boolean;
  total_sorteios: number;
  ultimo_sorteio: string | null;
};

export type GeekDayDraw = {
  id: number;
  usuario: string | number; // Pode ser string (UUID) ou number (ID)
  usuario_name: string;
  usuario_profile_picture: string | null;
  sorteado_por: string | null;
  sorteado_por_name: string | null;
  data_sorteio: string;
  data_apresentacao?: string | null; // YYYY-MM-DD
  marcado_manual: boolean;
  observacoes: string | null;
  cycle?: number;
};

export const geekdayService = {
  async getUsersStatus(): Promise<GeekDayUserStatus[]> {
    const response = await api.get<GeekDayUserStatus[]>('/geekday-draws/users_status/');
    return response.data;
  },

  async realizarSorteio(): Promise<GeekDayDraw> {
    const response = await api.post<GeekDayDraw>('/geekday-draws/realizar_sorteio/');
    return response.data;
  },

  async marcarComoSorteado(usuarioId: string, observacoes?: string, dataApresentacao?: string | null): Promise<GeekDayDraw> {
    const response = await api.post<GeekDayDraw>('/geekday-draws/marcar_como_sorteado/', {
      usuario_id: usuarioId,
      observacoes: observacoes || '',
      data_apresentacao: dataApresentacao || null,
    });
    return response.data;
  },

  async desmarcarComoSorteado(usuarioId: string): Promise<{ message: string; usuario_id: string }> {
    const response = await api.post<{ message: string; usuario_id: string }>('/geekday-draws/desmarcar_como_sorteado/', {
      usuario_id: usuarioId,
    });
    return response.data;
  },

  async resetarSorteios(): Promise<{ message: string; cycle: number }> {
    const response = await api.post<{ message: string; cycle: number }>('/geekday-draws/resetar_sorteios/');
    return response.data;
  },

  async getHistorico(): Promise<GeekDayDraw[]> {
    const response = await api.get<GeekDayDraw[]>('/geekday-draws/historico/');
    return response.data;
  },
};

import api from './api';

export type SuporteTimelineEntry = {
  id: number;
  chamado_id: number;
  tipo_evento: string;
  tipo_evento_display?: string;
  descricao: string;
  usuario?: string | null;
  usuario_name?: string;
  usuario_role_display?: string | null;
  data: string;
};

/** Tipos aceitos pelo POST `/formularios/suporte-timeline/` */
export type SuporteTimelineEventTipo =
  | 'criado'
  | 'etapa_alterada'
  | 'responsavel_alterado'
  | 'notificacao'
  | 'pendencia'
  | 'comentario';

export const suporteTimelineService = {
  async listByChamado(chamadoId: number): Promise<SuporteTimelineEntry[]> {
    const { data } = await api.get<SuporteTimelineEntry[]>(
      `/formularios/suporte-timeline/?chamado_id=${encodeURIComponent(String(chamadoId))}`,
    );
    return Array.isArray(data) ? data : [];
  },

  async create(payload: {
    chamado_id: number;
    descricao: string;
    tipo_evento?: SuporteTimelineEventTipo;
  }): Promise<SuporteTimelineEntry> {
    const { data } = await api.post<SuporteTimelineEntry>('/formularios/suporte-timeline/', payload);
    return data;
  },
};

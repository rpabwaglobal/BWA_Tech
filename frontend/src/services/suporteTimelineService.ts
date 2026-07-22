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

  /**
   * Data em que cada chamado mudou de etapa pela última vez, segundo a
   * timeline local — sempre gravada no BWA, mesmo com o chamado em si vindo
   * do portal externo (modo proxy). Use isto para calcular SLA/tempo de
   * resolução: `chamado.data_atualizacao` é reescrito por QUALQUER save
   * (ex.: mover entre tabs, o proxy do portal retocando o registro), sem
   * relação alguma com a conclusão de fato do ticket.
   * Chamados sem nenhuma troca de etapa registrada não aparecem no mapa —
   * o caller decide o fallback (ex.: `data_atualizacao`).
   */
  async getResolvidoEmMap(chamadoIds: number[]): Promise<Record<number, string>> {
    const ids = [...new Set(chamadoIds)].filter((id) => Number.isFinite(id));
    if (ids.length === 0) return {};
    const { data } = await api.get<Record<string, string>>(
      `/formularios/suporte-timeline/resolvido-em/?chamado_ids=${ids.join(',')}`,
    );
    const result: Record<number, string> = {};
    for (const [id, iso] of Object.entries(data)) {
      result[Number(id)] = iso;
    }
    return result;
  },
};

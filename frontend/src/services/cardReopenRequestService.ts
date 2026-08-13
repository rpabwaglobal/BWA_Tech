import api from './api';
import type { Card } from './cardService';

/**
 * Solicitação de reabertura de card fechado.
 *
 * Espelha `CardDueDateChangeRequest` de propósito: o backend devolve a MESMA
 * forma de objeto nas duas filas, então a aba de pendências renderiza as duas
 * com a mesma estrutura de tela. A única diferença de contrato é o campo da
 * data: aqui ele se chama `nova_data_entrega` (lá, `requested_date`) e é
 * OBRIGATÓRIO — sem prazo o card voltaria ao quadro invisível para alerta de
 * atraso e para as métricas de entrega no prazo.
 */
export type CardReopenRequest = {
  id: number;
  /** UUID do card (o backend aceita o id como veio na listagem de cards). */
  card: string;
  card_detail?: Card;
  requested_by: string;
  requested_by_name?: string | null;
  /** ISO datetime: prazo que o card passa a ter quando a reabertura for aprovada. */
  nova_data_entrega: string;
  reason?: string | null;
  status: 'pending' | 'approved' | 'rejected';
  status_display?: string;
  reviewed_by?: string | null;
  reviewed_by_name?: string | null;
  reviewed_at?: string | null;
  created_at?: string;
  updated_at?: string;
};

type PaginatedResponse<T> = {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
};

/**
 * O `next` da DRF vem absoluto (http://host/api/...), mas o axios já tem
 * `/api` no baseURL — repassar o link cru duplicaria o prefixo. Mesma
 * normalização usada no serviço de solicitação de data.
 */
function nextPathFromDrf(next: string): string {
  let path: string;
  try {
    const url = new URL(next);
    path = url.pathname + url.search;
  } catch {
    path = next.startsWith('/') ? next : next.replace(/^https?:\/\/[^/]+/, '');
  }
  if (path.startsWith('/api/')) path = path.substring(4);
  return path;
}

export const cardReopenRequestService = {
  async create(data: {
    card: string;
    nova_data_entrega: string;
    reason?: string | null;
  }): Promise<CardReopenRequest> {
    const response = await api.post<CardReopenRequest>('/card-reopen-requests/', data);
    return response.data;
  },

  /**
   * Busca a fila inteira seguindo a paginação (PAGE_SIZE=20 e sem `page_size`
   * no backend, então varrer as páginas é a única forma de ter a contagem real
   * exibida na aba).
   */
  async list(params?: { status?: string; card?: string; ordering?: string }): Promise<CardReopenRequest[]> {
    const query = new URLSearchParams();
    if (params?.status) query.set('status', params.status);
    if (params?.card) query.set('card', params.card);
    if (params?.ordering) query.set('ordering', params.ordering);

    const qs = query.toString();
    let nextUrl: string | null = `/card-reopen-requests/${qs ? `?${qs}` : ''}`;
    const all: CardReopenRequest[] = [];

    while (nextUrl) {
      const response = await api.get<PaginatedResponse<CardReopenRequest> | CardReopenRequest[]>(nextUrl);
      if (Array.isArray(response.data)) return response.data;

      const paginated = response.data as PaginatedResponse<CardReopenRequest>;
      all.push(...(paginated.results || []));
      nextUrl = paginated.next ? nextPathFromDrf(paginated.next) : null;
    }

    return all;
  },

  async approve(id: number): Promise<CardReopenRequest> {
    const response = await api.post<CardReopenRequest>(`/card-reopen-requests/${id}/approve/`);
    return response.data;
  },

  async reject(id: number): Promise<CardReopenRequest> {
    const response = await api.post<CardReopenRequest>(`/card-reopen-requests/${id}/reject/`);
    return response.data;
  },
};

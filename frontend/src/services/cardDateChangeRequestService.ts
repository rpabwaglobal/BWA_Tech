import api from './api';
import type { Card } from './cardService';

export type CardDueDateChangeRequest = {
  id: number;
  card: string;
  card_detail?: Card;
  requested_by: string;
  requested_by_name?: string | null;
  requested_date: string; // ISO / datetime (nova data e hora de entrega)
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

export const cardDateChangeRequestService = {
  async create(data: { card: string; requested_date: string; reason?: string | null }): Promise<CardDueDateChangeRequest> {
    const response = await api.post<CardDueDateChangeRequest>('/card-date-change-requests/', data);
    return response.data;
  },

  async list(params?: { status?: string }): Promise<CardDueDateChangeRequest[]> {
    const all: CardDueDateChangeRequest[] = [];
    let nextUrl: string | null = '/card-date-change-requests/';
    if (params?.status) nextUrl += `?status=${encodeURIComponent(params.status)}`;

    while (nextUrl) {
      const response = await api.get<PaginatedResponse<CardDueDateChangeRequest> | CardDueDateChangeRequest[]>(nextUrl);
      if (Array.isArray(response.data)) return response.data;
      const paginated = response.data as PaginatedResponse<CardDueDateChangeRequest>;
      all.push(...(paginated.results || []));

      if (paginated.next) {
        try {
          const url = new URL(paginated.next);
          let path = url.pathname + url.search;
          if (path.startsWith('/api/')) path = path.substring(4);
          nextUrl = path;
        } catch {
          let path = paginated.next.startsWith('/')
            ? paginated.next
            : paginated.next.replace(/^https?:\/\/[^/]+/, '');
          if (path.startsWith('/api/')) path = path.substring(4);
          nextUrl = path;
        }
      } else {
        nextUrl = null;
      }
    }

    return all;
  },

  async approve(id: number): Promise<CardDueDateChangeRequest> {
    const response = await api.post<CardDueDateChangeRequest>(`/card-date-change-requests/${id}/approve/`);
    return response.data;
  },

  async reject(id: number): Promise<CardDueDateChangeRequest> {
    const response = await api.post<CardDueDateChangeRequest>(`/card-date-change-requests/${id}/reject/`);
    return response.data;
  },
};


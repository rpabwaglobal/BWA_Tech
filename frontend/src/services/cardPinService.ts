import api from './api';
import type { Card } from './cardService';

export type CardPin = {
  id: number;
  card: string;
  card_detail: Card;
  created_at: string;
};

type PaginatedResponse<T> = {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
};

function unwrap<T>(data: PaginatedResponse<T> | T[]): T[] {
  if (Array.isArray(data)) return data;
  return data.results || [];
}

export const cardPinService = {
  async list(): Promise<CardPin[]> {
    const response = await api.get<PaginatedResponse<CardPin> | CardPin[]>('/card-pins/');
    return unwrap<CardPin>(response.data);
  },

  async pin(cardId: string): Promise<CardPin> {
    const response = await api.post<CardPin>('/card-pins/', { card: cardId });
    return response.data;
  },

  async unpin(cardId: string): Promise<void> {
    await api.delete(`/card-pins/by-card/${cardId}/`);
  },
};

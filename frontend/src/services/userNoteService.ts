import api from './api';

// Paleta inspirada em papéis Color Plus / Sirio Color.
// default = sem cor (fundo do tema)
export type UserNoteColor =
  | 'default'
  | 'lilas'   // Color Plus San Francisco
  | 'rosa'    // Color Plus Verona
  | 'verde'   // Color Plus Tahiti
  | 'azul'    // Sirio Color Celeste
  | 'bege';   // Sirio Paglierino

/** Bloco do conteúdo de uma nota. Pode ser parágrafo de texto ou item de
 * checklist; a ordem é dada por `order`. */
export type UserNoteItemKind = 'text' | 'todo';

export type UserNoteItem = {
  id?: number;
  kind: UserNoteItemKind;
  text: string;
  /** Só relevante quando kind='todo'. */
  done: boolean;
  order: number;
};

export type UserNote = {
  id: number;
  user: number;
  title: string;
  color: UserNoteColor;
  pinned: boolean;
  archived: boolean;
  order: number;
  items: UserNoteItem[];
  created_at: string;
  updated_at: string;
};

export type UserNoteCreate = {
  title?: string;
  color?: UserNoteColor;
  pinned?: boolean;
  archived?: boolean;
  order?: number;
  items?: Array<Omit<UserNoteItem, 'id'> & { id?: number }>;
};

export type UserNoteUpdate = Partial<UserNoteCreate>;

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

export const userNoteService = {
  async list(): Promise<UserNote[]> {
    const response = await api.get<PaginatedResponse<UserNote> | UserNote[]>('/notes/');
    return unwrap<UserNote>(response.data);
  },

  async create(data: UserNoteCreate): Promise<UserNote> {
    const response = await api.post<UserNote>('/notes/', data);
    return response.data;
  },

  async update(id: number, data: UserNoteUpdate): Promise<UserNote> {
    const response = await api.patch<UserNote>(`/notes/${id}/`, data);
    return response.data;
  },

  async delete(id: number): Promise<void> {
    await api.delete(`/notes/${id}/`);
  },
};

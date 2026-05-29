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
  /** PK do item-pai (para indentação tipo árvore). null = raiz.
   *  Read-only: o cliente referencia pais via parent_client_id no payload de
   *  escrita; o backend devolve o `parent` resolvido. */
  parent?: number | null;
};

/** Item enviado ao backend (POST/PATCH). `client_id` e `parent_client_id`
 *  permitem referências cruzadas entre items recém-criados no mesmo payload
 *  (já que IDs reais só nascem após persistir). */
export type UserNoteItemInput = Omit<UserNoteItem, 'id' | 'parent'> & {
  /** ID temporário (qualquer string única) usado pra ser referenciado por
   *  outros itens do mesmo payload via `parent_client_id`. */
  client_id?: string;
  /** Referência ao `client_id` de outro item da mesma payload. */
  parent_client_id?: string | null;
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
  items?: UserNoteItemInput[];
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

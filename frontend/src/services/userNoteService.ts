import api from './api';

export type UserNoteColor =
  | 'default'
  | 'red'
  | 'orange'
  | 'yellow'
  | 'green'
  | 'teal'
  | 'blue'
  | 'purple'
  | 'pink'
  | 'gray';

export type UserNoteTodo = {
  id?: number;
  label: string;
  done: boolean;
  order: number;
};

export type UserNote = {
  id: number;
  user: number;
  title: string;
  body: string;
  color: UserNoteColor;
  pinned: boolean;
  archived: boolean;
  order: number;
  todos: UserNoteTodo[];
  created_at: string;
  updated_at: string;
};

export type UserNoteCreate = {
  title?: string;
  body?: string;
  color?: UserNoteColor;
  pinned?: boolean;
  archived?: boolean;
  order?: number;
  todos?: Array<Omit<UserNoteTodo, 'id'> & { id?: number }>;
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

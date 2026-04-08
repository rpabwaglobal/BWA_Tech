import api, { fetchAllPaginated } from './api';

export type User = {
  id: string; // UUID
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  role: string;
  role_display: string;
  profile_picture_url?: string | null;
  date_joined?: string;
};

export const userService = {
  async getAll(): Promise<User[]> {
    return fetchAllPaginated<User>('/users/');
  },

  async getDevelopers(): Promise<User[]> {
    return fetchAllPaginated<User>('/users/?role=desenvolvedor');
  },

  async getById(id: string): Promise<User> {
    const response = await api.get(`/users/${id}/`);
    return response.data;
  },

  async update(id: string, data: Partial<User>): Promise<User> {
    const response = await api.patch(`/users/${id}/`, data);
    return response.data;
  },
};

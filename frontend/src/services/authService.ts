import api from './api';

export type User = {
  id: string; // UUID
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  role: string;
  role_display: string;
  profile_picture_url?: string | null;
  date_joined: string;
}

export type LoginData = {
  email: string;
  password: string;
}

export type RegisterData = {
  first_name: string;
  username: string;
  email: string;
  password: string;
  profile_picture?: File | null;
}

export type LoginResponse = {
  user: User;
  token: string;
  /** ISO timestamp do momento em que o token expira (fonte da verdade: servidor). */
  expires_at?: string;
  message: string;
}

export type RegisterResponse = LoginResponse & {
  recovery_code: string;
}

/** Fallback: 24h a partir de Date.now() caso o servidor não envie `expires_at`. */
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

const persistSession = (token: string, expiresAtIso?: string) => {
  localStorage.setItem('auth_token', token);
  const expiresAtMs = expiresAtIso
    ? new Date(expiresAtIso).getTime()
    : Date.now() + DEFAULT_TTL_MS;
  localStorage.setItem('auth_expires_at', String(expiresAtMs));
};

export const authService = {
  async register(data: RegisterData): Promise<RegisterResponse> {
    if (data.profile_picture) {
      const formData = new FormData();
      formData.append('first_name', data.first_name);
      formData.append('username', data.username);
      formData.append('email', data.email);
      formData.append('password', data.password);
      formData.append('profile_picture', data.profile_picture, data.profile_picture.name);
      const response = await api.post('/users/register/', formData);
      if (response.data.token) persistSession(response.data.token, response.data.expires_at);
      return response.data;
    }
    const response = await api.post('/users/register/', {
      first_name: data.first_name,
      username: data.username,
      email: data.email,
      password: data.password,
    });
    if (response.data.token) persistSession(response.data.token, response.data.expires_at);
    return response.data;
  },

  async login(data: LoginData): Promise<LoginResponse> {
    const response = await api.post('/users/login/', data);
    if (response.data.token) persistSession(response.data.token, response.data.expires_at);
    return response.data;
  },

  async logout(): Promise<void> {
    try {
      await api.post('/users/logout/');
    } finally {
      localStorage.removeItem('auth_token');
      localStorage.removeItem('auth_expires_at');
    }
  },

  async getCurrentUser(): Promise<User> {
    const response = await api.get('/users/me/');
    return response.data;
  },

  getToken(): string | null {
    return localStorage.getItem('auth_token');
  },

  isLoggedIn(): boolean {
    if (!localStorage.getItem('auth_token')) return false;
    const expiresAt = Number(localStorage.getItem('auth_expires_at') ?? 0);
    if (expiresAt && Date.now() > expiresAt) {
      localStorage.removeItem('auth_token');
      localStorage.removeItem('auth_expires_at');
      return false;
    }
    return true;
  },

  /** Milissegundos restantes até a sessão expirar (0 se já expirou ou sem token). */
  msUntilExpiry(): number {
    const expiresAt = Number(localStorage.getItem('auth_expires_at') ?? 0);
    if (!expiresAt) return 0;
    return Math.max(0, expiresAt - Date.now());
  },

  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    await api.post('/users/change-password/', {
      current_password: currentPassword,
      new_password: newPassword,
    });
  },

  async uploadProfilePicture(file: Blob): Promise<User> {
    const formData = new FormData();
    formData.append('profile_picture', file, 'profile.png');
    const response = await api.post<User>('/users/profile-picture/', formData);
    return response.data;
  },

  async recoverAccount(recovery_code: string, new_password: string): Promise<void> {
    await api.post('/users/recover-account/', {
      recovery_code,
      new_password,
      confirm_password: new_password,
    });
  },

  async getRecoveryCode(): Promise<{ recovery_code: string | null; recovery_code_expires_at: string | null }> {
    const response = await api.get('/users/recovery-code/');
    return response.data;
  },

  async regenerateRecoveryCode(): Promise<{ recovery_code: string; recovery_code_expires_at: string }> {
    const response = await api.post('/users/recovery-code/');
    return response.data;
  },
};

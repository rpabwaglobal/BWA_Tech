import axios from 'axios';

/**
 * Cliente HTTP para a API **externa** `{HOST}/api/formularios/*` (suporte no portal).
 *
 * Modos:
 * - `VITE_FORMULARIOS_TOKEN_FROM_PORTAL=true`: Bearer JWT obtido via GET `/api/portal/formularios-access/` no backend (credenciais do portal só no servidor).
 * - Caso contrário: Token Django ou Bearer manual (`VITE_FORMULARIOS_AUTH_SCHEME`, `VITE_FORMULARIOS_AUTH_TOKEN_KEY`).
 */
/** Em dev com proxy Vite: chamadas passam por `/__formularios` → evita CORS no navegador. */
export function usesFormulariosDevProxy(): boolean {
  return (
    import.meta.env.DEV &&
    (import.meta.env.VITE_FORMULARIOS_USE_PROXY as string | undefined)?.toLowerCase() === 'true'
  );
}

export function getFormulariosApiBase(): string {
  if (usesFormulariosDevProxy()) {
    return '/__formularios/api/formularios';
  }
  const explicit = import.meta.env.VITE_FORMULARIOS_API_BASE as string | undefined;
  if (explicit?.trim()) return explicit.replace(/\/$/, '');
  const apiUrl =
    import.meta.env.VITE_API_URL ??
    (import.meta.env.DEV ? 'http://127.0.0.1:8000/api' : '/api');
  return `${String(apiUrl).replace(/\/$/, '')}/formularios`;
}

function authScheme(): 'token' | 'bearer' {
  const raw = (import.meta.env.VITE_FORMULARIOS_AUTH_SCHEME as string | undefined)?.toLowerCase();
  return raw === 'bearer' ? 'bearer' : 'token';
}

export function getFormulariosAuthStorageKey(): string {
  return (
    (import.meta.env.VITE_FORMULARIOS_AUTH_TOKEN_KEY as string | undefined)?.trim() ||
    'auth_token'
  );
}

function tokenFromPortal(): boolean {
  return (
    (import.meta.env.VITE_FORMULARIOS_TOKEN_FROM_PORTAL as string | undefined)?.toLowerCase() ===
    'true'
  );
}

function legacyAuthToken(): string | null {
  return localStorage.getItem(getFormulariosAuthStorageKey());
}

const formulariosApi = axios.create({
  timeout: 60000,
  headers: { 'Content-Type': 'application/json' },
});

formulariosApi.interceptors.request.use(async (config) => {
  config.baseURL = getFormulariosApiBase();

  if (tokenFromPortal()) {
    try {
      const { ensurePortalFormulariosJwt } = await import('./portalFormulariosTokenService');
      const jwt = await ensurePortalFormulariosJwt();
      if (jwt) {
        config.headers.Authorization = `Bearer ${jwt}`;
      }
    } catch {
      /* requisição segue sem Authorization; a API externa responderá 401 */
    }
  } else {
    const token = legacyAuthToken();
    if (token) {
      config.headers.Authorization =
        authScheme() === 'bearer' ? `Bearer ${token}` : `Token ${token}`;
    }
  }

  if (config.data instanceof FormData) {
    delete config.headers['Content-Type'];
  }
  return config;
});

formulariosApi.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      if (tokenFromPortal()) {
        const { clearPortalFormulariosJwt } = await import('./portalFormulariosTokenService');
        clearPortalFormulariosJwt();
      } else {
        localStorage.removeItem(getFormulariosAuthStorageKey());
        localStorage.removeItem('auth_expires_at');
        window.location.href = '/entrar';
      }
    }
    return Promise.reject(error);
  },
);

export default formulariosApi;

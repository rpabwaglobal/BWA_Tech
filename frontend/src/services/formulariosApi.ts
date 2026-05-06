import axios from 'axios';

/**
 * Cliente HTTP dos **chamados/catrão Kanban** (`suporte/*`, catálogo): deve apontar para a **API do portal**
 * (mesmo host que o portal usa em produção). Não usar o Django apenas como substituto em produção —
 * o modelo local serve outros fins; comentários/timeline usam `api.ts` → `/api/formularios/suporte-timeline/`.
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

/**
 * Chamados são persistidos neste backend Django (`/api/formularios/...`) — permite WebSocket `/ws/suporte/`.
 * Quando o proxy ou API absoluta aponta para outro host (portal), as alterações não passam no Django e usamos polling + WS do portal.
 */
export function usesLocalFormulariosBackend(): boolean {
  if (usesFormulariosDevProxy()) return false;
  const rawBase = (import.meta.env.VITE_FORMULARIOS_API_BASE as string | undefined)?.trim();
  const apiUrl = (import.meta.env.VITE_API_URL as string | undefined)?.trim();
  if (!rawBase) return true;
  if (!rawBase.startsWith('http')) return true;
  if (!apiUrl?.startsWith('http')) return false;
  try {
    return new URL(rawBase).host === new URL(apiUrl).host;
  } catch {
    return false;
  }
}

export function getFormulariosApiBase(): string {
  if (usesFormulariosDevProxy()) {
    return '/__formularios/api/formularios';
  }
  const explicit = (import.meta.env.VITE_FORMULARIOS_API_BASE as string | undefined)?.trim();
  if (explicit) return explicit.replace(/\/$/, '');

  // Em desenvolvimento sem URL do portal: permite usar o Django local (`/api/formularios`) só para testes.
  if (import.meta.env.DEV) {
    const apiUrl =
      import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8000/api';
    return `${String(apiUrl).replace(/\/$/, '')}/formularios`;
  }

  // Produção: Kanban deve vir da API do portal, não do ORM Django na mesma origem.
  throw new Error(
    'VITE_FORMULARIOS_API_BASE é obrigatório na build de produção. Defina a URL da API de formulários do portal (ex.: https://api…/api/formularios). Timeline/comentários continuam no Django (VITE_API_URL).',
  );
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

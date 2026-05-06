import axios from 'axios';

/**
 * Cliente HTTP dos **chamados/Kanban** (`suporte/*`, catálogo).
 *
 * Modos:
 * - Dev + `VITE_FORMULARIOS_USE_PROXY`: `/__formularios` → portal (Vite).
 * - `VITE_FORMULARIOS_PROXY_THROUGH_DJANGO=true`: `/api/portal-formularios/*` no mesmo host (sem CORS na LAN); Django repassa ao portal.
 * - `VITE_FORMULARIOS_API_BASE`: URL direta do portal (HTTPS público).
 * - `VITE_FORMULARIOS_TOKEN_FROM_PORTAL`: Bearer obtido em `/api/portal/formularios-access/` (pedidos diretos ao portal).
 *
 * Timeline/comentários: `api.ts` → `/api/formularios/suporte-timeline/` (Django).
 */
/** Em dev com proxy Vite: chamadas passam por `/__formularios` → evita CORS no navegador. */
export function usesFormulariosDevProxy(): boolean {
  return (
    import.meta.env.DEV &&
    (import.meta.env.VITE_FORMULARIOS_USE_PROXY as string | undefined)?.toLowerCase() === 'true'
  );
}

/** Kanban via Django que faz proxy ao portal (mesma origem / Token BWA). */
export function proxyThroughDjango(): boolean {
  return (
    (import.meta.env.VITE_FORMULARIOS_PROXY_THROUGH_DJANGO as string | undefined)?.toLowerCase() ===
    'true'
  );
}

/**
 * Chamados persistidos no modelo Django (`/api/formularios/suporte`) — WebSocket `/ws/suporte/` aplica-se aqui.
 * Não é o caso quando se usa proxy `portal-formularios` ou API absoluta noutro host.
 */
export function usesLocalFormulariosBackend(): boolean {
  if (usesFormulariosDevProxy()) return false;
  if (proxyThroughDjango()) return false;
  const rawBase = (import.meta.env.VITE_FORMULARIOS_API_BASE as string | undefined)?.trim();
  const apiUrl = (import.meta.env.VITE_API_URL as string | undefined)?.trim();
  if (!rawBase) return true;
  if (!rawBase.startsWith('http')) return true;
  if (!apiUrl?.startsWith('http')) return false;
  try {
    const bu = new URL(rawBase);
    const au = new URL(apiUrl);
    if (bu.host !== au.host) return false;
    const path = bu.pathname.replace(/\/$/, '');
    if (path.endsWith('/portal-formularios')) return false;
    return true;
  } catch {
    return false;
  }
}

export function getFormulariosApiBase(): string {
  if (usesFormulariosDevProxy()) {
    return '/__formularios/api/formularios';
  }

  if (proxyThroughDjango()) {
    const apiUrl =
      import.meta.env.VITE_API_URL ??
      (import.meta.env.DEV ? 'http://127.0.0.1:8000/api' : '/api');
    return `${String(apiUrl).replace(/\/$/, '')}/portal-formularios`;
  }

  const explicit = (import.meta.env.VITE_FORMULARIOS_API_BASE as string | undefined)?.trim();
  if (explicit) return explicit.replace(/\/$/, '');

  // Em desenvolvimento sem URL do portal: permite usar o Django local (`/api/formularios`) só para testes.
  if (import.meta.env.DEV) {
    const apiUrl =
      import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8000/api';
    return `${String(apiUrl).replace(/\/$/, '')}/formularios`;
  }

  // Produção: URL explícita do portal ou proxy Django acima.
  throw new Error(
    'Em produção defina VITE_FORMULARIOS_PROXY_THROUGH_DJANGO=true ou VITE_FORMULARIOS_API_BASE (URL da API do portal).',
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

  if (proxyThroughDjango()) {
    const token = legacyAuthToken();
    if (token) {
      config.headers.Authorization =
        authScheme() === 'bearer' ? `Bearer ${token}` : `Token ${token}`;
    }
  } else if (tokenFromPortal()) {
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
      if (proxyThroughDjango()) {
        localStorage.removeItem(getFormulariosAuthStorageKey());
        localStorage.removeItem('auth_expires_at');
        window.location.href = '/entrar';
      } else if (tokenFromPortal()) {
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

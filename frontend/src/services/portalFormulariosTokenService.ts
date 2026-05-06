import api from './api';

/** JWT do portal guardado só na sessão do navegador (para Bearer na API externa). */
export const PORTAL_FORMULARIOS_JWT_KEY = 'portal_formularios_jwt';

export function getCachedPortalFormulariosJwt(): string | null {
  return sessionStorage.getItem(PORTAL_FORMULARIOS_JWT_KEY);
}

export function clearPortalFormulariosJwt(): void {
  sessionStorage.removeItem(PORTAL_FORMULARIOS_JWT_KEY);
}

/** Chama o Django (usuário já logado no app) que por sua vez autentica no portal com PORTAL_* no .env. */
export async function fetchPortalFormulariosJwtFromBackend(): Promise<string> {
  const { data } = await api.get<{ access: string }>('portal/formularios-access/');
  const access = data?.access;
  if (!access || typeof access !== 'string') {
    throw new Error('Resposta inválida: falta access');
  }
  sessionStorage.setItem(PORTAL_FORMULARIOS_JWT_KEY, access);
  return access;
}

export async function ensurePortalFormulariosJwt(): Promise<string> {
  const cached = getCachedPortalFormulariosJwt();
  if (cached) return cached;
  return fetchPortalFormulariosJwtFromBackend();
}

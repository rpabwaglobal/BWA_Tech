/**
 * Cache simples em memória + localStorage com estratégia stale-while-revalidate.
 *
 * Filosofia: ao chamar `cachedFetch(key, fetcher, ttlMs)`:
 *  - Se há valor em cache fresco (< ttl) → retorna imediatamente (sync).
 *  - Se há valor STALE (> ttl mas existente) → retorna o stale E dispara
 *    revalidação em background (chama o callback `onRevalidate` quando o
 *    valor novo chega).
 *  - Se não há valor algum → faz fetch real e aguarda.
 *
 * Use casos: páginas que precisam de "instantâneo" no segundo carregamento
 * mas tolera dados levemente desatualizados (Métricas, Dashboard).
 */

const memCache = new Map<string, { value: unknown; ts: number }>();
const inFlight = new Map<string, Promise<unknown>>();

function lsKey(key: string): string {
  return `cache:${key}`;
}

function readLs(key: string): { value: unknown; ts: number } | null {
  try {
    const raw = localStorage.getItem(lsKey(key));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.ts !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeLs(key: string, value: unknown, ts: number): void {
  try {
    localStorage.setItem(lsKey(key), JSON.stringify({ value, ts }));
  } catch {
    // Quota exceeded ou modo privado — ignora silenciosamente.
  }
}

export type CachedResult<T> = {
  /** Valor do cache (pode ser stale). null se não havia cache. */
  cached: T | null;
  /** True se cached é fresco (<= ttl). */
  fresh: boolean;
  /** Promise do valor revalidado (sempre disparada exceto quando cache é fresco). */
  revalidate: Promise<T> | null;
};

/**
 * Lê o cache (memória → localStorage). NÃO dispara fetch.
 * Útil pra hidratação síncrona em useState inicializer.
 */
export function readCache<T>(key: string, ttlMs: number): { value: T; fresh: boolean } | null {
  const mem = memCache.get(key);
  if (mem) {
    return { value: mem.value as T, fresh: Date.now() - mem.ts <= ttlMs };
  }
  const ls = readLs(key);
  if (ls) {
    memCache.set(key, ls);
    return { value: ls.value as T, fresh: Date.now() - ls.ts <= ttlMs };
  }
  return null;
}

/**
 * Atualiza o cache manualmente (mem + ls).
 */
export function writeCache<T>(key: string, value: T): void {
  const ts = Date.now();
  memCache.set(key, { value, ts });
  writeLs(key, value, ts);
}

/**
 * Limpa uma chave (mem + ls). Útil ao logout ou ao mutar algo que invalida.
 */
export function invalidateCache(key: string): void {
  memCache.delete(key);
  try {
    localStorage.removeItem(lsKey(key));
  } catch {
    /* ignore */
  }
}

/**
 * Fetcher com SWR. Sempre retorna a versão mais recente OU dispara revalidação.
 *
 * - Se cached existe E fresco: retorna { cached, fresh: true, revalidate: null }
 * - Se cached existe MAS stale: retorna { cached, fresh: false, revalidate: <promise> }
 * - Se não tem cached: retorna { cached: null, fresh: false, revalidate: <promise> }
 *
 * Chamadas concorrentes para a mesma key compartilham a mesma promise (deduplica).
 */
export function cachedFetch<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlMs: number,
): CachedResult<T> {
  const cached = readCache<T>(key, ttlMs);

  if (cached && cached.fresh) {
    return { cached: cached.value, fresh: true, revalidate: null };
  }

  // Dedup: se já há uma revalidação em voo pra essa key, reusa.
  let revalidate = inFlight.get(key) as Promise<T> | undefined;
  if (!revalidate) {
    revalidate = (async () => {
      try {
        const value = await fetcher();
        writeCache(key, value);
        return value;
      } finally {
        inFlight.delete(key);
      }
    })();
    inFlight.set(key, revalidate);
  }

  return {
    cached: cached ? cached.value : null,
    fresh: false,
    revalidate,
  };
}

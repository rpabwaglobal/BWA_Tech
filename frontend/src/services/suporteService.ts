import formulariosApi from './formulariosApi';

/** Marcador no início de `descricao_resolucao` quando o ticket está «parado por pendências» (a API só tem «Em andamento»). */
export const SUPORTE_PENDENCIA_MARKER = '__PENDENCIA_BWA__';

/** Forma canónica gravada na API: marcador + nova linha. */
export const SUPORTE_PENDENCIA_PREFIX = `${SUPORTE_PENDENCIA_MARKER}\n`;

export type SuporteStatusApi = 'Aberto' | 'Em andamento' | 'Resolvido' | 'Cancelado';

export type SuporteCatalogRef = {
  id?: number;
  nome?: string;
  ativo?: boolean;
};

export type ChamadoSuporte = {
  id: number;
  usuario_nome: string;
  usuario_email: string;
  usuario_setor?: string | null;
  empresa?: string | null;
  descricao: string;
  tipo: number | SuporteCatalogRef;
  item: number | SuporteCatalogRef;
  motivo: number | SuporteCatalogRef;
  anexo_url?: string | null;
  status: SuporteStatusApi;
  usuario_notificado?: boolean;
  responsavel?: string | null;
  responsavel_solucao?: string | null;
  descricao_resolucao?: string | null;
  data_abertura?: string;
  data_atualizacao?: string;
};

export type CreateChamadoSuportePayload = {
  usuario_nome: string;
  usuario_email: string;
  usuario_setor?: string | null;
  tipo: number;
  item: number;
  motivo: number;
  empresa?: string | null;
  descricao: string;
  anexo_url?: string | null;
  status?: SuporteStatusApi;
  responsavel?: string | null;
  responsavel_solucao?: string | null;
  descricao_resolucao?: string | null;
};

export type PatchChamadoSuportePayload = {
  status?: SuporteStatusApi;
  responsavel_solucao?: string | null;
  descricao_resolucao?: string | null;
  /** PK do SuporteTipo — usado pra mover entre tabs RPA / Easy / Dashboards. */
  tipo?: number;
};

export type ListByUsuarioFiltered = {
  usuario_email?: string;
  /** Filtra por SuporteTipo (PK). */
  tipo_id?: number;
  /** Filtra por status do chamado (Aberto / Em andamento / Resolvido / Cancelado). */
  status?: SuporteStatusApi;
  /** Limit/offset ativam a resposta `{count, results}` (scroll infinito). */
  limit?: number;
  offset?: number;
};

export type ListByUsuarioPagedResponse = {
  count: number;
  results: ChamadoSuporte[];
};

export type CatalogoItemLista = { id: number; nome: string; ativo: boolean };
export type CatalogoTipoLista = CatalogoItemLista & { itens: CatalogoItemLista[] };
export type CatalogoSuporteResponse = { tipos: CatalogoTipoLista[]; motivos: CatalogoItemLista[] };

/** Indica se o texto guardado na API começa pelo marcador interno de pendência (aceita `\n`, `\r\n` ou só o marcador). */
export function hasPendenciaMarker(text: string | null | undefined): boolean {
  const s = (text ?? '').replace(/^\uFEFF/, '').trimStart();
  return s.startsWith(SUPORTE_PENDENCIA_MARKER);
}

/** Remove o marcador interno do início para exibição / edição — mostra só o que o utilizador escreveu. */
export function stripPendenciaMarker(text: string | null | undefined): string {
  const raw = text ?? '';
  if (!hasPendenciaMarker(raw)) return raw;
  let s = raw.replace(/^\uFEFF/, '').trimStart();
  s = s.slice(SUPORTE_PENDENCIA_MARKER.length);
  s = s.replace(/^\r?\n/, '');
  return s;
}

export function ensurePendenciaMarker(text: string | null | undefined): string {
  const body = stripPendenciaMarker(text ?? '').trim();
  if (!body) return SUPORTE_PENDENCIA_PREFIX;
  return `${SUPORTE_PENDENCIA_PREFIX}${body}`;
}

export function catalogNome(ref: number | SuporteCatalogRef | undefined): string {
  if (ref == null) return '—';
  if (typeof ref === 'number') return String(ref);
  return ref.nome ?? String(ref.id ?? '—');
}

export const suporteService = {
  /**
   * Catálogo tipo → itens e motivos para o formulário de novo chamado.
   * Ajuste `VITE_FORMULARIOS_SUPORTE_CATALOGO_PATH` se a operação usar outra rota (padrão: `suporte/catalogo/`).
   */
  async fetchCatalog(): Promise<CatalogoSuporteResponse> {
    const raw = (import.meta.env.VITE_FORMULARIOS_SUPORTE_CATALOGO_PATH as string | undefined)?.trim();
    const path = (raw ? raw.replace(/^\//, '') : '') || 'suporte/catalogo/';
    const { data } = await formulariosApi.get<CatalogoSuporteResponse>(path);
    return data;
  },

  async listByUsuario(usuarioEmail?: string): Promise<ChamadoSuporte[]> {
    const params =
      usuarioEmail !== undefined && usuarioEmail !== ''
        ? { usuario_email: usuarioEmail }
        : undefined;
    const { data } = await formulariosApi.get<
      ChamadoSuporte[] | { results?: ChamadoSuporte[]; count?: number }
    >('suporte/por-usuario/', {
      params,
    });
    if (Array.isArray(data)) return data;
    if (data && typeof data === 'object' && Array.isArray(data.results)) return data.results;
    return [];
  },

  async create(payload: CreateChamadoSuportePayload): Promise<ChamadoSuporte> {
    const { data } = await formulariosApi.post<ChamadoSuporte>('suporte/', payload);
    return data;
  },

  async patch(id: number, payload: PatchChamadoSuportePayload): Promise<ChamadoSuporte> {
    const { data } = await formulariosApi.patch<ChamadoSuporte>(`suporte/${id}/`, payload);
    return data;
  },

  /** Atalho pra mover chamado entre tabs (PATCH tipo). Otimizado pelo
   * frontend pra rodar em Promise.all no multi-select. */
  async patchTipo(id: number, tipoId: number): Promise<ChamadoSuporte> {
    const { data } = await formulariosApi.patch<ChamadoSuporte>(`suporte/${id}/`, {
      tipo: tipoId,
    });
    return data;
  },

  /** Versão filtrada + paginada do listByUsuario.
   * - Sem `limit/offset`: retorna array (igual listByUsuario).
   * - Com `limit/offset`: retorna `{count, results}` pra scroll infinito.
   * Aceita `tipo_id` e `status` (backend filtra no SQL).
   */
  async listByUsuarioFiltered(params: ListByUsuarioFiltered): Promise<ChamadoSuporte[] | ListByUsuarioPagedResponse> {
    const cleaned: Record<string, string | number> = {};
    if (params.usuario_email) cleaned.usuario_email = params.usuario_email;
    if (params.tipo_id != null) cleaned.tipo_id = params.tipo_id;
    if (params.status) cleaned.status = params.status;
    if (params.limit != null) cleaned.limit = params.limit;
    if (params.offset != null) cleaned.offset = params.offset;
    const { data } = await formulariosApi.get<
      ChamadoSuporte[] | ListByUsuarioPagedResponse
    >('suporte/por-usuario/', { params: cleaned });
    return data;
  },

  async notificarUsuario(id: number): Promise<ChamadoSuporte> {
    const { data } = await formulariosApi.patch<ChamadoSuporte>(
      `suporte/${id}/notificar-usuario/`,
      { usuario_notificado: true },
    );
    return data;
  },
};

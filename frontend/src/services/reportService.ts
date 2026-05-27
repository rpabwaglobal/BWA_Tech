import api from './api';

export type ReportType =
  | 'metrics'
  | 'sprint'
  | 'cards'
  | 'projects'
  | 'user'
  | 'bottlenecks'
  | 'executive'
  | 'backlog';

export type ReportFormat = 'pdf' | 'docx' | 'xlsx' | 'csv';

export type ReportStatus = 'pending' | 'running' | 'completed' | 'failed';

/** Payload do GET /api/reports/<id>/ (consumido no polling). */
export type ReportJob = {
  id: number;
  type: ReportType;
  format: ReportFormat;
  filters: Record<string, unknown>;
  include_header: boolean;
  status: ReportStatus;
  progress: number;            // 0–100
  progress_message: string;
  file_size: number | null;
  error: string;
  download_url: string | null; // só preenchido se status=completed
  preview_url: string | null;  // só pdf
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

export type ReportCreateInput = {
  type: ReportType;
  format: ReportFormat;
  filters?: Record<string, unknown>;
  /** Default true (para xlsx/csv). Ignorado para pdf/docx. */
  include_header?: boolean;
};

/** Erro 409 quando já há job ativo do usuário. */
export type ReportConflict = {
  detail: string;
  existing_id: number;
  existing_status: ReportStatus;
  existing_type: ReportType;
  existing_format: ReportFormat;
};

export const reportService = {
  /** Cria um novo job e dispara Celery.
   * Lança AxiosError com status 409 se já há job ativo (response.data tem
   * existing_id, etc.) — o caller deve adotar o job existente. */
  async create(input: ReportCreateInput): Promise<ReportJob> {
    const response = await api.post<ReportJob>('/reports/', input);
    return response.data;
  },

  /** Polling de status/progresso. */
  async getById(id: number): Promise<ReportJob> {
    const response = await api.get<ReportJob>(`/reports/${id}/`);
    return response.data;
  },

  /** Lista jobs do usuário, opcionalmente filtrados por status. */
  async list(status?: ReportStatus): Promise<ReportJob[]> {
    const url = status ? `/reports/?status=${encodeURIComponent(status)}` : '/reports/';
    const response = await api.get<ReportJob[] | { results: ReportJob[] }>(url);
    return Array.isArray(response.data) ? response.data : response.data.results;
  },

  /** Cancela job em andamento OU remove job concluído (apaga arquivo). */
  async cancel(id: number): Promise<void> {
    await api.delete(`/reports/${id}/`);
  },

  /** URL absoluta para download. NÃO usar com `window.open` direto — o
   * browser não envia o header Authorization. Use `downloadFile()` em vez. */
  downloadUrl(id: number): string {
    const base = api.defaults.baseURL ?? '';
    return `${base}/reports/${id}/download/`;
  },

  /** Baixa o arquivo via axios (com Authorization) → cria blob URL → dispara
   * <a download> programaticamente. Funciona para QUALQUER formato (PDF, DOCX,
   * XLSX, CSV). Filename vem do Content-Disposition que o backend já envia
   * com o padrão "BWATech - <Título> - DD-MM-YYYY HH-MM.<fmt>".
   */
  async downloadFile(id: number): Promise<void> {
    const response = await api.get(`/reports/${id}/download/`, {
      responseType: 'blob',
    });
    const blob = new Blob([response.data as BlobPart], {
      type: (response.headers['content-type'] as string) || 'application/octet-stream',
    });
    const url = URL.createObjectURL(blob);
    // Filename do header. Suporta RFC 5987 (filename*) e legacy (filename=).
    // Sanitiza pra remover path traversal injetado em CD.
    const cd = response.headers['content-disposition'] as string | undefined;
    const rawName = parseContentDispositionFilename(cd) || `BWATech - relatorio-${id}`;
    const filename = sanitizeFilename(rawName);

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Pequeno delay antes de revogar (alguns browsers cancelam o download
    // se a blob URL é revogada na mesma tick do click).
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },

  /** URL para preview embedável (iframe). Só PDF. NÃO usar com iframe direto
   * (sem auth) — usar fetch + Blob (ver ReportPreviewDialog). */
  previewUrl(id: number): string {
    const base = api.defaults.baseURL ?? '';
    return `${base}/reports/${id}/preview/`;
  },

  /** Preview JSON paginado pra formatos tabulares (XLSX/CSV).
   * Não cria job persistido — retorna a janela `[offset, offset+limit]`.
   * Cliente faz infinite scroll incrementando `offset`. Cada chamada
   * re-roda `fetch_data` no backend (sem cache de página). */
  async previewTable(input: {
    type: ReportType;
    filters?: Record<string, unknown>;
    limit?: number;
    offset?: number;
  }): Promise<ReportTablePreview> {
    const response = await api.post<ReportTablePreview>('/reports/preview-table/', {
      type: input.type,
      filters: input.filters ?? {},
      limit: input.limit,
      offset: input.offset,
    });
    return response.data;
  },
};

export type ReportTablePreviewColumn = { key: string; label: string };
export type ReportTablePreview = {
  columns: ReportTablePreviewColumn[];
  rows: Array<Record<string, unknown>>;
  total: number;
  offset: number;
  limit: number;
  has_more: boolean;
};

/**
 * Extrai filename de Content-Disposition. Suporta:
 *   filename="BWATech - Relatorio.pdf"
 *   filename*=UTF-8''BWATech%20-%20Relat%C3%B3rio.pdf  (RFC 5987, prioridade)
 *
 * Retorna null se header ausente ou não conseguir parsear.
 */
/** Remove caracteres de path/controle de filename vindo da rede. */
function sanitizeFilename(name: string): string {
  return name
    .replace(/[\\/]/g, '_')
    .replace(/^\.+/, '_')
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f]/g, '')
    .slice(0, 200)
    .trim() || 'relatorio';
}

function parseContentDispositionFilename(header: string | undefined): string | null {
  if (!header) return null;
  // RFC 5987 first (suporta UTF-8)
  const star = header.match(/filename\*\s*=\s*([^']*)''([^;]+)/i);
  if (star) {
    try {
      return decodeURIComponent(star[2].trim());
    } catch {
      /* fallthrough */
    }
  }
  // Legacy `filename="..."` (com ou sem aspas)
  const legacy = header.match(/filename\s*=\s*("([^"]+)"|([^;]+))/i);
  if (legacy) {
    const raw = (legacy[2] || legacy[3] || '').trim();
    return raw || null;
  }
  return null;
}

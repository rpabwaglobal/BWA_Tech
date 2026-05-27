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
    const url = status ? `/reports/?status=${status}` : '/reports/';
    const response = await api.get<ReportJob[] | { results: ReportJob[] }>(url);
    return Array.isArray(response.data) ? response.data : response.data.results;
  },

  /** Cancela job em andamento OU remove job concluído (apaga arquivo). */
  async cancel(id: number): Promise<void> {
    await api.delete(`/reports/${id}/`);
  },

  /** URL absoluta para download. Útil para abrir em nova aba ou <a download>. */
  downloadUrl(id: number): string {
    const base = api.defaults.baseURL ?? '';
    return `${base}/reports/${id}/download/`;
  },

  /** URL para preview embedável (iframe). Só PDF. */
  previewUrl(id: number): string {
    const base = api.defaults.baseURL ?? '';
    return `${base}/reports/${id}/preview/`;
  },
};

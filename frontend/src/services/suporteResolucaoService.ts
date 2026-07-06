import api from './api';

/** Link + arquivo de resolução de um chamado (um por chamado). Armazenado no
 * Django local por `chamado_id` — independe de o chamado viver no portal. */
export type SuporteResolucao = {
  id: number;
  chamado_id: number;
  link: string | null;
  arquivo_url: string | null;
  arquivo_nome: string | null;
  criado_em: string;
  atualizado_em: string;
};

/** Extensões aceitas no arquivo de resolução (espelha o backend). Usado no
 * atributo `accept` do input e numa checagem client-side amigável. */
export const RESOLUCAO_ACCEPT_EXTENSIONS = [
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp',
  '.pdf',
  '.doc', '.docx', '.txt', '.rtf', '.odt',
  '.xls', '.xlsx', '.csv', '.ods',
] as const;

export const RESOLUCAO_ACCEPT = RESOLUCAO_ACCEPT_EXTENSIONS.join(',');
export const RESOLUCAO_MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

/** Valida um arquivo antes do upload. Retorna mensagem de erro ou `null` se ok. */
export function validateResolucaoArquivo(file: File): string | null {
  const dot = file.name.lastIndexOf('.');
  const ext = dot >= 0 ? file.name.slice(dot).toLowerCase() : '';
  if (!(RESOLUCAO_ACCEPT_EXTENSIONS as readonly string[]).includes(ext)) {
    return 'Tipo de arquivo não suportado. Envie imagem, documento, PDF ou planilha.';
  }
  if (file.size > RESOLUCAO_MAX_FILE_SIZE) {
    return 'Arquivo muito grande (máx 10 MB).';
  }
  return null;
}

export const suporteResolucaoService = {
  async getByChamado(chamadoId: number): Promise<SuporteResolucao | null> {
    const { data } = await api.get<SuporteResolucao | null>(
      `/formularios/suporte-resolucao/?chamado_id=${encodeURIComponent(String(chamadoId))}`,
    );
    return data ?? null;
  },

  async save(payload: {
    chamado_id: number;
    link?: string | null;
    arquivo?: File | null;
  }): Promise<SuporteResolucao> {
    const fd = new FormData();
    fd.append('chamado_id', String(payload.chamado_id));
    if (payload.link != null) fd.append('link', payload.link);
    if (payload.arquivo) fd.append('arquivo', payload.arquivo, payload.arquivo.name);
    const { data } = await api.post<SuporteResolucao>('/formularios/suporte-resolucao/', fd);
    return data;
  },
};

import api from './api';

/** Arquivo anexado a um card (imagem, PDF, CSV, Excel, documento, etc.). */
export type CardAnexo = {
  id: number;
  card: number;
  arquivo_url: string | null;
  nome: string;
  tamanho: number;
  enviado_por_nome: string | null;
  criado_em: string;
};

/** Extensões aceitas (espelha o backend). Usado no `accept` do input e na
 * validação amigável antes do upload. */
export const CARD_ANEXO_ACCEPT_EXTENSIONS = [
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp',
  '.pdf',
  '.csv', '.xls', '.xlsx', '.ods',
  '.doc', '.docx', '.txt', '.rtf', '.odt', '.md',
  '.ppt', '.pptx', '.odp',
  '.zip',
] as const;

export const CARD_ANEXO_ACCEPT = CARD_ANEXO_ACCEPT_EXTENSIONS.join(',');
export const CARD_ANEXO_MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB

/** Valida um arquivo antes do upload. Retorna a mensagem de erro ou `null`. */
export function validateCardAnexo(file: File): string | null {
  const dot = file.name.lastIndexOf('.');
  const ext = dot >= 0 ? file.name.slice(dot).toLowerCase() : '';
  if (!(CARD_ANEXO_ACCEPT_EXTENSIONS as readonly string[]).includes(ext)) {
    return 'Tipo de arquivo não suportado. Envie imagem, PDF, CSV, Excel, documento, texto, apresentação ou zip.';
  }
  if (file.size > CARD_ANEXO_MAX_FILE_SIZE) {
    return 'Arquivo muito grande (máx 25 MB).';
  }
  return null;
}

export const cardAnexoService = {
  async listByCard(cardId: number | string): Promise<CardAnexo[]> {
    const { data } = await api.get<CardAnexo[]>(
      `/card-anexos/?card=${encodeURIComponent(String(cardId))}`,
    );
    return Array.isArray(data) ? data : [];
  },

  async upload(cardId: number | string, file: File): Promise<CardAnexo> {
    const fd = new FormData();
    fd.append('card', String(cardId));
    fd.append('arquivo', file, file.name);
    const { data } = await api.post<CardAnexo>('/card-anexos/', fd);
    return data;
  },

  async remove(id: number): Promise<void> {
    await api.delete(`/card-anexos/${id}/`);
  },
};

import api, { fetchAllPaginated } from './api';

export type Project = {
  /** PK do projeto. Tipado como string para uso em URLs/keys — o backend
   * armazena como inteiro (AutoField); o JS coerce via stringificação. */
  id: string;
  nome: string;
  descricao: string;
  sprint: string; // UUID
  sprint_name?: string;
  gerente_atribuido?: string | null; // UUID
  gerente_name?: string;
  desenvolvedor?: string | null; // UUID
  desenvolvedor_name?: string;
  status: string;
  status_display?: string;
  data_criacao?: string;
  data_avaliacao?: string | null;
  data_atribuicao_gerente?: string | null;
  data_inicio_desenvolvimento?: string | null;
  data_entrega?: string | null;
  data_homologacao?: string | null;
  data_adiamento_solicitada?: string | null;
  nova_data_prevista?: string | null;
  adiamento_aprovado?: boolean;
  /** Arquivamento (soft delete reversível). Default false. Backend filtra
   * automaticamente arquivados em todos endpoints exceto quando `?arquivado=true`
   * é passado explicitamente. */
  arquivado?: boolean;
  arquivado_em?: string | null;
  // `number | string` — backend devolve int (PK auto), mas o frontend popula
  // de update otimista com `user.id` que é stringificado em outros services.
  arquivado_por?: number | string | null;
  arquivado_por_name?: string | null;
  cards_count?: number;
  cards_entregues_count?: number;
  cards_em_desenvolvimento_count?: number;
  created_at?: string;
  updated_at?: string;
};

/** Resumo do impacto de uma exclusão em massa. "Em jogo" = card de projeto
 * cuja sprint está ativa AND status não-terminal. Usado pelo modal de
 * confirmação para destacar o que será perdido sem retorno. */
export type BulkDeletePreview = {
  total_projects: number;
  /** Quantos IDs foram rejeitados por serem projetos sistêmicos (Sugestões,
   * Projetos Descartados). Exibido como alerta no modal. */
  blocked_system_projects: number;
  projects: Array<{
    id: number;
    nome: string;
    total_cards: number;
    /** Lista parcial — limitada a `_PREVIEW_CARDS_LIMIT` (100) pelo backend. */
    cards_em_jogo: Array<{
      id: string;
      nome: string;
      status: string;
      status_display: string;
      sprint_nome: string | null;
    }>;
    /** Total real de cards em jogo (pode ser maior que `cards_em_jogo.length`). */
    cards_em_jogo_total: number;
    cards_em_jogo_truncated: boolean;
  }>;
};

/** Resposta padrão das ações em massa (archive/unarchive/delete). */
export type BulkActionResult = {
  requested: number;
  blocked_system_projects: number;
  // Cada action retorna sua chave específica de contagem ('arquivados',
  // 'desarquivados' ou 'deleted_projects'); somos liberais aqui.
  arquivados?: number;
  desarquivados?: number;
  deleted_projects?: number;
  cascade_total?: number;
};

export type ProjectCreate = {
  nome: string;
  descricao?: string;
  sprint: string; // UUID
  gerente_atribuido?: string | null; // UUID
  desenvolvedor?: string | null; // UUID
  status?: string;
};

export const projectService = {
  /** Todos os projetos (todas as páginas). */
  async getAll(): Promise<Project[]> {
    return fetchAllPaginated<Project>('/projects/');
  },

  /** Projetos de uma sprint (todas as páginas; mais eficiente que getAll + filtrar). */
  async getBySprint(sprintId: string): Promise<Project[]> {
    const id = encodeURIComponent(String(sprintId));
    return fetchAllPaginated<Project>(`/projects/?sprint=${id}`);
  },

  async getById(id: string): Promise<Project> {
    const response = await api.get(`/projects/${id}/`);
    return response.data;
  },

  async create(data: ProjectCreate): Promise<Project> {
    const response = await api.post('/projects/', data);
    return response.data;
  },

  async update(id: string, data: Partial<ProjectCreate>): Promise<Project> {
    const response = await api.patch(`/projects/${id}/`, data);
    return response.data;
  },

  async delete(id: string): Promise<void> {
    await api.delete(`/projects/${id}/`);
  },

  /** Lista APENAS projetos arquivados (tab Arquivados). Backend retorna ordenado
   * por `arquivado_em desc`. Sem paginação real (fetchAllPaginated percorre todas
   * as páginas); aceitável para a escala atual de arquivados (<centenas). */
  async getArchived(): Promise<Project[]> {
    return fetchAllPaginated<Project>('/projects/?arquivado=true');
  },

  /** Arquivar N projetos em massa (soft, reversível). 403 se não for supervisor/admin. */
  async bulkArchive(ids: Array<string | number>): Promise<BulkActionResult> {
    const response = await api.post('/projects/bulk-archive/', { ids });
    return response.data;
  },

  /** Desarquivar N projetos em massa. 403 se não for supervisor/admin. */
  async bulkUnarchive(ids: Array<string | number>): Promise<BulkActionResult> {
    const response = await api.post('/projects/bulk-unarchive/', { ids });
    return response.data;
  },

  /** Preview do impacto antes do hard delete — lista cards em jogo por projeto. */
  async bulkDeletePreview(ids: Array<string | number>): Promise<BulkDeletePreview> {
    const response = await api.post('/projects/bulk-delete-preview/', { ids });
    return response.data;
  },

  /** Hard delete em massa. CASCADE elimina cards/logs/etc. 403 se não for supervisor/admin. */
  async bulkDelete(ids: Array<string | number>): Promise<BulkActionResult> {
    const response = await api.post('/projects/bulk-delete/', { ids });
    return response.data;
  },

  async getKanbanConfig(projectId: string): Promise<{ project: string; stages: any[] }> {
    const response = await api.get(`/projects/${projectId}/kanban-config/`);
    return response.data;
  },

  async updateKanbanConfigReorder(
    projectId: string,
    stageKeysOrder: string[],
  ): Promise<{ detail?: string }> {
    const response = await api.post(`/projects/${projectId}/kanban-config/reorder/`, {
      stage_keys_order: stageKeysOrder,
    });
    return response.data;
  },

  async addKanbanStage(projectId: string, stageKey: string): Promise<{ detail?: string }> {
    const response = await api.post(`/projects/${projectId}/kanban-config/add/`, { stage_key: stageKey });
    return response.data;
  },

  async removeKanbanStage(
    projectId: string,
    stageKey: string,
    moveToKey?: string,
  ): Promise<any> {
    const payload: any = { stage_key: stageKey };
    if (moveToKey) payload.move_to_key = moveToKey;
    const response = await api.post(`/projects/${projectId}/kanban-config/remove/`, payload);
    return response.data;
  },

  async moveKanbanCards(
    projectId: string,
    fromStageKey: string,
    toStageKey: string,
  ): Promise<any> {
    const response = await api.post(`/projects/${projectId}/kanban-config/move-cards/`, {
      from_stage_key: fromStageKey,
      to_stage_key: toStageKey,
    });
    return response.data;
  },
};

import api, { fetchAllPaginated } from './api';
import type { Card as FullCard } from './cardService';
import type { Project } from './projectService';

export type Sprint = {
  id: string; // UUID
  nome: string;
  data_inicio: string;
  /** Instantâneo de fechamento automático (ISO). */
  fechamento_em: string;
  /** Só o dia final, derivado de `fechamento_em` (compat. API). */
  data_fim?: string;
  duracao_dias: number;
  supervisor: string; // UUID
  supervisor_name?: string;
  projects_count?: number;
  cards_total?: number;
  cards_finalizados?: number;
  cards_em_andamento?: number;
  cards_em_atraso?: number;
  cards_entregues_atrasados?: number;
  cards_abertos_atrasados?: number;
  finalizada?: boolean;
  /**
   * Sprint SISTÊMICA — hoje existe no máximo uma, a que segura o projeto
   * "Monitoramento de Feedbacks". Read-only: quem marca é o backend.
   *
   * Ela nunca fecha (`finalizada` false e `fechamento_em` daqui a ~100 anos),
   * então SEM esta flag ela passaria por "sprint em andamento" em todo lugar
   * que decide isso por data — Sidebar, Dashboard, redirect de entrada e a
   * própria lista de Sprints. É por isso que a flag existe em vez de um
   * casamento por nome.
   *
   * `GET /sprints/` já a exclui no backend; os cortes do frontend são a
   * segunda camada (o detail e o bundle continuam devolvendo a sprint, e é de
   * lá que ela pode chegar a uma dessas funções).
   */
  is_system?: boolean;
  /** Codename do setor dono. A sprint é a autoridade: projetos e cards dela
   * herdam este setor. */
  setor?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type SprintFinalizarResponse = {
  detail: string;
  ja_finalizada?: boolean;
  proxima_sprint_id?: string;
  proxima_sprint_nome?: string;
  projetos_criados?: number;
  cards_copiados?: number;
};

export type SprintCreate = {
  nome: string;
  data_inicio: string;
  fechamento_em: string;
  supervisor: string; // UUID
};

/** Etapa do Kanban dentro de uma config de projeto. */
export type KanbanStageConfig = {
  key: string;
  label: string;
  order: number;
  is_terminal: boolean;
  requires_required_data: boolean;
};

/**
 * Payload agregado de uma sprint para a página SprintDetails.
 * Retornado por GET /sprints/<id>/bundle/ em UMA request — substitui
 * 1+1+N+N requests anteriores (sprint + projects + cards/projeto + kanban-config/projeto).
 */
export type SprintBundle = {
  sprint: Sprint;
  projects: Project[];
  /** Cards de TODOS os projetos da sprint, já com responsavel_name/role/picture. */
  cards: FullCard[];
  /** Configs de Kanban indexadas por project_id. */
  kanban_configs: Record<string, KanbanStageConfig[]>;
};

export const sprintService = {
  async getAll(): Promise<Sprint[]> {
    return fetchAllPaginated<Sprint>('/sprints/');
  },

  async getById(id: string): Promise<Sprint> {
    const response = await api.get(`/sprints/${id}/`);
    return response.data;
  },

  async create(data: SprintCreate): Promise<Sprint> {
    const response = await api.post('/sprints/', data);
    return response.data;
  },

  async update(id: string, data: Partial<Pick<SprintCreate, 'nome' | 'data_inicio' | 'fechamento_em'>>): Promise<Sprint> {
    const response = await api.patch(`/sprints/${id}/`, data);
    return response.data;
  },

  async delete(id: string): Promise<void> {
    await api.delete(`/sprints/${id}/`);
  },

  async finalizar(id: string): Promise<SprintFinalizarResponse> {
    const response = await api.post<SprintFinalizarResponse>(`/sprints/${id}/finalizar/`);
    return response.data;
  },

  /**
   * Endpoint agregado: retorna sprint + projects + cards + kanban_configs
   * em UMA request única. Substitui múltiplas chamadas paginadas que a
   * SprintDetails fazia (1 sprint + 1 projects + N cards/proj + N kanban-config).
   * Backend usa CardKanbanSerializer (slim) + queries otimizadas.
   */
  /**
   * O pacote com tudo que a tela da sprint precisa.
   *
   * `semCacheHttp` FURA O CACHE DO NAVEGADOR, e não o da aplicação. São dois
   * caches diferentes, e essa distinção era o bug: a resposta sai do servidor
   * com `Cache-Control: private, max-age=30`, então depois de finalizar um card
   * o refetch era servido pelo navegador com o pacote de ANTES da mudança — e
   * sobrescrevia o estado local, que estava certo. O card voltava a aparecer
   * como "em desenvolvimento" por até meio minuto.
   *
   * `invalidateCache()` no cliente não alcança isso: ele limpa o mapa em
   * memória do SWR, não o cache HTTP. Só um `Cache-Control: no-cache` NO PEDIDO
   * obriga o navegador a revalidar.
   *
   * Continua valendo a pena manter o cache do servidor: ele serve a navegação
   * normal, que é a maioria. Só quem acabou de mudar algo precisa furá-lo.
   */
  async getBundle(id: string, opcoes?: { semCacheHttp?: boolean }): Promise<SprintBundle> {
    const response = await api.get<SprintBundle>(`/sprints/${id}/bundle/`, {
      headers: opcoes?.semCacheHttp ? { 'Cache-Control': 'no-cache' } : undefined,
    });
    return response.data;
  },
};

import api, { fetchAllPaginated, type PaginatedResponse } from './api';
import { userService } from './userService';

// ----------------------------------------------------------------------------
// Tipos
// ----------------------------------------------------------------------------

export type ScoreCriterionOption = {
  id?: number;
  valor: number;
  descricao: string;
  ordem: number;
};

export type ScoreCriterion = {
  id: number;
  nome: string;
  /** Peso na fórmula (ex.: "0.30"). O DRF serializa DecimalField como string. */
  peso: string;
  negativo: boolean;
  ordem: number;
  ativo: boolean;
  opcoes: ScoreCriterionOption[];
  created_at?: string;
  updated_at?: string;
};

export type CardScoreValue = {
  id?: number;
  criterion: number;
  criterion_nome?: string;
  criterion_negativo?: boolean;
  criterion_peso?: string;
  valor: number;
};

export type ScoreHistoryEntry = {
  id: number;
  acao: 'criado' | 'editado' | 'excluido';
  acao_display: string;
  score_final: string;
  setor_solicitante: string | null;
  snapshot: Array<{
    criterion_id: number;
    criterion_nome: string;
    peso: string;
    negativo: boolean;
    valor: number;
  }>;
  usuario: number | null;
  usuario_nome: string | null;
  data: string;
};

export type CardScore = {
  id: number;
  card: number;
  card_nome: string;
  card_status: string;
  card_status_display: string;
  // O resto do card, para o modal de editar desenhar o preview igual ao de
  // atribuir sem depender de `pickable-cards` — que exclui card finalizado, ou
  // seja, justamente o card que se costuma editar.
  card_prioridade: string | null;
  card_area: string | null;
  card_area_display: string | null;
  card_tipo: string | null;
  card_tipo_display: string | null;
  card_descricao: string | null;
  card_data_fim: string | null;
  card_script_url: string | null;
  setor_solicitante: string | null;
  setor_solicitante_display: string | null;
  score_final: string;
  sprint_nome: string | null;
  sprint_em_andamento: boolean;
  responsavel: number | null;
  responsavel_name: string | null;
  responsavel_role: string | null;
  valores: CardScoreValue[];
  historico: ScoreHistoryEntry[];
  criado_por: number | null;
  criado_por_nome: string | null;
  atualizado_por: number | null;
  atualizado_por_nome: string | null;
  created_at: string;
  updated_at: string;
};

/** Payload de escrita de um score (create/update). */
export type CardScoreInput = {
  card: number;
  setor_solicitante: string | null;
  valores: Array<{ criterion: number; valor: number }>;
};

/** Payload de escrita de um critério (create/update). */
export type ScoreCriterionInput = {
  nome: string;
  peso: string | number;
  negativo: boolean;
  ordem: number;
  ativo: boolean;
  opcoes: Array<{ valor: number; descricao: string; ordem: number }>;
};

/** Card leve para o seletor do modal de Score (endpoint sem paginação). */
export type PickableCard = {
  id: number;
  nome: string;
  descricao?: string | null;
  prioridade: string;
  status: string;
  area: string;
  area_display: string;
  tipo: string;
  tipo_display: string;
  data_fim: string | null;
  script_url?: string | null;
  responsavel: number | null;
  responsavel_name: string | null;
  responsavel_role: string | null;
  projeto: number;
  projeto_nome: string;
  sprint: number | null;
  sprint_nome: string | null;
  score_final: string | null;
};

/** Opção de setor solicitante nos seletores da tela de Score. */
export type SetorSolicitanteOption = { value: string; label: string };

// ----------------------------------------------------------------------------
// Service
// ----------------------------------------------------------------------------

export const scoreService = {
  /** Setores que podem ser apontados como solicitantes — o catálogo real, o
   * mesmo que define o setor dos usuários, e não uma lista à parte. */
  async getSetoresSolicitantes(): Promise<SetorSolicitanteOption[]> {
    const setores = await userService.getSetores();
    return setores.map((s) => ({ value: s.codename, label: s.nome }));
  },

  // --- Critérios (formulário configurável) ---
  async getCriterios(apenasAtivos = false): Promise<ScoreCriterion[]> {
    const path = apenasAtivos ? '/score-criterios/?ativos=true' : '/score-criterios/';
    return fetchAllPaginated<ScoreCriterion>(path);
  },

  async createCriterio(data: ScoreCriterionInput): Promise<ScoreCriterion> {
    const response = await api.post<ScoreCriterion>('/score-criterios/', data);
    return response.data;
  },

  async updateCriterio(id: number, data: Partial<ScoreCriterionInput>): Promise<ScoreCriterion> {
    const response = await api.patch<ScoreCriterion>(`/score-criterios/${id}/`, data);
    return response.data;
  },

  async deleteCriterio(id: number): Promise<void> {
    await api.delete(`/score-criterios/${id}/`);
  },

  /** Reordena os critérios pela lista de ids (index vira a nova ordem). */
  async reorderCriterios(ids: number[]): Promise<void> {
    await api.post('/score-criterios/reorder/', { order: ids });
  },

  // --- Scores dos cards ---
  async getScores(): Promise<CardScore[]> {
    return fetchAllPaginated<CardScore>('/card-scores/');
  },

  /** Lista leve de cards para o seletor (uma request, sem paginação). */
  /**
   * Uma PAGINA de cards do seletor, filtrada NO SERVIDOR.
   *
   * Nao existe mais "todos os cards": eram 1515, ~1 MB, e o modal desenha um
   * preview por card. Os filtros vao como parametro porque paginar e filtrar em
   * memoria faria a busca enxergar so a pagina carregada — digitar o nome de um
   * card da pagina 20 nao acharia nada, e pareceria que o card nao existe.
   */
  async getPickableCardsPage(params: {
    q?: string;
    responsavel?: string;
    sprint?: string;
    pageSize?: number;
  } = {}): Promise<PaginatedResponse<PickableCard>> {
    const response = await api.get<PaginatedResponse<PickableCard>>(
      '/card-scores/pickable-cards/',
      {
        params: {
          page_size: params.pageSize ?? 40,
          ...(params.q ? { q: params.q } : {}),
          ...(params.responsavel ? { responsavel: params.responsavel } : {}),
          ...(params.sprint ? { sprint: params.sprint } : {}),
        },
      },
    );
    return response.data;
  },

  /** A proxima pagina, pelo `next` que a resposta anterior trouxe. */
  async getPickableCardsNext(url: string): Promise<PaginatedResponse<PickableCard>> {
    const response = await api.get<PaginatedResponse<PickableCard>>(url);
    return response.data;
  },

  /**
   * As opcoes dos filtros do seletor.
   *
   * Endpoint proprio porque elas NAO podem sair da pagina carregada: montar a
   * lista de responsaveis varrendo os cards em maos funcionava quando o modal
   * tinha todos. Paginando, o dropdown ofereceria so os das paginas buscadas, e
   * um nome que falta num filtro nao parece defeito — parece que a pessoa nao
   * tem card.
   */
  async getPickableFilters(): Promise<{
    sprints: { value: string; label: string }[];
    responsaveis: { value: string; label: string; role: string }[];
  }> {
    const response = await api.get('/card-scores/pickable-filters/');
    return response.data;
  },

  /** Cria (ou atualiza, se o card já tiver score) via POST idempotente. */
  async saveScore(data: CardScoreInput): Promise<CardScore> {
    const response = await api.post<CardScore>('/card-scores/', data);
    return response.data;
  },

  async updateScore(id: number, data: Partial<CardScoreInput>): Promise<CardScore> {
    const response = await api.patch<CardScore>(`/card-scores/${id}/`, data);
    return response.data;
  },

  async deleteScore(id: number): Promise<void> {
    await api.delete(`/card-scores/${id}/`);
  },
};

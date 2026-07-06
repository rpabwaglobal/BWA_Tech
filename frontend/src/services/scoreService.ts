import api, { fetchAllPaginated } from './api';

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

// Setores solicitantes (espelha SetorSolicitante no backend).
export const SETORES_SOLICITANTES: Array<{ value: string; label: string }> = [
  { value: 'fiscal', label: 'Fiscal' },
  { value: 'contabil', label: 'Contábil' },
  { value: 'marketing', label: 'Marketing' },
  { value: 'legalizacao', label: 'Legalização' },
  { value: 'pessoal', label: 'Pessoal' },
  { value: 'diretoria', label: 'Diretoria' },
  { value: 'novos_negocios', label: 'Novos Negócios' },
  { value: 'rh', label: 'RH' },
];

// ----------------------------------------------------------------------------
// Service
// ----------------------------------------------------------------------------

export const scoreService = {
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
  async getPickableCards(): Promise<PickableCard[]> {
    const response = await api.get<PickableCard[]>('/card-scores/pickable-cards/');
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

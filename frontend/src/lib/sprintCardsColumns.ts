import type { Card as CardType, ProjectDetail } from '@/services/cardService';
import { formatMinutosUteis, formatSegundosCorridos } from '@/lib/dateUtils';

export type ColumnGroup = 'card' | 'projeto' | 'sprint';

export type ColumnDefinition = {
  id: string;
  label: string;
  group: ColumnGroup;
  getValue: (ctx: { card: CardType }) => unknown;
};

const safeToString = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const getProject = (card: CardType): ProjectDetail | undefined => card.projeto_detail;
const getSprintDetail = (card: CardType): any => getProject(card)?.sprint_detail;

/**
 * Colunas disponíveis na visualização em Lista de `SprintDetails`.
 * IDs são estáveis e usados para persistência (localStorage) e export.
 */
export const SPRINT_CARDS_COLUMN_DEFS: ColumnDefinition[] = [
  // Card
  { id: 'card.id', label: 'Card ID', group: 'card', getValue: ({ card }) => card.id },
  { id: 'card.nome', label: 'Card Nome', group: 'card', getValue: ({ card }) => card.nome },
  { id: 'card.descricao', label: 'Card Descrição', group: 'card', getValue: ({ card }) => card.descricao },
  { id: 'card.script_url', label: 'Card Script URL', group: 'card', getValue: ({ card }) => card.script_url || '' },
  { id: 'card.projeto_id', label: 'Card Projeto ID', group: 'card', getValue: ({ card }) => card.projeto },
  { id: 'card.area', label: 'Card Área', group: 'card', getValue: ({ card }) => card.area },
  { id: 'card.area_display', label: 'Card Área (Display)', group: 'card', getValue: ({ card }) => card.area_display },
  { id: 'card.tipo', label: 'Card Tipo', group: 'card', getValue: ({ card }) => card.tipo },
  { id: 'card.tipo_display', label: 'Card Tipo (Display)', group: 'card', getValue: ({ card }) => card.tipo_display },
  { id: 'card.responsavel', label: 'Card Responsável ID', group: 'card', getValue: ({ card }) => card.responsavel || '' },
  { id: 'card.responsavel_name', label: 'Card Responsável', group: 'card', getValue: ({ card }) => card.responsavel_name },
  { id: 'card.responsavel_profile_picture_url', label: 'Card Responsável Foto URL', group: 'card', getValue: ({ card }) => card.responsavel_profile_picture_url || '' },
  { id: 'card.criado_por', label: 'Card Criado por ID', group: 'card', getValue: ({ card }) => card.criado_por || '' },
  { id: 'card.criado_por_name', label: 'Card Criado por', group: 'card', getValue: ({ card }) => card.criado_por_name },
  { id: 'card.criado_por_profile_picture_url', label: 'Card Criado por Foto URL', group: 'card', getValue: ({ card }) => card.criado_por_profile_picture_url || '' },
  { id: 'card.status', label: 'Card Status', group: 'card', getValue: ({ card }) => card.status },
  { id: 'card.status_display', label: 'Card Status (Display)', group: 'card', getValue: ({ card }) => card.status_display },
  { id: 'card.prioridade', label: 'Card Prioridade', group: 'card', getValue: ({ card }) => card.prioridade },
  { id: 'card.prioridade_display', label: 'Card Prioridade (Display)', group: 'card', getValue: ({ card }) => card.prioridade_display },
  { id: 'card.data_inicio', label: 'Card Data Início', group: 'card', getValue: ({ card }) => card.data_inicio },
  { id: 'card.data_fim', label: 'Card Data Fim', group: 'card', getValue: ({ card }) => card.data_fim },
  { id: 'card.finalizado_em', label: 'Card Finalizado em', group: 'card', getValue: ({ card }) => card.finalizado_em },
  { id: 'card.dias_corridos_desenvolvimento', label: 'Dias corridos (dev)', group: 'card', getValue: ({ card }) => card.dias_corridos_desenvolvimento ?? formatSegundosCorridos(card.segundos_corridos_desenvolvimento) },
  { id: 'card.dias_uteis_desenvolvimento', label: 'Dias úteis (dev)', group: 'card', getValue: ({ card }) => card.dias_uteis_desenvolvimento ?? '' },
  { id: 'card.horas_uteis_desenvolvimento', label: 'Horas úteis (dev)', group: 'card', getValue: ({ card }) => card.horas_uteis_desenvolvimento ?? formatMinutosUteis(card.minutos_uteis_desenvolvimento) },
  { id: 'card.complexidade_selected_items', label: 'Complexidade (selected_items)', group: 'card', getValue: ({ card }) => safeToString(card.complexidade_selected_items) },
  { id: 'card.complexidade_selected_development', label: 'Complexidade (selected_development)', group: 'card', getValue: ({ card }) => card.complexidade_selected_development },
  { id: 'card.complexidade_custom_items', label: 'Complexidade (custom_items)', group: 'card', getValue: ({ card }) => safeToString(card.complexidade_custom_items) },
  { id: 'card.card_comment', label: 'Card Comentário', group: 'card', getValue: ({ card }) => card.card_comment || '' },
  { id: 'card.events_count', label: 'Card Events Count', group: 'card', getValue: ({ card }) => card.events_count ?? '' },
  { id: 'card.created_at', label: 'Card Criado em', group: 'card', getValue: ({ card }) => card.created_at },
  { id: 'card.updated_at', label: 'Card Atualizado em', group: 'card', getValue: ({ card }) => card.updated_at },

  // Projeto (via projeto_detail)
  { id: 'projeto.id', label: 'Projeto ID', group: 'projeto', getValue: ({ card }) => getProject(card)?.id || '' },
  { id: 'projeto.nome', label: 'Projeto Nome', group: 'projeto', getValue: ({ card }) => getProject(card)?.nome || '' },
  { id: 'projeto.descricao', label: 'Projeto Descrição', group: 'projeto', getValue: ({ card }) => getProject(card)?.descricao || '' },
  { id: 'projeto.sprint_id', label: 'Projeto Sprint ID', group: 'projeto', getValue: ({ card }) => getProject(card)?.sprint || '' },
  { id: 'projeto.status', label: 'Projeto Status', group: 'projeto', getValue: ({ card }) => getProject(card)?.status || '' },
  { id: 'projeto.status_display', label: 'Projeto Status (Display)', group: 'projeto', getValue: ({ card }) => getProject(card)?.status_display || '' },
  { id: 'projeto.gerente_atribuido', label: 'Projeto Gerente ID', group: 'projeto', getValue: ({ card }) => getProject(card)?.gerente_atribuido || '' },
  { id: 'projeto.gerente_name', label: 'Projeto Gerente', group: 'projeto', getValue: ({ card }) => getProject(card)?.gerente_name || '' },
  { id: 'projeto.desenvolvedor', label: 'Projeto Desenvolvedor ID', group: 'projeto', getValue: ({ card }) => getProject(card)?.desenvolvedor || '' },
  { id: 'projeto.desenvolvedor_name', label: 'Projeto Desenvolvedor', group: 'projeto', getValue: ({ card }) => getProject(card)?.desenvolvedor_name || '' },
  { id: 'projeto.data_criacao', label: 'Projeto Criado em', group: 'projeto', getValue: ({ card }) => (getProject(card) as any)?.data_criacao || '' },
  { id: 'projeto.data_avaliacao', label: 'Projeto Data Avaliação', group: 'projeto', getValue: ({ card }) => (getProject(card) as any)?.data_avaliacao || '' },
  { id: 'projeto.data_atribuicao_gerente', label: 'Projeto Data Atrib. Gerente', group: 'projeto', getValue: ({ card }) => (getProject(card) as any)?.data_atribuicao_gerente || '' },
  { id: 'projeto.data_inicio_desenvolvimento', label: 'Projeto Data Início Dev', group: 'projeto', getValue: ({ card }) => (getProject(card) as any)?.data_inicio_desenvolvimento || '' },
  { id: 'projeto.data_entrega', label: 'Projeto Data Entrega', group: 'projeto', getValue: ({ card }) => (getProject(card) as any)?.data_entrega || '' },
  { id: 'projeto.data_homologacao', label: 'Projeto Data Homologação', group: 'projeto', getValue: ({ card }) => (getProject(card) as any)?.data_homologacao || '' },
  { id: 'projeto.data_adiamento_solicitada', label: 'Projeto Data Adiamento Solic.', group: 'projeto', getValue: ({ card }) => (getProject(card) as any)?.data_adiamento_solicitada || '' },
  { id: 'projeto.nova_data_prevista', label: 'Projeto Nova Data Prevista', group: 'projeto', getValue: ({ card }) => (getProject(card) as any)?.nova_data_prevista || '' },
  { id: 'projeto.adiamento_aprovado', label: 'Projeto Adiamento Aprovado', group: 'projeto', getValue: ({ card }) => (getProject(card) as any)?.adiamento_aprovado ?? '' },
  { id: 'projeto.cards_count', label: 'Projeto Cards Count', group: 'projeto', getValue: ({ card }) => (getProject(card) as any)?.cards_count ?? '' },

  // Sprint (via sprint_detail)
  { id: 'sprint.id', label: 'Sprint ID', group: 'sprint', getValue: ({ card }) => getSprintDetail(card)?.id || '' },
  { id: 'sprint.nome', label: 'Sprint Nome', group: 'sprint', getValue: ({ card }) => getSprintDetail(card)?.nome || '' },
  { id: 'sprint.data_inicio', label: 'Sprint Data Início', group: 'sprint', getValue: ({ card }) => getSprintDetail(card)?.data_inicio || '' },
  { id: 'sprint.data_fim', label: 'Sprint Dia Fim (derivado)', group: 'sprint', getValue: ({ card }) => getSprintDetail(card)?.data_fim || '' },
  { id: 'sprint.fechamento_em', label: 'Sprint Fechamento (data/hora)', group: 'sprint', getValue: ({ card }) => getSprintDetail(card)?.fechamento_em || '' },
  { id: 'sprint.duracao_dias', label: 'Sprint Duração (dias)', group: 'sprint', getValue: ({ card }) => getSprintDetail(card)?.duracao_dias || '' },
  { id: 'sprint.supervisor', label: 'Sprint Supervisor ID', group: 'sprint', getValue: ({ card }) => getSprintDetail(card)?.supervisor || '' },
  { id: 'sprint.supervisor_name', label: 'Sprint Supervisor', group: 'sprint', getValue: ({ card }) => getSprintDetail(card)?.supervisor_name || '' },
  { id: 'sprint.finalizada', label: 'Sprint Finalizada', group: 'sprint', getValue: ({ card }) => getSprintDetail(card)?.finalizada ?? '' },
];

export const SPRINT_CARDS_COLUMN_IDS = SPRINT_CARDS_COLUMN_DEFS.map((c) => c.id);

export const getColumnDefsByGroup = (group: ColumnGroup) =>
  SPRINT_CARDS_COLUMN_DEFS.filter((c) => c.group === group);

export const formatColumnValueForDisplay = (value: unknown): string => safeToString(value);


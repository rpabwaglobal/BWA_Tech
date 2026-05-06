import type { ChamadoSuporte } from '@/services/suporteService';
import { catalogNome, hasPendenciaMarker, stripPendenciaMarker } from '@/services/suporteService';
import { formatDateTime } from '@/lib/dateUtils';

export type SuporteColumnGroup = 'ticket' | 'solicitante';

export type SuporteColumnDefinition = {
  id: string;
  label: string;
  group: SuporteColumnGroup;
  getValue: (ctx: { chamado: ChamadoSuporte }) => unknown;
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

export const formatSuporteColumnValueForDisplay = (value: unknown): string => safeToString(value);

function normalizeStatusEtapa(status: ChamadoSuporte['status'] | string | undefined): string {
  return String(status ?? '').trim().toLowerCase();
}

type SuporteStageKey =
  | 'a_desenvolver'
  | 'em_desenvolvimento'
  | 'parado_pendencias'
  | 'inviabilizado'
  | 'finalizado';

const ETAPA_QUADRO_LABELS: Record<SuporteStageKey, string> = {
  a_desenvolver: 'A desenvolver',
  em_desenvolvimento: 'Em desenvolvimento',
  parado_pendencias: 'Parado por pendências',
  inviabilizado: 'Inviabilizado',
  finalizado: 'Concluído',
};

function chamadoToStageKey(c: ChamadoSuporte): SuporteStageKey {
  const desc = c.descricao_resolucao ?? '';
  const pendencia = hasPendenciaMarker(desc);
  const st = normalizeStatusEtapa(c.status);

  if (st === 'resolvido') return 'finalizado';
  if (st === 'cancelado') return 'inviabilizado';
  if (st === 'aberto') return 'a_desenvolver';
  if (st === 'em andamento') {
    if (pendencia) return 'parado_pendencias';
    return 'em_desenvolvimento';
  }
  return 'a_desenvolver';
}

function formatChamadoDt(iso?: string | null): string {
  const s = iso?.trim();
  if (!s) return '';
  const out = formatDateTime(s);
  return out === 'N/A' ? '' : out;
}

/**
 * Colunas disponíveis na visualização em Lista da página Suporte.
 * IDs são estáveis e usados para persistência (localStorage) e export.
 */
export const SUPORTE_CHAMADOS_COLUMN_DEFS: SuporteColumnDefinition[] = [
  {
    id: 'chamado.id',
    label: 'Ticket nº',
    group: 'ticket',
    getValue: ({ chamado }) => chamado.id,
  },
  {
    id: 'chamado.etapa_quadro',
    label: 'Etapa no quadro',
    group: 'ticket',
    getValue: ({ chamado }) => ETAPA_QUADRO_LABELS[chamadoToStageKey(chamado)],
  },
  {
    id: 'chamado.status',
    label: 'Status (API)',
    group: 'ticket',
    getValue: ({ chamado }) => chamado.status,
  },
  {
    id: 'chamado.tipo',
    label: 'Tipo',
    group: 'ticket',
    getValue: ({ chamado }) => catalogNome(chamado.tipo),
  },
  {
    id: 'chamado.item',
    label: 'Item',
    group: 'ticket',
    getValue: ({ chamado }) => catalogNome(chamado.item),
  },
  {
    id: 'chamado.motivo',
    label: 'Motivo',
    group: 'ticket',
    getValue: ({ chamado }) => catalogNome(chamado.motivo),
  },
  {
    id: 'chamado.descricao',
    label: 'Descrição',
    group: 'ticket',
    getValue: ({ chamado }) => chamado.descricao ?? '',
  },
  {
    id: 'chamado.responsavel_solucao',
    label: 'Responsável pelo ticket',
    group: 'ticket',
    getValue: ({ chamado }) => chamado.responsavel_solucao ?? '',
  },
  {
    id: 'chamado.responsavel',
    label: 'Responsável (pedido)',
    group: 'ticket',
    getValue: ({ chamado }) => chamado.responsavel ?? '',
  },
  {
    id: 'chamado.descricao_resolucao',
    label: 'Notas de resolução',
    group: 'ticket',
    getValue: ({ chamado }) => stripPendenciaMarker(chamado.descricao_resolucao ?? '').trim(),
  },
  {
    id: 'chamado.anexo_url',
    label: 'URL do anexo',
    group: 'ticket',
    getValue: ({ chamado }) => chamado.anexo_url ?? '',
  },
  {
    id: 'chamado.usuario_notificado',
    label: 'Usuário notificado',
    group: 'ticket',
    getValue: ({ chamado }) => (chamado.usuario_notificado ? 'Sim' : 'Não'),
  },
  {
    id: 'chamado.data_abertura',
    label: 'Aberto em',
    group: 'ticket',
    getValue: ({ chamado }) => formatChamadoDt(chamado.data_abertura),
  },
  {
    id: 'chamado.data_atualizacao',
    label: 'Atualizado em',
    group: 'ticket',
    getValue: ({ chamado }) => formatChamadoDt(chamado.data_atualizacao),
  },

  {
    id: 'chamado.usuario_nome',
    label: 'Solicitante',
    group: 'solicitante',
    getValue: ({ chamado }) => chamado.usuario_nome ?? '',
  },
  {
    id: 'chamado.usuario_email',
    label: 'E-mail do solicitante',
    group: 'solicitante',
    getValue: ({ chamado }) => chamado.usuario_email ?? '',
  },
  {
    id: 'chamado.usuario_setor',
    label: 'Setor',
    group: 'solicitante',
    getValue: ({ chamado }) => chamado.usuario_setor ?? '',
  },
  {
    id: 'chamado.empresa',
    label: 'Empresa',
    group: 'solicitante',
    getValue: ({ chamado }) => chamado.empresa ?? '',
  },
];

export const SUPORTE_CHAMADOS_COLUMN_IDS = SUPORTE_CHAMADOS_COLUMN_DEFS.map((c) => c.id);

export const getSuporteColumnDefsByGroup = (group: SuporteColumnGroup) =>
  SUPORTE_CHAMADOS_COLUMN_DEFS.filter((c) => c.group === group);

import type { ChamadoSuporte } from '@/services/suporteService';
import { suporteTimelineService } from '@/services/suporteTimelineService';

async function postTimelineSafe(
  payload: Parameters<typeof suporteTimelineService.create>[0],
): Promise<void> {
  try {
    await suporteTimelineService.create(payload);
  } catch {
    /* não bloqueia fluxo principal do suporte */
  }
}

/** Texto exibido na timeline quando o ticket é criado (registro inicial). */
export async function logSuporteTicketCriado(chamadoId: number, descricao?: string): Promise<void> {
  await postTimelineSafe({
    chamado_id: chamadoId,
    tipo_evento: 'criado',
    descricao: descricao?.trim() || 'Ticket criado.',
  });
}

export type SuporteStageLabelFn = (c: ChamadoSuporte) => string;

function normResp(v: string | null | undefined): string {
  return (v ?? '').trim();
}

/**
 * Registra na timeline local (BWA) mudanças de etapa do quadro, responsável e notificação.
 * O usuário que realizou a ação vem do token na API (campo `usuario` da entrada).
 */
export async function logSuporteChamadoChanges(
  before: ChamadoSuporte,
  after: ChamadoSuporte,
  getKanbanStageLabel: SuporteStageLabelFn,
): Promise<void> {
  if (before.id !== after.id) return;

  const id = after.id;
  const fromStage = getKanbanStageLabel(before);
  const toStage = getKanbanStageLabel(after);
  if (fromStage !== toStage) {
    await postTimelineSafe({
      chamado_id: id,
      tipo_evento: 'etapa_alterada',
      descricao: `Etapa do quadro: "${fromStage}" → "${toStage}".`,
    });
  }

  const rOld = normResp(before.responsavel_solucao);
  const rNew = normResp(after.responsavel_solucao);
  if (rOld !== rNew) {
    await postTimelineSafe({
      chamado_id: id,
      tipo_evento: 'responsavel_alterado',
      descricao: `Responsável pelo ticket: "${rOld || '—'}" → "${rNew || '—'}".`,
    });
  }

  const nOld = Boolean(before.usuario_notificado);
  const nNew = Boolean(after.usuario_notificado);
  if (nOld !== nNew) {
    await postTimelineSafe({
      chamado_id: id,
      tipo_evento: 'notificacao',
      descricao: nNew
        ? 'Solicitante marcado como notificado.'
        : 'Notificação ao solicitante desmarcada.',
    });
  }
}

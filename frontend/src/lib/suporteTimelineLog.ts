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

export type SuporteStageLabelFn = (c: ChamadoSuporte) => string;
/** Devolve a CHAVE da etapa (`finalizado`, `em_desenvolvimento`, …). */
export type SuporteStageKeyFn = (c: ChamadoSuporte) => string;

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
  /** OBRIGATÓRIA de propósito. Deixá-la opcional faria um chamador esquecido
   *  gravar o evento sem a chave, e aquele chamado sumiria da contagem de
   *  resolvidos dos relatórios sem erro nenhum — o defeito que este campo veio
   *  consertar. Obrigatória, o TypeScript cobra em cada um dos chamadores. */
  getKanbanStageKey: SuporteStageKeyFn,
): Promise<void> {
  if (before.id !== after.id) return;

  const id = after.id;
  const fromStage = getKanbanStageLabel(before);
  const toStage = getKanbanStageLabel(after);
  if (fromStage !== toStage) {
    await postTimelineSafe({
      chamado_id: id,
      tipo_evento: 'etapa_alterada',
      // O rótulo vai na descrição, para quem lê a timeline na tela. A CHAVE vai
      // no campo próprio, para o relatório não precisar ler o texto.
      descricao: `Etapa do quadro: "${fromStage}" → "${toStage}".`,
      etapa_destino: getKanbanStageKey(after),
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

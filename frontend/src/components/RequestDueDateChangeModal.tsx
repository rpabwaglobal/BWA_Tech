import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DateTimePicker } from '@/components/ui/datetime-picker';
import { cardService, CARD_STATUSES, type Card as CardType } from '@/services/cardService';
import { cardDateChangeRequestService } from '@/services/cardDateChangeRequestService';
import { sprintService } from '@/services/sprintService';
import { formatDateTime } from '@/lib/dateUtils';
import { ATRASADO_STATUS_BADGE, EM_DIA_STATUS_BADGE } from '@/lib/dueDateBadgeClasses';
import { fechamentoIsoToDatetimeLocal, getSprintIdsEmAndamentoJanela } from '@/lib/sprintFechamento';
import { cn } from '@/lib/utils';

/** Compara só a data local (início do dia) para “em dia” / “atrasado” em qualquer etapa ativa. */
function isEntregaAtrasada(card: CardType): boolean {
  if (!card.data_fim) return false;
  const end = new Date(card.data_fim);
  end.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return end < today;
}

/** Formato aceito pelo backend (datetime ISO local com segundos). */
function requestedDatetimeForApi(local: string): string {
  const t = local.trim();
  if (!t) return '';
  if (/T\d{2}:\d{2}$/.test(t)) return `${t}:00`;
  return t;
}

function cardStageLabel(card: CardType): string {
  const d = card.status_display?.trim();
  if (d) return d;
  return CARD_STATUSES.find((s) => s.value === card.status)?.label ?? card.status;
}

function isSuggestionProjeto(card: CardType): boolean {
  return card.projeto_detail?.nome === 'Sugestões';
}

/**
 * Cards elegíveis: data de entrega preenchida, não concluídos, atribuídos ao solicitante,
 * projeto numa sprint da janela ativa (calendário + fechamento, alinhado ao Dashboard).
 */
export function filterCardsEligibleForDueDateRequest(
  cards: CardType[],
  options: { allowedSprintIds: Set<string>; requesterUserId: string },
): CardType[] {
  const allowed = options.allowedSprintIds;
  const uid = String(options.requesterUserId);

  return cards.filter((c) => {
    if (!c.data_fim) return false;
    if (['finalizado', 'inviabilizado'].includes(c.status)) return false;
    if (!c.responsavel || String(c.responsavel) !== uid) return false;
    if (isSuggestionProjeto(c)) return false;

    const sprintRef = c.projeto_detail?.sprint;
    if (!sprintRef) return false;
    if (allowed.size === 0) return false;
    if (!allowed.has(String(sprintRef))) return false;

    return true;
  });
}

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preselectedCardId?: string | null;
  onCreated?: () => void;
};

export function RequestDueDateChangeModal({
  open,
  onOpenChange,
  preselectedCardId,
  onCreated,
}: Props) {
  const { user } = useAuth();
  const [loadingCards, setLoadingCards] = useState(false);
  const [cards, setCards] = useState<CardType[]>([]);
  const [hasActiveSprintWindow, setHasActiveSprintWindow] = useState(false);

  const [selectedCardId, setSelectedCardId] = useState<string>('');
  const [requestedDate, setRequestedDate] = useState<string>('');
  const [reason, setReason] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    if (!open) return;
    setError('');
    setReason('');
    setRequestedDate('');
    setSelectedCardId('');
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (!user?.id) return;
    void (async () => {
      setLoadingCards(true);
      try {
        const [sprints, data] = await Promise.all([
          sprintService.getAll().catch(() => []),
          cardService.getByResponsavel(String(user.id)),
        ]);
        const allowedSprintIds = getSprintIdsEmAndamentoJanela(sprints);
        setHasActiveSprintWindow(allowedSprintIds.size > 0);

        const list = Array.isArray(data) ? data : [];
        const eligible = filterCardsEligibleForDueDateRequest(list, {
          allowedSprintIds,
          requesterUserId: String(user.id),
        }).sort((a, b) => (a.nome || '').localeCompare(b.nome || '', 'pt-BR'));
        setCards(eligible);
        const pre = preselectedCardId ? String(preselectedCardId) : '';
        if (pre && eligible.some((c) => String(c.id) === pre)) {
          setSelectedCardId(pre);
        } else {
          setSelectedCardId('');
        }
      } catch (e) {
        setCards([]);
        setSelectedCardId('');
        setHasActiveSprintWindow(false);
      } finally {
        setLoadingCards(false);
      }
    })();
  }, [open, user?.id, preselectedCardId]);

  const selectedCard = useMemo(() => {
    return cards.find((c) => String(c.id) === String(selectedCardId)) || null;
  }, [cards, selectedCardId]);

  const canSubmit = !!selectedCardId && !!requestedDate && !saving;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    setError('');
    try {
      await cardDateChangeRequestService.create({
        card: String(selectedCardId),
        requested_date: requestedDatetimeForApi(requestedDate),
        reason: reason?.trim() ? reason.trim() : null,
      });
      onOpenChange(false);
      onCreated?.();
    } catch (err: any) {
      const respData = err?.response?.data ?? {};

      const responsavelAtual = selectedCard?.responsavel_name
        ? String(selectedCard.responsavel_name)
        : selectedCard?.responsavel
          ? String(selectedCard.responsavel)
          : 'não disponível';
      const dataFimAtual = selectedCard?.data_fim ? String(selectedCard.data_fim) : 'não preenchida';

      const candidateMessages: string[] = [];

      if (typeof respData?.detail === 'string') {
        candidateMessages.push(respData.detail);
      }

      for (const key of ['card', 'requested_date', 'requestedDate']) {
        const v = respData?.[key];
        if (typeof v === 'string') candidateMessages.push(v);
        if (Array.isArray(v) && typeof v[0] === 'string') candidateMessages.push(v[0]);
      }

      if (candidateMessages.length === 0) {
        try {
          const asString = JSON.stringify(respData);
          if (typeof asString === 'string') candidateMessages.push(asString);
        } catch {
          // ignore
        }
      }

      const detailStr = candidateMessages[0] ?? '';
      const detailLower = detailStr.toLowerCase();

      const hasRequestedByError = typeof respData?.requested_by !== 'undefined';

      const needsResponsavel =
        hasRequestedByError ||
        detailLower.includes('atribu') ||
        detailLower.includes('você só pode') ||
        detailLower.includes('atribuído a você');

      const needsDataFim =
        detailLower.includes('data_fim') ||
        detailLower.includes('data de entrega') ||
        detailLower.includes('entrega registrada') ||
        detailLower.includes('data de entrega registrada') ||
        detailLower.includes('data de entrega do card');

      if (needsResponsavel && !needsDataFim) {
        setError(
          `Ajuste necessário: o card precisa estar atribuído a você. Responsável atual: ${responsavelAtual}.`,
        );
        return;
      }

      if (needsDataFim && !needsResponsavel) {
        setError(
          `Ajuste necessário: preencha a “Data e Hora de Entrega” (data_fim). Data atual: ${dataFimAtual}.`,
        );
        return;
      }

      if (needsResponsavel && needsDataFim) {
        setError(
          `Ajustes necessários no card.\nResponsável atual: ${responsavelAtual}.\nData atual: ${dataFimAtual}.`,
        );
        return;
      }

      if (detailStr && detailStr !== '{}') {
        setError(detailStr);
        return;
      }

      setError(
        'Não foi possível criar a solicitação. Ajuste no card o responsável (Responsável) e/ou a “Data e Hora de Entrega” (data_fim) e tente novamente.',
      );
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" onClose={() => onOpenChange(false)}>
        <DialogHeader>
          <DialogTitle>Solicitar reajuste de data</DialogTitle>
          <DialogDescription>
            Escolha um dos seus cards não concluídos com data de entrega, pertencentes à sprint atual em
            andamento (janela entre início e fechamento). Informe a nova data e hora; o motivo é opcional.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-2 space-y-4">
          <div className="space-y-2">
            <Label>Card</Label>
            {loadingCards ? (
              <p className="text-sm text-[var(--color-muted-foreground)] py-3">Carregando cards...</p>
            ) : cards.length === 0 ? (
              <p className="text-sm text-[var(--color-muted-foreground)]">
                {!hasActiveSprintWindow
                  ? 'Não há sprint em andamento no calendário neste momento (fora da janela entre início e fechamento ou sem sprint ativa).'
                  : 'Nenhum dos seus cards nesta sprint em andamento está elegível: precisa ter data de entrega, estar atribuído a você e não estar finalizado ou inviabilizado.'}
              </p>
            ) : (
              <div
                role="listbox"
                aria-label="Selecionar card"
                className="max-h-[min(320px,50vh)] overflow-y-auto rounded-[10px] border border-[var(--color-border)] bg-[var(--color-background)] p-1.5 [scrollbar-gutter:stable]"
              >
                <div className="flex flex-col gap-2">
                  {cards.map((c) => {
                    const id = String(c.id);
                    const selected = selectedCardId === id;
                    const atrasado = isEntregaAtrasada(c);
                    return (
                      <button
                        key={id}
                        type="button"
                        role="option"
                        aria-selected={selected}
                        disabled={saving}
                        onClick={() => setSelectedCardId(id)}
                        className={cn(
                          'w-full rounded-[8px] border px-3 py-2.5 text-left transition-colors',
                          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-background)]',
                          selected
                            ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/8 shadow-sm'
                            : 'border-[var(--color-border)] hover:bg-[var(--color-accent)]',
                        )}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1 space-y-1.5">
                            {/* Linha 1: apenas nome do card */}
                            <p className="text-sm font-semibold leading-snug text-[var(--color-foreground)]">
                              {c.nome}
                            </p>
                            {/* Linha 2: data de entrega atual e atrasado / em dia */}
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                              <span className="text-[var(--color-muted-foreground)]">
                                Entrega atual:{' '}
                                <span className="font-medium text-[var(--color-foreground)]">
                                  {c.data_fim ? formatDateTime(c.data_fim) : '—'}
                                </span>
                              </span>
                              {atrasado ? (
                                <Badge variant="outline" className={ATRASADO_STATUS_BADGE}>
                                  Atrasado
                                </Badge>
                              ) : (
                                <Badge variant="outline" className={EM_DIA_STATUS_BADGE}>
                                  Em dia
                                </Badge>
                              )}
                            </div>
                            {/* Linha 3: projeto e etapa */}
                            <p className="text-xs leading-snug text-[var(--color-muted-foreground)]">
                              <span>
                                Projeto:{' '}
                                <span className="font-medium text-[var(--color-foreground)]">
                                  {c.projeto_detail?.nome ?? '—'}
                                </span>
                              </span>
                              <span className="mx-1.5 text-[var(--color-border)]">|</span>
                              <span>
                                Etapa:{' '}
                                <span className="font-medium text-[var(--color-foreground)]">
                                  {cardStageLabel(c)}
                                </span>
                              </span>
                            </p>
                          </div>
                          <span
                            className={cn(
                              'mt-0.5 h-4 w-4 shrink-0 rounded-full border-2',
                              selected
                                ? 'border-[var(--color-primary)] bg-[var(--color-primary)]'
                                : 'border-[var(--color-border)] bg-transparent',
                            )}
                            aria-hidden
                          />
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            {selectedCard && (
              <p className="text-[11px] leading-relaxed text-[var(--color-muted-foreground)]">
                Selecionado: <span className="font-medium text-[var(--color-foreground)]">{selectedCard.nome}</span>
                {selectedCard.projeto_detail?.nome ? ` · ${selectedCard.projeto_detail.nome}` : ''}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="due-date-request-datetime">Nova data e hora de entrega</Label>
            <DateTimePicker
              id="due-date-request-datetime"
              pickerTitle="Nova data e hora de entrega"
              value={requestedDate}
              onChange={(e) => setRequestedDate(e.target.value)}
              suggestedDate={
                selectedCard?.data_fim ? fechamentoIsoToDatetimeLocal(selectedCard.data_fim) : undefined
              }
              disabled={saving}
              className="border-[var(--color-border)]"
            />
          </div>

          <div className="space-y-2">
            <Label>Motivo (opcional)</Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Descreva o motivo da mudança de data (opcional)"
              disabled={saving}
            />
          </div>

          {error && (
            <div className="rounded-[8px] border border-red-200 bg-red-50 p-2 text-sm text-[var(--color-destructive)]">
              {error}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {saving ? 'Enviando...' : 'Criar solicitação'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

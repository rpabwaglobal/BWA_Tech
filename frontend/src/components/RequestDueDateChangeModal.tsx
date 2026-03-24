import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DatePicker } from '@/components/ui/date-picker';
import { cardService, CARD_STATUSES, type Card as CardType } from '@/services/cardService';
import { cardDateChangeRequestService } from '@/services/cardDateChangeRequestService';
import { formatDateTime } from '@/lib/dateUtils';
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

function cardStageLabel(card: CardType): string {
  const d = card.status_display?.trim();
  if (d) return d;
  return CARD_STATUSES.find((s) => s.value === card.status)?.label ?? card.status;
}

/**
 * Cards elegíveis: com data de entrega e não concluídos (qualquer etapa do Kanban).
 * Opcionalmente restringe à sprint da página (`sprintId`).
 */
export function filterCardsEligibleForDueDateRequest(
  cards: CardType[],
  options?: { sprintId?: string | null },
): CardType[] {
  const sid = options?.sprintId;
  const restrictSprint = sid != null && String(sid).length > 0;

  return cards.filter((c) => {
    if (!c.data_fim) return false;
    if (['finalizado', 'inviabilizado'].includes(c.status)) return false;

    if (restrictSprint) {
      const sprintRef = c.projeto_detail?.sprint;
      if (!sprintRef || String(sprintRef) !== String(sid)) return false;
    }

    return true;
  });
}

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preselectedCardId?: string | null;
  onCreated?: () => void;
  sprintId?: string | null;
};

export function RequestDueDateChangeModal({
  open,
  onOpenChange,
  preselectedCardId,
  onCreated,
  sprintId = null,
}: Props) {
  const { user } = useAuth();
  const [loadingCards, setLoadingCards] = useState(false);
  const [cards, setCards] = useState<CardType[]>([]);

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
        const data = await cardService.getByResponsavel(String(user.id));
        const list = Array.isArray(data) ? data : [];
        const eligible = filterCardsEligibleForDueDateRequest(list, { sprintId }).sort((a, b) =>
          (a.nome || '').localeCompare(b.nome || '', 'pt-BR'),
        );
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
      } finally {
        setLoadingCards(false);
      }
    })();
  }, [open, user?.id, sprintId, preselectedCardId]);

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
        requested_date: requestedDate,
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
            Escolha um dos seus cards não concluídos que tenham data de entrega (qualquer etapa)
            {sprintId ? ', desta sprint' : ''}. Informe a nova data; o motivo é opcional.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-2 space-y-4">
          <div className="space-y-2">
            <Label>Card</Label>
            {loadingCards ? (
              <p className="text-sm text-[var(--color-muted-foreground)] py-3">Carregando cards...</p>
            ) : cards.length === 0 ? (
              <p className="text-sm text-[var(--color-muted-foreground)]">
                Nenhum card não concluído com data de entrega
                {sprintId ? ' nesta sprint' : ''}.
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
                                <Badge
                                  variant="secondary"
                                  className="border border-rose-500/30 bg-rose-500/[0.12] text-[10px] px-1.5 py-0 font-medium text-rose-800 dark:border-rose-400/25 dark:bg-rose-500/15 dark:text-rose-200"
                                >
                                  Atrasado
                                </Badge>
                              ) : (
                                <Badge
                                  variant="secondary"
                                  className="border border-emerald-600/25 bg-emerald-600/10 text-[10px] px-1.5 py-0 text-emerald-800 dark:text-emerald-200"
                                >
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
            <Label>Nova data de entrega</Label>
            <DatePicker
              value={requestedDate}
              onChange={(e) => setRequestedDate(e.target.value)}
              title="Selecionar nova data de entrega"
              placeholder="Clique para selecionar a data"
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

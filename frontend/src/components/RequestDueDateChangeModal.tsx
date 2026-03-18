import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DatePicker } from '@/components/ui/date-picker';
import { cardService, type Card as CardType } from '@/services/cardService';
import { cardDateChangeRequestService } from '@/services/cardDateChangeRequestService';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preselectedCardId?: string | null;
  onCreated?: () => void;
};

export function RequestDueDateChangeModal({ open, onOpenChange, preselectedCardId, onCreated }: Props) {
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
    setSelectedCardId(preselectedCardId ? String(preselectedCardId) : '');
  }, [open, preselectedCardId]);

  useEffect(() => {
    if (!open) return;
    if (!user?.id) return;
    void (async () => {
      setLoadingCards(true);
      try {
        const data = await cardService.getByResponsavel(String(user.id));
        const eligible = (Array.isArray(data) ? data : [])
          .filter((c) => !!c.data_fim)
          .sort((a, b) => (a.nome || '').localeCompare(b.nome || '', 'pt-BR'));
        setCards(eligible);
      } catch (e) {
        setCards([]);
      } finally {
        setLoadingCards(false);
      }
    })();
  }, [open, user?.id]);

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

      // O backend pode retornar mensagens em formatos diferentes:
      // - PermissionDenied => { detail: "..." }
      // - ValidationError => { card: ["..."] } (sem vir em "detail")
      const candidateMessages: string[] = [];

      if (typeof respData?.detail === 'string') {
        candidateMessages.push(respData.detail);
      }

      // comuns em ValidationError({ field: message })
      for (const key of ['card', 'requested_date', 'requestedDate']) {
        const v = respData?.[key];
        if (typeof v === 'string') candidateMessages.push(v);
        if (Array.isArray(v) && typeof v[0] === 'string') candidateMessages.push(v[0]);
      }

      // fallback: tenta pegar qualquer string “parecida” no objeto
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

      // Mensagem deve indicar somente o campo que precisa ser alterado.
      if (needsResponsavel && !needsDataFim) {
        setError(
          `Ajuste necessário: o card precisa estar atribuído a você. Responsável atual: ${responsavelAtual}.`
        );
        return;
      }

      if (needsDataFim && !needsResponsavel) {
        setError(
          `Ajuste necessário: preencha a “Data e Hora de Entrega” (data_fim). Data atual: ${dataFimAtual}.`
        );
        return;
      }

      if (needsResponsavel && needsDataFim) {
        setError(
          `Ajustes necessários no card.\nResponsável atual: ${responsavelAtual}.\nData atual: ${dataFimAtual}.`
        );
        return;
      }

      // fallback: se vier alguma mensagem útil, mostramos ela; senão, mensagem focada.
      if (detailStr && detailStr !== '{}') {
        setError(detailStr);
        return;
      }

      setError(
        'Não foi possível criar a solicitação. Ajuste no card o responsável (Responsável) e/ou a “Data e Hora de Entrega” (data_fim) e tente novamente.'
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
            Escolha um card atribuído a você e informe a nova data de entrega. O motivo é opcional.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          <div className="space-y-2">
            <Label>Card</Label>
            <select
              className="flex h-[40px] w-full rounded-[8px] border border-[var(--color-input)] bg-[var(--color-background)] px-[16px] py-[8px] text-sm"
              value={selectedCardId}
              onChange={(e) => setSelectedCardId(e.target.value)}
              disabled={loadingCards || saving}
            >
              <option value="">{loadingCards ? 'Carregando cards...' : 'Selecione um card'}</option>
              {cards.map((c) => (
                <option key={String(c.id)} value={String(c.id)}>
                  {c.nome}
                </option>
              ))}
            </select>
            {selectedCard?.data_fim && (
              <p className="text-xs text-[var(--color-muted-foreground)]">
                Data atual: {selectedCard.data_fim}
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
            <div className="p-2 text-sm text-[var(--color-destructive)] bg-red-50 border border-red-200 rounded-[8px]">
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


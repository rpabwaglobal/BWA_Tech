import { useEffect, useMemo, useState } from 'react';
import { hasPermission } from '@/lib/permissions';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DateTimePicker } from '@/components/ui/datetime-picker';
import { cardService, CARD_STATUSES, type Card as CardType } from '@/services/cardService';
import { cardReopenRequestService } from '@/services/cardReopenRequestService';
import { formatDateTime } from '@/lib/dateUtils';
import { isSprintPastFechamento } from '@/lib/sprintFechamento';
import { cn } from '@/lib/utils';

/** Etapas que o backend considera "card fechado" (CardStatus.FINALIZADO / INVIABILIZADO). */
const CLOSED_CARD_STATUSES = ['finalizado', 'inviabilizado'];

/** Formato aceito pelo backend (datetime ISO local com segundos). */
function reopenDatetimeForApi(local: string): string {
  const t = local.trim();
  if (!t) return '';
  if (/T\d{2}:\d{2}$/.test(t)) return `${t}:00`;
  return t;
}

/**
 * Interpreta o valor do DateTimePicker (`YYYY-MM-DDTHH:mm`) como hora LOCAL.
 *
 * `new Date(string)` não serve: a mesma string é lida como UTC ou como local
 * dependendo do formato, e aqui o usuário digitou no relógio dele — é o mesmo
 * instante que `reopenDatetimeForApi` manda para o backend sem fuso.
 */
function parseReopenDatetimeLocal(local: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(local.trim());
  if (!m) return null;
  const d = new Date(
    Number(m[1]), Number(m[2]) - 1, Number(m[3]),
    Number(m[4]), Number(m[5]), Number(m[6] ?? '0'),
  );
  return Number.isNaN(d.getTime()) ? null : d;
}

function cardStageLabel(card: CardType): string {
  const d = card.status_display?.trim();
  if (d) return d;
  return CARD_STATUSES.find((s) => s.value === card.status)?.label ?? card.status;
}

/** Instante em que o card foi fechado, para o avaliador saber "desde quando". */
function cardFechadoEm(card: CardType): string | null {
  return card.finalizado_em || card.updated_at || null;
}

/**
 * O backend recusa a aprovação de card em sprint já encerrada (salvo quem tem
 * `manage_locked_cards`). Avisar aqui evita um pedido que nasce fadado ao 400.
 */
function cardEmSprintEncerrada(card: CardType): boolean {
  const sprint = card.projeto_detail?.sprint_detail;
  if (!sprint) return false;
  return isSprintPastFechamento(sprint);
}

/** Usuário do AuthContext, na fatia que estas regras realmente leem. */
type RequesterUser = { id?: string | number | null; permissions?: string[] } | null | undefined;

/**
 * Quem tem poder sobre card de terceiro. Espelha `perform_create` do
 * `CardReopenRequestViewSet`: `manage_others_cards` OU `approve_card_reopen`.
 * Autorização é sempre por permissão (has_perm), nunca por nome de cargo.
 */
function podePedirDeTerceiros(user: RequesterUser): boolean {
  return hasPermission(user, 'manage_others_cards') || hasPermission(user, 'approve_card_reopen');
}

/**
 * Decide, SEM rede, se este usuário pode pedir a reabertura DESTE card.
 *
 * A regra é a mesma do backend (`perform_create`), nem mais nem menos: card
 * FECHADO e (responsável OU `manage_others_cards` OU `approve_card_reopen`).
 * Divergir aqui só produziria um dos dois erros caros: oferecer um botão que
 * volta 403, ou esconder um pedido que o backend aceitaria.
 */
function podeSolicitarReaberturaDoCard(user: RequesterUser, card: CardType | null): boolean {
  if (!card) return false;
  if (!CLOSED_CARD_STATUSES.includes(card.status)) return false;
  const uid = user?.id != null ? String(user.id) : '';
  const ehResponsavel = !!card.responsavel && !!uid && String(card.responsavel) === uid;
  return ehResponsavel || podePedirDeTerceiros(user);
}

/**
 * Cards elegíveis para pedido de reabertura: FECHADOS (regra invertida em
 * relação ao pedido de reajuste de data, que só aceita card em aberto) e
 * atribuídos a quem está pedindo — o backend responde 403 para card de outra
 * pessoa. Não filtramos por sprint em andamento: card fechado quase sempre
 * está numa sprint que já virou, e esconder esses cards inviabilizaria o
 * fluxo inteiro.
 *
 * Só o SELETOR usa esta função (o caminho secundário, de quem entra pela
 * página de Projetos sem card em mãos). Quem abre a solicitação de dentro do
 * card não passa por lista nenhuma.
 */
function filterCardsEligibleForReopenRequest(
  cards: CardType[],
  options: {
    requesterUserId: string;
    cardIdsComPedidoPendente?: Set<string>;
    /** Quem tem poder sobre card de terceiro (`manage_others_cards` ou
     * `approve_card_reopen`) pede a reabertura de qualquer card fechado — a
     * mesma regra que o backend aplica. Sem isto a lista vinha vazia para o
     * gestor, que é justamente quem costuma notar que a entrega não estava
     * pronta. */
    podePedirDeTerceiros?: boolean;
  },
): CardType[] {
  const uid = String(options.requesterUserId);
  const pendentes = options.cardIdsComPedidoPendente ?? new Set<string>();

  return cards.filter((c) => {
    if (!CLOSED_CARD_STATUSES.includes(c.status)) return false;
    if (!options.podePedirDeTerceiros && (!c.responsavel || String(c.responsavel) !== uid)) return false;
    // Já existe pedido pendente: o backend devolveria 400. Some da lista para
    // não oferecer um botão que não tem como funcionar.
    if (pendentes.has(String(c.id))) return false;
    return true;
  });
}

/** Bloco de identificação do card — o mesmo no formulário e no seletor. */
function CardResumoReabertura({ card }: { card: CardType }) {
  const fechadoEm = cardFechadoEm(card);
  return (
    <div className="min-w-0 flex-1 space-y-1.5">
      <p className="text-sm font-semibold leading-snug text-[var(--color-foreground)]">{card.nome}</p>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <Badge variant="secondary">{cardStageLabel(card)}</Badge>
        <span className="text-[var(--color-muted-foreground)]">
          Fechado em:{' '}
          <span className="font-medium text-[var(--color-foreground)]">
            {fechadoEm ? formatDateTime(fechadoEm) : '—'}
          </span>
        </span>
      </div>
      <p className="text-xs leading-snug text-[var(--color-muted-foreground)]">
        <span>
          Projeto:{' '}
          <span className="font-medium text-[var(--color-foreground)]">
            {card.projeto_detail?.nome ?? '—'}
          </span>
        </span>
        <span className="mx-1.5 text-[var(--color-border)]">|</span>
        <span>
          Entrega anterior:{' '}
          <span className="font-medium text-[var(--color-foreground)]">
            {card.data_fim ? formatDateTime(card.data_fim) : '—'}
          </span>
        </span>
      </p>
      {cardEmSprintEncerrada(card) && (
        <p className="text-xs leading-snug text-[var(--color-muted-foreground)]">
          Sprint já encerrada — a reabertura pode ser recusada até o card ser movido para uma sprint
          em andamento.
        </p>
      )}
    </div>
  );
}

/**
 * Estado da checagem "este card já está na fila?".
 *
 * `checando` NÃO bloqueia o formulário de propósito: é uma verificação de
 * exceção (a esmagadora maioria dos cards não tem pedido pendente) e prender a
 * tela por causa dela seria trocar o "Carregando cards..." de lugar. Se o
 * usuário for mais rápido que a resposta, o backend recusa com uma mensagem
 * legível — que este modal já sabe exibir.
 */
type ChecagemPendencia = 'checando' | 'livre' | 'ja_pendente';

type RequestCardReopenModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * O card a reabrir, JÁ CARREGADO por quem abriu o modal — o objeto, não o id.
   *
   * Quem clica em "Solicitar reabertura" está DENTRO do card e portanto já tem
   * o objeto inteiro em mãos; recebê-lo por prop é o que permite abrir esta
   * tela com ZERO requisição de card e nenhum estado de carregamento. Baixar
   * centenas de cards para exibir um que o chamador já possui era trabalho
   * desperdiçado e uma espera visível.
   *
   * `null` significa apenas "o chamador ainda não tem card" (o seletor do
   * caminho secundário ainda não escolheu): não há o que solicitar e o modal
   * não renderiza. NÃO é um modo "escolha um card" — essa escolha vive fora,
   * em `SelectCardToReopenDialog`.
   */
  card: CardType | null;
  onCreated?: () => void;
};

export function RequestCardReopenModal({
  open,
  onOpenChange,
  card,
  onCreated,
}: RequestCardReopenModalProps) {
  const { user } = useAuth();
  const [novaDataEntrega, setNovaDataEntrega] = useState<string>('');
  const [reason, setReason] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>('');
  const [pendencia, setPendencia] = useState<ChecagemPendencia>('checando');

  const cardId = card ? String(card.id) : '';

  /**
   * Chave da "sessão" do formulário: cada abertura, e cada troca de card, é um
   * pedido novo, e o pedido anterior não pode vazar para ele.
   *
   * O reset acontece durante o RENDER, e não dentro do efeito, de propósito:
   * efeito de estado roda DEPOIS da pintura, então o primeiro quadro do modal
   * recém-aberto ainda mostraria o que sobrou da vez passada — a data digitada,
   * o erro do envio anterior e, pior, o aviso "este card já tem uma solicitação
   * pendente", que era do OUTRO card. Ajustar estado no render é o padrão do
   * React para estado derivado de prop: ele descarta o resultado e re-renderiza
   * antes de pintar, então nada disso chega à tela.
   */
  const sessao = open && cardId ? cardId : '';
  const [sessaoRenderizada, setSessaoRenderizada] = useState(sessao);
  if (sessaoRenderizada !== sessao) {
    setSessaoRenderizada(sessao);
    setError('');
    setReason('');
    setNovaDataEntrega('');
    setPendencia('checando');
  }

  useEffect(() => {
    if (!open || !cardId) return;

    // Consulta PONTUAL: uma requisição filtrada por este card, em vez da fila
    // inteira. Roda em paralelo com o formulário, que já está na tela.
    let ativo = true;
    void (async () => {
      try {
        const pendentes = await cardReopenRequestService.list({ card: cardId, status: 'pending' });
        if (!ativo) return;
        // Confere o `card` de cada item em vez de confiar só no `length`: se o
        // filtro do backend algum dia parar de ser aplicado, a resposta vira a
        // fila inteira e todo card apareceria como bloqueado.
        const desteCard = pendentes.some((r) => String(r.card) === cardId);
        setPendencia(desteCard ? 'ja_pendente' : 'livre');
      } catch {
        if (!ativo) return;
        // Falha de rede não pode impedir o pedido: esta checagem é conveniência
        // (adiantar um 400 previsível), e a autoridade continua sendo o backend.
        setPendencia('livre');
      }
    })();
    return () => {
      // Fechou, ou trocou de card, antes da resposta chegar: o resultado antigo
      // não vale para o card novo.
      ativo = false;
    };
  }, [open, cardId]);

  /**
   * Elegibilidade que NÃO depende de rede — decidida na hora, com o card que
   * veio por prop. Só a pendência (exceção) chega depois.
   */
  const impedimento = useMemo<string | null>(() => {
    if (!card) return null;
    if (!CLOSED_CARD_STATUSES.includes(card.status)) {
      return 'Este card não está fechado — a reabertura só vale para cards finalizados ou inviabilizados.';
    }
    if (!podeSolicitarReaberturaDoCard(user, card)) {
      return 'Você só pode solicitar a reabertura de cards atribuídos a você.';
    }
    if (pendencia === 'ja_pendente') {
      return 'Este card já tem uma solicitação de reabertura aguardando avaliação. Aguarde a avaliação dela antes de abrir outra.';
    }
    return null;
  // `user` inteiro nas dependências porque permissão muda em TEMPO REAL nesta
  // plataforma (o WebSocket avisa e o AuthContext recarrega o usuário): quem
  // ganha `manage_others_cards` com o modal aberto passa a poder pedir na hora.
  }, [card, user, pendencia]);

  /** O backend recusa data no passado; dizer isso aqui evita um 400 de ida e volta. */
  const dataNoFuturo = useMemo(() => {
    const d = parseReopenDatetimeLocal(novaDataEntrega);
    return !!d && d.getTime() > Date.now();
  }, [novaDataEntrega]);

  const canSubmit = !!cardId && !impedimento && !!novaDataEntrega && dataNoFuturo && !saving;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    setError('');
    try {
      await cardReopenRequestService.create({
        card: cardId,
        nova_data_entrega: reopenDatetimeForApi(novaDataEntrega),
        reason: reason?.trim() ? reason.trim() : null,
      });
      onOpenChange(false);
      onCreated?.();
    } catch (err) {
      const respData =
        (err as { response?: { data?: Record<string, unknown> } })?.response?.data ?? {};
      const mensagens: string[] = [];

      if (typeof respData.detail === 'string') mensagens.push(respData.detail);

      // O backend devolve os erros de validação por campo (`card` e
      // `nova_data_entrega`); mostrar a mensagem dele é melhor do que
      // reescrever a regra aqui e correr o risco de divergir.
      for (const key of ['card', 'nova_data_entrega']) {
        const v = respData[key];
        if (typeof v === 'string') mensagens.push(v);
        if (Array.isArray(v) && typeof v[0] === 'string') mensagens.push(v[0]);
      }

      if (mensagens.length === 0) {
        try {
          const asString = JSON.stringify(respData);
          if (asString && asString !== '{}') mensagens.push(asString);
        } catch {
          // ignore
        }
      }

      setError(
        mensagens[0] ||
          'Não foi possível criar a solicitação de reabertura. Confira se o card está fechado, atribuído a você, e se a nova data está no futuro.',
      );
    } finally {
      setSaving(false);
    }
  };

  // Sem card não há solicitação possível — e não existe estado de lista para
  // cair de volta.
  if (!open || !card) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" onClose={() => onOpenChange(false)}>
        <DialogHeader>
          <DialogTitle>Solicitar reabertura de card</DialogTitle>
          <DialogDescription>
            Ao ser aprovada, a reabertura devolve o card à etapa “A Desenvolver” com a nova data de
            entrega informada.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-2 space-y-4">
          <div className="space-y-2">
            <Label>Card a reabrir</Label>
            <div className="rounded-[10px] border border-[var(--color-border)] bg-[var(--color-background)] p-3">
              <CardResumoReabertura card={card} />
            </div>
          </div>

          {impedimento && (
            <div className="rounded-[8px] border border-[var(--color-border)] bg-[var(--color-muted)]/40 p-2 text-sm text-[var(--color-muted-foreground)]">
              {impedimento}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="reopen-request-datetime">Nova data e hora de entrega *</Label>
            <DateTimePicker
              id="reopen-request-datetime"
              pickerTitle="Nova data e hora de entrega"
              value={novaDataEntrega}
              onChange={(e) => setNovaDataEntrega(e.target.value)}
              disabled={saving}
              className="border-[var(--color-border)]"
            />
            {novaDataEntrega && !dataNoFuturo ? (
              <p className="text-xs text-[var(--color-destructive)]">
                A nova data de entrega precisa estar no futuro.
              </p>
            ) : (
              <p className="text-xs text-[var(--color-muted-foreground)]">
                Obrigatória e precisa estar no futuro: é ela que passa a valer como prazo do card
                reaberto.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Motivo (opcional)</Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Descreva por que o card precisa ser reaberto (opcional)"
              disabled={saving}
            />
          </div>

          {error && (
            <div className="rounded-[8px] border border-red-200 bg-red-50 p-2 text-sm text-[var(--color-destructive)] whitespace-pre-line">
              {error}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {saving ? 'Enviando...' : 'Solicitar reabertura'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type SelectCardToReopenDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Recebe o CARD INTEIRO, não o id — é ele que alimenta o modal sem rede. */
  onSelect: (card: CardType) => void;
};

/**
 * Caminho SECUNDÁRIO: escolher um card fechado para quem chegou sem card em
 * mãos (a página de Projetos, pelo diálogo "Criar Demanda").
 *
 * Deliberadamente separado do formulário de solicitação. Enquanto os dois
 * moravam no mesmo componente, o caminho principal — abrir a solicitação de
 * DENTRO do card — pagava o preço da lista: `cardService.getAll()` percorre
 * todas as páginas de cards, uma requisição por página, só para reencontrar um
 * card que o chamador já tinha. Aqui a lista custa o que tem que custar, e
 * custa só a quem realmente precisa escolher.
 */
export function SelectCardToReopenDialog({
  open,
  onOpenChange,
  onSelect,
}: SelectCardToReopenDialogProps) {
  const { user } = useAuth();
  const [loadingCards, setLoadingCards] = useState(false);
  const [cards, setCards] = useState<CardType[]>([]);
  /** Cards fechados do usuário que já estão na fila — usado só para explicar o vazio. */
  const [pendentesCount, setPendentesCount] = useState(0);

  const podeDeTerceiros = podePedirDeTerceiros(user);

  useEffect(() => {
    if (!open) return;
    if (!user?.id) return;
    void (async () => {
      setLoadingCards(true);
      try {
        // Quem manda em card de terceiro precisa da base inteira; quem não,
        // só dos próprios — pedir `getAll()` para todo mundo traria centenas de
        // cards sem necessidade.
        const [data, pendentes] = await Promise.all([
          podeDeTerceiros
            ? cardService.getAll()
            : cardService.getByResponsavel(String(user.id)),
          cardReopenRequestService.list({ status: 'pending' }).catch(() => []),
        ]);

        const cardIdsComPedidoPendente = new Set(pendentes.map((r) => String(r.card)));
        const list = Array.isArray(data) ? data : [];
        const fechadosDoUsuario = list.filter(
          (c) =>
            CLOSED_CARD_STATUSES.includes(c.status) &&
            !!c.responsavel &&
            String(c.responsavel) === String(user.id),
        );
        setPendentesCount(
          fechadosDoUsuario.filter((c) => cardIdsComPedidoPendente.has(String(c.id))).length,
        );

        setCards(
          filterCardsEligibleForReopenRequest(list, {
            requesterUserId: String(user.id),
            cardIdsComPedidoPendente,
            podePedirDeTerceiros: podeDeTerceiros,
          }).sort((a, b) => (a.nome || '').localeCompare(b.nome || '', 'pt-BR')),
        );
      } catch {
        setCards([]);
        setPendentesCount(0);
      } finally {
        setLoadingCards(false);
      }
    })();
  // `podeDeTerceiros` entra nas dependências porque permissão muda em TEMPO
  // REAL nesta plataforma (o WebSocket avisa e o AuthContext recarrega o
  // usuário). Sem ela, quem ganhasse `manage_others_cards` com o diálogo aberto
  // continuaria vendo só os próprios cards até fechar e reabrir.
  }, [open, user?.id, podeDeTerceiros]);

  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" onClose={() => onOpenChange(false)}>
        <DialogHeader>
          <DialogTitle>Qual card você quer reabrir?</DialogTitle>
          <DialogDescription>
            Escolha um card já fechado (finalizado ou inviabilizado). Em seguida você informa a nova
            data de entrega.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-2">
          {loadingCards ? (
            <p className="py-3 text-sm text-[var(--color-muted-foreground)]">Carregando cards...</p>
          ) : cards.length === 0 ? (
            <p className="text-sm text-[var(--color-muted-foreground)]">
              {pendentesCount > 0
                ? 'Todos os cards fechados já têm uma solicitação de reabertura aguardando avaliação.'
                : 'Nenhum card fechado disponível: a reabertura só vale para cards finalizados ou inviabilizados.'}
            </p>
          ) : (
            <div
              role="listbox"
              aria-label="Selecionar card fechado"
              className={cn(
                'rounded-[10px] border border-[var(--color-border)] bg-[var(--color-background)] p-1.5',
                'max-h-[min(320px,50vh)] overflow-y-auto [scrollbar-gutter:stable]',
              )}
            >
              <div className="flex flex-col gap-2">
                {cards.map((c) => (
                  <button
                    key={String(c.id)}
                    type="button"
                    role="option"
                    aria-selected={false}
                    onClick={() => onSelect(c)}
                    className={cn(
                      'w-full rounded-[8px] border border-[var(--color-border)] px-3 py-2.5 text-left transition-colors',
                      'hover:bg-[var(--color-accent)]',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-background)]',
                    )}
                  >
                    <CardResumoReabertura card={c} />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

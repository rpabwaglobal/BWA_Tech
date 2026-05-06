import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Loader2, RefreshCw, Plus, Bell, ExternalLink, Copy, Check, PanelRight, Search } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { FilterSelect, type FilterSelectOption } from '@/components/ui/filter-select';
import { UserSelect } from '@/components/ui/user-select';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { CARD_TIMELINE_LAYOUT_RESERVE_PX } from '@/components/CardLogsModal';
import { SuporteTicketTimelinePanel } from '@/components/SuporteTicketTimelinePanel';
import { ConclusaoModal } from '@/components/ConclusaoModal';
import { PendenciaModal } from '@/components/PendenciaModal';
import { useSuporteKanbanWebSocket } from '@/hooks/useSuporteKanbanWebSocket';
import {
  getFormulariosApiBase,
  getFormulariosAuthStorageKey,
  usesFormulariosDevProxy,
  usesLocalFormulariosBackend,
} from '@/services/formulariosApi';
import {
  suporteService,
  stripPendenciaMarker,
  ensurePendenciaMarker,
  catalogNome,
  type ChamadoSuporte,
  type PatchChamadoSuportePayload,
  type CatalogoSuporteResponse,
  SUPORTE_PENDENCIA_PREFIX,
} from '@/services/suporteService';
import { cn } from '@/lib/utils';
import { formatDateTime } from '@/lib/dateUtils';
import { logSuporteChamadoChanges, logSuporteTicketCriado } from '@/lib/suporteTimelineLog';
import { userService, type User } from '@/services/userService';
import { suporteTimelineService } from '@/services/suporteTimelineService';

const STAGES = [
  { key: 'a_desenvolver' as const, label: 'A desenvolver', hint: 'Aguardando suporte' },
  { key: 'em_desenvolvimento' as const, label: 'Em desenvolvimento', hint: 'Com responsável' },
  { key: 'parado_pendencias' as const, label: 'Parado por pendências', hint: 'Em andamento bloqueado' },
  { key: 'inviabilizado' as const, label: 'Inviabilizado', hint: 'Cancelado na API' },
  { key: 'finalizado' as const, label: 'Concluído', hint: 'Resolvido na API' },
];

type StageKey = (typeof STAGES)[number]['key'];

function upsertChamadoLista(prev: ChamadoSuporte[], row: ChamadoSuporte): ChamadoSuporte[] {
  const i = prev.findIndex((x) => x.id === row.id);
  if (i === -1) return [...prev, row];
  const next = [...prev];
  next[i] = row;
  return next;
}

function displayUserName(u: { first_name?: string; last_name?: string; username: string }): string {
  const fn = (u.first_name ?? '').trim();
  const ln = (u.last_name ?? '').trim();
  const full = `${fn} ${ln}`.trim();
  return full || u.username;
}

function userIdFromResponsavelNome(users: User[], nome: string | null | undefined): string {
  const t = (nome ?? '').trim();
  if (!t) return '';
  const tl = t.toLowerCase();
  for (const u of users) {
    if (displayUserName(u).trim().toLowerCase() === tl) return String(u.id);
  }
  for (const u of users) {
    if (u.username.trim().toLowerCase() === tl) return String(u.id);
  }
  return '';
}

function responsavelNomeFromUserId(users: User[], userId: string): string {
  const id = userId.trim();
  if (!id) return '';
  const u = users.find((x) => String(x.id) === id);
  return u ? displayUserName(u) : '';
}

function initialsFromNome(nome: string): string {
  const parts = nome.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  const a = parts[0][0] ?? '';
  const b = parts[parts.length - 1][0] ?? '';
  return `${a}${b}`.toUpperCase();
}

/** Avatar + nome do responsável (associa por `userId` ou pelo texto gravado na API). */
function SuporteResponsavelFace({
  users,
  userId,
  nome,
  avatarClassName,
  textClassName,
}: {
  users: User[];
  userId?: string;
  nome?: string | null;
  avatarClassName: string;
  textClassName: string;
}) {
  const id = (userId ?? '').trim();
  let u: User | undefined = id ? users.find((x) => String(x.id) === id) : undefined;
  const nomeT = (nome ?? '').trim();
  if (!u && nomeT) {
    const resolvedId = userIdFromResponsavelNome(users, nomeT);
    if (resolvedId) u = users.find((x) => String(x.id) === resolvedId);
  }
  const label = u ? displayUserName(u) : nomeT;
  if (!label) return null;
  const src = u?.profile_picture_url?.trim();
  const initials = initialsFromNome(label);

  return (
    <div className="flex min-w-0 items-center gap-[8px]">
      <Avatar className={cn('shrink-0', avatarClassName)}>
        {src ? <AvatarImage src={src} alt="" /> : null}
        <AvatarFallback className="text-[10px] font-semibold">{initials}</AvatarFallback>
      </Avatar>
      <span className={cn('min-w-0 truncate', textClassName)} title={label}>
        {label}
      </span>
    </div>
  );
}

function normalizeStatusEtapa(status: ChamadoSuporte['status'] | string | undefined): string {
  return String(status ?? '').trim().toLowerCase();
}

/** Colunas do quadro a partir do status retornado pela API (aceita pequenas variações de texto). */
function chamadoToStage(c: ChamadoSuporte): StageKey {
  const desc = c.descricao_resolucao ?? '';
  const pendencia = desc.startsWith(SUPORTE_PENDENCIA_PREFIX);
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

function patchForStage(
  target: StageKey,
  chamado: ChamadoSuporte,
  assigneeName: string,
  resolutionExtra?: string,
): PatchChamadoSuportePayload {
  const cur = chamado.descricao_resolucao ?? null;

  switch (target) {
    case 'a_desenvolver':
      return {
        status: 'Aberto',
        responsavel_solucao: null,
        descricao_resolucao: stripPendenciaMarker(cur || '').trim() || null,
      };
    case 'em_desenvolvimento': {
      const text = stripPendenciaMarker(cur || '').trim();
      return {
        status: 'Em andamento',
        responsavel_solucao: (assigneeName || chamado.responsavel_solucao || '').trim() || null,
        descricao_resolucao: text || null,
      };
    }
    case 'parado_pendencias':
      return {
        status: 'Em andamento',
        responsavel_solucao:
          (chamado.responsavel_solucao ?? assigneeName).trim() || assigneeName || null,
        descricao_resolucao: ensurePendenciaMarker(cur),
      };
    case 'inviabilizado': {
      const base = stripPendenciaMarker(cur || '').trim();
      const extra = resolutionExtra?.trim();
      const merged = extra ? (base ? `${base}\n${extra}` : extra) : base || null;
      return { status: 'Cancelado', descricao_resolucao: merged };
    }
    case 'finalizado': {
      const base = stripPendenciaMarker(cur || '').trim();
      const note = resolutionExtra?.trim();
      const merged = note ? (base ? `${base}\n${note}` : note) : base;
      return {
        status: 'Resolvido',
        responsavel_solucao: (chamado.responsavel_solucao ?? assigneeName).trim() || null,
        descricao_resolucao: merged || null,
      };
    }
    default:
      return {};
  }
}

function dragId(chamadoId: number) {
  return `suporte-${chamadoId}`;
}

function parseDragId(id: string): number | null {
  if (!id.startsWith('suporte-')) return null;
  const n = Number(id.slice('suporte-'.length));
  return Number.isFinite(n) ? n : null;
}

function stageOfCard(cardId: number, cols: Record<StageKey, ChamadoSuporte[]>): StageKey | null {
  for (const s of STAGES) {
    if (cols[s.key].some((c) => c.id === cardId)) return s.key;
  }
  return null;
}

/** Destino do arrastar: coluna vazia (id da etapa) ou card (inferir etapa). */
function resolveDropStage(
  overId: string,
  cols: Record<StageKey, ChamadoSuporte[]>,
): StageKey | null {
  if (STAGES.some((s) => s.key === overId)) return overId as StageKey;
  const cid = parseDragId(overId);
  if (cid != null) return stageOfCard(cid, cols);
  return null;
}

export default function Support() {
  const { user, isAuthenticated } = useAuth();
  const assigneeName = user ? displayUserName(user) : '';

  const [items, setItems] = useState<ChamadoSuporte[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [detailChamado, setDetailChamado] = useState<ChamadoSuporte | null>(null);
  const [activeDrag, setActiveDrag] = useState<ChamadoSuporte | null>(null);
  const [pendingFinalize, setPendingFinalize] = useState<{
    chamado: ChamadoSuporte;
    stage: StageKey;
    note: string;
  } | null>(null);
  const [pendingConfirmDestrutivo, setPendingConfirmDestrutivo] = useState<{
    tipo: 'inviabilizado' | 'finalizado';
    chamado: ChamadoSuporte;
  } | null>(null);
  const [pendingPendenciaChamado, setPendingPendenciaChamado] = useState<ChamadoSuporte | null>(null);
  const [assignUsers, setAssignUsers] = useState<User[]>([]);
  const [timelineRefreshNonce, setTimelineRefreshNonce] = useState(0);
  const [suporteSearchQuery, setSuporteSearchQuery] = useState('');
  const [filterResponsavelSolucao, setFilterResponsavelSolucao] = useState('');

  const bumpTimeline = useCallback(() => setTimelineRefreshNonce((n) => n + 1), []);

  const getKanbanStageLabel = useCallback(
    (c: ChamadoSuporte) => STAGES.find((s) => s.key === chamadoToStage(c))?.label ?? c.status,
    [],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent === true;
    try {
      if (!silent) {
        setLoading(true);
        setError(null);
      }

      if (
        (import.meta.env.VITE_FORMULARIOS_TOKEN_FROM_PORTAL as string | undefined)?.toLowerCase() ===
        'true'
      ) {
        try {
          const { ensurePortalFormulariosJwt } = await import('@/services/portalFormulariosTokenService');
          await ensurePortalFormulariosJwt();
        } catch (portalErr: unknown) {
          if (!silent) {
            const detail =
              portalErr && typeof portalErr === 'object' && 'response' in portalErr
                ? JSON.stringify((portalErr as { response?: { data?: unknown } }).response?.data ?? {})
                : String(portalErr);
            setError(
              `Não foi possível obter o token do portal pelo backend (login PORTAL_* no backend/.env e Django rodando). ${detail}`,
            );
            setItems([]);
          }
          return;
        }
      }

      const data = await suporteService.listByUsuario();
      setItems(data);
    } catch (e: unknown) {
      if (!silent) {
        const msg =
          e && typeof e === 'object' && 'response' in e
            ? String((e as { response?: { data?: unknown } }).response?.data ?? '')
            : String(e);
        setError(
          msg?.length
            ? `Não foi possível carregar os chamados: ${msg}`
            : 'Não foi possível carregar os chamados. Confirme VITE_FORMULARIOS_API_BASE / autenticação e se a API expõe /formularios/suporte/.',
        );
        setItems([]);
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const mergeRemoteChamado = useCallback((row: ChamadoSuporte) => {
    setItems((prev) => upsertChamadoLista(prev, row));
    setDetailChamado((cur) => (cur?.id === row.id ? row : cur));
  }, []);

  useSuporteKanbanWebSocket({
    enabled: isAuthenticated && usesLocalFormulariosBackend(),
    onChamadoUpsert: mergeRemoteChamado,
  });

  /** Portal externo: novos chamados por WS; arrastar/outras alterações via polling (dev: proxy Vite com ws:true). */
  useEffect(() => {
    if (!isAuthenticated || usesLocalFormulariosBackend()) return;

    let cancelled = false;
    let ws: WebSocket | null = null;

    void (async () => {
      const portalMode =
        (import.meta.env.VITE_FORMULARIOS_TOKEN_FROM_PORTAL as string | undefined)?.toLowerCase() ===
        'true';
      let token: string | null = null;
      if (portalMode) {
        try {
          const { ensurePortalFormulariosJwt } = await import(
            '@/services/portalFormulariosTokenService'
          );
          token = await ensurePortalFormulariosJwt();
        } catch {
          return;
        }
      } else {
        token = localStorage.getItem(getFormulariosAuthStorageKey());
      }
      if (!token || cancelled) return;

      try {
        let wsUrl: string;
        if (usesFormulariosDevProxy()) {
          const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
          wsUrl = `${proto}//${window.location.host}/__formularios/ws/formularios-novos/?token=${encodeURIComponent(token)}`;
        } else {
          const base = getFormulariosApiBase();
          const originUrl = base.startsWith('http')
            ? new URL(base)
            : new URL(base, window.location.origin);
          const proto = originUrl.protocol === 'https:' ? 'wss:' : 'ws:';
          wsUrl = `${proto}//${originUrl.host}/ws/formularios-novos/?token=${encodeURIComponent(token)}`;
        }
        const socket = new WebSocket(wsUrl);
        ws = socket;
        socket.onmessage = (ev) => {
          try {
            const msg = JSON.parse(ev.data as string) as {
              event?: string;
              kind?: string;
              data?: ChamadoSuporte;
            };
            if (msg.event === 'novo_formulario' && msg.kind === 'suporte' && msg.data?.id != null) {
              void load({ silent: true });
            }
          } catch {
            /* ignorar */
          }
        };
      } catch {
        /* URL inválida ou WS indisponível */
      }
    })();

    return () => {
      cancelled = true;
      ws?.close();
    };
  }, [isAuthenticated, load]);

  useEffect(() => {
    if (!isAuthenticated || usesLocalFormulariosBackend()) return;
    const id = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      void load({ silent: true });
    }, 4000);
    return () => window.clearInterval(id);
  }, [isAuthenticated, load]);

  useEffect(() => {
    let cancelled = false;
    void userService
      .getAll()
      .then((list) => {
        if (!cancelled) setAssignUsers(Array.isArray(list) ? list : []);
      })
      .catch(() => {
        if (!cancelled) setAssignUsers([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const responsavelSelectUsers = useMemo(
    () =>
      [...assignUsers.filter((u) => u.role !== 'admin')].sort((a, b) =>
        displayUserName(a).localeCompare(displayUserName(b), 'pt-BR'),
      ),
    [assignUsers],
  );

  const filterSolucaoOptions: FilterSelectOption[] = useMemo(
    () =>
      responsavelSelectUsers.map((u) => ({
        value: String(u.id),
        label: displayUserName(u),
        role: u.role,
      })),
    [responsavelSelectUsers],
  );

  const filteredItems = useMemo(() => {
    return items.filter(
      (c) =>
        chamadoMatchesSuporteSearch(c, suporteSearchQuery) &&
        chamadoMatchesFilterSolucao(c, filterResponsavelSolucao, assignUsers),
    );
  }, [items, suporteSearchQuery, filterResponsavelSolucao, assignUsers]);

  const columns = useMemo(() => {
    const map = Object.fromEntries(STAGES.map((s) => [s.key, [] as ChamadoSuporte[]])) as Record<
      StageKey,
      ChamadoSuporte[]
    >;
    for (const c of filteredItems) {
      map[chamadoToStage(c)].push(c);
    }
    return map;
  }, [filteredItems]);

  const handleDragStart = (e: DragStartEvent) => {
    const id = parseDragId(String(e.active.id));
    if (id == null) return;
    const found = items.find((x) => x.id === id);
    setActiveDrag(found ?? null);
  };

  const applyPatchAndRefresh = useCallback(
    async (id: number, patch: PatchChamadoSuportePayload, before: ChamadoSuporte) => {
      const updated = await suporteService.patch(id, patch);
      setItems((prev) => prev.map((x) => (x.id === id ? updated : x)));
      await logSuporteChamadoChanges(before, updated, getKanbanStageLabel);
      bumpTimeline();
    },
    [getKanbanStageLabel, bumpTimeline],
  );

  const handlePendenciaConfirm = useCallback(
    async (motivo: string) => {
      const chamado = pendingPendenciaChamado;
      if (!chamado) return;
      setPendingPendenciaChamado(null);
      try {
        const patch = patchForStage('parado_pendencias', chamado, assigneeName);
        await applyPatchAndRefresh(chamado.id, patch, chamado);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Erro ao atualizar chamado.');
        void load();
        throw err;
      }
      try {
        await suporteTimelineService.create({
          chamado_id: chamado.id,
          tipo_evento: 'pendencia',
          descricao: motivo.trim(),
        });
        bumpTimeline();
      } catch {
        /* timeline opcional */
      }
    },
    [pendingPendenciaChamado, assigneeName, applyPatchAndRefresh, load, bumpTimeline],
  );

  const handleConfirmDestrutivo = useCallback(() => {
    if (!pendingConfirmDestrutivo) return;
    const { tipo, chamado } = pendingConfirmDestrutivo;
    setPendingConfirmDestrutivo(null);

    if (tipo === 'inviabilizado') {
      void (async () => {
        try {
          const patch = patchForStage('inviabilizado', chamado, assigneeName);
          await applyPatchAndRefresh(chamado.id, patch, chamado);
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Erro ao atualizar chamado.');
          void load();
        }
      })();
      return;
    }

    const stripped = stripPendenciaMarker(chamado.descricao_resolucao ?? '').trim();
    if (!stripped) {
      setPendingFinalize({ chamado, stage: 'finalizado', note: '' });
      return;
    }

    void (async () => {
      try {
        const patch = patchForStage('finalizado', chamado, assigneeName);
        await applyPatchAndRefresh(chamado.id, patch, chamado);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Erro ao atualizar chamado.');
        void load();
      }
    })();
  }, [pendingConfirmDestrutivo, assigneeName, applyPatchAndRefresh, load]);

  const handleDragEnd = async (e: DragEndEvent) => {
    setActiveDrag(null);
    const overId = e.over?.id;
    if (!overId) return;

    const chamadoId = parseDragId(String(e.active.id));
    if (chamadoId == null) return;

    const targetStage = resolveDropStage(String(overId), columns);
    if (!targetStage) return;

    const chamado = items.find((x) => x.id === chamadoId);
    if (!chamado) return;

    if (chamadoToStage(chamado) === targetStage) return;

    if (targetStage === 'parado_pendencias') {
      setPendingPendenciaChamado(chamado);
      return;
    }

    if (targetStage === 'inviabilizado' || targetStage === 'finalizado') {
      setPendingConfirmDestrutivo({
        tipo: targetStage === 'inviabilizado' ? 'inviabilizado' : 'finalizado',
        chamado,
      });
      return;
    }

    try {
      const patch = patchForStage(targetStage, chamado, assigneeName);
      await applyPatchAndRefresh(chamado.id, patch, chamado);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao atualizar chamado.');
      void load();
    }
  };

  const confirmFinalize = async () => {
    if (!pendingFinalize) return;
    const { chamado, stage, note } = pendingFinalize;
    const noteTrim = note.trim();
    if (!noteTrim) {
      setError('As notas de resolução são obrigatórias para concluir o ticket.');
      return;
    }
    try {
      const patch = patchForStage(stage, chamado, assigneeName, noteTrim);
      await applyPatchAndRefresh(chamado.id, patch, chamado);
      setPendingFinalize(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao concluir ticket.');
      void load();
    }
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-[16px] p-[16px] md:p-[24px]">
      <header className="flex shrink-0 flex-col gap-[12px] md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[var(--color-foreground)]">Suporte</h1>
        </div>
        <div className="flex flex-wrap items-center gap-[10px]">
          <Button type="button" variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={cn('h-4 w-4 mr-[8px]', loading && 'animate-spin')} />
            Atualizar
          </Button>
          <Button type="button" size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-[8px]" />
            Novo chamado
          </Button>
        </div>
      </header>

      {error && (
        <div
          className="shrink-0 rounded-[10px] border border-red-200 bg-red-50 px-[14px] py-[10px] text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200"
          role="alert"
        >
          {error}
        </div>
      )}

      {!(loading && items.length === 0) ? (
        <div className="flex shrink-0 flex-col gap-[8px] lg:flex-row lg:items-end lg:gap-[8px]">
          <div className="relative min-h-[40px] min-w-0 w-full lg:min-w-[min(280px,100%)] lg:flex-1">
            <span className="mb-[4px] block text-xs text-[var(--color-muted-foreground)]">Buscar tickets</span>
            <div className="relative">
              <Search className="pointer-events-none absolute left-[12px] top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-[var(--color-muted-foreground)]" />
              <Input
                type="text"
                placeholder="Descrição, solicitante, item, motivo, responsável, status, nº…"
                value={suporteSearchQuery}
                onChange={(e) => setSuporteSearchQuery(e.target.value)}
                disabled={loading}
                className="h-[40px] pl-[40px]"
              />
            </div>
          </div>
          <div className="w-full min-w-0 shrink-0 lg:w-[220px]">
            <span className="mb-[4px] block text-xs text-[var(--color-muted-foreground)]">
              Responsáveis pelos tickets
            </span>
            <FilterSelect
              options={filterSolucaoOptions}
              value={filterResponsavelSolucao}
              onChange={setFilterResponsavelSolucao}
              disabled={loading}
              placeholder="Todos"
            />
          </div>
        </div>
      ) : null}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {loading && items.length === 0 ? (
          <div className="flex flex-1 items-center justify-center text-[var(--color-muted-foreground)]">
            <Loader2 className="mr-[10px] h-5 w-5 animate-spin" />
            Carregando chamados…
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCorners}
            onDragStart={handleDragStart}
            onDragEnd={(ev) => void handleDragEnd(ev)}
          >
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              <div className="flex min-h-0 min-w-0 w-full flex-1 gap-[14px] overflow-x-auto pb-[12px] items-stretch">
                {STAGES.map((stage) => (
                  <SupportColumn
                    key={stage.key}
                    stageKey={stage.key}
                    label={stage.label}
                    hint={stage.hint}
                    chamados={columns[stage.key]}
                    users={assignUsers}
                    onOpen={(c) => setDetailChamado(c)}
                  />
                ))}
              </div>
              <DragOverlay dropAnimation={null}>
                {activeDrag ? (
                  <SupportCardPreview chamado={activeDrag} users={assignUsers} />
                ) : null}
              </DragOverlay>
            </div>
          </DndContext>
        )}
      </div>

      <CreateChamadoDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        user={user}
        onCreated={() => {
          bumpTimeline();
          setCreateOpen(false);
          void load();
        }}
        onError={(m) => setError(m)}
      />

      <ChamadoDetailDialog
        chamado={detailChamado}
        open={!!detailChamado}
        onOpenChange={(o) => !o && setDetailChamado(null)}
        assigneeName={assigneeName}
        users={assignUsers}
        getKanbanStageLabel={getKanbanStageLabel}
        timelineRefreshNonce={timelineRefreshNonce}
        bumpTimeline={bumpTimeline}
        onUpdated={(c) => {
          setItems((prev) => prev.map((x) => (x.id === c.id ? c : x)));
          setDetailChamado((d) => (d?.id === c.id ? c : d));
        }}
        onError={(m) => setError(m)}
      />

      <ConclusaoModal
        isOpen={!!pendingConfirmDestrutivo}
        onClose={() => setPendingConfirmDestrutivo(null)}
        onConfirm={handleConfirmDestrutivo}
        cardName={
          pendingConfirmDestrutivo ? tituloItemMotivo(pendingConfirmDestrutivo.chamado) : undefined
        }
        variant={pendingConfirmDestrutivo?.tipo === 'inviabilizado' ? 'inviabilizado' : 'conclusao'}
        nameLabel="Ticket"
      />

      <PendenciaModal
        isOpen={!!pendingPendenciaChamado}
        onClose={() => setPendingPendenciaChamado(null)}
        onConfirm={handlePendenciaConfirm}
        cardName={pendingPendenciaChamado ? tituloItemMotivo(pendingPendenciaChamado) : ''}
      />

      <Dialog open={!!pendingFinalize} onOpenChange={(o) => !o && setPendingFinalize(null)}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>Concluir ticket</DialogTitle>
            <DialogDescription>
              Para concluir o ticket nº {pendingFinalize?.chamado.id}, preencha as notas de resolução — são
              obrigatórias; a API não aceita encerrar o chamado sem este texto.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={pendingFinalize?.note ?? ''}
            onChange={(ev) =>
              setPendingFinalize((p) => (p ? { ...p, note: ev.target.value } : p))
            }
            placeholder="Descrição da resolução…"
            rows={4}
          />
          <DialogFooter className="gap-[8px] sm:gap-0">
            <Button type="button" variant="outline" onClick={() => setPendingFinalize(null)}>
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={!pendingFinalize?.note.trim()}
              onClick={() => void confirmFinalize()}
            >
              Salvar e mover para Concluído
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SupportColumn({
  stageKey,
  label,
  hint,
  chamados,
  users,
  onOpen,
}: {
  stageKey: StageKey;
  label: string;
  hint: string;
  chamados: ChamadoSuporte[];
  users: User[];
  onOpen: (c: ChamadoSuporte) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stageKey });
  const empty = chamados.length === 0;

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex h-full min-h-0 min-w-[220px] flex-1 flex-col rounded-[12px] border border-[var(--color-border)]',
        empty ? 'bg-transparent' : 'bg-[var(--color-card)]',
        isOver &&
          cn(
            'border-[var(--color-primary)] ring-2 ring-[var(--color-primary)]/20',
            empty && 'bg-[var(--color-muted)]/10',
          ),
      )}
    >
      <div className="flex flex-row items-center justify-between gap-[10px] border-b border-[var(--color-border)] p-[12px]">
        <div className="min-w-0 flex-1">
          <div className="font-medium text-[var(--color-foreground)]">{label}</div>
          <div className="mt-[2px] text-[11px] text-[var(--color-muted-foreground)]">{hint}</div>
        </div>
        <Badge variant="secondary" className="shrink-0 text-[11px] tabular-nums">
          {chamados.length}
        </Badge>
      </div>
      <div className="min-h-0 flex-1 space-y-[8px] overflow-y-auto p-[8px]">
        <SortableContext items={chamados.map((c) => dragId(c.id))} strategy={verticalListSortingStrategy}>
          {chamados.map((c) => (
            <SortableChamadoCard key={c.id} chamado={c} users={users} onOpen={() => onOpen(c)} />
          ))}
        </SortableContext>
      </div>
    </div>
  );
}

/** Linha principal do cartão: nomes de catálogo de item e motivo. */
function tituloItemMotivo(chamado: ChamadoSuporte): string {
  const item = catalogNome(chamado.item);
  const motivo = catalogNome(chamado.motivo);
  return `${item} – ${motivo}`;
}

function chamadoMatchesSuporteSearch(chamado: ChamadoSuporte, query: string): boolean {
  const raw = query.trim().toLowerCase();
  if (!raw) return true;
  const tokens = raw.split(/\s+/).filter(Boolean);
  const haystack = [
    tituloItemMotivo(chamado),
    chamado.descricao,
    chamado.usuario_nome,
    chamado.usuario_email,
    chamado.empresa ?? '',
    catalogNome(chamado.tipo),
    catalogNome(chamado.item),
    catalogNome(chamado.motivo),
    chamado.responsavel ?? '',
    chamado.responsavel_solucao ?? '',
    chamado.status,
    String(chamado.id),
  ]
    .join(' ')
    .toLowerCase();
  return tokens.every((t) => haystack.includes(t));
}

function chamadoMatchesFilterSolucao(chamado: ChamadoSuporte, filterValue: string, users: User[]): boolean {
  if (!filterValue) return true;
  return userIdFromResponsavelNome(users, chamado.responsavel_solucao) === filterValue;
}

/** Aberto na API (normalizado). */
function chamadoEstaAberto(chamado: ChamadoSuporte): boolean {
  return normalizeStatusEtapa(chamado.status) === 'aberto';
}

function SortableChamadoCard({
  chamado,
  users,
  onOpen,
}: {
  chamado: ChamadoSuporte;
  users: User[];
  onOpen: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: dragId(chamado.id),
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.45 : 1,
  };

  return (
    <button
      ref={setNodeRef}
      type="button"
      style={style}
      className={cn(
        'w-full cursor-grab touch-none rounded-[10px] border border-[var(--color-border)] bg-[var(--color-background)] p-[10px] text-left shadow-sm transition-colors hover:border-[var(--color-primary)]/40 active:cursor-grabbing',
      )}
      onClick={onOpen}
      {...attributes}
      {...listeners}
    >
      <div className="min-w-0 space-y-[6px]">
        <div className="flex items-start justify-between gap-[8px]">
          <div className="min-w-0 flex-1 text-[13px] font-semibold leading-snug text-[var(--color-foreground)] line-clamp-2">
            {tituloItemMotivo(chamado)}
          </div>
          <span className="shrink-0 pt-[1px] text-[11px] font-semibold tabular-nums text-[var(--color-muted-foreground)]">
            #{chamado.id}
          </span>
        </div>
        <p className="text-[12px] leading-snug whitespace-pre-wrap break-words text-[var(--color-foreground)] line-clamp-4">
          {chamado.descricao?.trim() ? chamado.descricao : '—'}
        </p>
        <div className="text-[11px] text-[var(--color-muted-foreground)]">
          {(chamado.usuario_setor ?? '').trim() || '—'} – {chamado.usuario_nome || '—'}
        </div>
        <div className="text-[11px] font-medium text-[var(--color-foreground)]">{catalogNome(chamado.tipo)}</div>

        {(() => {
          const sol = (chamado.responsavel_solucao ?? '').trim();
          const ped = (chamado.responsavel ?? '').trim();
          return (
            <>
              {sol ? (
                <div className="space-y-[4px] pt-[2px]">
                  <div className="text-[10px] font-medium uppercase tracking-wide text-[var(--color-muted-foreground)]">
                    Responsável
                  </div>
                  <SuporteResponsavelFace
                    users={users}
                    nome={sol}
                    avatarClassName="h-7 w-7"
                    textClassName="text-[11px] font-medium text-[var(--color-foreground)]"
                  />
                </div>
              ) : null}
              {ped && ped !== sol ? (
                <div className="space-y-[4px] pt-[2px]">
                  <div className="text-[10px] font-medium uppercase tracking-wide text-[var(--color-muted-foreground)]">
                    Responsável (pedido)
                  </div>
                  <SuporteResponsavelFace
                    users={users}
                    nome={ped}
                    avatarClassName="h-7 w-7"
                    textClassName="text-[11px] font-medium text-[var(--color-foreground)]"
                  />
                </div>
              ) : null}
            </>
          );
        })()}

        {chamadoEstaAberto(chamado) ? (
          <div className="space-y-[4px] border-t border-[var(--color-border)]/80 pt-[4px] text-[11px] text-[var(--color-muted-foreground)]">
            <div className="truncate" title={chamado.usuario_email}>
              E-mail: {chamado.usuario_email || '—'}
            </div>
            <div className="truncate">{chamado.empresa?.trim() ? `Empresa: ${chamado.empresa}` : 'Empresa: —'}</div>
            {chamado.anexo_url ? (
              <div className="truncate text-[var(--color-primary)]">Anexo: link disponível</div>
            ) : (
              <div>Anexo: —</div>
            )}
            <div>Notificado: {chamado.usuario_notificado ? 'sim' : 'não'}</div>
          </div>
        ) : null}

        <div className="flex flex-wrap gap-[4px] pt-[2px]">
          <Badge variant="outline" className="text-[10px]">
            {chamado.status}
          </Badge>
        </div>
      </div>
    </button>
  );
}

function SupportCardPreview({ chamado, users }: { chamado: ChamadoSuporte; users: User[] }) {
  const sol = (chamado.responsavel_solucao ?? '').trim();
  const ped = (chamado.responsavel ?? '').trim();
  return (
    <div className="w-[260px] rounded-[10px] border border-[var(--color-border)] bg-[var(--color-card)] p-[10px] shadow-lg">
      <div className="flex items-start justify-between gap-[8px]">
        <div className="min-w-0 flex-1 text-[13px] font-semibold line-clamp-2">{tituloItemMotivo(chamado)}</div>
        <span className="shrink-0 text-[11px] font-semibold tabular-nums text-[var(--color-muted-foreground)]">
          #{chamado.id}
        </span>
      </div>
      <div className="mt-[6px] line-clamp-2 text-[11px] text-[var(--color-muted-foreground)]">{chamado.descricao}</div>
      {sol ? (
        <div className="mt-[8px] border-t border-[var(--color-border)]/80 pt-[8px]">
          <SuporteResponsavelFace
            users={users}
            nome={sol}
            avatarClassName="h-8 w-8"
            textClassName="text-[11px] font-medium text-[var(--color-foreground)]"
          />
        </div>
      ) : ped ? (
        <div className="mt-[8px] border-t border-[var(--color-border)]/80 pt-[8px]">
          <SuporteResponsavelFace
            users={users}
            nome={ped}
            avatarClassName="h-8 w-8"
            textClassName="text-[11px] font-medium text-[var(--color-foreground)]"
          />
        </div>
      ) : null}
    </div>
  );
}

function CreateChamadoDialog({
  open,
  onOpenChange,
  user,
  onCreated,
  onError,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  user: {
    first_name: string;
    last_name: string;
    username: string;
    email: string;
  } | null;
  onCreated: (created: ChamadoSuporte) => void;
  onError: (m: string) => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [usuarioNome, setUsuarioNome] = useState('');
  const [usuarioEmail, setUsuarioEmail] = useState('');
  const [usuarioSetor, setUsuarioSetor] = useState('');
  const [empresa, setEmpresa] = useState('');
  const [descricao, setDescricao] = useState('');
  const [tipoId, setTipoId] = useState('');
  const [itemId, setItemId] = useState('');
  const [motivoId, setMotivoId] = useState('');
  /** Fallback manual (API externa sem GET catalogo) */
  const [tipoManual, setTipoManual] = useState('');
  const [itemManual, setItemManual] = useState('');
  const [motivoManual, setMotivoManual] = useState('');
  const [anexoUrl, setAnexoUrl] = useState('');
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalog, setCatalog] = useState<CatalogoSuporteResponse | null>(null);
  const [catalogFailed, setCatalogFailed] = useState(false);

  useEffect(() => {
    if (!open || !user) return;
    setUsuarioNome(displayUserName(user));
    setUsuarioEmail(user.email ?? '');
  }, [open, user]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setCatalogLoading(true);
    setCatalogFailed(false);
    void suporteService
      .fetchCatalog()
      .then((data) => {
        if (cancelled) return;
        const usable =
          Array.isArray(data.tipos) &&
          Array.isArray(data.motivos) &&
          data.tipos.length > 0 &&
          data.motivos.length > 0;
        if (!usable) {
          setCatalog(null);
          setCatalogFailed(true);
          return;
        }
        setCatalog(data);
        const firstTipo = data.tipos[0];
        if (firstTipo) {
          setTipoId(String(firstTipo.id));
          const firstItem = firstTipo.itens[0];
          setItemId(firstItem ? String(firstItem.id) : '');
        } else {
          setTipoId('');
          setItemId('');
        }
        const firstMotivo = data.motivos[0];
        setMotivoId(firstMotivo ? String(firstMotivo.id) : '');
      })
      .catch(() => {
        if (!cancelled) {
          setCatalog(null);
          setCatalogFailed(true);
          setTipoId('');
          setItemId('');
          setMotivoId('');
        }
      })
      .finally(() => {
        if (!cancelled) setCatalogLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const tipoSelecionado = catalog?.tipos.find((t) => String(t.id) === tipoId);
  const itemOptions: { value: string; label: string }[] =
    tipoSelecionado?.itens.map((it) => ({ value: String(it.id), label: it.nome })) ?? [];
  const tipoOptions: { value: string; label: string }[] =
    catalog?.tipos.map((t) => ({ value: String(t.id), label: t.nome })) ?? [];
  const motivoOptions: { value: string; label: string }[] =
    catalog?.motivos.map((m) => ({ value: String(m.id), label: m.nome })) ?? [];
  const useCatalogSelects = Boolean(
    catalog && !catalogFailed && tipoOptions.length > 0 && motivoOptions.length > 0,
  );

  useEffect(() => {
    if (!tipoSelecionado?.itens.length) {
      setItemId('');
      return;
    }
    const ok = tipoSelecionado.itens.some((it) => String(it.id) === itemId);
    if (!ok) setItemId(String(tipoSelecionado.itens[0].id));
  }, [tipoId, tipoSelecionado, itemId]);

  const submit = async () => {
    let t: number;
    let i: number;
    let m: number;

    if (useCatalogSelects) {
      t = Number(tipoId);
      i = Number(itemId);
      m = Number(motivoId);
      if (!Number.isFinite(t) || !Number.isFinite(i) || !Number.isFinite(m)) {
        onError('Escolha tipo, item e motivo na lista.');
        return;
      }
    } else {
      t = Number(tipoManual);
      i = Number(itemManual);
      m = Number(motivoManual);
      if (!Number.isFinite(t) || !Number.isFinite(i) || !Number.isFinite(m)) {
        onError(
          'Informe tipo, item e motivo como números válidos (IDs do catálogo), ou verifique se a API expõe GET …/suporte/catalogo/.',
        );
        return;
      }
    }

    if (!usuarioNome.trim() || !usuarioEmail.trim() || !descricao.trim()) {
      onError('Preencha nome, e-mail e descrição.');
      return;
    }

    try {
      setSubmitting(true);
      const created = await suporteService.create({
        usuario_nome: usuarioNome.trim(),
        usuario_email: usuarioEmail.trim(),
        usuario_setor: usuarioSetor.trim() || null,
        empresa: empresa.trim() || null,
        descricao: descricao.trim(),
        tipo: t,
        item: i,
        motivo: m,
        anexo_url: anexoUrl.trim() || null,
        status: 'Aberto',
        responsavel: null,
        responsavel_solucao: null,
        descricao_resolucao: null,
      });
      await logSuporteTicketCriado(
        created.id,
        `Ticket criado. Solicitante: ${usuarioNome.trim()} (${usuarioEmail.trim()}).`,
      );
      onCreated(created);
      setDescricao('');
      setAnexoUrl('');
    } catch (e: unknown) {
      const data =
        e && typeof e === 'object' && 'response' in e
          ? (e as { response?: { data?: unknown } }).response?.data
          : null;
      onError(data ? JSON.stringify(data) : 'Erro ao criar chamado.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Novo chamado de suporte</DialogTitle>
          <DialogDescription>
            Tipos, itens e motivos são carregados automaticamente quando a API expõe o endpoint de catálogo.
          </DialogDescription>
        </DialogHeader>

        {catalogLoading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-[var(--color-muted-foreground)]">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando catálogo…
          </div>
        ) : (
          <div className="grid gap-[12px] py-[8px]">
            <div className="grid gap-[6px]">
              <Label>Nome</Label>
              <Input value={usuarioNome} onChange={(e) => setUsuarioNome(e.target.value)} />
            </div>
            <div className="grid gap-[6px]">
              <Label>E-mail</Label>
              <Input type="email" value={usuarioEmail} onChange={(e) => setUsuarioEmail(e.target.value)} />
            </div>
            <div className="grid gap-[6px]">
              <Label>Setor</Label>
              <Input value={usuarioSetor} onChange={(e) => setUsuarioSetor(e.target.value)} placeholder="Opcional" />
            </div>
            <div className="grid gap-[6px]">
              <Label>Empresa</Label>
              <Input value={empresa} onChange={(e) => setEmpresa(e.target.value)} placeholder="Opcional" />
            </div>

            {useCatalogSelects ? (
              <>
                <div className="grid gap-[6px]">
                  <Label>Tipo</Label>
                  <FilterSelect options={tipoOptions} value={tipoId} onChange={setTipoId} placeholder="Selecione o tipo" />
                </div>
                <div className="grid gap-[6px]">
                  <Label>Item</Label>
                  <FilterSelect
                    options={itemOptions}
                    value={itemId}
                    onChange={setItemId}
                    disabled={!tipoSelecionado?.itens.length}
                    placeholder={tipoSelecionado?.itens.length ? 'Selecione o item' : 'Sem itens para este tipo'}
                  />
                </div>
                <div className="grid gap-[6px]">
                  <Label>Motivo</Label>
                  <FilterSelect
                    options={motivoOptions}
                    value={motivoId}
                    onChange={setMotivoId}
                    placeholder="Selecione o motivo"
                  />
                </div>
              </>
            ) : (
              <>
            {catalogFailed ? (
                  <p className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 rounded-[8px] px-[10px] py-[8px]">
                    Não foi possível carregar <code className="text-[11px]">suporte/catalogo/</code> ou o catálogo
                    veio vazio. Use os IDs numéricos abaixo ou ajuste{' '}
                    <code className="text-[11px]">VITE_FORMULARIOS_SUPORTE_CATALOGO_PATH</code>.
                  </p>
                ) : null}
                <div className="grid grid-cols-3 gap-[8px]">
                  <div className="grid gap-[6px]">
                    <Label>Tipo (id)</Label>
                    <Input inputMode="numeric" value={tipoManual} onChange={(e) => setTipoManual(e.target.value)} />
                  </div>
                  <div className="grid gap-[6px]">
                    <Label>Item (id)</Label>
                    <Input inputMode="numeric" value={itemManual} onChange={(e) => setItemManual(e.target.value)} />
                  </div>
                  <div className="grid gap-[6px]">
                    <Label>Motivo (id)</Label>
                    <Input inputMode="numeric" value={motivoManual} onChange={(e) => setMotivoManual(e.target.value)} />
                  </div>
                </div>
              </>
            )}

            <div className="grid gap-[6px]">
              <Label>Descrição</Label>
              <Textarea value={descricao} onChange={(e) => setDescricao(e.target.value)} rows={4} />
            </div>
            <div className="grid gap-[6px]">
              <Label>URL do anexo</Label>
              <Input value={anexoUrl} onChange={(e) => setAnexoUrl(e.target.value)} placeholder="https://…" />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="button" disabled={submitting || catalogLoading} onClick={() => void submit()}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Criar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function formatDt(iso?: string | null): string {
  const s = iso?.trim();
  if (!s) return '—';
  const out = formatDateTime(s);
  return out === 'N/A' ? '—' : out;
}

function DetailLinha({ rotulo, valor }: { rotulo: string; valor: ReactNode }) {
  return (
    <div className="grid gap-[4px]">
      <span className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-muted-foreground)]">
        {rotulo}
      </span>
      <div className="text-sm text-[var(--color-foreground)] break-words">{valor ?? '—'}</div>
    </div>
  );
}

function ChamadoDetailDialog({
  chamado,
  open,
  onOpenChange,
  assigneeName,
  users,
  getKanbanStageLabel,
  timelineRefreshNonce,
  bumpTimeline,
  onUpdated,
  onError,
}: {
  chamado: ChamadoSuporte | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  assigneeName: string;
  users: User[];
  getKanbanStageLabel: (c: ChamadoSuporte) => string;
  timelineRefreshNonce: number;
  bumpTimeline: () => void;
  onUpdated: (c: ChamadoSuporte) => void;
  onError: (m: string) => void;
}) {
  const [resolucao, setResolucao] = useState('');
  const [responsavelUserId, setResponsavelUserId] = useState('');
  const [saving, setSaving] = useState(false);
  const [notifying, setNotifying] = useState(false);
  const [empresaCopied, setEmpresaCopied] = useState(false);
  const [timelineOpen, setTimelineOpen] = useState(true);

  useEffect(() => {
    if (!chamado) return;
    setResolucao(stripPendenciaMarker(chamado.descricao_resolucao ?? ''));
    setResponsavelUserId(userIdFromResponsavelNome(users, chamado.responsavel_solucao));
    setEmpresaCopied(false);
    setTimelineOpen(true);
  }, [chamado, users]);

  if (!chamado) return null;

  const saveResolutionFields = async () => {
    const antes = chamado;
    try {
      setSaving(true);
      const isParado = (chamado.descricao_resolucao ?? '').startsWith(SUPORTE_PENDENCIA_PREFIX);
      const descPayload = isParado ? ensurePendenciaMarker(resolucao) : resolucao.trim() || null;
      const nomeSolucao = responsavelNomeFromUserId(users, responsavelUserId).trim();
      const updated = await suporteService.patch(chamado.id, {
        responsavel_solucao: nomeSolucao || null,
        descricao_resolucao: descPayload,
      });
      onUpdated(updated);
      await logSuporteChamadoChanges(antes, updated, getKanbanStageLabel);
      bumpTimeline();
    } catch (e: unknown) {
      const data =
        e && typeof e === 'object' && 'response' in e
          ? (e as { response?: { data?: unknown } }).response?.data
          : null;
      onError(data ? JSON.stringify(data) : 'Erro ao salvar.');
    } finally {
      setSaving(false);
    }
  };

  const pegarChamado = async () => {
    const antes = chamado;
    try {
      setSaving(true);
      const nomeSolucao = responsavelNomeFromUserId(users, responsavelUserId).trim();
      const updated = await suporteService.patch(chamado.id, {
        status: 'Em andamento',
        responsavel_solucao: assigneeName.trim() || nomeSolucao || null,
        descricao_resolucao: stripPendenciaMarker(resolucao).trim() || null,
      });
      setResponsavelUserId(userIdFromResponsavelNome(users, updated.responsavel_solucao));
      onUpdated(updated);
      await logSuporteChamadoChanges(antes, updated, getKanbanStageLabel);
      bumpTimeline();
    } catch {
      onError('Erro ao atribuir ticket.');
    } finally {
      setSaving(false);
    }
  };

  const notify = async () => {
    const antes = chamado;
    try {
      setNotifying(true);
      const updated = await suporteService.notificarUsuario(chamado.id);
      onUpdated(updated);
      await logSuporteChamadoChanges(antes, updated, getKanbanStageLabel);
      bumpTimeline();
    } catch {
      onError('Erro ao notificar usuário.');
    } finally {
      setNotifying(false);
    }
  };

  const empresaTexto = (chamado.empresa ?? '').trim();

  const copiarEmpresa = async () => {
    if (!empresaTexto) return;
    try {
      await navigator.clipboard.writeText(empresaTexto);
      setEmpresaCopied(true);
      window.setTimeout(() => setEmpresaCopied(false), 2000);
    } catch {
      onError('Não foi possível copiar para a área de transferência.');
    }
  };

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={onOpenChange}
        reserveRightPx={timelineOpen ? CARD_TIMELINE_LAYOUT_RESERVE_PX : undefined}
      >
        <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
          <DialogHeader className="flex flex-row flex-wrap items-start justify-between gap-x-3 gap-y-2 space-y-0 text-left">
            <DialogTitle className="flex-1 min-w-0 text-base font-semibold leading-snug pr-2">
              {tituloItemMotivo(chamado)}
            </DialogTitle>
            <div className="flex flex-wrap items-center justify-end gap-2 shrink-0">
              <Button
                type="button"
                variant={timelineOpen ? 'secondary' : 'outline'}
                size="sm"
                className="h-8 gap-1"
                onClick={() => setTimelineOpen((v) => !v)}
              >
                <PanelRight className="h-4 w-4 shrink-0" />
                Timeline
              </Button>
              <span className="text-[11px] font-normal tabular-nums text-[var(--color-muted-foreground)] pt-[3px]">
                ticket nº {chamado.id}
              </span>
            </div>
          </DialogHeader>

        <div className="space-y-[14px] py-[8px]">
          <div className="space-y-[6px]">
            <span className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-muted-foreground)]">
              Empresa
            </span>
            <div className="rounded-[8px] border border-[var(--color-border)] bg-[var(--color-muted)]/20 p-[12px]">
              <div className="flex items-start justify-between gap-[10px]">
                <p className="text-sm text-[var(--color-foreground)] break-words min-w-0 flex-1">
                  {empresaTexto || '—'}
                </p>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0 -mt-[4px]"
                  disabled={!empresaTexto}
                  title={empresaCopied ? 'Copiado!' : 'Copiar empresa'}
                  aria-label="Copiar nome da empresa"
                  onClick={() => void copiarEmpresa()}
                >
                  {empresaCopied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
            </div>
          </div>

          <div className="space-y-[6px]">
            <span className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-muted-foreground)]">
              Identificador do ticket
            </span>
            <div className="rounded-[8px] border border-[var(--color-border)] bg-[var(--color-muted)]/20 p-[12px] space-y-[12px]">
              <div className="grid gap-[10px] sm:grid-cols-2">
                <DetailLinha rotulo="Tipo" valor={catalogNome(chamado.tipo)} />
                <DetailLinha rotulo="Item" valor={catalogNome(chamado.item)} />
              </div>
              <DetailLinha rotulo="Motivo" valor={catalogNome(chamado.motivo)} />
            </div>
          </div>

          <div className="space-y-[6px]">
            <span className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-muted-foreground)]">
              Descrição do problema ocorrido
            </span>
            <div className="rounded-[8px] border border-[var(--color-border)] bg-[var(--color-muted)]/20 p-[12px]">
              <p className="text-sm whitespace-pre-wrap break-words text-[var(--color-foreground)]">
                {chamado.descricao?.trim() ? chamado.descricao : '—'}
              </p>
            </div>
          </div>

          <div className="space-y-[6px]">
            <span className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-muted-foreground)]">
              Anexo
            </span>
            <div className="rounded-[8px] border border-[var(--color-border)] bg-[var(--color-muted)]/20 p-[12px]">
              {chamado.anexo_url ? (
                <a
                  href={chamado.anexo_url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-[6px] text-sm text-[var(--color-primary)]"
                >
                  <ExternalLink className="h-4 w-4 shrink-0" />
                  Abrir anexo
                </a>
              ) : (
                <span className="text-sm text-[var(--color-muted-foreground)]">—</span>
              )}
            </div>
          </div>

          <div className="space-y-[6px]">
            <span className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-muted-foreground)]">
              Dados do solicitante
            </span>
            <div className="rounded-[8px] border border-[var(--color-border)] bg-[var(--color-muted)]/20 p-[12px] space-y-[12px]">
              <div className="grid gap-[10px] sm:grid-cols-2">
                <DetailLinha
                  rotulo="Solicitado por"
                  valor={
                    <span className="font-medium text-[var(--color-foreground)]">
                      {(chamado.usuario_nome ?? '').trim() || '—'}
                    </span>
                  }
                />
                <DetailLinha rotulo="Setor" valor={(chamado.usuario_setor ?? '').trim() || '—'} />
              </div>
              <DetailLinha
                rotulo="E-mail do solicitante"
                valor={<span className="break-all">{chamado.usuario_email?.trim() || '—'}</span>}
              />
            </div>
          </div>

          <div className="space-y-[6px]">
            <span className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-muted-foreground)]">
              Dados do ticket
            </span>
            <div className="rounded-[8px] border border-[var(--color-border)] bg-[var(--color-muted)]/20 p-[12px] space-y-[12px]">
              <div className="grid gap-[10px] sm:grid-cols-2">
                <DetailLinha rotulo="Status" valor={chamado.status} />
                <DetailLinha rotulo="Usuário notificado" valor={chamado.usuario_notificado ? 'Sim' : 'Não'} />
              </div>
              <div className="grid gap-[10px] sm:grid-cols-2">
                <DetailLinha rotulo="Aberto em" valor={formatDt(chamado.data_abertura)} />
                <DetailLinha rotulo="Atualizado em" valor={formatDt(chamado.data_atualizacao)} />
              </div>
            </div>
          </div>

          <DetailLinha
            rotulo="Responsável (pedido)"
            valor={
              (chamado.responsavel ?? '').trim() ? (
                <SuporteResponsavelFace
                  users={users}
                  nome={chamado.responsavel}
                  avatarClassName="h-9 w-9"
                  textClassName="text-sm font-medium text-[var(--color-foreground)]"
                />
              ) : (
                '—'
              )
            }
          />

          <div className="grid gap-[6px]">
            <Label>Responsável pelo ticket</Label>
            <div className="rounded-[8px] border border-[var(--color-border)] bg-[var(--color-muted)]/20 px-[12px] py-[10px]">
              <SuporteResponsavelFace
                users={users}
                userId={responsavelUserId}
                nome={chamado.responsavel_solucao}
                avatarClassName="h-10 w-10"
                textClassName="text-sm font-medium text-[var(--color-foreground)]"
              />
              {!responsavelUserId && !(chamado.responsavel_solucao ?? '').trim() ? (
                <p className="text-sm text-[var(--color-muted-foreground)]">Nenhum responsável atribuído.</p>
              ) : null}
            </div>
            <UserSelect
              users={users}
              value={responsavelUserId}
              onChange={setResponsavelUserId}
              placeholder="Selecione o responsável pelo ticket"
            />
          </div>

          <div className="grid gap-[6px]">
            <Label htmlFor="notas-resolucao">Notas de resolução</Label>
            <Textarea id="notas-resolucao" value={resolucao} onChange={(e) => setResolucao(e.target.value)} rows={5} />
          </div>

          <div className="flex flex-wrap gap-[8px] pt-[4px]">
            <Button type="button" variant="secondary" size="sm" disabled={saving} onClick={() => void pegarChamado()}>
              Pegar (Em andamento)
            </Button>
            <Button type="button" size="sm" disabled={saving} onClick={() => void saveResolutionFields()}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Salvar notas'}
            </Button>
            <Button type="button" variant="outline" size="sm" disabled={notifying} onClick={() => void notify()}>
              <Bell className="h-4 w-4 mr-[6px]" />
              {notifying ? '…' : 'Notificar usuário'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
    {open && timelineOpen ? (
      <SuporteTicketTimelinePanel
        chamadoId={chamado.id}
        refreshNonce={timelineRefreshNonce}
        onClose={() => setTimelineOpen(false)}
        onError={onError}
      />
    ) : null}
    </>
  );
}

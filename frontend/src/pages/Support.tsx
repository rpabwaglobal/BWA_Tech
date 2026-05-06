import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from 'react';
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
import {
  Loader2,
  Plus,
  Bell,
  ExternalLink,
  Copy,
  Check,
  PanelRight,
  Search,
  Settings,
  ChevronDown,
  LayoutGrid,
  List,
  Columns3,
  FileSpreadsheet,
  Download,
} from 'lucide-react';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
  proxyThroughDjango,
} from '@/services/formulariosApi';
import {
  suporteService,
  stripPendenciaMarker,
  ensurePendenciaMarker,
  catalogNome,
  hasPendenciaMarker,
  type ChamadoSuporte,
  type PatchChamadoSuportePayload,
  type CatalogoSuporteResponse,
} from '@/services/suporteService';
import { cn } from '@/lib/utils';
import { formatDateTime } from '@/lib/dateUtils';
import {
  getSuporteColumnDefsByGroup,
  SUPORTE_CHAMADOS_COLUMN_DEFS,
  SUPORTE_CHAMADOS_COLUMN_IDS,
  formatSuporteColumnValueForDisplay,
  type SuporteColumnGroup,
} from '@/lib/suporteChamadosColumns';
import { exportCardsToCSV, exportCardsToXLSX } from '@/lib/exportCards';
import { logSuporteChamadoChanges, logSuporteTicketCriado } from '@/lib/suporteTimelineLog';
import { userService, type User } from '@/services/userService';
import { suporteTimelineService } from '@/services/suporteTimelineService';

const SUPORTE_LIST_COLUMNS_STORAGE_KEY = 'bwa_suporte_list_columns_v1';

const STAGES = [
  { key: 'a_desenvolver' as const, label: 'A desenvolver', hint: 'Aguardando suporte' },
  { key: 'em_desenvolvimento' as const, label: 'Em desenvolvimento', hint: 'Com responsável' },
  { key: 'parado_pendencias' as const, label: 'Parado por pendências', hint: 'Em andamento bloqueado' },
  { key: 'inviabilizado' as const, label: 'Inviabilizado', hint: 'Cancelado na API' },
  { key: 'finalizado' as const, label: 'Concluído', hint: 'Resolvido na API' },
];

type StageKey = (typeof STAGES)[number]['key'];

function readStoredSuporteColumnIds(): string[] {
  try {
    const raw = window.localStorage.getItem(SUPORTE_LIST_COLUMNS_STORAGE_KEY);
    if (!raw) return SUPORTE_CHAMADOS_COLUMN_IDS;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return SUPORTE_CHAMADOS_COLUMN_IDS;
    const allowed = new Set(SUPORTE_CHAMADOS_COLUMN_IDS);
    const normalized = parsed.map(String).filter((id) => allowed.has(id));
    return normalized.length ? normalized : SUPORTE_CHAMADOS_COLUMN_IDS;
  } catch {
    return SUPORTE_CHAMADOS_COLUMN_IDS;
  }
}

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

function chamadoEncerradoNoQuadro(chamado: ChamadoSuporte): boolean {
  const s = chamadoToStage(chamado);
  return s === 'finalizado' || s === 'inviabilizado';
}

function useSuporteResolucaoDraft(
  chamadoId: number | undefined,
  descricaoResolucaoApi: string | null | undefined,
  concludingTicketId: number | null,
  enabled: boolean,
) {
  const [note, setNote] = useState('');
  const [dirty, setDirty] = useState(false);
  const busy = enabled && chamadoId != null && concludingTicketId === chamadoId;

  useEffect(() => {
    if (!enabled || chamadoId == null) return;
    setDirty(false);
  }, [chamadoId, enabled]);

  useEffect(() => {
    if (!enabled || dirty || chamadoId == null) return;
    setNote(stripPendenciaMarker(descricaoResolucaoApi ?? ''));
  }, [descricaoResolucaoApi, chamadoId, dirty, enabled]);

  return {
    note,
    setNote,
    markDirty: () => setDirty(true),
    busy,
    canConcluir: enabled && chamadoId != null && !!note.trim() && !busy,
  };
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
  const [concludingTicketId, setConcludingTicketId] = useState<number | null>(null);
  const [pendingInviabilizarChamado, setPendingInviabilizarChamado] = useState<ChamadoSuporte | null>(null);
  const [pendingPendenciaChamado, setPendingPendenciaChamado] = useState<ChamadoSuporte | null>(null);
  const [assignUsers, setAssignUsers] = useState<User[]>([]);
  const [timelineRefreshNonce, setTimelineRefreshNonce] = useState(0);
  const [suporteSearchQuery, setSuporteSearchQuery] = useState('');
  const [filterResponsavelSolucao, setFilterResponsavelSolucao] = useState('');
  const [viewMode, setViewMode] = useState<'kanban' | 'lista'>('kanban');
  const [selectedColumnIds, setSelectedColumnIds] = useState<string[]>(() => readStoredSuporteColumnIds());
  const [columnsDialogOpen, setColumnsDialogOpen] = useState(false);
  const [listExpandedColumnIds, setListExpandedColumnIds] = useState<Set<string>>(() => new Set());
  const [listExpandAllColumns, setListExpandAllColumns] = useState(false);
  const listHeaderClickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  useEffect(() => {
    try {
      window.localStorage.setItem(SUPORTE_LIST_COLUMNS_STORAGE_KEY, JSON.stringify(selectedColumnIds));
    } catch {
      /* ignore */
    }
  }, [selectedColumnIds]);

  useEffect(() => {
    if (viewMode !== 'lista') {
      setListExpandedColumnIds(new Set());
      setListExpandAllColumns(false);
    }
  }, [viewMode]);

  useEffect(() => {
    setListExpandedColumnIds(new Set());
    setListExpandAllColumns(false);
  }, [selectedColumnIds.join('|')]);

  useEffect(() => {
    return () => {
      if (listHeaderClickTimerRef.current) {
        clearTimeout(listHeaderClickTimerRef.current);
        listHeaderClickTimerRef.current = null;
      }
    };
  }, []);

  const mergeRemoteChamado = useCallback((row: ChamadoSuporte) => {
    setItems((prev) => upsertChamadoLista(prev, row));
    setDetailChamado((cur) => (cur?.id === row.id ? row : cur));
  }, []);

  useSuporteKanbanWebSocket({
    enabled: isAuthenticated && usesLocalFormulariosBackend(),
    onChamadoUpsert: mergeRemoteChamado,
  });

  /** Portal externo: novos chamados por WS; arrastar/outras alterações via polling (dev: proxy Vite com ws:true). Com proxy Django não há WS mesmo host → só polling. */
  useEffect(() => {
    if (!isAuthenticated || usesLocalFormulariosBackend() || proxyThroughDjango()) return;

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

  const visibleChamadosForList = filteredItems;
  const selectedColumnDefsSafe = SUPORTE_CHAMADOS_COLUMN_DEFS.filter((c) =>
    selectedColumnIds.includes(c.id),
  );

  const getExportFileBaseName = () => {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    const datahora = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
    return `Suporte - ${datahora}`;
  };

  const exportValueToString = (value: unknown): string =>
    typeof value === 'string' ? value : JSON.stringify(value ?? '');

  const handleExportCSV = (delimiter: ',' | ';') => {
    if (!selectedColumnDefsSafe.length) return;
    const headers = selectedColumnDefsSafe.map((c) => c.label);
    const rows = visibleChamadosForList.map((chamado) =>
      selectedColumnDefsSafe.map((col) => exportValueToString(col.getValue({ chamado }))),
    );
    const suffix = delimiter === ';' ? ' - ponto-e-virgula' : ' - virgula';
    exportCardsToCSV({ filename: `${getExportFileBaseName()}${suffix}.csv`, headers, rows, delimiter });
  };

  const handleExportXLSX = async () => {
    if (!selectedColumnDefsSafe.length) return;
    const headers = selectedColumnDefsSafe.map((c) => c.label);
    const rows = visibleChamadosForList.map((chamado) =>
      selectedColumnDefsSafe.map((col) => exportValueToString(col.getValue({ chamado }))),
    );
    await exportCardsToXLSX({
      filename: `${getExportFileBaseName()}.xlsx`,
      headers,
      rows,
      sheetName: 'Chamados',
    });
  };

  const toggleColumnId = (columnId: string, checked: boolean) => {
    setSelectedColumnIds((prev) => {
      const allowed = new Set(SUPORTE_CHAMADOS_COLUMN_IDS);
      if (!allowed.has(columnId)) return prev;
      const nextSet = new Set(prev);
      if (checked) nextSet.add(columnId);
      else nextSet.delete(columnId);
      return SUPORTE_CHAMADOS_COLUMN_DEFS.map((c) => c.id).filter((id) => nextSet.has(id));
    });
  };

  const clearListHeaderClickTimer = () => {
    if (listHeaderClickTimerRef.current) {
      clearTimeout(listHeaderClickTimerRef.current);
      listHeaderClickTimerRef.current = null;
    }
  };

  const onListColumnHeaderClick = (colId: string) => {
    clearListHeaderClickTimer();
    listHeaderClickTimerRef.current = setTimeout(() => {
      listHeaderClickTimerRef.current = null;
      setListExpandAllColumns((expandAll) => {
        if (expandAll) {
          setListExpandedColumnIds(new Set([colId]));
          return false;
        }
        setListExpandedColumnIds((prev) => {
          const n = new Set(prev);
          if (n.has(colId)) n.delete(colId);
          else n.add(colId);
          return n;
        });
        return expandAll;
      });
    }, 280);
  };

  const onListColumnHeaderDoubleClick = (e: MouseEvent<HTMLTableCellElement>) => {
    e.preventDefault();
    e.stopPropagation();
    clearListHeaderClickTimer();
    setListExpandAllColumns((prev) => {
      if (!prev) {
        setListExpandedColumnIds(new Set());
        return true;
      }
      setListExpandedColumnIds(new Set());
      return false;
    });
  };

  const handleDragStart = (e: DragStartEvent) => {
    const id = parseDragId(String(e.active.id));
    if (id == null) return;
    const found = items.find((x) => x.id === id);
    if (found && chamadoEncerradoNoQuadro(found)) return;
    setActiveDrag(found ?? null);
  };

  const applyPatchAndRefresh = useCallback(
    async (id: number, patch: PatchChamadoSuportePayload, before: ChamadoSuporte) => {
      const updated = await suporteService.patch(id, patch);
      setItems((prev) => prev.map((x) => (x.id === id ? updated : x)));
      setDetailChamado((d) => (d?.id === id ? updated : d));
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

  const handleConfirmInviabilizar = useCallback(() => {
    if (!pendingInviabilizarChamado) return;
    const chamado = pendingInviabilizarChamado;
    setPendingInviabilizarChamado(null);

    void (async () => {
      try {
        const patch = patchForStage('inviabilizado', chamado, assigneeName);
        await applyPatchAndRefresh(chamado.id, patch, chamado);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Erro ao atualizar chamado.');
        void load();
      }
    })();
  }, [pendingInviabilizarChamado, assigneeName, applyPatchAndRefresh, load]);

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

    if (chamadoEncerradoNoQuadro(chamado)) return;

    if (chamadoToStage(chamado) === targetStage) return;

    if (targetStage === 'parado_pendencias') {
      setPendingPendenciaChamado(chamado);
      return;
    }

    if (targetStage === 'finalizado') {
      setError(
        'Para concluir, abra o ticket e preencha «Descrição da resolução» em seguida clique em «Concluir card».',
      );
      return;
    }

    if (targetStage === 'inviabilizado') {
      setPendingInviabilizarChamado(chamado);
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

  const handleConcluirTicketNoCard = useCallback(
    async (chamado: ChamadoSuporte, notasResolucao: string) => {
      const noteTrim = notasResolucao.trim();
      if (!noteTrim) return;
      setConcludingTicketId(chamado.id);
      setError(null);
      try {
        const patch = patchForStage('finalizado', chamado, assigneeName, noteTrim);
        await applyPatchAndRefresh(chamado.id, patch, chamado);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Erro ao concluir ticket.');
        void load();
      } finally {
        setConcludingTicketId(null);
      }
    },
    [assigneeName, applyPatchAndRefresh, load],
  );

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-[16px] p-[16px] md:p-[24px]">
      <header className="flex shrink-0 flex-col gap-[12px]">
        <h1 className="text-xl font-semibold text-[var(--color-foreground)]">Suporte</h1>
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
          <div className="flex shrink-0 flex-col gap-[4px]">
            <span className="mb-[4px] block text-xs text-[var(--color-muted-foreground)]">Opções</span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  className="h-[40px] gap-[8px] border-[var(--color-border)] px-[14px] shadow-sm hover:bg-[var(--color-accent)]"
                  title="Opções da página Suporte"
                  disabled={loading}
                >
                  <Settings className="h-[18px] w-[18px] shrink-0 text-[var(--color-muted-foreground)]" />
                  <span className="hidden text-sm font-medium sm:inline">Opções</span>
                  <ChevronDown className="h-[16px] w-[16px] shrink-0 opacity-60" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-[min(100vw-24px,300px)] overflow-hidden p-0">
                <div className="border-b border-[var(--color-border)] bg-[var(--color-muted)]/25 px-3 py-2.5">
                  <p className="text-sm font-semibold text-[var(--color-foreground)]">Suporte</p>
                  <p className="mt-0.5 text-[11px] leading-tight text-[var(--color-muted-foreground)]">
                    Visualização da página e exportação dos tickets
                  </p>
                </div>
                <div className="p-1.5">
                  <DropdownMenuItem
                    className="gap-2 rounded-md py-2.5"
                    onClick={() => setCreateOpen(true)}
                  >
                    <Plus className="h-4 w-4 shrink-0 text-[var(--color-primary)]" />
                    <span className="flex-1 text-left font-medium">Novo chamado</span>
                  </DropdownMenuItem>

                  <DropdownMenuSeparator className="my-2" />

                  <p className="mb-1 px-2 pt-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
                    Modo de visualização
                  </p>
                  <DropdownMenuItem className="gap-2 rounded-md py-2.5" onClick={() => setViewMode('kanban')}>
                    <LayoutGrid className="h-4 w-4 shrink-0 text-[var(--color-primary)]" />
                    <span className="flex-1 text-left font-medium">Kanban</span>
                    {viewMode === 'kanban' ? (
                      <Check className="h-4 w-4 shrink-0 text-[var(--color-primary)]" />
                    ) : (
                      <span className="h-4 w-4 shrink-0" aria-hidden />
                    )}
                  </DropdownMenuItem>
                  <DropdownMenuItem className="gap-2 rounded-md py-2.5" onClick={() => setViewMode('lista')}>
                    <List className="h-4 w-4 shrink-0 text-[var(--color-primary)]" />
                    <span className="flex-1 text-left font-medium">Lista</span>
                    {viewMode === 'lista' ? (
                      <Check className="h-4 w-4 shrink-0 text-[var(--color-primary)]" />
                    ) : (
                      <span className="h-4 w-4 shrink-0" aria-hidden />
                    )}
                  </DropdownMenuItem>

                  {viewMode === 'lista' && (
                    <>
                      <DropdownMenuSeparator className="my-2" />
                      <DropdownMenuItem
                        className="gap-2 rounded-md py-2.5"
                        onClick={() => setColumnsDialogOpen(true)}
                      >
                        <Columns3 className="h-4 w-4 shrink-0 text-[var(--color-muted-foreground)]" />
                        <span className="flex-1 text-left">Selecionar colunas</span>
                      </DropdownMenuItem>
                    </>
                  )}

                  <DropdownMenuSeparator className="my-2" />
                  <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
                    Exportar tickets
                  </p>
                  <p className="mb-2 px-2 text-[11px] leading-snug text-[var(--color-muted-foreground)]">
                    Usa os filtros atuais e as colunas marcadas na lista.
                  </p>
                  <DropdownMenuItem
                    className="gap-2 rounded-md py-2.5"
                    onClick={() => handleExportCSV(',')}
                    disabled={visibleChamadosForList.length === 0 || selectedColumnDefsSafe.length === 0}
                  >
                    <FileSpreadsheet className="h-4 w-4 shrink-0 text-green-600" />
                    <span className="flex-1 text-left">{`CSV separado por ","`}</span>
                    <Download className="h-3.5 w-3.5 shrink-0 opacity-50" />
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="gap-2 rounded-md py-2.5"
                    onClick={() => handleExportCSV(';')}
                    disabled={visibleChamadosForList.length === 0 || selectedColumnDefsSafe.length === 0}
                  >
                    <FileSpreadsheet className="h-4 w-4 shrink-0 text-green-600" />
                    <span className="flex-1 text-left">{`CSV separado por ";"`}</span>
                    <Download className="h-3.5 w-3.5 shrink-0 opacity-50" />
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="gap-2 rounded-md py-2.5"
                    onClick={() => {
                      void handleExportXLSX();
                    }}
                    disabled={visibleChamadosForList.length === 0 || selectedColumnDefsSafe.length === 0}
                  >
                    <FileSpreadsheet className="h-4 w-4 shrink-0 text-emerald-700" />
                    <span className="flex-1 text-left">Planilha (.xlsx)</span>
                    <Download className="h-3.5 w-3.5 shrink-0 opacity-50" />
                  </DropdownMenuItem>
                </div>
              </DropdownMenuContent>
            </DropdownMenu>
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
        ) : viewMode === 'lista' ? (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <div className="flex flex-col flex-1 min-h-0 min-w-0 mt-[16px] px-[8px] pb-[8px]">
              {selectedColumnDefsSafe.length === 0 ? (
                <div className="flex flex-1 min-h-0 items-center justify-center text-center px-[16px] text-sm text-[var(--color-muted-foreground)]">
                  Selecione ao menos uma coluna em{' '}
                  <span className="font-semibold">Selecionar colunas</span>.
                </div>
              ) : visibleChamadosForList.length === 0 ? (
                <div className="flex flex-1 min-h-0 items-center justify-center text-center px-[16px] text-sm text-[var(--color-muted-foreground)]">
                  Nenhum ticket na lista (com os filtros atuais).
                </div>
              ) : (
                <div className="flex flex-col flex-1 min-h-0 min-w-0 gap-[8px]">
                  <p className="flex-shrink-0 text-[11px] text-[var(--color-muted-foreground)] leading-snug px-[4px]">
                    <span className="font-medium text-[var(--color-foreground)]">Tabela:</span>{' '}
                    clique no <span className="font-medium">cabeçalho</span> da coluna para mostrar/ocultar o texto
                    completo nela; <span className="font-medium">duplo clique</span> no cabeçalho expande ou recolhe{' '}
                    <span className="font-medium">todas</span> as colunas (como ajustar largura no Excel).
                    {listExpandAllColumns ? (
                      <span className="ml-[6px] text-primary font-medium">(modo: todas expandidas)</span>
                    ) : null}
                  </p>
                  <div className="min-h-0 min-w-0 flex-1 overflow-auto overscroll-contain rounded-[8px] border border-[var(--color-border)] bg-[var(--color-background)] [scrollbar-gutter:stable]">
                    <table className="w-max min-w-full border-collapse text-xs">
                      <thead className="sticky top-0 z-[10] bg-[var(--color-background)] shadow-[0_1px_0_var(--color-border)]">
                        <tr>
                          {selectedColumnDefsSafe.map((col) => {
                            const colExpanded =
                              listExpandAllColumns || listExpandedColumnIds.has(col.id);
                            return (
                              <th
                                key={col.id}
                                scope="col"
                                className={cn(
                                  'border-b border-r border-[var(--color-border)] px-2 py-2 text-left font-semibold text-[var(--color-foreground)] align-bottom',
                                  'cursor-pointer select-none whitespace-nowrap w-auto max-w-[14rem]',
                                  colExpanded
                                    ? 'bg-[var(--color-primary)]/12'
                                    : 'bg-[var(--color-muted)]/35',
                                )}
                                title="Clique: expandir/recolher esta coluna · Duplo clique: todas as colunas"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onListColumnHeaderClick(col.id);
                                }}
                                onDoubleClick={(e) => onListColumnHeaderDoubleClick(e)}
                              >
                                {col.label}
                              </th>
                            );
                          })}
                        </tr>
                      </thead>
                      <tbody>
                        {visibleChamadosForList.map((chamado) => (
                          <tr
                            key={chamado.id}
                            className="border-b border-[var(--color-border)] hover:bg-[var(--color-muted)]/20 cursor-pointer"
                            onClick={() => setDetailChamado(chamado)}
                          >
                            {selectedColumnDefsSafe.map((col) => {
                              const text = formatSuporteColumnValueForDisplay(
                                col.getValue({ chamado }),
                              );
                              const expanded =
                                listExpandAllColumns || listExpandedColumnIds.has(col.id);
                              return (
                                <td
                                  key={col.id}
                                  className={cn(
                                    'border-r border-[var(--color-border)] px-2 py-1.5 align-top text-[var(--color-foreground)]',
                                    expanded
                                      ? 'whitespace-pre-wrap break-words max-w-[min(42rem,92vw)]'
                                      : 'max-w-[9rem] sm:max-w-[12rem] overflow-hidden text-ellipsis whitespace-nowrap',
                                  )}
                                  title={expanded || text.length <= 80 ? undefined : text}
                                >
                                  {text}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
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

      <Dialog
        open={columnsDialogOpen}
        onOpenChange={setColumnsDialogOpen}
        containerClassName="max-w-[min(1420px,calc(100vw-1.5rem))]"
      >
        <DialogContent className="flex max-h-[min(90vh,900px)] w-full max-w-none flex-col gap-0 overflow-hidden p-0">
          <div className="border-b border-[var(--color-border)] px-6 pb-4 pt-6">
            <DialogHeader className="space-y-1 text-left">
              <DialogTitle>Selecionar colunas</DialogTitle>
              <DialogDescription>
                Ticket e Solicitante — até 5 opções por linha em cada bloco. As marcas valem para a lista e para
                CSV/XLSX.
              </DialogDescription>
            </DialogHeader>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setSelectedColumnIds(SUPORTE_CHAMADOS_COLUMN_IDS)}
              >
                Marcar todos
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => setSelectedColumnIds([])}>
                Desmarcar todos
              </Button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
            <div className="flex flex-col gap-6">
              {(['ticket', 'solicitante'] as SuporteColumnGroup[]).map((group) => {
                const groupColumns = getSuporteColumnDefsByGroup(group);
                const title = group === 'ticket' ? 'Ticket' : 'Solicitante';
                const groupIds = groupColumns.map((c) => c.id);
                const toggleGroup = (checked: boolean) => {
                  setSelectedColumnIds((prev) => {
                    const set = new Set(prev);
                    if (checked) {
                      groupIds.forEach((id) => set.add(id));
                    } else {
                      groupIds.forEach((id) => set.delete(id));
                    }
                    return SUPORTE_CHAMADOS_COLUMN_DEFS.map((c) => c.id).filter((id) => set.has(id));
                  });
                };
                return (
                  <section
                    key={group}
                    className="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] shadow-sm"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border)] bg-[var(--color-muted)]/30 px-4 py-3">
                      <h3 className="text-sm font-semibold tracking-tight text-[var(--color-foreground)]">
                        {title}
                      </h3>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 text-xs"
                          onClick={() => toggleGroup(true)}
                        >
                          Marcar bloco
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 text-xs"
                          onClick={() => toggleGroup(false)}
                        >
                          Limpar bloco
                        </Button>
                      </div>
                    </div>
                    <div className="px-4 py-3">
                      <div className="grid w-full grid-cols-5 gap-x-3 gap-y-3">
                        {groupColumns.map((col) => {
                          const on = selectedColumnIds.includes(col.id);
                          return (
                            <label
                              key={col.id}
                              className="flex min-w-0 cursor-pointer items-start gap-2 py-0.5 hover:bg-[var(--color-muted)]/20"
                            >
                              <input
                                type="checkbox"
                                className="mt-0.5 h-4 w-4 shrink-0 rounded border-[var(--color-input)]"
                                checked={on}
                                onChange={(e) => toggleColumnId(col.id, e.target.checked)}
                              />
                              <span
                                className={cn(
                                  'text-xs leading-snug break-words [overflow-wrap:anywhere]',
                                  on
                                    ? 'font-medium text-[var(--color-primary)]'
                                    : 'text-[var(--color-foreground)]',
                                )}
                              >
                                {col.label}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  </section>
                );
              })}
            </div>
          </div>

          <div className="border-t border-[var(--color-border)] px-6 py-4">
            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="outline" onClick={() => setColumnsDialogOpen(false)}>
                Cancelar
              </Button>
              <Button type="button" onClick={() => setColumnsDialogOpen(false)}>
                Concluir
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

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
        concludingTicketId={concludingTicketId}
        onConcluirTicket={handleConcluirTicketNoCard}
        onUpdated={(c) => {
          setItems((prev) => prev.map((x) => (x.id === c.id ? c : x)));
          setDetailChamado((d) => (d?.id === c.id ? c : d));
        }}
        onError={(m) => setError(m)}
      />

      <ConclusaoModal
        isOpen={!!pendingInviabilizarChamado}
        onClose={() => setPendingInviabilizarChamado(null)}
        onConfirm={handleConfirmInviabilizar}
        cardName={
          pendingInviabilizarChamado ? tituloItemMotivo(pendingInviabilizarChamado) : undefined
        }
        variant="inviabilizado"
        nameLabel="Ticket"
      />

      <PendenciaModal
        isOpen={!!pendingPendenciaChamado}
        onClose={() => setPendingPendenciaChamado(null)}
        onConfirm={handlePendenciaConfirm}
        cardName={pendingPendenciaChamado ? tituloItemMotivo(pendingPendenciaChamado) : ''}
      />
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
  const bloqueado = chamadoEncerradoNoQuadro(chamado);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: dragId(chamado.id),
    disabled: bloqueado,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.45 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'w-full space-y-[6px] rounded-[10px] border border-[var(--color-border)] bg-[var(--color-background)] p-[10px] text-left shadow-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] focus-visible:ring-offset-2',
        bloqueado
          ? 'cursor-default'
          : 'touch-none cursor-grab hover:border-[var(--color-primary)]/40 active:cursor-grabbing',
      )}
      {...(!bloqueado ? { ...attributes, ...listeners } : { tabIndex: 0, role: 'button' as const })}
      title={bloqueado ? 'Ticket concluído ou inviabilizado — não pode ser movido no quadro' : undefined}
      onClick={() => onOpen()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
    >
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
  concludingTicketId,
  onConcluirTicket,
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
  concludingTicketId: number | null;
  onConcluirTicket: (c: ChamadoSuporte, note: string) => void | Promise<void>;
  onUpdated: (c: ChamadoSuporte) => void;
  onError: (m: string) => void;
}) {
  const [responsavelUserId, setResponsavelUserId] = useState('');
  const [saving, setSaving] = useState(false);
  const [notifying, setNotifying] = useState(false);
  const [empresaCopied, setEmpresaCopied] = useState(false);
  const [timelineOpen, setTimelineOpen] = useState(true);
  const [pegarCardConfirmOpen, setPegarCardConfirmOpen] = useState(false);

  useEffect(() => {
    if (!chamado) return;
    setResponsavelUserId(userIdFromResponsavelNome(users, chamado.responsavel_solucao));
    setEmpresaCopied(false);
    setTimelineOpen(true);
    setPegarCardConfirmOpen(false);
  }, [chamado, users]);

  const resolucaoDraft = useSuporteResolucaoDraft(
    chamado?.id,
    chamado?.descricao_resolucao,
    concludingTicketId,
    chamado != null && !chamadoEncerradoNoQuadro(chamado),
  );

  if (!chamado) return null;

  const encerradoNoQuadro = chamadoEncerradoNoQuadro(chamado);

  const persistResponsavelSeAlterado = async (nextUserId: string) => {
    if (encerradoNoQuadro) return;

    setResponsavelUserId(nextUserId);
    const nomeSolucao = responsavelNomeFromUserId(users, nextUserId).trim();
    const atualNome = (chamado.responsavel_solucao ?? '').trim();
    if (nomeSolucao === atualNome) return;

    const antes = chamado;
    try {
      setSaving(true);
      const updated = await suporteService.patch(chamado.id, {
        responsavel_solucao: nomeSolucao || null,
      });
      onUpdated(updated);
      await logSuporteChamadoChanges(antes, updated, getKanbanStageLabel);
      bumpTimeline();
    } catch (e: unknown) {
      setResponsavelUserId(userIdFromResponsavelNome(users, chamado.responsavel_solucao));
      const data =
        e && typeof e === 'object' && 'response' in e
          ? (e as { response?: { data?: unknown } }).response?.data
          : null;
      onError(data ? JSON.stringify(data) : 'Erro ao atualizar responsável.');
    } finally {
      setSaving(false);
    }
  };

  const executarPegarCard = async () => {
    if (encerradoNoQuadro) return;

    const antes = chamado;
    setPegarCardConfirmOpen(false);
    try {
      setSaving(true);
      const nomeReserva = responsavelNomeFromUserId(users, responsavelUserId).trim();
      const novoResponsavel = assigneeName.trim() || nomeReserva || null;
      const updated = await suporteService.patch(chamado.id, {
        status: 'Em andamento',
        responsavel_solucao: novoResponsavel,
        descricao_resolucao: stripPendenciaMarker(chamado.descricao_resolucao ?? '').trim() || null,
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

  const solicitarPegarCard = () => {
    if (encerradoNoQuadro) return;

    const atualResp = (chamado.responsavel_solucao ?? '').trim();
    const eu = assigneeName.trim();
    const mesmoEu = eu.length > 0 && atualResp.toLowerCase() === eu.toLowerCase();
    if (atualResp && !mesmoEu) {
      setPegarCardConfirmOpen(true);
      return;
    }
    void executarPegarCard();
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
              onChange={(id) => void persistResponsavelSeAlterado(id)}
              placeholder="Selecione o responsável pelo ticket"
              disabled={saving || encerradoNoQuadro}
            />
            {encerradoNoQuadro ? (
              <p className="text-[11px] text-[var(--color-muted-foreground)] leading-snug">
                Tickets concluídos ou inviabilizados não permitem alterar o responsável pelo ticket.
              </p>
            ) : null}
          </div>

          {chamadoEncerradoNoQuadro(chamado) ? (
            <div className="grid gap-[6px]">
              <Label>Notas de resolução</Label>
              <div className="rounded-[8px] border border-[var(--color-border)] bg-[var(--color-muted)]/20 p-[12px]">
                <p className="text-sm whitespace-pre-wrap break-words text-[var(--color-foreground)]">
                  {stripPendenciaMarker(chamado.descricao_resolucao ?? '').trim() || '—'}
                </p>
              </div>
            </div>
          ) : (
            <div className="grid gap-[6px]" onPointerDown={(e) => e.stopPropagation()}>
              <Label
                htmlFor={`desc-resolucao-${chamado.id}`}
                className="text-[10px] font-medium uppercase tracking-wide text-[var(--color-muted-foreground)]"
              >
                Descrição da resolução
              </Label>
              <Textarea
                id={`desc-resolucao-${chamado.id}`}
                value={resolucaoDraft.note}
                onChange={(e) => {
                  resolucaoDraft.markDirty();
                  resolucaoDraft.setNote(e.target.value);
                }}
                placeholder="Obrigatório para concluir o ticket…"
                rows={3}
                disabled={resolucaoDraft.busy}
                className="min-h-0 resize-none text-[12px]"
              />
            </div>
          )}

          <div
            className="flex w-full gap-[8px] border-t border-[var(--color-border)] pt-[10px]"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="min-h-[36px] flex-1 basis-0 min-w-0 justify-center text-center whitespace-normal px-[8px] py-[8px]"
              disabled={saving || chamadoEncerradoNoQuadro(chamado)}
              onClick={() => void solicitarPegarCard()}
            >
              Pegar Card
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-h-[36px] flex-1 basis-0 min-w-0 justify-center text-center whitespace-normal px-[8px] py-[8px]"
              disabled={notifying}
              onClick={() => void notify()}
            >
              <span className="inline-flex items-center justify-center gap-[6px]">
                <Bell className="h-4 w-4 shrink-0" />
                {notifying ? '…' : 'Notificar usuário'}
              </span>
            </Button>
            {!chamadoEncerradoNoQuadro(chamado) ? (
              <Button
                type="button"
                size="sm"
                className="min-h-[36px] flex-1 basis-0 min-w-0 justify-center text-center whitespace-normal px-[8px] py-[8px]"
                disabled={!resolucaoDraft.canConcluir}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  void onConcluirTicket(chamado, resolucaoDraft.note.trim());
                }}
              >
                {resolucaoDraft.busy ? (
                  <span className="inline-flex items-center justify-center gap-[8px]">
                    <Loader2 className="h-[14px] w-[14px] shrink-0 animate-spin" />
                    Concluindo…
                  </span>
                ) : (
                  'Concluir card'
                )}
              </Button>
            ) : null}
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

      <Dialog open={pegarCardConfirmOpen} onOpenChange={(v) => !v && !saving && setPegarCardConfirmOpen(false)}>
        <DialogContent className="sm:max-w-[440px]" onClose={() => !saving && setPegarCardConfirmOpen(false)}>
          <DialogHeader>
            <DialogTitle>Pegar card</DialogTitle>
            <DialogDescription>
              Este ticket já tem um desenvolvedor responsável (abaixo). Deseja pegar o card mesmo assim? Ao confirmar,
              você passará a ser o responsável pelo ticket.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-[10px] border border-[var(--color-border)] bg-[var(--color-muted)]/20 px-[14px] py-[12px]">
            <SuporteResponsavelFace
              users={users}
              nome={chamado.responsavel_solucao}
              avatarClassName="h-12 w-12"
              textClassName="text-[15px] font-semibold text-[var(--color-foreground)]"
            />
          </div>
          <DialogFooter className="gap-[8px] sm:gap-0">
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={() => setPegarCardConfirmOpen(false)}
            >
              Cancelar
            </Button>
            <Button type="button" disabled={saving} onClick={() => void executarPegarCard()}>
              {saving ? (
                <>
                  <Loader2 className="mr-[8px] h-4 w-4 animate-spin" />
                  Atribuindo…
                </>
              ) : (
                'Confirmar'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

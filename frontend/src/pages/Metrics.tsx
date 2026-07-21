import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { FilterSelect } from '@/components/ui/filter-select';
import { Button } from '@/components/ui/button';
import { MetricasSuporte } from '@/components/MetricasSuporte';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { DateTimePicker } from '@/components/ui/datetime-picker';
import { UserSelect, getRoleColor } from '@/components/ui/user-select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { BarChart3, Trophy, Flame, Target, Loader2, FolderKanban, ChevronDown, ChevronRight, Search, Timer, Gauge, Layers } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Cell } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import {
  cardService,
  type Card as FullCardType,
  type CardForMetrics,
  CARD_AREAS,
  CARD_TYPES,
  CARD_PRIORITIES,
  CARD_STATUSES,
} from '@/services/cardService';
import { sprintService, type Sprint } from '@/services/sprintService';
import { userService, type User } from '@/services/userService';
import { projectService, type Project } from '@/services/projectService';
import { useAuth } from '@/context/AuthContext';
import { cn } from '@/lib/utils';
import { ROUTES } from '@/routes';
import { cachedFetch } from '@/lib/cachedFetch';

/** Alias usado em todo o módulo. Slim para todos os cálculos de métricas
 * (sem nested), com campos suficientes para o modal de drill-down. */
type CardType = CardForMetrics;

/** TTL do cache SWR: 60s. */
const METRICS_CACHE_TTL_MS = 60_000;
const METRICS_CACHE_KEY = 'metrics:bundle:v1';
type MetricsBundle = {
  cards: CardForMetrics[];
  sprints: Sprint[];
  users: User[];
  projects: Project[];
};

const CLOSED_STATUS = 'finalizado';

const MONTH_NAMES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

const MONTH_ABBREV = [
  'Jan.', 'Fev.', 'Mar.', 'Abr.', 'Mai.', 'Jun.',
  'Jul.', 'Ago.', 'Set.', 'Out.', 'Nov.', 'Dez.',
];

const chartConfigCount = {
  count: { label: 'Entregas', color: 'var(--color-primary)' },
} satisfies ChartConfig;

function getShortDisplayName(user: User): string {
  const firstRaw = user.first_name?.trim() ?? '';
  const lastRaw = user.last_name?.trim() ?? '';
  const firstParts = firstRaw.split(/\s+/).filter(Boolean);
  const lastParts = lastRaw.split(/\s+/).filter(Boolean);
  const firstName = firstParts[0] ?? '';
  const firstSurname = lastParts[0] ?? (firstParts.length > 1 ? firstParts[1] : '');
  const name = `${firstName} ${firstSurname}`.trim();
  return name || user.username || '';
}

/** Tag abreviada por cargo – igual ao UserSelect (seleção de responsável no card) */
function getRoleLabel(role: string): string {
  switch (role) {
    case 'desenvolvedor':
      return 'Dev.';
    case 'dados':
      return 'Dados';
    case 'processos':
      return 'Proc.';
    case 'supervisor':
      return 'Super.';
    case 'gerente':
      return 'G. Proj.';
    case 'admin':
      return 'Admin';
    default:
      return role;
  }
}

function getRoleBadgeColor(role: string): string {
  switch (role) {
    case 'admin':
      return 'bg-purple-100 text-purple-800 border-purple-300';
    case 'supervisor':
      return 'bg-blue-100 text-blue-800 border-blue-300';
    case 'gerente':
      return 'bg-green-100 text-green-800 border-green-300';
    case 'desenvolvedor':
      return 'bg-orange-100 text-orange-800 border-orange-300';
    case 'dados':
      return 'bg-purple-100 text-purple-800 border-purple-300';
    case 'processos':
      return 'bg-red-100 text-red-800 border-red-300';
    default:
      return 'bg-gray-100 text-gray-800 border-gray-300';
  }
}

/** Cores das barras por cargo – mesmas dos nodes no canvas da página Pessoas (tons suaves) */
function getRoleBarColor(role: string): string {
  switch (role) {
    case 'admin':
      return '#c4b5fd'; // purple-300
    case 'supervisor':
      return '#93c5fd'; // blue-300
    case 'gerente':
      return '#86efac'; // green-300
    case 'desenvolvedor':
      return '#fdba74'; // orange-300
    case 'dados':
      return '#c4b5fd'; // purple-300
    case 'processos':
      return '#fca5a5'; // red-300
    default:
      return '#9ca3af'; // gray-400
  }
}

function normalizeProjectName(value?: string | null): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/** Compatibilidade: usado em alguns lugares antigos. Preferir `is_system` do
 * backend quando dispon\u00edvel (mais robusto a renomea\u00e7\u00f5es). */
function isSpecialProjectName(value?: string | null): boolean {
  const n = normalizeProjectName(value);
  return n === 'suporte' || n === 'sugestoes' || n === 'projetos descartados';
}

/** ID da sprint do card. Lê o campo denormalizado `sprint` do CardForMetrics
 * (que vem direto do projeto_detail no backend) com fallback para o lookup
 * de projects no client. */
function resolveCardSprintId(card: CardType, projects: Project[]): string | null {
  if (card.sprint != null && String(card.sprint).trim() !== '') {
    return String(card.sprint);
  }
  const p = projects.find((pr) => String(pr.id) === String(card.projeto));
  if (p?.sprint != null && String(p.sprint).trim() !== '') {
    return String(p.sprint);
  }
  return null;
}

/** Quando o card foi de fato entregue. SEMPRE `finalizado_em` — a data e hora
 * em que o usuário arrastou o card para "Concluído". NÃO usar `updated_at`
 * como fallback (edições posteriores ao card mascarariam a data real). */
function getCardDeliveryDate(card: CardType): Date | null {
  if (!card.finalizado_em) return null;
  const d = new Date(card.finalizado_em);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** True se o projeto do card é "sistêmico" (Suporte / Sugestões / Descartados).
 * Usa a flag denormalizada `projeto_is_system` que vem direto do endpoint slim. */
function isSystemProject(card: CardType): boolean {
  return card.projeto_is_system === true;
}

function formatConsistencyDateTime(value?: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function sortCardsByDeliveryDesc(a: CardType, b: CardType): number {
  const da = getCardDeliveryDate(a)?.getTime() ?? 0;
  const db = getCardDeliveryDate(b)?.getTime() ?? 0;
  return db - da;
}

/** Altura por linha nos gráficos de barras horizontais (avatar + nome no eixo Y). */
const USER_BAR_CHART_ROW_PX = 48;
const USER_BAR_CHART_MAX_PX = 1400;

function userVerticalBarChartHeight(rowCount: number, minPx: number): number {
  if (rowCount <= 0) return minPx;
  return Math.min(USER_BAR_CHART_MAX_PX, Math.max(minPx, rowCount * USER_BAR_CHART_ROW_PX));
}

const EMPTY_METRICS_CARD_FORM = {
  nome: '',
  descricao: '',
  script_url: '',
  area: 'backend',
  tipo: 'feature',
  prioridade: 'media',
  status: 'a_desenvolver',
  responsavel: '',
  data_inicio: '',
  data_fim: '',
};

/** Linha clicável no modal de consistência (lista de entregues). */
function MetricsDeliveredCardRow({
  card,
  variant,
  onSelect,
}: {
  card: CardType;
  variant: 'onTime' | 'late';
  onSelect: (id: string) => void;
}) {
  const badge =
    variant === 'onTime' ? (
      <Badge className="shrink-0 border-green-600/40 bg-green-500/15 text-green-800 dark:text-green-400">
        No prazo
      </Badge>
    ) : (
      <Badge className="shrink-0 border-red-600/40 bg-red-500/15 text-red-800 dark:text-red-400">
        Fora do prazo
      </Badge>
    );
  return (
    <li>
      <button
        type="button"
        className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-card)] p-3 text-left text-sm transition-colors hover:bg-[var(--color-accent)]"
        onClick={() => void onSelect(card.id)}
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <span className="font-medium text-[var(--color-foreground)]">{card.nome}</span>
          {badge}
        </div>
        {card.projeto_nome && (
          <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">Projeto: {card.projeto_nome}</p>
        )}
        <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs sm:grid-cols-4">
          <div>
            <dt className="text-[var(--color-muted-foreground)]">Criação</dt>
            <dd className="font-medium text-[var(--color-foreground)]">
              {formatConsistencyDateTime(card.created_at)}
            </dd>
          </div>
          <div>
            <dt className="text-[var(--color-muted-foreground)]">Em desenvolvimento</dt>
            <dd className="font-medium text-[var(--color-foreground)]">
              {formatConsistencyDateTime(card.data_inicio)}
            </dd>
          </div>
          <div>
            <dt className="text-[var(--color-muted-foreground)]">Entrega agendada</dt>
            <dd className="font-medium text-[var(--color-foreground)]">
              {formatConsistencyDateTime(card.data_fim)}
            </dd>
          </div>
          <div>
            <dt className="text-[var(--color-muted-foreground)]">Conclusão real</dt>
            <dd className="font-medium text-[var(--color-foreground)]">
              {formatConsistencyDateTime(card.finalizado_em || card.updated_at)}
            </dd>
          </div>
        </dl>
      </button>
    </li>
  );
}

export default function Metrics() {
  const { user: authUser } = useAuth();
  const isSupervisor = authUser?.role === 'supervisor' || authUser?.role === 'admin';

  const [cards, setCards] = useState<CardType[]>([]);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  // Tab interna da página de Métricas. Abre em "Suporte" quando ?tab=suporte
  // (usado pelo botão "Métricas do suporte" na página de Suporte).
  const [activeMetricsTab, setActiveMetricsTab] = useState<'projetos_cards' | 'suporte'>(
    () => (new URLSearchParams(window.location.search).get('tab') === 'suporte' ? 'suporte' : 'projetos_cards'),
  );

  const [cardsSprintFilter, setCardsSprintFilter] = useState<string>('');
  const [cardsTypeFilter, setCardsTypeFilter] = useState<string>('');
  const [leaderboardScope, setLeaderboardScope] = useState<'sprint' | 'year' | 'month' | 'interval' | 'users'>('year');
  const [leaderboardSprint, setLeaderboardSprint] = useState<string>('');
  const [leaderboardYear, setLeaderboardYear] = useState<number>(new Date().getFullYear());
  const [leaderboardMonth, setLeaderboardMonth] = useState<number>(new Date().getMonth() + 1);
  const [leaderboardMonthYear, setLeaderboardMonthYear] = useState<number>(new Date().getFullYear());
  const [leaderboardStartDate, setLeaderboardStartDate] = useState<string>(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return d.toISOString().slice(0, 10);
  });
  const [leaderboardEndDate, setLeaderboardEndDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [leaderboardSelectedUserIds, setLeaderboardSelectedUserIds] = useState<string[]>([]);
  const [leaderboardLimit, setLeaderboardLimit] = useState<'top5' | 'top3' | 'all'>('top5');
  const [heatmapTooltip, setHeatmapTooltip] = useState<{ sprintName: string; day: number; cards: CardType[]; x: number; y: number } | null>(null);
  const [heatmapEmAndamentoOpen, setHeatmapEmAndamentoOpen] = useState(true);
  const [heatmapConcluidasOpen, setHeatmapConcluidasOpen] = useState(false);
  const [leaderboardUsersDropdownOpen, setLeaderboardUsersDropdownOpen] = useState(false);
  const [leaderboardUsersSearchQuery, setLeaderboardUsersSearchQuery] = useState('');
  const leaderboardUsersDropdownRef = useRef<HTMLDivElement | null>(null);

  const [projectMetricsFilter, setProjectMetricsFilter] = useState<'year' | 'interval'>('year');
  const [projectMetricsYear, setProjectMetricsYear] = useState<number>(new Date().getFullYear());
  const [projectMetricsStartDate, setProjectMetricsStartDate] = useState<string>(() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 1);
    return d.toISOString().slice(0, 10);
  });
  const [projectMetricsEndDate, setProjectMetricsEndDate] = useState<string>(() =>
    new Date().toISOString().slice(0, 10)
  );

  const [onTimeFilterUserIds, setOnTimeFilterUserIds] = useState<string[] | null>(null);
  const [onTimeUsersDropdownOpen, setOnTimeUsersDropdownOpen] = useState(false);
  const [onTimeUsersSearchQuery, setOnTimeUsersSearchQuery] = useState('');
  const onTimeUsersDropdownRef = useRef<HTMLDivElement | null>(null);

  const navigate = useNavigate();
  const [onTimeListModalUserId, setOnTimeListModalUserId] = useState<string | null>(null);
  const [onTimeListTab, setOnTimeListTab] = useState<'onTime' | 'late'>('onTime');
  // Modal compartilhado entre os 3 gráficos de barras (Cards por Usuário,
  // Leaderboard, Cycle Time). Clique na barra → mostra a lista de cards do
  // usuário, já filtrada pelo escopo daquele gráfico, com tabs "No prazo" e
  // "Fora do prazo" iguais às do modal de Consistência.
  const [chartCardsModal, setChartCardsModal] = useState<{
    title: string;
    description: string;
    onTimeCards: CardType[];
    lateCards: CardType[];
  } | null>(null);
  const [chartCardsTab, setChartCardsTab] = useState<'onTime' | 'late'>('onTime');
  const [onTimeViewCardOpen, setOnTimeViewCardOpen] = useState(false);
  const [onTimeViewCardLoading, setOnTimeViewCardLoading] = useState(false);
  // Recebe o Card COMPLETO (FullCardType) vindo de cardService.getById ao
  // clicar num card específico no modal. O slim CardForMetrics não tem
  // descricao, links, complexidade etc. — necessários no editor.
  const [onTimeViewSelectedCard, setOnTimeViewSelectedCard] = useState<FullCardType | null>(null);
  const [onTimeViewCardForm, setOnTimeViewCardForm] = useState(() => ({ ...EMPTY_METRICS_CARD_FORM }));

  const [onTimeScope, setOnTimeScope] = useState<'sprint' | 'year' | 'month' | 'interval' | 'users'>('year');
  const [onTimeSprint, setOnTimeSprint] = useState<string>('');
  const [onTimeYear, setOnTimeYear] = useState<number>(new Date().getFullYear());
  const [onTimeMonth, setOnTimeMonth] = useState<number>(new Date().getMonth() + 1);
  const [onTimeMonthYear, setOnTimeMonthYear] = useState<number>(new Date().getFullYear());
  const [onTimeStartDate, setOnTimeStartDate] = useState<string>(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return d.toISOString().slice(0, 10);
  });
  const [onTimeEndDate, setOnTimeEndDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [onTimeScopeUserIds, setOnTimeScopeUserIds] = useState<string[]>([]);
  const [onTimeScopeUsersDropdownOpen, setOnTimeScopeUsersDropdownOpen] = useState(false);
  const [onTimeScopeUsersSearchQuery, setOnTimeScopeUsersSearchQuery] = useState('');
  const onTimeScopeUsersDropdownRef = useRef<HTMLDivElement | null>(null);
  const heatmapContainerRef = useRef<HTMLDivElement | null>(null);
  const [heatmapContainerWidth, setHeatmapContainerWidth] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const applyBundle = (bundle: MetricsBundle) => {
      if (cancelled) return;
      setCards(bundle.cards);
      setSprints(
        [...bundle.sprints].sort(
          (a, b) => new Date(b.data_inicio).getTime() - new Date(a.data_inicio).getTime(),
        ),
      );
      setUsers(bundle.users);
      setProjects(bundle.projects);
      if (bundle.sprints.length && !leaderboardSprint) setLeaderboardSprint(bundle.sprints[0].id);
      if (bundle.sprints.length && !onTimeSprint) setOnTimeSprint(bundle.sprints[0].id);
    };

    const fetchAll = async (): Promise<MetricsBundle> => {
      const [cardsRes, sprintsRes, usersRes, projectsRes] = await Promise.all([
        cardService.getForMetrics(),
        sprintService.getAll(),
        userService.getAll(),
        projectService.getAll(),
      ]);
      return { cards: cardsRes, sprints: sprintsRes, users: usersRes, projects: projectsRes };
    };

    // SWR: se há cache (mesmo stale), pinta a tela imediatamente. Se não há,
    // mantém spinner. Em paralelo, sempre revalida em background.
    const { cached, fresh, revalidate } = cachedFetch<MetricsBundle>(
      METRICS_CACHE_KEY,
      fetchAll,
      METRICS_CACHE_TTL_MS,
    );

    if (cached) {
      applyBundle(cached);
      setLoading(false);
    } else {
      setLoading(true);
    }

    if (!fresh && revalidate) {
      revalidate
        .then((bundle) => {
          if (cancelled) return;
          applyBundle(bundle);
        })
        .catch(() => {
          // Falha de rede: mantém o cache antigo se houver, senão libera spinner.
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }

    return () => {
      cancelled = true;
    };
  }, []);

  const projectToSprint = useMemo(() => {
    const map = new Map<string, Sprint>();
    for (const p of projects) {
      if (p.is_system || isSpecialProjectName(p.nome)) continue;
      const s = sprints.find((sp) => String(sp.id) === String(p.sprint));
      if (s) map.set(String(p.id), s);
    }
    return map;
  }, [projects, sprints]);

  const visibleProjectIds = useMemo(() => {
    return new Set(
      projects
        .filter((p) => !(p.is_system || isSpecialProjectName(p.nome)))
        .map((p) => String(p.id)),
    );
  }, [projects]);

  const getSprintForCard = (card: CardType): Sprint | null => {
    // CardForMetrics traz a sprint denormalizada via select_related.
    if (card.sprint != null && String(card.sprint).trim() !== '') {
      const match = sprints.find((s) => String(s.id) === String(card.sprint));
      if (match) return match;
    }
    return projectToSprint.get(String(card.projeto)) ?? null;
  };

  /** Cards que contam como "entregues" nas métricas:
   * - status='finalizado' (inviabilizado NUNCA conta)
   * - finalizado_em preenchido (data/hora real da entrega)
   * - data_fim preenchida (deadline necessária pra calcular atraso)
   * - projeto não-sistêmico (Suporte/Sugestões/Descartados)
   * - projeto não-arquivado (controlado via visibleProjectIds)
   */
  const closedCards = useMemo(() => {
    return cards.filter((c) => {
      if (c.status !== CLOSED_STATUS) return false;
      if (!c.finalizado_em) return false;
      if (!c.data_fim) return false;
      if (isSystemProject(c)) return false;
      return visibleProjectIds.has(String(c.projeto));
    });
  }, [cards, visibleProjectIds]);

  /** Em qual dia da sprint o card foi entregue de fato (usa finalizado_em). */
  const getDayOfSprint = (card: CardType): { sprint: Sprint; day: number } | null => {
    const sprint = getSprintForCard(card);
    const delivery = getCardDeliveryDate(card);
    if (!sprint || !delivery) return null;
    const start = new Date(sprint.data_inicio).setHours(0, 0, 0, 0);
    const end = new Date(delivery).setHours(0, 0, 0, 0);
    const day = Math.floor((end - start) / (24 * 60 * 60 * 1000)) + 1;
    if (day < 1 || day > sprint.duracao_dias) return null;
    return { sprint, day };
  };

  const cardsPerUserData = useMemo(() => {
    // Cards sem responsável NÃO entram nas métricas por pessoa (regra de
    // negócio definida com o usuário). Aparecem apenas em contadores totais.
    let list = closedCards.filter((c) => c.responsavel != null && c.responsavel !== '');
    if (cardsSprintFilter) {
      const want = String(cardsSprintFilter);
      list = list.filter((c) => resolveCardSprintId(c, projects) === want);
    }
    if (cardsTypeFilter) {
      list = list.filter((c) => c.tipo === cardsTypeFilter);
    }
    // Normalizar chaves para String() — User.id vem como bigint do backend.
    const byUser = new Map<string, number>();
    for (const c of list) {
      const uid = String(c.responsavel!);
      byUser.set(uid, (byUser.get(uid) ?? 0) + 1);
    }
    const entriesFromCards = Array.from(byUser.entries()).map(([userId, count]) => {
      const user = users.find((u) => String(u.id) === userId) ?? { id: userId, username: userId, email: '', first_name: '', last_name: '', role: '', role_display: '', profile_picture_url: null as string | null };
      return {
        userId,
        name: getShortDisplayName(user as User),
        role: user.role ?? '',
        profile_picture_url: user.profile_picture_url ?? null,
        count,
      };
    });
    const userIdsFromCards = new Set(entriesFromCards.map((e) => e.userId));
    const allUsersWithZero = users
      .filter((u) => !userIdsFromCards.has(String(u.id)))
      .map((u) => ({
        userId: String(u.id),
        name: getShortDisplayName(u),
        role: u.role ?? '',
        profile_picture_url: u.profile_picture_url ?? null,
        count: 0,
      }));
    return [...entriesFromCards, ...allUsersWithZero].sort((a, b) => b.count - a.count);
  }, [closedCards, cardsSprintFilter, cardsTypeFilter, users, projects]);

  const heatmapData = useMemo(() => {
    const bySprintDay = new Map<string, Map<number, CardType[]>>();
    for (const card of closedCards) {
      const info = getDayOfSprint(card);
      if (!info) continue;
      const key = info.sprint.id;
      if (!bySprintDay.has(key)) bySprintDay.set(key, new Map());
      const dayMap = bySprintDay.get(key)!;
      const list = dayMap.get(info.day) ?? [];
      list.push(card);
      dayMap.set(info.day, list);
    }
    const maxDays = Math.max(...sprints.map((s) => s.duracao_dias), 1);
    const emAndamento = sprints.filter((s) => !s.finalizada);
    const concluidas = sprints.filter((s) => s.finalizada);
    return { bySprintDay, maxDays, emAndamento, concluidas };
  }, [closedCards, sprints]);

  useEffect(() => {
    const el = heatmapContainerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      setHeatmapContainerWidth(width);
    });
    observer.observe(el);
    setHeatmapContainerWidth(el.getBoundingClientRect().width);
    return () => observer.disconnect();
  }, [sprints.length]);

  useEffect(() => {
    if (!leaderboardUsersDropdownOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (leaderboardUsersDropdownRef.current && !leaderboardUsersDropdownRef.current.contains(event.target as Node)) {
        setLeaderboardUsersDropdownOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [leaderboardUsersDropdownOpen]);

  useEffect(() => {
    if (!onTimeUsersDropdownOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (onTimeUsersDropdownRef.current && !onTimeUsersDropdownRef.current.contains(event.target as Node)) {
        setOnTimeUsersDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onTimeUsersDropdownOpen]);

  useEffect(() => {
    if (!onTimeScopeUsersDropdownOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (onTimeScopeUsersDropdownRef.current && !onTimeScopeUsersDropdownRef.current.contains(event.target as Node)) {
        setOnTimeScopeUsersDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onTimeScopeUsersDropdownOpen]);

  const filteredOnTimeScopeUsers = useMemo(() => {
    const query = onTimeScopeUsersSearchQuery.trim().toLowerCase();
    if (!query) return users;
    return users.filter((u) => {
      const fullName = `${u.first_name ?? ''} ${u.last_name ?? ''}`.toLowerCase();
      const username = u.username.toLowerCase();
      const role = (u.role_display || u.role || '').toLowerCase();
      return fullName.includes(query) || username.includes(query) || role.includes(query);
    });
  }, [users, onTimeScopeUsersSearchQuery]);

  const handleToggleOnTimeScopeUser = (userId: string, checked: boolean) => {
    setOnTimeScopeUserIds((prev) => {
      if (checked) {
        if (prev.includes(userId)) return prev;
        return [...prev, userId];
      }
      return prev.filter((id) => id !== userId);
    });
  };

  const handleOnTimeScopeSelectAll = () => {
    setOnTimeScopeUserIds(users.map((u) => String(u.id)));
  };

  const handleOnTimeScopeClear = () => {
    setOnTimeScopeUserIds([]);
  };

  const filteredLeaderboardUsers = useMemo(() => {
    const query = leaderboardUsersSearchQuery.trim().toLowerCase();
    if (!query) return users;

    return users.filter((user) => {
      const fullName = `${user.first_name ?? ''} ${user.last_name ?? ''}`.toLowerCase();
      const username = user.username.toLowerCase();
      const role = (user.role_display || user.role || '').toLowerCase();
      return (
        fullName.includes(query) ||
        username.includes(query) ||
        role.includes(query)
      );
    });
  }, [users, leaderboardUsersSearchQuery]);

  const handleToggleLeaderboardUser = (userId: string, checked: boolean) => {
    setLeaderboardSelectedUserIds((prev) => {
      if (checked) {
        if (prev.includes(userId)) return prev;
        return [...prev, userId];
      }
      return prev.filter((id) => id !== userId);
    });
  };

  const handleSelectAllLeaderboardUsers = () => {
    setLeaderboardSelectedUserIds(users.map((u) => u.id));
  };

  const handleClearLeaderboardUsers = () => {
    setLeaderboardSelectedUserIds([]);
  };

  const handleToggleOnTimeUser = (userId: string, checked: boolean) => {
    setOnTimeFilterUserIds((prev) => {
      if (checked) {
        if (prev == null) return null;
        if (prev.includes(userId)) return prev;
        return [...prev, userId];
      }
      if (prev == null) {
        return onTimeTableUserList.map((r) => r.userId).filter((id) => id !== userId);
      }
      const next = prev.filter((id) => id !== userId);
      return next.length === 0 ? null : next;
    });
  };

  const handleOnTimeSelectAll = () => {
    setOnTimeFilterUserIds(null);
  };

  const handleOnTimeClear = () => {
    setOnTimeFilterUserIds(null);
  };

  const leaderboardData = useMemo(() => {
    // Cards sem responsável são ignorados no leaderboard.
    let list = closedCards.filter((c) => c.responsavel != null && c.responsavel !== '');
    // Filtros temporais usam SEMPRE a data real de entrega (finalizado_em),
    // não a data agendada (data_fim). Um card entregue em janeiro com prazo
    // dezembro precisa aparecer em janeiro.
    if (leaderboardScope === 'sprint' && leaderboardSprint) {
      const want = String(leaderboardSprint);
      list = list.filter((c) => resolveCardSprintId(c, projects) === want);
    } else if (leaderboardScope === 'year') {
      list = list.filter((c) => {
        const d = getCardDeliveryDate(c);
        return d != null && d.getFullYear() === leaderboardYear;
      });
    } else if (leaderboardScope === 'month') {
      list = list.filter((c) => {
        const d = getCardDeliveryDate(c);
        return (
          d != null &&
          d.getFullYear() === leaderboardMonthYear &&
          d.getMonth() + 1 === leaderboardMonth
        );
      });
    } else if (leaderboardScope === 'interval' && leaderboardStartDate && leaderboardEndDate) {
      const start = new Date(leaderboardStartDate).setHours(0, 0, 0, 0);
      const end = new Date(leaderboardEndDate).setHours(23, 59, 59, 999);
      list = list.filter((c) => {
        const d = getCardDeliveryDate(c);
        if (!d) return false;
        const t = d.getTime();
        return t >= start && t <= end;
      });
    }
    // IMPORTANTE: o backend devolve User.id como bigint (number), mas o type
    // TS declara string. Para evitar mismatches em `find`/`get`, normalizamos
    // tudo para String() nas chaves e comparações.
    const byUser = new Map<string, number>();
    for (const c of list) {
      const uid = String(c.responsavel!);
      byUser.set(uid, (byUser.get(uid) ?? 0) + 1);
    }
    const isUsersScope = leaderboardScope === 'users';
    const limit = !isUsersScope
      ? leaderboardLimit === 'top5'
        ? 5
        : leaderboardLimit === 'top3'
          ? 3
          : undefined
      : undefined;
    const isAll = leaderboardLimit === 'all';
    const scopeUsers =
      leaderboardScope === 'users' && leaderboardSelectedUserIds.length > 0
        ? leaderboardSelectedUserIds
        : null;
    if (leaderboardScope === 'users' && leaderboardSelectedUserIds.length === 0) {
      return [];
    }
    let result: { userId: string; name: string; count: number; role: string; profile_picture_url: string | null }[];
    if (scopeUsers) {
      result = scopeUsers.map((userId) => {
        const uid = String(userId);
        const user = users.find((u) => String(u.id) === uid);
        return {
          userId: uid,
          name: user ? getShortDisplayName(user) : uid,
          count: byUser.get(uid) ?? 0,
          role: user?.role ?? '',
          profile_picture_url: user?.profile_picture_url ?? null,
        };
      });
    } else if (isAll) {
      result = users.map((user) => ({
        userId: String(user.id),
        name: getShortDisplayName(user),
        count: byUser.get(String(user.id)) ?? 0,
        role: user.role ?? '',
        profile_picture_url: user.profile_picture_url ?? null,
      }));
    } else {
      result = Array.from(byUser.entries()).map(([userId, count]) => {
        const user = users.find((u) => String(u.id) === userId);
        return {
          userId,
          name: user ? getShortDisplayName(user) : userId,
          count,
          role: user?.role ?? '',
          profile_picture_url: user?.profile_picture_url ?? null,
        };
      });
    }
    result.sort((a, b) => b.count - a.count);
    return limit != null ? result.slice(0, limit) : result;
  }, [
    closedCards,
    leaderboardScope,
    leaderboardSprint,
    leaderboardYear,
    leaderboardMonth,
    leaderboardMonthYear,
    leaderboardStartDate,
    leaderboardEndDate,
    leaderboardSelectedUserIds,
    leaderboardLimit,
    users,
    projects,
  ]);

  const closedCardsForOnTime = useMemo(() => {
    let list = closedCards.filter((c) => c.responsavel != null && c.responsavel !== '');
    if (onTimeScope === 'sprint' && onTimeSprint) {
      const sprintId = String(onTimeSprint);
      list = list.filter((c) => resolveCardSprintId(c, projects) === sprintId);
    } else if (onTimeScope === 'year') {
      list = list.filter((c) => {
        const d = getCardDeliveryDate(c);
        return d != null && d.getFullYear() === onTimeYear;
      });
    } else if (onTimeScope === 'month') {
      list = list.filter((c) => {
        const d = getCardDeliveryDate(c);
        return (
          d != null &&
          d.getFullYear() === onTimeMonthYear &&
          d.getMonth() + 1 === onTimeMonth
        );
      });
    } else if (onTimeScope === 'interval' && onTimeStartDate && onTimeEndDate) {
      const start = new Date(onTimeStartDate).setHours(0, 0, 0, 0);
      const end = new Date(onTimeEndDate).setHours(23, 59, 59, 999);
      list = list.filter((c) => {
        const d = getCardDeliveryDate(c);
        if (!d) return false;
        const t = d.getTime();
        return t >= start && t <= end;
      });
    } else if (onTimeScope === 'users' && onTimeScopeUserIds.length > 0) {
      const idSet = new Set(onTimeScopeUserIds.map((id) => String(id)));
      list = list.filter((c) => c.responsavel && idSet.has(String(c.responsavel)));
    } else if (onTimeScope === 'users') {
      list = [];
    }
    return list;
  }, [
    closedCards,
    onTimeScope,
    onTimeSprint,
    onTimeYear,
    onTimeMonth,
    onTimeMonthYear,
    onTimeStartDate,
    onTimeEndDate,
    onTimeScopeUserIds,
    projects,
  ]);

  const onTimeTable = useMemo(() => {
    const byUser = new Map<
      string,
      { total: number; onTime: number; onTimeCards: CardType[]; lateCards: CardType[] }
    >();
    for (const card of closedCardsForOnTime) {
      // Precisa de sprint (escopo), data_fim (deadline), responsavel e
      // finalizado_em (data real de entrega). closedCards já filtra os
      // três últimos — esta checagem é defesa adicional.
      if (!getSprintForCard(card) || !card.data_fim || !card.responsavel || !card.finalizado_em) continue;
      const uid = String(card.responsavel);
      const scheduledEnd = new Date(card.data_fim).getTime();
      const completedAt = new Date(card.finalizado_em).getTime();
      // No prazo se a data real de conclusão NÃO passou do prazo agendado.
      const isOnTime = completedAt <= scheduledEnd;
      const cur = byUser.get(uid) ?? { total: 0, onTime: 0, onTimeCards: [], lateCards: [] };
      cur.total += 1;
      if (isOnTime) {
        cur.onTime += 1;
        cur.onTimeCards.push(card);
      } else {
        cur.lateCards.push(card);
      }
      byUser.set(uid, cur);
    }
    const isUsersScopeWithSelection = onTimeScope === 'users' && onTimeScopeUserIds.length > 0;
    const userIdsToShow = isUsersScopeWithSelection
      ? onTimeScopeUserIds
      : Array.from(byUser.keys());
    const rows = userIdsToShow.map((userId) => {
      const uid = String(userId);
      const stats = byUser.get(uid) ?? {
        total: 0,
        onTime: 0,
        onTimeCards: [] as CardType[],
        lateCards: [] as CardType[],
      };
      const { total, onTime, onTimeCards, lateCards } = stats;
      const late = total - onTime;
      const user = users.find((u) => String(u.id) === uid) ?? { id: uid, username: uid, email: '', first_name: '', last_name: '', role: '', role_display: '', profile_picture_url: null };
      return {
        userId,
        name: getShortDisplayName(user),
        user,
        total,
        onTime,
        late,
        onTimeCards,
        lateCards,
        pct: total ? Math.round((onTime / total) * 100) : 0,
      };
    });
    if (!isUsersScopeWithSelection) {
      return rows.filter((r) => r.total > 0).sort((a, b) => b.pct - a.pct);
    }
    return rows.sort((a, b) => {
      // Usuários com entregas primeiro; sem entregas (total === 0) abaixo
      if (a.total === 0 && b.total > 0) return 1;
      if (a.total > 0 && b.total === 0) return -1;
      if (a.total === 0 && b.total === 0) return (a.name || '').localeCompare(b.name || '');
      if (b.pct !== a.pct) return b.pct - a.pct;
      return (a.name || '').localeCompare(b.name || '');
    });
  }, [closedCardsForOnTime, users, onTimeScope, onTimeScopeUserIds]);

  const onTimeTableFiltered = useMemo(() => {
    if (onTimeFilterUserIds == null || onTimeFilterUserIds.length === 0) return onTimeTable;
    return onTimeTable.filter((row) => onTimeFilterUserIds.includes(row.userId));
  }, [onTimeTable, onTimeFilterUserIds]);

  const onTimeListModalRow = useMemo(() => {
    if (!onTimeListModalUserId) return null;
    return onTimeTable.find((r) => String(r.userId) === String(onTimeListModalUserId)) ?? null;
  }, [onTimeTable, onTimeListModalUserId]);

  const onTimeScopeDescription = useMemo(() => {
    switch (onTimeScope) {
      case 'sprint': {
        const sp = sprints.find((s) => String(s.id) === String(onTimeSprint));
        return sp ? `Sprint: ${sp.nome}` : 'Por sprint';
      }
      case 'year':
        return `Ano ${onTimeYear}`;
      case 'month':
        return `${MONTH_NAMES[onTimeMonth - 1] ?? 'Mês'} de ${onTimeMonthYear}`;
      case 'interval':
        return onTimeStartDate && onTimeEndDate
          ? `De ${onTimeStartDate} até ${onTimeEndDate}`
          : 'Por intervalo';
      case 'users':
        return onTimeScopeUserIds.length > 0
          ? `Escopo: ${onTimeScopeUserIds.length} usuário(s) selecionado(s)`
          : 'Por usuários';
      default:
        return '';
    }
  }, [
    onTimeScope,
    onTimeSprint,
    onTimeYear,
    onTimeMonth,
    onTimeMonthYear,
    onTimeStartDate,
    onTimeEndDate,
    onTimeScopeUserIds,
    sprints,
  ]);

  const openConsistencyCardFromMetrics = useCallback(async (cardId: string) => {
    setOnTimeListModalUserId(null);
    try {
      setOnTimeViewCardLoading(true);
      const card = await cardService.getById(cardId);
      setOnTimeViewSelectedCard(card);
      setOnTimeViewCardForm({
        nome: card.nome || '',
        descricao: card.descricao || '',
        script_url: card.script_url || '',
        area: card.area || 'backend',
        tipo: card.tipo || 'feature',
        prioridade: card.prioridade || 'media',
        status: card.status || 'a_desenvolver',
        responsavel: card.responsavel || '',
        data_inicio: card.data_inicio || '',
        data_fim: card.data_fim || '',
      });
      setOnTimeViewCardOpen(true);
    } catch (e) {
      console.error(e);
    } finally {
      setOnTimeViewCardLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!onTimeListModalRow) return;
    setOnTimeListTab(onTimeListModalRow.onTimeCards.length > 0 ? 'onTime' : 'late');
  }, [onTimeListModalUserId, onTimeListModalRow]);

  /** Abre o modal compartilhado dos gráficos com a lista de cards do usuário.
   * Separa em onTimeCards/lateCards baseado em finalizado_em <= data_fim. */
  const openChartCardsModal = useCallback(
    (title: string, description: string, cards: CardType[]) => {
      const onTimeCards: CardType[] = [];
      const lateCards: CardType[] = [];
      for (const card of cards) {
        if (!card.data_fim || !card.finalizado_em) {
          // Sem deadline ou sem data de conclusão real: trata como "no prazo"
          // por convenção (não temos dados pra dizer o contrário).
          onTimeCards.push(card);
          continue;
        }
        const scheduledEnd = new Date(card.data_fim).getTime();
        const completedAt = new Date(card.finalizado_em).getTime();
        if (completedAt <= scheduledEnd) onTimeCards.push(card);
        else lateCards.push(card);
      }
      setChartCardsModal({ title, description, onTimeCards, lateCards });
      // Aba inicial: prefere "No prazo" se houver, senão cai pra "Fora do prazo".
      setChartCardsTab(onTimeCards.length > 0 ? 'onTime' : 'late');
    },
    [],
  );

  /** Click numa barra do "Cards por Usuário" → mostra cards desse usuário
   * já filtrados por sprint/tipo (filtros do próprio gráfico). */
  const handleCardsPerUserBarClick = useCallback(
    (entry: { userId: string; name: string }) => {
      if (!entry?.userId) return;
      const uid = String(entry.userId);
      let list = closedCards.filter((c) => String(c.responsavel ?? '') === uid);
      const descParts: string[] = [];
      if (cardsSprintFilter) {
        const want = String(cardsSprintFilter);
        list = list.filter((c) => resolveCardSprintId(c, projects) === want);
        const sp = sprints.find((s) => String(s.id) === want);
        if (sp) descParts.push(`Sprint: ${sp.nome}`);
      }
      if (cardsTypeFilter) {
        list = list.filter((c) => c.tipo === cardsTypeFilter);
        const meta = CARD_TYPES.find((t) => t.value === cardsTypeFilter);
        descParts.push(`Tipo: ${meta?.label ?? cardsTypeFilter}`);
      }
      const description = `${entry.name}${descParts.length ? ' · ' + descParts.join(' · ') : ''}`;
      openChartCardsModal('Cards entregues', description, list);
    },
    [closedCards, cardsSprintFilter, cardsTypeFilter, projects, sprints, openChartCardsModal],
  );

  /** Click numa barra do Leaderboard → cards do usuário no escopo atual
   * (sprint/year/month/interval/users). */
  const handleLeaderboardBarClick = useCallback(
    (entry: { userId: string; name: string }) => {
      if (!entry?.userId) return;
      const uid = String(entry.userId);
      let list = closedCards.filter((c) => String(c.responsavel ?? '') === uid);
      let scopeLabel = '';
      if (leaderboardScope === 'sprint' && leaderboardSprint) {
        const want = String(leaderboardSprint);
        list = list.filter((c) => resolveCardSprintId(c, projects) === want);
        const sp = sprints.find((s) => String(s.id) === want);
        scopeLabel = `Sprint: ${sp?.nome ?? want}`;
      } else if (leaderboardScope === 'year') {
        list = list.filter((c) => {
          const d = getCardDeliveryDate(c);
          return d != null && d.getFullYear() === leaderboardYear;
        });
        scopeLabel = `Ano: ${leaderboardYear}`;
      } else if (leaderboardScope === 'month') {
        list = list.filter((c) => {
          const d = getCardDeliveryDate(c);
          return (
            d != null &&
            d.getFullYear() === leaderboardMonthYear &&
            d.getMonth() + 1 === leaderboardMonth
          );
        });
        scopeLabel = `${MONTH_NAMES[leaderboardMonth - 1]}/${leaderboardMonthYear}`;
      } else if (leaderboardScope === 'interval' && leaderboardStartDate && leaderboardEndDate) {
        const start = new Date(leaderboardStartDate).setHours(0, 0, 0, 0);
        const end = new Date(leaderboardEndDate).setHours(23, 59, 59, 999);
        list = list.filter((c) => {
          const d = getCardDeliveryDate(c);
          if (!d) return false;
          const t = d.getTime();
          return t >= start && t <= end;
        });
        scopeLabel = `${leaderboardStartDate} → ${leaderboardEndDate}`;
      } else if (leaderboardScope === 'users') {
        scopeLabel = 'Todo o histórico';
      }
      const description = `${entry.name}${scopeLabel ? ' · ' + scopeLabel : ''}`;
      openChartCardsModal('Cards entregues', description, list);
    },
    [
      closedCards,
      leaderboardScope,
      leaderboardSprint,
      leaderboardYear,
      leaderboardMonth,
      leaderboardMonthYear,
      leaderboardStartDate,
      leaderboardEndDate,
      projects,
      sprints,
      openChartCardsModal,
    ],
  );

  /** Click numa linha da tabela de Cycle Time → cards considerados no cálculo
   * (têm data_inicio E finalizado_em). */
  const handleCycleTimeRowClick = useCallback(
    (userId: string, userName: string) => {
      const uid = String(userId);
      const list = closedCards.filter(
        (c) =>
          String(c.responsavel ?? '') === uid &&
          c.data_inicio != null &&
          c.finalizado_em != null,
      );
      openChartCardsModal('Cards considerados no Cycle Time', userName, list);
    },
    [closedCards, openChartCardsModal],
  );

  const onTimeTableUserList = useMemo(() => {
    const seen = new Set<string>();
    return onTimeTable.filter((r) => {
      if (seen.has(r.userId)) return false;
      seen.add(r.userId);
      return true;
    });
  }, [onTimeTable]);

  const filteredOnTimeUsersForDropdown = useMemo(() => {
    const query = onTimeUsersSearchQuery.trim().toLowerCase();
    if (!query) return onTimeTableUserList;
    return onTimeTableUserList.filter((r) => r.name.toLowerCase().includes(query));
  }, [onTimeTableUserList, onTimeUsersSearchQuery]);

  const projectStats = useMemo(() => {
    if (!projects.length) return null;

    const msPerDay = 24 * 60 * 60 * 1000;
    const toTime = (value?: string | null): number | null =>
      value ? new Date(value).getTime() : null;

    const periodStart =
      projectMetricsFilter === 'year'
        ? new Date(projectMetricsYear, 0, 1).setHours(0, 0, 0, 0)
        : new Date(projectMetricsStartDate).setHours(0, 0, 0, 0);
    const periodEnd =
      projectMetricsFilter === 'year'
        ? new Date(projectMetricsYear, 11, 31).setHours(23, 59, 59, 999)
        : new Date(projectMetricsEndDate).setHours(23, 59, 59, 999);

    const cardInPeriod = (card: CardType): boolean => {
      // Para cards finalizados, comparamos com a data real de entrega
      // (finalizado_em). Para cards em andamento, usamos data_fim ou
      // data_inicio para verificar se o card "existe" no período.
      const t =
        toTime(card.finalizado_em) ??
        toTime(card.data_fim) ??
        toTime(card.data_inicio) ??
        toTime((card as CardType & { created_at?: string }).created_at);
      return t != null && t >= periodStart && t <= periodEnd;
    };

    const sprintOverlapsPeriod = (sprint: Sprint): boolean => {
      const start = toTime(sprint.data_inicio) ?? 0;
      const end = toTime(sprint.fechamento_em) ?? 0;
      return end >= periodStart && start <= periodEnd;
    };

    const projectOverlapsPeriod = (
      startTime: number | null,
      endTime: number | null
    ): boolean => {
      if (startTime == null || endTime == null) return false;
      return endTime >= periodStart && startTime <= periodEnd;
    };

    /**
     * "Projeto mais longo" = projeto identificado pelo NOME normalizado.
     * Projetos são replicados entre sprints (finalizar_sprint_replicacao),
     * então um mesmo projeto vira N rows distintos no banco. Para medir
     * "duração de vida" temos que AGREGAR por nome.
     *
     * - `firstSeen` = MIN(created_at) entre todas as instâncias
     * - `lastSeen` = MAX(updated_at) entre todas as instâncias
     * - `isActive` = alguma instância está em sprint NÃO finalizada
     * - duração:
     *   - se ATIVO: hoje - firstSeen (continua rodando)
     *   - se inativo: lastSeen - firstSeen (já encerrou)
     *
     * O período selecionado pelo usuário (ano/intervalo) filtra os projetos
     * por OVERLAP: incluímos qualquer projeto cujo intervalo [firstSeen,
     * lastSeenOrToday] cruza com o período. Assim filtros de "ano X" ainda
     * mostram projetos que começaram antes mas ainda estão vivos no ano X.
     */
    let longest:
      | {
          name: string;
          durationDays: number;
          start: string;
          end: string;
          sprintCount: number;
          isActive: boolean;
        }
      | null = null;

    const today = Date.now();
    const finalizedSprintIds = new Set(
      sprints.filter((s) => !!s.finalizada).map((s) => String(s.id)),
    );
    type ProjectGroup = {
      name: string;
      firstSeen: number;
      lastSeen: number;
      sprintIds: Set<string>;
      isActive: boolean;
    };
    const projectGroups = new Map<string, ProjectGroup>();
    for (const project of projects) {
      if (project.is_system || isSpecialProjectName(project.nome)) continue;
      const created = toTime(project.created_at);
      const updated = toTime(project.updated_at) ?? created;
      if (created == null) continue;
      const key = normalizeProjectName(project.nome) || String(project.id);
      const sprintId = project.sprint != null ? String(project.sprint) : '';
      const inActiveSprint = !!sprintId && !finalizedSprintIds.has(sprintId);
      const cur = projectGroups.get(key);
      if (!cur) {
        projectGroups.set(key, {
          name: project.nome,
          firstSeen: created,
          lastSeen: updated ?? created,
          sprintIds: sprintId ? new Set([sprintId]) : new Set(),
          isActive: inActiveSprint,
        });
      } else {
        cur.firstSeen = Math.min(cur.firstSeen, created);
        cur.lastSeen = Math.max(cur.lastSeen, updated ?? created);
        if (sprintId) cur.sprintIds.add(sprintId);
        if (inActiveSprint) cur.isActive = true;
      }
    }

    for (const group of projectGroups.values()) {
      const end = group.isActive ? today : group.lastSeen;
      // Overlap com o período filtrado: aceitamos qualquer projeto cujo
      // intervalo de existência cruza com [periodStart, periodEnd].
      if (end < periodStart || group.firstSeen > periodEnd) continue;
      const durationDays = Math.max(
        1,
        Math.round((end - group.firstSeen) / msPerDay),
      );
      if (!longest || durationDays > longest.durationDays) {
        longest = {
          name: group.name,
          durationDays,
          start: new Date(group.firstSeen).toISOString().slice(0, 10),
          end: new Date(end).toISOString().slice(0, 10),
          sprintCount: group.sprintIds.size,
          isActive: group.isActive,
        };
      }
    }

    const cardCounts = new Map<
      string,
      { total: number; delivered: number; inviabilizados: number }
    >();

    for (const card of cards) {
      // Excluir cards de projetos sistêmicos das métricas de projeto.
      if (isSystemProject(card)) continue;
      if (!cardInPeriod(card)) continue;
      const pid = card.projeto;
      const stats =
        cardCounts.get(pid) ?? {
          total: 0,
          delivered: 0,
          inviabilizados: 0,
        };
      stats.total += 1;
      // Entregue = finalizado COM finalizado_em preenchido.
      // Inviabilizado NUNCA conta como entregue (regra de negócio).
      if (card.status === CLOSED_STATUS && card.finalizado_em) stats.delivered += 1;
      if (card.status === 'inviabilizado') stats.inviabilizados += 1;
      cardCounts.set(pid, stats);
    }

    const sprintIdsInPeriod = new Set(
      sprints.filter(sprintOverlapsPeriod).map((s) => s.id)
    );

    let mostCards:
      | {
          project: Project;
          stats: { total: number; delivered: number; inviabilizados: number };
        }
      | null = null;

    for (const project of projects) {
      // Excluir projetos sistêmicos das métricas (regra de negócio).
      if (project.is_system || isSpecialProjectName(project.nome)) continue;

      const stats = cardCounts.get(project.id);
      if (stats) {
        if (!mostCards || stats.total > mostCards.stats.total) {
          mostCards = { project, stats };
        }
      }
    }

    const byName = new Map<string, { name: string; sprintIds: Set<string> }>();
    for (const project of projects) {
      // Excluir sistêmicos do cálculo de recorrência.
      if (project.is_system || isSpecialProjectName(project.nome)) continue;
      if (!project.sprint || !sprintIdsInPeriod.has(project.sprint)) continue;
      const key = (project.nome || '').trim().toLowerCase() || project.id;
      const entry =
        byName.get(key) ?? { name: project.nome, sprintIds: new Set<string>() };
      entry.sprintIds.add(project.sprint);
      byName.set(key, entry);
    }

    let recurrent:
      | {
          name: string;
          sprintCount: number;
        }
      | null = null;

    for (const entry of byName.values()) {
      const count = entry.sprintIds.size;
      if (!recurrent || count > recurrent.sprintCount) {
        recurrent = {
          name: entry.name,
          sprintCount: count,
        };
      }
    }

    if (!longest && !mostCards && !recurrent) return null;

    return {
      longest,
      mostCards,
      recurrent,
    };
  }, [
    projects,
    cards,
    sprints,
    projectMetricsFilter,
    projectMetricsYear,
    projectMetricsStartDate,
    projectMetricsEndDate,
  ]);

  /** Cycle time médio = média de (finalizado_em - data_inicio) em dias.
   * Geral, por usuário e por área. Considera apenas cards com ambas datas. */
  const cycleTimeData = useMemo(() => {
    const msPerDay = 24 * 60 * 60 * 1000;
    type Bucket = { sumDays: number; count: number };
    const overall: Bucket = { sumDays: 0, count: 0 };
    const byUser = new Map<string, Bucket>();
    const byArea = new Map<string, Bucket>();

    for (const card of closedCards) {
      if (!card.data_inicio || !card.finalizado_em) continue;
      const start = new Date(card.data_inicio).getTime();
      const end = new Date(card.finalizado_em).getTime();
      if (Number.isNaN(start) || Number.isNaN(end) || end < start) continue;
      const days = (end - start) / msPerDay;
      overall.sumDays += days;
      overall.count += 1;
      if (card.responsavel) {
        const uid = String(card.responsavel);
        const cur = byUser.get(uid) ?? { sumDays: 0, count: 0 };
        cur.sumDays += days;
        cur.count += 1;
        byUser.set(uid, cur);
      }
      const area = card.area || 'desconhecida';
      const curA = byArea.get(area) ?? { sumDays: 0, count: 0 };
      curA.sumDays += days;
      curA.count += 1;
      byArea.set(area, curA);
    }

    const fmt = (b: Bucket): number =>
      b.count > 0 ? Math.round((b.sumDays / b.count) * 10) / 10 : 0;

    const perUser = Array.from(byUser.entries())
      .map(([userId, b]) => {
        const user = users.find((u) => String(u.id) === userId);
        return {
          userId,
          name: user ? getShortDisplayName(user) : userId,
          role: user?.role ?? '',
          profile_picture_url: user?.profile_picture_url ?? null,
          avgDays: fmt(b),
          count: b.count,
        };
      })
      .sort((a, b) => a.avgDays - b.avgDays); // mais rápido primeiro

    const perArea = Array.from(byArea.entries())
      .map(([area, b]) => {
        const meta = CARD_AREAS.find((a) => a.value === area);
        return {
          area,
          label: meta?.label ?? area,
          avgDays: fmt(b),
          count: b.count,
        };
      })
      .sort((a, b) => a.avgDays - b.avgDays);

    return {
      overall: fmt(overall),
      overallCount: overall.count,
      perUser,
      perArea,
    };
  }, [closedCards, users]);

  /** Throughput = cards finalizados / duração da sprint. Por sprint, todas. */
  const throughputData = useMemo(() => {
    const cardsBySprint = new Map<string, number>();
    for (const card of closedCards) {
      const sprint = getSprintForCard(card);
      if (!sprint) continue;
      cardsBySprint.set(sprint.id, (cardsBySprint.get(sprint.id) ?? 0) + 1);
    }
    return sprints
      .map((s) => {
        const delivered = cardsBySprint.get(s.id) ?? 0;
        const days = Math.max(1, s.duracao_dias || 1);
        return {
          sprintId: s.id,
          name: s.nome,
          delivered,
          days,
          throughput: Math.round((delivered / days) * 100) / 100,
          finalizada: !!s.finalizada,
        };
      })
      // Ordena por data de início (mais recente primeiro).
      .sort((a, b) => {
        const sa = sprints.find((s) => s.id === a.sprintId);
        const sb = sprints.find((s) => s.id === b.sprintId);
        const ta = sa ? new Date(sa.data_inicio).getTime() : 0;
        const tb = sb ? new Date(sb.data_inicio).getTime() : 0;
        return tb - ta;
      });
  }, [closedCards, sprints]);

  /** Volume por área = quantidade de cards finalizados por categoria técnica. */
  const volumeByAreaData = useMemo(() => {
    const counts = new Map<string, number>();
    for (const card of closedCards) {
      const area = card.area || 'desconhecida';
      counts.set(area, (counts.get(area) ?? 0) + 1);
    }
    const total = Array.from(counts.values()).reduce((a, b) => a + b, 0);
    return Array.from(counts.entries())
      .map(([area, count]) => {
        const meta = CARD_AREAS.find((a) => a.value === area);
        return {
          area,
          label: meta?.label ?? area,
          count,
          pct: total > 0 ? Math.round((count / total) * 1000) / 10 : 0,
        };
      })
      .sort((a, b) => b.count - a.count);
  }, [closedCards]);

  const years = useMemo(() => {
    const set = new Set<number>();
    set.add(new Date().getFullYear());
    for (const c of closedCards) {
      if (c.data_fim) set.add(new Date(c.data_fim).getFullYear());
    }
    return Array.from(set).sort((a, b) => b - a);
  }, [closedCards]);

  const projectYears = useMemo(() => {
    const set = new Set<number>();
    set.add(new Date().getFullYear());
    const addFrom = (value?: string | null) => {
      if (value) set.add(new Date(value).getFullYear());
    };
    for (const p of projects) {
      addFrom(p.data_inicio_desenvolvimento);
      addFrom(p.data_criacao);
      addFrom(p.data_entrega);
      addFrom(p.data_homologacao);
      addFrom(p.nova_data_prevista);
      addFrom(p.created_at);
      addFrom(p.updated_at);
    }
    for (const c of cards) {
      addFrom(c.data_fim);
      addFrom(c.data_inicio);
      addFrom((c as CardType & { created_at?: string }).created_at);
    }
    return Array.from(set).sort((a, b) => b - a);
  }, [projects, cards]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--color-primary)]" />
      </div>
    );
  }

  return (
    <div className="space-y-[24px]">
      <div>
        <h1 className="text-2xl font-semibold text-[var(--color-foreground)] flex items-center gap-2">
          <BarChart3 className="h-7 w-7" />
          Métricas
        </h1>
        <p className="text-sm text-[var(--color-muted-foreground)] mt-1">
          {activeMetricsTab === 'suporte'
            ? 'Tickets de suporte: rankings e abertura por período'
            : 'Cards fechados, entrega por sprint e consistência de prazo'}
        </p>
      </div>

      {/* Tabs internas: Projetos e Cards / Suporte (mesmo visual das tabs de Suporte) */}
      <div className="flex items-center gap-[8px] border-b border-[var(--color-border)]">
        {([
          { key: 'projetos_cards', label: 'Projetos e Cards' },
          { key: 'suporte', label: 'Suporte' },
        ] as const).map((t) => (
          <Button
            key={t.key}
            variant="ghost"
            onClick={() => setActiveMetricsTab(t.key)}
            className={cn(
              'rounded-none border-b-2 border-transparent px-[16px] py-[8px] h-auto',
              activeMetricsTab === t.key
                ? 'border-[var(--color-primary)] text-[var(--color-primary)] font-semibold'
                : 'text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]',
            )}
          >
            {t.label}
          </Button>
        ))}
      </div>

      {activeMetricsTab === 'suporte' ? (
        <MetricasSuporte />
      ) : (
      <>
      {/* Cards de totais */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-[var(--color-muted-foreground)]">
              Cards finalizados (total)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{closedCards.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-[var(--color-muted-foreground)]">
              Sprints
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{sprints.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-[var(--color-muted-foreground)]">
              Usuários com entregas
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">
              {new Set(closedCards.map((c) => c.responsavel).filter(Boolean)).size}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Gráfico: Cards fechados por usuário */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            Cards finalizados por usuário
          </CardTitle>
          <CardDescription>
            Filtre por sprint e/ou tipo de card
          </CardDescription>
          <div className="flex flex-wrap items-center gap-4 pt-2">
            <div className="flex items-center gap-2 min-w-[220px]">
              <label className="text-sm text-[var(--color-foreground)] shrink-0">Sprint</label>
              <FilterSelect
                className="min-w-[180px]"
                placeholder="Todas"
                searchPlaceholder="Buscar sprint..."
                options={sprints.map((s) => ({ value: String(s.id), label: s.nome }))}
                value={cardsSprintFilter}
                onChange={setCardsSprintFilter}
              />
            </div>
            <div className="flex items-center gap-2 min-w-[220px]">
              <label className="text-sm text-[var(--color-foreground)] shrink-0">Tipo</label>
              <FilterSelect
                className="min-w-[180px]"
                placeholder="Todos"
                searchPlaceholder="Buscar tipo..."
                options={CARD_TYPES.map((t) => ({ value: t.value, label: t.label }))}
                value={cardsTypeFilter}
                onChange={setCardsTypeFilter}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div
            className="w-full max-h-[min(85vh,1400px)] overflow-y-auto overflow-x-hidden rounded-md"
            style={{ height: `${userVerticalBarChartHeight(cardsPerUserData.length, 320)}px` }}
          >
            {cardsPerUserData.length ? (
              <ChartContainer
                config={chartConfigCount}
                className="h-full w-full min-h-[200px] aspect-auto [&_.recharts-surface]:overflow-visible"
              >
                <BarChart data={cardsPerUserData} layout="vertical" margin={{ left: 12, right: 16, top: 8, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis type="number" tickLine={false} axisLine={false} />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={248}
                    interval={0}
                    tickLine={false}
                    axisLine={false}
                    tick={(props: { x: number; y: number; payload?: { value?: string }; index?: number }) => {
                      const { x, y, payload, index } = props;
                      const i =
                        typeof index === 'number' && index >= 0
                          ? index
                          : cardsPerUserData.findIndex((r) => r.name === payload?.value);
                      const row = i >= 0 ? cardsPerUserData[i] : undefined;
                      if (!row) return null;
                      return (
                        <g transform={`translate(${x},${y})`}>
                          <foreignObject x={-236} y={-18} width={232} height={36} style={{ overflow: 'visible' }}>
                            <div
                              xmlns="http://www.w3.org/1999/xhtml"
                              className="flex h-9 min-h-9 items-center gap-2 pr-1"
                            >
                              <Avatar className="h-7 w-7 shrink-0 rounded-full border border-[var(--color-border)]/60">
                                {row.profile_picture_url ? (
                                  <AvatarImage src={row.profile_picture_url} alt={row.name} />
                                ) : null}
                                <AvatarFallback className="text-[10px] bg-[var(--color-muted)] text-[var(--color-muted-foreground)]">
                                  {row.name.slice(0, 2).toUpperCase() || '?'}
                                </AvatarFallback>
                              </Avatar>
                              <span className="min-w-0 flex-1 text-xs font-medium leading-tight text-[var(--color-foreground)] break-words">
                                {row.name}
                              </span>
                            </div>
                          </foreignObject>
                        </g>
                      );
                    }}
                  />
                  <ChartTooltip content={<ChartTooltipContent nameKey="name" />} />
                  <Bar
                    dataKey="count"
                    fill="var(--color-count)"
                    radius={[0, 4, 4, 0]}
                    name="Entregas"
                    cursor="pointer"
                    onClick={(data) =>
                      handleCardsPerUserBarClick(data as { userId: string; name: string })
                    }
                  >
                    {cardsPerUserData.map((row) => (
                      <Cell key={row.userId} fill={getRoleBarColor(row.role)} />
                    ))}
                  </Bar>
                </BarChart>
              </ChartContainer>
            ) : (
              <p className="text-sm text-[var(--color-muted-foreground)] flex items-center justify-center h-full">Nenhum dado para os filtros selecionados</p>
            )}
          </div>
        </CardContent>
      </Card>



      {/* Leaderboard */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Trophy className="h-5 w-5" />
            Leaderboard – Quem mais entregou
          </CardTitle>
          <CardDescription>
            Por sprint, ano, mês, intervalo ou por usuários selecionados
          </CardDescription>
          <div className="flex flex-wrap gap-4 pt-2">
            <div className="flex items-center gap-2 min-w-[220px]">
              <label className="text-sm">Escopo:</label>
              <FilterSelect
                className="min-w-[160px]"
                clearable={false}
                placeholder="Escopo"
                searchPlaceholder="Buscar escopo..."
                options={[
                  { value: 'sprint', label: 'Por sprint' },
                  { value: 'year', label: 'Por ano' },
                  { value: 'month', label: 'Por mês' },
                  { value: 'interval', label: 'Por intervalo' },
                  { value: 'users', label: 'Por usuários' },
                ]}
                value={leaderboardScope}
                onChange={(v) => setLeaderboardScope(v as 'sprint' | 'year' | 'month' | 'interval' | 'users')}
              />
            </div>
            {leaderboardScope === 'sprint' && (
              <FilterSelect
                className="min-w-[200px]"
                clearable={false}
                placeholder="Sprint"
                searchPlaceholder="Buscar sprint..."
                options={sprints.map((s) => ({ value: String(s.id), label: s.nome }))}
                value={leaderboardSprint}
                onChange={setLeaderboardSprint}
              />
            )}
            {leaderboardScope === 'year' && (
              <FilterSelect
                className="min-w-[120px]"
                clearable={false}
                placeholder="Ano"
                searchPlaceholder="Buscar ano..."
                options={years.map((y) => ({ value: String(y), label: String(y) }))}
                value={String(leaderboardYear)}
                onChange={(v) => setLeaderboardYear(Number(v))}
              />
            )}
            {leaderboardScope === 'month' && (
              <>
                <FilterSelect
                  className="min-w-[160px]"
                  clearable={false}
                  placeholder="Mês"
                  searchPlaceholder="Buscar mês..."
                  options={MONTH_NAMES.map((label, i) => ({ value: String(i + 1), label }))}
                  value={String(leaderboardMonth)}
                  onChange={(v) => setLeaderboardMonth(Number(v))}
                />
                <FilterSelect
                  className="min-w-[120px]"
                  clearable={false}
                  placeholder="Ano"
                  searchPlaceholder="Buscar ano..."
                  options={years.map((y) => ({ value: String(y), label: String(y) }))}
                  value={String(leaderboardMonthYear)}
                  onChange={(v) => setLeaderboardMonthYear(Number(v))}
                />
              </>
            )}
            {leaderboardScope === 'interval' && (
              <>
                <div className="flex items-center gap-2">
                  <label className="text-sm">De:</label>
                  <input
                    type="date"
                    className="h-9 rounded-md border border-[var(--color-input)] bg-[var(--color-background)] px-3 text-sm"
                    value={leaderboardStartDate}
                    onChange={(e) => setLeaderboardStartDate(e.target.value)}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-sm">Até:</label>
                  <input
                    type="date"
                    className="h-9 rounded-md border border-[var(--color-input)] bg-[var(--color-background)] px-3 text-sm"
                    value={leaderboardEndDate}
                    onChange={(e) => setLeaderboardEndDate(e.target.value)}
                  />
                </div>
              </>
            )}
            {leaderboardScope === 'users' && (
              <div className="flex items-center gap-2 w-full max-w-md">
                <label className="text-sm shrink-0">Usuários:</label>
                <div className="relative flex-1" ref={leaderboardUsersDropdownRef}>
                  <button
                    type="button"
                    onClick={() => setLeaderboardUsersDropdownOpen((open) => !open)}
                    className="flex h-9 w-full items-center justify-between rounded-md border border-[var(--color-input)] bg-[var(--color-background)] px-3 text-sm text-left"
                  >
                    <span className="truncate">
                      {leaderboardSelectedUserIds.length === 0 && 'Selecione os usuários'}
                      {leaderboardSelectedUserIds.length > 0 &&
                        leaderboardSelectedUserIds.length < users.length &&
                        `${leaderboardSelectedUserIds.length} usuário(s) selecionado(s)`}
                      {leaderboardSelectedUserIds.length === users.length &&
                        users.length > 0 &&
                        'Todos os usuários selecionados'}
                    </span>
                    <ChevronDown
                      className={`ml-2 h-4 w-4 text-[var(--color-muted-foreground)] transition-transform ${leaderboardUsersDropdownOpen ? 'rotate-180' : ''}`}
                    />
                  </button>
                  {leaderboardUsersDropdownOpen && (
                    <div className="absolute z-50 mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-card)] shadow-lg">
                      <div className="border-b border-[var(--color-border)] p-2">
                        <div className="relative">
                          <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-muted-foreground)]" />
                          <input
                            type="text"
                            className="h-8 w-full rounded-md border border-[var(--color-input)] bg-[var(--color-background)] pl-7 pr-2 text-xs"
                            placeholder="Buscar por nome, usuário ou cargo..."
                            value={leaderboardUsersSearchQuery}
                            onChange={(e) => setLeaderboardUsersSearchQuery(e.target.value)}
                          />
                        </div>
                      </div>
                      <div className="max-h-64 overflow-y-auto p-1 text-sm">
                        {filteredLeaderboardUsers.length === 0 ? (
                          <p className="px-2 py-2 text-xs text-[var(--color-muted-foreground)]">
                            Nenhum usuário encontrado
                          </p>
                        ) : (
                          filteredLeaderboardUsers.map((u) => {
                            const checked = leaderboardSelectedUserIds.includes(String(u.id));
                            return (
                              <label
                                key={u.id}
                                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-[var(--color-accent)]"
                              >
                                <input
                                  type="checkbox"
                                  className="h-4 w-4 shrink-0 rounded border-[var(--color-input)]"
                                  checked={checked}
                                  onChange={(e) => handleToggleLeaderboardUser(String(u.id), e.target.checked)}
                                  onClick={(e) => e.stopPropagation()}
                                />
                                <Badge className={`shrink-0 w-[64px] ${getRoleBadgeColor(u.role)} justify-center text-xs`}>
                                  {getRoleLabel(u.role)}
                                </Badge>
                                <span className="truncate">{getShortDisplayName(u)}</span>
                              </label>
                            );
                          })
                        )}
                      </div>
                      <div className="flex items-center justify-between gap-2 border-t border-[var(--color-border)] px-2 py-2 text-xs">
                        <button
                          type="button"
                          className="text-[var(--color-primary)] hover:underline"
                          onClick={handleSelectAllLeaderboardUsers}
                        >
                          Selecionar todos
                        </button>
                        <button
                          type="button"
                          className="text-[var(--color-muted-foreground)] hover:underline"
                          onClick={handleClearLeaderboardUsers}
                        >
                          Limpar
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
            {leaderboardScope !== 'users' && (
              <div className="flex items-center gap-2 min-w-[200px]">
                <label className="text-sm">Exibir:</label>
                <FilterSelect
                  className="min-w-[160px]"
                  clearable={false}
                  placeholder="Exibir"
                  searchPlaceholder="Buscar opção..."
                  options={[
                    { value: 'top5', label: 'Top 5' },
                    { value: 'top3', label: 'Top 3' },
                    { value: 'all', label: 'Todos os usuários' },
                  ]}
                  value={leaderboardLimit}
                  onChange={(v) => setLeaderboardLimit(v as 'top5' | 'top3' | 'all')}
                />
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div
            className="w-full max-h-[min(85vh,1400px)] overflow-y-auto overflow-x-hidden rounded-md"
            style={{ height: `${userVerticalBarChartHeight(leaderboardData.length, 300)}px` }}
          >
            {leaderboardData.length ? (
              <ChartContainer
                config={chartConfigCount}
                className="h-full w-full min-h-[200px] aspect-auto [&_.recharts-surface]:overflow-visible"
              >
                <BarChart data={leaderboardData} layout="vertical" margin={{ left: 12, right: 16, top: 8, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis type="number" tickLine={false} axisLine={false} />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={248}
                    interval={0}
                    tickLine={false}
                    axisLine={false}
                    tick={(props: { x: number; y: number; payload?: { value?: string }; index?: number }) => {
                      const { x, y, payload, index } = props;
                      const i =
                        typeof index === 'number' && index >= 0
                          ? index
                          : leaderboardData.findIndex((r) => r.name === payload?.value);
                      const row = i >= 0 ? leaderboardData[i] : undefined;
                      if (!row) return null;
                      const position = i + 1;
                      const medalFrame =
                        position === 1
                          ? 'ring-2 ring-amber-400 ring-offset-2 ring-offset-[var(--color-card)]'
                          : position === 2
                            ? 'ring-2 ring-slate-300 ring-offset-2 ring-offset-[var(--color-card)]'
                            : position === 3
                              ? 'ring-2 ring-amber-600 ring-offset-2 ring-offset-[var(--color-card)]'
                              : '';
                      return (
                        <g transform={`translate(${x},${y})`}>
                          <foreignObject x={-236} y={-18} width={232} height={36} style={{ overflow: 'visible' }}>
                            <div
                              xmlns="http://www.w3.org/1999/xhtml"
                              className="flex h-9 min-h-9 items-center gap-2 pr-1"
                            >
                              <Avatar
                                className={`h-7 w-7 shrink-0 rounded-full border border-[var(--color-border)]/60 ${medalFrame}`}
                              >
                                {row.profile_picture_url ? (
                                  <AvatarImage src={row.profile_picture_url} alt={row.name} />
                                ) : null}
                                <AvatarFallback className="text-[10px] bg-[var(--color-muted)] text-[var(--color-muted-foreground)]">
                                  {row.name.slice(0, 2).toUpperCase() || '?'}
                                </AvatarFallback>
                              </Avatar>
                              <span className="min-w-0 flex-1 text-xs font-medium leading-tight text-[var(--color-foreground)] break-words">
                                {row.name}
                              </span>
                            </div>
                          </foreignObject>
                        </g>
                      );
                    }}
                  />
                  <ChartTooltip content={<ChartTooltipContent nameKey="name" />} />
                  <Bar
                    dataKey="count"
                    fill="var(--color-count)"
                    radius={[0, 4, 4, 0]}
                    name="Entregas"
                    cursor="pointer"
                    onClick={(data) =>
                      handleLeaderboardBarClick(data as { userId: string; name: string })
                    }
                  >
                    {leaderboardData.map((row) => (
                      <Cell key={row.userId} fill={getRoleBarColor(row.role)} />
                    ))}
                  </Bar>
                </BarChart>
              </ChartContainer>
            ) : (
              <p className="text-sm text-[var(--color-muted-foreground)] flex items-center justify-center h-full">Nenhum dado (cards sem responsável não entram no leaderboard)</p>
            )}
          </div>
        </CardContent>
      </Card>


      {/* Mapa de calor: entrega na sprint */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Flame className="h-5 w-5" />
            Mapa de calor – Entrega na sprint
          </CardTitle>
          <CardDescription>
            Um mapa por sprint: em qual dia da sprint os cards foram entregues. As datas no cabeçalho são da própria sprint. Passe o mouse para ver a lista de cards.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div ref={heatmapContainerRef} className="space-y-6 w-full">
            {(() => {
              const NAME_COL_WIDTH = 220;
              /** Largura fixa de cada célula de dia (todas iguais em todas as sprints). +50% em relação ao anterior (32 → 48). */
              const DAY_CELL_WIDTH_PX = 48;
              const maxInHeat = Math.max(
                1,
                ...Array.from(heatmapData.bySprintDay.values()).flatMap((m) =>
                  Array.from(m.values()).map((arr) => arr.length)
                )
              );
              const renderSprintTable = (sprint: Sprint) => {
                const dayMap = heatmapData.bySprintDay.get(sprint.id);
                const sprintDays = sprint.duracao_dias ?? 0;
                const tableWidthPx = sprintDays * DAY_CELL_WIDTH_PX;
                return (
                  <div key={sprint.id} className="grid w-full gap-0" style={{ gridTemplateColumns: `${NAME_COL_WIDTH}px 1fr` }}>
                    <div
                      className="flex flex-col justify-center text-left border border-r-0 border-[var(--color-border)] border-[0.5px] rounded-l-md bg-[var(--color-muted)]/50 p-2 min-h-[3.5rem]"
                      style={{ width: NAME_COL_WIDTH, minWidth: NAME_COL_WIDTH }}
                    >
                      <span className="font-medium text-[var(--color-foreground)] leading-tight whitespace-nowrap block" title={sprint.nome}>{sprint.nome}</span>
                      <span className="text-[10px] text-[var(--color-muted-foreground)] leading-none mt-1">Duração da Sprint: {sprintDays} dias</span>
                    </div>
                    <div className="min-w-0 overflow-x-auto overflow-y-hidden">
                      <table
                        className="border-collapse text-sm table-fixed"
                        style={{ width: tableWidthPx }}
                      >
                        <colgroup>
                          {Array.from({ length: sprintDays }, (_, idx) => (
                            <col key={idx} style={{ width: DAY_CELL_WIDTH_PX, minWidth: DAY_CELL_WIDTH_PX }} />
                          ))}
                        </colgroup>
                        <thead>
                          <tr>
                            {Array.from({ length: sprintDays }, (_, i) => {
                            const dayIndex = i + 1;
                            let dayNum: number;
                            let monthAbbrev: string;
                            if (sprint.data_inicio) {
                              const start = new Date(sprint.data_inicio);
                              const date = new Date(start);
                              date.setDate(start.getDate() + dayIndex - 1);
                              dayNum = date.getDate();
                              monthAbbrev = MONTH_ABBREV[date.getMonth()];
                            } else {
                              dayNum = dayIndex;
                              monthAbbrev = '';
                            }
                            return (
                              <th key={dayIndex} className="p-0.5 text-center align-bottom bg-[var(--color-muted)]/50 font-medium border-b border-r border-[var(--color-border)] border-[0.5px]">
                                <div className="flex flex-col items-center justify-end gap-0">
                                  <span className="text-sm font-semibold leading-none text-[var(--color-foreground)]">{dayNum}</span>
                                  {monthAbbrev && (
                                    <span className="text-[9px] leading-none text-[var(--color-muted-foreground)]">{monthAbbrev}</span>
                                  )}
                                </div>
                              </th>
                            );
                          })}
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          {Array.from({ length: sprintDays }, (_, i) => {
                            const day = i + 1;
                            const list = dayMap?.get(day) ?? [];
                            const count = list.length;
                            const intensity = count ? count / maxInHeat : 0;
                            return (
                              <td
                                key={day}
                                className="p-0 align-middle relative border-b border-r border-[var(--color-border)] border-[0.5px]"
                                style={{ background: count ? `hsl(var(--primary) / ${0.15 + intensity * 0.5})` : undefined }}
                                onMouseEnter={(e) => list.length > 0 && setHeatmapTooltip({ sprintName: sprint.nome, day, cards: list, x: e.clientX, y: e.clientY })}
                                onMouseMove={(e) => heatmapTooltip?.cards === list && setHeatmapTooltip((p) => p ? { ...p, x: e.clientX, y: e.clientY } : null)}
                                onMouseLeave={() => setHeatmapTooltip(null)}
                              >
                                <div className="w-full min-h-6 h-6 flex items-center justify-center cursor-help text-xs">
                                  {count > 0 ? (
                                    <span className="font-medium">{count}</span>
                                  ) : (
                                    <span className="text-[var(--color-muted-foreground)]">–</span>
                                  )}
                                </div>
                              </td>
                            );
                          })}
                        </tr>
                      </tbody>
                    </table>
                    </div>
                  </div>
                );
              };
              const scrollAreaClass = 'max-h-[28rem] overflow-y-auto pr-1 space-y-2';
              return (
                <>
                  {heatmapData.emAndamento.length > 0 && (
                    <div className="space-y-2">
                      <button
                        type="button"
                        onClick={() => setHeatmapEmAndamentoOpen((o) => !o)}
                        className="flex w-full items-center gap-2 text-left text-sm font-semibold text-[var(--color-foreground)] hover:opacity-80"
                      >
                        {heatmapEmAndamentoOpen ? (
                          <ChevronDown className="h-4 w-4 shrink-0" />
                        ) : (
                          <ChevronRight className="h-4 w-4 shrink-0" />
                        )}
                        Sprints em Andamento
                      </button>
                      {heatmapEmAndamentoOpen && (
                        <div className={scrollAreaClass}>
                          {heatmapData.emAndamento.map(renderSprintTable)}
                        </div>
                      )}
                    </div>
                  )}
                  {heatmapData.concluidas.length > 0 && (
                    <div className="space-y-2">
                      <button
                        type="button"
                        onClick={() => setHeatmapConcluidasOpen((o) => !o)}
                        className="flex w-full items-center gap-2 text-left text-sm font-semibold text-[var(--color-foreground)] hover:opacity-80"
                      >
                        {heatmapConcluidasOpen ? (
                          <ChevronDown className="h-4 w-4 shrink-0" />
                        ) : (
                          <ChevronRight className="h-4 w-4 shrink-0" />
                        )}
                        Sprints Concluídas
                      </button>
                      {heatmapConcluidasOpen && (
                        <div className={scrollAreaClass}>
                          {heatmapData.concluidas.map(renderSprintTable)}
                        </div>
                      )}
                    </div>
                  )}
                </>
              );
            })()}
          </div>
          {sprints.length === 0 && (
            <p className="text-sm text-[var(--color-muted-foreground)] py-4">Nenhuma sprint com entregas</p>
          )}
          {heatmapTooltip && (
            <div
              className="fixed z-50 pointer-events-none p-3 bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg shadow-lg max-w-xs max-h-48 overflow-y-auto text-sm"
              style={{ left: Math.min(heatmapTooltip.x + 12, window.innerWidth - 280), top: heatmapTooltip.y + 12 }}
            >
              <p className="font-medium mb-1">{heatmapTooltip.sprintName} – Dia {heatmapTooltip.day}</p>
              <ul className="list-disc list-inside space-y-0.5">
                {heatmapTooltip.cards.map((c) => (
                  <li key={c.id}>{c.nome}</li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>


      {/* Tabela: entrega dentro do prazo (80%) */}
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Target className="h-5 w-5" />
                Consistência de entrega
              </CardTitle>
              <CardDescription>
                Percentual de cards concluídos até a data e hora de entrega agendadas no card (campo de fim). A entrega real usa o instante em que o card passou a finalizado pela última vez. Meta: 80% para permanecer na gincana. Clique numa linha da tabela para ver a lista de cards daquele usuário com os filtros atuais.
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-4 pt-2">
              <div className="flex items-center gap-2 min-w-[220px]">
                <label className="text-sm">Escopo:</label>
                <FilterSelect
                  className="min-w-[160px]"
                  clearable={false}
                  placeholder="Escopo"
                  searchPlaceholder="Buscar escopo..."
                  options={[
                    { value: 'sprint', label: 'Por sprint' },
                    { value: 'year', label: 'Por ano' },
                    { value: 'month', label: 'Por mês' },
                    { value: 'interval', label: 'Por intervalo' },
                    { value: 'users', label: 'Por usuários' },
                  ]}
                  value={onTimeScope}
                  onChange={(v) => setOnTimeScope(v as 'sprint' | 'year' | 'month' | 'interval' | 'users')}
                />
              </div>
              {onTimeScope === 'sprint' && (
                <FilterSelect
                  className="min-w-[200px]"
                  clearable={false}
                  placeholder="Sprint"
                  searchPlaceholder="Buscar sprint..."
                  options={sprints.map((s) => ({ value: String(s.id), label: s.nome }))}
                  value={onTimeSprint}
                  onChange={setOnTimeSprint}
                />
              )}
              {onTimeScope === 'year' && (
                <FilterSelect
                  className="min-w-[120px]"
                  clearable={false}
                  placeholder="Ano"
                  searchPlaceholder="Buscar ano..."
                  options={years.map((y) => ({ value: String(y), label: String(y) }))}
                  value={String(onTimeYear)}
                  onChange={(v) => setOnTimeYear(Number(v))}
                />
              )}
              {onTimeScope === 'month' && (
                <>
                  <FilterSelect
                    className="min-w-[160px]"
                    clearable={false}
                    placeholder="Mês"
                    searchPlaceholder="Buscar mês..."
                    options={MONTH_NAMES.map((label, i) => ({ value: String(i + 1), label }))}
                    value={String(onTimeMonth)}
                    onChange={(v) => setOnTimeMonth(Number(v))}
                  />
                  <FilterSelect
                    className="min-w-[120px]"
                    clearable={false}
                    placeholder="Ano"
                    searchPlaceholder="Buscar ano..."
                    options={years.map((y) => ({ value: String(y), label: String(y) }))}
                    value={String(onTimeMonthYear)}
                    onChange={(v) => setOnTimeMonthYear(Number(v))}
                  />
                </>
              )}
              {onTimeScope === 'interval' && (
                <>
                  <div className="flex items-center gap-2">
                    <label className="text-sm">De:</label>
                    <input
                      type="date"
                      className="h-9 rounded-md border border-[var(--color-input)] bg-[var(--color-background)] px-3 text-sm"
                      value={onTimeStartDate}
                      onChange={(e) => setOnTimeStartDate(e.target.value)}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="text-sm">Até:</label>
                    <input
                      type="date"
                      className="h-9 rounded-md border border-[var(--color-input)] bg-[var(--color-background)] px-3 text-sm"
                      value={onTimeEndDate}
                      onChange={(e) => setOnTimeEndDate(e.target.value)}
                    />
                  </div>
                </>
              )}
              {onTimeScope === 'users' && (
                <div className="flex items-center gap-2 w-full max-w-md">
                  <label className="text-sm shrink-0">Usuários:</label>
                  <div className="relative flex-1" ref={onTimeScopeUsersDropdownRef}>
                    <button
                      type="button"
                      onClick={() => setOnTimeScopeUsersDropdownOpen((o) => !o)}
                      className="flex h-9 w-full items-center justify-between rounded-md border border-[var(--color-input)] bg-[var(--color-background)] px-3 text-sm text-left"
                    >
                      <span className="truncate">
                        {onTimeScopeUserIds.length === 0 && 'Selecione os usuários'}
                        {onTimeScopeUserIds.length > 0 && onTimeScopeUserIds.length < users.length && `${onTimeScopeUserIds.length} usuário(s) selecionado(s)`}
                        {onTimeScopeUserIds.length === users.length && users.length > 0 && 'Todos os usuários selecionados'}
                      </span>
                      <ChevronDown
                        className={`ml-2 h-4 w-4 shrink-0 text-[var(--color-muted-foreground)] transition-transform ${onTimeScopeUsersDropdownOpen ? 'rotate-180' : ''}`}
                      />
                    </button>
                    {onTimeScopeUsersDropdownOpen && (
                      <div className="absolute z-50 mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-card)] shadow-lg">
                        <div className="border-b border-[var(--color-border)] p-2">
                          <div className="relative">
                            <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-muted-foreground)]" />
                            <input
                              type="text"
                              className="h-8 w-full rounded-md border border-[var(--color-input)] bg-[var(--color-background)] pl-7 pr-2 text-xs"
                              placeholder="Buscar por nome, usuário ou cargo..."
                              value={onTimeScopeUsersSearchQuery}
                              onChange={(e) => setOnTimeScopeUsersSearchQuery(e.target.value)}
                            />
                          </div>
                        </div>
                        <div className="max-h-64 overflow-y-auto p-1 text-sm">
                          {filteredOnTimeScopeUsers.length === 0 ? (
                            <p className="px-2 py-2 text-xs text-[var(--color-muted-foreground)]">Nenhum usuário encontrado</p>
                          ) : (
                            filteredOnTimeScopeUsers.map((u) => {
                              const uid = String(u.id);
                              const checked = onTimeScopeUserIds.includes(uid);
                              return (
                                <label
                                  key={u.id}
                                  className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-[var(--color-accent)]"
                                >
                                  <input
                                    type="checkbox"
                                    className="h-4 w-4 shrink-0 rounded border-[var(--color-input)]"
                                    checked={checked}
                                    onChange={(e) => handleToggleOnTimeScopeUser(uid, e.target.checked)}
                                    onClick={(e) => e.stopPropagation()}
                                  />
                                  <Badge className={`shrink-0 w-[64px] ${getRoleBadgeColor(u.role)} justify-center text-xs`}>
                                    {getRoleLabel(u.role)}
                                  </Badge>
                                  <span className="truncate">{getShortDisplayName(u)}</span>
                                </label>
                              );
                            })
                          )}
                        </div>
                        <div className="flex items-center justify-between gap-2 border-t border-[var(--color-border)] px-2 py-2 text-xs">
                          <button
                            type="button"
                            className="text-[var(--color-primary)] hover:underline"
                            onClick={handleOnTimeScopeSelectAll}
                          >
                            Selecionar todos
                          </button>
                          <button
                            type="button"
                            className="text-[var(--color-muted-foreground)] hover:underline"
                            onClick={handleOnTimeScopeClear}
                          >
                            Limpar
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
          </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border border-[var(--color-border)] overflow-hidden">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-[var(--color-muted)]/50">
                  <th className="text-center p-3 font-medium border-b border-r border-[var(--color-border)] w-0 whitespace-nowrap">Top</th>
                  <th className="text-left p-3 font-medium border-b border-r border-[var(--color-border)]">Usuário</th>
                  <th className="text-right p-3 font-medium border-b border-r border-[var(--color-border)]">Entregues</th>
                  <th className="text-right p-3 font-medium border-b border-r border-[var(--color-border)]">No prazo</th>
                  <th className="text-right p-3 font-medium border-b border-r border-[var(--color-border)]">Fora do prazo</th>
                  <th className="text-right p-3 font-medium border-b border-[var(--color-border)]">Porcentagem total</th>
                </tr>
              </thead>
              <tbody>
                {onTimeTableFiltered.map((row, i) => {
                  const rank = i + 1;
                  // Cor da linha reflete a meta de 80%: vermelho = abaixo da
                  // meta, verde = na meta. Ter "alguns cards atrasados" sozinho
                  // não puxa para vermelho — o que conta é a % total.
                  const rowBg = row.total === 0
                    ? 'bg-[var(--color-muted)]/25'
                    : row.pct < 80 ? 'bg-[#fca5a540]' : 'bg-[#86efac40]';
                  const pctColor = row.total === 0
                    ? 'text-[var(--color-muted-foreground)]'
                    : row.pct >= 90 ? 'text-green-700 dark:text-green-400' : row.pct >= 80 ? 'text-yellow-600 dark:text-yellow-500' : 'text-red-700 dark:text-red-400';
                  const topCell =
                    rank === 1 ? (
                      <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-amber-400 text-xs font-bold text-amber-950 shadow-sm" title="Ouro">1</span>
                    ) : rank === 2 ? (
                      <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-slate-300 text-xs font-bold text-slate-800 shadow-sm" title="Prata">2</span>
                    ) : rank === 3 ? (
                      <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-amber-700 text-xs font-bold text-amber-100 shadow-sm" title="Bronze">3</span>
                    ) : (
                      <span className="text-[var(--color-foreground)]">{rank}</span>
                    );
                  return (
                    <tr
                      key={row.userId}
                      role={row.total > 0 ? 'button' : undefined}
                      tabIndex={row.total > 0 ? 0 : undefined}
                      className={`${rowBg} border-b border-[var(--color-border)]${
                        row.total > 0 ? ' cursor-pointer hover:opacity-90' : ''
                      }`}
                      onClick={() => {
                        if (row.total > 0) setOnTimeListModalUserId(String(row.userId));
                      }}
                      onKeyDown={(e) => {
                        if (row.total > 0 && (e.key === 'Enter' || e.key === ' ')) {
                          e.preventDefault();
                          setOnTimeListModalUserId(String(row.userId));
                        }
                      }}
                    >
                      <td className="p-3 border-r border-[var(--color-border)] w-0 whitespace-nowrap">
                        <div className="flex justify-center">{topCell}</div>
                      </td>
                      <td className="p-3 border-r border-[var(--color-border)]">
                        <div className="flex items-center gap-2">
                          <Avatar className="h-8 w-8 shrink-0">
                            {row.user?.profile_picture_url ? (
                              <AvatarImage src={row.user.profile_picture_url} alt={row.name} />
                            ) : null}
                            <AvatarFallback className="bg-[var(--color-muted)] text-[var(--color-muted-foreground)] text-xs">
                              {row.name.split(/\s+/).map((s) => s[0]).join('').slice(0, 2).toUpperCase() || 'U'}
                            </AvatarFallback>
                          </Avatar>
                          <span className="font-medium">{row.name}</span>
                        </div>
                      </td>
                      <td className="p-3 text-right border-r border-[var(--color-border)]">{row.total}</td>
                      <td className={`p-3 text-right border-r border-[var(--color-border)] ${row.onTime > 0 ? 'text-green-700 dark:text-green-400 font-medium' : ''}`}>
                        {row.onTime}
                      </td>
                      <td className={`p-3 text-right border-r border-[var(--color-border)] ${row.late > 0 ? 'text-red-700 dark:text-red-400 font-medium' : ''}`}>
                        {row.late}
                      </td>
                      <td className={`p-3 text-right font-semibold ${pctColor}`}>
                        {row.pct}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {onTimeTableFiltered.length === 0 && (
            <p className="text-sm text-[var(--color-muted-foreground)] py-4">Nenhum dado de entrega no prazo</p>
          )}
        </CardContent>
      </Card>

      {/* Cycle Time médio */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Timer className="h-5 w-5" />
            Cycle Time médio
          </CardTitle>
          <CardDescription>
            Tempo médio entre o início do desenvolvimento e a conclusão real do card.
            Cards sem uma das duas datas são ignorados.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {cycleTimeData.overallCount === 0 ? (
            <p className="text-sm text-[var(--color-muted-foreground)]">
              Sem dados suficientes — nenhum card finalizado possui ambas data_inicio e finalizado_em.
            </p>
          ) : (
            <div className="space-y-4">
              {/* Card grande de média geral */}
              <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-muted)]/30 p-4">
                <p className="text-xs uppercase tracking-wide text-[var(--color-muted-foreground)]">
                  Média geral
                </p>
                <p className="mt-1 text-3xl font-bold text-[var(--color-foreground)]">
                  {cycleTimeData.overall} <span className="text-base font-normal text-[var(--color-muted-foreground)]">{cycleTimeData.overall === 1 ? 'Dia' : 'Dias'}</span>
                </p>
                <p className="text-xs text-[var(--color-muted-foreground)]">
                  {cycleTimeData.overallCount} card{cycleTimeData.overallCount === 1 ? '' : 's'} considerado{cycleTimeData.overallCount === 1 ? '' : 's'}
                </p>
              </div>

              {/* Tabela por área */}
              <div>
                <h4 className="mb-2 text-sm font-semibold text-[var(--color-foreground)]">
                  Por área —{' '}
                  <span className="font-normal text-[var(--color-muted-foreground)]">
                    dias por card (em média)
                  </span>
                </h4>
                {cycleTimeData.perArea.length === 0 ? (
                  <p className="text-xs text-[var(--color-muted-foreground)]">Sem dados.</p>
                ) : (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                    {cycleTimeData.perArea.map((a) => {
                      // Capitaliza só a primeira letra (mantém o resto como vem).
                      const label = a.label
                        ? a.label.charAt(0).toUpperCase() + a.label.slice(1).toLowerCase()
                        : a.area;
                      const dayWord = a.avgDays === 1 ? 'Dia' : 'Dias';
                      return (
                        <div
                          key={a.area}
                          className="rounded-md border border-[var(--color-border)] p-3"
                        >
                          <p className="text-xs font-medium tracking-wide text-[var(--color-muted-foreground)] truncate">
                            {label}
                          </p>
                          <p className="mt-1 text-lg font-bold text-[var(--color-foreground)]">
                            {a.avgDays}{' '}
                            <span className="text-xs font-normal text-[var(--color-muted-foreground)]">
                              {dayWord}
                            </span>
                          </p>
                          <p className="text-[10px] text-[var(--color-muted-foreground)]">
                            {a.count} card{a.count === 1 ? '' : 's'}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Tabela por usuário */}
              <div>
                <h4 className="mb-2 text-sm font-semibold text-[var(--color-foreground)]">
                  Por usuário (mais rápido → mais lento)
                </h4>
                {cycleTimeData.perUser.length === 0 ? (
                  <p className="text-xs text-[var(--color-muted-foreground)]">Sem dados.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="border-b border-[var(--color-border)] text-left text-xs uppercase tracking-wide text-[var(--color-muted-foreground)]">
                        <tr>
                          <th className="px-3 py-2">Usuário</th>
                          <th className="px-3 py-2 text-right">Cards</th>
                          <th className="px-3 py-2 text-right">Média (dias)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {cycleTimeData.perUser.map((u) => (
                          <tr
                            key={u.userId}
                            role="button"
                            tabIndex={0}
                            onClick={() => handleCycleTimeRowClick(u.userId, u.name)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                handleCycleTimeRowClick(u.userId, u.name);
                              }
                            }}
                            className="border-b border-[var(--color-border)] last:border-0 cursor-pointer hover:bg-[var(--color-accent)]"
                          >
                            <td className="px-3 py-2">
                              <div className="flex items-center gap-2">
                                <Avatar className="h-6 w-6">
                                  {u.profile_picture_url && <AvatarImage src={u.profile_picture_url} alt="" />}
                                  <AvatarFallback className="text-[10px]">
                                    {u.name.slice(0, 2).toUpperCase()}
                                  </AvatarFallback>
                                </Avatar>
                                {u.role ? (
                                  <Badge className={`${getRoleColor(u.role)} w-[64px] shrink-0 justify-center text-[10px]`}>
                                    {getRoleLabel(u.role)}
                                  </Badge>
                                ) : (
                                  <span className="w-[64px] shrink-0" aria-hidden />
                                )}
                                <span>{u.name}</span>
                              </div>
                            </td>
                            <td className="px-3 py-2 text-right text-[var(--color-muted-foreground)]">
                              {u.count}
                            </td>
                            <td className="px-3 py-2 text-right font-bold text-[var(--color-foreground)]">
                              {u.avgDays}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Throughput por sprint */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Gauge className="h-5 w-5" />
            Throughput por sprint
          </CardTitle>
          <CardDescription>
            Velocidade da equipe = cards finalizados ÷ duração da sprint (em dias).
            Sprints ordenadas pela mais recente.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {throughputData.length === 0 ? (
            <p className="text-sm text-[var(--color-muted-foreground)]">
              Nenhuma sprint registrada.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-[var(--color-border)] text-left text-xs uppercase tracking-wide text-[var(--color-muted-foreground)]">
                  <tr>
                    <th className="px-3 py-2">Sprint</th>
                    <th className="px-3 py-2 text-right">Entregues</th>
                    <th className="px-3 py-2 text-right">Duração</th>
                    <th className="px-3 py-2 text-right">Cards/dia</th>
                    <th className="px-3 py-2">Visual</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const maxThroughput = Math.max(
                      ...throughputData.map((t) => t.throughput),
                      0.01,
                    );
                    return throughputData.map((t) => {
                      const pctWidth = Math.round((t.throughput / maxThroughput) * 100);
                      return (
                        <tr key={t.sprintId} className="border-b border-[var(--color-border)] last:border-0">
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-[var(--color-foreground)]">{t.name}</span>
                              {!t.finalizada && (
                                <Badge className="border-green-600/40 bg-green-500/15 text-green-800 dark:text-green-400 text-[10px]">
                                  Ativa
                                </Badge>
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-right text-[var(--color-muted-foreground)]">
                            {t.delivered}
                          </td>
                          <td className="px-3 py-2 text-right text-[var(--color-muted-foreground)]">
                            {t.days}d
                          </td>
                          <td className="px-3 py-2 text-right font-bold text-[var(--color-foreground)]">
                            {t.throughput}
                          </td>
                          <td className="px-3 py-2">
                            <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--color-muted)]">
                              <div
                                className="h-full bg-[var(--color-primary)]"
                                style={{ width: `${pctWidth}%` }}
                              />
                            </div>
                          </td>
                        </tr>
                      );
                    });
                  })()}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Volume por Área */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Layers className="h-5 w-5" />
            Volume por área
          </CardTitle>
          <CardDescription>
            Distribuição dos cards finalizados por categoria técnica (frontend, backend, RPA, etc.).
            Útil para planejamento de equipe e foco.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {volumeByAreaData.length === 0 ? (
            <p className="text-sm text-[var(--color-muted-foreground)]">
              Nenhum card finalizado.
            </p>
          ) : (
            <div className="space-y-2">
              {(() => {
                const maxCount = Math.max(...volumeByAreaData.map((a) => a.count), 1);
                return volumeByAreaData.map((a) => {
                  const pctWidth = Math.round((a.count / maxCount) * 100);
                  return (
                    <div key={a.area}>
                      <div className="flex items-center justify-between gap-2 text-sm">
                        <span className="font-medium text-[var(--color-foreground)]">{a.label}</span>
                        <span className="text-xs text-[var(--color-muted-foreground)]">
                          {a.count} card{a.count === 1 ? '' : 's'} · {a.pct}%
                        </span>
                      </div>
                      <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-[var(--color-muted)]">
                        <div
                          className="h-full bg-[var(--color-primary)]"
                          style={{ width: `${pctWidth}%` }}
                        />
                      </div>
                    </div>
                  );
                });
              })()}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Métricas de projetos */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FolderKanban className="h-5 w-5" />
            Métricas de projetos
          </CardTitle>
          <CardDescription>
            Duração, volume de cards e recorrência em sprints. Filtre por ano ou por período.
          </CardDescription>
          <div className="flex flex-wrap items-center gap-4 pt-2">
            <div className="flex items-center gap-2 min-w-[220px]">
              <label className="text-sm">Filtrar por:</label>
              <FilterSelect
                className="min-w-[160px]"
                clearable={false}
                placeholder="Filtrar por"
                searchPlaceholder="Buscar..."
                options={[
                  { value: 'year', label: 'Por ano' },
                  { value: 'interval', label: 'Por período' },
                ]}
                value={projectMetricsFilter}
                onChange={(v) => setProjectMetricsFilter(v as 'year' | 'interval')}
              />
            </div>
            {projectMetricsFilter === 'year' && (
              <FilterSelect
                className="min-w-[120px]"
                clearable={false}
                placeholder="Ano"
                searchPlaceholder="Buscar ano..."
                options={projectYears.map((y) => ({ value: String(y), label: String(y) }))}
                value={String(projectMetricsYear)}
                onChange={(v) => setProjectMetricsYear(Number(v))}
              />
            )}
            {projectMetricsFilter === 'interval' && (
              <>
                <div className="flex items-center gap-2">
                  <label className="text-sm">De:</label>
                  <input
                    type="date"
                    className="h-9 rounded-md border border-[var(--color-input)] bg-[var(--color-background)] px-3 text-sm"
                    value={projectMetricsStartDate}
                    onChange={(e) => setProjectMetricsStartDate(e.target.value)}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-sm">Até:</label>
                  <input
                    type="date"
                    className="h-9 rounded-md border border-[var(--color-input)] bg-[var(--color-background)] px-3 text-sm"
                    value={projectMetricsEndDate}
                    onChange={(e) => setProjectMetricsEndDate(e.target.value)}
                  />
                </div>
              </>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {projectStats ? (
            <div className="grid gap-4 md:grid-cols-3">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-[var(--color-muted-foreground)]">
                    Projeto mais longo (dias)
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  {projectStats.longest ? (
                    <div className="text-sm space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-[var(--color-foreground)]">
                          {projectStats.longest.name}
                        </p>
                        {projectStats.longest.isActive ? (
                          <Badge className="border-green-600/40 bg-green-500/15 text-green-800 dark:text-green-400 text-[10px]">
                            Ativo
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px]">
                            Encerrado
                          </Badge>
                        )}
                      </div>
                      <p className="text-2xl font-bold text-[var(--color-foreground)] leading-none">
                        {projectStats.longest.durationDays}
                        <span className="text-sm font-normal text-[var(--color-muted-foreground)]">
                          {' '}dias
                        </span>
                      </p>
                      <p className="text-xs text-[var(--color-muted-foreground)]">
                        {projectStats.longest.start} → {projectStats.longest.end}
                      </p>
                      <p className="text-xs text-[var(--color-muted-foreground)]">
                        Em {projectStats.longest.sprintCount} sprint
                        {projectStats.longest.sprintCount === 1 ? '' : 's'}
                      </p>
                    </div>
                  ) : (
                    <p className="text-sm text-[var(--color-muted-foreground)]">Sem dados suficientes.</p>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-[var(--color-muted-foreground)]">
                    Projeto com mais cards
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  {projectStats.mostCards ? (
                    <div className="text-sm space-y-1">
                      <p className="font-semibold text-[var(--color-foreground)] truncate">
                        {projectStats.mostCards.project.nome}
                      </p>
                      <p className="text-2xl font-bold text-[var(--color-foreground)] leading-none">
                        {projectStats.mostCards.stats.total}
                        <span className="text-sm font-normal text-[var(--color-muted-foreground)]">
                          {' '}card{projectStats.mostCards.stats.total === 1 ? '' : 's'}
                        </span>
                      </p>
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        <Badge className="border-green-600/40 bg-green-500/15 text-green-800 dark:text-green-400 text-[10px]">
                          {projectStats.mostCards.stats.delivered} entregue
                          {projectStats.mostCards.stats.delivered === 1 ? '' : 's'}
                        </Badge>
                        {projectStats.mostCards.stats.inviabilizados > 0 && (
                          <Badge className="border-red-600/40 bg-red-500/15 text-red-800 dark:text-red-400 text-[10px]">
                            {projectStats.mostCards.stats.inviabilizados} inviabilizado
                            {projectStats.mostCards.stats.inviabilizados === 1 ? '' : 's'}
                          </Badge>
                        )}
                        {(() => {
                          const aberto =
                            projectStats.mostCards.stats.total -
                            projectStats.mostCards.stats.delivered -
                            projectStats.mostCards.stats.inviabilizados;
                          return aberto > 0 ? (
                            <Badge variant="outline" className="text-[10px]">
                              {aberto} em aberto
                            </Badge>
                          ) : null;
                        })()}
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-[var(--color-muted-foreground)]">Sem cards associados.</p>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-[var(--color-muted-foreground)]">
                    Projeto recorrente (mais sprints)
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  {projectStats.recurrent && projectStats.recurrent.sprintCount > 1 ? (
                    <div className="text-sm space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-[var(--color-foreground)] truncate">
                          {projectStats.recurrent.name}
                        </p>
                        <Badge className="border-[var(--color-primary)]/40 bg-[var(--color-primary)]/15 text-[var(--color-primary)] text-[10px]">
                          Recorrente
                        </Badge>
                      </div>
                      <p className="text-2xl font-bold text-[var(--color-foreground)] leading-none">
                        {projectStats.recurrent.sprintCount}
                        <span className="text-sm font-normal text-[var(--color-muted-foreground)]">
                          {' '}sprint{projectStats.recurrent.sprintCount === 1 ? '' : 's'}
                        </span>
                      </p>
                      <p className="text-xs text-[var(--color-muted-foreground)]">
                        Apareceu em {projectStats.recurrent.sprintCount} sprints diferentes.
                      </p>
                    </div>
                  ) : (
                    <p className="text-sm text-[var(--color-muted-foreground)]">
                      Ainda não há projetos recorrentes (mesmo nome em múltiplas sprints).
                    </p>
                  )}
                </CardContent>
              </Card>
            </div>
          ) : (
            <p className="text-sm text-[var(--color-muted-foreground)]">Sem dados de projetos suficientes.</p>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={onTimeListModalUserId != null && onTimeListModalRow != null}
        onOpenChange={(open) => {
          if (!open) setOnTimeListModalUserId(null);
        }}
        containerClassName="max-w-2xl"
      >
        <DialogContent
          onClose={() => setOnTimeListModalUserId(null)}
          className="max-h-[90vh] flex flex-col overflow-hidden"
        >
          <DialogHeader>
            <DialogTitle>Cards entregues</DialogTitle>
            <DialogDescription>
              {onTimeListModalRow
                ? `${onTimeListModalRow.name} · ${onTimeScopeDescription}`
                : ''}
            </DialogDescription>
          </DialogHeader>
          {onTimeListModalRow && (
            <div className="mt-2 flex min-h-0 flex-1 flex-col gap-0">
              <div className="flex gap-[8px] border-b border-[var(--color-border)]">
                <Button
                  type="button"
                  variant="ghost"
                  disabled={onTimeListModalRow.onTimeCards.length === 0}
                  onClick={() => setOnTimeListTab('onTime')}
                  className={cn(
                    'rounded-none border-b-2 border-transparent px-[16px] py-[8px] h-auto',
                    onTimeListTab === 'onTime'
                      ? 'border-[var(--color-primary)] text-[var(--color-primary)] font-semibold'
                      : 'text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]',
                  )}
                >
                  No prazo ({onTimeListModalRow.onTimeCards.length})
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={onTimeListModalRow.lateCards.length === 0}
                  onClick={() => setOnTimeListTab('late')}
                  className={cn(
                    'rounded-none border-b-2 border-transparent px-[16px] py-[8px] h-auto',
                    onTimeListTab === 'late'
                      ? 'border-[var(--color-primary)] text-[var(--color-primary)] font-semibold'
                      : 'text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]',
                  )}
                >
                  Fora do prazo ({onTimeListModalRow.lateCards.length})
                </Button>
              </div>
              <div className="min-h-0 max-h-[min(60vh,520px)] flex-1 overflow-y-auto pr-1 pt-3">
                {onTimeListTab === 'onTime' ? (
                  onTimeListModalRow.onTimeCards.length > 0 ? (
                    <ul className="space-y-2">
                      {[...onTimeListModalRow.onTimeCards].sort(sortCardsByDeliveryDesc).map((card) => (
                        <MetricsDeliveredCardRow
                          key={card.id}
                          card={card}
                          variant="onTime"
                          onSelect={openConsistencyCardFromMetrics}
                        />
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-[var(--color-muted-foreground)]">Nenhum card no prazo neste filtro.</p>
                  )
                ) : onTimeListModalRow.lateCards.length > 0 ? (
                  <ul className="space-y-2">
                    {[...onTimeListModalRow.lateCards].sort(sortCardsByDeliveryDesc).map((card) => (
                      <MetricsDeliveredCardRow
                        key={card.id}
                        card={card}
                        variant="late"
                        onSelect={openConsistencyCardFromMetrics}
                      />
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-[var(--color-muted-foreground)]">Nenhum card fora do prazo neste filtro.</p>
                )}
              </div>
              <DialogFooter className="mt-0 shrink-0 border-t border-[var(--color-border)] pt-4">
                <Button type="button" variant="outline" onClick={() => setOnTimeListModalUserId(null)}>
                  Fechar
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Modal compartilhado entre os 3 gráficos de barras (clique numa barra
          → lista de cards do usuário). Mesmas tabs do modal de Consistência. */}
      <Dialog
        open={chartCardsModal != null}
        onOpenChange={(open) => {
          if (!open) setChartCardsModal(null);
        }}
        containerClassName="max-w-2xl"
      >
        <DialogContent
          onClose={() => setChartCardsModal(null)}
          className="max-h-[90vh] flex flex-col overflow-hidden"
        >
          <DialogHeader>
            <DialogTitle>{chartCardsModal?.title ?? 'Cards entregues'}</DialogTitle>
            <DialogDescription>
              {chartCardsModal
                ? `${chartCardsModal.description} · ${chartCardsModal.onTimeCards.length + chartCardsModal.lateCards.length} card(s)`
                : ''}
            </DialogDescription>
          </DialogHeader>
          {chartCardsModal && (
            <div className="mt-2 flex min-h-0 flex-1 flex-col gap-0">
              <div className="flex gap-[8px] border-b border-[var(--color-border)]">
                <Button
                  type="button"
                  variant="ghost"
                  disabled={chartCardsModal.onTimeCards.length === 0}
                  onClick={() => setChartCardsTab('onTime')}
                  className={cn(
                    'rounded-none border-b-2 border-transparent px-[16px] py-[8px] h-auto',
                    chartCardsTab === 'onTime'
                      ? 'border-[var(--color-primary)] text-[var(--color-primary)] font-semibold'
                      : 'text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]',
                  )}
                >
                  No prazo ({chartCardsModal.onTimeCards.length})
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={chartCardsModal.lateCards.length === 0}
                  onClick={() => setChartCardsTab('late')}
                  className={cn(
                    'rounded-none border-b-2 border-transparent px-[16px] py-[8px] h-auto',
                    chartCardsTab === 'late'
                      ? 'border-[var(--color-primary)] text-[var(--color-primary)] font-semibold'
                      : 'text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]',
                  )}
                >
                  Fora do prazo ({chartCardsModal.lateCards.length})
                </Button>
              </div>
              <div className="min-h-0 max-h-[min(60vh,520px)] flex-1 overflow-y-auto pr-1 pt-3">
                {chartCardsTab === 'onTime' ? (
                  chartCardsModal.onTimeCards.length > 0 ? (
                    <ul className="space-y-2">
                      {[...chartCardsModal.onTimeCards].sort(sortCardsByDeliveryDesc).map((card) => (
                        <MetricsDeliveredCardRow
                          key={card.id}
                          card={card}
                          variant="onTime"
                          onSelect={(id) => {
                            setChartCardsModal(null);
                            void openConsistencyCardFromMetrics(id);
                          }}
                        />
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-[var(--color-muted-foreground)]">
                      Nenhum card no prazo neste filtro.
                    </p>
                  )
                ) : chartCardsModal.lateCards.length > 0 ? (
                  <ul className="space-y-2">
                    {[...chartCardsModal.lateCards].sort(sortCardsByDeliveryDesc).map((card) => (
                      <MetricsDeliveredCardRow
                        key={card.id}
                        card={card}
                        variant="late"
                        onSelect={(id) => {
                          setChartCardsModal(null);
                          void openConsistencyCardFromMetrics(id);
                        }}
                      />
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-[var(--color-muted-foreground)]">
                    Nenhum card fora do prazo neste filtro.
                  </p>
                )}
              </div>
              <DialogFooter className="mt-0 shrink-0 border-t border-[var(--color-border)] pt-4">
                <Button type="button" variant="outline" onClick={() => setChartCardsModal(null)}>
                  Fechar
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={onTimeViewCardOpen}
        onOpenChange={(open) => {
          setOnTimeViewCardOpen(open);
          if (!open) {
            setOnTimeViewSelectedCard(null);
            setOnTimeViewCardForm({ ...EMPTY_METRICS_CARD_FORM });
          }
        }}
        containerClassName="max-w-[600px]"
      >
        <DialogContent
          onClose={() => {
            setOnTimeViewCardOpen(false);
            setOnTimeViewSelectedCard(null);
            setOnTimeViewCardForm({ ...EMPTY_METRICS_CARD_FORM });
          }}
          className="max-w-[600px]"
        >
          <DialogHeader>
            <DialogTitle>Ver card</DialogTitle>
            <DialogDescription>Somente leitura. Use o botão abaixo para abrir o projeto no quadro.</DialogDescription>
          </DialogHeader>
          {onTimeViewCardLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-[var(--color-primary)]" />
            </div>
          ) : (
            <form className="mt-4 max-h-[70vh] space-y-4 overflow-y-auto pr-2" onSubmit={(e) => e.preventDefault()}>
              <div className="space-y-2">
                <Label htmlFor="metrics-card-nome">Nome</Label>
                <Input id="metrics-card-nome" value={onTimeViewCardForm.nome} disabled readOnly />
              </div>
              <div className="space-y-2">
                <Label htmlFor="metrics-card-desc">Descrição</Label>
                <Textarea id="metrics-card-desc" value={onTimeViewCardForm.descricao} disabled readOnly rows={4} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="metrics-card-script">Link do script</Label>
                <Input id="metrics-card-script" type="url" value={onTimeViewCardForm.script_url} disabled readOnly />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="metrics-card-area">Área</Label>
                  <select
                    id="metrics-card-area"
                    className="flex h-10 w-full rounded-md border border-[var(--color-input)] bg-[var(--color-background)] px-3 text-sm disabled:opacity-60"
                    value={onTimeViewCardForm.area}
                    disabled
                  >
                    {CARD_AREAS.map((a) => (
                      <option key={a.value} value={a.value}>
                        {a.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="metrics-card-tipo">Tipo</Label>
                  <select
                    id="metrics-card-tipo"
                    className="flex h-10 w-full rounded-md border border-[var(--color-input)] bg-[var(--color-background)] px-3 text-sm disabled:opacity-60"
                    value={onTimeViewCardForm.tipo}
                    disabled
                  >
                    {CARD_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="metrics-card-prio">Prioridade</Label>
                  <select
                    id="metrics-card-prio"
                    className="flex h-10 w-full rounded-md border border-[var(--color-input)] bg-[var(--color-background)] px-3 text-sm disabled:opacity-60"
                    value={onTimeViewCardForm.prioridade}
                    disabled
                  >
                    {CARD_PRIORITIES.map((p) => (
                      <option key={p.value} value={p.value}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="metrics-card-status">Status</Label>
                  <select
                    id="metrics-card-status"
                    className="flex h-10 w-full rounded-md border border-[var(--color-input)] bg-[var(--color-background)] px-3 text-sm disabled:opacity-60"
                    value={onTimeViewCardForm.status}
                    disabled
                  >
                    {CARD_STATUSES.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Responsável</Label>
                <UserSelect
                  users={users}
                  value={onTimeViewCardForm.responsavel || ''}
                  onChange={() => {}}
                  disabled
                  placeholder="—"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Início</Label>
                  <DateTimePicker value={onTimeViewCardForm.data_inicio} onChange={() => {}} disabled />
                </div>
                <div className="space-y-2">
                  <Label>Entrega agendada</Label>
                  <DateTimePicker value={onTimeViewCardForm.data_fim} onChange={() => {}} disabled />
                </div>
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setOnTimeViewCardOpen(false);
                    setOnTimeViewSelectedCard(null);
                    setOnTimeViewCardForm({ ...EMPTY_METRICS_CARD_FORM });
                  }}
                >
                  Fechar
                </Button>
                {onTimeViewSelectedCard?.projeto && (
                  <Button
                    type="button"
                    onClick={() => {
                      const projectId = onTimeViewSelectedCard.projeto;
                      setOnTimeViewCardOpen(false);
                      setOnTimeViewSelectedCard(null);
                      setOnTimeViewCardForm({ ...EMPTY_METRICS_CARD_FORM });
                      navigate(ROUTES.projeto(String(projectId)));
                    }}
                  >
                    Ir para o projeto
                  </Button>
                )}
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
      </>
      )}

    </div>
  );
}

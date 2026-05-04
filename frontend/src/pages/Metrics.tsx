import { useEffect, useState, useMemo, useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { BarChart3, Trophy, Flame, Target, Loader2, FolderKanban, ChevronDown, ChevronRight, Search } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Cell } from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import { cardService, type Card as CardType, CARD_TYPES } from '@/services/cardService';
import { sprintService, type Sprint } from '@/services/sprintService';
import { userService, type User } from '@/services/userService';
import { projectService, type Project } from '@/services/projectService';
import { useAuth } from '@/context/AuthContext';

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

function isSpecialProjectName(value?: string | null): boolean {
  const n = normalizeProjectName(value);
  return n === 'suporte' || n === 'sugestoes' || n === 'projetos descartados';
}

/** Quando o card foi de fato entregue (finalizado): finalizado_em ou, em último caso, updated_at. */
function getCardDeliveryDate(card: CardType): Date | null {
  const raw = card.finalizado_em || card.updated_at;
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

export default function Metrics() {
  const { user: authUser } = useAuth();
  const isSupervisor = authUser?.role === 'supervisor' || authUser?.role === 'admin';

  const [cards, setCards] = useState<CardType[]>([]);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

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
    (async () => {
      setLoading(true);
      try {
        const [cardsRes, sprintsRes, usersRes, projectsRes] = await Promise.all([
          cardService.getAll(),
          sprintService.getAll(),
          userService.getAll(),
          projectService.getAll(),
        ]);
        if (!cancelled) {
          setCards(cardsRes);
          setSprints(sprintsRes.sort((a, b) => new Date(b.data_inicio).getTime() - new Date(a.data_inicio).getTime()));
          setUsers(usersRes);
          setProjects(projectsRes);
          if (sprintsRes.length && !leaderboardSprint) setLeaderboardSprint(sprintsRes[0].id);
          if (sprintsRes.length && !onTimeSprint) setOnTimeSprint(sprintsRes[0].id);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const projectToSprint = useMemo(() => {
    const map = new Map<string, Sprint>();
    for (const p of projects) {
      if (isSpecialProjectName(p.nome)) continue;
      const s = sprints.find((sp) => String(sp.id) === String(p.sprint));
      if (s) map.set(String(p.id), s);
    }
    return map;
  }, [projects, sprints]);

  const visibleProjectIds = useMemo(() => {
    return new Set(
      projects
        .filter((p) => !isSpecialProjectName(p.nome))
        .map((p) => String(p.id)),
    );
  }, [projects]);

  const getSprintForCard = (card: CardType): Sprint | null => {
    const fromDetail = card.projeto_detail?.sprint_detail;
    if (fromDetail) {
      return sprints.find((s) => String(s.id) === String(fromDetail.id)) ?? null;
    }
    return projectToSprint.get(String(card.projeto)) ?? null;
  };

  const closedCards = useMemo(() => {
    return cards.filter((c) => {
      if (c.status !== CLOSED_STATUS || !c.data_fim) return false;

      const nameFromDetail = c.projeto_detail?.nome;
      if (nameFromDetail && isSpecialProjectName(nameFromDetail)) return false;

      return visibleProjectIds.has(String(c.projeto));
    });
  }, [cards, visibleProjectIds]);

  const getDayOfSprint = (card: CardType): { sprint: Sprint; day: number } | null => {
    const sprint = getSprintForCard(card);
    if (!sprint || !card.data_fim) return null;
    const start = new Date(sprint.data_inicio).setHours(0, 0, 0, 0);
    const end = new Date(card.data_fim).setHours(0, 0, 0, 0);
    const day = Math.floor((end - start) / (24 * 60 * 60 * 1000)) + 1;
    if (day < 1 || day > sprint.duracao_dias) return null;
    return { sprint, day };
  };

  const cardsPerUserData = useMemo(() => {
    let list = closedCards;
    if (cardsSprintFilter) {
      list = list.filter((c) => getSprintForCard(c)?.id === cardsSprintFilter);
    }
    if (cardsTypeFilter) {
      list = list.filter((c) => c.tipo === cardsTypeFilter);
    }
    const byUser = new Map<string, number>();
    for (const c of list) {
      const uid = c.responsavel ?? 'sem_responsavel';
      byUser.set(uid, (byUser.get(uid) ?? 0) + 1);
    }
    const entriesFromCards = Array.from(byUser.entries()).map(([userId, count]) => {
      const user = users.find((u) => u.id === userId) ?? { id: userId, username: userId, email: '', first_name: '', last_name: '', role: '', role_display: '', profile_picture_url: null as string | null };
      return {
        userId,
        name: userId === 'sem_responsavel' ? 'Sem responsável' : getShortDisplayName(user),
        role: user.role ?? '',
        profile_picture_url: user.profile_picture_url ?? null,
        count,
      };
    });
    const userIdsFromCards = new Set(entriesFromCards.map((e) => e.userId));
    const allUsersWithZero = users
      .filter((u) => !userIdsFromCards.has(u.id))
      .map((u) => ({
        userId: u.id,
        name: getShortDisplayName(u),
        role: u.role ?? '',
        profile_picture_url: u.profile_picture_url ?? null,
        count: 0,
      }));
    const semResponsavel = entriesFromCards.find((e) => e.userId === 'sem_responsavel');
    const withCount = [...entriesFromCards.filter((e) => e.userId !== 'sem_responsavel'), ...allUsersWithZero];
    const result = [...withCount.sort((a, b) => b.count - a.count)];
    if (semResponsavel) result.push(semResponsavel);
    return result;
  }, [closedCards, cardsSprintFilter, cardsTypeFilter, users]);

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
    let list = closedCards.filter((c) => c.responsavel != null && c.responsavel !== '');
    if (leaderboardScope === 'sprint' && leaderboardSprint) {
      list = list.filter((c) => getSprintForCard(c)?.id === leaderboardSprint);
    } else if (leaderboardScope === 'year') {
      list = list.filter((c) => c.data_fim && new Date(c.data_fim).getFullYear() === leaderboardYear);
    } else if (leaderboardScope === 'month') {
      list = list.filter(
        (c) =>
          c.data_fim &&
          new Date(c.data_fim).getFullYear() === leaderboardMonthYear &&
          new Date(c.data_fim).getMonth() + 1 === leaderboardMonth
      );
    } else if (leaderboardScope === 'interval' && leaderboardStartDate && leaderboardEndDate) {
      const start = new Date(leaderboardStartDate).setHours(0, 0, 0, 0);
      const end = new Date(leaderboardEndDate).setHours(23, 59, 59, 999);
      list = list.filter((c) => {
        if (!c.data_fim) return false;
        const t = new Date(c.data_fim).getTime();
        return t >= start && t <= end;
      });
    }
    const byUser = new Map<string, number>();
    for (const c of list) {
      const uid = c.responsavel!;
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
        const user = users.find((u) => u.id === userId);
        return {
          userId,
          name: user ? getShortDisplayName(user) : userId,
          count: byUser.get(userId) ?? 0,
          role: user?.role ?? '',
          profile_picture_url: user?.profile_picture_url ?? null,
        };
      });
    } else if (isAll) {
      result = users.map((user) => ({
        userId: user.id,
        name: getShortDisplayName(user),
        count: byUser.get(user.id) ?? 0,
        role: user.role ?? '',
        profile_picture_url: user.profile_picture_url ?? null,
      }));
    } else {
      result = Array.from(byUser.entries()).map(([userId, count]) => {
        const user = users.find((u) => u.id === userId);
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
  ]);

  const closedCardsForOnTime = useMemo(() => {
    let list = closedCards.filter((c) => c.responsavel != null && c.responsavel !== '');
    if (onTimeScope === 'sprint' && onTimeSprint) {
      const sprintId = String(onTimeSprint);
      list = list.filter((c) => String(getSprintForCard(c)?.id) === sprintId);
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
  ]);

  const onTimeTable = useMemo(() => {
    const byUser = new Map<string, { total: number; onTime: number }>();
    for (const card of closedCardsForOnTime) {
      if (!getSprintForCard(card) || !card.data_fim || !card.responsavel) continue;
      const uid = String(card.responsavel);
      const scheduledEnd = new Date(card.data_fim).getTime();
      const completedAt = card.finalizado_em
        ? new Date(card.finalizado_em).getTime()
        : card.updated_at
          ? new Date(card.updated_at).getTime()
          : scheduledEnd;
      const onTime = completedAt <= scheduledEnd;
      const cur = byUser.get(uid) ?? { total: 0, onTime: 0 };
      cur.total += 1;
      if (onTime) cur.onTime += 1;
      byUser.set(uid, cur);
    }
    const isUsersScopeWithSelection = onTimeScope === 'users' && onTimeScopeUserIds.length > 0;
    const userIdsToShow = isUsersScopeWithSelection
      ? onTimeScopeUserIds
      : Array.from(byUser.keys());
    const rows = userIdsToShow.map((userId) => {
      const uid = String(userId);
      const stats = byUser.get(uid) ?? { total: 0, onTime: 0 };
      const { total, onTime } = stats;
      const late = total - onTime;
      const user = users.find((u) => String(u.id) === uid) ?? users.find((u) => u.id === userId) ?? { id: userId, username: String(userId), email: '', first_name: '', last_name: '', role: '', role_display: '', profile_picture_url: null };
      return {
        userId,
        name: getShortDisplayName(user),
        user,
        total,
        onTime,
        late,
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
      const t =
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

    let longest:
      | {
          project: Project;
          durationDays: number;
          start: string;
          end: string;
        }
      | null = null;

    const cardCounts = new Map<
      string,
      { total: number; delivered: number; inviabilizados: number }
    >();

    for (const card of cards) {
      if (!cardInPeriod(card)) continue;
      const pid = card.projeto;
      const stats =
        cardCounts.get(pid) ?? {
          total: 0,
          delivered: 0,
          inviabilizados: 0,
        };
      stats.total += 1;
      if (card.status === CLOSED_STATUS) stats.delivered += 1;
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
      const startTime =
        toTime(project.data_inicio_desenvolvimento) ??
        toTime(project.data_criacao) ??
        toTime(project.created_at);
      const endTime =
        toTime(project.data_entrega) ??
        toTime(project.data_homologacao) ??
        toTime(project.nova_data_prevista) ??
        toTime(project.updated_at);

      if (!projectOverlapsPeriod(startTime, endTime)) continue;

      if (startTime && endTime && endTime >= startTime) {
        const durationDays = Math.max(
          1,
          Math.round((endTime - startTime) / msPerDay)
        );
        if (!longest || durationDays > longest.durationDays) {
          longest = {
            project,
            durationDays,
            start: new Date(startTime).toISOString().slice(0, 10),
            end: new Date(endTime).toISOString().slice(0, 10),
          };
        }
      }

      const stats = cardCounts.get(project.id);
      if (stats) {
        if (!mostCards || stats.total > mostCards.stats.total) {
          mostCards = { project, stats };
        }
      }
    }

    const byName = new Map<string, { name: string; sprintIds: Set<string> }>();
    for (const project of projects) {
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
          Cards fechados, entrega por sprint e consistência de prazo
        </p>
      </div>

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
            <div className="flex items-center gap-2">
              <label className="text-sm text-[var(--color-foreground)] shrink-0">Sprint</label>
              <select
                className="h-9 rounded-md border border-[var(--color-input)] bg-[var(--color-background)] px-3 text-sm"
                value={cardsSprintFilter}
                onChange={(e) => setCardsSprintFilter(e.target.value)}
              >
                <option value="">Todos</option>
                {sprints.map((s) => (
                  <option key={s.id} value={s.id}>{s.nome}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-sm text-[var(--color-foreground)] shrink-0">Tipo</label>
              <select
                className="h-9 rounded-md border border-[var(--color-input)] bg-[var(--color-background)] px-3 text-sm"
                value={cardsTypeFilter}
                onChange={(e) => setCardsTypeFilter(e.target.value)}
              >
                <option value="">Todos</option>
                {CARD_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="h-[320px]">
            {cardsPerUserData.length ? (
              <ChartContainer config={chartConfigCount} className="h-full w-full">
                <BarChart data={cardsPerUserData} layout="vertical" margin={{ left: 20, right: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis type="number" tickLine={false} axisLine={false} />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={200}
                    tickLine={false}
                    axisLine={false}
                    tick={(props) => {
                      const { x, y, payload } = props;
                      const p = payload as { index?: number; value?: string };
                      const idx = cardsPerUserData.findIndex((r) => r.name === p?.value);
                      const index = p?.index ?? (idx >= 0 ? idx : 0);
                      const row = cardsPerUserData[index];
                      if (!row) return null;
                      return (
                        <g transform={`translate(${x},${y})`}>
                          <foreignObject x={-192} y={-12} width={190} height={24} className="overflow-visible">
                            <div className="flex items-center gap-2 h-6">
                              <Avatar className="h-6 w-6 shrink-0 rounded-full">
                                {row.profile_picture_url ? (
                                  <AvatarImage src={row.profile_picture_url} alt={row.name} />
                                ) : null}
                                <AvatarFallback className="text-[10px] bg-[var(--color-muted)] text-[var(--color-muted-foreground)]">
                                  {row.name.slice(0, 2).toUpperCase() || '?'}
                                </AvatarFallback>
                              </Avatar>
                              <span className="text-xs font-medium text-[var(--color-foreground)] truncate">{row.name}</span>
                            </div>
                          </foreignObject>
                        </g>
                      );
                    }}
                  />
                  <ChartTooltip content={<ChartTooltipContent nameKey="name" />} />
                  <Bar dataKey="count" fill="var(--color-count)" radius={[0, 4, 4, 0]} name="Entregas">
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
            <div className="flex items-center gap-2">
              <label className="text-sm">Escopo:</label>
              <select
                className="h-9 rounded-md border border-[var(--color-input)] bg-[var(--color-background)] px-3 text-sm"
                value={leaderboardScope}
                onChange={(e) => setLeaderboardScope(e.target.value as 'sprint' | 'year' | 'month' | 'interval' | 'users')}
              >
                <option value="sprint">Por sprint</option>
                <option value="year">Por ano</option>
                <option value="month">Por mês</option>
                <option value="interval">Por intervalo</option>
                <option value="users">Por usuários</option>
              </select>
            </div>
            {leaderboardScope === 'sprint' && (
              <select
                className="h-9 rounded-md border border-[var(--color-input)] bg-[var(--color-background)] px-3 text-sm"
                value={leaderboardSprint}
                onChange={(e) => setLeaderboardSprint(e.target.value)}
              >
                {sprints.map((s) => (
                  <option key={s.id} value={s.id}>{s.nome}</option>
                ))}
              </select>
            )}
            {leaderboardScope === 'year' && (
              <select
                className="h-9 rounded-md border border-[var(--color-input)] bg-[var(--color-background)] px-3 text-sm"
                value={leaderboardYear}
                onChange={(e) => setLeaderboardYear(Number(e.target.value))}
              >
                {years.map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            )}
            {leaderboardScope === 'month' && (
              <>
                <select
                  className="h-9 rounded-md border border-[var(--color-input)] bg-[var(--color-background)] px-3 text-sm"
                  value={leaderboardMonth}
                  onChange={(e) => setLeaderboardMonth(Number(e.target.value))}
                >
                  {MONTH_NAMES.map((label, i) => (
                    <option key={i} value={i + 1}>{label}</option>
                  ))}
                </select>
                <select
                  className="h-9 rounded-md border border-[var(--color-input)] bg-[var(--color-background)] px-3 text-sm"
                  value={leaderboardMonthYear}
                  onChange={(e) => setLeaderboardMonthYear(Number(e.target.value))}
                >
                  {years.map((y) => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
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
              <div className="flex items-center gap-2">
                <label className="text-sm">Exibir:</label>
                <select
                  className="h-9 rounded-md border border-[var(--color-input)] bg-[var(--color-background)] px-3 text-sm"
                  value={leaderboardLimit}
                  onChange={(e) => setLeaderboardLimit(e.target.value as 'top5' | 'top3' | 'all')}
                >
                  <option value="top5">Top 5</option>
                  <option value="top3">Top 3</option>
                  <option value="all">Todos os usuários</option>
                </select>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="h-[280px]">
            {leaderboardData.length ? (
              <ChartContainer config={chartConfigCount} className="h-full w-full">
                <BarChart data={leaderboardData} layout="vertical" margin={{ left: 20, right: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis type="number" tickLine={false} axisLine={false} />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={200}
                    tickLine={false}
                    axisLine={false}
                    tick={(props) => {
                      const { x, y, payload } = props;
                      const p = payload as { index?: number; value?: string };
                      const idx = leaderboardData.findIndex((r) => r.name === p?.value);
                      const index = p?.index ?? (idx >= 0 ? idx : 0);
                      const row = leaderboardData[index];
                      if (!row) return null;
                      const position = index + 1;
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
                          <foreignObject x={-192} y={-12} width={190} height={24} className="overflow-visible">
                            <div className="flex items-center gap-2 h-6">
                              <Avatar className={`h-6 w-6 shrink-0 rounded-full ${medalFrame}`}>
                                {row.profile_picture_url ? (
                                  <AvatarImage src={row.profile_picture_url} alt={row.name} />
                                ) : null}
                                <AvatarFallback className="text-[10px] bg-[var(--color-muted)] text-[var(--color-muted-foreground)]">
                                  {row.name.slice(0, 2).toUpperCase() || '?'}
                                </AvatarFallback>
                              </Avatar>
                              <span className="text-xs font-medium text-[var(--color-foreground)] truncate">{row.name}</span>
                            </div>
                          </foreignObject>
                        </g>
                      );
                    }}
                  />
                  <ChartTooltip content={<ChartTooltipContent nameKey="name" />} />
                  <Bar dataKey="count" fill="var(--color-count)" radius={[0, 4, 4, 0]} name="Entregas">
                    {leaderboardData.map((row, i) => (
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
                Percentual de cards concluídos até a data e hora de entrega agendadas no card (campo de fim). A entrega real usa o instante em que o card passou a finalizado pela última vez. Meta: 80% para permanecer na gincana.
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-4 pt-2">
              <div className="flex items-center gap-2">
                <label className="text-sm">Escopo:</label>
                <select
                  className="h-9 rounded-md border border-[var(--color-input)] bg-[var(--color-background)] px-3 text-sm"
                  value={onTimeScope}
                  onChange={(e) => setOnTimeScope(e.target.value as 'sprint' | 'year' | 'month' | 'interval' | 'users')}
                >
                  <option value="sprint">Por sprint</option>
                  <option value="year">Por ano</option>
                  <option value="month">Por mês</option>
                  <option value="interval">Por intervalo</option>
                  <option value="users">Por usuários</option>
                </select>
              </div>
              {onTimeScope === 'sprint' && (
                <select
                  className="h-9 rounded-md border border-[var(--color-input)] bg-[var(--color-background)] px-3 text-sm"
                  value={onTimeSprint}
                  onChange={(e) => setOnTimeSprint(e.target.value)}
                >
                  {sprints.map((s) => (
                    <option key={s.id} value={s.id}>{s.nome}</option>
                  ))}
                </select>
              )}
              {onTimeScope === 'year' && (
                <select
                  className="h-9 rounded-md border border-[var(--color-input)] bg-[var(--color-background)] px-3 text-sm"
                  value={onTimeYear}
                  onChange={(e) => setOnTimeYear(Number(e.target.value))}
                >
                  {years.map((y) => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
              )}
              {onTimeScope === 'month' && (
                <>
                  <select
                    className="h-9 rounded-md border border-[var(--color-input)] bg-[var(--color-background)] px-3 text-sm"
                    value={onTimeMonth}
                    onChange={(e) => setOnTimeMonth(Number(e.target.value))}
                  >
                    {MONTH_NAMES.map((label, i) => (
                      <option key={i} value={i + 1}>{label}</option>
                    ))}
                  </select>
                  <select
                    className="h-9 rounded-md border border-[var(--color-input)] bg-[var(--color-background)] px-3 text-sm"
                    value={onTimeMonthYear}
                    onChange={(e) => setOnTimeMonthYear(Number(e.target.value))}
                  >
                    {years.map((y) => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
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
                  const rowBg = row.total === 0
                    ? 'bg-[var(--color-muted)]/25'
                    : row.late > 0 ? 'bg-[#fca5a540]' : 'bg-[#86efac40]';
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
                      className={`${rowBg} border-b border-[var(--color-border)]`}
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
            <div className="flex items-center gap-2">
              <label className="text-sm">Filtrar por:</label>
              <select
                className="h-9 rounded-md border border-[var(--color-input)] bg-[var(--color-background)] px-3 text-sm"
                value={projectMetricsFilter}
                onChange={(e) =>
                  setProjectMetricsFilter(e.target.value as 'year' | 'interval')
                }
              >
                <option value="year">Por ano</option>
                <option value="interval">Por período</option>
              </select>
            </div>
            {projectMetricsFilter === 'year' && (
              <select
                className="h-9 rounded-md border border-[var(--color-input)] bg-[var(--color-background)] px-3 text-sm"
                value={projectMetricsYear}
                onChange={(e) => setProjectMetricsYear(Number(e.target.value))}
              >
                {projectYears.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
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
                    <div className="text-sm space-y-0.5">
                      <p className="font-semibold text-[var(--color-foreground)]">
                        {projectStats.longest.project.nome}
                      </p>
                      <p className="text-[var(--color-muted-foreground)]">
                        {projectStats.longest.durationDays} dias ({projectStats.longest.start} →{' '}
                        {projectStats.longest.end})
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
                    <div className="text-sm space-y-0.5">
                      <p className="font-semibold text-[var(--color-foreground)]">
                        {projectStats.mostCards.project.nome}
                      </p>
                      <p className="text-[var(--color-muted-foreground)]">
                        Total: {projectStats.mostCards.stats.total} • Entregues:{' '}
                        {projectStats.mostCards.stats.delivered} • Inviabilizados:{' '}
                        {projectStats.mostCards.stats.inviabilizados}
                      </p>
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
                    <div className="text-sm space-y-0.5">
                      <p className="font-semibold text-[var(--color-foreground)]">
                        {projectStats.recurrent.name}
                      </p>
                      <p className="text-[var(--color-muted-foreground)]">
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

    </div>
  );
}

import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { useSprintKanbanWebSocket } from '@/hooks/useSprintKanbanWebSocket';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { DateInput } from '@/components/ui/date-input';
import { DateTimePicker } from '@/components/ui/datetime-picker';
import { Textarea } from '@/components/ui/textarea';
import { UserSelect } from '@/components/ui/user-select';
import { RequestDueDateChangeModal } from '@/components/RequestDueDateChangeModal';
import { SprintPeriodHelpNote } from '@/components/SprintPeriodHelpNote';
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
import { sprintService } from '@/services/sprintService';
import { projectService } from '@/services/projectService';
import { cardService, CARD_AREAS, CARD_TYPES, CARD_PRIORITIES, CARD_STATUSES } from '@/services/cardService';
import { userService } from '@/services/userService';
import { cardLogService } from '@/services/cardLogService';
import { cardTodoService } from '@/services/cardTodoService';
import { getTodosByArea } from '@/constants/cardTodos';
import { CardLogsModal, CARD_TIMELINE_LAYOUT_RESERVE_PX } from '@/components/CardLogsModal';
import type { Sprint } from '@/services/sprintService';
import type { Project } from '@/services/projectService';
import type { Card as CardType, CardLink } from '@/services/cardService';
import type { User as UserType } from '@/services/userService';
import { ROUTES } from '@/routes';
import {
  Plus,
  Calendar,
  Clock,
  FolderKanban,
  Loader2,
  Pencil,
  Trash2,
  Zap,
  Users,
  ArrowLeft,
  User,
  LayoutGrid,
  Settings,
  AlertCircle,
  CheckCircle2,
  Circle,
  XCircle,
  ExternalLink,
  Search,
  SlidersHorizontal,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  ChevronDown,
  ChevronUp,
  Lock,
  List,
  Check,
  Columns3,
  FileSpreadsheet,
  Download,
  Filter,
} from 'lucide-react';
import { calcularDiasTotais, calcularDiasUteis, formatDate, formatDateTime } from '@/lib/dateUtils';
import { ATRASADO_STATUS_BADGE } from '@/lib/dueDateBadgeClasses';
import {
  fechamentoIsoToDatetimeLocal,
  datetimeLocalToFechamentoIso,
  isSprintPastFechamento,
  sprintFimDiaParaCalendario,
  sprintInicioDiaParaCalendario,
} from '@/lib/sprintFechamento';
import {
  getColumnDefsByGroup,
  SPRINT_CARDS_COLUMN_DEFS,
  SPRINT_CARDS_COLUMN_IDS,
  type ColumnGroup,
  formatColumnValueForDisplay,
} from '@/lib/sprintCardsColumns';
import { exportCardsToCSV, exportCardsToXLSX } from '@/lib/exportCards';
import {
  getPriorityLabel,
  getPriorityStyle,
  kanbanCardInkTextClass,
  getKanbanAreaBadgeClasses,
  kanbanMutedChipOnPastelClass,
  kanbanScriptLinkOnPastelClass,
} from '@/lib/priorityColors';
import { cn, normalizeExternalUrl } from '@/lib/utils';
import {
  readShowPriorityColorsOnKanbanCards,
  SHOW_PRIORITY_COLORS_ON_KANBAN_CARDS_KEY,
} from '@/lib/kanbanCardDisplayPreference';

type CardSortField = 'nome' | 'created_at' | 'responsavel_name' | 'prioridade' | 'status' | 'area' | 'tipo';
type CardSortDirection = 'asc' | 'desc';

type ProjectStageConfig = {
  id: string;
  label: string;
  is_terminal: boolean;
  requires_required_data: boolean;
};

const DEFAULT_SPRINT_STAGE_CONFIGS: ProjectStageConfig[] = [
  { id: 'a_desenvolver', label: 'A Desenvolver', is_terminal: false, requires_required_data: false },
  { id: 'em_desenvolvimento', label: 'Em Desenvolvimento', is_terminal: false, requires_required_data: true },
  { id: 'parado_pendencias', label: 'Parado por Pendências', is_terminal: false, requires_required_data: true },
  { id: 'em_homologacao', label: 'Em Homologação', is_terminal: false, requires_required_data: true },
  { id: 'finalizado', label: 'Finalizado', is_terminal: true, requires_required_data: true },
  { id: 'inviabilizado', label: 'Inviabilizado', is_terminal: true, requires_required_data: false },
];

/** Chars do maior rótulo do filtro de status + margem para ícone funil, seta e padding */
const STATUS_FILTER_TRIGGER_CH =
  Math.max('Todos os status'.length, ...CARD_STATUSES.map((s) => s.label.length)) + 11;

// Nome exibido para usuários: Primeiro nome + primeiro sobrenome
const getShortDisplayName = (user: UserType): string => {
  const firstRaw = user.first_name?.trim() ?? '';
  const lastRaw = user.last_name?.trim() ?? '';

  const firstParts = firstRaw.split(/\s+/).filter(Boolean);
  const lastParts = lastRaw.split(/\s+/).filter(Boolean);

  const firstName = firstParts[0] ?? '';
  const firstSurname = lastParts[0] ?? (firstParts.length > 1 ? firstParts[1] : '');

  const name = `${firstName} ${firstSurname}`.trim();
  return name || user.username || '';
};

export default function SprintDetails() {
  const { sprintId, cardId } = useParams<{ sprintId: string; cardId?: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [sprint, setSprint] = useState<Sprint | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [cards, setCards] = useState<CardType[]>([]);

  // Real-time: outros usuários movendo cards aparecem aqui sem F5.
  // Backend só dispara broadcast se a sprint estiver em andamento.
  const handleCardMovedRealtime = useCallback(
    (evt: { card_id: number; new_status: string; actor_user_id: number | null }) => {
      // Anti-eco: se foi o próprio usuário que moveu, já atualizou via PATCH
      if (user?.id !== undefined && String(evt.actor_user_id) === String(user.id)) return;
      setCards((prev) =>
        prev.map((c) =>
          String(c.id) === String(evt.card_id) ? { ...c, status: evt.new_status as CardType['status'] } : c
        )
      );
    },
    [user?.id]
  );

  useSprintKanbanWebSocket({
    sprintId: sprint?.id ?? sprintId ?? null,
    enabled: !!(sprint?.id ?? sprintId),
    onCardMoved: handleCardMovedRealtime,
  });
  const [projectKanbanStagesByProjectId, setProjectKanbanStagesByProjectId] = useState<
    Record<string, ProjectStageConfig[]>
  >({});
  const [users, setUsers] = useState<UserType[]>([]);
  const [loading, setLoading] = useState(true);

  const [viewMode, setViewMode] = useState<'kanban' | 'lista'>('kanban');
  const [showPriorityColorsOnCards, setShowPriorityColorsOnCards] = useState(readShowPriorityColorsOnKanbanCards);
  const [selectedColumnIds, setSelectedColumnIds] = useState<string[]>(SPRINT_CARDS_COLUMN_IDS);
  const [columnsDialogOpen, setColumnsDialogOpen] = useState(false);
  /** Lista: colunas com células expandidas (texto completo) */
  const [listExpandedColumnIds, setListExpandedColumnIds] = useState<Set<string>>(() => new Set());
  /** Lista: como no Excel — mostrar conteúdo completo em todas as colunas */
  const [listExpandAllColumns, setListExpandAllColumns] = useState(false);
  const listHeaderClickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // Search and filter state for cards
  const [cardSearchQuery, setCardSearchQuery] = useState('');
  const [cardSortField, setCardSortField] = useState<CardSortField>('created_at');
  const [cardSortDirection, setCardSortDirection] = useState<CardSortDirection>('desc');
  const [showCardFilters, setShowCardFilters] = useState(false);

  // Filter state for projects
  const [projectStatusFilter, setProjectStatusFilter] = useState<string>('');
  const [projectDeveloperFilter, setProjectDeveloperFilter] = useState<string>('');

  // Project dialog state
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [projectFormLoading, setProjectFormLoading] = useState(false);
  const [projectFormError, setProjectFormError] = useState('');
  const [projectFormData, setProjectFormData] = useState({
    nome: '',
    descricao: '',
  });

  // Card dialog state
  /** Evita aplicar estado de aberturas concorrentes (clique + useEffect do deep link). */
  const openCardGenerationRef = useRef(0);
  /** Enquanto true, não abrir pelo deep link até a URL perder /card/:id. */
  const suppressCardDeepLinkRef = useRef(false);
  const cardSubmitInFlightRef = useRef(false);
  const [cardDialogOpen, setCardDialogOpen] = useState(false);
  const [logsModalOpen, setLogsModalOpen] = useState(false);
  const [logsRefreshTrigger, setLogsRefreshTrigger] = useState(0);
  const [editingCard, setEditingCard] = useState<CardType | null>(null);
  const [cardFormLoading, setCardFormLoading] = useState(false);
  const [cardFormError, setCardFormError] = useState('');
  const [dueDateRequestOpen, setDueDateRequestOpen] = useState(false);
  const [selectedProjectForCard, setSelectedProjectForCard] = useState<string | null>(null);
  const [cardFormData, setCardFormData] = useState({
    nome: '',
    descricao: '',
    script_url: '',
    area: '',
    tipo: 'feature',
    prioridade: 'media',
    status: 'a_desenvolver',
    responsavel: '',
    data_inicio: '',
    data_fim: '',
  });
  const [cardLinks, setCardLinks] = useState<CardLink[]>([]);
  const [newLinkUrl, setNewLinkUrl] = useState('');
  const [newLinkLabel, setNewLinkLabel] = useState('');

  const handleAddCardLink = () => {
    if (!newLinkUrl.trim()) return;
    setCardLinks((prev) => [...prev, { url: newLinkUrl.trim(), label: newLinkLabel.trim() }]);
    setNewLinkUrl('');
    setNewLinkLabel('');
  };
  const handleRemoveCardLink = (idx: number) => {
    setCardLinks((prev) => prev.filter((_, i) => i !== idx));
  };

  // Estado para o calculador de tempo
  const [showTimeEstimator, setShowTimeEstimator] = useState(false);
  const [selectedTimeItems, setSelectedTimeItems] = useState<Set<string>>(new Set());
  const [selectedDevelopment, setSelectedDevelopment] = useState<string | null>(null); // Apenas uma opção de desenvolvimento
  const [timeEstimates, setTimeEstimates] = useState<Array<{ id: string; label: string; hours: number; isDevelopment?: boolean }>>([
    { id: 'ler_script', label: 'Ler Script E Conferir Informações Do Video', hours: 1 },
    { id: 'solicitar_usuario', label: 'Solicitar Criação De Usuário / Vm', hours: 1 },
    { id: 'testes_iniciais', label: 'Testes Iniciais Na Maquina', hours: 3 },
    { id: 'configurar_projeto', label: 'Configurar Projeto Na Vm', hours: 1 },
    { id: 'desenvolvimento_basico', label: 'Desenvolvimento Básico', hours: 8, isDevelopment: true },
    { id: 'desenvolvimento_medio', label: 'Desenvolvimento Médio', hours: 24, isDevelopment: true },
    { id: 'desenvolvimento_dificil', label: 'Desenvolvimento Difícil', hours: 40, isDevelopment: true },
  ]);
  const [customTimeItems, setCustomTimeItems] = useState<Array<{ id: string; label: string; hours: number }>>([]);
  const [customTimeLabel, setCustomTimeLabel] = useState('');
  const [customTimeHours, setCustomTimeHours] = useState('');
  const [editingTimeItemId, setEditingTimeItemId] = useState<string | null>(null);
  const [editTimeValue, setEditTimeValue] = useState('');

  // Calcular tempo total
  const calculateTotalTime = () => {
    let total = 0;
    selectedTimeItems.forEach((itemId) => {
      const item = timeEstimates.find((t) => t.id === itemId);
      if (item) {
        total += item.hours;
      } else {
        const customItem = customTimeItems.find((c) => c.id === itemId);
        if (customItem) {
          total += customItem.hours;
        }
      }
    });
    // Adicionar desenvolvimento selecionado
    if (selectedDevelopment) {
      const devItem = timeEstimates.find((t) => t.id === selectedDevelopment);
      if (devItem) {
        total += devItem.hours;
      }
    }
    return total;
  };

  const toggleTimeItem = (itemId: string) => {
    const item = timeEstimates.find((t) => t.id === itemId);
    
    // Se for uma opção de desenvolvimento, garantir que apenas uma seja selecionada
    if (item?.isDevelopment) {
      if (selectedDevelopment === itemId) {
        setSelectedDevelopment(null);
      } else {
        setSelectedDevelopment(itemId);
      }
      return;
    }

    // Para outras opções, permitir múltipla seleção
    const newSet = new Set(selectedTimeItems);
    if (newSet.has(itemId)) {
      newSet.delete(itemId);
    } else {
      newSet.add(itemId);
    }
    setSelectedTimeItems(newSet);
  };

  const startEditingTime = (itemId: string, currentHours: number) => {
    setEditingTimeItemId(itemId);
    setEditTimeValue(currentHours.toString());
  };

  const saveEditedTime = (itemId: string) => {
    if (editTimeValue) {
      const hoursNum = parseInt(editTimeValue);
      if (hoursNum > 0) {
        const item = timeEstimates.find((t) => t.id === itemId);
        if (item) {
          setTimeEstimates(timeEstimates.map((i) =>
            i.id === itemId ? { ...i, hours: hoursNum } : i
          ));
        } else {
          setCustomTimeItems(customTimeItems.map((i) =>
            i.id === itemId ? { ...i, hours: hoursNum } : i
          ));
        }
        setEditingTimeItemId(null);
        setEditTimeValue('');
      }
    }
  };

  const cancelEditingTime = () => {
    setEditingTimeItemId(null);
    setEditTimeValue('');
  };

  const addCustomTime = () => {
    if (customTimeLabel && customTimeHours) {
      const hoursNum = parseInt(customTimeHours);
      if (hoursNum > 0) {
        const customId = `custom_${Date.now()}`;
        const newCustomItem = { id: customId, label: customTimeLabel, hours: hoursNum };
        setCustomTimeItems([...customTimeItems, newCustomItem]);
        const newSet = new Set(selectedTimeItems);
        newSet.add(customId);
        setSelectedTimeItems(newSet);
        setCustomTimeLabel('');
        setCustomTimeHours('');
      }
    }
  };

  const removeCustomTime = (itemId: string) => {
    setCustomTimeItems(customTimeItems.filter((item) => item.id !== itemId));
    const newSet = new Set(selectedTimeItems);
    newSet.delete(itemId);
    setSelectedTimeItems(newSet);
  };


  // Sprint dialog state
  const [sprintDialogOpen, setSprintDialogOpen] = useState(false);
  
  // Delete confirmation dialogs
  const [deleteProjectDialogOpen, setDeleteProjectDialogOpen] = useState(false);
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null);
  const [deleteProjectLoading, setDeleteProjectLoading] = useState(false);
  
  const [deleteCardDialogOpen, setDeleteCardDialogOpen] = useState(false);
  const [cardToDelete, setCardToDelete] = useState<CardType | null>(null);
  const [deleteCardLoading, setDeleteCardLoading] = useState(false);
  
  const [deleteSprintDialogOpen, setDeleteSprintDialogOpen] = useState(false);
  const [deleteSprintLoading, setDeleteSprintLoading] = useState(false);

  // Finalizar sprint dialog
  const [finalizarDialogOpen, setFinalizarDialogOpen] = useState(false);
  const [finalizarLoading, setFinalizarLoading] = useState(false);
  const [finalizarError, setFinalizarError] = useState('');
  
  // Alert dialog
  const [alertDialogOpen, setAlertDialogOpen] = useState(false);
  const [alertMessage, setAlertMessage] = useState('');
  const [sprintFormLoading, setSprintFormLoading] = useState(false);
  const [sprintFormError, setSprintFormError] = useState('');
  const [sprintFormData, setSprintFormData] = useState({
    nome: '',
    data_inicio: '',
    fechamento_em: '',
  });

  const canCreate = user?.role === 'supervisor' || user?.role === 'admin';
  const canFinalizar = user?.role === 'supervisor' || user?.role === 'admin';
  const canCreateCard = true;

  useEffect(() => {
    if (sprintId) {
      // Persistência das colunas selecionadas na visualização em Lista
      try {
        const storageKey = `bwa_sprint_list_columns_v1:${sprintId}`;
        const raw = window.localStorage.getItem(storageKey);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            const allowed = new Set(SPRINT_CARDS_COLUMN_IDS);
            const normalized = parsed.map(String).filter((id) => allowed.has(id));
            setSelectedColumnIds(normalized.length ? normalized : SPRINT_CARDS_COLUMN_IDS);
          }
        } else {
          setSelectedColumnIds(SPRINT_CARDS_COLUMN_IDS);
        }
      } catch {
        setSelectedColumnIds(SPRINT_CARDS_COLUMN_IDS);
      }
      setCards([]);
      void loadData();
    }
  }, [sprintId]);

  useEffect(() => {
    if (!sprintId) return;
    try {
      const storageKey = `bwa_sprint_list_columns_v1:${sprintId}`;
      window.localStorage.setItem(storageKey, JSON.stringify(selectedColumnIds));
    } catch {
      // Ignore se localStorage estiver indisponível
    }
  }, [selectedColumnIds, sprintId]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        SHOW_PRIORITY_COLORS_ON_KANBAN_CARDS_KEY,
        showPriorityColorsOnCards ? 'true' : 'false',
      );
    } catch {
      // Ignore se localStorage estiver indisponível
    }
  }, [showPriorityColorsOnCards]);

  const loadData = async () => {
    if (!sprintId) return;
    setLoading(true);
    try {
      const [sprintData, sprintProjects, usersData] = await Promise.all([
        sprintService.getById(sprintId),
        projectService.getBySprint(sprintId),
        userService.getAll(),
      ]);

      setSprint(sprintData);
      setProjects(sprintProjects);
      setUsers(usersData);

      // Buscar cards apenas dos projetos da sprint (evita carregar o sistema inteiro)
      const cardsPerProject = await Promise.all(
        sprintProjects.map((p) => cardService.getByProject(String(p.id)).catch(() => [])),
      );
      const cardsData = cardsPerProject.flat();
      setCards(cardsData);

      // Carregar configurações de Kanban por projeto (para respeitar etapas configuradas)
      try {
        const configs = await Promise.all(
          sprintProjects.map(async (p) => {
            try {
              const cfg = await projectService.getKanbanConfig(p.id);
              const apiStages = cfg?.stages;
              if (Array.isArray(apiStages) && apiStages.length) {
                const normalized: ProjectStageConfig[] = apiStages.map((s: any) => ({
                  id: s.key,
                  label: s.label,
                  is_terminal: !!s.is_terminal,
                  requires_required_data: !!s.requires_required_data,
                }));
                return { projectId: p.id, stages: normalized };
              }
            } catch (e) {
              // fallback individual
            }
            return { projectId: p.id, stages: DEFAULT_SPRINT_STAGE_CONFIGS };
          }),
        );

        const map: Record<string, ProjectStageConfig[]> = {};
        configs.forEach((c) => {
          map[String(c.projectId)] = c.stages;
        });
        setProjectKanbanStagesByProjectId(map);
      } catch (e) {
        setProjectKanbanStagesByProjectId({});
      }

      // Initialize sprint form data if editing
      setSprintFormData({
        nome: sprintData.nome,
        data_inicio: fechamentoIsoToDatetimeLocal(sprintData.data_inicio),
        fechamento_em: fechamentoIsoToDatetimeLocal(sprintData.fechamento_em),
      });

    } catch (error) {
      console.error('Erro ao carregar dados da sprint:', error);
      setSprint(null);
    } finally {
      setLoading(false);
    }
  };

  const getProjectsForSprint = (sprintId: string) => {
    return projects.filter((p) => {
      const projectSprintId = String(p.sprint || '');
      const targetSprintId = String(sprintId || sprint?.id || '');
      return projectSprintId === targetSprintId;
    });
  };

  const getCardsForProject = (projectId: string | number) => {
    // Garantir comparação correta de IDs (convertendo ambos para string)
    // O backend pode retornar IDs como números, então precisamos normalizar
    const normalizedProjectId = String(projectId || '').trim();
    return cards.filter((c) => {
      const cardProjeto = String(c.projeto || '').trim();
      return cardProjeto === normalizedProjectId;
    });
  };

  // Debug: Verificar projetos da sprint
  useEffect(() => {
    if (sprint && projects.length > 0 && cards.length > 0) {
      const certidoesProject = projects.find(p => 
        (p.nome.toLowerCase().includes('certidões') || p.nome.toLowerCase().includes('certidoes')) &&
        String(p.sprint || '') === String(sprint.id || '')
      );
      const portalbwaProject = projects.find(p => 
        p.nome.toLowerCase().includes('portalbwa') &&
        String(p.sprint || '') === String(sprint.id || '')
      );
      
      if (certidoesProject) {
        const projectCards = getCardsForProject(certidoesProject.id);
        const filteredCards = getFilteredAndSortedCards(projectCards);
        const cardsByStatus = projectCards.reduce((acc, card) => {
          acc[card.status] = (acc[card.status] || 0) + 1;
          return acc;
        }, {} as Record<string, number>);
        const filteredCardsByStatus = filteredCards.reduce((acc, card) => {
          acc[card.status] = (acc[card.status] || 0) + 1;
          return acc;
        }, {} as Record<string, number>);
        
        // Identificar quais cards foram filtrados
        const hiddenCards = projectCards.filter(card => 
          !filteredCards.some(fc => fc.id === card.id)
        );
        
        // Verificar todos os cards para ver quais têm projeto 12
        const cardsWithProject12 = cards.filter(c => {
          const cardProjeto = String(c.projeto || '').trim();
          const projectId = String(certidoesProject.id || '').trim();
          return cardProjeto === projectId;
        });
        
        // Verificar cards que podem ter projeto como número
        const cardsWithProject12Number = cards.filter(c => {
          return Number(c.projeto) === Number(certidoesProject.id);
        });
        
        console.log('Projeto Certidões - Debug Completo:', {
          projectId: certidoesProject.id,
          projectIdType: typeof certidoesProject.id,
          projectName: certidoesProject.nome,
          sprintId: certidoesProject.sprint,
          sprintIdType: typeof certidoesProject.sprint,
          currentSprintId: sprint.id,
          currentSprintIdType: typeof sprint.id,
          allCards: cards.length,
          projectCards: projectCards.length,
          cardsWithProject12: cardsWithProject12.length,
          cardsWithProject12Number: cardsWithProject12Number.length,
          filteredCards: filteredCards.length,
          hiddenCards: hiddenCards.length,
          cardsByStatus: cardsByStatus,
          filteredCardsByStatus: filteredCardsByStatus,
          activeFilters: {
            cardSearchQuery: cardSearchQuery,
            projectStatusFilter: projectStatusFilter,
            projectDeveloperFilter: projectDeveloperFilter
          },
          // Mostrar todos os cards e seus projetos para debug
          allCardsWithProjects: cards.map(c => ({
            id: c.id,
            nome: c.nome,
            projeto: c.projeto,
            projetoType: typeof c.projeto,
            projetoString: String(c.projeto || ''),
            matchesProject12: String(c.projeto || '').trim() === String(certidoesProject.id || '').trim(),
            matchesProject12Number: Number(c.projeto) === Number(certidoesProject.id)
          })),
          hiddenCardsDetails: hiddenCards.map(c => ({ 
            id: c.id, 
            nome: c.nome, 
            status: c.status,
            projeto: c.projeto,
            responsavel: c.responsavel,
            responsavel_name: c.responsavel_name,
            area_display: c.area_display,
            tipo_display: c.tipo_display,
            descricao: c.descricao?.substring(0, 50)
          })),
          allCardsList: projectCards.map(c => ({ 
            id: c.id, 
            nome: c.nome, 
            status: c.status,
            projeto: c.projeto,
            projetoType: typeof c.projeto,
            isFiltered: filteredCards.some(fc => fc.id === c.id)
          }))
        });
      }
      
      if (portalbwaProject) {
        const projectCards = getCardsForProject(portalbwaProject.id);
        const filteredCards = getFilteredAndSortedCards(projectCards);
        const cardsByStatus = projectCards.reduce((acc, card) => {
          acc[card.status] = (acc[card.status] || 0) + 1;
          return acc;
        }, {} as Record<string, number>);
        const filteredCardsByStatus = filteredCards.reduce((acc, card) => {
          acc[card.status] = (acc[card.status] || 0) + 1;
          return acc;
        }, {} as Record<string, number>);
        
        // Identificar quais cards foram filtrados
        const hiddenCards = projectCards.filter(card => 
          !filteredCards.some(fc => fc.id === card.id)
        );
        
        // Verificar todos os cards para ver quais têm projeto 13
        const cardsWithProject13 = cards.filter(c => {
          const cardProjeto = String(c.projeto || '').trim();
          const projectId = String(portalbwaProject.id || '').trim();
          return cardProjeto === projectId;
        });
        
        // Verificar cards que podem ter projeto como número
        const cardsWithProject13Number = cards.filter(c => {
          return Number(c.projeto) === Number(portalbwaProject.id);
        });
        
        console.log('Projeto PortalBWA - Debug Completo:', {
          projectId: portalbwaProject.id,
          projectIdType: typeof portalbwaProject.id,
          projectName: portalbwaProject.nome,
          allCards: cards.length,
          projectCards: projectCards.length,
          cardsWithProject13: cardsWithProject13.length,
          cardsWithProject13Number: cardsWithProject13Number.length,
          filteredCards: filteredCards.length,
          hiddenCards: hiddenCards.length,
          cardsByStatus: cardsByStatus,
          filteredCardsByStatus: filteredCardsByStatus,
          activeFilters: {
            cardSearchQuery: cardSearchQuery,
            projectStatusFilter: projectStatusFilter,
            projectDeveloperFilter: projectDeveloperFilter
          },
          // Mostrar todos os cards e seus projetos para debug
          allCardsWithProjects: cards.map(c => ({
            id: c.id,
            nome: c.nome,
            projeto: c.projeto,
            projetoType: typeof c.projeto,
            projetoString: String(c.projeto || ''),
            matchesProject13: String(c.projeto || '').trim() === String(portalbwaProject.id || '').trim(),
            matchesProject13Number: Number(c.projeto) === Number(portalbwaProject.id)
          })),
          hiddenCardsDetails: hiddenCards.map(c => ({ 
            id: c.id, 
            nome: c.nome, 
            status: c.status,
            projeto: c.projeto,
            responsavel: c.responsavel,
            responsavel_name: c.responsavel_name,
            area_display: c.area_display,
            tipo_display: c.tipo_display,
            descricao: c.descricao?.substring(0, 50)
          })),
          allCardsList: projectCards.map(c => ({ 
            id: c.id, 
            nome: c.nome, 
            status: c.status,
            projeto: c.projeto,
            projetoType: typeof c.projeto,
            isFiltered: filteredCards.some(fc => fc.id === c.id)
          }))
        });
      }
    }
  }, [sprint, projects, cards, cardSearchQuery, projectStatusFilter, projectDeveloperFilter]);

  // Atualizar data sugerida quando a estimativa de complexidade mudar
  useEffect(() => {
    if (cardFormData.status === 'em_desenvolvimento' && !cardFormData.data_fim) {
      // Calcular total de horas
      let total = 0;
      selectedTimeItems.forEach((itemId) => {
        const item = timeEstimates.find((t) => t.id === itemId);
        if (item) {
          total += item.hours;
        } else {
          const customItem = customTimeItems.find((c) => c.id === itemId);
          if (customItem) {
            total += customItem.hours;
          }
        }
      });
      if (selectedDevelopment) {
        const devItem = timeEstimates.find((t) => t.id === selectedDevelopment);
        if (devItem) {
          total += devItem.hours;
        }
      }
      
      if (total > 0) {
        const suggestedDate = calculateSuggestedEndDate(total);
        if (suggestedDate) {
          setCardFormData(prev => ({ ...prev, data_fim: suggestedDate }));
        }
      }
    }
  }, [selectedTimeItems, selectedDevelopment, customTimeItems, cardFormData.status, timeEstimates]);

  // Card filter and sort functions
  const getFilteredAndSortedCards = (projectCards: CardType[]) => {
    let filtered = [...projectCards];

    // Search filter
    if (cardSearchQuery.trim()) {
      const query = cardSearchQuery.toLowerCase();
      filtered = filtered.filter(
        (card) => {
          return (
            card.nome.toLowerCase().includes(query) ||
            (card.descricao && card.descricao.toLowerCase().includes(query)) ||
            (card.responsavel_name && card.responsavel_name.toLowerCase().includes(query)) ||
            (card.area_display && card.area_display.toLowerCase().includes(query)) ||
            (card.tipo_display && card.tipo_display.toLowerCase().includes(query))
          );
        }
      );
    }

    // Filter by status
    if (projectStatusFilter) {
      filtered = filtered.filter((card) => card.status === projectStatusFilter);
    }

    // Filter by developer/responsável
    if (projectDeveloperFilter) {
      filtered = filtered.filter(
        (card) => card.responsavel?.toString() === projectDeveloperFilter
      );
    }

    // Sort
    filtered.sort((a, b) => {
      let comparison = 0;

      switch (cardSortField) {
        case 'nome':
          comparison = a.nome.localeCompare(b.nome);
          break;
        case 'created_at':
          comparison = new Date(a.created_at || '').getTime() - new Date(b.created_at || '').getTime();
          break;
        case 'responsavel_name':
          comparison = (a.responsavel_name || '').localeCompare(b.responsavel_name || '');
          break;
        case 'prioridade':
          const priorityOrder = { 'absoluta': 4, 'alta': 3, 'media': 2, 'baixa': 1 };
          comparison = (priorityOrder[a.prioridade as keyof typeof priorityOrder] || 0) - 
                      (priorityOrder[b.prioridade as keyof typeof priorityOrder] || 0);
          break;
        case 'status':
          comparison = (a.status_display || '').localeCompare(b.status_display || '');
          break;
        case 'area':
          comparison = (a.area_display || '').localeCompare(b.area_display || '');
          break;
        case 'tipo':
          comparison = (a.tipo_display || '').localeCompare(b.tipo_display || '');
          break;
        default:
          comparison = 0;
      }

      return cardSortDirection === 'asc' ? comparison : -comparison;
    });

    return filtered;
  };

  const handleCardSort = (field: CardSortField) => {
    if (cardSortField === field) {
      setCardSortDirection(cardSortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setCardSortField(field);
      setCardSortDirection('asc');
    }
  };

  const getCardSortIcon = (field: CardSortField) => {
    if (cardSortField !== field) {
      return <ArrowUpDown className="h-[14px] w-[14px]" />;
    }
    return cardSortDirection === 'asc' 
      ? <ArrowUp className="h-[14px] w-[14px]" />
      : <ArrowDown className="h-[14px] w-[14px]" />;
  };

  // Project handlers
  const openCreateProjectDialog = () => {
    if (sprint && isSprintFinished(sprint)) {
      setAlertMessage('Não é possível criar projetos em sprints finalizadas.');
      setAlertDialogOpen(true);
      return;
    }
    setEditingProject(null);
    setProjectFormData({
      nome: '',
      descricao: '',
    });
    setProjectFormError('');
    setProjectDialogOpen(true);
  };

  const openEditProjectDialog = (e: React.MouseEvent, project: Project) => {
    e.stopPropagation();
    if (isProjectFromFinishedSprint(project)) {
      setAlertMessage('Projetos de sprints finalizadas não podem ser editados.');
      setAlertDialogOpen(true);
      return;
    }
    setEditingProject(project);
    setProjectFormData({
      nome: project.nome,
      descricao: project.descricao || '',
    });
    setProjectFormError('');
    setProjectDialogOpen(true);
  };

  const handleProjectSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setProjectFormError('');
    
    // Verificar se está editando um projeto de sprint finalizada
    if (editingProject && isProjectFromFinishedSprint(editingProject)) {
      setProjectFormError('Projetos de sprints finalizadas não podem ser editados.');
      return;
    }
    
    // Verificar se a sprint atual está finalizada ao criar novo projeto
    if (!editingProject && sprint && isSprintFinished(sprint)) {
      setProjectFormError('Não é possível criar projetos em sprints finalizadas.');
      return;
    }
    
    setProjectFormLoading(true);

    try {
      if (editingProject) {
        await projectService.update(editingProject.id, projectFormData);
      } else {
        await projectService.create({
          ...projectFormData,
          sprint: sprintId!,
        });
      }
      setProjectDialogOpen(false);
      loadData();
    } catch (err: any) {
      const errorData = err.response?.data;
      let errorMessage = 'Erro ao salvar projeto';
      if (errorData) {
        if (typeof errorData === 'string') {
          errorMessage = errorData;
        } else if (errorData.message) {
          errorMessage = errorData.message;
        } else if (errorData.detail) {
          errorMessage = errorData.detail;
        } else {
          const firstError = Object.values(errorData)[0];
          if (Array.isArray(firstError)) {
            errorMessage = firstError[0] as string;
          }
        }
      }
      setProjectFormError(errorMessage);
    } finally {
      setProjectFormLoading(false);
    }
  };

  const handleDeleteProject = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const project = projects.find(p => p.id === id);
    if (project && isProjectFromFinishedSprint(project)) {
      setAlertMessage('Projetos de sprints finalizadas não podem ser excluídos.');
      setAlertDialogOpen(true);
      return;
    }
    setProjectToDelete(project || null);
    setDeleteProjectDialogOpen(true);
  };

  const confirmDeleteProject = async () => {
    if (!projectToDelete) return;
    
    setDeleteProjectLoading(true);
    try {
      await projectService.delete(projectToDelete.id);
      setDeleteProjectDialogOpen(false);
      setProjectToDelete(null);
      loadData();
    } catch (error) {
      console.error('Erro ao excluir projeto:', error);
    } finally {
      setDeleteProjectLoading(false);
    }
  };

  // Card handlers
  const closeCardDialog = () => {
    setCardDialogOpen(false);
    setLogsModalOpen(false);
    const sid = sprintId?.trim();
    if (sid && cardId) {
      suppressCardDeepLinkRef.current = true;
      navigate(ROUTES.sprintPorId(sid), { replace: true });
    }
  };

  const openCreateCardDialog = (projectId: string) => {
    const project = projects.find(p => p.id === projectId);
    if (project && isProjectFromFinishedSprint(project)) {
      setAlertMessage('Não é possível criar cards em projetos de sprints finalizadas.');
      setAlertDialogOpen(true);
      return;
    }
    setLogsModalOpen(false);
    const sid = sprintId?.trim();
    if (sid && cardId) {
      suppressCardDeepLinkRef.current = true;
      navigate(ROUTES.sprintPorId(sid), { replace: true });
    }
    setEditingCard(null);
    setSelectedProjectForCard(projectId);
    const allowedStages = projectKanbanStagesByProjectId[projectId];
    const initialStatus = allowedStages?.[0]?.id ?? 'a_desenvolver';
    setCardFormData({
      nome: '',
      descricao: '',
      script_url: '',
      area: '',
      tipo: 'feature',
      prioridade: 'media',
      status: initialStatus,
      responsavel: '',
      data_inicio: '',
      data_fim: '',
    });
    setCardLinks([]);
    setNewLinkUrl('');
    setNewLinkLabel('');
    // Limpar estimativas ao abrir dialog de criação
    setSelectedTimeItems(new Set());
    setSelectedDevelopment(null);
    setCustomTimeItems([]);
    setCustomTimeLabel('');
    setCustomTimeHours('');
    setTimeEstimates([]);
    setShowTimeEstimator(false);
    setEditingTimeItemId(null);
    setEditTimeValue('');
    // Resetar tempos para valores padrão
    setTimeEstimates([
      { id: 'ler_script', label: 'Ler Script E Conferir Informações Do Video', hours: 1 },
      { id: 'solicitar_usuario', label: 'Solicitar Criação De Usuário / Vm', hours: 1 },
      { id: 'testes_iniciais', label: 'Testes Iniciais Na Maquina', hours: 3 },
      { id: 'configurar_projeto', label: 'Configurar Projeto Na Vm', hours: 1 },
      { id: 'desenvolvimento_basico', label: 'Desenvolvimento Básico', hours: 8, isDevelopment: true },
      { id: 'desenvolvimento_medio', label: 'Desenvolvimento Médio', hours: 24, isDevelopment: true },
      { id: 'desenvolvimento_dificil', label: 'Desenvolvimento Difícil', hours: 40, isDevelopment: true },
    ]);
    setCardFormError('');
    setCardDialogOpen(true);
  };

  const openEditCardDialog = async (
    e: React.MouseEvent | null,
    card: CardType,
    options?: { skipUrlSync?: boolean },
  ) => {
    e?.stopPropagation();

    const sid = sprintId?.trim();
    if (editingCard?.id === card.id && cardDialogOpen) {
      if (!options?.skipUrlSync && sid) {
        navigate(ROUTES.sprintCard(sid, String(card.id)), { replace: true });
      }
      return;
    }

    if (!options?.skipUrlSync) {
      suppressCardDeepLinkRef.current = false;
    }

    if (!options?.skipUrlSync && sid) {
      navigate(ROUTES.sprintCard(sid, String(card.id)), { replace: true });
    }

    const gen = ++openCardGenerationRef.current;

    // Buscar o card completo do servidor para garantir que temos todos os dados atualizados
    let fullCard = card;
    try {
      fullCard = await cardService.getById(card.id);
    } catch (error) {
      console.error('Erro ao carregar card completo:', error);
      // Se falhar, usar o card do estado local
    }

    if (gen !== openCardGenerationRef.current) return;

    if (
      sid &&
      projects.length > 0 &&
      !projects.some((p) => String(p.id) === String(fullCard.projeto))
    ) {
      navigate(ROUTES.projetoCard(String(fullCard.projeto), String(fullCard.id)), { replace: true });
      return;
    }

    // Permitir abrir para visualização sempre
    setEditingCard(fullCard);
    setSelectedProjectForCard(fullCard.projeto);
    setCardDialogOpen(true);
    setLogsModalOpen(true); // Abrir modal de logs quando card for aberto
    
    // Se o card está em desenvolvimento e não tem data_inicio, preencher automaticamente
    let dataInicio = fullCard.data_inicio || '';
    if (fullCard.status === 'em_desenvolvimento' && !dataInicio) {
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      const hours = String(now.getHours()).padStart(2, '0');
      const minutes = String(now.getMinutes()).padStart(2, '0');
      dataInicio = `${year}-${month}-${day}T${hours}:${minutes}`;
    }
    
    setCardFormData({
      nome: fullCard.nome,
      descricao: fullCard.descricao || '',
      script_url: fullCard.script_url || '',
      area: fullCard.area || 'backend',
      tipo: fullCard.tipo || 'feature',
      prioridade: fullCard.prioridade || 'media',
      status: fullCard.status || 'a_desenvolver',
      responsavel: fullCard.responsavel || '',
      data_inicio: dataInicio,
      data_fim: fullCard.data_fim || '',
    });
    setCardLinks(fullCard.links ?? []);
    setNewLinkUrl('');
    setNewLinkLabel('');
    
    // Debug: log dos dados carregados do servidor
    console.log('[SprintDetails] Carregando card, dados de complexidade:', {
      complexidade_selected_items: fullCard.complexidade_selected_items,
      complexidade_selected_development: fullCard.complexidade_selected_development,
      complexidade_custom_items: fullCard.complexidade_custom_items,
    });
    
    // Carregar dados de estimativa de complexidade salvos
    if (fullCard.complexidade_selected_items && fullCard.complexidade_selected_items.length > 0) {
      setSelectedTimeItems(new Set(fullCard.complexidade_selected_items));
    } else {
      setSelectedTimeItems(new Set());
    }
    
    setSelectedDevelopment(fullCard.complexidade_selected_development || null);
    
    if (fullCard.complexidade_custom_items && fullCard.complexidade_custom_items.length > 0) {
      setCustomTimeItems(fullCard.complexidade_custom_items);
    } else {
      setCustomTimeItems([]);
    }
    
    setCustomTimeLabel('');
    setCustomTimeHours('');
    setShowTimeEstimator(false);
    setEditingTimeItemId(null);
    setEditTimeValue('');
    // Carregar complexidades baseadas na área do card
    const cardArea = fullCard.area || '';
    if (cardArea) {
      const todos = getTodosByArea(cardArea);
      if (todos.length > 0) {
        setTimeEstimates(todos.map(todo => ({
          id: todo.id,
          label: todo.label,
          hours: todo.hours,
          isDevelopment: todo.id.includes('desenvolvimento')
        })));
      } else {
        setTimeEstimates([]);
      }
    } else {
      setTimeEstimates([]);
    }
    
    setCardFormError('');
  };

  // Link direto: /sprint/:sprintId/card/:cardId
  useEffect(() => {
    const sid = sprintId?.trim();
    if (!sid || cards.length === 0 || loading) return;

    if (!cardId) {
      suppressCardDeepLinkRef.current = false;
      return;
    }

    if (suppressCardDeepLinkRef.current) {
      return;
    }

    if (cardDialogOpen && editingCard && String(editingCard.id) === String(cardId)) return;
    const card = cards.find((c) => String(c.id) === String(cardId));
    if (!card) {
      suppressCardDeepLinkRef.current = true;
      navigate(ROUTES.sprintPorId(sid), { replace: true });
      return;
    }
    void openEditCardDialog(null, card, { skipUrlSync: true });
  }, [sprintId, cardId, cards, cardDialogOpen, editingCard, loading]);

  // Função auxiliar para obter label do status
  const getStageLabel = (status: string): string => {
    const projectStages = selectedProjectForCard
      ? projectKanbanStagesByProjectId[selectedProjectForCard]
      : undefined;
    const stageFromConfig = projectStages?.find((s) => s.id === status);
    if (stageFromConfig) return stageFromConfig.label;

    const stageLegacy = CARD_STATUSES.find((s) => s.value === status);
    return stageLegacy?.label || status;
  };

  // Detectar alterações no card
  const detectCardChanges = (oldCard: CardType, newData: any, excludeStatus: boolean = false): string[] => {
    const changes: string[] = [];
    
    // Nome
    if (oldCard.nome !== newData.nome) {
      changes.push(`Nome: "${oldCard.nome}" → "${newData.nome}"`);
    }
    
    // Descrição
    const oldDescricao = oldCard.descricao || '';
    const newDescricao = newData.descricao || '';
    if (oldDescricao !== newDescricao) {
      changes.push(`Descrição: "${oldDescricao || 'Vazio'}" → "${newDescricao || 'Vazio'}"`);
    }
    
    // Link do script
    const oldScriptUrl = oldCard.script_url || null;
    const newScriptUrl = newData.script_url || null;
    if (oldScriptUrl !== newScriptUrl) {
      changes.push(`Link do script: "${oldScriptUrl || 'Vazio'}" → "${newScriptUrl || 'Vazio'}"`);
    }

    // Links adicionais
    const oldLinks = JSON.stringify(oldCard.links ?? []);
    const newLinks = JSON.stringify((newData as { links?: CardLink[] }).links ?? []);
    if (oldLinks !== newLinks) {
      changes.push('Links adicionais alterados');
    }
    
    // Área
    if (oldCard.area !== newData.area) {
      const oldArea = CARD_AREAS.find(a => a.value === oldCard.area)?.label || oldCard.area;
      const newArea = CARD_AREAS.find(a => a.value === newData.area)?.label || newData.area;
      changes.push(`Área: "${oldArea}" → "${newArea}"`);
    }
    
    // Tipo
    if (oldCard.tipo !== newData.tipo) {
      const oldTipo = CARD_TYPES.find(t => t.value === oldCard.tipo)?.label || oldCard.tipo;
      const newTipo = CARD_TYPES.find(t => t.value === newData.tipo)?.label || newData.tipo;
      changes.push(`Tipo: "${oldTipo}" → "${newTipo}"`);
    }
    
    // Prioridade
    if (oldCard.prioridade !== newData.prioridade) {
      const oldPrioridade = CARD_PRIORITIES.find(p => p.value === oldCard.prioridade)?.label || oldCard.prioridade;
      const newPrioridade = CARD_PRIORITIES.find(p => p.value === newData.prioridade)?.label || newData.prioridade;
      changes.push(`Prioridade: "${oldPrioridade}" → "${newPrioridade}"`);
    }
    
    // Status (apenas se não for movimentação)
    if (!excludeStatus && oldCard.status !== newData.status) {
      const oldStatus = getStageLabel(oldCard.status);
      const newStatus = getStageLabel(newData.status);
      changes.push(`Status: "${oldStatus}" → "${newStatus}"`);
    }
    
    // Responsável
    if (oldCard.responsavel !== (newData.responsavel || null)) {
      const oldResponsavel = oldCard.responsavel_name || 'Não atribuído';
      const newResponsavel = newData.responsavel ? users.find(u => u.id === newData.responsavel)?.first_name || 'Não atribuído' : 'Não atribuído';
      changes.push(`Responsável: "${oldResponsavel}" → "${newResponsavel}"`);
    }
    
    // Data de início
    const oldDataInicio = oldCard.data_inicio || null;
    const newDataInicio = newData.data_inicio || null;
    if (oldDataInicio !== newDataInicio) {
      const oldDataInicioStr = oldDataInicio ? formatDateTime(oldDataInicio) : 'Não definida';
      const newDataInicioStr = newDataInicio ? formatDateTime(newDataInicio) : 'Não definida';
      changes.push(`Data de início: "${oldDataInicioStr}" → "${newDataInicioStr}"`);
    }
    
    // Data de entrega
    const oldDataFim = oldCard.data_fim || null;
    const newDataFim = newData.data_fim || null;
    if (oldDataFim !== newDataFim) {
      const oldDataFimStr = oldDataFim ? formatDateTime(oldDataFim) : 'Não definida';
      const newDataFimStr = newDataFim ? formatDateTime(newDataFim) : 'Não definida';
      changes.push(`Data de entrega: "${oldDataFimStr}" → "${newDataFimStr}"`);
    }
    
    return changes;
  };

  // Função para capitalizar a primeira letra
  const capitalizeFirst = (str: string): string => {
    return str.charAt(0).toUpperCase() + str.slice(1);
  };

  // Validar se card tem todos os dados obrigatórios para etapas que exigem dados
  const validateCardRequiredData = (card: typeof cardFormData): { valid: boolean; missing: string[] } => {
    const missing: string[] = [];
    
    if (!card.responsavel) {
      missing.push('desenvolvedor atribuído');
    }
    if (!card.data_inicio) {
      missing.push('data de início');
    }
    if (!card.data_fim) {
      missing.push('data de entrega');
    }
    
    return {
      valid: missing.length === 0,
      missing,
    };
  };

  // Verificar se uma etapa exige dados obrigatórios
  const requiresRequiredData = (stageId: string): boolean => {
    const projectStages = selectedProjectForCard
      ? projectKanbanStagesByProjectId[selectedProjectForCard]
      : undefined;

    return (
      projectStages?.find((s) => s.id === stageId)?.requires_required_data ??
      DEFAULT_SPRINT_STAGE_CONFIGS.find((s) => s.id === stageId)?.requires_required_data ??
      false
    );
  };

  // Calcular sugestão de data de entrega baseada na estimativa de complexidade
  const calculateSuggestedEndDate = (hours: number): string => {
    if (!hours || hours === 0) return '';
    
    const now = new Date();
    
    // Hora padrão de entrega: 18:00
    const defaultHour = 18;
    const defaultMinute = 0;
    
    // Considerar apenas dias úteis (segunda a sexta)
    // Estimativa: 8 horas por dia útil
    const diasUteis = Math.ceil(hours / 8);
    let diasAdicionados = 0;
    
    // Começar a contar a partir de amanhã (hoje já começou)
    let dataFinal = new Date(now);
    dataFinal.setDate(dataFinal.getDate() + 1);
    dataFinal.setHours(0, 0, 0, 0);
    
    // Avançar até o próximo dia útil se necessário
    while (dataFinal.getDay() === 0 || dataFinal.getDay() === 6) {
      dataFinal.setDate(dataFinal.getDate() + 1);
    }
    
    // Contar os dias úteis necessários
    while (diasAdicionados < diasUteis) {
      const diaSemana = dataFinal.getDay();
      // Se não for sábado (6) ou domingo (0), conta como dia útil
      if (diaSemana !== 0 && diaSemana !== 6) {
        diasAdicionados++;
      }
      // Se ainda não atingiu o número de dias úteis, avançar para o próximo dia
      if (diasAdicionados < diasUteis) {
        dataFinal.setDate(dataFinal.getDate() + 1);
      }
    }
    
    // Retornar no formato YYYY-MM-DDTHH:mm (usar hora padrão 18:00)
    const year = dataFinal.getFullYear();
    const month = String(dataFinal.getMonth() + 1).padStart(2, '0');
    const day = String(dataFinal.getDate()).padStart(2, '0');
    const hour = String(defaultHour).padStart(2, '0');
    const minutes = String(defaultMinute).padStart(2, '0');
    return `${year}-${month}-${day}T${hour}:${minutes}`;
  };

  const handleCardSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (cardSubmitInFlightRef.current) return;
    setCardFormError('');
    
    // Validar se a área foi selecionada
    if (!cardFormData.area || cardFormData.area.trim() === '') {
      setCardFormError('Por favor, selecione uma área para o card.');
      setCardFormLoading(false);
      return;
    }
    
    // Verificar se está editando um card de sprint finalizada
    if (editingCard && isCardFromFinishedSprint(editingCard)) {
      setCardFormError('Cards de sprints finalizadas não podem ser editados.');
      setCardFormLoading(false);
      return;
    }
    
    // Verificar se o projeto selecionado pertence a uma sprint finalizada
    if (selectedProjectForCard) {
      const project = projects.find(p => p.id === selectedProjectForCard);
      if (project && isProjectFromFinishedSprint(project)) {
        setCardFormError('Não é possível criar ou editar cards em projetos de sprints finalizadas.');
        setCardFormLoading(false);
        return;
      }
    }
    
    // Validar se está mudando para uma etapa que exige dados obrigatórios
    if (requiresRequiredData(cardFormData.status)) {
      const validation = validateCardRequiredData(cardFormData);
      if (!validation.valid) {
        const missingList = validation.missing.map((item, index) => `${index + 1}. ${capitalizeFirst(item)}`).join('\n');
        const stageLabel = cardFormData.status === 'em_desenvolvimento' ? 'Em Desenvolvimento' :
                          cardFormData.status === 'parado_pendencias' ? 'Parado por Pendências' :
                          cardFormData.status === 'em_homologacao' ? 'Em Homologação' :
                          cardFormData.status === 'finalizado' ? 'Concluído' : cardFormData.status;
        setCardFormError(`Para o status "${stageLabel}", é necessário preencher:\n\n${missingList}.`);
        setCardFormLoading(false);
        return;
      }
      
      // Sempre preencher data_inicio com a data/hora atual se não estiver preenchida (apenas para em_desenvolvimento)
      if (cardFormData.status === 'em_desenvolvimento' && (!cardFormData.data_inicio || cardFormData.data_inicio.trim() === '')) {
        const now = new Date();
        // Formatar como YYYY-MM-DDTHH:mm
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        cardFormData.data_inicio = `${year}-${month}-${day}T${hours}:${minutes}`;
      }
      
      // Se não tem data_fim mas tem estimativa de complexidade, sugerir data
      if (!cardFormData.data_fim) {
        const totalHours = calculateTotalTime();
        if (totalHours > 0) {
          const suggestedDate = calculateSuggestedEndDate(totalHours);
          if (suggestedDate) {
            cardFormData.data_fim = suggestedDate;
          }
        }
      }
    }
    
    cardSubmitInFlightRef.current = true;
    setCardFormLoading(true);

    try {
      // Garantir que datas vazias sejam null, não string vazia
      const dataInicio = cardFormData.data_inicio && cardFormData.data_inicio.trim() !== '' 
        ? cardFormData.data_inicio 
        : null;
      const dataFim = cardFormData.data_fim && cardFormData.data_fim.trim() !== '' 
        ? cardFormData.data_fim 
        : null;
      
      const dataToSend = {
        nome: cardFormData.nome,
        descricao: cardFormData.descricao,
        script_url: cardFormData.script_url || null,
        area: cardFormData.area,
        tipo: cardFormData.tipo,
        prioridade: cardFormData.prioridade,
        status: cardFormData.status,
        responsavel: cardFormData.responsavel || null,
        data_inicio: dataInicio,
        data_fim: dataFim,
        projeto: selectedProjectForCard!,
        // Incluir dados de estimativa de complexidade
        complexidade_selected_items: Array.from(selectedTimeItems).length > 0 ? Array.from(selectedTimeItems) : [],
        complexidade_selected_development: selectedDevelopment || null,
        complexidade_custom_items: customTimeItems.length > 0 ? customTimeItems : [],
        links: cardLinks,
      };
      
      // Debug: log dos dados sendo enviados
      console.log('[SprintDetails] Salvando card com dados de complexidade:', {
        complexidade_selected_items: dataToSend.complexidade_selected_items,
        complexidade_selected_development: dataToSend.complexidade_selected_development,
        complexidade_custom_items: dataToSend.complexidade_custom_items,
      });

      if (editingCard) {
        // Detectar alterações antes de atualizar
        const changes = detectCardChanges(editingCard, dataToSend, true); // excludeStatus=true porque mudanças de status são tratadas separadamente
        
        console.log('[SprintDetails] ANTES de atualizar - dados sendo enviados:', JSON.stringify(dataToSend, null, 2));
        
        const updatedCard = await cardService.update(editingCard.id, dataToSend);
        
        // Debug: log dos dados retornados do servidor
        console.log('[SprintDetails] DEPOIS de atualizar - dados retornados do update():', {
          id: updatedCard.id,
          complexidade_selected_items: updatedCard.complexidade_selected_items,
          complexidade_selected_development: updatedCard.complexidade_selected_development,
          complexidade_custom_items: updatedCard.complexidade_custom_items,
          fullResponse: JSON.stringify(updatedCard, null, 2)
        });
        
        // Recarregar o card completo do servidor para garantir que temos todos os dados atualizados
        const refreshedCard = await cardService.getById(editingCard.id);
        console.log('[SprintDetails] Card recarregado do servidor via getById():', {
          id: refreshedCard.id,
          complexidade_selected_items: refreshedCard.complexidade_selected_items,
          complexidade_selected_development: refreshedCard.complexidade_selected_development,
          complexidade_custom_items: refreshedCard.complexidade_custom_items,
          fullResponse: JSON.stringify(refreshedCard, null, 2)
        });
        
        // Atualizar o card na lista local com os dados recarregados
        setCards((prevCards) => {
          const updated = prevCards.map((card) =>
            card.id === editingCard.id 
              ? { 
                  ...refreshedCard, 
                  responsavel_name: refreshedCard.responsavel_name ?? (refreshedCard.responsavel ? users.find(u => u.id === refreshedCard.responsavel)?.first_name : undefined)
                } 
              : card
          );
          console.log('[SprintDetails] Estado atualizado, card na lista:', updated.find(c => c.id === editingCard.id));
          return updated;
        });
        
        // Registrar log de alteração se houver mudanças
        if (changes.length > 0) {
          await cardLogService.create({
            card: editingCard.id,
            tipo_evento: 'alteracao',
            descricao: `Alteração no Card\n\n${changes.join('\n')}`,
            usuario: user?.id || null,
          });
          // Atualizar trigger para recarregar logs em tempo real
          setLogsRefreshTrigger(prev => prev + 1);
        }
      } else {
        const newCard = await cardService.create(dataToSend);
        
        // Criar TODOs automaticamente baseados na área do card
        const todos = getTodosByArea(cardFormData.area);
        if (todos.length > 0) {
          try {
            const todoPromises = todos.map((todo, index) =>
              cardTodoService.create({
                card: newCard.id,
                label: todo.label,
                is_original: true,
                status: 'pending',
                order: index,
              })
            );
            await Promise.all(todoPromises);
          } catch (error) {
            console.error('Erro ao criar TODOs do card:', error);
            // Não bloquear a criação do card se os TODOs falharem
          }
        }
        
        // Adicionar o novo card à lista local sem recarregar tudo
        const cardWithUser = {
          ...newCard,
          responsavel_name: newCard.responsavel_name ?? (newCard.responsavel ? users.find(u => u.id === newCard.responsavel)?.first_name : undefined),
        };
        setCards((prevCards) => [...prevCards, cardWithUser]);
        
        // Log de criação é criado automaticamente pelo backend
        // Atualizar trigger para recarregar logs em tempo real
        setLogsRefreshTrigger(prev => prev + 1);
      }
      closeCardDialog();
    } catch (err: any) {
      const errorData = err.response?.data;
      let errorMessage = 'Erro ao salvar card';
      if (errorData) {
        if (typeof errorData === 'string') {
          errorMessage = errorData;
        } else if (errorData.message) {
          errorMessage = errorData.message;
        } else if (errorData.detail) {
          errorMessage = errorData.detail;
        } else {
          const firstError = Object.values(errorData)[0];
          if (Array.isArray(firstError)) {
            errorMessage = firstError[0] as string;
          }
        }
      }
      setCardFormError(errorMessage);
    } finally {
      cardSubmitInFlightRef.current = false;
      setCardFormLoading(false);
    }
  };

  const handleDeleteCard = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const card = cards.find(c => c.id === id);
    if (card && isCardFromFinishedSprint(card)) {
      setAlertMessage('Cards de sprints finalizadas não podem ser excluídos.');
      setAlertDialogOpen(true);
      return;
    }
    setCardToDelete(card || null);
    setDeleteCardDialogOpen(true);
  };

  const confirmDeleteCard = async () => {
    if (!cardToDelete) return;
    
    setDeleteCardLoading(true);
    try {
      await cardService.delete(cardToDelete.id);
      // Remover o card da lista local sem recarregar tudo
      setCards((prevCards) => prevCards.filter((card) => card.id !== cardToDelete.id));
      setDeleteCardDialogOpen(false);
      setCardToDelete(null);
      if (editingCard?.id === cardToDelete.id || (cardId && String(cardToDelete.id) === String(cardId))) {
        closeCardDialog();
      }
    } catch (error) {
      console.error('Erro ao excluir card:', error);
    } finally {
      setDeleteCardLoading(false);
    }
  };

  // Sprint handlers
  const openEditSprintDialog = (e: React.MouseEvent) => {
    if (!sprint) return;
    e.stopPropagation();
    if (isSprintPastFechamento(sprint)) {
      setAlertMessage('Sprints finalizadas não podem ser editadas.');
      setAlertDialogOpen(true);
      return;
    }
    setSprintFormData({
      nome: sprint.nome,
      data_inicio: fechamentoIsoToDatetimeLocal(sprint.data_inicio),
      fechamento_em: fechamentoIsoToDatetimeLocal(sprint.fechamento_em),
    });
    setSprintFormError('');
    setSprintDialogOpen(true);
  };

  const handleSprintSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sprint) return;
    if (isSprintPastFechamento(sprint)) {
      setSprintFormError('Sprints finalizadas não podem ser editadas.');
      return;
    }
    setSprintFormError('');
    setSprintFormLoading(true);

    try {
      const inicioIso = datetimeLocalToFechamentoIso(sprintFormData.data_inicio);
      const fechamentoIso = datetimeLocalToFechamentoIso(sprintFormData.fechamento_em);

      if (!inicioIso || !fechamentoIso) {
        setSprintFormError('Preencha a data e hora de início e a data e hora de fechamento.');
        setSprintFormLoading(false);
        return;
      }

      await sprintService.update(sprint.id, {
        nome: sprintFormData.nome,
        data_inicio: inicioIso,
        fechamento_em: fechamentoIso,
      });
      setSprintDialogOpen(false);
      loadData();
    } catch (err: any) {
      const errorData = err.response?.data;
      let errorMessage = 'Erro ao salvar sprint';
      if (errorData) {
        if (typeof errorData === 'string') {
          errorMessage = errorData;
        } else if (errorData.message) {
          errorMessage = errorData.message;
        } else if (errorData.detail) {
          errorMessage = errorData.detail;
        } else {
          const firstError = Object.values(errorData)[0];
          if (Array.isArray(firstError)) {
            errorMessage = firstError[0] as string;
          }
        }
      }
      setSprintFormError(errorMessage);
    } finally {
      setSprintFormLoading(false);
    }
  };

  const handleDeleteSprint = (e: React.MouseEvent) => {
    if (!sprint) return;
    e.stopPropagation();
    setDeleteSprintDialogOpen(true);
  };

  const confirmDeleteSprint = async () => {
    if (!sprint) return;
    
    setDeleteSprintLoading(true);
    try {
      await sprintService.delete(sprint.id);
      setDeleteSprintDialogOpen(false);
      navigate(ROUTES.sprint);
    } catch (error) {
      console.error('Erro ao excluir sprint:', error);
    } finally {
      setDeleteSprintLoading(false);
    }
  };

  const handleFinalizarSprint = () => {
    setFinalizarError('');
    setFinalizarDialogOpen(true);
  };

  const confirmFinalizarSprint = async () => {
    if (!sprint) return;
    setFinalizarLoading(true);
    setFinalizarError('');
    try {
      await sprintService.finalizar(sprint.id);
      setFinalizarDialogOpen(false);
      loadData();
    } catch (err: any) {
      const detail = err.response?.data?.detail;
      setFinalizarError(typeof detail === 'string' ? detail : 'Erro ao finalizar sprint.');
    } finally {
      setFinalizarLoading(false);
    }
  };

  const getSprintStatus = (sprint: Sprint) => {
    if (sprint.finalizada) {
      return { label: 'Finalizada', variant: 'success' as const };
    }
    const startMs = new Date(sprint.data_inicio).getTime();
    const endMs = new Date(sprint.fechamento_em).getTime();
    const nowMs = Date.now();

    if (nowMs < startMs) {
      return { label: 'Planejada', variant: 'secondary' as const };
    }
    if (nowMs > endMs) {
      return { label: 'Prazo encerrado', variant: 'outline' as const };
    }
    return { label: 'Em andamento', variant: 'default' as const };
  };

  const isSprintFinished = (sprint: Sprint) => isSprintPastFechamento(sprint);

  // Verificar se um projeto pertence a uma sprint finalizada
  const isProjectFromFinishedSprint = (project: Project): boolean => {
    if (!sprint) return false;
    // Se o projeto pertence à sprint atual e ela está finalizada
    const projectSprintId = String(project.sprint || '');
    const currentSprintId = String(sprint.id || '');
    if (projectSprintId === currentSprintId) {
      return isSprintFinished(sprint);
    }
    // Verificar se o projeto pertence a outra sprint finalizada
    // Isso requer buscar todas as sprints, mas por enquanto vamos verificar apenas a sprint atual
    return false;
  };

  // Verificar se um card pertence a uma sprint finalizada
  const isCardFromFinishedSprint = (card: CardType): boolean => {
    if (!sprint) return false;
    // Encontrar o projeto do card
    const project = projects.find((p) => {
      const projectId = String(p.id || '');
      const cardProjectId = String(card.projeto || '');
      return projectId === cardProjectId;
    });
    if (!project) return false;
    return isProjectFromFinishedSprint(project);
  };

  const getCardStatusIcon = (status: string) => {
    switch (status) {
      case 'a_desenvolver':
        return <Circle className="h-[14px] w-[14px] text-gray-400" />;
      case 'em_desenvolvimento':
        return <AlertCircle className="h-[14px] w-[14px] text-blue-500" />;
      case 'parado_pendencias':
        return <XCircle className="h-[14px] w-[14px] text-orange-500" />;
      case 'em_homologacao':
        return <Clock className="h-[14px] w-[14px] text-purple-500" />;
      case 'finalizado':
        return <CheckCircle2 className="h-[14px] w-[14px] text-green-500" />;
      case 'inviabilizado':
        return <XCircle className="h-[14px] w-[14px] text-red-500" />;
      default:
        return <Circle className="h-[14px] w-[14px] text-gray-400" />;
    }
  };

  // Tag abreviada de cargo (mesma ideia do UserSelect)
  const getRoleLabel = (role: string): string => {
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
  };

  // Cores do cargo (mesmas do UserSelect)
  const getRoleColor = (role: string): string => {
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
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[256px]">
        <Loader2 className="h-[32px] w-[32px] animate-spin text-[var(--color-primary)]" />
      </div>
    );
  }

  if (!sprint) {
    return (
      <div className="flex flex-col items-center justify-center h-[256px]">
        <p className="text-lg font-medium text-[var(--color-foreground)]">
          Sprint não encontrada
        </p>
        <Button variant="outline" onClick={() => navigate(-1)} className="mt-[16px]">
          Voltar
        </Button>
      </div>
    );
  }

  const sprintProjects = getProjectsForSprint(sprint.id);
  const status = getSprintStatus(sprint);

  const sprintProjectsNoSuggestions = sprintProjects.filter((p) => {
    const normalizedName = normalizeProjectName(p.nome || '');
    return normalizedName !== 'sugestoes' && normalizedName !== 'suporte';
  });
  const sprintProjectIdsSet = new Set(sprintProjectsNoSuggestions.map((p) => String(p.id).trim()));
  const sprintCardsForList = cards.filter((c) =>
    sprintProjectIdsSet.has(String(c.projeto || '').trim()),
  );
  const visibleCardsForList = getFilteredAndSortedCards(sprintCardsForList);
  const deliveredLateCount = sprintCardsForList.filter(
    (card) =>
      card.status === 'finalizado' &&
      !!card.data_fim &&
      new Date(card.data_fim).getTime() > new Date(sprint.fechamento_em).getTime(),
  ).length;
  const openLateCount = sprintCardsForList.filter(
    (card) =>
      card.status !== 'finalizado' &&
      card.status !== 'inviabilizado' &&
      !!card.data_fim &&
      new Date(card.data_fim).getTime() < Date.now(),
  ).length;

  const selectedColumnDefs = SPRINT_CARDS_COLUMN_DEFS.filter((c) => selectedColumnIds.includes(c.id));
  const selectedColumnDefsSafe = selectedColumnDefs;
  const isCardLateForSprintView = (card: CardType): boolean => {
    if (!card.data_fim) return false;
    const due = new Date(card.data_fim).getTime();
    if (card.status === 'finalizado') {
      return due > new Date(sprint.fechamento_em).getTime();
    }
    if (card.status === 'inviabilizado') return false;
    return due < Date.now();
  };

  /** Nome base: «nome da sprint» - datahora (local), seguro para nome de arquivo */
  const getExportFileBaseName = () => {
    const nome = (sprint.nome || 'Sprint').trim();
    const safeNome = nome
      .replace(/[\\/:*?"<>|]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 180) || 'Sprint';
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    const datahora = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
    return `${safeNome} - ${datahora}`;
  };

  const handleExportCSV = (delimiter: ',' | ';') => {
    if (!selectedColumnDefsSafe.length) return;
    const headers = selectedColumnDefsSafe.map((c) => c.label);
    const rows = visibleCardsForList.map((card) =>
      selectedColumnDefsSafe.map((col) => {
        const raw = col.getValue({ card });
        return exportValueToString(raw);
      }),
    );

    const suffix = delimiter === ';' ? ' - ponto-e-virgula' : ' - virgula';
    const filename = `${getExportFileBaseName()}${suffix}.csv`;
    exportCardsToCSV({ filename, headers, rows, delimiter });
  };

  const handleExportXLSX = async () => {
    if (!selectedColumnDefsSafe.length) return;
    const headers = selectedColumnDefsSafe.map((c) => c.label);
    const rows = visibleCardsForList.map((card) =>
      selectedColumnDefsSafe.map((col) => {
        const raw = col.getValue({ card });
        return exportValueToString(raw);
      }),
    );

    const filename = `${getExportFileBaseName()}.xlsx`;
    await exportCardsToXLSX({ filename, headers, rows });
  };

  const exportValueToString = (value: unknown): string => {
    // exportCards.ts já tem um normalizador, mas aqui mantemos explicitamente para garantir tipo string[][]
    // sem depender do formato do getValue.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return typeof value === 'string' ? value : JSON.stringify(value ?? '');
  };

  const toggleColumnId = (columnId: string, checked: boolean) => {
    setSelectedColumnIds((prev) => {
      const allowed = new Set(SPRINT_CARDS_COLUMN_IDS);
      if (!allowed.has(columnId)) return prev;

      const nextSet = new Set(prev);
      if (checked) nextSet.add(columnId);
      else nextSet.delete(columnId);

      // Garantir ordem estável conforme `SPRINT_CARDS_COLUMN_DEFS`
      return SPRINT_CARDS_COLUMN_DEFS.map((c) => c.id).filter((id) => nextSet.has(id));
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

  /** Duplo clique no cabeçalho: expande/recolhe todas as colunas (conteúdo completo), estilo Excel */
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

  const renderCard = (card: CardType) => {
    const isFinished = isCardFromFinishedSprint(card);
    const isCardDelivered = card.status === 'finalizado' || card.status === 'inviabilizado';
    // Permitir clique para visualização sempre (mesmo se sprint finalizada ou card finalizado)
    const canClick = true;

    const responsibleUser = card.responsavel
      ? users.find((u) => String(u.id) === String(card.responsavel))
      : undefined;
    const responsibleRoleLabel = responsibleUser ? getRoleLabel(responsibleUser.role) : '';
    const ink = kanbanCardInkTextClass(showPriorityColorsOnCards);

    return (
      <div
        key={card.id}
        className={cn(
          'p-[12px] rounded-[8px] border-l-[3px] shadow-sm hover:shadow-md transition-shadow cursor-pointer bg-[var(--color-kanban-card)] group',
          showPriorityColorsOnCards ? '' : 'border-l-[var(--color-border)]',
          isCardDelivered ? 'opacity-70' : '',
          isFinished ? 'opacity-60' : '',
        )}
        style={showPriorityColorsOnCards ? getPriorityStyle(card.prioridade, card.id) : undefined}
        onClick={(e) => openEditCardDialog(e, card)}
      >
        <div className="flex items-start justify-between gap-[8px]">
          <div className="flex items-center gap-[8px] flex-1 min-w-0">
            <span className={cn('font-medium text-sm truncate flex-1', ink)}>
              {card.nome}
            </span>
          </div>
          {!isFinished && !isCardDelivered && (
            <div className="flex gap-[2px] opacity-0 group-hover:opacity-100 transition-opacity">
              <Button
                variant="ghost"
                size="icon"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDeleteCard(e, card.id);
                }}
                className="h-[24px] w-[24px]"
              >
                <Trash2 className="h-[12px] w-[12px] text-red-500" />
              </Button>
            </div>
          )}
        </div>

        {/* Entrega (logo abaixo do nome) + Tag atrasado/pendencias alinhada à direita */}
        {card.data_fim && (
          <div className="flex items-center justify-between gap-[8px] mt-[6px]">
            <div className={cn('flex items-center gap-[4px] text-xs', ink)}>
              <Calendar className="h-[12px] w-[12px]" />
              {formatDateTime(card.data_fim)}
            </div>
            <div className="flex items-center gap-[8px]">
              {isCardLateForSprintView(card) ? (
                <Badge variant="outline" className={ATRASADO_STATUS_BADGE}>
                  Atrasado
                </Badge>
              ) : card.status === 'parado_pendencias' ? (
                <Badge variant="secondary" className="text-[10px] px-[6px] py-0 shrink-0">
                  Pendências
                </Badge>
              ) : null}
            </div>
          </div>
        )}
      
      {/* Badges de área e tipo */}
      <div className="flex flex-wrap gap-[4px] mt-[8px]">
        {card.area_display && (
          <span
            className={`text-[10px] px-[6px] py-[2px] rounded-full ${getKanbanAreaBadgeClasses(card.area, showPriorityColorsOnCards)}`}
          >
            {card.area_display}
          </span>
        )}
        {card.tipo_display && (
          <span
            className={cn(
              'text-[10px] px-[6px] py-[2px] rounded-full',
              showPriorityColorsOnCards ? kanbanMutedChipOnPastelClass : cn('bg-[var(--color-muted)]', ink),
            )}
          >
            {card.tipo_display}
          </span>
        )}
        {card.script_url && (
          <a
            href={normalizeExternalUrl(card.script_url)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className={cn(
              'flex items-center gap-[2px] text-[10px] px-[6px] py-[2px] rounded-full transition-colors',
              showPriorityColorsOnCards
                ? kanbanScriptLinkOnPastelClass
                : 'bg-[var(--color-primary)]/20 text-[var(--color-primary)] hover:bg-[var(--color-primary)]/35',
            )}
          >
            <ExternalLink className="h-[10px] w-[10px]" />
            Script
          </a>
        )}
      </div>

      {card.descricao && (
        <p className={cn('mt-[8px] text-xs line-clamp-2', ink)}>
          {card.descricao}
        </p>
      )}
      
      <div className="flex items-center justify-between mt-[8px]">
        <div className="flex items-center gap-[8px] flex-wrap">
          {card.responsavel_name ? (
            <div className={cn('flex items-center gap-[6px] text-xs', ink)}>
              {responsibleRoleLabel ? (
                <Badge
                  variant="secondary"
                  className={`text-[10px] px-[6px] py-[2px] rounded-full ${responsibleUser ? getRoleColor(responsibleUser.role) : ''}`}
                >
                  {responsibleRoleLabel}
                </Badge>
              ) : null}
              <span className="truncate">{card.responsavel_name}</span>
            </div>
          ) : (
            <div className={cn('flex items-center gap-[6px] text-xs', ink)}>
              <User className="h-[12px] w-[12px]" />
              <span className="truncate">Sem usuário atribuído</span>
            </div>
          )}
        </div>
        <span
          className={cn(
            'text-[10px] px-[6px] py-[2px] rounded-full font-medium shrink-0',
            showPriorityColorsOnCards
              ? kanbanMutedChipOnPastelClass
              : cn('bg-[var(--color-muted)]/50', ink),
          )}
        >
          {getPriorityLabel(card.prioridade)}
        </span>
      </div>
    </div>
    );
  };

  return (
    <div className="flex flex-col h-[calc(100vh-64px-64px)] min-h-0">
      {/* Header com botão voltar */}
      <div className="flex items-center gap-[16px] mb-[24px] flex-shrink-0">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate(-1)}
          className="h-[40px] w-[40px]"
        >
          <ArrowLeft className="h-[20px] w-[20px]" />
        </Button>
        <div className="flex items-center gap-[16px] flex-1">
          <div className="flex h-[48px] w-[48px] items-center justify-center rounded-[8px] bg-[var(--color-primary)]/10">
            <Zap className="h-[24px] w-[24px] text-[var(--color-primary)]" />
          </div>
          <div>
            <div className="flex items-center gap-[12px]">
              <h1 className="text-2xl font-bold text-[var(--color-foreground)]">
                {sprint.nome}
              </h1>
              {sprint.finalizada ? (
                <Badge variant="secondary">Finalizada</Badge>
              ) : (
                <Badge variant={status.variant}>{status.label}</Badge>
              )}
            </div>
            <div className="flex items-center gap-[16px] mt-[4px] text-sm text-[var(--color-muted-foreground)]">
              <span className="flex items-center gap-[4px]">
                <User className="h-[14px] w-[14px]" />
                {sprint.supervisor_name || 'N/A'}
              </span>
              <span className="flex items-center gap-[4px]">
                <Calendar className="h-[14px] w-[14px]" />
                {formatDateTime(sprint.data_inicio)} → {formatDateTime(sprint.fechamento_em)}
              </span>
              <span className="flex items-center gap-[4px]">
                <Clock className="h-[14px] w-[14px]" />
                {calcularDiasTotais(sprintInicioDiaParaCalendario(sprint), sprintFimDiaParaCalendario(sprint))} dias ({calcularDiasUteis(sprintInicioDiaParaCalendario(sprint), sprintFimDiaParaCalendario(sprint))} úteis)
              </span>
              <span className="flex items-center gap-[6px]">
                <Badge variant="outline" className="text-[11px]">
                  Entregues atrasados: {deliveredLateCount}
                </Badge>
                <Badge variant="outline" className="text-[11px]">
                  Abertos atrasados: {openLateCount}
                </Badge>
              </span>
            </div>
          </div>
        </div>
        <div className="flex gap-[8px]">
          {canCreate && (
            <Button 
              onClick={openCreateProjectDialog}
              disabled={sprint && isSprintFinished(sprint)}
              className={sprint && isSprintFinished(sprint) ? 'opacity-50 cursor-not-allowed' : ''}
            >
              {sprint && isSprintFinished(sprint) ? (
                <>
                  <Lock className="mr-[8px] h-[16px] w-[16px]" />
                  Novo Projeto
                </>
              ) : (
                <>
                  <Plus className="mr-[8px] h-[16px] w-[16px]" />
                  Novo Projeto
                </>
              )}
            </Button>
          )}
          {canFinalizar && sprint && !sprint.finalizada && (
            <Button
              variant="outline"
              size="default"
              onClick={handleFinalizarSprint}
              className="h-[40px]"
            >
              <CheckCircle2 className="mr-[8px] h-[16px] w-[16px] text-green-600" />
              Finalizar sprint
            </Button>
          )}
          {canCreate && sprint && !isSprintFinished(sprint) && (
            <>
              <Button
                variant="outline"
                size="icon"
                onClick={openEditSprintDialog}
                className="h-[40px] w-[40px]"
              >
                <Pencil className="h-[16px] w-[16px]" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={handleDeleteSprint}
                className="h-[40px] w-[40px]"
              >
                <Trash2 className="h-[16px] w-[16px] text-red-500" />
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Search and Filters */}
      <div className="mb-[24px] flex-shrink-0 space-y-[16px]">
        <div className="flex flex-col gap-[8px] lg:flex-row lg:items-center lg:gap-[8px]">
          {/* 1. Pesquisa — flex-1 absorve o espaço livre (empurra filtros para a direita colados entre si) */}
          <div className="relative min-h-[40px] min-w-0 w-full lg:min-w-[min(280px,100%)] lg:flex-1">
            <Search className="absolute left-[12px] top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-[var(--color-muted-foreground)]" />
            <Input
              type="text"
              placeholder="Pesquisar cards por nome, descrição, responsável, área, tipo ou projeto..."
              value={cardSearchQuery}
              onChange={(e) => setCardSearchQuery(e.target.value)}
              className="h-[40px] pl-[40px]"
            />
          </div>

          {/* 2–5. Mesmo gap-[8px] que Finalizar sprint | lápis | lixeira — um único flex, sem wrapper que estique */}
          <div className="flex w-full min-w-0 flex-col gap-[8px] sm:flex-row sm:flex-wrap sm:items-stretch sm:gap-[8px] lg:w-auto lg:flex-nowrap lg:items-center lg:gap-[8px]">
          {/* 2. Opções */}
          <div className="flex shrink-0 items-center">
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-[40px] gap-[8px] border-[var(--color-border)] px-[14px] shadow-sm hover:bg-[var(--color-accent)]"
                    title="Opções da sprint"
                  >
                    <Settings className="h-[18px] w-[18px] shrink-0 text-[var(--color-muted-foreground)]" />
                    <span className="hidden text-sm font-medium sm:inline">Opções</span>
                    <ChevronDown className="h-[16px] w-[16px] shrink-0 opacity-60" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-[min(100vw-24px,300px)] overflow-hidden p-0">
                  <div className="border-b border-[var(--color-border)] bg-[var(--color-muted)]/25 px-3 py-2.5">
                    <p className="text-sm font-semibold text-[var(--color-foreground)]">Sprint</p>
                    <p className="mt-0.5 text-[11px] leading-tight text-[var(--color-muted-foreground)]">
                      Visualização da página e exportação dos cards
                    </p>
                  </div>
                  <div className="p-1.5">
                    <p className="mb-1 px-2 pt-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)]">
                      Modo de visualização
                    </p>
                    <DropdownMenuItem
                      className="gap-2 rounded-md py-2.5"
                      onClick={() => setViewMode('kanban')}
                    >
                      <LayoutGrid className="h-4 w-4 shrink-0 text-[var(--color-primary)]" />
                      <span className="flex-1 text-left font-medium">Kanban</span>
                      {viewMode === 'kanban' ? (
                        <Check className="h-4 w-4 shrink-0 text-[var(--color-primary)]" />
                      ) : (
                        <span className="h-4 w-4 shrink-0" aria-hidden />
                      )}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="gap-2 rounded-md py-2.5"
                      onClick={() => setViewMode('lista')}
                    >
                      <List className="h-4 w-4 shrink-0 text-[var(--color-primary)]" />
                      <span className="flex-1 text-left font-medium">Lista</span>
                      {viewMode === 'lista' ? (
                        <Check className="h-4 w-4 shrink-0 text-[var(--color-primary)]" />
                      ) : (
                        <span className="h-4 w-4 shrink-0" aria-hidden />
                      )}
                    </DropdownMenuItem>

                    <DropdownMenuSeparator className="my-2" />
                    <label className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-2.5 text-sm text-[var(--color-foreground)] transition-colors hover:bg-[var(--color-accent)]">
                      <input
                        type="checkbox"
                        className="h-4 w-4 shrink-0 rounded border-[var(--color-border)] accent-[var(--color-primary)]"
                        checked={showPriorityColorsOnCards}
                        onChange={(e) => setShowPriorityColorsOnCards(e.target.checked)}
                      />
                      <span className="flex-1 text-left leading-snug">
                        Exibir cores de prioridade nos cards
                      </span>
                    </label>

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
                      Exportar cards
                    </p>
                    <p className="mb-2 px-2 text-[11px] leading-snug text-[var(--color-muted-foreground)]">
                      Usa os filtros atuais e as colunas marcadas na lista.
                    </p>
                    <DropdownMenuItem
                      className="gap-2 rounded-md py-2.5"
                      onClick={() => handleExportCSV(',')}
                      disabled={
                        visibleCardsForList.length === 0 || selectedColumnDefsSafe.length === 0
                      }
                    >
                      <FileSpreadsheet className="h-4 w-4 shrink-0 text-green-600" />
                      <span className="flex-1 text-left">{'CSV separado por ","'}</span>
                      <Download className="h-3.5 w-3.5 shrink-0 opacity-50" />
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="gap-2 rounded-md py-2.5"
                      onClick={() => handleExportCSV(';')}
                      disabled={
                        visibleCardsForList.length === 0 || selectedColumnDefsSafe.length === 0
                      }
                    >
                      <FileSpreadsheet className="h-4 w-4 shrink-0 text-green-600" />
                      <span className="flex-1 text-left">{'CSV separado por ";"'}</span>
                      <Download className="h-3.5 w-3.5 shrink-0 opacity-50" />
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="gap-2 rounded-md py-2.5"
                      onClick={() => {
                        void handleExportXLSX();
                      }}
                      disabled={
                        visibleCardsForList.length === 0 || selectedColumnDefsSafe.length === 0
                      }
                    >
                      <FileSpreadsheet className="h-4 w-4 shrink-0 text-emerald-700" />
                      <span className="flex-1 text-left">Planilha (.xlsx)</span>
                      <Download className="h-3.5 w-3.5 shrink-0 opacity-50" />
                    </DropdownMenuItem>
                  </div>
                </DropdownMenuContent>
              </DropdownMenu>
          </div>

          {/* 3. Status */}
            <div
              className="min-w-0 w-full shrink-0 sm:min-w-0 sm:w-[min(100%,var(--status-filter-trigger-w))] lg:w-[var(--status-filter-trigger-w)] lg:min-w-[var(--status-filter-trigger-w)] lg:max-w-[var(--status-filter-trigger-w)]"
              style={
                {
                  ['--status-filter-trigger-w' as string]: `${STATUS_FILTER_TRIGGER_CH}ch`,
                } as React.CSSProperties
              }
            >
              {/* block w-full: wrapper do menu era inline-block e encolhia o botão dentro da div com largura fixa */}
              <DropdownMenu className="block w-full min-w-0 max-w-full">
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    className="flex h-[40px] w-full min-w-0 max-w-full justify-between gap-2 border-[var(--color-border)] px-3 font-normal shadow-sm hover:bg-[var(--color-accent)]"
                  >
                    <span className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
                      <Filter className="h-4 w-4 shrink-0 text-[var(--color-muted-foreground)]" />
                      <span className="min-w-0 truncate text-left text-sm whitespace-nowrap">
                        {projectStatusFilter
                          ? CARD_STATUSES.find((s) => s.value === projectStatusFilter)?.label ??
                            'Status'
                          : 'Todos os status'}
                      </span>
                    </span>
                    <ChevronDown className="h-4 w-4 shrink-0 opacity-60" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  className="w-[min(100vw-24px,max(260px,var(--status-filter-trigger-w)))] p-0"
                  style={
                    {
                      ['--status-filter-trigger-w' as string]: `${STATUS_FILTER_TRIGGER_CH}ch`,
                    } as React.CSSProperties
                  }
                >
                  <div className="border-b border-[var(--color-border)] bg-[var(--color-muted)]/25 px-3 py-2">
                    <p className="text-xs font-semibold text-[var(--color-foreground)]">
                      Filtrar por status do card
                    </p>
                  </div>
                  <div className="max-h-[280px] overflow-y-auto p-1.5">
                    <DropdownMenuItem
                      className="gap-2 rounded-md py-2.5"
                      onClick={() => setProjectStatusFilter('')}
                    >
                      <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                        {!projectStatusFilter ? (
                          <Check className="h-4 w-4 text-[var(--color-primary)]" />
                        ) : null}
                      </span>
                      <span className="flex-1 text-left font-medium">Todos os status</span>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator className="my-1.5" />
                    {CARD_STATUSES.map((st) => (
                      <DropdownMenuItem
                        key={st.value}
                        className="gap-2 rounded-md py-2.5"
                        onClick={() => setProjectStatusFilter(st.value)}
                      >
                        <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                          {projectStatusFilter === st.value ? (
                            <Check className="h-4 w-4 text-[var(--color-primary)]" />
                          ) : null}
                        </span>
                        <span className="flex-1 text-left">{st.label}</span>
                      </DropdownMenuItem>
                    ))}
                  </div>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          {/* 4. Desenvolvedores */}
            <div className="min-w-0 w-full shrink-0 sm:w-[220px] sm:max-w-full lg:w-[220px] lg:max-w-[220px]">
              <UserSelect
                users={users.filter((u) => u.role !== 'admin')}
                value={projectDeveloperFilter}
                onChange={setProjectDeveloperFilter}
                placeholder="Todos os responsáveis"
              />
            </div>
          {/* 5. Filtros */}
          <div className="flex shrink-0 items-center">
            <Button
              type="button"
              variant={showCardFilters ? 'default' : 'outline'}
              onClick={() => setShowCardFilters(!showCardFilters)}
              className="flex h-[40px] items-center gap-2 px-4 whitespace-nowrap shadow-sm"
            >
              <SlidersHorizontal className="h-4 w-4 shrink-0" />
              Filtros
            </Button>
          </div>
          </div>
        </div>

        {/* Filters Panel */}
        {showCardFilters && (
          <div className="space-y-[16px] p-[16px] bg-[var(--color-muted)]/30 rounded-[12px] border border-[var(--color-border)]">
            {/* Card Sort Options */}
            <div className="space-y-[12px]">
              <h3 className="text-sm font-semibold text-[var(--color-foreground)]">Ordenar Cards</h3>
              <div className="flex flex-wrap gap-[8px]">
                <span className="text-sm text-[var(--color-muted-foreground)] mr-[8px] self-center">Ordenar por:</span>
                <Button
                  variant={cardSortField === 'nome' ? "default" : "outline"}
                  size="sm"
                  onClick={() => handleCardSort('nome')}
                  className="flex items-center gap-[4px]"
                >
                  Nome
                  {getCardSortIcon('nome')}
                </Button>
                <Button
                  variant={cardSortField === 'created_at' ? "default" : "outline"}
                  size="sm"
                  onClick={() => handleCardSort('created_at')}
                  className="flex items-center gap-[4px]"
                >
                  Data de Criação
                  {getCardSortIcon('created_at')}
                </Button>
                <Button
                  variant={cardSortField === 'responsavel_name' ? "default" : "outline"}
                  size="sm"
                  onClick={() => handleCardSort('responsavel_name')}
                  className="flex items-center gap-[4px]"
                >
                  Responsável
                  {getCardSortIcon('responsavel_name')}
                </Button>
                <Button
                  variant={cardSortField === 'prioridade' ? "default" : "outline"}
                  size="sm"
                  onClick={() => handleCardSort('prioridade')}
                  className="flex items-center gap-[4px]"
                >
                  Prioridade
                  {getCardSortIcon('prioridade')}
                </Button>
                <Button
                  variant={cardSortField === 'status' ? "default" : "outline"}
                  size="sm"
                  onClick={() => handleCardSort('status')}
                  className="flex items-center gap-[4px]"
                >
                  Status
                  {getCardSortIcon('status')}
                </Button>
                <Button
                  variant={cardSortField === 'area' ? "default" : "outline"}
                  size="sm"
                  onClick={() => handleCardSort('area')}
                  className="flex items-center gap-[4px]"
                >
                  Área
                  {getCardSortIcon('area')}
                </Button>
                <Button
                  variant={cardSortField === 'tipo' ? "default" : "outline"}
                  size="sm"
                  onClick={() => handleCardSort('tipo')}
                  className="flex items-center gap-[4px]"
                >
                  Tipo
                  {getCardSortIcon('tipo')}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Kanban de Projetos */}
      {viewMode === 'kanban' && (
      <div className="flex-1 min-h-0 flex flex-col">
        {sprintProjects.length === 0 ? (
          <Card className="flex-1">
            <CardContent className="flex flex-col items-center justify-center h-full py-[48px]">
              <LayoutGrid className="h-[48px] w-[48px] text-[var(--color-muted-foreground)] mb-[16px]" />
              <p className="text-lg font-medium text-[var(--color-foreground)]">
                Nenhum projeto nesta sprint
              </p>
              <p className="text-[var(--color-muted-foreground)] mb-[16px]">
                {canCreate 
                  ? 'Clique em "Novo Projeto" para criar o primeiro.' 
                  : 'Os projetos aparecerão aqui.'}
              </p>
              {canCreate && (
                <Button 
                  onClick={openCreateProjectDialog}
                  disabled={sprint && isSprintFinished(sprint)}
                  className={sprint && isSprintFinished(sprint) ? 'opacity-50 cursor-not-allowed' : ''}
                >
                  {sprint && isSprintFinished(sprint) ? (
                    <>
                      <Lock className="mr-[8px] h-[16px] w-[16px]" />
                      Criar Projeto
                    </>
                  ) : (
                    <>
                      <Plus className="mr-[8px] h-[16px] w-[16px]" />
                      Criar Projeto
                    </>
                  )}
                </Button>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="flex gap-[16px] overflow-x-auto pb-[16px] flex-1 min-h-0">
            {sprintProjects
              .filter((project) => {
                // Ocultar projetos especiais do Kanban da sprint
                const normalizedName = normalizeProjectName(project.nome || '');
                if (normalizedName === 'sugestoes' || normalizedName === 'suporte') return false;

                // Se há busca ativa, verificar se o projeto ou algum card corresponde
                if (cardSearchQuery.trim()) {
                  const query = cardSearchQuery.toLowerCase();
                  const projectName = project.nome.toLowerCase();
                  
                  // Se o nome do projeto corresponde, mostrar o projeto
                  if (projectName.includes(query)) {
                    return true;
                  }
                  
                  // Se algum card do projeto corresponde, mostrar o projeto
                  const projectCards = getCardsForProject(project.id);
                  const hasMatchingCard = projectCards.some(
                    (card) =>
                      card.nome.toLowerCase().includes(query) ||
                      (card.descricao && card.descricao.toLowerCase().includes(query)) ||
                      (card.responsavel_name && card.responsavel_name.toLowerCase().includes(query)) ||
                      (card.area_display && card.area_display.toLowerCase().includes(query)) ||
                      (card.tipo_display && card.tipo_display.toLowerCase().includes(query))
                  );
                  
                  return hasMatchingCard;
                }
                
                // Se há outros filtros ativos (status ou desenvolvedor), mostrar apenas projetos com cards que correspondem
                if (projectStatusFilter || projectDeveloperFilter) {
                  const projectCards = getCardsForProject(project.id);
                  const filteredCards = getFilteredAndSortedCards(projectCards);
                  return filteredCards.length > 0;
                }
                
                // Se não há filtros, mostrar todos os projetos
                return true;
              })
              .map((project) => {
              const projectCards = getCardsForProject(project.id);
              const filteredCards = getFilteredAndSortedCards(projectCards);
              
              // Debug: Log para projetos específicos
              if (project.nome.toLowerCase().includes('certidões') || project.nome.toLowerCase().includes('certidoes') ||
                  project.nome.toLowerCase().includes('portalbwa')) {
                const allCardsForProject = cards.filter(c => {
                  const cardProjeto = String(c.projeto || '');
                  const projectId = String(project.id || '');
                  return cardProjeto === projectId;
                });
                const cardsByStatus = allCardsForProject.reduce((acc, card) => {
                  acc[card.status] = (acc[card.status] || 0) + 1;
                  return acc;
                }, {} as Record<string, number>);
                console.log(`Projeto ${project.nome} - Debug:`, {
                  projectId: project.id,
                  projectIdType: typeof project.id,
                  projectName: project.nome,
                  allCards: cards.length,
                  allCardsForProject: allCardsForProject.length,
                  projectCards: projectCards.length,
                  filteredCards: filteredCards.length,
                  cardsByStatus: cardsByStatus,
                  activeFilters: {
                    cardSearchQuery: cardSearchQuery,
                    projectStatusFilter: projectStatusFilter,
                    projectDeveloperFilter: projectDeveloperFilter
                  },
                  filteredCardsByStatus: filteredCards.reduce((acc, card) => {
                    acc[card.status] = (acc[card.status] || 0) + 1;
                    return acc;
                  }, {} as Record<string, number>),
                  allCardsList: allCardsForProject.map(c => ({ 
                    id: c.id, 
                    nome: c.nome, 
                    status: c.status,
                    projeto: c.projeto,
                    projetoType: typeof c.projeto
                  }))
                });
              }
              
              // Etapas configuradas para este projeto (ordem definida pelo supervisor)
              const configuredStages =
                projectKanbanStagesByProjectId[String(project.id)]?.length
                  ? projectKanbanStagesByProjectId[String(project.id)]
                  : DEFAULT_SPRINT_STAGE_CONFIGS;

              return (
                <div
                  key={project.id}
                  className="flex-shrink-0 w-[320px] bg-[var(--color-muted)]/30 rounded-[12px] border border-[var(--color-border)] flex flex-col h-full"
                >
                  {/* Header da Coluna (Projeto) */}
                  <div 
                    className="p-[16px] border-b border-[var(--color-border)] cursor-pointer hover:bg-[var(--color-muted)]/50 transition-colors"
                    onClick={() => navigate(ROUTES.projeto(String(project.id)))}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-[12px] flex-1">
                        <div className="flex h-[32px] w-[32px] items-center justify-center rounded-[8px] bg-[var(--color-primary)]/10">
                          <FolderKanban className="h-[16px] w-[16px] text-[var(--color-primary)]" />
                        </div>
                        <div className="flex-1">
                          <h3 className="font-semibold text-[var(--color-foreground)]">
                            {project.nome}
                          </h3>
                          <span className="text-xs text-[var(--color-muted-foreground)]">
                            {(cardSearchQuery || projectStatusFilter || projectDeveloperFilter)
                              ? `${filteredCards.length} de ${projectCards.length} cards`
                              : `${projectCards.length} cards`}
                          </span>
                        </div>
                      </div>
                      <div className="flex gap-[4px]" onClick={(e) => e.stopPropagation()}>
                        {canCreate && !isProjectFromFinishedSprint(project) && (
                          <>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={(e) => openEditProjectDialog(e, project)}
                              className="h-[28px] w-[28px]"
                            >
                              <Pencil className="h-[14px] w-[14px]" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={(e) => handleDeleteProject(e, project.id)}
                              className="h-[28px] w-[28px]"
                            >
                              <Trash2 className="h-[14px] w-[14px] text-red-500" />
                            </Button>
                          </>
                        )}
                        {canCreateCard && !isProjectFromFinishedSprint(project) && (
                          <Button
                            variant="default"
                            size="sm"
                            onClick={() => openCreateCardDialog(project.id)}
                            className="h-[28px] px-3"
                            title="Adicionar card"
                          >
                            <Plus className="h-[14px] w-[14px] mr-1" />
                            Card
                          </Button>
                        )}
                      </div>
                    </div>
                    {project.desenvolvedor_name && (
                      <div className="flex items-center gap-[4px] mt-[8px] text-xs text-[var(--color-muted-foreground)]">
                        <Users className="h-[12px] w-[12px]" />
                        {project.desenvolvedor_name}
                      </div>
                    )}
                  </div>

                  {/* Cards do Projeto */}
                  <div className="p-[16px] space-y-[16px] flex-1 min-h-0 overflow-y-auto">
                    {configuredStages.map((stage) => {
                      const stageCards = filteredCards.filter((card) => card.status === stage.id);
                      return (
                        <div key={stage.id} className="space-y-[8px]">
                          <h4 className="text-xs font-semibold text-[var(--color-muted-foreground)] uppercase tracking-wide px-[4px]">
                            {stage.label}
                          </h4>
                          <div className="space-y-[8px]">
                            {stageCards.length > 0 ? (
                              stageCards.map(renderCard)
                            ) : (
                              <div className="text-center py-[16px] text-xs text-[var(--color-muted-foreground)]">
                                Nenhum card
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      )}

      {/* Lista de Cards */}
      {viewMode === 'lista' && (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {sprintProjectsNoSuggestions.length === 0 ? (
            <Card className="flex-1">
              <CardContent className="flex flex-col items-center justify-center h-full py-[48px]">
                <LayoutGrid className="h-[48px] w-[48px] text-[var(--color-muted-foreground)] mb-[16px]" />
                <p className="text-lg font-medium text-[var(--color-foreground)]">
                  Nenhum projeto nesta sprint
                </p>
                <p className="text-[var(--color-muted-foreground)] mb-[16px] text-center">
                  {canCreate
                    ? 'Clique em "Novo Projeto" para criar o primeiro.'
                    : 'Os projetos aparecerão aqui.'}
                </p>
                {canCreate && (
                  <Button
                    onClick={openCreateProjectDialog}
                    disabled={sprint && isSprintFinished(sprint)}
                  >
                    {sprint && isSprintFinished(sprint) ? (
                      <>
                        <Lock className="mr-[8px] h-[16px] w-[16px]" />
                        Criar Projeto
                      </>
                    ) : (
                      <>
                        <Plus className="mr-[8px] h-[16px] w-[16px]" />
                        Criar Projeto
                      </>
                    )}
                  </Button>
                )}
              </CardContent>
            </Card>
          ) : (
            <div className="flex flex-col flex-1 min-h-0 min-w-0">
              {/* Tabela/lista: só esta área rola; barra horizontal fica visível na base da viewport */}
              <div className="flex flex-col flex-1 min-h-0 min-w-0 mt-[16px] px-[8px] pb-[8px]">
                {selectedColumnDefsSafe.length === 0 ? (
                  <div className="flex flex-1 min-h-0 items-center justify-center text-center px-[16px] text-sm text-[var(--color-muted-foreground)]">
                    Selecione ao menos uma coluna em <span className="font-semibold">Selecionar colunas</span>.
                  </div>
                ) : visibleCardsForList.length === 0 ? (
                  <div className="flex flex-1 min-h-0 items-center justify-center text-center px-[16px] text-sm text-[var(--color-muted-foreground)]">
                    Nenhum card na lista (com os filtros atuais).
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
                                    colExpanded ? 'bg-[var(--color-primary)]/12' : 'bg-[var(--color-muted)]/35',
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
                          {visibleCardsForList.map((card) => (
                            <tr
                              key={card.id}
                              className="border-b border-[var(--color-border)] hover:bg-[var(--color-muted)]/20 cursor-pointer"
                              onClick={(e) => openEditCardDialog(e, card)}
                            >
                              {selectedColumnDefsSafe.map((col) => {
                                const text = formatColumnValueForDisplay(col.getValue({ card }));
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
          )}
        </div>
      )}

      {/* Modal: Selecionar colunas — wrapper largo para 5 colunas por linha */}
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
                Card, depois Projeto, depois Sprint — até 5 opções por linha em cada bloco. As marcas valem para a
                lista e para CSV/XLSX.
              </DialogDescription>
            </DialogHeader>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setSelectedColumnIds(SPRINT_CARDS_COLUMN_IDS)}
              >
                Marcar todos
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setSelectedColumnIds([])}
              >
                Desmarcar todos
              </Button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
            <div className="flex flex-col gap-6">
              {(['card', 'projeto', 'sprint'] as const).map((group) => {
                const groupColumns = getColumnDefsByGroup(group);
                const title =
                  group === 'card' ? 'Card' : group === 'projeto' ? 'Projeto' : 'Sprint';
                const groupIds = groupColumns.map((c) => c.id);
                const toggleGroup = (checked: boolean) => {
                  setSelectedColumnIds((prev) => {
                    const set = new Set(prev);
                    if (checked) {
                      groupIds.forEach((id) => set.add(id));
                    } else {
                      groupIds.forEach((id) => set.delete(id));
                    }
                    return SPRINT_CARDS_COLUMN_DEFS.map((c) => c.id).filter((id) => set.has(id));
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

      {/* Sprint Dialog */}
      <Dialog open={sprintDialogOpen} onOpenChange={setSprintDialogOpen}>
        <DialogContent onClose={() => setSprintDialogOpen(false)}>
          <DialogHeader>
            <DialogTitle>Editar Sprint</DialogTitle>
            <DialogDescription>
              Atualize o nome, o instante de início e o instante de fechamento.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSprintSubmit} className="space-y-[16px] mt-[16px]">
            <div className="space-y-[8px]">
              <Label htmlFor="sprint-nome">Nome da Sprint</Label>
              <Input
                id="sprint-nome"
                placeholder="Ex: Sprint 1 - Janeiro"
                value={sprintFormData.nome}
                onChange={(e) => setSprintFormData({ ...sprintFormData, nome: e.target.value })}
                required
              />
            </div>

            <div className="space-y-[8px]">
              <Label htmlFor="sprint-detail-data-inicio">Data e hora de início</Label>
              <Input
                id="sprint-detail-data-inicio"
                type="datetime-local"
                value={sprintFormData.data_inicio}
                onChange={(e) => {
                  setSprintFormData((prev) => ({ ...prev, data_inicio: e.target.value }));
                  if (e.target.value && sprintFormError) setSprintFormError('');
                }}
                required
              />
            </div>
            <div className="space-y-[8px]">
              <Label htmlFor="sprint-detail-fechamento">Data e hora de fechamento</Label>
              <Input
                id="sprint-detail-fechamento"
                type="datetime-local"
                value={sprintFormData.fechamento_em}
                onChange={(e) => {
                  setSprintFormData((prev) => ({ ...prev, fechamento_em: e.target.value }));
                  if (e.target.value && sprintFormError) setSprintFormError('');
                }}
                required
              />
              <SprintPeriodHelpNote showPrioritiesLink={canCreate} />
            </div>

            {sprintFormError && (
              <div className="p-[8px] text-sm text-[var(--color-destructive)] bg-red-50 border border-red-200 rounded-[8px]">
                {sprintFormError}
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setSprintDialogOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={sprintFormLoading}>
                {sprintFormLoading ? (
                  <>
                    <Loader2 className="mr-[8px] h-[16px] w-[16px] animate-spin" />
                    Salvando...
                  </>
                ) : (
                  'Salvar Alterações'
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Project Dialog */}
      <Dialog open={projectDialogOpen} onOpenChange={setProjectDialogOpen}>
        <DialogContent onClose={() => setProjectDialogOpen(false)}>
          <DialogHeader>
            <DialogTitle>
              {editingProject ? 'Editar Projeto' : 'Novo Projeto'}
            </DialogTitle>
            <DialogDescription>
              {editingProject
                ? 'Atualize as informações do projeto.'
                : `Crie um novo projeto na sprint "${sprint.nome}".`}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleProjectSubmit} className="space-y-[16px] mt-[16px]">
            <div className="space-y-[8px]">
              <Label htmlFor="project-nome">Nome do Projeto</Label>
              <Input
                id="project-nome"
                placeholder="Ex: Certidões"
                value={projectFormData.nome}
                onChange={(e) => setProjectFormData({ ...projectFormData, nome: e.target.value })}
                required
              />
            </div>

            <div className="space-y-[8px]">
              <Label htmlFor="project-descricao">Descrição</Label>
              <Textarea
                id="project-descricao"
                placeholder="Descreva o projeto..."
                value={projectFormData.descricao}
                onChange={(e) => setProjectFormData({ ...projectFormData, descricao: e.target.value })}
                rows={4}
              />
            </div>

            {projectFormError && (
              <div className="p-[8px] text-sm text-[var(--color-destructive)] bg-red-50 border border-red-200 rounded-[8px]">
                {projectFormError}
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setProjectDialogOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={projectFormLoading}>
                {projectFormLoading ? (
                  <>
                    <Loader2 className="mr-[8px] h-[16px] w-[16px] animate-spin" />
                    Salvando...
                  </>
                ) : editingProject ? (
                  'Salvar Alterações'
                ) : (
                  'Criar Projeto'
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Card Dialog */}
      <Dialog
        open={cardDialogOpen}
        reserveRightPx={editingCard && logsModalOpen ? CARD_TIMELINE_LAYOUT_RESERVE_PX : undefined}
        onOpenChange={(open) => {
          if (open) {
            setCardDialogOpen(true);
          } else {
            closeCardDialog();
          }
        }}
      >
        <DialogContent onClose={closeCardDialog} className="max-w-[600px]">
          <DialogHeader>
            <DialogTitle>
              {editingCard 
                ? (editingCard.status === 'finalizado' || editingCard.status === 'inviabilizado')
                  ? 'Visualizar Card'
                  : 'Editar Card'
                : 'Novo Card'}
            </DialogTitle>
            <DialogDescription>
              {editingCard
                ? (editingCard.status === 'finalizado' || editingCard.status === 'inviabilizado')
                  ? 'Visualize as informações do card. Cards finalizados não podem ser editados.'
                  : 'Atualize as informações do card.'
                : 'Crie um novo card neste projeto.'}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCardSubmit} className="space-y-[16px] mt-[16px] max-h-[70vh] overflow-y-auto pr-[8px]" noValidate>
            {editingCard && (editingCard.status === 'finalizado' || editingCard.status === 'inviabilizado') && (
              <div className="p-[12px] text-sm text-[var(--color-muted-foreground)] bg-[var(--color-muted)]/30 border border-[var(--color-border)] rounded-[8px]">
                Este card está {editingCard.status === 'finalizado' ? 'finalizado' : 'inviabilizado'} e não pode ser editado.
              </div>
            )}
            <div className="space-y-[8px]">
              <Label htmlFor="card-nome">Nome do Card *</Label>
              <Input
                id="card-nome"
                placeholder="Ex: Certidões PE"
                value={cardFormData.nome}
                onChange={(e) => setCardFormData({ ...cardFormData, nome: e.target.value })}
                required
                disabled={!!(editingCard && (editingCard.status === 'finalizado' || editingCard.status === 'inviabilizado'))}
              />
            </div>

            <div className="space-y-[8px]">
              <Label htmlFor="card-descricao">Descrição / Instruções</Label>
              <Textarea
                id="card-descricao"
                placeholder="Descreva o card, instruções detalhadas, requisitos, etc..."
                value={cardFormData.descricao}
                onChange={(e) => setCardFormData({ ...cardFormData, descricao: e.target.value })}
                rows={4}
                disabled={!!(editingCard && (editingCard.status === 'finalizado' || editingCard.status === 'inviabilizado'))}
              />
            </div>

            {/* ── Links do Card ─────────────────────────────────── */}
            <div className="space-y-[12px] rounded-lg border border-[var(--color-border)] p-[12px]">
              <div className="space-y-[6px]">
                <Label htmlFor="card-script_url">Link do Script</Label>
                <div className="flex items-center gap-[6px]">
                  <Input
                    id="card-script_url"
                    type="url"
                    placeholder="https://exemplo.com/script..."
                    value={cardFormData.script_url}
                    onChange={(e) => setCardFormData({ ...cardFormData, script_url: e.target.value })}
                    disabled={!!(editingCard && (editingCard.status === 'finalizado' || editingCard.status === 'inviabilizado'))}
                    className="flex-1"
                  />
                  {cardFormData.script_url &&
                    !(!!(editingCard && (editingCard.status === 'finalizado' || editingCard.status === 'inviabilizado'))) && (
                      <button
                        type="button"
                        onClick={() => setCardFormData({ ...cardFormData, script_url: '' })}
                        className="shrink-0 rounded p-[4px] text-[var(--color-muted-foreground)] hover:bg-[var(--color-destructive)]/10 hover:text-[var(--color-destructive)]"
                        title="Remover link do script"
                      >
                        <XCircle className="h-[16px] w-[16px]" />
                      </button>
                    )}
                </div>
                {cardFormData.script_url && (
                  <a
                    href={normalizeExternalUrl(cardFormData.script_url)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-[4px] text-xs text-[var(--color-primary)] underline underline-offset-2 hover:opacity-75 break-all"
                  >
                    <ExternalLink className="h-[11px] w-[11px] shrink-0" />
                    {cardFormData.script_url}
                  </a>
                )}
              </div>

              <div className="border-t border-[var(--color-border)]" />

              <div className="space-y-[6px]">
                <Label>Links adicionais</Label>

                {cardLinks.length > 0 && (
                  <div className="space-y-[4px]">
                    {cardLinks.map((link, idx) => (
                      <div key={idx} className="flex items-center gap-[6px] rounded-md bg-[var(--color-accent)] px-[10px] py-[6px]">
                        <ExternalLink className="h-[13px] w-[13px] shrink-0 text-[var(--color-primary)]" />
                        <a
                          href={normalizeExternalUrl(link.url)}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={link.url}
                          className="flex-1 truncate text-sm text-[var(--color-primary)] underline underline-offset-2 hover:opacity-75"
                        >
                          {link.label.trim() ? link.label : link.url}
                        </a>
                        {!(!!(editingCard && (editingCard.status === 'finalizado' || editingCard.status === 'inviabilizado'))) && (
                          <button
                            type="button"
                            onClick={() => handleRemoveCardLink(idx)}
                            className="shrink-0 rounded p-[2px] text-[var(--color-muted-foreground)] hover:bg-[var(--color-destructive)]/10 hover:text-[var(--color-destructive)]"
                            title="Remover"
                          >
                            <XCircle className="h-[14px] w-[14px]" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {!(!!(editingCard && (editingCard.status === 'finalizado' || editingCard.status === 'inviabilizado'))) && (
                  <div className="space-y-[6px]">
                    <Input
                      type="url"
                      placeholder="URL do link (obrigatório)"
                      value={newLinkUrl}
                      onChange={(e) => setNewLinkUrl(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddCardLink(); } }}
                    />
                    <div className="flex gap-[6px]">
                      <Input
                        placeholder="Apelido (opcional)"
                        value={newLinkLabel}
                        onChange={(e) => setNewLinkLabel(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddCardLink(); } }}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="shrink-0 gap-[4px]"
                        disabled={!newLinkUrl.trim()}
                        onClick={handleAddCardLink}
                      >
                        <Plus className="h-[13px] w-[13px]" />
                        Adicionar link
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-[16px]">
              <div className="space-y-[8px]">
                <Label htmlFor="card-area">Área *</Label>
                <select
                  id="card-area"
                  className="flex h-[40px] w-full rounded-[8px] border border-[var(--color-input)] bg-[var(--color-background)] px-[12px] py-[8px] text-sm ring-offset-[var(--color-background)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  value={cardFormData.area || ''}
                  onChange={(e) => {
                    const newArea = e.target.value;
                    setCardFormData({ ...cardFormData, area: newArea });
                    // Atualizar timeEstimates com os TODOs da área selecionada
                    const todos = getTodosByArea(newArea);
                    if (todos.length > 0) {
                      setTimeEstimates(todos.map(todo => ({
                        id: todo.id,
                        label: todo.label,
                        hours: todo.hours,
                        isDevelopment: todo.id.includes('desenvolvimento')
                      })));
                      // Limpar seleções anteriores
                      setSelectedTimeItems(new Set());
                      setSelectedDevelopment(null);
                    } else {
                      // Se não houver TODOs para a área, limpar
                      setTimeEstimates([]);
                      setSelectedTimeItems(new Set());
                      setSelectedDevelopment(null);
                    }
                  }}
                  required
                  disabled={!!(editingCard && (editingCard.status === 'finalizado' || editingCard.status === 'inviabilizado'))}
                >
                  <option value="" disabled hidden>Selecionar área</option>
                  {CARD_AREAS.map((area) => (
                    <option key={area.value} value={area.value}>{area.label}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-[8px]">
                <Label htmlFor="card-tipo">Tipo *</Label>
                <select
                  id="card-tipo"
                  className="flex h-[40px] w-full rounded-[8px] border border-[var(--color-input)] bg-[var(--color-background)] px-[12px] py-[8px] text-sm ring-offset-[var(--color-background)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  value={cardFormData.tipo}
                  onChange={(e) => setCardFormData({ ...cardFormData, tipo: e.target.value })}
                  required
                  disabled={!!(editingCard && (editingCard.status === 'finalizado' || editingCard.status === 'inviabilizado'))}
                >
                  {CARD_TYPES.map((tipo) => (
                    <option key={tipo.value} value={tipo.value}>{tipo.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-[16px]">
              <div className="space-y-[8px]">
                <Label htmlFor="card-prioridade">Prioridade *</Label>
                <select
                  id="card-prioridade"
                  className="flex h-[40px] w-full rounded-[8px] border border-[var(--color-input)] bg-[var(--color-background)] px-[12px] py-[8px] text-sm ring-offset-[var(--color-background)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  value={cardFormData.prioridade}
                  onChange={(e) => setCardFormData({ ...cardFormData, prioridade: e.target.value })}
                  required
                  disabled={!!(editingCard && (editingCard.status === 'finalizado' || editingCard.status === 'inviabilizado'))}
                >
                  {CARD_PRIORITIES.map((prioridade) => (
                    <option key={prioridade.value} value={prioridade.value}>{prioridade.label}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-[8px]">
                <Label htmlFor="card-status">Status *</Label>
                <select
                  id="card-status"
                  className="flex h-[40px] w-full rounded-[8px] border border-[var(--color-input)] bg-[var(--color-background)] px-[12px] py-[8px] text-sm ring-offset-[var(--color-background)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  value={cardFormData.status}
                  onChange={(e) => {
                    const newStatus = e.target.value;
                    // Se mudou para em_desenvolvimento, sempre preencher data_inicio com data/hora atual
                    if (newStatus === 'em_desenvolvimento') {
                      const now = new Date();
                      // Formatar como YYYY-MM-DDTHH:mm
                      const year = now.getFullYear();
                      const month = String(now.getMonth() + 1).padStart(2, '0');
                      const day = String(now.getDate()).padStart(2, '0');
                      const hours = String(now.getHours()).padStart(2, '0');
                      const minutes = String(now.getMinutes()).padStart(2, '0');
                      const dateTimeStr = `${year}-${month}-${day}T${hours}:${minutes}`;
                      setCardFormData(prev => ({ ...prev, status: newStatus, data_inicio: dateTimeStr }));
                    } else {
                      setCardFormData({ ...cardFormData, status: newStatus });
                    }
                    // Se mudou para em_desenvolvimento e não tem data_fim mas tem estimativa, sugerir data
                    if (newStatus === 'em_desenvolvimento' && !cardFormData.data_fim) {
                      const totalHours = calculateTotalTime();
                      if (totalHours > 0) {
                        const suggestedDate = calculateSuggestedEndDate(totalHours);
                        if (suggestedDate) {
                          setCardFormData(prev => ({ ...prev, status: newStatus, data_fim: suggestedDate }));
                        }
                      }
                    }
                  }}
                  required
                  disabled={!!(editingCard && (editingCard.status === 'finalizado' || editingCard.status === 'inviabilizado'))}
                >
                  {(
                    selectedProjectForCard &&
                    projectKanbanStagesByProjectId[selectedProjectForCard]?.length
                      ? projectKanbanStagesByProjectId[selectedProjectForCard]
                      : DEFAULT_SPRINT_STAGE_CONFIGS
                  ).map((stage) => (
                    <option key={stage.id} value={stage.id}>
                      {stage.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-[8px]">
              <Label htmlFor="card-responsavel">Responsável</Label>
              <UserSelect
                users={users}
                value={cardFormData.responsavel || ''}
                onChange={(value) => setCardFormData({ ...cardFormData, responsavel: value })}
                disabled={!!(editingCard && (editingCard.status === 'finalizado' || editingCard.status === 'inviabilizado'))}
                placeholder="Selecione um responsável"
              />
            </div>

            {/* Estimar Complexidade - Menu Recolhível */}
            <div className="space-y-[8px]">
              <button
                type="button"
                onClick={() => setShowTimeEstimator(!showTimeEstimator)}
                disabled={!cardFormData.area}
                className="flex items-center justify-between w-full p-[12px] rounded-[8px] border border-[var(--color-input)] bg-[var(--color-background)] hover:bg-[var(--color-accent)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <div className="flex items-center gap-[8px]">
                  <Clock className="h-[16px] w-[16px] text-[var(--color-muted-foreground)]" />
                  <Label className="text-sm font-medium text-[var(--color-foreground)] cursor-pointer">
                    Estimar Complexidade
                    {!cardFormData.area && (
                      <span className="text-xs text-[var(--color-muted-foreground)] font-normal ml-1">
                        (selecione uma Área)
                      </span>
                    )}
                  </Label>
                  {calculateTotalTime() > 0 && (
                    <Badge variant="secondary" className="text-xs">
                      {calculateTotalTime()}h
                    </Badge>
                  )}
                </div>
                {showTimeEstimator ? (
                  <ChevronUp className="h-[16px] w-[16px] text-[var(--color-muted-foreground)]" />
                ) : (
                  <ChevronDown className="h-[16px] w-[16px] text-[var(--color-muted-foreground)]" />
                )}
              </button>

              {showTimeEstimator && (
                <div className="p-[16px] rounded-[8px] border border-[var(--color-border)] bg-[var(--color-muted)]/30 space-y-[16px]">
                  <div className="space-y-[8px]">
                    <p className="text-sm font-medium text-[var(--color-foreground)]">
                      Estimar Tempo de Desenvolvimento
                    </p>
                    {timeEstimates.map((item) => {
                      const isSelected = item.isDevelopment 
                        ? selectedDevelopment === item.id 
                        : selectedTimeItems.has(item.id);
                      
                      return (
                        <div
                          key={item.id}
                          className="flex items-center justify-between p-[12px] rounded-[8px] border border-[var(--color-input)] bg-[var(--color-background)]"
                        >
                          <span className="text-sm text-[var(--color-foreground)] flex-1">
                            {item.label}
                          </span>
                          <div className="flex items-center gap-[8px]">
                            {editingTimeItemId === item.id ? (
                              <div className="flex items-center gap-[4px]">
                                <Input
                                  type="number"
                                  value={editTimeValue}
                                  onChange={(e) => setEditTimeValue(e.target.value)}
                                  onBlur={() => saveEditedTime(item.id)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      saveEditedTime(item.id);
                                    } else if (e.key === 'Escape') {
                                      cancelEditingTime();
                                    }
                                  }}
                                  min="0"
                                  className="w-[60px] h-[32px] text-center text-sm"
                                  autoFocus
                                />
                                <span className="text-sm text-[var(--color-foreground)]">h</span>
                              </div>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  onClick={() => toggleTimeItem(item.id)}
                                  className={`flex items-center justify-center w-[48px] h-[32px] rounded-[6px] border-2 transition-all ${
                                    isSelected
                                      ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-primary)] font-bold'
                                      : 'border-[var(--color-input)] bg-[var(--color-background)] hover:border-[var(--color-primary)]/50 text-[var(--color-muted-foreground)]'
                                  }`}
                                >
                                  <span className="text-sm">
                                    {item.hours}h
                                  </span>
                                </button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => startEditingTime(item.id, item.hours)}
                                  className="h-[32px] w-[32px]"
                                >
                                  <Pencil className="h-[14px] w-[14px] text-[var(--color-muted-foreground)]" />
                                </Button>
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Tempo Personalizado */}
                  <div className="space-y-[8px] pt-[8px] border-t border-[var(--color-border)]">
                    <p className="text-sm font-medium text-[var(--color-foreground)]">
                      Tempo Personalizado
                    </p>
                    <div className="flex gap-[8px]">
                      <Input
                        type="text"
                        placeholder="Descrição"
                        value={customTimeLabel}
                        onChange={(e) => setCustomTimeLabel(e.target.value)}
                        className="flex-1"
                      />
                      <Input
                        type="number"
                        placeholder="Horas"
                        value={customTimeHours}
                        onChange={(e) => setCustomTimeHours(e.target.value)}
                        min="0"
                        className="w-[100px]"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={addCustomTime}
                        disabled={!customTimeHours || !customTimeLabel}
                        className="flex-shrink-0"
                      >
                        <Plus className="h-[16px] w-[16px]" />
                      </Button>
                    </div>
                    {customTimeItems.length > 0 && (
                      <div className="space-y-[8px] mt-[8px]">
                        {customTimeItems.map((item) => (
                          <div
                            key={item.id}
                            className="flex items-center justify-between p-[12px] rounded-[8px] border border-[var(--color-input)] bg-[var(--color-background)]"
                          >
                            <div className="flex items-center gap-[8px] flex-1">
                              <span className="text-sm text-[var(--color-foreground)]">
                                {item.label}
                              </span>
                            </div>
                            <div className="flex items-center gap-[8px]">
                              {editingTimeItemId === item.id ? (
                                <div className="flex items-center gap-[4px]">
                                  <Input
                                    type="number"
                                    value={editTimeValue}
                                    onChange={(e) => setEditTimeValue(e.target.value)}
                                    onBlur={() => saveEditedTime(item.id)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        saveEditedTime(item.id);
                                      } else if (e.key === 'Escape') {
                                        cancelEditingTime();
                                      }
                                    }}
                                    min="0"
                                    className="w-[60px] h-[32px] text-center text-sm"
                                    autoFocus
                                  />
                                  <span className="text-sm text-[var(--color-foreground)]">h</span>
                                </div>
                              ) : (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => toggleTimeItem(item.id)}
                                    className={`flex items-center justify-center w-[48px] h-[32px] rounded-[6px] border-2 transition-all ${
                                      selectedTimeItems.has(item.id)
                                        ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-primary)] font-bold'
                                        : 'border-[var(--color-input)] bg-[var(--color-background)] hover:border-[var(--color-primary)]/50 text-[var(--color-muted-foreground)]'
                                    }`}
                                  >
                                    <span className="text-sm">
                                      {item.hours}h
                                    </span>
                                  </button>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => startEditingTime(item.id, item.hours)}
                                    className="h-[32px] w-[32px]"
                                  >
                                    <Pencil className="h-[14px] w-[14px] text-[var(--color-muted-foreground)]" />
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => removeCustomTime(item.id)}
                                    className="h-[32px] w-[32px]"
                                  >
                                    <Trash2 className="h-[14px] w-[14px] text-red-500" />
                                  </Button>
                                </>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Total */}
                  {calculateTotalTime() > 0 && (
                    <div className="pt-[8px] border-t border-[var(--color-border)]">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold text-[var(--color-foreground)]">
                          Tempo Total Estimado:
                        </span>
                        <span className="text-lg font-bold text-[var(--color-primary)]">
                          {calculateTotalTime()} horas
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-[16px]">
              <div className="space-y-[8px]">
                <Label htmlFor="card-data_inicio">Data e Hora de Início</Label>
                <DateTimePicker
                  id="card-data_inicio"
                  value={cardFormData.data_inicio}
                  onChange={(e) => setCardFormData({ ...cardFormData, data_inicio: e.target.value })}
                  disabled={true}
                />
                <p className="text-xs text-[var(--color-muted-foreground)]">
                  Preenchida automaticamente com a data e hora atual
                </p>
              </div>

              <div className="space-y-[8px]">
                <Label htmlFor="card-data_fim">Data e Hora de Entrega</Label>
                <DateTimePicker
                  id="card-data_fim"
                  value={cardFormData.data_fim}
                  onChange={(e) => {
                    const newDataFim = e.target.value;
                    // Se não tem data_inicio, preencher automaticamente com data/hora atual
                    let newDataInicio = cardFormData.data_inicio;
                    if (!newDataInicio) {
                      const now = new Date();
                      const year = now.getFullYear();
                      const month = String(now.getMonth() + 1).padStart(2, '0');
                      const day = String(now.getDate()).padStart(2, '0');
                      const hours = String(now.getHours()).padStart(2, '0');
                      const minutes = String(now.getMinutes()).padStart(2, '0');
                      newDataInicio = `${year}-${month}-${day}T${hours}:${minutes}`;
                    }
                    setCardFormData({ ...cardFormData, data_fim: newDataFim, data_inicio: newDataInicio });
                  }}
                  disabled={Boolean(
                    editingCard && 
                    editingCard.status === 'em_desenvolvimento' && 
                    user?.role !== 'admin' && 
                    user?.role !== 'supervisor'
                  )}
                  suggestedDate={(() => {
                    const totalHours = calculateTotalTime();
                    if (totalHours > 0) {
                      return calculateSuggestedEndDate(totalHours);
                    }
                    return undefined;
                  })()}
                />
                {editingCard?.responsavel && String(editingCard.responsavel) === String(user?.id) && editingCard?.data_fim && (
                  <div className="flex items-center justify-end">
                    <Button
                      type="button"
                      variant="outline"
                      className="h-[40px] px-[16px] text-sm"
                      onClick={() => setDueDateRequestOpen(true)}
                    >
                      Solicitar mudança de data
                    </Button>
                  </div>
                )}
                {cardFormData.status === 'em_desenvolvimento' && (
                  <p className="text-xs text-[var(--color-muted-foreground)]">
                    * Obrigatório para cards em desenvolvimento (sugerida baseada na estimativa de complexidade)
                    {editingCard && editingCard.status === 'em_desenvolvimento' && user?.role !== 'admin' && user?.role !== 'supervisor' && (
                      <span className="block mt-1 text-[var(--color-destructive)]">
                        Apenas administradores e supervisores podem alterar a data de entrega de cards em desenvolvimento.
                      </span>
                    )}
                  </p>
                )}
              </div>
            </div>

            {cardFormError && (
              <div className="p-[8px] text-sm text-[var(--color-destructive)] bg-red-50 border border-red-200 rounded-[8px]">
                {cardFormError}
              </div>
            )}

            <RequestDueDateChangeModal
              open={dueDateRequestOpen}
              onOpenChange={setDueDateRequestOpen}
              preselectedCardId={editingCard?.id || null}
              onCreated={() => {
                void loadData();
              }}
            />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeCardDialog}>
                {(editingCard && (editingCard.status === 'finalizado' || editingCard.status === 'inviabilizado')) || (editingCard && isCardFromFinishedSprint(editingCard)) ? 'Fechar' : 'Cancelar'}
              </Button>
              {!(editingCard && (editingCard.status === 'finalizado' || editingCard.status === 'inviabilizado')) && !(editingCard && isCardFromFinishedSprint(editingCard)) && (
                <Button type="submit" disabled={cardFormLoading}>
                  {cardFormLoading ? (
                    <>
                      <Loader2 className="mr-[8px] h-[16px] w-[16px] animate-spin" />
                      Salvando...
                    </>
                  ) : editingCard ? (
                    'Salvar Alterações'
                  ) : (
                    'Criar Card'
                  )}
                </Button>
              )}
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Project Confirmation Dialog */}
      <Dialog open={deleteProjectDialogOpen} onOpenChange={setDeleteProjectDialogOpen}>
        <DialogContent onClose={() => {
          setDeleteProjectDialogOpen(false);
          setProjectToDelete(null);
        }}>
          <DialogHeader>
            <DialogTitle>Confirmar Exclusão</DialogTitle>
            <DialogDescription>
              {projectToDelete
                ? `Tem certeza que deseja excluir o projeto "${projectToDelete.nome}" e todos os seus cards? Esta ação não pode ser desfeita.`
                : 'Tem certeza que deseja excluir este projeto e todos os seus cards? Esta ação não pode ser desfeita.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setDeleteProjectDialogOpen(false);
                setProjectToDelete(null);
              }}
              disabled={deleteProjectLoading}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={confirmDeleteProject}
              disabled={deleteProjectLoading}
            >
              {deleteProjectLoading ? (
                <>
                  <Loader2 className="mr-[8px] h-[16px] w-[16px] animate-spin" />
                  Excluindo...
                </>
              ) : (
                'Excluir'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Card Confirmation Dialog */}
      <Dialog open={deleteCardDialogOpen} onOpenChange={setDeleteCardDialogOpen}>
        <DialogContent onClose={() => {
          setDeleteCardDialogOpen(false);
          setCardToDelete(null);
        }}>
          <DialogHeader>
            <DialogTitle>Confirmar Exclusão</DialogTitle>
            <DialogDescription>
              {cardToDelete
                ? `Tem certeza que deseja excluir o card "${cardToDelete.nome}"? Esta ação não pode ser desfeita.`
                : 'Tem certeza que deseja excluir este card? Esta ação não pode ser desfeita.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setDeleteCardDialogOpen(false);
                setCardToDelete(null);
              }}
              disabled={deleteCardLoading}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={confirmDeleteCard}
              disabled={deleteCardLoading}
            >
              {deleteCardLoading ? (
                <>
                  <Loader2 className="mr-[8px] h-[16px] w-[16px] animate-spin" />
                  Excluindo...
                </>
              ) : (
                'Excluir'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Finalizar Sprint Confirmation Dialog */}
      <Dialog open={finalizarDialogOpen} onOpenChange={setFinalizarDialogOpen}>
        <DialogContent
          onClose={() => {
            setFinalizarDialogOpen(false);
            setFinalizarError('');
          }}
        >
          <DialogHeader>
            <DialogTitle>Finalizar sprint</DialogTitle>
            <DialogDescription>
              {sprint
                ? `Tem certeza que deseja finalizar a sprint "${sprint.nome}"? Projetos com cards não entregues serão replicados para a próxima sprint.`
                : 'Tem certeza que deseja finalizar esta sprint? Projetos com cards não entregues serão replicados para a próxima sprint.'}
            </DialogDescription>
            {finalizarError && (
              <p className="text-sm text-red-600 mt-2">{finalizarError}</p>
            )}
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setFinalizarDialogOpen(false);
                setFinalizarError('');
              }}
              disabled={finalizarLoading}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={confirmFinalizarSprint}
              disabled={finalizarLoading}
            >
              {finalizarLoading ? (
                <>
                  <Loader2 className="mr-[8px] h-[16px] w-[16px] animate-spin" />
                  Finalizando...
                </>
              ) : (
                'Finalizar'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Sprint Confirmation Dialog */}
      <Dialog open={deleteSprintDialogOpen} onOpenChange={setDeleteSprintDialogOpen}>
        <DialogContent onClose={() => {
          setDeleteSprintDialogOpen(false);
        }}>
          <DialogHeader>
            <DialogTitle>Confirmar Exclusão</DialogTitle>
            <DialogDescription>
              {sprint
                ? `Tem certeza que deseja excluir a sprint "${sprint.nome}"? Esta ação não pode ser desfeita.`
                : 'Tem certeza que deseja excluir esta sprint? Esta ação não pode ser desfeita.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setDeleteSprintDialogOpen(false);
              }}
              disabled={deleteSprintLoading}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={confirmDeleteSprint}
              disabled={deleteSprintLoading}
            >
              {deleteSprintLoading ? (
                <>
                  <Loader2 className="mr-[8px] h-[16px] w-[16px] animate-spin" />
                  Excluindo...
                </>
              ) : (
                'Excluir'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Alert Dialog */}
      <Dialog open={alertDialogOpen} onOpenChange={setAlertDialogOpen}>
        <DialogContent onClose={() => {
          setAlertDialogOpen(false);
          setAlertMessage('');
        }}>
          <DialogHeader>
            <DialogTitle>Atenção</DialogTitle>
            <DialogDescription>
              {alertMessage}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="default"
              onClick={() => {
                setAlertDialogOpen(false);
                setAlertMessage('');
              }}
            >
              Entendi
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Card Logs Modal */}
      <CardLogsModal
        cardId={editingCard?.id || null}
        isOpen={logsModalOpen}
        onClose={() => setLogsModalOpen(false)}
        refreshTrigger={logsRefreshTrigger}
      />
    </div>
  );
}

function normalizeProjectName(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

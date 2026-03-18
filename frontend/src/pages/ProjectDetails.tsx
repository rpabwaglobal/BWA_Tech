import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DateInput } from '@/components/ui/date-input';
import { DateTimePicker } from '@/components/ui/datetime-picker';
import { RequestDueDateChangeModal } from '@/components/RequestDueDateChangeModal';
import { Textarea } from '@/components/ui/textarea';
import { UserSelect } from '@/components/ui/user-select';
import { FilterSelect } from '@/components/ui/filter-select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { userService } from '@/services/userService';
import type { User as UserType } from '@/services/userService';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  pointerWithin,
  useDroppable,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { projectService } from '@/services/projectService';
import { cardService, CARD_AREAS, CARD_TYPES, CARD_PRIORITIES } from '@/services/cardService';
import { sprintService } from '@/services/sprintService';
import { cardTodoService } from '@/services/cardTodoService';
import { kanbanStageService } from '@/services/kanbanStageService';
import type { KanbanStage as KanbanStageType } from '@/services/kanbanStageService';
import { getTodosByArea } from '@/constants/cardTodos';
import type { Project } from '@/services/projectService';
import type { Card as CardType } from '@/services/cardService';
import type { Sprint } from '@/services/sprintService';
import {
  ArrowLeft,
  FolderKanban,
  User,
  Calendar,
  Loader2,
  CheckCircle2,
  Circle,
  AlertCircle,
  XCircle,
  Clock,
  ExternalLink,
  Trash2,
  Plus,
  ChevronDown,
  ChevronUp,
  Pencil,
  Settings,
} from 'lucide-react';
import { formatDate, formatDateTime } from '@/lib/dateUtils';
import { CardLogsModal } from '@/components/CardLogsModal';
import { PendenciaModal } from '@/components/PendenciaModal';
import { ConclusaoModal } from '@/components/ConclusaoModal';
import { cardLogService } from '@/services/cardLogService';

const DEFAULT_PROJECT_STAGES = [
  {
    id: 'a_desenvolver',
    label: 'A Desenvolver',
    color: 'bg-gray-100',
    is_terminal: false,
    requires_required_data: false,
  },
  {
    id: 'em_desenvolvimento',
    label: 'Em Desenvolvimento',
    color: 'bg-blue-100',
    is_terminal: false,
    requires_required_data: true,
  },
  {
    id: 'parado_pendencias',
    label: 'Parado por Pendências',
    color: 'bg-orange-100',
    is_terminal: false,
    requires_required_data: true,
  },
  {
    id: 'em_homologacao',
    label: 'Em Homologação',
    color: 'bg-purple-100',
    is_terminal: false,
    requires_required_data: true,
  },
  {
    id: 'finalizado',
    label: 'Concluído',
    color: 'bg-green-100',
    is_terminal: true,
    requires_required_data: true,
  },
  {
    id: 'inviabilizado',
    label: 'Inviabilizado',
    color: 'bg-red-100',
    is_terminal: true,
    requires_required_data: false,
  },
];

type ProjectStage = (typeof DEFAULT_PROJECT_STAGES)[number];

function DragOverlayCard({ card }: { card: CardType }) {
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

  const getPriorityColor = (prioridade: string) => {
    switch (prioridade) {
      case 'absoluta':
        return 'border-l-red-600 bg-red-50/50 dark:border-l-red-400 dark:bg-red-500/20';
      case 'alta':
        return 'border-l-orange-500 bg-orange-50/50 dark:border-l-orange-400 dark:bg-orange-500/20';
      case 'media':
        return 'border-l-yellow-500 bg-yellow-50/50 dark:border-l-amber-300 dark:bg-amber-400/20';
      case 'baixa':
        return 'border-l-green-500 bg-green-50/50 dark:border-l-emerald-400 dark:bg-emerald-500/20';
      default:
        return 'border-l-gray-300 dark:border-l-slate-500';
    }
  };

  const getAreaBadgeColor = (area: string) => {
    switch (area) {
      case 'rpa':
        return 'bg-purple-100 text-purple-700';
      case 'frontend':
        return 'bg-blue-100 text-blue-700';
      case 'backend':
        return 'bg-green-100 text-green-700';
      case 'script':
        return 'bg-amber-100 text-amber-700';
      default:
        return 'bg-gray-100 text-gray-700';
    }
  };

  return (
    <div className={`p-[12px] bg-[var(--color-card)] rounded-[8px] border-l-[3px] shadow-2xl opacity-95 rotate-2 w-[300px] ${getPriorityColor(card.prioridade)}`}>
      <div className="flex items-start justify-between gap-[8px]">
        <div className="flex items-center gap-[8px] flex-1 min-w-0">
          {getCardStatusIcon(card.status)}
          <span className="font-medium text-sm text-[var(--color-foreground)] truncate">
            {card.nome}
          </span>
        </div>
      </div>

      {/* Badges de área e tipo */}
      <div className="flex flex-wrap gap-[4px] mt-[8px]">
        {card.area_display && (
          <span className={`text-[10px] px-[6px] py-[2px] rounded-full ${getAreaBadgeColor(card.area)}`}>
            {card.area_display}
          </span>
        )}
        {card.tipo_display && (
          <span className="text-[10px] px-[6px] py-[2px] rounded-full bg-gray-100 text-gray-700">
            {card.tipo_display}
          </span>
        )}
        {card.script_url && (
          <span className="flex items-center gap-[2px] text-[10px] px-[6px] py-[2px] rounded-full bg-blue-100 text-blue-700">
            <ExternalLink className="h-[10px] w-[10px]" />
            Script
          </span>
        )}
      </div>

      {card.descricao && (
        <p className="mt-[8px] text-xs text-[var(--color-muted-foreground)] line-clamp-2">
          {card.descricao}
        </p>
      )}

      <div className="flex items-center justify-between mt-[8px]">
        <div className="flex items-center gap-[8px]">
          {card.responsavel_name && (
            <div className="flex items-center gap-[4px] text-xs text-[var(--color-muted-foreground)]">
              <User className="h-[12px] w-[12px]" />
              {card.responsavel_name}
            </div>
          )}
          {card.data_fim && (
            <div className="flex items-center gap-[4px] text-xs text-[var(--color-muted-foreground)]">
              <Calendar className="h-[12px] w-[12px]" />
              {formatDate(card.data_fim)}
            </div>
          )}
        </div>
        {card.prioridade_display && (
          <Badge variant="secondary" className="text-[10px] px-[6px] py-0">
            {card.prioridade_display}
          </Badge>
        )}
      </div>
    </div>
  );
}

function KanbanColumn({
  stage,
  cards,
  onCardClick,
  onCardDelete,
  disabled = false,
  userRole,
}: {
  stage: ProjectStage;
  cards: CardType[];
  onCardClick: (card: CardType) => void;
  onCardDelete: (e: React.MouseEvent, cardId: string) => void;
  disabled?: boolean;
  userRole?: string;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: stage.id,
  });

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

  const getPriorityColor = (prioridade: string) => {
    switch (prioridade) {
      case 'absoluta':
        return 'border-l-red-600 bg-red-50/50 dark:border-l-red-400 dark:bg-red-500/20';
      case 'alta':
        return 'border-l-orange-500 bg-orange-50/50 dark:border-l-orange-400 dark:bg-orange-500/20';
      case 'media':
        return 'border-l-yellow-500 bg-yellow-50/50 dark:border-l-amber-300 dark:bg-amber-400/20';
      case 'baixa':
        return 'border-l-green-500 bg-green-50/50 dark:border-l-emerald-400 dark:bg-emerald-500/20';
      default:
        return 'border-l-gray-300 dark:border-l-slate-500';
    }
  };

  const getAreaBadgeColor = (area: string) => {
    switch (area) {
      case 'rpa':
        return 'bg-purple-100 text-purple-700';
      case 'frontend':
        return 'bg-blue-100 text-blue-700';
      case 'backend':
        return 'bg-green-100 text-green-700';
      case 'script':
        return 'bg-amber-100 text-amber-700';
      default:
        return 'bg-gray-100 text-gray-700';
    }
  };

  return (
    <div className="flex-shrink-0 w-[320px] flex flex-col h-full">
      <div ref={setNodeRef} className={`rounded-[12px] border-2 border-[var(--color-border)] ${stage.color}/30 transition-colors flex flex-col h-full ${
        isOver ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/5' : ''
      }`}>
        <div className="p-[16px] border-b border-[var(--color-border)] flex-shrink-0">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-[var(--color-foreground)]">
              {stage.label}
            </h3>
            <Badge variant="secondary" className="text-xs">
              {cards.length}
            </Badge>
          </div>
        </div>
        <div className="p-[16px] space-y-[8px] flex-1 min-h-0 overflow-y-auto">
          {cards.length === 0 ? (
            <div className="text-center py-[24px] text-sm text-[var(--color-muted-foreground)] min-h-[100px]">
              Nenhum card
            </div>
          ) : (
            <SortableContext items={cards.map((c) => c.id)} strategy={verticalListSortingStrategy}>
              {cards.map((card) => (
                <KanbanCard
                  key={card.id}
                  card={card}
                  onClick={() => onCardClick(card)}
                  onDelete={(e) => onCardDelete(e, card.id)}
                  getCardStatusIcon={getCardStatusIcon}
                  getPriorityColor={getPriorityColor}
                  getAreaBadgeColor={getAreaBadgeColor}
                  disabled={disabled}
                  userRole={userRole}
                />
              ))}
            </SortableContext>
          )}
        </div>
      </div>
    </div>
  );
}

function KanbanCard({
  card,
  onClick,
  onDelete,
  getCardStatusIcon,
  getPriorityColor,
  getAreaBadgeColor,
  disabled = false,
  userRole,
}: {
  card: CardType;
  onClick: () => void;
  onDelete: (e: React.MouseEvent) => void;
  getCardStatusIcon: (status: string) => React.ReactNode;
  getPriorityColor: (prioridade: string) => string;
  getAreaBadgeColor: (area: string) => string;
  disabled?: boolean;
  userRole?: string;
}) {
  // Verificar se card está finalizado ou inviabilizado
  const isCardFinished = card.status === 'finalizado' || card.status === 'inviabilizado';
  const isInviabilizado = card.status === 'inviabilizado';
  // Desabilitar drag apenas se sprint finalizada ou card finalizado
  const isDragDisabled = disabled || isCardFinished;
  // Permitir clique para visualização sempre (mesmo se sprint finalizada ou card finalizado)
  const canClick = true;
  // Permitir delete: 
  // - Se sprint não está finalizada
  // - Se card está inviabilizado, apenas admin ou supervisor podem deletar
  const canDelete = !disabled && (!isInviabilizado || userRole === 'admin' || userRole === 'supervisor');

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ 
    id: card.id,
    disabled: isDragDisabled,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition: isDragging ? 'none' : transition,
    opacity: isDragging ? 0 : isCardFinished ? 0.7 : disabled ? 0.6 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...(!isDragDisabled ? attributes : {})}
      {...(!isDragDisabled ? listeners : {})}
      className={`p-[12px] bg-[var(--color-card)] rounded-[8px] border-l-[3px] shadow-sm hover:shadow-md transition-shadow cursor-pointer group ${getPriorityColor(card.prioridade)}`}
      onClick={onClick}
    >
      <div className="flex items-start justify-between gap-[8px]">
        <div className="flex items-center gap-[8px] flex-1 min-w-0">
          {getCardStatusIcon(card.status)}
          <span className="font-medium text-sm text-[var(--color-foreground)] truncate">
            {card.nome}
          </span>
        </div>
        {canDelete && (
          <div className="flex gap-[2px] opacity-0 group-hover:opacity-100 transition-opacity">
            <Button
              variant="ghost"
              size="icon"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(e);
              }}
              className="h-[24px] w-[24px]"
            >
              <Trash2 className="h-[12px] w-[12px] text-red-500" />
            </Button>
          </div>
        )}
      </div>

      {/* Badges de área e tipo */}
      <div className="flex flex-wrap gap-[4px] mt-[8px]">
        {card.area_display && (
          <span className={`text-[10px] px-[6px] py-[2px] rounded-full ${getAreaBadgeColor(card.area)}`}>
            {card.area_display}
          </span>
        )}
        {card.tipo_display && (
          <span className="text-[10px] px-[6px] py-[2px] rounded-full bg-gray-100 text-gray-700">
            {card.tipo_display}
          </span>
        )}
        {card.script_url && (
          <a
            href={card.script_url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="flex items-center gap-[2px] text-[10px] px-[6px] py-[2px] rounded-full bg-blue-100 text-blue-700 hover:bg-blue-200 transition-colors"
          >
            <ExternalLink className="h-[10px] w-[10px]" />
            Script
          </a>
        )}
      </div>

      {card.descricao && (
        <p className="mt-[8px] text-xs text-[var(--color-muted-foreground)] line-clamp-2">
          {card.descricao}
        </p>
      )}

      <div className="flex items-center justify-between mt-[8px]">
        <div className="flex items-center gap-[8px]">
          {card.responsavel_name && (
            <div className="flex items-center gap-[4px] text-xs text-[var(--color-muted-foreground)]">
              <User className="h-[12px] w-[12px]" />
              {card.responsavel_name}
            </div>
          )}
          {card.data_fim && (
            <div className="flex items-center gap-[4px] text-xs text-[var(--color-muted-foreground)]">
              <Calendar className="h-[12px] w-[12px]" />
              {formatDate(card.data_fim)}
            </div>
          )}
        </div>
        {card.prioridade_display && (
          <Badge variant="secondary" className="text-[10px] px-[6px] py-0">
            {card.prioridade_display}
          </Badge>
        )}
      </div>
    </div>
  );
}

export default function ProjectDetails() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [project, setProject] = useState<Project | null>(null);
  const [sprint, setSprint] = useState<Sprint | null>(null);
  const [cards, setCards] = useState<CardType[]>([]);
  const [stages, setStages] = useState<ProjectStage[]>(DEFAULT_PROJECT_STAGES);
  const [users, setUsers] = useState<UserType[]>([]);
  const [loading, setLoading] = useState(true);

  // Configuração de etapas (Kanban) do projeto - apenas supervisor
  const [configProjectDialogOpen, setConfigProjectDialogOpen] = useState(false);
  const [configLoading, setConfigLoading] = useState(false);
  const [globalStages, setGlobalStages] = useState<KanbanStageType[]>([]);
  const [newStageLabel, setNewStageLabel] = useState('');
  const [newStageIsTerminal, setNewStageIsTerminal] = useState(false);
  const [newStageRequiresRequiredData, setNewStageRequiresRequiredData] = useState(false);

  const [stageKeyToAdd, setStageKeyToAdd] = useState<string>('');

  const [removeStageConflict, setRemoveStageConflict] = useState<{
    stageKey: string;
    cardsCount: number;
  } | null>(null);
  const [removeStageMoveToKey, setRemoveStageMoveToKey] = useState<string>('');
  const [removeStageMoveDialogOpen, setRemoveStageMoveDialogOpen] = useState(false);
  const [activeCard, setActiveCard] = useState<CardType | null>(null);
  
  // Card dialog state
  const [cardDialogOpen, setCardDialogOpen] = useState(false);
  
  // Delete/Alert dialogs
  const [deleteCardDialogOpen, setDeleteCardDialogOpen] = useState(false);
  const [cardToDelete, setCardToDelete] = useState<string | null>(null);
  const [deleteCardLoading, setDeleteCardLoading] = useState(false);
  
  const [deleteProjectDialogOpen, setDeleteProjectDialogOpen] = useState(false);
  const [deleteProjectLoading, setDeleteProjectLoading] = useState(false);
  
  const [alertDialogOpen, setAlertDialogOpen] = useState(false);
  const [alertMessage, setAlertMessage] = useState('');
  const [editingCard, setEditingCard] = useState<CardType | null>(null);
  const [pendingStatusChange, setPendingStatusChange] = useState<{ cardId: string; newStatus: string } | null>(null);
  const [logsModalOpen, setLogsModalOpen] = useState(false);
  const [pendenciaModalOpen, setPendenciaModalOpen] = useState(false);
  const [pendenciaCardId, setPendenciaCardId] = useState<string | null>(null);
  const [pendenciaCardName, setPendenciaCardName] = useState('');
  const [pendenciaNewStatus, setPendenciaNewStatus] = useState<string | null>(null);
  const [conclusaoModalOpen, setConclusaoModalOpen] = useState(false);
  const [conclusaoCardId, setConclusaoCardId] = useState<string | null>(null);
  const [conclusaoCardName, setConclusaoCardName] = useState<string | null>(null);
  const [conclusaoNewStatus, setConclusaoNewStatus] = useState<string | null>(null);
  const [conclusaoPendingData, setConclusaoPendingData] = useState<any>(null);
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
  const [cardFormLoading, setCardFormLoading] = useState(false);
  const [cardFormError, setCardFormError] = useState('');
  const [dueDateRequestOpen, setDueDateRequestOpen] = useState(false);
  
  // Estimador de complexidade
  const [showTimeEstimator, setShowTimeEstimator] = useState(false);
  const [selectedTimeItems, setSelectedTimeItems] = useState<Set<string>>(new Set());
  const [selectedDevelopment, setSelectedDevelopment] = useState<string | null>(null);
  const [timeEstimates, setTimeEstimates] = useState([
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

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    })
  );

  // Filtros e busca nos cards do projeto
  const [cardDeveloperFilter, setCardDeveloperFilter] = useState<string>('');
  const [cardPriorityFilter, setCardPriorityFilter] = useState<string>('');
  const [cardTypeFilter, setCardTypeFilter] = useState<string>('');
  const [cardSearchQuery, setCardSearchQuery] = useState<string>('');

  useEffect(() => {
    if (id) {
      loadData();
    }
  }, [id]);

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

  const loadData = async () => {
    if (!id) return;
    try {
      const [projectData, cardsData, usersData, kanbanConfigData] = await Promise.all([
        projectService.getById(id),
        cardService.getByProject(id),
        userService.getAll(),
        projectService.getKanbanConfig(id).catch(() => null),
      ]);
      console.log('Project data:', projectData);
      console.log('Cards data:', cardsData);
      console.log('Project ID:', id);
      setProject(projectData);
      setCards(cardsData);
      setUsers(usersData);

      // Carregar etapas configuradas para este projeto
      if (kanbanConfigData?.stages?.length) {
        const stageToColor = (stageId: string): string => {
          const fallback = DEFAULT_PROJECT_STAGES.find((s) => s.id === stageId);
          if (fallback) return fallback.color;
          // Paleta fallback determinística (sem Tailwind dinâmica)
          const palette = ['bg-gray-100', 'bg-blue-100', 'bg-orange-100', 'bg-purple-100', 'bg-green-100', 'bg-red-100'];
          let hash = 0;
          for (let i = 0; i < stageId.length; i++) hash = stageId.charCodeAt(i) + ((hash << 5) - hash);
          const idx = Math.abs(hash) % palette.length;
          return palette[idx];
        };

        setStages(
          kanbanConfigData.stages.map((s: any) => ({
            id: s.key,
            label: s.label,
            color: stageToColor(s.key),
            is_terminal: !!s.is_terminal,
            requires_required_data: !!s.requires_required_data,
          })),
        );
      } else {
        setStages(DEFAULT_PROJECT_STAGES);
      }
      
      // Buscar informações da sprint se o projeto tiver uma sprint
      if (projectData.sprint) {
        try {
          const sprintData = await sprintService.getById(projectData.sprint);
          setSprint(sprintData);
        } catch (error) {
          console.error('Erro ao carregar sprint:', error);
        }
      }
    } catch (error) {
      console.error('Erro ao carregar dados:', error);
    } finally {
      setLoading(false);
    }
  };

  // Verificar se a sprint está finalizada
  const isSprintFinished = (sprint: Sprint | null): boolean => {
    if (!sprint) return false;
    // Considerar finalizada apenas quando o backend marcar finalizada=true
    return !!sprint.finalizada;
  };

  const sprintIsFinished = isSprintFinished(sprint);

  const getCardsByStage = (stageId: string) => {
    let filtered = cards.filter((card) => card.status === stageId);

    // Busca por texto (nome, descrição, responsável, área, tipo)
    if (cardSearchQuery.trim()) {
      const query = cardSearchQuery.toLowerCase();
      filtered = filtered.filter((card) => {
        return (
          card.nome.toLowerCase().includes(query) ||
          (card.descricao && card.descricao.toLowerCase().includes(query)) ||
          (card.responsavel_name && card.responsavel_name.toLowerCase().includes(query)) ||
          (card.area_display && card.area_display.toLowerCase().includes(query)) ||
          (card.tipo_display && card.tipo_display.toLowerCase().includes(query))
        );
      });
    }

    // Filtro por responsável/desenvolvedor
    if (cardDeveloperFilter) {
      filtered = filtered.filter(
        (card) => card.responsavel?.toString() === cardDeveloperFilter
      );
    }

    // Filtro por prioridade
    if (cardPriorityFilter) {
      filtered = filtered.filter((card) => card.prioridade === cardPriorityFilter);
    }

    // Filtro por tipo
    if (cardTypeFilter) {
      filtered = filtered.filter((card) => card.tipo === cardTypeFilter);
    }

    return filtered;
  };

  const handleDragStart = (event: { active: { id: string | number } }) => {
    const { active } = event;
    const card = cards.find((c) => c.id.toString() === active.id.toString());
    setActiveCard(card || null);
  };

  const handleDragOver = (event: { active: { id: string | number }; over: { id: string | number } | null }) => {
    // Este handler ajuda a melhorar a detecção durante o arrasto
    // A detecção real é feita pelo pointerWithin
  };

  // Calcular sugestão de data de entrega baseada na estimativa de complexidade
  const calculateSuggestedEndDate = (hours: number): string => {
    if (!hours || hours === 0) return '';
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Considerar apenas dias úteis (segunda a sexta)
    // Começar do próximo dia útil
    let currentDate = new Date(today);
    // Se hoje é sábado (6) ou domingo (0), começar na próxima segunda
    if (currentDate.getDay() === 0) {
      currentDate.setDate(currentDate.getDate() + 1);
    } else if (currentDate.getDay() === 6) {
      currentDate.setDate(currentDate.getDate() + 2);
    } else {
      // Se for dia útil, começar no próximo dia útil
      currentDate.setDate(currentDate.getDate() + 1);
    }
    
    let remainingHours = hours;
    const hoursPerDay = 8;
    
    // Adicionar dias úteis até completar as horas
    while (remainingHours > 0) {
      // Pular fins de semana
      while (currentDate.getDay() === 0 || currentDate.getDay() === 6) {
        currentDate.setDate(currentDate.getDate() + 1);
      }
      
      if (remainingHours >= hoursPerDay) {
        remainingHours -= hoursPerDay;
        currentDate.setDate(currentDate.getDate() + 1);
      } else {
        remainingHours = 0;
      }
    }
    
    // Formatar como YYYY-MM-DDTHH:mm com hora padrão 18:00
    const year = currentDate.getFullYear();
    const month = String(currentDate.getMonth() + 1).padStart(2, '0');
    const day = String(currentDate.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}T18:00`;
  };

  // Função para capitalizar a primeira letra
  const capitalizeFirst = (str: string): string => {
    return str.charAt(0).toUpperCase() + str.slice(1);
  };

  // Função para obter o nome da etapa em português
  const getStageLabel = (stageId: string): string => {
    const stage = stages.find((s) => s.id === stageId);
    return stage ? stage.label : stageId;
  };

  // Função para determinar a direção do movimento e formatar a mensagem
  const getMovementMessage = (oldStageId: string, newStageId: string, userName: string): string => {
    const oldStageLabel = getStageLabel(oldStageId);
    const newStageLabel = getStageLabel(newStageId);
    
    // Sempre usar seta para direita: etapa origem → etapa destino
    return `${oldStageLabel} → ${newStageLabel}`;
  };

  // Validar se card tem todos os dados obrigatórios para etapas que exigem dados
  const validateCardRequiredData = (card: CardType): { valid: boolean; missing: string[] } => {
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
    return stages.find((s) => s.id === stageId)?.requires_required_data ?? false;
  };

  // Função para criar log de card
  const [logsRefreshTrigger, setLogsRefreshTrigger] = useState(0);

  const createCardLog = async (
    cardId: string,
    tipoEvento: string,
    descricao: string
  ) => {
    try {
      await cardLogService.create({
        card: cardId,
        tipo_evento: tipoEvento,
        descricao: descricao,
        usuario: user?.id || null,
      });
      // Atualizar trigger para recarregar logs em tempo real
      setLogsRefreshTrigger(prev => prev + 1);
    } catch (error) {
      console.error('Erro ao criar log do card:', error);
      // Não bloquear o fluxo se o log falhar
    }
  };

  // Função para detectar mudanças nos campos do card
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

  const handleDragEnd = async (event: { active: { id: string | number }; over: { id: string | number } | null }) => {
    const { active, over } = event;
    setActiveCard(null);

    // Bloquear drag and drop se sprint estiver finalizada
    if (sprintIsFinished) {
      return;
    }

    if (!over) return;

    const cardId = active.id.toString();
    const overId = over.id.toString();

    // Verificar se o card foi movido
    const card = cards.find((c) => c.id.toString() === cardId);
    if (!card) return;

    // Bloquear drag and drop se card estiver finalizado ou inviabilizado
    if (card.status === 'finalizado' || card.status === 'inviabilizado') {
      return;
    }

    // Determinar a nova coluna
    let newStageId: string;
    
    // Verificar se o destino é uma coluna válida
    const validStages = stages.map((s) => s.id);
    if (validStages.includes(overId)) {
      // Solto diretamente na coluna
      newStageId = overId;
    } else {
      // Solto sobre outro card - encontrar a coluna do card de destino
      const targetCard = cards.find((c) => c.id.toString() === overId);
      if (!targetCard) return;
      newStageId = targetCard.status;
    }

    // Se o status não mudou, não fazer nada
    if (card.status === newStageId) return;

    // Se está mudando para "parado_pendencias", abrir modal de pendências
    if (newStageId === 'parado_pendencias') {
      setPendenciaCardId(cardId);
      setPendenciaCardName(card.nome);
      setPendenciaNewStatus(newStageId);
      setPendenciaModalOpen(true);
      return;
    }

    // Se está mudando para "finalizado", validar dados obrigatórios primeiro
    if (newStageId === 'finalizado') {
      // Validar se card tem todos os dados obrigatórios
      const validation = validateCardRequiredData(card);
      if (!validation.valid) {
        // Armazenar o movimento pendente para completar após salvar
        setPendingStatusChange({ cardId: cardId, newStatus: newStageId });
        // Mostrar aviso e abrir modal de edição
        const missingList = validation.missing.map((item, index) => `${index + 1}. ${capitalizeFirst(item)}`).join('\n');
        const stageLabel = getStageLabel(newStageId);
        setAlertMessage(`Para mover o card para "${stageLabel}", é necessário preencher:\n\n${missingList}\n\nO formulário de edição será aberto.`);
        setAlertDialogOpen(true);
        openEditCardDialog(card);
        return;
      }
      
      setConclusaoCardId(cardId);
      setConclusaoCardName(card.nome);
      setConclusaoNewStatus(newStageId);
      // Preparar dados para conclusão
      const updateData: any = { status: newStageId };
      if (!card.data_inicio) {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        updateData.data_inicio = `${year}-${month}-${day}T${hours}:${minutes}`;
      }
      if (!card.data_fim) {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        updateData.data_fim = `${year}-${month}-${day}T${hours}:${minutes}`;
      }
      setConclusaoPendingData({ card, updateData, oldStageId: card.status });
      setConclusaoModalOpen(true);
      return;
    }

    // Se está mudando para uma etapa que exige dados obrigatórios, validar
    if (requiresRequiredData(newStageId)) {
      const validation = validateCardRequiredData(card);
      if (!validation.valid) {
        // Armazenar o movimento pendente para completar após salvar
        setPendingStatusChange({ cardId: cardId, newStatus: newStageId });
        // Mostrar aviso e abrir modal de edição
        const missingList = validation.missing.map((item, index) => `${index + 1}. ${capitalizeFirst(item)}`).join('\n');
        const stageLabel = getStageLabel(newStageId);
        setAlertMessage(`Para mover o card para "${stageLabel}", é necessário preencher:\n\n${missingList}\n\nO formulário de edição será aberto.`);
        setAlertDialogOpen(true);
        openEditCardDialog(card);
        return;
      }
      
      // Se não tem data_inicio, preencher automaticamente com data/hora atual (apenas para em_desenvolvimento)
      const updateData: any = { status: newStageId };
      if (newStageId === 'em_desenvolvimento' && !card.data_inicio) {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        updateData.data_inicio = `${year}-${month}-${day}T${hours}:${minutes}`;
      }
      
      // Salvar o status antigo antes de atualizar
      const oldStageId = card.status;
      
      // Atualizar o estado local IMEDIATAMENTE para evitar animação de retorno
      setCards((prevCards) =>
        prevCards.map((c) =>
          c.id.toString() === cardId ? { ...c, status: newStageId, ...updateData } : c
        )
      );

      try {
        await cardService.update(card.id, updateData);
        // Registrar log de movimentação
        const userName = user?.first_name || user?.username || 'Usuário';
        await createCardLog(
          card.id,
          'movimentado',
          getMovementMessage(oldStageId, newStageId, userName)
        );
        // O estado local já foi atualizado acima
      } catch (error) {
        console.error('Erro ao atualizar card:', error);
        // Em caso de erro, recarregar dados
        loadData();
      }
      return;
    }

    // Salvar o status antigo antes de atualizar
    const oldStageId = card.status;
    
    // Atualizar o estado local IMEDIATAMENTE para evitar animação de retorno
    setCards((prevCards) =>
      prevCards.map((c) =>
        c.id.toString() === cardId ? { ...c, status: newStageId } : c
      )
    );

    try {
      // Atualizar o status do card na API
      await cardService.update(card.id, { status: newStageId });
      // Registrar log de movimentação
      const userName = user?.first_name || user?.username || 'Usuário';
      await createCardLog(
        card.id,
        'movimentado',
        getMovementMessage(oldStageId, newStageId, userName)
      );
      // O estado local já foi atualizado acima, então não precisa atualizar novamente
    } catch (error) {
      console.error('Erro ao atualizar card:', error);
      // Em caso de erro, reverter o estado local e recarregar dados
      loadData();
    }
  };

  const handleConclusaoConfirm = async () => {
    if (!conclusaoCardId || !conclusaoNewStatus || !conclusaoPendingData) return;

    const { card, updateData, oldStageId, dataToSend } = conclusaoPendingData;
    const cardId = conclusaoCardId;

    try {
      // Se veio da edição, usar dataToSend completo, senão usar apenas updateData
      const finalData = dataToSend ? { ...dataToSend, status: 'finalizado', ...updateData } : updateData;
      
      // Atualizar o status do card na API
      await cardService.update(card.id, finalData);
      
      // Registrar log de movimentação
      const userName = user?.first_name || user?.username || 'Usuário';
      await createCardLog(
        card.id,
        'movimentado',
        getMovementMessage(oldStageId, conclusaoNewStatus, userName)
      );
      
      // Registrar log de alteração se houver outras mudanças além do status
      if (dataToSend) {
        const changes = detectCardChanges(card, finalData, true); // excludeStatus = true
        if (changes.length > 0) {
          await createCardLog(
            card.id,
            'alteracao',
            changes.join('\n')
          );
        }
      }
      
      // Atualizar o estado local
      setCards((prevCards) =>
        prevCards.map((c) =>
          c.id.toString() === cardId ? { ...c, ...finalData, status: conclusaoNewStatus } : c
        )
      );
      
      // Limpar estados
      setConclusaoModalOpen(false);
      setConclusaoCardId(null);
      setConclusaoCardName(null);
      setConclusaoNewStatus(null);
      setConclusaoPendingData(null);
      
      // Fechar dialog de edição se estiver aberto
      if (dataToSend) {
        setCardDialogOpen(false);
        setLogsModalOpen(false);
      }
      
      // Recarregar dados para garantir sincronização
      loadData();
    } catch (error) {
      console.error('Erro ao atualizar card:', error);
      // Em caso de erro, recarregar dados
      loadData();
      setConclusaoModalOpen(false);
      setConclusaoCardId(null);
      setConclusaoCardName(null);
      setConclusaoNewStatus(null);
      setConclusaoPendingData(null);
    }
  };

  const handlePendenciaConfirm = async (motivo: string) => {
    if (!pendenciaCardId || !pendenciaNewStatus) return;

    const card = cards.find((c) => c.id.toString() === pendenciaCardId);
    if (!card) return;

    // Salvar o status antigo antes de atualizar
    const oldStageId = card.status;
    
    // Atualizar o estado local IMEDIATAMENTE
    setCards((prevCards) =>
      prevCards.map((c) =>
        c.id.toString() === pendenciaCardId ? { ...c, status: pendenciaNewStatus } : c
      )
    );

    try {
      // Atualizar o status do card na API
      await cardService.update(card.id, { status: pendenciaNewStatus });
      
      // Registrar log de movimentação com motivo da pendência
      const userName = user?.first_name || user?.username || 'Usuário';
      const movementMessage = getMovementMessage(oldStageId, 'parado_pendencias', userName);
      await createCardLog(
        card.id,
        'pendencia',
        `${movementMessage}\n\nMotivo: ${motivo}`
      );
      
      // Limpar estados
      setPendenciaModalOpen(false);
      setPendenciaCardId(null);
      setPendenciaCardName('');
      setPendenciaNewStatus(null);
      
      // Recarregar dados
      loadData();
    } catch (error) {
      console.error('Erro ao atualizar card:', error);
      loadData();
    }
  };

  const openEditCardDialog = async (card: CardType) => {
    // Buscar o card completo do servidor para garantir que temos todos os dados atualizados
    let fullCard = card;
    try {
      fullCard = await cardService.getById(card.id);
    } catch (error) {
      console.error('Erro ao carregar card completo:', error);
      // Se falhar, usar o card do estado local
    }
    
    // Permitir abrir para visualização sempre
    setEditingCard(fullCard);
    // Abrir modal de logs quando o card é aberto
    setLogsModalOpen(true);
    
    // Se há um movimento pendente, usar o status de destino
    const targetStatus = pendingStatusChange && pendingStatusChange.cardId === fullCard.id.toString() 
      ? pendingStatusChange.newStatus 
      : fullCard.status;
    
    // Se o card está em desenvolvimento e não tem data_inicio, preencher automaticamente
    let dataInicio = fullCard.data_inicio || '';
    if (targetStatus === 'em_desenvolvimento' && !dataInicio) {
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
      status: targetStatus,
      responsavel: fullCard.responsavel || '',
      data_inicio: dataInicio,
      data_fim: fullCard.data_fim || '',
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
    setCardDialogOpen(true);
  };

  const openCreateCardDialog = () => {
    setEditingCard(null);
    setCardFormData({
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
    // Limpar estimativas ao abrir dialog de criação
    setSelectedTimeItems(new Set());
    setSelectedDevelopment(null);
    setCustomTimeItems([]);
    setTimeEstimates([]);
    setShowTimeEstimator(false);
    setCardFormError('');
    setCardDialogOpen(true);
  };

  const normalizeStagesFromApi = (apiStages: any[] | undefined | null): ProjectStage[] => {
    if (!apiStages || !apiStages.length) return DEFAULT_PROJECT_STAGES;

    const stageToColor = (stageId: string): string => {
      const fallback = DEFAULT_PROJECT_STAGES.find((s) => s.id === stageId);
      if (fallback) return fallback.color;
      const palette = ['bg-gray-100', 'bg-blue-100', 'bg-orange-100', 'bg-purple-100', 'bg-green-100', 'bg-red-100'];
      let hash = 0;
      for (let i = 0; i < stageId.length; i++) hash = stageId.charCodeAt(i) + ((hash << 5) - hash);
      const idx = Math.abs(hash) % palette.length;
      return palette[idx];
    };

    return apiStages.map((s: any) => ({
      id: s.key,
      label: s.label,
      color: stageToColor(s.key),
      is_terminal: !!s.is_terminal,
      requires_required_data: !!s.requires_required_data,
    }));
  };

  const refreshProjectStages = async () => {
    if (!id) return;
    try {
      const cfg = await projectService.getKanbanConfig(id);
      setStages(normalizeStagesFromApi(cfg?.stages));
    } catch (error) {
      console.error('Erro ao recarregar config de etapas:', error);
      setStages(DEFAULT_PROJECT_STAGES);
    }
  };

  const openConfigProjectDialog = async () => {
    if (user?.role !== 'supervisor') return;
    setConfigProjectDialogOpen(true);
    setConfigLoading(true);
    try {
      if (!id) return;
      const [global, cfg] = await Promise.all([
        kanbanStageService.getAll(),
        projectService.getKanbanConfig(id),
      ]);
      setGlobalStages(global);
      setStages(normalizeStagesFromApi(cfg?.stages));
    } catch (error) {
      console.error('Erro ao carregar configuração do projeto:', error);
    } finally {
      setConfigLoading(false);
    }
  };

  const applyStagesOrder = async (nextStages: ProjectStage[]) => {
    if (!id) return;
    setStages(nextStages);
    try {
      const stageKeysOrder = nextStages.map((s) => s.id);
      await projectService.updateKanbanConfigReorder(id, stageKeysOrder);
    } catch (error) {
      console.error('Erro ao atualizar ordem das etapas:', error);
      await refreshProjectStages();
    }
  };

  const moveStageBy = async (index: number, delta: number) => {
    const targetIndex = index + delta;
    if (targetIndex < 0 || targetIndex >= stages.length) return;

    const next = [...stages];
    const [moved] = next.splice(index, 1);
    next.splice(targetIndex, 0, moved);
    await applyStagesOrder(next);
  };

  const handleAddExistingStage = async () => {
    if (!id) return;
    const stageKey = stageKeyToAdd;
    if (!stageKey) return;
    try {
      await projectService.addKanbanStage(id, stageKey);
      await refreshProjectStages();
    } catch (error) {
      console.error('Erro ao adicionar etapa:', error);
    }
  };

  const handleCreateStageAndAddToProject = async () => {
    if (!id) return;
    const label = newStageLabel.trim();
    if (!label) return;

    try {
      const created = await kanbanStageService.create({
        label,
        is_terminal: newStageIsTerminal,
        requires_required_data: newStageRequiresRequiredData,
      });
      // Reset inputs
      setNewStageLabel('');
      setNewStageIsTerminal(false);
      setNewStageRequiresRequiredData(false);

      // Adicionar ao projeto
      await projectService.addKanbanStage(id, created.key);
      await refreshProjectStages();
      const global = await kanbanStageService.getAll().catch(() => []);
      setGlobalStages(global);
    } catch (error) {
      console.error('Erro ao criar/adicionar etapa:', error);
    }
  };

  const handleRequestRemoveStage = async (stageKey: string) => {
    if (!id) return;
    try {
      await projectService.removeKanbanStage(id, stageKey);
      await refreshProjectStages();
    } catch (error: any) {
      const status = error?.response?.status;
      const data = error?.response?.data;
      if (status === 409 && data?.cards_count) {
        setRemoveStageConflict({ stageKey, cardsCount: data.cards_count });

        const destinationOptions = stages.filter((s) => s.id !== stageKey);
        setRemoveStageMoveToKey(destinationOptions[0]?.id || '');
        setRemoveStageMoveDialogOpen(true);
      } else {
        console.error('Erro ao remover etapa:', error);
      }
    }
  };

  const handleConfirmMoveAndRemove = async () => {
    if (!id || !removeStageConflict) return;
    if (!removeStageMoveToKey) return;

    try {
      await projectService.removeKanbanStage(
        id,
        removeStageConflict.stageKey,
        removeStageMoveToKey,
      );
      setRemoveStageMoveDialogOpen(false);
      setRemoveStageConflict(null);
      setRemoveStageMoveToKey('');
      await refreshProjectStages();
    } catch (error) {
      console.error('Erro ao mover e remover etapa:', error);
    }
  };

  const handleCardSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setCardFormError('');
    
    // Validar se a área foi selecionada
    if (!cardFormData.area || cardFormData.area.trim() === '') {
      setCardFormError('Por favor, selecione uma área para o card.');
      return;
    }
    
    // Bloquear submit se sprint estiver finalizada ou card estiver finalizado/inviabilizado
    if (sprintIsFinished) {
      setCardFormError('Cards de sprints finalizadas não podem ser editados.');
      return;
    }
    if (editingCard && (editingCard.status === 'finalizado' || editingCard.status === 'inviabilizado')) {
      setCardFormError('Cards finalizados ou inviabilizados não podem ser editados.');
      return;
    }
    
    // Se está mudando para "finalizado", abrir modal de confirmação
    if (cardFormData.status === 'finalizado' && editingCard && editingCard.status !== 'finalizado') {
      setConclusaoCardId(editingCard.id.toString());
      setConclusaoCardName(editingCard.nome);
      setConclusaoNewStatus('finalizado');
      // Preparar dados para conclusão
      const updateData: any = { status: 'finalizado' };
      if (!cardFormData.data_inicio) {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        updateData.data_inicio = `${year}-${month}-${day}T${hours}:${minutes}`;
      }
      if (!cardFormData.data_fim) {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        updateData.data_fim = `${year}-${month}-${day}T${hours}:${minutes}`;
      }
      setConclusaoPendingData({ card: editingCard, updateData, dataToSend: cardFormData, oldStageId: editingCard.status });
      setConclusaoModalOpen(true);
      return;
    }

    // Validar se está mudando para uma etapa que exige dados obrigatórios
    if (requiresRequiredData(cardFormData.status)) {
      const validation = validateCardRequiredData(cardFormData as any);
      if (!validation.valid) {
        const missingList = validation.missing.map((item, index) => `${index + 1}. ${capitalizeFirst(item)}`).join('\n');
        const stageLabel = getStageLabel(cardFormData.status);
        setCardFormError(`Para o status "${stageLabel}", é necessário preencher:\n\n${missingList}.`);
        return;
      }
      
      // Se não tem data_inicio, preencher automaticamente com data/hora atual (apenas para em_desenvolvimento)
      if (cardFormData.status === 'em_desenvolvimento' && !cardFormData.data_inicio) {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        cardFormData.data_inicio = `${year}-${month}-${day}T${hours}:${minutes}`;
      }
    }
    
    setCardFormLoading(true);

    try {
      const dataToSend = {
        nome: cardFormData.nome,
        descricao: cardFormData.descricao,
        script_url: cardFormData.script_url || null,
        area: cardFormData.area,
        tipo: cardFormData.tipo,
        prioridade: cardFormData.prioridade,
        status: cardFormData.status,
        responsavel: cardFormData.responsavel || null,
        data_inicio: cardFormData.data_inicio || null,
        data_fim: cardFormData.data_fim || null,
        projeto: id!,
        // Incluir dados de estimativa de complexidade
        complexidade_selected_items: Array.from(selectedTimeItems).length > 0 ? Array.from(selectedTimeItems) : [],
        complexidade_selected_development: selectedDevelopment || null,
        complexidade_custom_items: customTimeItems.length > 0 ? customTimeItems : [],
      };

      if (editingCard) {
        // Verificar se há um movimento pendente para este card
        if (pendingStatusChange && pendingStatusChange.cardId === editingCard.id.toString()) {
          // Validar se os dados estão preenchidos antes de salvar
          const validation = validateCardRequiredData(dataToSend as any);
          
          if (validation.valid) {
            // Incluir o status pendente nos dados a serem salvos (sempre usar o status pendente)
            const statusToUse = pendingStatusChange.newStatus;
            const oldStatusForLog = editingCard.status; // Salvar status antigo antes de atualizar
            dataToSend.status = statusToUse;
            
            // Salvar primeiro na API
            await cardService.update(editingCard.id, dataToSend);
            
            // Recarregar o card completo do servidor para garantir que temos todos os dados atualizados
            const refreshedCard = await cardService.getById(editingCard.id);
            
            // Registrar log de movimentação
            const userName = user?.first_name || user?.username || 'Usuário';
            await createCardLog(
              editingCard.id,
              'movimentado',
              getMovementMessage(oldStatusForLog, statusToUse, userName)
            );
            
            // Limpar o movimento pendente antes de atualizar o estado
            setPendingStatusChange(null);
            
            // Atualizar o estado local com os dados recarregados
            setCards((prevCards) =>
              prevCards.map((c) =>
                c.id.toString() === editingCard.id.toString() ? { ...c, ...refreshedCard, status: statusToUse } : c
              )
            );
            
            // Fechar o dialog
            setCardDialogOpen(false);
            // Fechar modal de logs quando o modal de edição for fechado
            setLogsModalOpen(false);
            // Recarregar dados para garantir sincronização
            loadData();
            return; // Retornar para não executar o código abaixo
          } else {
            // Se ainda faltam dados, salvar sem mudar o status
            await cardService.update(editingCard.id, dataToSend);
            // Recarregar o card completo do servidor para garantir que temos todos os dados atualizados
            const refreshedCard = await cardService.getById(editingCard.id);
            // Atualizar o estado local com os dados recarregados
            setCards((prevCards) =>
              prevCards.map((c) =>
                c.id.toString() === editingCard.id.toString() ? { ...c, ...refreshedCard } : c
              )
            );
            // Registrar log de alteração (excluir status pois será movimentação)
            const changes = detectCardChanges(editingCard, dataToSend, true);
            if (changes.length > 0) {
              await createCardLog(
                editingCard.id,
                'alteracao',
                changes.join('\n')
              );
            }
          }
        } else {
          await cardService.update(editingCard.id, dataToSend);
          // Recarregar o card completo do servidor para garantir que temos todos os dados atualizados
          const refreshedCard = await cardService.getById(editingCard.id);
          // Atualizar o estado local com os dados recarregados
          setCards((prevCards) =>
            prevCards.map((c) =>
              c.id.toString() === editingCard.id.toString() ? { ...c, ...refreshedCard } : c
            )
          );
          // Registrar log de atualização
          const changes = detectCardChanges(editingCard, dataToSend);
          if (changes.length > 0) {
            await createCardLog(
              editingCard.id,
              'atualizado',
              `Card atualizado por ${user?.first_name || user?.username || 'Usuário'}:\n${changes.map(c => `• ${c}`).join('\n')}`
            );
          }
        }
      } else {
        const newCard = await cardService.create(dataToSend);
        // Log de criação é criado automaticamente pelo backend
        
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
      }
      setCardDialogOpen(false);
      // Fechar modal de logs quando o modal de edição for fechado
      setLogsModalOpen(false);
      // Recarregar dados para garantir sincronização
      loadData();
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
      setCardFormLoading(false);
    }
  };

  const handleCardDelete = (e: React.MouseEvent, cardId: string) => {
    e.stopPropagation();
    
    // Verificar se o card está inviabilizado
    const card = cards.find(c => c.id === cardId);
    if (card && card.status === 'inviabilizado') {
      // Apenas admin e supervisor podem apagar cards inviabilizados
      if (user?.role !== 'admin' && user?.role !== 'supervisor') {
        setAlertMessage('Apenas administradores e supervisores podem excluir cards inviabilizados.');
        setAlertDialogOpen(true);
        return;
      }
    }
    
    setCardToDelete(cardId);
    setDeleteCardDialogOpen(true);
  };

  const confirmDeleteCard = async () => {
    if (!cardToDelete) return;
    
    setDeleteCardLoading(true);
    try {
      await cardService.delete(cardToDelete);
      setCards((prevCards) => prevCards.filter((c) => c.id !== cardToDelete));
      setDeleteCardDialogOpen(false);
      setCardToDelete(null);
    } catch (error) {
      console.error('Erro ao excluir card:', error);
      setAlertMessage('Erro ao excluir card. Tente novamente.');
      setAlertDialogOpen(true);
    } finally {
      setDeleteCardLoading(false);
    }
  };

  const handleDeleteProject = () => {
    if (!project) return;
    
    // Verificar se o usuário tem permissão (admin ou supervisor)
    if (user?.role !== 'admin' && user?.role !== 'supervisor') {
      setAlertMessage('Apenas administradores e supervisores podem excluir projetos inviabilizados.');
      setAlertDialogOpen(true);
      return;
    }
    
    // Verificar se o projeto está inviabilizado (case-insensitive)
    const projectStatus = (project.status || '').toLowerCase();
    if (projectStatus !== 'inviabilizado') {
      setAlertMessage(`Apenas projetos inviabilizados podem ser excluídos. Status atual: ${project.status}`);
      setAlertDialogOpen(true);
      return;
    }
    
    setDeleteProjectDialogOpen(true);
  };

  const confirmDeleteProject = async () => {
    if (!project) return;
    
    setDeleteProjectLoading(true);
    try {
      await projectService.delete(project.id);
      navigate('/projects');
    } catch (error) {
      console.error('Erro ao excluir projeto:', error);
      setAlertMessage('Erro ao excluir projeto. Tente novamente.');
      setAlertDialogOpen(true);
      setDeleteProjectDialogOpen(false);
    } finally {
      setDeleteProjectLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[256px]">
        <Loader2 className="h-[32px] w-[32px] animate-spin text-[var(--color-primary)]" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex flex-col items-center justify-center h-[256px]">
        <p className="text-lg font-medium text-[var(--color-foreground)]">
          Projeto não encontrado
        </p>
        <Button variant="outline" onClick={() => navigate(-1)} className="mt-[16px]">
          Voltar
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-64px-64px)] min-h-0">
      {/* Header */}
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
            <FolderKanban className="h-[24px] w-[24px] text-[var(--color-primary)]" />
          </div>
          <div className="flex-1">
            <div className="flex items-center justify-between gap-[16px]">
              <div className="flex-1">
                <div className="flex flex-col gap-[4px]">
                  <h1 className="text-2xl font-bold text-[var(--color-foreground)]">
                    {project.nome}
                  </h1>
                  {sprint && (
                    <span className="text-xs text-[var(--color-muted-foreground)]">
                      {sprint.nome} ({formatDate(sprint.data_inicio)} → {formatDate(sprint.data_fim)})
                    </span>
                  )}
                </div>
                {project.descricao && (
                  <p className="text-sm text-[var(--color-muted-foreground)] mt-[4px]">
                    {project.descricao}
                  </p>
                )}
              </div>
              {/* Botão de criar card - visível para todos e em azul */}
              <div className="flex items-center gap-[8px]">
                <Button
                  variant="default"
                  onClick={openCreateCardDialog}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Criar Card
                </Button>
                {/* Configurar Projeto (somente supervisor) */}
                {user?.role === 'supervisor' && (
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-[40px] w-[40px]"
                    onClick={openConfigProjectDialog}
                    aria-label="Configurar Projeto"
                  >
                    <Settings className="h-[18px] w-[18px]" />
                  </Button>
                )}
              </div>
            </div>
          </div>
          {/* Botão de deletar projeto (apenas para admin/supervisor e projetos inviabilizados) */}
          {(() => {
            const projectStatus = (project.status || '').toLowerCase();
            const isInviabilizado = projectStatus === 'inviabilizado';
            const hasPermission = user?.role === 'admin' || user?.role === 'supervisor';
            const shouldShow = isInviabilizado && hasPermission;
            
            if (shouldShow) {
              return (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleDeleteProject}
                  className="flex items-center gap-2"
                >
                  <Trash2 className="h-4 w-4" />
                  Excluir Projeto
                </Button>
              );
            }
            return null;
          })()}
        </div>
      </div>

      {/* Filtros e busca dos cards do projeto */}
      <div className="mb-[16px] flex flex-col lg:flex-row gap-[16px]">
        {/* Barra de busca */}
        <div className="flex-1">
          <div className="relative">
            <span className="text-xs text-[var(--color-muted-foreground)] mb-[4px] block">
              Buscar cards
            </span>
            <Input
              type="text"
              placeholder="Pesquisar cards por nome, descrição, responsável, área ou tipo..."
              value={cardSearchQuery}
              onChange={(e) => setCardSearchQuery(e.target.value)}
              className="pl-[12px] h-[40px] w-full"
            />
          </div>
        </div>

        {/* Filtro de prioridade */}
        <div className="flex-1 lg:flex-initial lg:w-[200px]">
          <span className="text-xs text-[var(--color-muted-foreground)] mb-[4px] block">
            Prioridade
          </span>
          <FilterSelect
            options={CARD_PRIORITIES.map((prioridade) => ({
              value: prioridade.value,
              label: prioridade.label,
            }))}
            value={cardPriorityFilter}
            onChange={setCardPriorityFilter}
            placeholder="Todas as prioridades"
          />
        </div>

        {/* Filtro de tipo de projeto (tipo do card) */}
        <div className="flex-1 lg:flex-initial lg:w-[220px]">
          <span className="text-xs text-[var(--color-muted-foreground)] mb-[4px] block">
            Tipo de projeto
          </span>
          <FilterSelect
            options={CARD_TYPES.map((tipo) => ({
              value: tipo.value,
              label: tipo.label,
            }))}
            value={cardTypeFilter}
            onChange={setCardTypeFilter}
            placeholder="Todos os tipos"
          />
        </div>

        {/* Filtro de responsável */}
        <div className="flex-1 lg:flex-initial lg:w-[220px]">
          <span className="text-xs text-[var(--color-muted-foreground)] mb-[4px] block">
            Responsável
          </span>
          <UserSelect
            users={users.filter((u) => u.role === 'desenvolvedor' || u.role === 'gerente')}
            value={cardDeveloperFilter}
            onChange={setCardDeveloperFilter}
            placeholder="Todos os responsáveis"
          />
        </div>
      </div>

      {/* Kanban Board */}
      <div className="flex-1 min-h-0 flex flex-col">
        <DndContext
          sensors={sensors}
          collisionDetection={pointerWithin}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
        >
          <div className="flex gap-[16px] overflow-x-auto pb-[16px] flex-1 min-h-0">
            {stages.map((stage) => (
              <KanbanColumn
                key={stage.id}
                stage={stage}
                cards={getCardsByStage(stage.id)}
                onCardClick={(card) => {
                  openEditCardDialog(card);
                }}
                onCardDelete={handleCardDelete}
                disabled={sprintIsFinished}
                userRole={user?.role}
              />
            ))}
          </div>
          <DragOverlay>
            {activeCard ? (
              <DragOverlayCard card={activeCard} />
            ) : null}
          </DragOverlay>
        </DndContext>
      </div>

      {/* Card Dialog */}
      <Dialog open={cardDialogOpen} onOpenChange={(open) => {
        setCardDialogOpen(open);
        if (!open) {
          // Limpar movimento pendente se o dialog for fechado sem salvar
          setPendingStatusChange(null);
          // Fechar modal de logs quando o modal de edição for fechado
          setLogsModalOpen(false);
        }
      }}>
        <DialogContent onClose={() => {
          setCardDialogOpen(false);
          setLogsModalOpen(false);
        }} className="max-w-[600px]">
          <DialogHeader>
            <DialogTitle>
              {editingCard 
                ? (editingCard.status === 'finalizado' || editingCard.status === 'inviabilizado' || sprintIsFinished)
                  ? 'Visualizar Card'
                  : 'Editar Card'
                : 'Novo Card'}
            </DialogTitle>
            <DialogDescription>
              {editingCard
                ? (editingCard.status === 'finalizado' || editingCard.status === 'inviabilizado' || sprintIsFinished)
                  ? 'Visualize as informações do card. Cards finalizados ou de sprints finalizadas não podem ser editados.'
                  : 'Atualize as informações do card.'
                : 'Crie um novo card neste projeto.'}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCardSubmit} className="space-y-[16px] mt-[16px] max-h-[70vh] overflow-y-auto pr-[8px]">
            {(editingCard && (editingCard.status === 'finalizado' || editingCard.status === 'inviabilizado')) || sprintIsFinished ? (
              <div className="p-[12px] text-sm text-[var(--color-muted-foreground)] bg-[var(--color-muted)]/30 border border-[var(--color-border)] rounded-[8px]">
                {sprintIsFinished 
                  ? 'Este card pertence a uma sprint finalizada e não pode ser editado.'
                  : `Este card está ${editingCard?.status === 'finalizado' ? 'finalizado' : 'inviabilizado'} e não pode ser editado.`}
              </div>
            ) : null}
            <div className="space-y-[8px]">
              <Label htmlFor="card-nome">Nome do Card *</Label>
              <Input
                id="card-nome"
                placeholder="Ex: Certidões PE"
                value={cardFormData.nome}
                onChange={(e) => setCardFormData({ ...cardFormData, nome: e.target.value })}
                required
                disabled={!!(editingCard && (editingCard.status === 'finalizado' || editingCard.status === 'inviabilizado')) || sprintIsFinished}
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
                disabled={!!(editingCard && (editingCard.status === 'finalizado' || editingCard.status === 'inviabilizado')) || sprintIsFinished}
              />
            </div>

            <div className="space-y-[8px]">
              <Label htmlFor="card-script_url">Link do Script</Label>
              <Input
                id="card-script_url"
                type="url"
                placeholder="https://exemplo.com/script..."
                value={cardFormData.script_url}
                onChange={(e) => setCardFormData({ ...cardFormData, script_url: e.target.value })}
                disabled={!!(editingCard && (editingCard.status === 'finalizado' || editingCard.status === 'inviabilizado')) || sprintIsFinished}
              />
              <p className="text-xs text-[var(--color-muted-foreground)]">
                URL para o script de confecção do projeto
              </p>
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
                  disabled={!!(editingCard && (editingCard.status === 'finalizado' || editingCard.status === 'inviabilizado')) || sprintIsFinished}
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
                  disabled={!!(editingCard && (editingCard.status === 'finalizado' || editingCard.status === 'inviabilizado')) || sprintIsFinished}
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
                  disabled={!!(editingCard && (editingCard.status === 'finalizado' || editingCard.status === 'inviabilizado')) || sprintIsFinished}
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
                    // Se mudou para em_desenvolvimento e não tem data_inicio, preencher automaticamente
                    if (newStatus === 'em_desenvolvimento' && !cardFormData.data_inicio) {
                      const now = new Date();
                      const year = now.getFullYear();
                      const month = String(now.getMonth() + 1).padStart(2, '0');
                      const day = String(now.getDate()).padStart(2, '0');
                      const hours = String(now.getHours()).padStart(2, '0');
                      const minutes = String(now.getMinutes()).padStart(2, '0');
                      const dataInicio = `${year}-${month}-${day}T${hours}:${minutes}`;
                      
                      // Calcular data sugerida de entrega se houver estimativa
                      const totalHours = calculateTotalTime();
                      let dataFim = cardFormData.data_fim || '';
                      if (totalHours > 0 && !dataFim) {
                        const suggestedDate = calculateSuggestedEndDate(totalHours);
                        if (suggestedDate) {
                          dataFim = suggestedDate;
                        }
                      }
                      
                      setCardFormData(prev => ({ ...prev, status: newStatus, data_inicio: dataInicio, data_fim: dataFim }));
                    } else {
                      setCardFormData({ ...cardFormData, status: newStatus });
                    }
                  }}
                  required
                  disabled={!!(editingCard && (editingCard.status === 'finalizado' || editingCard.status === 'inviabilizado')) || sprintIsFinished}
                >
                  {(stages.length ? stages : DEFAULT_PROJECT_STAGES).map((stage) => (
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
                disabled={!!(editingCard && (editingCard.status === 'finalizado' || editingCard.status === 'inviabilizado')) || sprintIsFinished}
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
              <div className="p-[8px] text-sm text-[var(--color-destructive)] bg-red-50 border border-red-200 rounded-[8px] whitespace-pre-line">
                {cardFormError}
              </div>
            )}

            <RequestDueDateChangeModal
              open={dueDateRequestOpen}
              onOpenChange={setDueDateRequestOpen}
              preselectedCardId={editingCard?.id || null}
            />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => {
                setCardDialogOpen(false);
                setLogsModalOpen(false);
              }}>
                {(editingCard && (editingCard.status === 'finalizado' || editingCard.status === 'inviabilizado')) || sprintIsFinished ? 'Fechar' : 'Cancelar'}
              </Button>
              {!(editingCard && (editingCard.status === 'finalizado' || editingCard.status === 'inviabilizado')) && !sprintIsFinished && (
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
                ? `Tem certeza que deseja excluir este card? Esta ação não pode ser desfeita.`
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

      {/* Delete Project Confirmation Dialog */}
      <Dialog open={deleteProjectDialogOpen} onOpenChange={setDeleteProjectDialogOpen}>
        <DialogContent onClose={() => {
          setDeleteProjectDialogOpen(false);
        }}>
          <DialogHeader>
            <DialogTitle>Confirmar Exclusão de Projeto</DialogTitle>
            <DialogDescription>
              Tem certeza que deseja excluir o projeto "{project?.nome}"? Esta ação não pode ser desfeita e todos os cards associados também serão excluídos.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setDeleteProjectDialogOpen(false);
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
                'Excluir Projeto'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Configurar Projeto (supervisor) - Etapas do Kanban */}
      <Dialog
        open={configProjectDialogOpen}
        onOpenChange={(open) => {
          setConfigProjectDialogOpen(open);
          if (!open) {
            setRemoveStageMoveDialogOpen(false);
            setRemoveStageConflict(null);
            setRemoveStageMoveToKey('');
            setStageKeyToAdd('');
            setNewStageLabel('');
            setNewStageIsTerminal(false);
            setNewStageRequiresRequiredData(false);
          }
        }}
      >
        <DialogContent
          className="max-w-[860px] h-[80vh] overflow-y-auto"
          onClose={() => setConfigProjectDialogOpen(false)}
        >
          <DialogHeader>
            <DialogTitle>Configurar Projeto</DialogTitle>
            <DialogDescription>
              Defina quais etapas aparecem no Kanban e em que ordem.
            </DialogDescription>
          </DialogHeader>

          {configLoading ? (
            <div className="flex items-center justify-center py-[24px]">
              <Loader2 className="h-[32px] w-[32px] animate-spin text-[var(--color-primary)]" />
            </div>
          ) : (
            <div className="space-y-[16px]">
              <div className="space-y-[8px]">
                <div className="flex items-center justify-between gap-[16px]">
                  <h3 className="text-sm font-medium">Etapas atuais</h3>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={refreshProjectStages}
                  >
                    Recarregar
                  </Button>
                </div>

                <div className="space-y-[8px]">
                  {stages.map((stage, index) => (
                    <div
                      key={stage.id}
                      className="flex items-center justify-between gap-[12px] p-[12px] rounded-[10px] border border-[var(--color-border)] bg-[var(--color-background)]"
                    >
                      <div className="flex items-center gap-[10px] min-w-0">
                        <span className={`w-[10px] h-[10px] rounded-full ${stage.color}`} />
                        <div className="min-w-0">
                          <div className="font-medium text-sm truncate">{stage.label}</div>
                          <div className="text-xs text-[var(--color-muted-foreground)] truncate">
                            {stage.id}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-[8px] flex-shrink-0">
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="h-[34px] w-[34px]"
                          onClick={() => moveStageBy(index, -1)}
                          disabled={index === 0}
                        >
                          <ChevronUp className="h-[16px] w-[16px]" />
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="h-[34px] w-[34px]"
                          onClick={() => moveStageBy(index, 1)}
                          disabled={index === stages.length - 1}
                        >
                          <ChevronDown className="h-[16px] w-[16px]" />
                        </Button>
                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
                          onClick={() => handleRequestRemoveStage(stage.id)}
                        >
                          Remover
                        </Button>
                      </div>
                    </div>
                  ))}

                  {stages.length === 0 && (
                    <div className="text-sm text-[var(--color-muted-foreground)]">
                      Nenhuma etapa configurada.
                    </div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-[16px]">
                <div className="space-y-[8px]">
                  <h3 className="text-sm font-medium">Adicionar etapa existente</h3>

                  <div className="space-y-[8px]">
                    <Label htmlFor="add-stage">Etapa</Label>
                    <select
                      id="add-stage"
                      className="flex h-[40px] w-full rounded-[8px] border border-[var(--color-input)] bg-[var(--color-background)] px-[12px] text-sm"
                      value={stageKeyToAdd}
                      onChange={(e) => setStageKeyToAdd(e.target.value)}
                    >
                      <option value="">Selecione...</option>
                      {globalStages
                        .filter((s) => !stages.some((ps) => ps.id === s.key))
                        .map((s) => (
                          <option key={s.key} value={s.key}>
                            {s.label}
                          </option>
                        ))}
                    </select>

                    <Button
                      type="button"
                      disabled={!stageKeyToAdd}
                      onClick={handleAddExistingStage}
                    >
                      Adicionar
                    </Button>
                  </div>
                </div>

                <div className="space-y-[8px]">
                  <h3 className="text-sm font-medium">Criar nova etapa</h3>

                  <div className="space-y-[8px]">
                    <Label htmlFor="new-stage-label">Label</Label>
                    <Input
                      id="new-stage-label"
                      value={newStageLabel}
                      onChange={(e) => setNewStageLabel(e.target.value)}
                      placeholder="Ex.: Em revisão"
                    />

                    <div className="flex items-center gap-[12px]">
                      <label className="flex items-center gap-[8px] text-sm">
                        <input
                          type="checkbox"
                          checked={newStageIsTerminal}
                          onChange={(e) => setNewStageIsTerminal(e.target.checked)}
                        />
                        Etapa de finalização
                      </label>
                      <label className="flex items-center gap-[8px] text-sm">
                        <input
                          type="checkbox"
                          checked={newStageRequiresRequiredData}
                          onChange={(e) => setNewStageRequiresRequiredData(e.target.checked)}
                        />
                        Requer dados obrigatórios
                      </label>
                    </div>

                    <Button
                      type="button"
                      onClick={handleCreateStageAndAddToProject}
                      disabled={!newStageLabel.trim()}
                    >
                      Criar e adicionar
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Remover etapa com cards (movendo antes) */}
      <Dialog
        open={removeStageMoveDialogOpen}
        onOpenChange={(open) => {
          setRemoveStageMoveDialogOpen(open);
          if (!open) {
            setRemoveStageConflict(null);
            setRemoveStageMoveToKey('');
          }
        }}
      >
        <DialogContent onClose={() => setRemoveStageMoveDialogOpen(false)} className="max-w-[520px]">
          <DialogHeader>
            <DialogTitle>Remover etapa</DialogTitle>
            <DialogDescription className="whitespace-pre-line">
              {removeStageConflict
                ? `Esta etapa possui ${removeStageConflict.cardsCount} card(s).\nSelecione para onde mover antes de remover.`
                : ''}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-[8px] mt-[16px]">
            <Label htmlFor="move-to-stage">Mover para</Label>
            <select
              id="move-to-stage"
              className="flex h-[40px] w-full rounded-[8px] border border-[var(--color-input)] bg-[var(--color-background)] px-[12px] text-sm"
              value={removeStageMoveToKey}
              onChange={(e) => setRemoveStageMoveToKey(e.target.value)}
            >
              {removeStageConflict?.stageKey &&
                stages
                  .filter((s) => s.id !== removeStageConflict.stageKey)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
            </select>
          </div>

          <DialogFooter className="gap-[8px] mt-[16px]">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setRemoveStageMoveDialogOpen(false);
                setRemoveStageConflict(null);
                setRemoveStageMoveToKey('');
              }}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={!removeStageMoveToKey}
              onClick={handleConfirmMoveAndRemove}
            >
              Mover e remover
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
            <DialogDescription className="whitespace-pre-line">
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

      {/* Pendência Modal */}
      <PendenciaModal
        isOpen={pendenciaModalOpen}
        onClose={() => {
          setPendenciaModalOpen(false);
          setPendenciaCardId(null);
          setPendenciaCardName('');
          setPendenciaNewStatus(null);
        }}
        onConfirm={handlePendenciaConfirm}
        cardName={pendenciaCardName}
      />

      {/* Conclusão Modal */}
      <ConclusaoModal
        isOpen={conclusaoModalOpen}
        onClose={() => {
          setConclusaoModalOpen(false);
          setConclusaoCardId(null);
          setConclusaoCardName(null);
          setConclusaoNewStatus(null);
          setConclusaoPendingData(null);
        }}
        onConfirm={handleConclusaoConfirm}
        cardName={conclusaoCardName || undefined}
      />
    </div>
  );
}

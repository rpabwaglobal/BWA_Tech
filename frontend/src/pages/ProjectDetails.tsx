import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { useSprintKanbanWebSocket } from '@/hooks/useSprintKanbanWebSocket';
import { Button } from '@/components/ui/button';
import { CardAnexosSection } from '@/components/CardAnexosSection';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
import type { CardLink } from '@/services/cardService';
import { sprintService } from '@/services/sprintService';
import { kanbanStageService } from '@/services/kanbanStageService';
import { cardPinService } from '@/services/cardPinService';
import type { KanbanStage as KanbanStageType } from '@/services/kanbanStageService';
import { ROUTES } from '@/routes';
import type { Project } from '@/services/projectService';
import type { Card as CardType } from '@/services/cardService';
import type { Sprint } from '@/services/sprintService';
import {
  ArrowLeft,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  FolderKanban,
  Zap,
  User,
  Calendar,
  Loader2,
  CheckCircle2,
  Circle,
  AlertCircle,
  XCircle,
  Clock,
  Lock,
  ExternalLink,
  Trash2,
  Pin,
  PinOff,
  Plus,
  Archive,
  ArchiveRestore,
  ChevronDown,
  ChevronUp,
  Pencil,
  Settings,
  SlidersHorizontal,
  Headset,
  CheckSquare,
  FolderInput,
  Trophy,
} from 'lucide-react';
import { formatDate, formatDateTime, isCardAtrasado, calcularDiasTotais, calcularDiasUteis } from '@/lib/dateUtils';
import { ATRASADO_STATUS_BADGE } from '@/lib/dueDateBadgeClasses';
import { sprintFimDiaParaCalendario, sprintInicioDiaParaCalendario } from '@/lib/sprintFechamento';
import { CardLogsModal, CARD_TIMELINE_LAYOUT_RESERVE_PX } from '@/components/CardLogsModal';
import { PendenciaModal } from '@/components/PendenciaModal';
import { ConclusaoModal } from '@/components/ConclusaoModal';
import { cardLogService } from '@/services/cardLogService';
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

function DragOverlayCard({
  card,
  users,
  showPriorityColorsOnCards,
}: {
  card: CardType;
  users: UserType[];
  showPriorityColorsOnCards: boolean;
}) {
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

  const responsibleUser = card.responsavel
    ? users.find((u) => String(u.id) === String(card.responsavel))
    : undefined;
  const responsibleRoleLabel = responsibleUser ? getRoleLabel(responsibleUser.role) : '';
  const ink = kanbanCardInkTextClass(showPriorityColorsOnCards);

  return (
    <div
      className={cn(
        'p-[12px] bg-[var(--color-kanban-card)] rounded-[8px] border-l-[3px] shadow-2xl opacity-95 rotate-2 w-[300px]',
        !showPriorityColorsOnCards && 'border-l-[var(--color-border)]',
      )}
      style={showPriorityColorsOnCards ? getPriorityStyle(card.prioridade, card.id) : undefined}
    >
      <div className="flex items-start justify-between gap-[8px]">
        <div className="flex items-center gap-[8px] flex-1 min-w-0">
          <span className={cn('font-medium text-sm truncate flex-1', ink)}>
            {card.nome}
          </span>
        </div>
      </div>

      {/* Entrega (logo abaixo do nome) + Tag atrasado/pendencias alinhada à direita */}
      {card.data_fim && (
        <div className="flex items-center justify-between gap-[8px] mt-[6px]">
          <div className={cn('flex items-center gap-[4px] text-xs', ink)}>
            <Calendar className="h-[12px] w-[12px]" />
            {formatDate(card.data_fim)}
          </div>
          <div className="flex items-center gap-[8px]">
            {isCardAtrasado(card) ? (
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
          <span
            className={cn(
              'flex items-center gap-[2px] text-[10px] px-[6px] py-[2px] rounded-full',
              showPriorityColorsOnCards
                ? kanbanScriptLinkOnPastelClass
                : 'bg-[var(--color-primary)]/20 text-[var(--color-primary)]',
            )}
          >
            <ExternalLink className="h-[10px] w-[10px]" />
            Script
          </span>
        )}
        {card.links && card.links.map((link, idx) => (
          <span
            key={idx}
            className={cn(
              'flex max-w-[120px] items-center gap-[2px] text-[10px] px-[6px] py-[2px] rounded-full truncate',
              showPriorityColorsOnCards
                ? kanbanScriptLinkOnPastelClass
                : 'bg-[var(--color-primary)]/20 text-[var(--color-primary)]',
            )}
          >
            <ExternalLink className="h-[10px] w-[10px] shrink-0" />
            <span className="truncate">{link.label.trim() ? link.label : `Link ${idx + 1}`}</span>
          </span>
        ))}
      </div>

      {card.descricao && (
        <p className={cn('mt-[8px] text-xs line-clamp-2', ink)}>
          {card.descricao}
        </p>
      )}

      <div className="flex items-center justify-between mt-[8px]">
        <div className="flex items-center gap-[8px]">
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
        <div className="flex items-center gap-[6px] shrink-0">
          {card.score_final != null && (
            <span
              title={`Score: ${Number(card.score_final).toFixed(1)}`}
              className="inline-flex items-center gap-[3px] rounded-full bg-[var(--color-primary)] px-[6px] py-[2px] text-[10px] font-semibold text-[var(--color-primary-foreground)]"
            >
              <Trophy className="h-[10px] w-[10px]" />
              {Number(card.score_final).toFixed(1)}
            </span>
          )}
          <span
            className={cn(
              'text-[10px] px-[6px] py-[2px] rounded-full font-medium',
              showPriorityColorsOnCards
                ? kanbanMutedChipOnPastelClass
                : cn('bg-[var(--color-muted)]/50', ink),
            )}
          >
            {getPriorityLabel(card.prioridade)}
          </span>
        </div>
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
  users,
  showPriorityColorsOnCards,
  selectionMode,
  selectedCardIds,
  pinnedCardIds,
  onTogglePin,
}: {
  stage: ProjectStage;
  cards: CardType[];
  onCardClick: (card: CardType) => void;
  onCardDelete: (e: React.MouseEvent, cardId: string) => void;
  disabled?: boolean;
  userRole?: string;
  users: UserType[];
  showPriorityColorsOnCards: boolean;
  selectionMode: boolean;
  selectedCardIds: string[];
  pinnedCardIds: Set<string>;
  onTogglePin: (cardId: string, pin: boolean) => void;
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

  const getAreaBadgeColor = (area: string) =>
    getKanbanAreaBadgeClasses(area, showPriorityColorsOnCards);

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
                  getAreaBadgeColor={getAreaBadgeColor}
                  disabled={disabled}
                  userRole={userRole}
                  users={users}
                  showPriorityColorsOnCards={showPriorityColorsOnCards}
                  selectionMode={selectionMode}
                  selected={selectedCardIds.includes(card.id)}
                  excludedFromBulkMove={
                    selectionMode && (card.status === 'finalizado' || card.status === 'inviabilizado')
                  }
                  isPinned={pinnedCardIds.has(card.id)}
                  onTogglePin={onTogglePin}
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
  getAreaBadgeColor,
  disabled = false,
  userRole,
  users,
  showPriorityColorsOnCards,
  selectionMode,
  selected,
  excludedFromBulkMove,
  isPinned,
  onTogglePin,
}: {
  card: CardType;
  onClick: () => void;
  onDelete: (e: React.MouseEvent) => void;
  getCardStatusIcon: (status: string) => React.ReactNode;
  getAreaBadgeColor: (area: string) => string;
  disabled?: boolean;
  userRole?: string;
  users: UserType[];
  showPriorityColorsOnCards: boolean;
  selectionMode: boolean;
  selected: boolean;
  /** Em modo seleção: card em etapa de conclusão não entra na seleção para mover */
  excludedFromBulkMove: boolean;
  /** Se o usuário atual fixou este card em "Meus Afazeres → Cards Fixados". */
  isPinned?: boolean;
  /** Toggle do pin pessoal. Recebe o cardId e o novo estado desejado. */
  onTogglePin?: (cardId: string, pin: boolean) => void;
}) {
  // Verificar se card está finalizado ou inviabilizado
  const isCardFinished = card.status === 'finalizado' || card.status === 'inviabilizado';
  const isInviabilizado = card.status === 'inviabilizado';
  // Desabilitar drag na sprint finalizada, card finalizado ou modo seleção (clique marca card)
  const isDragDisabled = disabled || isCardFinished || selectionMode;
  // Permitir clique para visualização sempre (mesmo se sprint finalizada ou card finalizado)
  const canClick = true;
  // Permitir delete:
  // - Se sprint não está finalizada
  // - Se card está inviabilizado, apenas admin ou supervisor podem deletar
  const canDelete = !disabled && (!isInviabilizado || userRole === 'admin' || userRole === 'supervisor');
  // Permitir pin pessoal: card precisa estar em andamento (não finalizado/inviabilizado) e sprint ativa.
  const canPin = !!onTogglePin && !disabled && !isCardFinished;

  const responsibleUser = card.responsavel
    ? users.find((u) => String(u.id) === String(card.responsavel))
    : undefined;
  const responsibleRoleLabel = responsibleUser ? getRoleLabel(responsibleUser.role) : '';
  const ink = kanbanCardInkTextClass(showPriorityColorsOnCards);

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
      style={{
        ...style,
        ...(showPriorityColorsOnCards ? getPriorityStyle(card.prioridade, card.id) : {}),
      }}
      {...(!isDragDisabled ? attributes : {})}
      {...(!isDragDisabled ? listeners : {})}
      className={cn(
        'p-[12px] bg-[var(--color-kanban-card)] rounded-[8px] border-l-[3px] shadow-sm hover:shadow-md transition-shadow cursor-pointer group',
        !showPriorityColorsOnCards && 'border-l-[var(--color-border)]',
        selected && 'ring-2 ring-[var(--color-primary)] border-[var(--color-primary)]',
        excludedFromBulkMove && 'cursor-not-allowed opacity-50',
      )}
      title={
        excludedFromBulkMove
          ? 'Cards em Finalizado ou Inviabilizado não podem ser movidos em massa.'
          : undefined
      }
      onClick={onClick}
    >
      {/* Aplica cor exata via inline style (garante HEX) */}
      <div className="flex items-start justify-between gap-[8px]">
        <div className="flex items-center gap-[8px] flex-1 min-w-0">
          <span className={cn('font-medium text-sm truncate flex-1', ink)}>
            {card.nome}
          </span>
        </div>
        {(canDelete || canPin) && (
          <div className="flex gap-[2px] opacity-0 group-hover:opacity-100 transition-opacity">
            {canPin && (
              <Button
                variant="ghost"
                size="icon"
                onClick={(e) => {
                  e.stopPropagation();
                  onTogglePin?.(card.id, !isPinned);
                }}
                className="h-[24px] w-[24px]"
                title={isPinned ? 'Desafixar de Meus Afazeres' : 'Fixar em Meus Afazeres'}
              >
                {isPinned ? (
                  <PinOff className="h-[12px] w-[12px] text-[var(--color-primary)]" />
                ) : (
                  <Pin className="h-[12px] w-[12px] text-[var(--color-muted-foreground)]" />
                )}
              </Button>
            )}
            {canDelete && (
              <Button
                variant="ghost"
                size="icon"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(e);
                }}
                className="h-[24px] w-[24px]"
                title="Excluir card"
              >
                <Trash2 className="h-[12px] w-[12px] text-red-500" />
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Entrega (logo abaixo do nome) + Tag atrasado/pendencias alinhada à direita */}
      {card.data_fim && (
        <div className="flex items-center justify-between gap-[8px] mt-[6px]">
          <div className={cn('flex items-center gap-[4px] text-xs', ink)}>
            <Calendar className="h-[12px] w-[12px]" />
            {formatDate(card.data_fim)}
          </div>
          <div className="flex items-center gap-[8px]">
            {isCardAtrasado(card) ? (
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
          <span className={`text-[10px] px-[6px] py-[2px] rounded-full ${getAreaBadgeColor(card.area)}`}>
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
        {card.links && card.links.map((link, idx) => (
          <a
            key={idx}
            href={normalizeExternalUrl(link.url)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            title={link.url}
            className={cn(
              'flex max-w-[120px] items-center gap-[2px] text-[10px] px-[6px] py-[2px] rounded-full transition-colors truncate',
              showPriorityColorsOnCards
                ? kanbanScriptLinkOnPastelClass
                : 'bg-[var(--color-primary)]/20 text-[var(--color-primary)] hover:bg-[var(--color-primary)]/35',
            )}
          >
            <ExternalLink className="h-[10px] w-[10px] shrink-0" />
            <span className="truncate">{link.label.trim() ? link.label : `Link ${idx + 1}`}</span>
          </a>
        ))}
      </div>

      {card.descricao && (
        <p className={cn('mt-[8px] text-xs line-clamp-2', ink)}>
          {card.descricao}
        </p>
      )}

      <div className="flex items-center justify-between mt-[8px]">
        <div className="flex items-center gap-[8px]">
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
        <div className="flex items-center gap-[6px] shrink-0">
          {card.score_final != null && (
            <span
              title={`Score: ${Number(card.score_final).toFixed(1)}`}
              className="inline-flex items-center gap-[3px] rounded-full bg-[var(--color-primary)] px-[6px] py-[2px] text-[10px] font-semibold text-[var(--color-primary-foreground)]"
            >
              <Trophy className="h-[10px] w-[10px]" />
              {Number(card.score_final).toFixed(1)}
            </span>
          )}
          <span
            className={cn(
              'text-[10px] px-[6px] py-[2px] rounded-full font-medium',
              showPriorityColorsOnCards
                ? kanbanMutedChipOnPastelClass
                : cn('bg-[var(--color-muted)]/50', ink),
            )}
          >
            {getPriorityLabel(card.prioridade)}
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * Asterisco de campo obrigatório. Quando o dado está faltando (obrigatório e
 * vazio) fica dourado e ligeiramente maior; quando já preenchido volta ao
 * asterisco discreto padrão.
 */
function RequiredMark({ missing }: { missing: boolean }) {
  return (
    <span
      aria-hidden="true"
      title={missing ? 'Campo obrigatório não preenchido' : 'Campo obrigatório'}
      className={cn(
        'ml-0.5 align-middle leading-none',
        missing
          ? 'text-[1.2em] font-bold text-[#C79200]'
          : 'text-[var(--color-muted-foreground)]',
      )}
    >
      *
    </span>
  );
}

/** Destaque de input obrigatório vazio: anel vermelho piscando (mesma grossura,
 *  animando só a opacidade — sem crescer). Ver `.required-ring-blink` no index.css. */
function requiredHighlight(missing: boolean): string {
  return cn('rounded-[8px]', missing && 'required-ring-blink');
}

export default function ProjectDetails() {
  const { id, cardId } = useParams<{ id: string; cardId?: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [project, setProject] = useState<Project | null>(null);
  const [sprint, setSprint] = useState<Sprint | null>(null);
  const [cards, setCards] = useState<CardType[]>([]);

  // Real-time: assina o Kanban da sprint do projeto. Eventos de OUTROS
  // projetos da mesma sprint passam batido (o card_id não está no estado local).
  const sprintIdForRealtime = sprint?.id ?? null;
  const handleCardMovedRealtime = useCallback(
    (evt: { card_id: number; new_status: string; actor_user_id: number | null }) => {
      // Anti-eco: ignora o próprio user (já atualizou via PATCH)
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
    sprintId: sprintIdForRealtime,
    enabled: !!sprintIdForRealtime,
    onCardMoved: handleCardMovedRealtime,
  });
  const [stages, setStages] = useState<ProjectStage[]>(DEFAULT_PROJECT_STAGES);
  const [users, setUsers] = useState<UserType[]>([]);
  const [loading, setLoading] = useState(true);

  // Configuração de etapas (Kanban) do projeto - supervisor ou admin
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
  /** Evita aplicar estado de aberturas concorrentes (clique + useEffect do deep link). */
  const openCardGenerationRef = useRef(0);
  /** Enquanto true, não abrir pelo deep link (ex.: após fechar, até a URL perder /card/:id). */
  const suppressCardDeepLinkRef = useRef(false);
  const cardSubmitInFlightRef = useRef(false);
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
  const [cardLinks, setCardLinks] = useState<CardLink[]>([]);
  const [newLinkUrl, setNewLinkUrl] = useState('');
  const [newLinkLabel, setNewLinkLabel] = useState('');
  // Formulário de link recolhido por padrão: só aparece ao clicar em "Adicionar link".
  const [showLinkForm, setShowLinkForm] = useState(false);
  const [editingLinkIdx, setEditingLinkIdx] = useState<number | null>(null);
  // Link do Script: com valor vira link + editar/remover; ao editar, volta ao input.
  const [editingScript, setEditingScript] = useState(false);

  const openAddLink = () => {
    setEditingLinkIdx(null);
    setNewLinkUrl('');
    setNewLinkLabel('');
    setShowLinkForm(true);
  };
  const openEditLink = (idx: number) => {
    const link = cardLinks[idx];
    if (!link) return;
    setEditingLinkIdx(idx);
    setNewLinkUrl(link.url);
    setNewLinkLabel(link.label);
    setShowLinkForm(true);
  };
  const cancelLinkForm = () => {
    setShowLinkForm(false);
    setEditingLinkIdx(null);
    setNewLinkUrl('');
    setNewLinkLabel('');
  };
  // Enter salva: adiciona (ou atualiza, se editando) sem precisar clicar em botão.
  const submitCardLink = () => {
    const url = newLinkUrl.trim();
    if (!url) return;
    const label = newLinkLabel.trim();
    const wasEditing = editingLinkIdx !== null;
    setCardLinks((prev) =>
      wasEditing
        ? prev.map((l, i) => (i === editingLinkIdx ? { url, label } : l))
        : [...prev, { url, label }],
    );
    setNewLinkUrl('');
    setNewLinkLabel('');
    setEditingLinkIdx(null);
    // Edição pontual → fecha o form. Adição → mantém aberto para incluir outro.
    if (wasEditing) setShowLinkForm(false);
  };
  const handleRemoveCardLink = (idx: number) => {
    setCardLinks((prev) => prev.filter((_, i) => i !== idx));
    if (editingLinkIdx === idx) cancelLinkForm();
  };
  const [cardFormLoading, setCardFormLoading] = useState(false);
  const [cardFormError, setCardFormError] = useState('');
  const [dueDateRequestOpen, setDueDateRequestOpen] = useState(false);
  const [showPriorityColorsOnCards, setShowPriorityColorsOnCards] = useState(
    readShowPriorityColorsOnKanbanCards,
  );

  /** Seleção em massa no Kanban (barra inferior + modais). */
  const [cardSelectionMode, setCardSelectionMode] = useState(false);
  const [selectedKanbanCardIds, setSelectedKanbanCardIds] = useState<string[]>([]);

  /** Cards fixados pelo usuário (página "Meus Afazeres → Cards Fixados"). */
  const [pinnedCardIds, setPinnedCardIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    cardPinService
      .list()
      .then((pins) => {
        if (cancelled) return;
        setPinnedCardIds(new Set(pins.map((p) => p.card)));
      })
      .catch((err) => console.error('Erro ao carregar pins do usuário:', err));
    return () => {
      cancelled = true;
    };
  }, []);

  const handleTogglePin = useCallback(async (cardId: string, pin: boolean) => {
    // Optimistic update
    setPinnedCardIds((prev) => {
      const next = new Set(prev);
      if (pin) next.add(cardId);
      else next.delete(cardId);
      return next;
    });
    try {
      if (pin) await cardPinService.pin(cardId);
      else await cardPinService.unpin(cardId);
    } catch (err) {
      console.error('Erro ao alternar pin do card:', err);
      // Reverte em caso de erro
      setPinnedCardIds((prev) => {
        const next = new Set(prev);
        if (pin) next.delete(cardId);
        else next.add(cardId);
        return next;
      });
    }
  }, []);
  const [bulkDeleteCardsDialogOpen, setBulkDeleteCardsDialogOpen] = useState(false);
  const [bulkDeleteCardsLoading, setBulkDeleteCardsLoading] = useState(false);
  const [bulkMoveCardsDialogOpen, setBulkMoveCardsDialogOpen] = useState(false);
  const [bulkMoveCardsLoading, setBulkMoveCardsLoading] = useState(false);
  const [bulkMoveCardsForm, setBulkMoveCardsForm] = useState({ sprint: '', projeto: '' });
  const [bulkMoveCardsError, setBulkMoveCardsError] = useState('');
  const [bulkMoveCardsSprints, setBulkMoveCardsSprints] = useState<Sprint[]>([]);
  const [bulkMoveCardsProjects, setBulkMoveCardsProjects] = useState<Project[]>([]);
  const [bulkMoveCardsCatalogLoading, setBulkMoveCardsCatalogLoading] = useState(false);
  /** Modal mover: primeiro escolhe sprint, depois a lista de sprints é substituída pelos projetos */
  const [bulkMoveWizardStep, setBulkMoveWizardStep] = useState<'sprint' | 'project'>('sprint');

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
    if (!id) return;
    setLoading(true);
    setCards([]);
    void loadData();
  }, [id]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        SHOW_PRIORITY_COLORS_ON_KANBAN_CARDS_KEY,
        showPriorityColorsOnCards ? 'true' : 'false',
      );
    } catch {
      // ignore
    }
  }, [showPriorityColorsOnCards]);

  const loadData = async () => {
    if (!id) return;
    try {
      const [projectData, cardsData, usersData, kanbanConfigData] = await Promise.all([
        projectService.getById(id),
        cardService.getByProject(id),
        userService.getAll(),
        projectService.getKanbanConfig(id).catch(() => null),
      ]);
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

  // Verificar se a sprint está encerrada para edição (backend ou já passou o fechamento_em)
  const isSprintFinished = (spr: Sprint | null): boolean => {
    if (!spr) return false;
    if (spr.finalizada) return true;
    if (!spr.fechamento_em) return false;
    const dayStr = sprintFimDiaParaCalendario(spr);
    if (dayStr) {
      const parts = dayStr.split('-').map((x) => parseInt(x, 10));
      if (parts.length === 3 && parts.every((n) => !Number.isNaN(n))) {
        const [y, mo, d] = parts;
        const endOfClosingDay = new Date(y, mo - 1, d, 23, 59, 59, 999);
        return Date.now() > endOfClosingDay.getTime();
      }
    }
    return new Date(spr.fechamento_em).getTime() <= Date.now();
  };

  const sprintIsFinished = isSprintFinished(sprint);
  const isSupportProject = normalizeProjectName(project?.nome || '') === 'suporte';

  const selectedKanbanIdsEligibleForMove = useMemo(
    () =>
      selectedKanbanCardIds.filter((cid) => {
        const c = cards.find((x) => x.id === cid);
        return c && c.status !== 'finalizado' && c.status !== 'inviabilizado';
      }),
    [selectedKanbanCardIds, cards],
  );

  useEffect(() => {
    if (isSupportProject && cardPriorityFilter) {
      setCardPriorityFilter('');
    }
  }, [isSupportProject, cardPriorityFilter]);

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
    if (cardPriorityFilter && !isSupportProject) {
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

  const closeCardDialog = () => {
    setCardDialogOpen(false);
    setLogsModalOpen(false);
    setPendingStatusChange(null);
    const routeProjectId = id || editingCard?.projeto;
    if (routeProjectId && cardId) {
      suppressCardDeepLinkRef.current = true;
      navigate(ROUTES.projeto(String(routeProjectId)), { replace: true });
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
      // data_inicio é preenchida automaticamente ao entrar em desenvolvimento —
      // então já a consideramos ANTES de validar, para não constar como pendência
      // (senão o modal de atenção bloqueava mesmo o campo se preenchendo sozinho).
      let autoDataInicio: string | undefined;
      if (newStageId === 'em_desenvolvimento' && !card.data_inicio) {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        autoDataInicio = `${year}-${month}-${day}T${hours}:${minutes}`;
      }
      const cardParaValidar = autoDataInicio
        ? { ...card, data_inicio: autoDataInicio }
        : card;

      const validation = validateCardRequiredData(cardParaValidar);
      if (!validation.valid) {
        // Armazenar o movimento pendente para completar após salvar
        setPendingStatusChange({ cardId: cardId, newStatus: newStageId });
        // Mostrar aviso e abrir modal de edição. A data_inicio de rascunho vai
        // como override (o card NÃO é salvo aqui): só será persistida quando o
        // usuário preencher os dados que faltam e salvar o card na nova etapa.
        // Se fechar sem salvar, o card permanece em "A desenvolver" e a data
        // nova é descartada.
        const missingList = validation.missing.map((item, index) => `${index + 1}. ${capitalizeFirst(item)}`).join('\n');
        const stageLabel = getStageLabel(newStageId);
        setAlertMessage(`Para mover o card para "${stageLabel}", é necessário preencher:\n\n${missingList}\n\nO formulário de edição será aberto.`);
        setAlertDialogOpen(true);
        openEditCardDialog(card, {
          overrideStatus: newStageId,
          overrideDataInicio: autoDataInicio,
        });
        return;
      }

      // Válido: salva o status e a data de início preenchida automaticamente.
      const updateData: any = { status: newStageId };
      if (autoDataInicio) {
        updateData.data_inicio = autoDataInicio;
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

    // Se não tem data_inicio, preencher automaticamente ao entrar em
    // desenvolvimento — mesmo comportamento da troca manual de etapa. Sem isso,
    // arrastar de "A desenvolver" para "Em desenvolvimento" (quando essa etapa
    // não exige dados obrigatórios) deixava a data de início vazia.
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

    // Atualizar o estado local IMEDIATAMENTE para evitar animação de retorno
    setCards((prevCards) =>
      prevCards.map((c) =>
        c.id.toString() === cardId ? { ...c, ...updateData } : c
      )
    );

    try {
      // Atualizar o status do card na API
      await cardService.update(card.id, updateData);
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
        closeCardDialog();
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

  const openEditCardDialog = async (
    card: CardType,
    options?: { skipUrlSync?: boolean; overrideStatus?: string; overrideDataInicio?: string },
  ) => {
    const projectKey = String(id || card.projeto || project?.id || '').trim();

    if (editingCard?.id === card.id && cardDialogOpen) {
      if (!options?.skipUrlSync && projectKey) {
        navigate(ROUTES.projetoCard(projectKey, String(card.id)), { replace: true });
      }
      return;
    }

    if (!options?.skipUrlSync) {
      suppressCardDeepLinkRef.current = false;
    }

    if (!options?.skipUrlSync && projectKey) {
      navigate(ROUTES.projetoCard(projectKey, String(card.id)), { replace: true });
    }

    const gen = ++openCardGenerationRef.current;

    const applyCardToEditDialog = (fullCard: CardType) => {
      // overrideStatus evita depender do pendingStatusChange (setState assíncrono:
      // ainda estaria nulo quando este closure roda, zerando a data_inicio).
      const targetStatus =
        options?.overrideStatus
        ?? (pendingStatusChange && pendingStatusChange.cardId === fullCard.id.toString()
          ? pendingStatusChange.newStatus
          : fullCard.status);

      setEditingCard(fullCard);
      setCardDialogOpen(true);
      setLogsModalOpen(true);

      // data_inicio de rascunho (vinda do drag) é só pré-preenchida no form —
      // só será persistida quando o card for de fato salvo na etapa.
      let dataInicio =
        targetStatus === 'a_desenvolver'
          ? ''
          : (options?.overrideDataInicio || fullCard.data_inicio || '');
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
      setCardLinks(fullCard.links ?? []);
      setNewLinkUrl('');
      setNewLinkLabel('');
      setShowLinkForm(false);
      setEditingLinkIdx(null);
      setEditingScript(false);

      setCardFormError('');
    };

    applyCardToEditDialog(card);

    try {
      const fullCard = await cardService.getById(card.id);
      if (gen !== openCardGenerationRef.current) return;

      if (id && String(fullCard.projeto) !== String(id)) {
        navigate(ROUTES.projetoCard(String(fullCard.projeto), String(fullCard.id)), { replace: true });
        return;
      }

      applyCardToEditDialog(fullCard);
    } catch (error) {
      console.error('Erro ao carregar card completo:', error);
    }
  };

  const openCreateCardDialog = () => {
    if (isSupportProject) {
      setAlertMessage('Neste projeto, os cards são criados automaticamente via integração. A criação manual está desabilitada.');
      setAlertDialogOpen(true);
      return;
    }

    setLogsModalOpen(false);

    if (id && cardId) {
      suppressCardDeepLinkRef.current = true;
      navigate(ROUTES.projeto(id), { replace: true });
    }

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
    setCardLinks([]);
    setNewLinkUrl('');
    setNewLinkLabel('');
    setShowLinkForm(false);
    setEditingLinkIdx(null);
    setEditingScript(false);
    setCardFormError('');
    setCardDialogOpen(true);
  };

  // Link direto: /projeto/:id/card/:cardId abre o formulário do card
  useEffect(() => {
    if (!id || cards.length === 0 || loading) return;

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
      navigate(ROUTES.projeto(String(id)), { replace: true });
      return;
    }
    void openEditCardDialog(card, { skipUrlSync: true });
  }, [id, cardId, cards, cardDialogOpen, editingCard, loading]);

  // Deep-link `?newCard=1` (vindo do Dashboard → Atalho "Criar Card")
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    if (loading || !project) return;
    if (searchParams.get('newCard') !== '1') return;
    if (cardDialogOpen) return;
    openCreateCardDialog();
    // Limpa o param pra não reabrir ao F5
    const next = new URLSearchParams(searchParams);
    next.delete('newCard');
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, project, searchParams]);

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
    if (user?.role !== 'supervisor' && user?.role !== 'admin') return;
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
    if (cardSubmitInFlightRef.current || cardFormLoading) return;
    cardSubmitInFlightRef.current = true;
    setCardFormLoading(true);
    setCardFormError('');
    const previousCardsCount = cards.length;
    
    // Validar se a área foi selecionada
    if (!cardFormData.area || cardFormData.area.trim() === '') {
      setCardFormError('Por favor, selecione uma área para o card.');
      cardSubmitInFlightRef.current = false;
      setCardFormLoading(false);
      return;
    }
    
    // Bloquear submit se sprint estiver finalizada ou card estiver finalizado/inviabilizado
    if (sprintIsFinished) {
      setCardFormError('Cards de sprints finalizadas não podem ser editados.');
      cardSubmitInFlightRef.current = false;
      setCardFormLoading(false);
      return;
    }
    if (editingCard && (editingCard.status === 'finalizado' || editingCard.status === 'inviabilizado')) {
      setCardFormError('Cards finalizados ou inviabilizados não podem ser editados.');
      cardSubmitInFlightRef.current = false;
      setCardFormLoading(false);
      return;
    }

    if (!editingCard && isSupportProject) {
      setCardFormError('A criação manual de cards está desabilitada no projeto de suporte.');
      cardSubmitInFlightRef.current = false;
      setCardFormLoading(false);
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
      cardSubmitInFlightRef.current = false;
      setCardFormLoading(false);
      return;
    }

    // Validar se está mudando para uma etapa que exige dados obrigatórios
    if (requiresRequiredData(cardFormData.status)) {
      const validation = validateCardRequiredData(cardFormData as any);
      if (!validation.valid) {
        const missingList = validation.missing.map((item, index) => `${index + 1}. ${capitalizeFirst(item)}`).join('\n');
        const stageLabel = getStageLabel(cardFormData.status);
        setCardFormError(`Para o status "${stageLabel}", é necessário preencher:\n\n${missingList}.`);
        cardSubmitInFlightRef.current = false;
        setCardFormLoading(false);
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
        data_inicio:
          cardFormData.status === 'a_desenvolver'
            ? null
            : cardFormData.data_inicio || null,
        data_fim: cardFormData.data_fim || null,
        projeto: id!,
        links: cardLinks,
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
            closeCardDialog();
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
        setCards((prevCards) => [...prevCards, newCard]);
      }
      closeCardDialog();
    } catch (err: any) {
      // Cenário de produção observado: backend pode persistir o card e ainda assim responder erro.
      // Nessa situação, reconciliamos a lista para evitar duplicidade por novo clique.
      if (!editingCard && id) {
        try {
          const refreshedCards = await cardService.getByProject(id);
          if (refreshedCards.length > previousCardsCount) {
            setCards(refreshedCards);
            closeCardDialog();
            return;
          }
        } catch {
          // Se a reconciliação falhar, segue para tratamento padrão de erro.
        }
      }

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

  const getBulkMoveUserLabel = (userId?: string | null) => {
    if (!userId) return '—';
    const u = users.find((x) => String(x.id) === String(userId));
    if (!u) return String(userId);
    const name = `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim();
    return name || u.username;
  };

  const canBulkDeleteKanbanCard = (card: CardType): boolean => {
    if (sprintIsFinished) return false;
    if (card.status === 'inviabilizado' && user?.role !== 'admin' && user?.role !== 'supervisor') {
      return false;
    }
    return true;
  };

  const toggleKanbanCardSelected = (cardId: string) => {
    setSelectedKanbanCardIds((prev) =>
      prev.includes(cardId) ? prev.filter((id) => id !== cardId) : [...prev, cardId],
    );
  };

  const exitKanbanCardSelection = () => {
    setCardSelectionMode(false);
    setSelectedKanbanCardIds([]);
  };

  const openBulkMoveCardsModal = () => {
    const movableIds = selectedKanbanCardIds.filter((cid) => {
      const c = cards.find((x) => x.id === cid);
      return c && c.status !== 'finalizado' && c.status !== 'inviabilizado';
    });
    if (movableIds.length === 0) {
      setAlertMessage(
        'Só é possível mover cards que não estão nas etapas Finalizado ou Inviabilizado.',
      );
      setAlertDialogOpen(true);
      return;
    }
    if (movableIds.length < selectedKanbanCardIds.length) {
      setSelectedKanbanCardIds(movableIds);
    }
    setBulkMoveWizardStep('sprint');
    setBulkMoveCardsForm({ sprint: '', projeto: '' });
    setBulkMoveCardsError('');
    setBulkMoveCardsDialogOpen(true);
    setBulkMoveCardsCatalogLoading(true);
    void (async () => {
      try {
        const [sprintsData, projectsData] = await Promise.all([
          sprintService.getAll(),
          projectService.getAll(),
        ]);
        setBulkMoveCardsSprints(Array.isArray(sprintsData) ? sprintsData : []);
        setBulkMoveCardsProjects(Array.isArray(projectsData) ? projectsData : []);
      } catch {
        setBulkMoveCardsError('Não foi possível carregar sprints e projetos.');
        setBulkMoveCardsSprints([]);
        setBulkMoveCardsProjects([]);
      } finally {
        setBulkMoveCardsCatalogLoading(false);
      }
    })();
  };

  const handleBulkDeleteKanbanCardsConfirm = async () => {
    const ids = selectedKanbanCardIds.filter((cid) => {
      const c = cards.find((x) => x.id === cid);
      return c && canBulkDeleteKanbanCard(c);
    });
    if (ids.length === 0) {
      setBulkDeleteCardsDialogOpen(false);
      setAlertMessage('Nenhum dos cards selecionados pode ser apagado (sprint encerrada ou permissão).');
      setAlertDialogOpen(true);
      return;
    }
    setBulkDeleteCardsLoading(true);
    const failed: string[] = [];
    for (const id of ids) {
      try {
        await cardService.delete(id);
      } catch {
        failed.push(id);
      }
    }
    setCards((prev) => prev.filter((c) => !ids.includes(c.id) || failed.includes(c.id)));
    setSelectedKanbanCardIds((prev) => prev.filter((id) => failed.includes(id)));
    setBulkDeleteCardsLoading(false);
    setBulkDeleteCardsDialogOpen(false);
    if (failed.length === 0) {
      exitKanbanCardSelection();
      setAlertMessage(`${ids.length} card(s) apagado(s).`);
    } else {
      setAlertMessage(
        `${ids.length - failed.length} apagado(s). ${failed.length} falharam (rede ou permissão na API).`,
      );
    }
    setAlertDialogOpen(true);
  };

  const handleBulkMoveKanbanCardsSubmit = async () => {
    setBulkMoveCardsError('');
    if (!bulkMoveCardsForm.sprint || !bulkMoveCardsForm.projeto) {
      setBulkMoveCardsError('Selecione uma sprint e um projeto de destino.');
      return;
    }
    if (String(bulkMoveCardsForm.projeto) === String(project?.id)) {
      setBulkMoveCardsError('Escolha um projeto diferente do atual.');
      return;
    }
    setBulkMoveCardsLoading(true);
    const ids = selectedKanbanCardIds.filter((cid) => {
      const c = cards.find((x) => x.id === cid);
      return c && c.status !== 'finalizado' && c.status !== 'inviabilizado';
    });
    if (ids.length === 0) {
      setBulkMoveCardsLoading(false);
      setBulkMoveCardsError(
        'Nenhum card elegível: remova da seleção os que estão em Finalizado ou Inviabilizado.',
      );
      return;
    }
    const failed: { id: string; detail: string }[] = [];
    for (const cardId of ids) {
      try {
        await cardService.update(cardId, { projeto: bulkMoveCardsForm.projeto });
      } catch (err: unknown) {
        const ax = err as { response?: { data?: { detail?: string } } };
        failed.push({
          id: cardId,
          detail: ax.response?.data?.detail ?? 'Erro ao mover',
        });
      }
    }
    setBulkMoveCardsLoading(false);
    setBulkMoveCardsDialogOpen(false);
    await loadData();
    if (failed.length === 0) {
      exitKanbanCardSelection();
      setAlertMessage(`${ids.length} card(s) movido(s) para o projeto selecionado.`);
    } else {
      setSelectedKanbanCardIds(failed.map((f) => f.id));
      setAlertMessage(
        `${ids.length - failed.length} movido(s). ${failed.length} falharam (etapa inexistente no destino ou permissão).`,
      );
    }
    setAlertDialogOpen(true);
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
      navigate(ROUTES.projetos);
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
      {/* Banner: projeto arquivado */}
      {project?.arquivado && (
        <div className="mb-[12px] flex items-center justify-between gap-3 rounded-md border border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40 px-4 py-2 text-sm text-amber-900 dark:text-amber-200">
          <div className="flex items-center gap-2">
            <Archive className="h-4 w-4 shrink-0" />
            <span>
              Este projeto está <strong>arquivado</strong>. Cards e métricas
              dele não aparecem em telas operacionais.
              {project.arquivado_por_name && (
                <> Arquivado por {project.arquivado_por_name}
                  {project.arquivado_em && (
                    <> em {formatDate(project.arquivado_em)}</>
                  )}.
                </>
              )}
            </span>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={async () => {
              try {
                await projectService.bulkUnarchive([project.id]);
                navigate(ROUTES.projetos);
              } catch (err: any) {
                console.error('Erro ao desarquivar:', err);
              }
            }}
            className="shrink-0"
          >
            <ArchiveRestore className="h-4 w-4 mr-2" />
            Desarquivar
          </Button>
        </div>
      )}
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
            {isSupportProject ? (
              <Headset className="h-[24px] w-[24px] text-[var(--color-primary)]" />
            ) : (
              <FolderKanban className="h-[24px] w-[24px] text-[var(--color-primary)]" />
            )}
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
                      {sprint.nome} ({formatDate(sprint.data_inicio)} → {formatDate(sprintFimDiaParaCalendario(sprint))})
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
                {!isSupportProject && (
                  <>
                    <Button variant="default" onClick={openCreateCardDialog}>
                      <Plus className="h-4 w-4 mr-2" />
                      Criar Card
                    </Button>
                    <Button
                      type="button"
                      variant={cardSelectionMode ? 'default' : 'outline'}
                      onClick={() => {
                        setCardSelectionMode((m) => {
                          if (m) setSelectedKanbanCardIds([]);
                          return !m;
                        });
                      }}
                    >
                      <CheckSquare className="h-4 w-4 mr-2" />
                      {cardSelectionMode ? 'Sair do modo seleção' : 'Selecionar cards'}
                    </Button>
                  </>
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-[40px] gap-[8px] border-[var(--color-border)] px-[14px] shadow-sm hover:bg-[var(--color-accent)]"
                      title="Opções do Kanban"
                    >
                      <SlidersHorizontal className="h-[18px] w-[18px] shrink-0 text-[var(--color-muted-foreground)]" />
                      <span className="hidden text-sm font-medium sm:inline">Opções</span>
                      <ChevronDown className="h-[16px] w-[16px] shrink-0 opacity-60" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-[min(100vw-24px,300px)] p-1.5">
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
                  </DropdownMenuContent>
                </DropdownMenu>
                {/* Configurar Projeto (supervisor ou admin) */}
                {(user?.role === 'supervisor' || user?.role === 'admin') && (
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

        {!isSupportProject && (
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
        )}

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
            users={users.filter((u) => u.role !== 'admin')}
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
                  if (cardSelectionMode) {
                    if (card.status === 'finalizado' || card.status === 'inviabilizado') {
                      return;
                    }
                    toggleKanbanCardSelected(card.id);
                  } else {
                    openEditCardDialog(card);
                  }
                }}
                onCardDelete={handleCardDelete}
                disabled={sprintIsFinished}
                userRole={user?.role}
                users={users}
                showPriorityColorsOnCards={showPriorityColorsOnCards}
                selectionMode={cardSelectionMode}
                selectedCardIds={selectedKanbanCardIds}
                pinnedCardIds={pinnedCardIds}
                onTogglePin={handleTogglePin}
              />
            ))}
          </div>
          <DragOverlay>
            {activeCard ? (
              <DragOverlayCard
                card={activeCard}
                users={users}
                showPriorityColorsOnCards={showPriorityColorsOnCards}
              />
            ) : null}
          </DragOverlay>
        </DndContext>
      </div>

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
      }}>
        <DialogContent onClose={closeCardDialog} className="max-w-[600px]">
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
              <Label htmlFor="card-nome">
                Nome do Card
                <RequiredMark missing={!cardFormData.nome} />
              </Label>
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

            {/* ── Links do Card ─────────────────────────────────── */}
            <div className="space-y-[12px] rounded-lg border border-[var(--color-border)] p-[12px]">
              <div className="space-y-[6px]">
                <Label htmlFor="card-script_url">Link do Script</Label>
                {(!cardFormData.script_url || editingScript) ? (
                  <Input
                    id="card-script_url"
                    type="url"
                    placeholder="https://exemplo.com/script..."
                    value={cardFormData.script_url}
                    autoFocus={editingScript}
                    onChange={(e) => setCardFormData({ ...cardFormData, script_url: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && cardFormData.script_url.trim()) {
                        e.preventDefault();
                        setEditingScript(false);
                      }
                    }}
                    onBlur={() => { if (cardFormData.script_url.trim()) setEditingScript(false); }}
                    disabled={!!(editingCard && (editingCard.status === 'finalizado' || editingCard.status === 'inviabilizado')) || sprintIsFinished}
                    className="flex-1"
                  />
                ) : (
                  <div className="flex items-center gap-[6px] rounded-md bg-[var(--color-accent)] px-[10px] py-[6px]">
                    <ExternalLink className="h-[13px] w-[13px] shrink-0 text-[var(--color-primary)]" />
                    <a
                      href={normalizeExternalUrl(cardFormData.script_url)}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={cardFormData.script_url}
                      className="flex-1 truncate text-sm text-[var(--color-primary)] underline underline-offset-2 hover:opacity-75"
                    >
                      {cardFormData.script_url}
                    </a>
                    {!(!!(editingCard && (editingCard.status === 'finalizado' || editingCard.status === 'inviabilizado')) || sprintIsFinished) && (
                      <>
                        <button
                          type="button"
                          onClick={() => setEditingScript(true)}
                          className="shrink-0 rounded p-[2px] text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)]"
                          title="Editar"
                        >
                          <Pencil className="h-[13px] w-[13px]" />
                        </button>
                        <button
                          type="button"
                          onClick={() => { setCardFormData({ ...cardFormData, script_url: '' }); setEditingScript(false); }}
                          className="shrink-0 rounded p-[2px] text-[var(--color-muted-foreground)] hover:bg-[var(--color-destructive)]/10 hover:text-[var(--color-destructive)]"
                          title="Remover"
                        >
                          <Trash2 className="h-[13px] w-[13px]" />
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>

              <div className="border-t border-[var(--color-border)]" />

              <div className="space-y-[6px]">
                <div className="flex items-center justify-between gap-[8px]">
                  <Label>Links adicionais</Label>
                  {!(!!(editingCard && (editingCard.status === 'finalizado' || editingCard.status === 'inviabilizado')) || sprintIsFinished) && !showLinkForm && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="shrink-0 gap-[4px] min-w-[160px] justify-center"
                      onClick={openAddLink}
                    >
                      <Plus className="h-[13px] w-[13px]" />
                      Adicionar link
                    </Button>
                  )}
                </div>

                {cardLinks.length > 0 ? (
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
                        {!(!!(editingCard && (editingCard.status === 'finalizado' || editingCard.status === 'inviabilizado')) || sprintIsFinished) && (
                          <>
                            <button
                              type="button"
                              onClick={() => openEditLink(idx)}
                              className="shrink-0 rounded p-[2px] text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)]"
                              title="Editar"
                            >
                              <Pencil className="h-[13px] w-[13px]" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRemoveCardLink(idx)}
                              className="shrink-0 rounded p-[2px] text-[var(--color-muted-foreground)] hover:bg-[var(--color-destructive)]/10 hover:text-[var(--color-destructive)]"
                              title="Remover"
                            >
                              <XCircle className="h-[14px] w-[14px]" />
                            </button>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[11px] text-[var(--color-muted-foreground)]">
                    Nenhum link adicionado.
                  </p>
                )}

                {!(!!(editingCard && (editingCard.status === 'finalizado' || editingCard.status === 'inviabilizado')) || sprintIsFinished) && showLinkForm && (
                  <div className="space-y-[6px] rounded-md border border-[var(--color-border)] p-[8px]">
                    <Input
                      placeholder="Apelido (opcional)"
                      value={newLinkLabel}
                      onChange={(e) => setNewLinkLabel(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') { e.preventDefault(); submitCardLink(); }
                        else if (e.key === 'Escape') { e.preventDefault(); cancelLinkForm(); }
                      }}
                    />
                    <Input
                      type="url"
                      placeholder="URL do link (obrigatório)"
                      value={newLinkUrl}
                      autoFocus
                      onChange={(e) => setNewLinkUrl(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') { e.preventDefault(); submitCardLink(); }
                        else if (e.key === 'Escape') { e.preventDefault(); cancelLinkForm(); }
                      }}
                    />
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-[var(--color-muted-foreground)]">
                        Pressione Enter para {editingLinkIdx !== null ? 'salvar' : 'adicionar'}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-[28px] text-[var(--color-muted-foreground)]"
                        onClick={cancelLinkForm}
                      >
                        Cancelar
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              <div className="border-t border-[var(--color-border)]" />

              <CardAnexosSection
                cardId={editingCard?.id ?? null}
                disabled={!!(editingCard && (editingCard.status === 'finalizado' || editingCard.status === 'inviabilizado')) || sprintIsFinished}
              />
            </div>

            <div className="grid grid-cols-2 gap-[16px]">
              <div className="space-y-[8px]">
                <Label htmlFor="card-area">
                  Área
                  <RequiredMark missing={!cardFormData.area} />
                </Label>
                <FilterSelect
                  options={CARD_AREAS.map((a) => ({ value: a.value, label: a.label }))}
                  value={cardFormData.area || ''}
                  onChange={(v) => setCardFormData({ ...cardFormData, area: v })}
                  placeholder="Selecionar área"
                  searchPlaceholder="Buscar área..."
                  clearable={false}
                  disabled={!!(editingCard && (editingCard.status === 'finalizado' || editingCard.status === 'inviabilizado')) || sprintIsFinished}
                />
              </div>

              <div className="space-y-[8px]">
                <Label htmlFor="card-tipo">
                  Tipo
                  <RequiredMark missing={!cardFormData.tipo} />
                </Label>
                <FilterSelect
                  options={CARD_TYPES.map((t) => ({ value: t.value, label: t.label }))}
                  value={cardFormData.tipo}
                  onChange={(v) => setCardFormData({ ...cardFormData, tipo: v })}
                  placeholder="Selecionar tipo"
                  searchPlaceholder="Buscar tipo..."
                  clearable={false}
                  disabled={!!(editingCard && (editingCard.status === 'finalizado' || editingCard.status === 'inviabilizado')) || sprintIsFinished}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-[16px]">
              <div className="space-y-[8px]">
                <Label htmlFor="card-prioridade">
                  Prioridade
                  <RequiredMark missing={!cardFormData.prioridade} />
                </Label>
                <FilterSelect
                  options={CARD_PRIORITIES.map((p) => ({ value: p.value, label: p.label }))}
                  value={cardFormData.prioridade}
                  onChange={(v) => setCardFormData({ ...cardFormData, prioridade: v })}
                  placeholder="Selecionar prioridade"
                  searchPlaceholder="Buscar prioridade..."
                  clearable={false}
                  disabled={!!(editingCard && (editingCard.status === 'finalizado' || editingCard.status === 'inviabilizado')) || sprintIsFinished}
                />
              </div>

              <div className="space-y-[8px]">
                <Label htmlFor="card-status">
                  Status
                  <RequiredMark missing={!cardFormData.status} />
                </Label>
                <FilterSelect
                  options={(stages.length ? stages : DEFAULT_PROJECT_STAGES).map((stage) => ({
                    value: stage.id,
                    label: stage.label,
                  }))}
                  value={cardFormData.status}
                  onChange={(newStatus) => {
                    // Se mudou para em_desenvolvimento e não tem data_inicio, preencher automaticamente
                    if (newStatus === 'em_desenvolvimento' && !cardFormData.data_inicio) {
                      const now = new Date();
                      const year = now.getFullYear();
                      const month = String(now.getMonth() + 1).padStart(2, '0');
                      const day = String(now.getDate()).padStart(2, '0');
                      const hours = String(now.getHours()).padStart(2, '0');
                      const minutes = String(now.getMinutes()).padStart(2, '0');
                      const dataInicio = `${year}-${month}-${day}T${hours}:${minutes}`;
                      setCardFormData(prev => ({ ...prev, status: newStatus, data_inicio: dataInicio }));
                    } else if (newStatus === 'a_desenvolver') {
                      setCardFormData((prev) => ({ ...prev, status: newStatus, data_inicio: '' }));
                    } else {
                      setCardFormData({ ...cardFormData, status: newStatus });
                    }
                  }}
                  placeholder="Selecionar status"
                  searchPlaceholder="Buscar status..."
                  clearable={false}
                  disabled={!!(editingCard && (editingCard.status === 'finalizado' || editingCard.status === 'inviabilizado')) || sprintIsFinished}
                />
              </div>
            </div>

            <div className="space-y-[8px]">
              <Label htmlFor="card-responsavel">
                Responsável
                {requiresRequiredData(cardFormData.status) && (
                  <RequiredMark missing={!cardFormData.responsavel} />
                )}
              </Label>
              <div
                className={requiredHighlight(
                  requiresRequiredData(cardFormData.status) && !cardFormData.responsavel,
                )}
              >
                <UserSelect
                  users={users}
                  value={cardFormData.responsavel || ''}
                  onChange={(value) => setCardFormData({ ...cardFormData, responsavel: value })}
                  disabled={!!(editingCard && (editingCard.status === 'finalizado' || editingCard.status === 'inviabilizado')) || sprintIsFinished}
                  placeholder="Selecione um responsável"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-[16px]">
              <div className="space-y-[8px]">
                <Label htmlFor="card-data_inicio">
                  Data e Hora de Início
                  {requiresRequiredData(cardFormData.status) && (
                    <RequiredMark missing={!cardFormData.data_inicio} />
                  )}
                </Label>
                <div
                  className={requiredHighlight(
                    requiresRequiredData(cardFormData.status) && !cardFormData.data_inicio,
                  )}
                >
                  <DateTimePicker
                    id="card-data_inicio"
                    value={cardFormData.data_inicio}
                    onChange={(e) => setCardFormData({ ...cardFormData, data_inicio: e.target.value })}
                    disabled={true}
                  />
                </div>
                <p className="text-xs text-[var(--color-muted-foreground)]">
                  Preenchida automaticamente com a data e hora atual
                </p>
              </div>

              <div className="space-y-[8px]">
                <Label htmlFor="card-data_fim">
                  Data e Hora de Entrega
                  {requiresRequiredData(cardFormData.status) && (
                    <RequiredMark missing={!cardFormData.data_fim} />
                  )}
                </Label>
                <div
                  className={requiredHighlight(
                    requiresRequiredData(cardFormData.status) && !cardFormData.data_fim,
                  )}
                >
                  <DateTimePicker
                    id="card-data_fim"
                    value={cardFormData.data_fim}
                    onChange={(e) => {
                      const newDataFim = e.target.value;
                      setCardFormData({ ...cardFormData, data_fim: newDataFim });
                    }}
                    disabled={Boolean(
                      editingCard &&
                      editingCard.status === 'em_desenvolvimento' &&
                      user?.role !== 'admin' &&
                      user?.role !== 'supervisor'
                    )}
                  />
                </div>
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

            {editingCard?.finalizado_em && (
              <div className="rounded-[8px] border border-[var(--color-border)] bg-[var(--color-card)]/40 p-[16px] space-y-[8px]">
                <h4 className="text-sm font-semibold text-[var(--color-foreground)]">Tempo em desenvolvimento</h4>
                <div className="grid grid-cols-3 gap-[16px] text-sm">
                  <div>
                    <span className="text-xs text-[var(--color-muted-foreground)]">Dias corridos</span>
                    <p className="font-medium">{editingCard.dias_corridos_desenvolvimento ?? '—'}</p>
                  </div>
                  <div>
                    <span className="text-xs text-[var(--color-muted-foreground)]">Dias úteis</span>
                    <p className="font-medium">{editingCard.dias_uteis_desenvolvimento ?? '—'}</p>
                  </div>
                  <div>
                    <span className="text-xs text-[var(--color-muted-foreground)]">Horas úteis</span>
                    <p className="font-medium">{editingCard.horas_uteis_desenvolvimento ?? '—'}</p>
                  </div>
                </div>
              </div>
            )}

            {cardFormError && (
              <div className="p-[8px] text-sm text-[var(--color-destructive)] bg-red-50 border border-red-200 rounded-[8px] whitespace-pre-line">
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

      {/* Configurar Projeto (supervisor/admin) - Etapas do Kanban */}
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

      {!isSupportProject && selectedKanbanCardIds.length > 0 && (
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center px-4">
          <div className="pointer-events-auto flex max-w-[min(100%,560px)] flex-wrap items-center justify-center gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-background)] px-5 py-3 shadow-lg">
            <span className="text-sm font-medium text-[var(--color-foreground)]">
              {selectedKanbanCardIds.length} card(s) selecionado(s)
            </span>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={() => setBulkDeleteCardsDialogOpen(true)}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Apagar cards
            </Button>
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={openBulkMoveCardsModal}
              disabled={selectedKanbanIdsEligibleForMove.length === 0}
              title={
                selectedKanbanIdsEligibleForMove.length === 0
                  ? 'Nenhum card selecionado pode ser movido (exclua Finalizado ou Inviabilizado da seleção).'
                  : undefined
              }
            >
              <FolderInput className="h-4 w-4 mr-2" />
              Mover cards
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={exitKanbanCardSelection}>
              Cancelar
            </Button>
          </div>
        </div>
      )}

      <Dialog open={bulkDeleteCardsDialogOpen} onOpenChange={setBulkDeleteCardsDialogOpen}>
        <DialogContent className="max-w-[520px]">
          <DialogHeader>
            <DialogTitle>Apagar cards selecionados</DialogTitle>
            <div className="space-y-3 text-sm text-[var(--color-muted-foreground)]">
                <p>Os cards serão removidos permanentemente. A exclusão obedece às mesmas regras do ícone de lixeira no Kanban.</p>
                {(() => {
                  const sel = cards.filter((c) => selectedKanbanCardIds.includes(c.id));
                  const ok = sel.filter((c) => canBulkDeleteKanbanCard(c));
                  const blocked = sel.filter((c) => !canBulkDeleteKanbanCard(c));
                  return (
                    <ul className="list-inside list-disc text-sm space-y-1">
                      <li>
                        Serão apagados: <strong className="text-[var(--color-foreground)]">{ok.length}</strong>
                      </li>
                      {blocked.length > 0 && (
                        <li>
                          Ignorados (sprint encerrada ou sem permissão para inviabilizado):{' '}
                          <strong className="text-[var(--color-foreground)]">{blocked.length}</strong>
                        </li>
                      )}
                    </ul>
                  );
                })()}
              </div>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setBulkDeleteCardsDialogOpen(false)}
              disabled={bulkDeleteCardsLoading}
            >
              Voltar
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={
                bulkDeleteCardsLoading ||
                cards.filter((c) => selectedKanbanCardIds.includes(c.id) && canBulkDeleteKanbanCard(c)).length === 0
              }
              onClick={() => void handleBulkDeleteKanbanCardsConfirm()}
            >
              {bulkDeleteCardsLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Apagando...
                </>
              ) : (
                'Confirmar exclusão'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={bulkMoveCardsDialogOpen}
        onOpenChange={(open) => {
          setBulkMoveCardsDialogOpen(open);
          if (!open) {
            setBulkMoveWizardStep('sprint');
            setBulkMoveCardsForm({ sprint: '', projeto: '' });
            setBulkMoveCardsError('');
          }
        }}
        containerClassName="w-full max-w-3xl px-3 sm:px-4"
      >
        <DialogContent className="max-h-[85vh] w-full overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Mover {selectedKanbanCardIds.length} card(s)</DialogTitle>
            <DialogDescription>
              {bulkMoveWizardStep === 'sprint' ? (
                <>
                  Escolha a <strong>sprint</strong> de destino. Em seguida você escolhe o projeto na mesma janela.
                </>
              ) : (
                <>
                  Escolha o <strong>projeto</strong> de destino. O status de cada card é mantido (o projeto precisa ter a
                  mesma etapa no Kanban). Apenas cards fora de <strong>Finalizado</strong> e <strong>Inviabilizado</strong>.
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          {bulkMoveCardsCatalogLoading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-[var(--color-muted-foreground)]">
              <Loader2 className="h-5 w-5 animate-spin" />
              Carregando sprints e projetos…
            </div>
          ) : (
            <div className="mt-4 space-y-4">
              {bulkMoveWizardStep === 'sprint' ? (
                <div>
                  <h4 className="mb-3 text-sm font-semibold text-[var(--color-foreground)]">Sprint de destino</h4>
                  <div className="flex max-h-[min(70vh,640px)] flex-col gap-[16px] overflow-y-auto pr-1">
                    {bulkMoveCardsSprints.map((sp) => {
                      const status = bulkMoveSprintCardStatus(sp);
                      const sprintProjectsCount = bulkMoveCardsProjects.filter(
                        (p) => String(p.sprint || '') === String(sp.id),
                      ).length;
                      const inicioDia = sprintInicioDiaParaCalendario(sp);
                      const fimDia = sprintFimDiaParaCalendario(sp);
                      return (
                        <Card
                          key={sp.id}
                          role="button"
                          tabIndex={0}
                          className="group relative w-full min-w-0 cursor-pointer transition-shadow hover:shadow-md"
                          onClick={() => {
                            setBulkMoveCardsForm({ sprint: sp.id, projeto: '' });
                            setBulkMoveWizardStep('project');
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              setBulkMoveCardsForm({ sprint: sp.id, projeto: '' });
                              setBulkMoveWizardStep('project');
                            }
                          }}
                        >
                          <CardHeader className="overflow-visible p-[16px] pb-[8px]">
                            <div className="flex min-w-0 items-start gap-[16px] overflow-visible">
                              <div className="flex h-[40px] w-[40px] shrink-0 items-center justify-center rounded-[8px] bg-[var(--color-primary)]/10">
                                <Zap className="h-[20px] w-[20px] text-[var(--color-primary)]" />
                              </div>
                              <div className="min-w-0 flex-1 overflow-visible">
                                <CardTitle className="break-words text-lg leading-snug">{sp.nome}</CardTitle>
                                <div className="mt-[8px] flex flex-wrap items-center gap-2">
                                  {sp.finalizada ? (
                                    <Badge variant="secondary" className="shrink-0">
                                      Finalizada
                                    </Badge>
                                  ) : (
                                    <Badge variant={status.variant} className="max-w-full whitespace-normal">
                                      {status.label}
                                    </Badge>
                                  )}
                                </div>
                              </div>
                            </div>
                          </CardHeader>
                          <CardContent className="space-y-2 overflow-visible p-[16px] pt-0">
                            <div className="flex min-w-0 items-start gap-2 text-sm text-[var(--color-muted-foreground)]">
                              <User className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-muted-foreground)]" />
                              <span className="min-w-0 flex-1 break-words leading-snug">
                                Criado por: {sp.supervisor_name ?? getBulkMoveUserLabel(sp.supervisor)}
                              </span>
                            </div>
                            <div className="flex min-w-0 items-start gap-2 text-sm text-[var(--color-muted-foreground)]">
                              <Calendar className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-muted-foreground)]" />
                              <span className="min-w-0 flex-1 break-words leading-snug">
                                {formatDateTime(sp.data_inicio)} → {formatDateTime(sp.fechamento_em)}
                              </span>
                            </div>
                            <div className="flex min-w-0 items-start gap-2 text-sm text-[var(--color-muted-foreground)]">
                              <Clock className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-muted-foreground)]" />
                              <span className="min-w-0 flex-1 break-words leading-snug">
                                Criada em: {formatDateTime(sp.created_at ?? '')}
                              </span>
                            </div>
                            <div className="flex min-w-0 items-start gap-2 text-sm text-[var(--color-muted-foreground)]">
                              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-muted-foreground)]" />
                              <span className="min-w-0 flex-1 break-words leading-snug">
                                Fechada em:{' '}
                                {sp.finalizada && sp.updated_at
                                  ? formatDateTime(sp.updated_at)
                                  : 'Sprint aberta'}
                              </span>
                            </div>
                            {inicioDia && fimDia && (
                              <div className="flex min-w-0 items-start gap-2 text-sm text-[var(--color-muted-foreground)]">
                                <Clock className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-muted-foreground)]" />
                                <span className="min-w-0 flex-1 break-words leading-snug">
                                  Duração: {calcularDiasTotais(inicioDia, fimDia)} dias (
                                  {calcularDiasUteis(inicioDia, fimDia)} úteis)
                                </span>
                              </div>
                            )}
                            <div className="flex min-w-0 items-start gap-2 text-sm text-[var(--color-muted-foreground)]">
                              <FolderKanban className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-muted-foreground)]" />
                              <span className="min-w-0 flex-1 break-words leading-snug">
                                {sprintProjectsCount} projetos
                              </span>
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div>
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="shrink-0"
                      onClick={() => {
                        setBulkMoveWizardStep('sprint');
                        setBulkMoveCardsForm({ sprint: '', projeto: '' });
                        setBulkMoveCardsError('');
                      }}
                    >
                      <ArrowLeft className="h-4 w-4 mr-2" />
                      Outra sprint
                    </Button>
                    <h4 className="text-sm font-semibold text-[var(--color-foreground)]">
                      Projeto de destino
                      {(() => {
                        const sn = bulkMoveCardsSprints.find((s) => String(s.id) === String(bulkMoveCardsForm.sprint));
                        return sn ? (
                          <span className="ml-1 font-normal text-[var(--color-muted-foreground)]">
                            — {sn.nome}
                          </span>
                        ) : null;
                      })()}
                    </h4>
                  </div>
                  <div className="max-h-[min(60vh,420px)] space-y-2 overflow-y-auto pr-1">
                    {bulkMoveCardsProjects
                      .filter((p) => String(p.sprint || '') === String(bulkMoveCardsForm.sprint))
                      .filter((p) => p.nome !== 'Sugestões' && p.nome !== 'Suporte')
                      .filter((p) => String(p.id) !== String(project?.id))
                      .map((p) => {
                        const selected = String(bulkMoveCardsForm.projeto) === String(p.id);
                        return (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => setBulkMoveCardsForm((f) => ({ ...f, projeto: p.id }))}
                            className={cn(
                              'w-full rounded-lg border p-3 text-left text-sm transition-colors',
                              selected
                                ? 'border-[var(--color-primary)] bg-[var(--color-accent)] ring-2 ring-[var(--color-primary)]'
                                : 'border-[var(--color-border)] hover:bg-[var(--color-accent)]',
                            )}
                          >
                            <div className="font-medium text-[var(--color-foreground)] break-words">
                              {p.nome}
                            </div>
                            <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">
                              Cards:{' '}
                              <span className="font-medium text-[var(--color-foreground)]">
                                {p.cards_count != null ? p.cards_count : '—'}
                              </span>
                            </p>
                          </button>
                        );
                      })}
                    {bulkMoveCardsProjects.filter(
                      (p) =>
                        String(p.sprint || '') === String(bulkMoveCardsForm.sprint) &&
                        p.nome !== 'Sugestões' &&
                        p.nome !== 'Suporte' &&
                        String(p.id) !== String(project?.id),
                    ).length === 0 && (
                      <p className="text-sm text-[var(--color-muted-foreground)]">
                        Não há outro projeto nesta sprint para receber os cards.
                      </p>
                    )}
                  </div>
                </div>
              )}

              {bulkMoveCardsError && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-2 text-sm text-[var(--color-destructive)]">
                  {bulkMoveCardsError}
                </div>
              )}
            </div>
          )}

          <DialogFooter className="mt-6 gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => setBulkMoveCardsDialogOpen(false)}
              disabled={bulkMoveCardsLoading}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={() => void handleBulkMoveKanbanCardsSubmit()}
              disabled={
                bulkMoveCardsLoading ||
                bulkMoveCardsCatalogLoading ||
                bulkMoveWizardStep === 'sprint' ||
                !bulkMoveCardsForm.projeto
              }
            >
              {bulkMoveCardsLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Movendo...
                </>
              ) : (
                'Confirmar movimento'
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
        card={
          conclusaoPendingData?.card
            ? {
                ...conclusaoPendingData.card,
                // Enriquece com role do responsável (badge "Dev." vem disso)
                responsavel_role: users.find(
                  (u) => String(u.id) === String(conclusaoPendingData.card.responsavel),
                )?.role,
              }
            : undefined
        }
        cardName={conclusaoCardName || undefined}
      />
    </div>
  );
}

/** Mesmo critério de badge da lista «Sprints finalizadas» em Sprints.tsx */
function bulkMoveSprintCardStatus(sprint: Sprint): {
  label: string;
  variant: 'secondary' | 'outline' | 'default';
} {
  if (sprint.finalizada) {
    return { label: 'Finalizada', variant: 'secondary' };
  }
  const startMs = new Date(sprint.data_inicio).getTime();
  const endMs = new Date(sprint.fechamento_em).getTime();
  const nowMs = Date.now();
  if (nowMs < startMs) {
    return { label: 'Planejada', variant: 'secondary' };
  }
  if (nowMs > endMs) {
    return { label: 'Prazo encerrado', variant: 'outline' };
  }
  return { label: 'Em andamento', variant: 'default' };
}

function normalizeProjectName(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Check, X, AlertTriangle, Plus, Trash2, MessageSquarePlus, Users, Search, Filter, Calendar, ArrowUp, ArrowDown } from 'lucide-react';
import { userService, type User } from '@/services/userService';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cardService, type Card as CardType } from '@/services/cardService';
import { cardTodoService, type CardTodo } from '@/services/cardTodoService';
import { cn } from '@/lib/utils';
import { ROUTES } from '@/routes';

type TodoStatus = 'pending' | 'completed' | 'blocked' | 'warning';

const formatDate = (dateString: string | null | undefined): string => {
  if (!dateString) return 'Sem data';
  const date = new Date(dateString);
  return date.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const calculateDaysRemaining = (dateString: string | null | undefined): { days: number; isOverdue: boolean } => {
  if (!dateString) return { days: 0, isOverdue: false };
  const date = new Date(dateString);
  const now = new Date();
  const diffTime = date.getTime() - now.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return { days: diffDays, isOverdue: diffDays < 0 };
};

const getStatusIcon = (status: TodoStatus) => {
  switch (status) {
    case 'completed':
      return <Check className="h-4 w-4 text-green-600" />;
    case 'blocked':
      return <X className="h-4 w-4 text-red-600" />;
    case 'warning':
      return <AlertTriangle className="h-4 w-4 text-yellow-600" />;
    default:
      return null;
  }
};

const getNextStatus = (currentStatus: TodoStatus): TodoStatus => {
  switch (currentStatus) {
    case 'pending':
      return 'completed';
    case 'completed':
      return 'blocked';
    case 'blocked':
      return 'warning';
    case 'warning':
      return 'pending';
    default:
      return 'pending';
  }
};

// Componente TodoItem
function TodoItem({
  todo,
  onStatusChange,
  onCommentChange,
  onDelete,
  canDelete,
  canEdit = true,
}: {
  todo: CardTodo;
  onStatusChange: (id: string, status: TodoStatus) => void;
  onCommentChange: (id: string, comment: string) => void;
  onDelete: (id: string) => void;
  canDelete: boolean;
  canEdit?: boolean;
}) {
  const [comment, setComment] = useState(todo.comment || '');
  const [isEditingComment, setIsEditingComment] = useState(false);

  // Sincronizar comment quando o todo for atualizado via notificação
  useEffect(() => {
    if (!isEditingComment) {
      setComment(todo.comment || '');
    }
  }, [todo.comment, isEditingComment]);

  const handleStatusClick = () => {
    const nextStatus = getNextStatus(todo.status);
    onStatusChange(todo.id, nextStatus);
  };

  const handleCommentBlur = () => {
    setIsEditingComment(false);
    if (comment !== todo.comment) {
      onCommentChange(todo.id, comment);
    }
  };

  return (
    <div className="flex items-start gap-2 py-2 border-b border-[var(--color-border)] last:border-b-0">
      <button
        type="button"
        onClick={handleStatusClick}
        disabled={!canEdit}
        className={cn(
          "flex items-center justify-center w-6 h-6 rounded border-2 transition-all shrink-0 mt-0.5",
          !canEdit && "opacity-50 cursor-not-allowed",
          todo.status === 'pending' && "border-[var(--color-input)] bg-transparent hover:border-[var(--color-primary)]/50",
          todo.status === 'completed' && "border-green-600 bg-green-50",
          todo.status === 'blocked' && "border-red-600 bg-red-50",
          todo.status === 'warning' && "border-yellow-600 bg-yellow-50"
        )}
      >
        {getStatusIcon(todo.status)}
      </button>
      <div className="flex-1 min-w-0 flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <p className={cn(
            "text-sm",
            todo.status === 'completed' && "line-through text-[var(--color-muted-foreground)]",
            todo.status === 'blocked' && "text-red-600",
            todo.status === 'warning' && "text-yellow-600"
          )}>
            {todo.label}
          </p>
          {isEditingComment ? (
            <Textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              onBlur={handleCommentBlur}
              placeholder="Adicionar comentário..."
              className="mt-1 text-xs min-h-[60px]"
              autoFocus
            />
          ) : comment ? (
            <p className="mt-1 text-xs text-[var(--color-muted-foreground)] italic">{comment}</p>
          ) : null}
        </div>
        {canEdit && (
          <button
            type="button"
            onClick={() => setIsEditingComment(true)}
            className={cn(
              "flex items-center justify-center w-6 h-6 rounded border-2 transition-all shrink-0 mt-0.5",
              comment 
                ? "border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-primary)]"
                : "border-[var(--color-input)] bg-transparent text-[var(--color-muted-foreground)] hover:border-[var(--color-primary)]/50 hover:text-[var(--color-primary)]"
            )}
            title={comment ? "Editar comentário" : "Adicionar comentário"}
          >
            <MessageSquarePlus className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {canDelete && (
        <button
          type="button"
          onClick={() => onDelete(todo.id)}
          className="text-red-600 hover:text-red-800 shrink-0 mt-0.5"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

// Componente TaskCard
function TaskCard({
  card,
  onCardClick,
  onTodoStatusChange,
  onTodoCommentChange,
  onTodoAdd,
  onTodoDelete,
  onCardCommentChange,
  canEdit = true,
}: {
  card: CardType;
  onCardClick: () => void;
  onTodoStatusChange: (cardId: string, todoId: string, status: TodoStatus) => void;
  onTodoCommentChange: (cardId: string, todoId: string, comment: string) => void;
  onTodoAdd: (cardId: string, label: string) => void;
  onTodoDelete: (cardId: string, todoId: string) => void;
  onCardCommentChange: (cardId: string, comment: string) => void;
  canEdit?: boolean;
}) {
  const navigate = useNavigate();
  const [newTodoLabel, setNewTodoLabel] = useState('');
  const [cardComment, setCardComment] = useState(card.card_comment || '');
  const [isEditingCardComment, setIsEditingCardComment] = useState(false);

  // Sincronizar cardComment quando o card for atualizado via notificação
  useEffect(() => {
    if (!isEditingCardComment) {
      setCardComment(card.card_comment || '');
    }
  }, [card.card_comment, isEditingCardComment]);

  const { days, isOverdue } = calculateDaysRemaining(card.data_fim);
  const todos = card.todos || [];

  const handleProjectClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigate(ROUTES.projeto(String(card.projeto)));
  };

  const handleSprintClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (card.projeto_detail?.sprint_detail?.id) {
      navigate(ROUTES.sprintPorId(String(card.projeto_detail.sprint_detail.id)));
    }
  };

  const handleAddTodo = () => {
    if (newTodoLabel.trim()) {
      onTodoAdd(card.id, newTodoLabel.trim());
      setNewTodoLabel('');
    }
  };

  const handleCardCommentBlur = () => {
    setIsEditingCardComment(false);
    if (cardComment !== card.card_comment) {
      onCardCommentChange(card.id, cardComment);
    }
  };

  return (
    <div className="bg-[var(--color-card)] rounded-lg border border-[var(--color-border)] shadow-sm p-4 hover:shadow-md transition-shadow">
      {/* Header */}
      <div className="mb-3">
        <h3
          onClick={onCardClick}
          className="text-lg font-semibold text-[var(--color-foreground)] cursor-pointer hover:text-[var(--color-primary)] mb-2"
        >
          {card.nome}
        </h3>
        <div className="space-y-1 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-[var(--color-muted-foreground)]">Projeto:</span>
            <button
              type="button"
              onClick={handleProjectClick}
              className="text-[var(--color-primary)] hover:underline"
            >
              {card.projeto_detail?.nome || 'N/A'}
            </button>
          </div>
          {card.projeto_detail?.sprint_detail && (
            <div className="flex items-center gap-2">
              <span className="text-[var(--color-muted-foreground)]">Sprint:</span>
              <button
                type="button"
                onClick={handleSprintClick}
                className="text-[var(--color-primary)] hover:underline"
              >
                {card.projeto_detail.sprint_detail.nome}
              </button>
            </div>
          )}
          <div className="flex items-center gap-2">
            <span className="text-[var(--color-muted-foreground)]">Data de entrega:</span>
            <span className={cn(
              isOverdue && "text-red-600 font-medium"
            )}>
              {formatDate(card.data_fim)}
            </span>
            {card.data_fim && (
              <span className={cn(
                "text-xs",
                isOverdue ? "text-red-600" : "text-[var(--color-muted-foreground)]"
              )}>
                ({isOverdue ? `Atrasado há ${Math.abs(days)} dias` : `${days} dias restantes`})
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="border-t border-[var(--color-border)] pt-3 mb-3"></div>

      {/* TODO List */}
      <div className="space-y-1 mb-3">
        {todos.map((todo) => (
          <TodoItem
            key={todo.id}
            todo={todo}
            onStatusChange={(id, status) => onTodoStatusChange(card.id, id, status)}
            onCommentChange={(id, comment) => onTodoCommentChange(card.id, id, comment)}
            onDelete={(id) => onTodoDelete(card.id, id)}
            canDelete={!todo.is_original && canEdit}
            canEdit={canEdit}
          />
        ))}
      </div>

      {/* Adicionar novo TODO */}
      {canEdit && (
        <div className="flex gap-2 mb-3">
          <Input
            value={newTodoLabel}
            onChange={(e) => setNewTodoLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                handleAddTodo();
              }
            }}
            placeholder="Adicionar novo TODO..."
            className="text-sm"
          />
          <Button
            type="button"
            size="sm"
            onClick={handleAddTodo}
            disabled={!newTodoLabel.trim()}
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* Comentário do card */}
      {canEdit && (
        <div className="border-t border-[var(--color-border)] pt-3">
          {isEditingCardComment ? (
            <Textarea
              value={cardComment}
              onChange={(e) => setCardComment(e.target.value)}
              onBlur={handleCardCommentBlur}
              placeholder="Adicionar comentário no card..."
              className="text-xs min-h-[60px]"
              autoFocus
            />
          ) : (
            <button
              type="button"
              onClick={() => setIsEditingCardComment(true)}
              className="text-xs text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] italic w-full text-left break-all overflow-hidden"
            >
              {cardComment || 'Adicionar comentário no card...'}
            </button>
          )}
        </div>
      )}
      {!canEdit && cardComment && (
        <div className="border-t border-[var(--color-border)] pt-3">
          <p className="text-xs text-[var(--color-muted-foreground)] italic break-all overflow-hidden">{cardComment}</p>
        </div>
      )}
    </div>
  );
}

export default function MyTasks() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [cards, setCards] = useState<CardType[]>([]);
  const [allCards, setAllCards] = useState<CardType[]>([]); // Todos os cards para supervisores/gerentes
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  // Para supervisor, padrão é 'visao_geral', para outros é 'afazeres'
  const [periodo, setPeriodo] = useState<'afazeres' | 'concluidas' | 'visao_geral'>('afazeres');
  
  // Filtros para visão geral
  const [filterUser, setFilterUser] = useState<string>('all');
  const [filterSearch, setFilterSearch] = useState<string>('');
  const [filterEtapa, setFilterEtapa] = useState<'em_desenvolvimento' | 'a_desenvolver' | 'atrasados' | 'entregues' | 'todos_sem_entregues' | 'todos_com_entregues'>('em_desenvolvimento');
  const [sortDataEntrega, setSortDataEntrega] = useState<'asc' | 'desc' | null>(null);
  const [groupBy, setGroupBy] = useState<'usuario' | 'sprint' | 'projeto'>('usuario');
  
  // Verificar se é supervisor ou gerente
  const isSupervisorOrGerente = user?.role === 'supervisor' || user?.role === 'gerente' || user?.role === 'admin';
  const isSupervisor = user?.role === 'supervisor' || user?.role === 'admin';
  const [viewCardDialogOpen, setViewCardDialogOpen] = useState(false);
  const [selectedCard, setSelectedCard] = useState<CardType | null>(null);
  const [cardLoading, setCardLoading] = useState(false);
  const [cardFormData, setCardFormData] = useState({
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
  });

  // Inicializar período padrão baseado no role do usuário (apenas uma vez)
  const [periodoInicializado, setPeriodoInicializado] = useState(false);
  useEffect(() => {
    if (user && !periodoInicializado) {
      if (user.role === 'supervisor' || user.role === 'admin') {
        setPeriodo('visao_geral');
      }
      setPeriodoInicializado(true);
    }
  }, [user, periodoInicializado]);

  useEffect(() => {
    loadCards();
    if (isSupervisorOrGerente) {
      loadAllCards();
      loadUsers();
    }
  }, [user, periodo, isSupervisorOrGerente]);

  // Escutar eventos de notificação para atualização em tempo real na Visão Geral
  useEffect(() => {
    if (!isSupervisorOrGerente || periodo !== 'visao_geral') return;

    const handleNotificationReceived = async (event: CustomEvent) => {
      const notification = event.detail as any;
      
      // Tipos de notificação que devem atualizar os cards na visão geral
      const relevantTypes = [
        'card_created',
        'card_updated',
        'card_moved',
        'card_deleted',
        'card_todo_updated',
      ];
      
      if (relevantTypes.includes(notification.tipo)) {
        console.log('[MyTasks] Notificação relevante recebida, atualizando cards:', notification.tipo, notification);
        
        // Se for atualização de TODO, atualizar apenas os TODOs do card
        if (notification.tipo === 'card_todo_updated' && notification.card_id) {
          console.log('[MyTasks] Atualizando TODOs do card:', notification.card_id, notification.metadata);
          
          // Se for deleção de TODO, remover da lista
          if (notification.metadata?.is_deleted && notification.metadata?.todo_id) {
            const cardId = String(notification.card_id);
            const todoId = String(notification.metadata.todo_id);
            
            setAllCards((prevCards) => {
              const existingIndex = prevCards.findIndex(c => String(c.id) === cardId);
              
              if (existingIndex >= 0) {
                console.log('[MyTasks] Removendo TODO deletado:', todoId);
                const newCards = [...prevCards];
                newCards[existingIndex] = {
                  ...newCards[existingIndex],
                  todos: (newCards[existingIndex].todos || []).filter(t => String(t.id) !== todoId)
                };
                return newCards;
              }
              
              return prevCards;
            });
          } else {
            // Se for criação ou atualização, buscar TODOs atualizados
            try {
              // Converter card_id para string se necessário (pode vir como número)
              const cardId = String(notification.card_id);
              
              // Buscar apenas os TODOs atualizados do card
              const todos = await cardTodoService.getByCard(cardId);
              console.log('[MyTasks] TODOs carregados:', todos.length);
              
              // Atualizar apenas os TODOs do card na lista
              setAllCards((prevCards) => {
                const existingIndex = prevCards.findIndex(c => String(c.id) === cardId);
                
                if (existingIndex >= 0) {
                  console.log('[MyTasks] Card encontrado na lista, atualizando TODOs');
                  // Atualizar apenas os TODOs do card existente
                  const newCards = [...prevCards];
                  newCards[existingIndex] = {
                    ...newCards[existingIndex],
                    todos: todos
                  };
                  return newCards;
                } else {
                  console.log('[MyTasks] Card não encontrado na lista');
                }
                
                return prevCards;
              });
            } catch (error) {
              console.error('[MyTasks] Erro ao atualizar TODOs do card:', error);
              // Se falhar, recarregar o card completo
              try {
                const cardId = String(notification.card_id);
                const updatedCard = await cardService.getById(cardId);
                const todos = await cardTodoService.getByCard(updatedCard.id);
                updatedCard.todos = todos;
                
                setAllCards((prevCards) => {
                  const existingIndex = prevCards.findIndex(c => String(c.id) === String(updatedCard.id));
                  if (existingIndex >= 0) {
                    const newCards = [...prevCards];
                    newCards[existingIndex] = updatedCard;
                    return newCards;
                  }
                  return prevCards;
                });
              } catch (err) {
                console.error('[MyTasks] Erro ao recarregar card completo:', err);
              }
            }
          }
        } else if (notification.card_id) {
          // Para outros tipos de notificação, atualizar o card completo
          try {
            // Buscar o card atualizado
            const updatedCard = await cardService.getById(notification.card_id);
            
            // Carregar TODOs do card
            try {
              const todos = await cardTodoService.getByCard(updatedCard.id);
              updatedCard.todos = todos;
            } catch (error) {
              console.error(`Erro ao carregar TODOs do card ${updatedCard.id}:`, error);
              updatedCard.todos = [];
            }
            
            // Atualizar o card na lista
            setAllCards((prevCards) => {
              const existingIndex = prevCards.findIndex(c => c.id === updatedCard.id);
              
              if (notification.tipo === 'card_deleted') {
                // Remover o card se foi deletado
                return prevCards.filter(c => c.id !== notification.card_id);
              }
              
              if (existingIndex >= 0) {
                // Atualizar card existente
                const newCards = [...prevCards];
                // Se for apenas mudança de comentário, preservar os TODOs existentes para evitar recarregar desnecessariamente
                if (notification.metadata?.comment_changed && newCards[existingIndex].todos) {
                  newCards[existingIndex] = {
                    ...newCards[existingIndex],
                    ...updatedCard,
                    todos: newCards[existingIndex].todos
                  };
                } else {
                  newCards[existingIndex] = updatedCard;
                }
                return newCards;
              } else {
                // Adicionar novo card (se foi criado e não está na lista)
                // Verificar se o card deve aparecer na visão geral baseado nos filtros
                if (notification.tipo === 'card_created') {
                  // Verificar se o card atende aos filtros atuais
                  const shouldShow = updatedCard.status !== 'finalizado' || 
                                    filterEtapa === 'entregues' || 
                                    filterEtapa === 'todos_com_entregues';
                  if (shouldShow) {
                    return [...prevCards, updatedCard];
                  }
                }
              }
              
              return prevCards;
            });
          } catch (error) {
            console.error('[MyTasks] Erro ao atualizar card específico:', error);
            // Se falhar, recarregar todos os cards
            loadAllCards();
          }
        } else {
          // Se não tiver card_id, recarregar todos os cards
          loadAllCards();
        }
      }
    };

    window.addEventListener('notificationReceived', handleNotificationReceived as unknown as EventListener);

    return () => {
      window.removeEventListener('notificationReceived', handleNotificationReceived as unknown as EventListener);
    };
  }, [isSupervisorOrGerente, periodo]);
  
  const loadUsers = async () => {
    try {
      const users = await userService.getAll();
      setAllUsers(users.filter(u => u.role !== 'admin'));
    } catch (error) {
      console.error('Erro ao carregar usuários:', error);
    }
  };
  
  const loadAllCards = useCallback(async () => {
    try {
      const cards = await cardService.getAll();
      // Não filtrar aqui, deixar os filtros fazerem isso
      // Carregar TODOs para cada card
      const cardsWithTodos = await Promise.all(
        cards.map(async (card) => {
          try {
            const todos = await cardTodoService.getByCard(card.id);
            return { ...card, todos };
          } catch (error) {
            console.error(`Erro ao carregar TODOs do card ${card.id}:`, error);
            return { ...card, todos: [] };
          }
        })
      );
      
      setAllCards(cardsWithTodos);
    } catch (error) {
      console.error('Erro ao carregar todos os cards:', error);
    }
  }, []);

  const loadCards = async () => {
    if (!user?.id) return;
    try {
      setLoading(true);
      const allCards = await cardService.getByResponsavel(user.id);
      
      // Filtrar por status baseado no período
      const filteredCards = periodo === 'concluidas'
        ? allCards.filter(card => card.status === 'finalizado')
        : allCards.filter(card => card.status !== 'finalizado');
      
      // Carregar TODOs para cada card
      const cardsWithTodos = await Promise.all(
        filteredCards.map(async (card) => {
          try {
            const todos = await cardTodoService.getByCard(card.id);
            return { ...card, todos };
          } catch (error) {
            console.error(`Erro ao carregar TODOs do card ${card.id}:`, error);
            return { ...card, todos: [] };
          }
        })
      );
      
      setCards(cardsWithTodos);
    } catch (error) {
      console.error('Erro ao carregar cards:', error);
    } finally {
      setLoading(false);
    }
  };

  // Separar cards em desenvolvimento e a desenvolver
  const cardsEmDesenvolvimento = cards.filter(card => card.status === 'em_desenvolvimento');
  const cardsADesenvolver = cards.filter(card => card.status === 'a_desenvolver');

  const handleCardClick = async (card: CardType) => {
    setSelectedCard(card);
    setCardLoading(true);
    try {
      const fullCard = await cardService.getById(card.id);
      setCardFormData({
        nome: fullCard.nome,
        descricao: fullCard.descricao || '',
        script_url: fullCard.script_url || '',
        area: fullCard.area || 'backend',
        tipo: fullCard.tipo || 'feature',
        prioridade: fullCard.prioridade || 'media',
        status: fullCard.status || 'a_desenvolver',
        responsavel: fullCard.responsavel || '',
        data_inicio: fullCard.data_inicio || '',
        data_fim: fullCard.data_fim || '',
      });
      setViewCardDialogOpen(true);
    } catch (error) {
      console.error('Erro ao carregar card:', error);
    } finally {
      setCardLoading(false);
    }
  };

  const handleTodoStatusChange = async (cardId: string, todoId: string, status: TodoStatus) => {
    try {
      await cardTodoService.updateStatus(todoId, status);
      // Atualizar estado local
      const updateCardTodos = (prevCards: CardType[]) =>
        prevCards.map((card) =>
          card.id === cardId
            ? {
                ...card,
                todos: card.todos?.map((todo) =>
                  todo.id === todoId ? { ...todo, status } : todo
                ),
              }
            : card
        );
      setCards(updateCardTodos);
      if (periodo === 'visao_geral') {
        setAllCards(updateCardTodos);
      }
    } catch (error) {
      console.error('Erro ao atualizar status do TODO:', error);
    }
  };

  const handleTodoCommentChange = async (cardId: string, todoId: string, comment: string) => {
    try {
      await cardTodoService.update(todoId, { comment });
      // Atualizar estado local
      const updateCardTodos = (prevCards: CardType[]) =>
        prevCards.map((card) =>
          card.id === cardId
            ? {
                ...card,
                todos: card.todos?.map((todo) =>
                  todo.id === todoId ? { ...todo, comment } : todo
                ),
              }
            : card
        );
      setCards(updateCardTodos);
      if (periodo === 'visao_geral') {
        setAllCards(updateCardTodos);
      }
    } catch (error) {
      console.error('Erro ao atualizar comentário do TODO:', error);
    }
  };

  const handleTodoAdd = async (cardId: string, label: string) => {
    try {
      const sourceCards = periodo === 'visao_geral' ? allCards : cards;
      const todos = sourceCards.find(c => c.id === cardId)?.todos || [];
      const newTodo = await cardTodoService.create({
        card: cardId,
        label,
        is_original: false,
        status: 'pending',
        order: todos.length,
      });
      // Atualizar estado local
      const updateCardTodos = (prevCards: CardType[]) =>
        prevCards.map((card) =>
          card.id === cardId
            ? { ...card, todos: [...(card.todos || []), newTodo] }
            : card
        );
      setCards(updateCardTodos);
      if (periodo === 'visao_geral') {
        setAllCards(updateCardTodos);
      }
    } catch (error) {
      console.error('Erro ao adicionar TODO:', error);
    }
  };

  const handleTodoDelete = async (cardId: string, todoId: string) => {
    try {
      await cardTodoService.delete(todoId);
      // Atualizar estado local
      const updateCardTodos = (prevCards: CardType[]) =>
        prevCards.map((card) =>
          card.id === cardId
            ? { ...card, todos: card.todos?.filter((todo) => todo.id !== todoId) }
            : card
        );
      setCards(updateCardTodos);
      if (periodo === 'visao_geral') {
        setAllCards(updateCardTodos);
      }
    } catch (error) {
      console.error('Erro ao deletar TODO:', error);
    }
  };

  const handleCardCommentChange = async (cardId: string, comment: string) => {
    try {
      await cardService.update(cardId, { card_comment: comment });
      // Atualizar estado local
      setCards((prevCards) =>
        prevCards.map((card) =>
          card.id === cardId ? { ...card, card_comment: comment } : card
        )
      );
      // Atualizar também em allCards se estiver na visão geral
      if (periodo === 'visao_geral') {
        setAllCards((prevCards) =>
          prevCards.map((card) =>
            card.id === cardId ? { ...card, card_comment: comment } : card
          )
        );
      }
    } catch (error) {
      console.error('Erro ao atualizar comentário do card:', error);
    }
  };

  // Lógica de filtros e agrupamento para visão geral
  const getFilteredAndGroupedCards = () => {
    let filtered = [...allCards];

    // Filtro por usuário
    if (filterUser !== 'all') {
      filtered = filtered.filter(card => card.responsavel === filterUser);
    }

    // Filtro por pesquisa (nome do card)
    if (filterSearch.trim()) {
      const searchLower = filterSearch.toLowerCase();
      filtered = filtered.filter(card => 
        card.nome.toLowerCase().includes(searchLower)
      );
    }

    // Filtro por etapa
    const now = new Date();
    switch (filterEtapa) {
      case 'em_desenvolvimento':
        filtered = filtered.filter(card => card.status === 'em_desenvolvimento');
        break;
      case 'a_desenvolver':
        filtered = filtered.filter(card => card.status === 'a_desenvolver');
        break;
      case 'atrasados':
        filtered = filtered.filter(card => {
          if (!card.data_fim) return false;
          const cardDate = new Date(card.data_fim);
          return cardDate < now && card.status !== 'finalizado';
        });
        break;
      case 'entregues':
        filtered = filtered.filter(card => card.status === 'finalizado');
        break;
      case 'todos_sem_entregues':
        filtered = filtered.filter(card => card.status !== 'finalizado');
        break;
      case 'todos_com_entregues':
        // Não filtrar, mostrar todos
        break;
    }

    // Ordenação por data de entrega
    if (sortDataEntrega) {
      filtered.sort((a, b) => {
        const dateA = a.data_fim ? new Date(a.data_fim).getTime() : 0;
        const dateB = b.data_fim ? new Date(b.data_fim).getTime() : 0;
        
        if (dateA === 0 && dateB === 0) return 0;
        if (dateA === 0) return 1; // Cards sem data vão para o final
        if (dateB === 0) return -1;
        
        return sortDataEntrega === 'asc' ? dateA - dateB : dateB - dateA;
      });
    }

    // Agrupamento
    if (groupBy === 'usuario') {
      const grouped: Record<string, CardType[]> = {};
      filtered.forEach(card => {
        const userId = card.responsavel || 'sem_responsavel';
        if (!grouped[userId]) {
          grouped[userId] = [];
        }
        grouped[userId].push(card);
      });
      return grouped;
    } else if (groupBy === 'sprint') {
      const grouped: Record<string, CardType[]> = {};
      filtered.forEach(card => {
        const sprintId = card.projeto_detail?.sprint_detail?.id || 'sem_sprint';
        const sprintName = card.projeto_detail?.sprint_detail?.nome || 'Sem Sprint';
        const key = `${sprintId}|${sprintName}`;
        if (!grouped[key]) {
          grouped[key] = [];
        }
        grouped[key].push(card);
      });
      return grouped;
    } else if (groupBy === 'projeto') {
      const grouped: Record<string, CardType[]> = {};
      filtered.forEach(card => {
        const projectId = card.projeto || 'sem_projeto';
        const projectName = card.projeto_detail?.nome || 'Sem Projeto';
        const key = `${projectId}|${projectName}`;
        if (!grouped[key]) {
          grouped[key] = [];
        }
        grouped[key].push(card);
      });
      return grouped;
    }

    return {};
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-200px)]">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--color-primary)]" />
      </div>
    );
  }

  return (
    <div className="space-y-[24px]">
      <div>
        <h1 className="text-2xl font-bold text-[var(--color-foreground)]">Meus Afazeres</h1>
        <p className="text-sm text-[var(--color-muted-foreground)] mt-1">
          Visualize e gerencie seus cards atribuídos
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-[8px] border-b border-[var(--color-border)]">
        {isSupervisor && (
          <Button
            variant="ghost"
            onClick={() => setPeriodo('visao_geral')}
            className={cn(
              "rounded-none border-b-2 border-transparent px-[16px] py-[8px] h-auto",
              periodo === 'visao_geral'
                ? "border-[var(--color-primary)] text-[var(--color-primary)] font-semibold"
                : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
            )}
          >
            <Users className="h-4 w-4 mr-2" />
            Visão Geral
          </Button>
        )}
        <Button
          variant="ghost"
          onClick={() => setPeriodo('afazeres')}
          className={cn(
            "rounded-none border-b-2 border-transparent px-[16px] py-[8px] h-auto",
            periodo === 'afazeres'
              ? "border-[var(--color-primary)] text-[var(--color-primary)] font-semibold"
              : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
          )}
        >
          Meus Afazeres
        </Button>
        <Button
          variant="ghost"
          onClick={() => setPeriodo('concluidas')}
          className={cn(
            "rounded-none border-b-2 border-transparent px-[16px] py-[8px] h-auto",
            periodo === 'concluidas'
              ? "border-[var(--color-primary)] text-[var(--color-primary)] font-semibold"
              : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
          )}
        >
          Minhas Tarefas Concluídas
        </Button>
        {!isSupervisor && isSupervisorOrGerente && (
          <Button
            variant="ghost"
            onClick={() => setPeriodo('visao_geral')}
            className={cn(
              "rounded-none border-b-2 border-transparent px-[16px] py-[8px] h-auto",
              periodo === 'visao_geral'
                ? "border-[var(--color-primary)] text-[var(--color-primary)] font-semibold"
                : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
            )}
          >
            <Users className="h-4 w-4 mr-2" />
            Visão Geral
          </Button>
        )}
      </div>

      {/* Cards Grid */}
      {periodo === 'visao_geral' && isSupervisorOrGerente ? (
        <>
          {/* Filtros */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Filter className="h-5 w-5" />
                Filtros
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* Filtro por usuário */}
                <div className="space-y-2">
                  <Label>Filtrar por Usuário</Label>
                  <select
                    value={filterUser}
                    onChange={(e) => setFilterUser(e.target.value)}
                    className="flex h-[40px] w-full rounded-[8px] border border-[var(--color-input)] bg-[var(--color-background)] px-[12px] py-[8px] text-sm"
                  >
                    <option value="all">Todos os usuários</option>
                    {allUsers.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.first_name && u.last_name ? `${u.first_name} ${u.last_name}` : u.username}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Pesquisa por nome */}
                <div className="space-y-2">
                  <Label>Pesquisar por Nome</Label>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-[var(--color-muted-foreground)]" />
                    <Input
                      value={filterSearch}
                      onChange={(e) => setFilterSearch(e.target.value)}
                      placeholder="Nome do card..."
                      className="pl-9"
                    />
                  </div>
                </div>

                {/* Agrupar por */}
                <div className="space-y-2">
                  <Label>Agrupar por</Label>
                  <select
                    value={groupBy}
                    onChange={(e) => setGroupBy(e.target.value as 'usuario' | 'sprint' | 'projeto')}
                    className="flex h-[40px] w-full rounded-[8px] border border-[var(--color-input)] bg-[var(--color-background)] px-[12px] py-[8px] text-sm"
                  >
                    <option value="usuario">Usuário</option>
                    <option value="sprint">Sprint</option>
                    <option value="projeto">Projeto</option>
                  </select>
                </div>

                {/* Exibir cards da etapa */}
                <div className="space-y-2">
                  <Label>Exibir cards da etapa</Label>
                  <select
                    value={filterEtapa}
                    onChange={(e) => setFilterEtapa(e.target.value as typeof filterEtapa)}
                    className="flex h-[40px] w-full rounded-[8px] border border-[var(--color-input)] bg-[var(--color-background)] px-[12px] py-[8px] text-sm"
                  >
                    <option value="em_desenvolvimento">Em Desenvolvimento</option>
                    <option value="a_desenvolver">A Desenvolver</option>
                    <option value="atrasados">Cards Atrasados</option>
                    <option value="entregues">Cards Entregues</option>
                    <option value="todos_sem_entregues">Todos os cards (entregues não incluso)</option>
                    <option value="todos_com_entregues">Todos os cards (entregues incluso)</option>
                  </select>
                </div>
              </div>

              {/* Botão de ordenação por data de entrega */}
              <div className="mt-4 flex items-center gap-2">
                <Label>Ordenar por Data de Entrega:</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (sortDataEntrega === null) {
                      setSortDataEntrega('asc');
                    } else if (sortDataEntrega === 'asc') {
                      setSortDataEntrega('desc');
                    } else {
                      setSortDataEntrega(null);
                    }
                  }}
                  className="flex items-center gap-2"
                >
                  Data de Entrega
                  {sortDataEntrega === 'asc' && <ArrowUp className="h-4 w-4" />}
                  {sortDataEntrega === 'desc' && <ArrowDown className="h-4 w-4" />}
                  {sortDataEntrega === null && <Calendar className="h-4 w-4 opacity-50" />}
                </Button>
                {sortDataEntrega && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setSortDataEntrega(null)}
                    className="text-xs"
                  >
                    Limpar ordenação
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Cards Agrupados */}
          {(() => {
            const grouped = getFilteredAndGroupedCards();
            const keys = Object.keys(grouped);

            if (keys.length === 0) {
              return (
                <div className="text-center py-12 text-[var(--color-muted-foreground)]">
                  <p>Nenhum card encontrado com os filtros aplicados.</p>
                </div>
              );
            }

            // Se agrupar por usuário, mostrar cards lado a lado em um grid
            if (groupBy === 'usuario') {
              // Coletar todos os cards com informações do usuário
              const userCards: Array<{ user: User | null; cards: CardType[]; userId: string }> = [];
              
              keys.forEach((key) => {
                const cards = grouped[key];
                let user: User | null = null;
                
                if (key !== 'sem_responsavel') {
                  // Comparar IDs como string para evitar falha quando API retorna número
                  user = allUsers.find(u => String(u.id) === String(key)) || null;
                  if (!user && cards.length > 0 && cards[0].responsavel) {
                    if (String(cards[0].responsavel) === String(key)) {
                      user = allUsers.find(u => String(u.id) === String(cards[0].responsavel)) || null;
                    }
                  }
                }
                
                userCards.push({ user, cards, userId: key });
              });

              return (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {userCards.map(({ user, cards, userId }, index) => {
                    // Tentar obter o nome do usuário de várias formas
                    let title = 'Sem Responsável';
                    if (user) {
                      title = user.first_name && user.last_name 
                        ? `${user.first_name} ${user.last_name}` 
                        : user.username;
                    } else if (cards.length > 0 && cards[0].responsavel_name) {
                      // Se não encontrou o usuário mas o card tem responsavel_name, usar isso
                      title = cards[0].responsavel_name;
                    }
                    
                    const photoUrl = user?.profile_picture_url ?? (cards[0]?.responsavel_profile_picture_url || null);
                    const initials = user
                      ? (user.first_name?.charAt(0) || user.username?.charAt(0) || 'U')
                      : (title ? title.trim().split(/\s+/).map(p => p[0]).join('').substring(0, 2).toUpperCase() : '?');

                    return (
                      <Card key={userId || `sem_responsavel_${index}`} className="flex flex-col">
                        <CardHeader className="pb-3">
                          <CardTitle className="flex items-center gap-2 text-base">
                            <Avatar className="h-8 w-8 shrink-0">
                              {photoUrl ? (
                                <AvatarImage src={photoUrl} alt={title} />
                              ) : null}
                              <AvatarFallback className="text-xs">
                                {initials}
                              </AvatarFallback>
                            </Avatar>
                            <span className="truncate">{title}</span>
                            <span className="text-xs text-[var(--color-muted-foreground)] ml-auto whitespace-nowrap">
                              {cards.length === 1
                                ? '1 card'
                                : `${cards.length} cards`}
                            </span>
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="flex-1 space-y-3">
                          {cards.map((card) => {
                            const canEdit = false;
                            return (
                              <TaskCard
                                key={card.id}
                                card={card}
                                onCardClick={() => handleCardClick(card)}
                                onTodoStatusChange={handleTodoStatusChange}
                                onTodoCommentChange={handleTodoCommentChange}
                                onTodoAdd={handleTodoAdd}
                                onTodoDelete={handleTodoDelete}
                                onCardCommentChange={handleCardCommentChange}
                                canEdit={canEdit}
                              />
                            );
                          })}
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              );
            }

            // Para sprint e projeto, manter o layout original com Cards completos
            return (
              <div className="space-y-6">
                {keys.map((key) => {
                  const cards = grouped[key];
                  let title = '';

                  if (groupBy === 'sprint') {
                    const [, sprintName] = key.split('|');
                    title = sprintName;
                  } else if (groupBy === 'projeto') {
                    const [, projectName] = key.split('|');
                    title = projectName;
                  }

                  return (
                    <Card key={key}>
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                          {title} ({cards.length} {cards.length === 1 ? 'card' : 'cards'})
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                          {cards.map((card) => {
                            const canEdit = false;
                            return (
                              <TaskCard
                                key={card.id}
                                card={card}
                                onCardClick={() => handleCardClick(card)}
                                onTodoStatusChange={handleTodoStatusChange}
                                onTodoCommentChange={handleTodoCommentChange}
                                onTodoAdd={handleTodoAdd}
                                onTodoDelete={handleTodoDelete}
                                onCardCommentChange={handleCardCommentChange}
                                canEdit={canEdit}
                              />
                            );
                          })}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            );
          })()}
        </>
      ) : periodo === 'afazeres' ? (
        <>
          {/* Seção: Em Desenvolvimento */}
          <div className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold text-[var(--color-foreground)] mb-3">
                Em Desenvolvimento
              </h2>
              {cardsEmDesenvolvimento.length === 0 ? (
                <div className="text-center py-8 text-[var(--color-muted-foreground)] bg-[var(--color-muted)]/30 rounded-lg border border-[var(--color-border)]">
                  <p>Nenhum card em desenvolvimento.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {cardsEmDesenvolvimento.map((card) => (
                    <TaskCard
                      key={card.id}
                      card={card}
                      onCardClick={() => handleCardClick(card)}
                      onTodoStatusChange={handleTodoStatusChange}
                      onTodoCommentChange={handleTodoCommentChange}
                      onTodoAdd={handleTodoAdd}
                      onTodoDelete={handleTodoDelete}
                      onCardCommentChange={handleCardCommentChange}
                      canEdit={String(card.responsavel || '') === String(user?.id)}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Seção: A Desenvolver */}
            <div className="space-y-4 mt-8">
              <h2 className="text-lg font-semibold text-[var(--color-foreground)] mb-3">
                A Desenvolver
              </h2>
              {cardsADesenvolver.length === 0 ? (
                <div className="text-center py-8 text-[var(--color-muted-foreground)] bg-[var(--color-muted)]/30 rounded-lg border border-[var(--color-border)]">
                  <p>Nenhum card a desenvolver.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {cardsADesenvolver.map((card) => (
                    <TaskCard
                      key={card.id}
                      card={card}
                      onCardClick={() => handleCardClick(card)}
                      onTodoStatusChange={handleTodoStatusChange}
                      onTodoCommentChange={handleTodoCommentChange}
                      onTodoAdd={handleTodoAdd}
                      onTodoDelete={handleTodoDelete}
                      onCardCommentChange={handleCardCommentChange}
                      canEdit={String(card.responsavel || '') === String(user?.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      ) : (
        <>
          {/* Tarefas Concluídas */}
          {cards.length === 0 ? (
            <div className="text-center py-12 text-[var(--color-muted-foreground)]">
              <p>Nenhum card encontrado.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {cards.map((card) => (
                <TaskCard
                  key={card.id}
                  card={card}
                  onCardClick={() => handleCardClick(card)}
                  onTodoStatusChange={handleTodoStatusChange}
                  onTodoCommentChange={handleTodoCommentChange}
                  onTodoAdd={handleTodoAdd}
                  onTodoDelete={handleTodoDelete}
                  onCardCommentChange={handleCardCommentChange}
                  canEdit={String(card.responsavel || '') === String(user?.id)}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* Modal de Visualização do Card */}
      <Dialog open={viewCardDialogOpen} onOpenChange={(open) => {
        setViewCardDialogOpen(open);
        if (!open) {
          setSelectedCard(null);
        }
      }}>
        <DialogContent onClose={() => {
          setViewCardDialogOpen(false);
          setSelectedCard(null);
        }} className="max-w-[600px]">
          <DialogHeader>
            <DialogTitle>Ver Card</DialogTitle>
            <DialogDescription>
              Visualize as informações do card (somente visualização)
            </DialogDescription>
          </DialogHeader>

          {cardLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-[var(--color-primary)]" />
            </div>
          ) : (
            <form className="space-y-[16px] mt-[16px] max-h-[70vh] overflow-y-auto pr-[8px]">
              <div className="space-y-[8px]">
                <Label htmlFor="card-nome">Nome do Card *</Label>
                <Input
                  id="card-nome"
                  placeholder="Ex: Certidões PE"
                  value={cardFormData.nome}
                  onChange={() => {}}
                  required
                  disabled={true}
                />
              </div>

              <div className="space-y-[8px]">
                <Label htmlFor="card-descricao">Descrição / Instruções</Label>
                <Textarea
                  id="card-descricao"
                  placeholder="Descreva o card, instruções detalhadas, requisitos, etc..."
                  value={cardFormData.descricao}
                  onChange={() => {}}
                  rows={4}
                  disabled={true}
                />
              </div>

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setViewCardDialogOpen(false);
                    setSelectedCard(null);
                  }}
                >
                  Fechar
                </Button>
                {selectedCard?.projeto && (
                  <Button
                    type="button"
                    onClick={() => {
                      setViewCardDialogOpen(false);
                      navigate(ROUTES.projeto(String(selectedCard.projeto)));
                    }}
                  >
                    Ir para Projeto
                  </Button>
                )}
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

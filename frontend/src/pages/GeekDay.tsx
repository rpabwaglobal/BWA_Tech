import { useEffect, useState, useRef } from 'react';
import confetti from 'canvas-confetti';
import { useAuth } from '@/context/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { geekdayService, type GeekDayUserStatus, type GeekDayDraw } from '@/services/geekdayService';
import { Loader2, Check, RotateCcw, Trophy } from 'lucide-react';
import { formatDate } from '@/lib/dateUtils';
import { cn } from '@/lib/utils';
import { DateInput } from '@/components/ui/date-input';
import { PrizeWheel } from '@mertercelik/react-prize-wheel';
import type { Sector, PrizeWheelRef } from '@mertercelik/react-prize-wheel';
import '@mertercelik/react-prize-wheel/style.css';
import './GeekDay.css';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DndContext,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay,
  useDroppable,
} from '@dnd-kit/core';
import {
  useSortable,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

export default function GeekDay() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<'sorteio' | 'historico'>('sorteio');
  const [users, setUsers] = useState<GeekDayUserStatus[]>([]);
  const [historico, setHistorico] = useState<GeekDayDraw[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSpinning, setIsSpinning] = useState(false);
  const [winner, setWinner] = useState<GeekDayUserStatus | null>(null);
  const [showWinnerDialog, setShowWinnerDialog] = useState(false);
  const [showResetDialog, setShowResetDialog] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [confirmingWinner, setConfirmingWinner] = useState(false);
  const [winnerPresentationDate, setWinnerPresentationDate] = useState<string>('');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const wheelRef = useRef<PrizeWheelRef>(null);
  const confettiFiredRef = useRef(false);
  const winnerAvatarRef = useRef<HTMLDivElement>(null);

  const isSupervisor = user?.role === 'supervisor' || user?.role === 'admin';
  const isGestor = user?.role === 'supervisor' || user?.role === 'gerente' || user?.role === 'admin';
  const canReset = user?.role === 'supervisor' || user?.role === 'gerente' || user?.role === 'admin';

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  useEffect(() => {
    loadData();
  }, [activeTab]);

  // Confetti em tela cheia: dispara sempre que o modal do ganhador abre (com foto ou só iniciais)
  useEffect(() => {
    if (!showWinnerDialog || !winner) {
      confettiFiredRef.current = false;
      return;
    }
    if (confettiFiredRef.current) return;
    confettiFiredRef.current = true;

    const colors = ['#a786ff', '#fd8bbc', '#eca184', '#f8deb1'];

    const fireFromCenter = () => {
      // Origem: centro do avatar (foto ou iniciais) ou centro da tela se ref ainda não montou
      let originX = 0.5;
      let originY = 0.5;
      const el = winnerAvatarRef.current;
      if (el) {
        const rect = el.getBoundingClientRect();
        originX = (rect.left + rect.width / 2) / window.innerWidth;
        originY = (rect.top + rect.height / 2) / window.innerHeight;
      }

      const end = Date.now() + 4 * 1000; // 4 segundos
      const angles = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330];

      const frame = () => {
        if (Date.now() > end) return;
        const angle = angles[Math.floor(Math.random() * angles.length)];
        confetti({
          particleCount: 12,
          angle,
          spread: 55,
          startVelocity: 55,
          origin: { x: originX, y: originY },
          colors,
          zIndex: 55,
        });
        requestAnimationFrame(frame);
      };
      frame();

      // Cliques devem passar pelo canvas do confetti para o backdrop
      const styleCanvas = () => {
        document.body.querySelectorAll('canvas').forEach((c) => {
          if (Number((c as HTMLCanvasElement).style.zIndex) === 55)
            (c as HTMLCanvasElement).style.pointerEvents = 'none';
        });
      };
      setTimeout(styleCanvas, 100);
    };

    // Dar tempo ao portal do Dialog montar antes de disparar (ref pode estar null no primeiro tick)
    const t = setTimeout(fireFromCenter, 350);
    return () => clearTimeout(t);
  }, [showWinnerDialog, winner]);

  // Polling para atualização em tempo real (apenas na aba de sorteio)
  // Desabilitado durante drag para evitar conflitos
  useEffect(() => {
    if (activeTab !== 'sorteio') return;

    const interval = setInterval(() => {
      // Recarregar dados a cada 10 segundos para sincronização em tempo real
      // Não recarregar se estiver arrastando ou se a página não estiver visível
      if (!dragging && document.visibilityState === 'visible') {
        loadData(false); // Não mostrar loading durante polling
      }
    }, 10000); // Aumentado para 10 segundos para reduzir requisições

    return () => clearInterval(interval);
  }, [activeTab, dragging]);

  const loadData = async (showLoading = true) => {
    try {
      if (showLoading) {
        setLoading(true);
      }
      if (activeTab === 'sorteio') {
        const usersData = await geekdayService.getUsersStatus();
        setUsers(usersData);
      } else {
        const historicoData = await geekdayService.getHistorico();
        setHistorico(historicoData);
      }
    } catch (error: any) {
      console.error('Erro ao carregar dados:', error);
    } finally {
      if (showLoading) {
        setLoading(false);
      }
    }
  };

  // Função para obter cor baseada no role do usuário
  const getRoleColor = (role: string): string => {
    switch (role) {
      case 'supervisor':
        return '#93c5fd';
      case 'gerente':
        return '#86efac';
      case 'desenvolvedor':
        return '#fdba74';
      case 'dados':
        return '#c4b5fd';
      case 'processos':
        return '#fca5a5';
      case 'admin':
        return '#c4b5fd';
      default:
        return '#9ca3af';
    }
  };

  // Converter usuários disponíveis em setores para a roleta
  // Ordena por role para agrupar cores similares
  const getSectors = (): Sector[] => {
    const availableUsers = users.filter(u => !u.ja_sorteado);
    
    // A biblioteca requer entre 2 e 24 setores
    if (availableUsers.length === 0 || availableUsers.length < 2) {
      return [];
    }

    // Se houver mais de 24 usuários, limitar a 24 para a roleta
    const usersForWheel = availableUsers.slice(0, 24);

    // Ordenar por role para agrupar cores similares
    const roleOrder = ['supervisor', 'gerente', 'desenvolvedor', 'dados', 'processos', 'admin'];
    const sortedUsers = [...usersForWheel].sort((a, b) => {
      const aIndex = roleOrder.indexOf(a.role || 'desenvolvedor');
      const bIndex = roleOrder.indexOf(b.role || 'desenvolvedor');
      return aIndex - bIndex;
    });

    // Criar setores com probabilidade igual para todos
    return sortedUsers.map((user, index) => ({
      id: user.id,
      label: getUserDisplayName(user),
      text: getUserDisplayName(user),
      probability: 10, // Probabilidade igual para todos
    }));
  };

  // Obter array de cores para a roleta
  // A biblioteca alterna entre dois tons de azul claro
  const getWheelColors = (): [string, string] => {
    return ['#93c5fd', '#bfdbfe']; // Azul claro (blue-300) e azul mais claro (blue-200)
  };


  const handleSpinStart = () => {
    setIsSpinning(true);
    setWinner(null);
    setShowWinnerDialog(false);
    setWinnerPresentationDate('');
  };

  const handleSpinEnd = (sector: Sector) => {
    setIsSpinning(false);
    
    // Encontrar o usuário correspondente ao setor sorteado pela roleta
    const usuarioSorteado = users.find(u => String(u.id) === String(sector.id));
    
    if (usuarioSorteado) {
      // O ganhador é definido pela roleta
      setWinner(usuarioSorteado);
      setShowWinnerDialog(true);
      setWinnerPresentationDate('');
    }
  };

  const handleSpin = () => {
    if (wheelRef.current && !isSpinning && sectors.length > 0) {
      // Apenas girar a roleta - o resultado será definido quando parar
      wheelRef.current.spin();
    }
  };

  const handleConfirmWinner = async () => {
    if (!winner || confirmingWinner) return;

    setConfirmingWinner(true);
    try {
      // Marcar o usuário escolhido pela roleta como sorteado no backend
      const resultado = await geekdayService.marcarComoSorteado(
        String(winner.id),
        'Sorteado pela roleta',
        winnerPresentationDate || null
      );
      console.log('Sorteio confirmado no backend:', resultado);
      
      // Fechar o modal e limpar o winner
      setShowWinnerDialog(false);
      const winnerId = winner.id;
      setWinner(null);
      setWinnerPresentationDate('');
      
      // Aguardar um pouco para garantir que o backend processou completamente
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // Recarregar dados do backend para garantir sincronização
      await loadData();
      
      // Verificar se o usuário foi atualizado corretamente
      const updatedUsers = await geekdayService.getUsersStatus();
      const updatedUser = updatedUsers.find(u => String(u.id) === String(winnerId));
      console.log('Usuário após recarregar:', updatedUser ? { id: updatedUser.id, ja_sorteado: updatedUser.ja_sorteado } : 'não encontrado');
      
      if (updatedUser && !updatedUser.ja_sorteado) {
        console.error('Usuário não foi marcado como sorteado. Tentando recarregar novamente...');
        await loadData();
      }
    } catch (error: any) {
      console.error('Erro ao confirmar sorteio:', error);
      // Mesmo com erro, fechar o modal
      setShowWinnerDialog(false);
      setWinner(null);
      setWinnerPresentationDate('');
    } finally {
      setConfirmingWinner(false);
    }
  };

  const handleResetar = async () => {
    if (resetting || !canReset) return;

    setResetting(true);
    try {
      await geekdayService.resetarSorteios();
      setShowResetDialog(false);
      setWinner(null);
      loadData();
    } catch (error: any) {
      console.error('Erro ao resetar sorteios:', error);
    } finally {
      setResetting(false);
    }
  };

  // Handlers para drag and drop
  const handleDragStart = (event: any) => {
    if (!isSupervisor) {
      console.log('Drag bloqueado: usuário não é supervisor');
      return;
    }
    console.log('Drag iniciado:', event.active.id);
    setActiveId(event.active.id);
    setDragging(true);
  };

  const handleDragEnd = async (event: any) => {
    const { active, over } = event;
    const wasDragging = dragging;
    console.log('Drag finalizado:', { active: active.id, over: over?.id, wasDragging, isSupervisor });
    setActiveId(null);
    setDragging(false);

    if (!over || !isSupervisor || !wasDragging) {
      console.log('Drag cancelado:', { over: !!over, isSupervisor, wasDragging });
      return;
    }

    const draggedUser = users.find(u => String(u.id) === String(active.id));
    if (!draggedUser) return;

    // Identificar a lista de destino
    let targetList = over.id;
    
    // Se o over.id não for uma das listas, pode ser que seja um card dentro da lista
    // Nesse caso, precisamos encontrar em qual lista o card está
    if (targetList !== 'sorted-list' && targetList !== 'available-list') {
      // Verificar se é um card (usuário) - se for, encontrar em qual lista ele está
      const targetUser = users.find(u => String(u.id) === String(targetList));
      if (targetUser) {
        // Se soltou em um card, usar a lista onde esse card está
        targetList = targetUser.ja_sorteado ? 'sorted-list' : 'available-list';
      } else {
        // Se não é um usuário, tentar encontrar o droppable através do DOM
        // Usar o elemento que está sendo arrastado para encontrar a posição
        const activeElement = document.querySelector(`[data-id="${active.id}"]`);
        if (activeElement) {
          // Verificar em qual lista o elemento ativo está atualmente
          const currentList = draggedUser.ja_sorteado ? 'sorted-list' : 'available-list';
          
          const sortedListElement = document.querySelector('[data-droppable-id="sorted-list"]');
          const availableListElement = document.querySelector('[data-droppable-id="available-list"]');
          
          // Se soltou em um elemento que não é uma lista válida, usar heurística: se soltou em um card de outra lista,
          // usar a lista oposta
          if (currentList === 'sorted-list') {
            targetList = 'available-list';
          } else {
            targetList = 'sorted-list';
          }
        } else {
          // Se não conseguiu identificar, não fazer nada
          console.log('Lista de destino não identificada:', targetList, over);
          return;
        }
      }
    }

    const isTargetSorted = targetList === 'sorted-list';
    const isTargetAvailable = targetList === 'available-list';

    // Se não identificou uma lista válida, não fazer nada
    if (!isTargetSorted && !isTargetAvailable) {
      console.log('Lista de destino não identificada:', targetList);
      return;
    }

    // Se arrastou para a mesma lista, não fazer nada
    if ((isTargetSorted && draggedUser.ja_sorteado) || 
        (isTargetAvailable && !draggedUser.ja_sorteado)) {
      return;
    }

    try {
      if (isTargetSorted) {
        // Marcar como sorteado
        await geekdayService.marcarComoSorteado(String(draggedUser.id), 'Movido manualmente pelo supervisor');
      } else if (isTargetAvailable) {
        // Desmarcar como sorteado
        await geekdayService.desmarcarComoSorteado(String(draggedUser.id));
      }
      
      // Atualizar estado local imediatamente para feedback visual
      setUsers(prev => prev.map(u => 
        String(u.id) === String(draggedUser.id) 
          ? { ...u, ja_sorteado: isTargetSorted }
          : u
      ));
      
      // Aguardar um pouco antes de recarregar para evitar conflitos
      setTimeout(() => {
        if (!dragging) {
          loadData();
        }
      }, 500);
    } catch (error: any) {
      console.error('Erro ao mover usuário:', error);
      // Reverter mudança local em caso de erro
      await loadData();
    }
  };

  // Componente de card arrastável
  const DraggableUserCard = ({ user, isSorted }: { user: GeekDayUserStatus; isSorted: boolean }) => {
    const {
      attributes,
      listeners,
      setNodeRef,
      transform,
      transition,
      isDragging,
    } = useSortable({ 
      id: user.id, 
      disabled: !isSupervisor 
    });

    const style = {
      transform: CSS.Transform.toString(transform),
      transition,
      opacity: isDragging ? 0.5 : 1,
    };

    const canDrag = isSupervisor;

    if (isSorted) {
      return (
        <div
          ref={setNodeRef}
          style={style}
          {...attributes}
          {...listeners}
          className={cn(
            "rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] hover:bg-[var(--color-accent)] transition-colors",
            !canDrag ? 'opacity-50 cursor-not-allowed' : 'cursor-move'
          )}
        >
          <CardContent className="flex items-center gap-3 p-4">
            <Avatar className="h-[40px] w-[40px]">
              {user.profile_picture_url ? (
                <AvatarImage src={user.profile_picture_url} alt={getUserDisplayName(user)} />
              ) : null}
              <AvatarFallback className="bg-[var(--color-muted)] text-[var(--color-muted-foreground)]">
                {user.first_name?.charAt(0) || user.username?.charAt(0) || 'U'}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="font-medium text-sm truncate text-green-500">
                  {getUserDisplayName(user)}
                </p>
                <Check className="h-4 w-4 text-green-500 shrink-0" strokeWidth={3} />
              </div>
              <p className="text-xs text-green-500 truncate">
                {getRoleDisplayName(user.role || 'desenvolvedor')}
              </p>
            </div>
          </CardContent>
        </div>
      );
    }

    return (
      <div
        ref={setNodeRef}
        style={style}
        {...attributes}
        {...listeners}
        className={cn(
          "rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] text-[var(--color-card-foreground)] shadow hover:shadow-md transition-shadow",
          !canDrag ? 'opacity-50 cursor-not-allowed' : 'cursor-move'
        )}
      >
        <CardContent className="flex items-center gap-3 p-4">
          <Avatar className="h-[40px] w-[40px]">
            {user.profile_picture_url ? (
              <AvatarImage src={user.profile_picture_url} alt={getUserDisplayName(user)} />
            ) : null}
            <AvatarFallback className="bg-[var(--color-muted)] text-[var(--color-muted-foreground)]">
              {user.first_name?.charAt(0) || user.username?.charAt(0) || 'U'}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm truncate">
              {getUserDisplayName(user)}
            </p>
            <p className="text-xs text-[var(--color-muted-foreground)] truncate">
              {getRoleDisplayName(user.role || 'desenvolvedor')}
            </p>
          </div>
        </CardContent>
      </div>
    );
  };

  // Componente de área droppable
  const DroppableList = ({ 
    id, 
    title, 
    count, 
    children, 
    isEmpty 
  }: { 
    id: string; 
    title: string; 
    count: number; 
    children: React.ReactNode;
    isEmpty: boolean;
  }) => {
    const { setNodeRef, isOver } = useDroppable({ 
      id,
      disabled: !isSupervisor
    });

    return (
      <Card 
        ref={setNodeRef} 
        className={cn(
          "flex flex-col min-h-0 h-full",
          isOver && isSupervisor ? 'ring-2 ring-[var(--color-primary)]' : ''
        )}
      >
        <CardHeader className="shrink-0 pb-3">
          <CardTitle className="text-base">{title} ({count})</CardTitle>
        </CardHeader>
        <CardContent className="flex-1 min-h-0 overflow-hidden pt-0">
          <div className="space-y-2 h-full overflow-y-auto pr-2">
            {isEmpty ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <p className="text-sm text-[var(--color-muted-foreground)]">
                  {id === 'available-list' 
                    ? 'Todos os usuários já foram sorteados!'
                    : 'Nenhum usuário sorteado ainda'}
                </p>
              </div>
            ) : (
              children
            )}
          </div>
        </CardContent>
      </Card>
    );
  };

  const getUserDisplayName = (user: GeekDayUserStatus) => {
    if (user.first_name && user.last_name) {
      return `${user.first_name} ${user.last_name}`;
    } else if (user.first_name) {
      return user.first_name;
    } else if (user.last_name) {
      return user.last_name;
    }
    return user.username;
  };

  const getRoleDisplayName = (role: string): string => {
    switch (role) {
      case 'supervisor':
        return 'Supervisor';
      case 'gerente':
        return 'Gerente de Projeto';
      case 'desenvolvedor':
        return 'Desenvolvedor';
      case 'dados':
        return 'Dados';
      case 'processos':
        return 'Processos';
      case 'admin':
        return 'Admin';
      default:
        return role.charAt(0).toUpperCase() + role.slice(1);
    }
  };

  const getUserInitials = (user: GeekDayUserStatus) => {
    if (user.first_name && user.last_name) {
      return `${user.first_name[0]}${user.last_name[0]}`.toUpperCase();
    } else if (user.first_name) {
      return user.first_name.substring(0, 2).toUpperCase();
    } else if (user.last_name) {
      return user.last_name.substring(0, 2).toUpperCase();
    }
    return user.username.substring(0, 2).toUpperCase();
  };

  const availableUsers = users.filter(u => !u.ja_sorteado);
  const sortedUsers = users.filter(u => u.ja_sorteado);
  const sectors = getSectors();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--color-primary)]" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-128px)] space-y-[24px]">
      <div>
        <h1 className="text-2xl font-bold text-[var(--color-foreground)]">Geek Day</h1>
        <p className="text-sm text-[var(--color-muted-foreground)] mt-1">
          Sistema de sorteio para o Geek Day
        </p>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-[8px] border-b border-[var(--color-border)] shrink-0">
        <Button
          variant="ghost"
          onClick={() => setActiveTab('sorteio')}
          className={cn(
            "rounded-none border-b-2 border-transparent px-[16px] py-[8px] h-auto",
            activeTab === 'sorteio'
              ? "border-[var(--color-primary)] text-[var(--color-primary)] font-semibold"
              : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
          )}
        >
          Sorteio
        </Button>
        <Button
          variant="ghost"
          onClick={() => setActiveTab('historico')}
          className={cn(
            "rounded-none border-b-2 border-transparent px-[16px] py-[8px] h-auto",
            activeTab === 'historico'
              ? "border-[var(--color-primary)] text-[var(--color-primary)] font-semibold"
              : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
          )}
        >
          Histórico
        </Button>
        {canReset && activeTab === 'sorteio' && (
          <div className="ml-auto">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowResetDialog(true)}
              className="gap-2"
            >
              <RotateCcw className="h-4 w-4" />
              Resetar Sorteios
            </Button>
          </div>
        )}
      </div>

      {/* Conteúdo da aba Sorteio */}
      {activeTab === 'sorteio' && (
        <div className="flex-1 min-h-0 flex flex-col">
          {/* Área de sorteio */}
          <Card className="flex-1 min-h-0 flex flex-col">
            <CardContent className="flex-1 min-h-0 overflow-hidden p-6">
              {sectors.length >= 2 ? (
                <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 h-full">
                  {/* Coluna esquerda: Roleta */}
                  <div className="lg:col-span-2 flex flex-col items-center justify-center space-y-3 h-full min-h-0">
                    <div className="w-full flex-1 flex items-center justify-center min-h-0 relative">
                      <div className="w-full max-w-lg h-full max-h-[500px] aspect-square relative rounded-2xl overflow-hidden roulette-wrapper">
                        <PrizeWheel
                          ref={wheelRef}
                          sectors={sectors}
                          onSpinStart={handleSpinStart}
                          onSpinEnd={handleSpinEnd}
                          duration={4}
                          minSpins={5}
                          maxSpins={8}
                          wheelColors={getWheelColors()}
                          textColor="#ffffff"
                          textFontSize={16}
                        />
                        {/* Overlay escuro quando não está sorteando */}
                        {!isSpinning && (
                          <div className="absolute inset-0 bg-black/60 rounded-2xl flex items-center justify-center z-10 backdrop-blur-sm">
                            {/* Botão de sorteio sobreposto */}
                            {isGestor && (
                              <Button
                                onClick={handleSpin}
                                disabled={isSpinning || availableUsers.length < 2}
                                size="lg"
                                className="gap-2 shadow-lg"
                              >
                                <Trophy className="h-5 w-5" />
                                Girar Roleta
                              </Button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Resultado do sorteio */}
                    {winner && (
                      <div className="flex flex-col items-center justify-center p-3 bg-green-50 dark:bg-green-900/20 rounded-lg border-2 border-green-500 w-full max-w-xs flex-shrink-0">
                        <Trophy className="h-8 w-8 text-green-500 mb-2" />
                        <h3 className="text-base font-bold text-green-700 dark:text-green-400 mb-1">
                          Parabéns!
                        </h3>
                        <p className="text-xs text-green-600 dark:text-green-300 text-center">
                          {getUserDisplayName(winner)} foi sorteado!
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Coluna direita: Listas de usuários */}
                  <div className="lg:col-span-3 flex flex-col min-h-0 h-full">
                    <DndContext
                      sensors={sensors}
                      collisionDetection={closestCorners}
                      onDragStart={handleDragStart}
                      onDragEnd={handleDragEnd}
                    >
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 h-full">
                        {/* Lista de usuários participando do sorteio */}
                        <DroppableList
                          id="available-list"
                          title="Participantes"
                          count={availableUsers.length}
                          isEmpty={availableUsers.length === 0}
                        >
                          {availableUsers.map((user) => (
                            <DraggableUserCard key={user.id} user={user} isSorted={false} />
                          ))}
                        </DroppableList>

                        {/* Lista de usuários já sorteados */}
                        <DroppableList
                          id="sorted-list"
                          title="Já Sorteados"
                          count={sortedUsers.length}
                          isEmpty={sortedUsers.length === 0}
                        >
                          {sortedUsers.map((user) => (
                            <DraggableUserCard key={user.id} user={user} isSorted={true} />
                          ))}
                        </DroppableList>
                      </div>
                      <DragOverlay>
                        {activeId ? (() => {
                          const activeUser = users.find(u => String(u.id) === String(activeId));
                          return (
                            <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] shadow-lg p-4">
                              <div className="flex items-center gap-3">
                                <Avatar className="h-[40px] w-[40px]">
                                  {activeUser?.profile_picture_url ? (
                                    <AvatarImage src={activeUser.profile_picture_url} alt={getUserDisplayName(activeUser || users[0])} />
                                  ) : null}
                                  <AvatarFallback className="bg-[var(--color-muted)] text-[var(--color-muted-foreground)]">
                                    {activeUser?.first_name?.charAt(0) || activeUser?.username?.charAt(0) || 'U'}
                                  </AvatarFallback>
                                </Avatar>
                                <div>
                                  <p className="font-medium text-sm">
                                    {getUserDisplayName(activeUser || users[0])}
                                  </p>
                                </div>
                              </div>
                            </div>
                          );
                        })() : null}
                      </DragOverlay>
                    </DndContext>
                  </div>
                </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full min-h-0">
                      <div className="w-full max-w-lg h-full max-h-[500px] aspect-square relative rounded-2xl overflow-hidden roulette-wrapper bg-[var(--color-muted)] flex items-center justify-center">
                        {/* Overlay escuro com mensagem */}
                        <div className="absolute inset-0 bg-black/60 rounded-2xl flex items-center justify-center z-10 backdrop-blur-sm">
                          <div className="text-center p-6">
                            <p className="text-white font-semibold text-lg mb-2">
                              Todos os usuários já foram sorteados!
                            </p>
                            <p className="text-white/80 text-sm mb-4">
                              Use o botão "Resetar Sorteios" para permitir novos sorteios.
                            </p>
                            {canReset && (
                              <Button
                                variant="default"
                                size="lg"
                                onClick={() => setShowResetDialog(true)}
                                className="gap-2 shadow-lg"
                              >
                                <RotateCcw className="h-5 w-5" />
                                Resetar Sorteios
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Conteúdo da aba Histórico */}
      {activeTab === 'historico' && (
        <Card className="flex-1 min-h-0 flex flex-col">
          <CardHeader className="shrink-0">
            <CardTitle>Histórico de Sorteios</CardTitle>
          </CardHeader>
          <CardContent className="flex-1 min-h-0 overflow-y-auto">
            {historico.length === 0 ? (
              <div className="text-center p-8 text-[var(--color-muted-foreground)]">
                <p>Nenhum sorteio realizado ainda.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {historico.map((draw) => (
                  <Card key={draw.id}>
                    <CardContent className="flex items-center justify-between p-4">
                      <div className="flex items-center gap-4">
                        <Avatar className="h-[40px] w-[40px]">
                          {draw.usuario_profile_picture ? (
                            <AvatarImage src={draw.usuario_profile_picture} alt={draw.usuario_name} />
                          ) : null}
                          <AvatarFallback className="bg-[var(--color-muted)] text-[var(--color-muted-foreground)]">
                            {draw.usuario_name?.charAt(0) || 'U'}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="font-medium">{draw.usuario_name}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <p className="text-sm text-[var(--color-muted-foreground)]">
                              {formatDate(draw.data_sorteio)}
                            </p>
                            {draw.data_apresentacao && (
                              <Badge variant="outline" className="text-xs">
                                Apresentação: {formatDate(draw.data_apresentacao)}
                              </Badge>
                            )}
                            {draw.marcado_manual && (
                              <Badge variant="secondary" className="text-xs">
                                Manual
                              </Badge>
                            )}
                            {draw.sorteado_por_name && (
                              <span className="text-xs text-[var(--color-muted-foreground)]">
                                por {draw.sorteado_por_name}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Dialog de ganhador do sorteio */}
      <Dialog open={showWinnerDialog} onOpenChange={(open) => {
        if (!open && !confirmingWinner) {
          // Não permitir fechar enquanto está confirmando
          setShowWinnerDialog(false);
          setWinner(null);
          setWinnerPresentationDate('');
        }
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-center">Ganhador do Sorteio!</DialogTitle>
            <DialogDescription className="text-center">
              A roleta escolheu o ganhador
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center justify-center py-6">
            {/* Ref para origem do confetti (centro do avatar – foto ou iniciais) */}
            <div ref={winnerAvatarRef}>
              <Avatar className="h-24 w-24 shrink-0 mb-4 ring-4 ring-green-500/30">
              {winner?.profile_picture_url ? (
                <AvatarImage src={winner.profile_picture_url} alt={winner ? getUserDisplayName(winner) : ''} />
              ) : null}
              <AvatarFallback className="bg-[var(--color-muted)] text-[var(--color-muted-foreground)] text-2xl">
                {winner
                  ? (winner.first_name && winner.last_name
                      ? `${winner.first_name.charAt(0)}${winner.last_name.charAt(0)}`.toUpperCase()
                      : winner.first_name?.charAt(0) || winner.username?.substring(0, 2).toUpperCase() || 'U')
                  : 'U'}
              </AvatarFallback>
            </Avatar>
            </div>
            <Trophy className="h-8 w-8 text-green-500 mb-2" aria-hidden />
            <h3 className="text-2xl font-bold text-green-700 dark:text-green-400 mb-2 text-center">
              {winner && getUserDisplayName(winner)}
            </h3>
            <p className="text-sm text-[var(--color-muted-foreground)] text-center">
              {winner && getRoleDisplayName(winner.role || 'desenvolvedor')}
            </p>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">
              Data de apresentação (opcional)
            </label>
            <DateInput
              value={winnerPresentationDate}
              onChange={(e) => setWinnerPresentationDate(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button
              onClick={handleConfirmWinner}
              disabled={confirmingWinner}
              className="w-full gap-2"
            >
              {confirmingWinner ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Confirmando...
                </>
              ) : (
                <>
                  <Check className="h-4 w-4" />
                  Confirmar e Fechar
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog de resetar sorteios */}
      <Dialog open={showResetDialog} onOpenChange={setShowResetDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Resetar Sorteios</DialogTitle>
            <DialogDescription>
              Tem certeza que deseja resetar todos os sorteios? Isso permitirá que todos os usuários sejam sorteados novamente.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowResetDialog(false)}
              disabled={resetting}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={handleResetar}
              disabled={resetting}
            >
              {resetting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Resetando...
                </>
              ) : (
                'Resetar'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { DateInput } from '@/components/ui/date-input';
import { DateTimePicker } from '@/components/ui/datetime-picker';
import { DateRangePicker } from '@/components/ui/date-range-picker';
import { Textarea } from '@/components/ui/textarea';
import { UserSelect } from '@/components/ui/user-select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { sprintService } from '@/services/sprintService';
import { projectService } from '@/services/projectService';
import { cardService, CARD_AREAS, CARD_TYPES, CARD_PRIORITIES, CARD_STATUSES } from '@/services/cardService';
import { userService } from '@/services/userService';
import { cardLogService } from '@/services/cardLogService';
import { cardTodoService } from '@/services/cardTodoService';
import { getTodosByArea } from '@/constants/cardTodos';
import { CardLogsModal } from '@/components/CardLogsModal';
import type { Sprint } from '@/services/sprintService';
import type { Project } from '@/services/projectService';
import type { Card as CardType } from '@/services/cardService';
import type { User as UserType } from '@/services/userService';
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
} from 'lucide-react';
import { calcularDiasTotais, calcularDiasUteis, formatDate, formatDateTime, isCardAtrasado } from '@/lib/dateUtils';

type CardSortField = 'nome' | 'created_at' | 'responsavel_name' | 'prioridade' | 'status' | 'area' | 'tipo';
type CardSortDirection = 'asc' | 'desc';

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
  const { sprintId } = useParams<{ sprintId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [sprint, setSprint] = useState<Sprint | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [cards, setCards] = useState<CardType[]>([]);
  const [users, setUsers] = useState<UserType[]>([]);
  const [loading, setLoading] = useState(true);

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
  const [cardDialogOpen, setCardDialogOpen] = useState(false);
  const [logsModalOpen, setLogsModalOpen] = useState(false);
  const [logsRefreshTrigger, setLogsRefreshTrigger] = useState(0);
  const [editingCard, setEditingCard] = useState<CardType | null>(null);
  const [cardFormLoading, setCardFormLoading] = useState(false);
  const [cardFormError, setCardFormError] = useState('');
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
    data_fim: '',
  });

  const canCreate = user?.role === 'supervisor' || user?.role === 'admin';
  const canFinalizar = user?.role === 'supervisor' || user?.role === 'admin';
  const canCreateCard = true;

  useEffect(() => {
    if (sprintId) {
      loadData();
    }
  }, [sprintId]);

  const loadData = async () => {
    if (!sprintId) return;
    setLoading(true);
    try {
      const [sprintData, projectsData, cardsData, usersData, allSprintsData] = await Promise.all([
        sprintService.getById(sprintId),
        projectService.getAll(),
        cardService.getAll(),
        userService.getAll(),
        sprintService.getAll(), // Para encontrar próxima sprint
      ]);

      // Filtrar projetos da sprint - garantir comparação correta de IDs (string)
      const sprintProjects = projectsData.filter(p => {
        const projectSprintId = String(p.sprint || '');
        const targetSprintId = String(sprintId || sprintData.id || '');
        return projectSprintId === targetSprintId;
      });
      setSprint(sprintData);
      setProjects(sprintProjects);
      setCards(cardsData);
      setUsers(usersData);

      // Initialize sprint form data if editing
      setSprintFormData({
        nome: sprintData.nome,
        data_inicio: sprintData.data_inicio,
        data_fim: sprintData.data_fim,
      });

      // Verificar se sprint está finalizada e mover cards pendentes
      if (isSprintFinished(sprintData)) {
        await movePendingCardsToNextSprint(sprintData, sprintProjects, cardsData, allSprintsData);
      }

    } catch (error) {
      console.error('Erro ao carregar dados da sprint:', error);
      setSprint(null);
    } finally {
      setLoading(false);
    }
  };

  const movePendingCardsToNextSprint = async (
    finishedSprint: Sprint,
    sprintProjects: Project[],
    allCards: CardType[],
    allSprints: Sprint[]
  ) => {
    // Identificar cards pendentes (não finalizados e não inviabilizados)
    const pendingStatuses = ['a_desenvolver', 'em_desenvolvimento', 'parado_pendencias', 'em_homologacao'];
    const sprintCards = allCards.filter(c => sprintProjects.some(p => p.id === c.projeto));
    const pendingCards = sprintCards.filter(c => pendingStatuses.includes(c.status));

    // Separar cards que devem ser copiados (em_desenvolvimento, em_homologacao, a_desenvolver) 
    // dos que devem ser movidos (parado_pendencias)
    const statusParaCopiar = ['em_desenvolvimento', 'em_homologacao', 'a_desenvolver'];
    const cardsParaCopiar = sprintCards.filter(c => statusParaCopiar.includes(c.status));
    const cardsParaMover = sprintCards.filter(c => c.status === 'parado_pendencias');
    
    // Verificar se há cards em andamento (para criar sprint começando hoje se necessário)
    const cardsEmAndamento = sprintCards.filter(c => c.status === 'em_desenvolvimento');

    if (pendingCards.length === 0) {
      return; // Não há cards pendentes
    }

    // Encontrar próxima sprint (primeira sprint que começa após a data_fim da sprint finalizada)
    const finishedSprintEndDate = new Date(finishedSprint.data_fim);
    const nextSprint = allSprints
      .filter(s => {
        const sprintStartDate = new Date(s.data_inicio);
        return sprintStartDate > finishedSprintEndDate;
      })
      .sort((a, b) => new Date(a.data_inicio).getTime() - new Date(b.data_inicio).getTime())[0];

    let targetSprintId: string;

    if (nextSprint) {
      targetSprintId = nextSprint.id;
    } else {
      // Verificar se há cards em andamento
      const hasCardsEmAndamento = cardsEmAndamento.length > 0;
      
      if (hasCardsEmAndamento) {
        // Se há cards em andamento e não há próxima sprint planejada, criar nova sprint começando hoje
        const today = new Date();
        const sprintStart = new Date(today);
        sprintStart.setHours(0, 0, 0, 0); // Começar hoje
        const sprintEnd = new Date(sprintStart);
        sprintEnd.setDate(sprintStart.getDate() + 15); // 15 dias de duração

        try {
          const newSprint = await sprintService.create({
            nome: `Sprint ${allSprints.length + 1} - ${sprintStart.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}`,
            data_inicio: sprintStart.toISOString().split('T')[0],
            data_fim: sprintEnd.toISOString().split('T')[0],
            duracao_dias: 15,
            supervisor: user!.id.toString(),
          });
          targetSprintId = newSprint.id;
        } catch (error) {
          console.error('Erro ao criar próxima sprint:', error);
          return;
        }
      } else {
        // Se não há cards em andamento, criar sprint começando na próxima segunda-feira (comportamento padrão)
        const today = new Date();
        const nextWeekStart = new Date(today);
        nextWeekStart.setDate(today.getDate() + (7 - today.getDay())); // Próxima segunda-feira
        const nextWeekEnd = new Date(nextWeekStart);
        nextWeekEnd.setDate(nextWeekStart.getDate() + 13); // 2 semanas

        try {
          const newSprint = await sprintService.create({
            nome: `Sprint ${allSprints.length + 1} - ${nextWeekStart.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}`,
            data_inicio: nextWeekStart.toISOString().split('T')[0],
            data_fim: nextWeekEnd.toISOString().split('T')[0],
            duracao_dias: 14,
            supervisor: user!.id.toString(),
          });
          targetSprintId = newSprint.id;
        } catch (error) {
          console.error('Erro ao criar próxima sprint:', error);
          return;
        }
      }
    }

    try {
      // 1. Processar cards que devem ser COPIADOS (em_desenvolvimento, em_homologacao, a_desenvolver)
      if (cardsParaCopiar.length > 0) {
        // Agrupar cards por projeto
        const cardsPorProjeto = new Map<string, CardType[]>();
        cardsParaCopiar.forEach(card => {
          const projetoId = card.projeto;
          if (!cardsPorProjeto.has(projetoId)) {
            cardsPorProjeto.set(projetoId, []);
          }
          cardsPorProjeto.get(projetoId)!.push(card);
        });

        // Para cada projeto com cards para copiar, copiar projeto e cards
        for (const [projetoId, cards] of cardsPorProjeto.entries()) {
          const projetoOriginal = sprintProjects.find(p => p.id === projetoId);
          if (!projetoOriginal) continue;

          // Criar cópia do projeto na nova sprint
          const projetoCopiado = await projectService.create({
            nome: projetoOriginal.nome,
            descricao: projetoOriginal.descricao || undefined,
            sprint: targetSprintId,
          });

          // Copiar cada card para o projeto copiado, mantendo o status original
          for (const card of cards) {
            const newCard = await cardService.create({
              nome: card.nome,
              descricao: card.descricao || '',
              script_url: card.script_url || null,
              projeto: projetoCopiado.id,
              area: card.area,
              tipo: card.tipo,
              prioridade: card.prioridade,
              status: card.status, // Manter o status original do card
              responsavel: card.responsavel || null,
              data_inicio: card.data_inicio || null,
              data_fim: card.data_fim || null,
            });
            // Log de criação é criado automaticamente pelo backend
            // Atualizar trigger para recarregar logs em tempo real
            setLogsRefreshTrigger(prev => prev + 1);
          }
        }
      }

      // 2. Processar cards que devem ser MOVIDOS (parado_pendencias)
      if (cardsParaMover.length > 0) {
        // Encontrar projetos com cards para mover (que não têm cards para copiar)
        const projectsWithCardsToMove = sprintProjects.filter(p => {
          const temCardsParaCopiar = cardsParaCopiar.some(c => c.projeto === p.id);
          const temCardsParaMover = cardsParaMover.some(c => c.projeto === p.id);
          return !temCardsParaCopiar && temCardsParaMover;
        });

        if (projectsWithCardsToMove.length > 0) {
          // Mover projetos para a próxima sprint
          await Promise.all(
            projectsWithCardsToMove.map(project =>
              projectService.update(project.id, { sprint: targetSprintId })
            )
          );
        }
      }

      // Recarregar dados após processar
      const [updatedProjectsData] = await Promise.all([
        projectService.getAll(),
      ]);
      setProjects(updatedProjectsData.filter(p => p.sprint === sprintId));
    } catch (error) {
      console.error('Erro ao processar cards pendentes:', error);
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
  const openCreateCardDialog = (projectId: string) => {
    const project = projects.find(p => p.id === projectId);
    if (project && isProjectFromFinishedSprint(project)) {
      setAlertMessage('Não é possível criar cards em projetos de sprints finalizadas.');
      setAlertDialogOpen(true);
      return;
    }
    setEditingCard(null);
    setSelectedProjectForCard(projectId);
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

  const openEditCardDialog = async (e: React.MouseEvent, card: CardType) => {
    e.stopPropagation();
    
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
    setSelectedProjectForCard(fullCard.projeto);
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
    setCardDialogOpen(true);
  };

  // Função auxiliar para obter label do status
  const getStageLabel = (status: string): string => {
    const stage = CARD_STATUSES.find(s => s.value === status);
    return stage?.label || status;
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
    return ['em_desenvolvimento', 'parado_pendencias', 'em_homologacao', 'finalizado'].includes(stageId);
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
      setCardDialogOpen(false);
      setLogsModalOpen(false); // Fechar modal de logs quando o modal de edição for fechado
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
    if (isSprintFinished(sprint)) {
      setAlertMessage('Sprints finalizadas não podem ser editadas.');
      setAlertDialogOpen(true);
      return;
    }
    // Converter formato YYYY-MM-DD para YYYY-MM-DDTHH:mm (adicionar hora padrão)
    const convertToDateTime = (dateString: string): string => {
      if (!dateString) return '';
      // Se já está no formato YYYY-MM-DDTHH:mm, retornar como está
      if (dateString.includes('T')) {
        return dateString;
      }
      // Se está no formato YYYY-MM-DD, adicionar hora padrão (00:00 para início, 18:00 para fim)
      if (/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
        const isStart = dateString === sprint.data_inicio;
        const hours = isStart ? '00' : '18';
        return `${dateString}T${hours}:00`;
      }
      return dateString;
    };
    
    setSprintFormData({
      nome: sprint.nome,
      data_inicio: convertToDateTime(sprint.data_inicio),
      data_fim: convertToDateTime(sprint.data_fim),
    });
    setSprintFormError('');
    setSprintDialogOpen(true);
  };

  const handleSprintSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sprint) return;
    if (isSprintFinished(sprint)) {
      setSprintFormError('Sprints finalizadas não podem ser editadas.');
      return;
    }
    setSprintFormError('');
    setSprintFormLoading(true);

    try {
      // Converter formato YYYY-MM-DDTHH:mm para YYYY-MM-DD (apenas data)
      const formatDateForBackend = (dateTimeString: string): string => {
        if (!dateTimeString) return '';
        // Se já está no formato YYYY-MM-DD, retornar como está
        if (/^\d{4}-\d{2}-\d{2}$/.test(dateTimeString)) {
          return dateTimeString;
        }
        // Se está no formato YYYY-MM-DDTHH:mm, extrair apenas a data
        const [datePart] = dateTimeString.split('T');
        return datePart || dateTimeString;
      };

      const dataInicio = formatDateForBackend(sprintFormData.data_inicio);
      const dataFim = formatDateForBackend(sprintFormData.data_fim);

      if (!dataInicio || !dataFim) {
        setSprintFormError('Por favor, preencha as datas de início e fim.');
        setSprintFormLoading(false);
        return;
      }

      const duracao_dias = calcularDiasTotais(dataInicio, dataFim);
      
      await sprintService.update(sprint.id, {
        ...sprintFormData,
        data_inicio: dataInicio,
        data_fim: dataFim,
        duracao_dias,
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
      navigate('/sprints');
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
    const today = new Date();
    const start = new Date(sprint.data_inicio);
    const end = new Date(sprint.data_fim);

    if (sprint.finalizada) {
      return { label: 'Finalizada', variant: 'success' as const };
    }

    if (today < start) {
      return { label: 'Futura', variant: 'secondary' as const };
    }

    if (today > end) {
      // Data já passou, mas ainda não foi marcada como finalizada no backend
      // Considerar "Em Andamento" até o backend marcar como finalizada
      return { label: 'Em Andamento', variant: 'default' as const };
    }

    return { label: 'Em Andamento', variant: 'default' as const };
  };

  const isSprintFinished = (sprint: Sprint) => {
    // Sprint é considerada finalizada apenas quando o backend marca finalizada=True
    return !!sprint.finalizada;
  };

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

  const renderCard = (card: CardType) => {
    const isFinished = isCardFromFinishedSprint(card);
    const isCardDelivered = card.status === 'finalizado' || card.status === 'inviabilizado';
    // Permitir clique para visualização sempre (mesmo se sprint finalizada ou card finalizado)
    const canClick = true;
    
    return (
      <div
        key={card.id}
        className={`p-[12px] bg-[var(--color-card)] rounded-[8px] border-l-[3px] shadow-sm hover:shadow-md transition-shadow cursor-pointer ${isCardDelivered ? 'opacity-70' : ''} ${isFinished ? 'opacity-60' : ''} group ${getPriorityColor(card.prioridade)}`}
        onClick={(e) => openEditCardDialog(e, card)}
      >
        <div className="flex items-start justify-between gap-[8px]">
          <div className="flex items-center gap-[8px] flex-1 min-w-0">
            {getCardStatusIcon(card.status)}
            <span className="font-medium text-sm text-[var(--color-foreground)] truncate">
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
                  openEditCardDialog(e, card);
                }}
                className="h-[24px] w-[24px]"
              >
                <Pencil className="h-[12px] w-[12px]" />
              </Button>
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
        <div className="flex items-center gap-[8px] flex-wrap">
          {card.responsavel_name && (
            <div className="flex items-center gap-[4px] text-xs text-[var(--color-muted-foreground)]">
              <User className="h-[12px] w-[12px]" />
              {card.responsavel_name}
            </div>
          )}
          {card.data_fim && (
            <div className="flex items-center gap-[4px] text-xs text-[var(--color-muted-foreground)]">
              <Calendar className="h-[12px] w-[12px]" />
              {formatDateTime(card.data_fim)}
            </div>
          )}
          {isCardAtrasado(card) && (
            <Badge variant="destructive" className="text-[10px] px-[6px] py-0">
              Atrasado
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-[8px]">
          {card.prioridade_display && (
            <Badge variant="secondary" className="text-[10px] px-[6px] py-0">
              {card.prioridade_display}
            </Badge>
          )}
        </div>
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
                {formatDate(sprint.data_inicio)} → {formatDate(sprint.data_fim)}
              </span>
              <span className="flex items-center gap-[4px]">
                <Clock className="h-[14px] w-[14px]" />
                {calcularDiasTotais(sprint.data_inicio, sprint.data_fim)} dias ({calcularDiasUteis(sprint.data_inicio, sprint.data_fim)} úteis)
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
      <div className="space-y-[16px] mb-[24px] flex-shrink-0">
        <div className="flex flex-col lg:flex-row gap-[16px]">
          {/* Search Bar */}
          <div className="relative flex-1">
            <Search className="absolute left-[12px] top-1/2 -translate-y-1/2 h-[18px] w-[18px] text-[var(--color-muted-foreground)]" />
            <Input
              type="text"
              placeholder="Pesquisar cards por nome, descrição, responsável, área, tipo ou projeto..."
              value={cardSearchQuery}
              onChange={(e) => setCardSearchQuery(e.target.value)}
              className="pl-[40px]"
            />
          </div>
          {/* Status Filter */}
          <div className="flex-1 lg:flex-initial lg:w-[200px]">
            <select
              className="flex h-[40px] w-full rounded-[8px] border border-[var(--color-input)] bg-[var(--color-background)] px-[12px] py-[8px] text-sm ring-offset-[var(--color-background)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] focus-visible:ring-offset-2"
              value={projectStatusFilter}
              onChange={(e) => setProjectStatusFilter(e.target.value)}
            >
              <option value="">Todos os status</option>
              {CARD_STATUSES.map((status) => (
                <option key={status.value} value={status.value}>
                  {status.label}
                </option>
              ))}
            </select>
          </div>
          {/* Developer Filter */}
          <div className="flex-1 lg:flex-initial lg:w-[220px]">
            <UserSelect
              users={users.filter((u) => u.role === 'desenvolvedor' || u.role === 'gerente')}
              value={projectDeveloperFilter}
              onChange={setProjectDeveloperFilter}
              placeholder="Todos os desenvolvedores"
            />
          </div>
          {/* Filter Toggle */}
          <Button
            variant={showCardFilters ? "default" : "outline"}
            onClick={() => setShowCardFilters(!showCardFilters)}
            className="flex items-center gap-[8px] lg:flex-shrink-0"
          >
            <SlidersHorizontal className="h-[16px] w-[16px]" />
            Filtros
          </Button>
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
                // Ocultar projeto especial "Sugestões" do Kanban da sprint
                if (project.nome === 'Sugestões') return false;

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
              
              // Separar cards por status - sempre executar, mesmo sem cards
              // Usar projectCards (todos os cards do projeto) ao invés de filteredCards para garantir que todos sejam exibidos
              // A filtragem será aplicada apenas na busca, mas todos os cards devem aparecer nas seções corretas
              const cardsEmHomologacao = filteredCards.filter(
                (card) => card.status === 'em_homologacao'
              );
              const cardsEmDesenvolvimento = filteredCards.filter(
                (card) => card.status === 'em_desenvolvimento'
              );
              const cardsADesenvolver = filteredCards.filter(
                (card) => card.status === 'a_desenvolver'
              );
              const cardsParadoPendencias = filteredCards.filter(
                (card) => card.status === 'parado_pendencias'
              );
              const cardsFinalizado = filteredCards.filter(
                (card) => card.status === 'finalizado'
              );
              const cardsInviabilizado = filteredCards.filter(
                (card) => card.status === 'inviabilizado'
              );
              const outrosCards = filteredCards.filter(
                (card) => 
                  card.status !== 'em_homologacao' && 
                  card.status !== 'em_desenvolvimento' && 
                  card.status !== 'a_desenvolver' &&
                  card.status !== 'parado_pendencias' &&
                  card.status !== 'finalizado' &&
                  card.status !== 'inviabilizado'
              );

              return (
                <div
                  key={project.id}
                  className="flex-shrink-0 w-[320px] bg-[var(--color-muted)]/30 rounded-[12px] border border-[var(--color-border)] flex flex-col h-full"
                >
                  {/* Header da Coluna (Projeto) */}
                  <div 
                    className="p-[16px] border-b border-[var(--color-border)] cursor-pointer hover:bg-[var(--color-muted)]/50 transition-colors"
                    onClick={() => navigate(`/projects/${project.id}`)}
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
                    {/* Seção: Em Homologação - Sempre visível */}
                    <div className="space-y-[8px]">
                      <h4 className="text-xs font-semibold text-[var(--color-muted-foreground)] uppercase tracking-wide px-[4px]">
                        Em Homologação
                      </h4>
                      <div className="space-y-[8px]">
                        {cardsEmHomologacao.length > 0 ? (
                          cardsEmHomologacao.map(renderCard)
                        ) : (
                          <div className="text-center py-[16px] text-xs text-[var(--color-muted-foreground)]">
                            Nenhum card
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Seção: Em Desenvolvimento - Sempre visível */}
                    <div className="space-y-[8px]">
                      <h4 className="text-xs font-semibold text-[var(--color-muted-foreground)] uppercase tracking-wide px-[4px]">
                        Em Desenvolvimento
                      </h4>
                      <div className="space-y-[8px]">
                        {cardsEmDesenvolvimento.length > 0 ? (
                          cardsEmDesenvolvimento.map(renderCard)
                        ) : (
                          <div className="text-center py-[16px] text-xs text-[var(--color-muted-foreground)]">
                            Nenhum card
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Seção: A Desenvolver - Sempre visível */}
                    <div className="space-y-[8px]">
                      <h4 className="text-xs font-semibold text-[var(--color-muted-foreground)] uppercase tracking-wide px-[4px]">
                        A Desenvolver
                      </h4>
                      <div className="space-y-[8px]">
                        {cardsADesenvolver.length > 0 ? (
                          cardsADesenvolver.map(renderCard)
                        ) : (
                          <div className="text-center py-[16px] text-xs text-[var(--color-muted-foreground)]">
                            Nenhum card
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Outros cards (se houver) */}
                    {outrosCards.length > 0 && (
                      <div className="space-y-[8px]">
                        <h4 className="text-xs font-semibold text-[var(--color-muted-foreground)] uppercase tracking-wide px-[4px]">
                          Outros
                        </h4>
                        <div className="space-y-[8px]">
                          {outrosCards.map(renderCard)}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Sprint Dialog */}
      <Dialog open={sprintDialogOpen} onOpenChange={setSprintDialogOpen}>
        <DialogContent onClose={() => setSprintDialogOpen(false)}>
          <DialogHeader>
            <DialogTitle>Editar Sprint</DialogTitle>
            <DialogDescription>
              Atualize as informações da sprint.
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
              <Label>Período da Sprint</Label>
              <DateRangePicker
                startValue={sprintFormData.data_inicio}
                endValue={sprintFormData.data_fim}
                onStartChange={(e) => {
                  setSprintFormData(prev => ({ ...prev, data_inicio: e.target.value }));
                  // Limpar erro quando a data de início for preenchida
                  if (e.target.value && sprintFormError === 'Por favor, preencha as datas de início e fim.') {
                    setSprintFormError('');
                  }
                }}
                onEndChange={(e) => {
                  setSprintFormData(prev => ({ ...prev, data_fim: e.target.value }));
                  // Limpar erro quando a data de fim for preenchida
                  if (e.target.value && sprintFormError === 'Por favor, preencha as datas de início e fim.') {
                    setSprintFormError('');
                  }
                }}
                required
              />
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
      <Dialog open={cardDialogOpen} onOpenChange={(open) => {
        setCardDialogOpen(open);
        if (!open) {
          setLogsModalOpen(false); // Fechar modal de logs quando o modal de edição for fechado
        }
      }}>
        <DialogContent onClose={() => {
          setCardDialogOpen(false);
          setLogsModalOpen(false); // Fechar modal de logs quando o modal de edição for fechado
        }} className="max-w-[600px]">
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

            <div className="space-y-[8px]">
              <Label htmlFor="card-script_url">Link do Script</Label>
              <Input
                id="card-script_url"
                type="url"
                placeholder="https://exemplo.com/script..."
                value={cardFormData.script_url}
                onChange={(e) => setCardFormData({ ...cardFormData, script_url: e.target.value })}
                disabled={!!(editingCard && (editingCard.status === 'finalizado' || editingCard.status === 'inviabilizado'))}
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
                  {CARD_STATUSES.map((status) => (
                    <option key={status.value} value={status.value}>{status.label}</option>
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

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => {
                setCardDialogOpen(false);
                setLogsModalOpen(false); // Fechar modal de logs quando o modal de edição for fechado
              }}>
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

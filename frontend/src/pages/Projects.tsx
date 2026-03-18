import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { projectService, type Project } from '@/services/projectService';
import { cardService, CARD_AREAS, CARD_TYPES, CARD_PRIORITIES, CARD_STATUSES, type Card as CardType } from '@/services/cardService';
import { sprintService, type Sprint } from '@/services/sprintService';
import { userService, type User } from '@/services/userService';
import { formatDate } from '@/lib/dateUtils';
import { Plus, FolderKanban, Calendar, User as UserIcon, CheckCircle2, Clock, XCircle, AlertCircle, Eye, Loader2, Pencil, Trash2 } from 'lucide-react';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { RequestDueDateChangeModal } from '@/components/RequestDueDateChangeModal';
import { cardDateChangeRequestService, type CardDueDateChangeRequest } from '@/services/cardDateChangeRequestService';

export default function Projects() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [cards, setCards] = useState<CardType[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Estados para formulário de sugestão
  const [suggestionDialogOpen, setSuggestionDialogOpen] = useState(false);
  const [suggestionFormData, setSuggestionFormData] = useState({
    nome: '',
    descricao: '',
    script_url: '',
    area: 'backend',
    tipo: 'feature',
    prioridade: 'media',
  });
  const [suggestionFormLoading, setSuggestionFormLoading] = useState(false);
  const [suggestionFormError, setSuggestionFormError] = useState('');
  
  // Estados para visualização de demanda
  const [demandViewDialogOpen, setDemandViewDialogOpen] = useState(false);
  const [selectedDemand, setSelectedDemand] = useState<CardType | null>(null);
  
  // Estados para edição de demanda
  const [editingDemand, setEditingDemand] = useState<CardType | null>(null);
  const [editDemandDialogOpen, setEditDemandDialogOpen] = useState(false);
  const [editDemandFormData, setEditDemandFormData] = useState({
    nome: '',
    descricao: '',
    script_url: '',
    area: 'backend',
    tipo: 'feature',
    prioridade: 'media',
  });
  const [editDemandFormLoading, setEditDemandFormLoading] = useState(false);
  const [editDemandFormError, setEditDemandFormError] = useState('');
  
  // Estados para avaliação de sugestão
  const [evaluationDialogOpen, setEvaluationDialogOpen] = useState(false);
  const [selectedCard, setSelectedCard] = useState<any>(null);
  const [evaluationFormData, setEvaluationFormData] = useState({
    sprint: '',
    projeto: '',
  });
  const [evaluationFormLoading, setEvaluationFormLoading] = useState(false);
  const [evaluationFormError, setEvaluationFormError] = useState('');
  
  // Estados para criação de projeto
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  
  // Delete/Alert dialogs
  const [discardDialogOpen, setDiscardDialogOpen] = useState(false);
  const [demandToDiscard, setDemandToDiscard] = useState<any>(null);
  const [discardLoading, setDiscardLoading] = useState(false);
  const [createDemandChoiceOpen, setCreateDemandChoiceOpen] = useState(false);
  const [dateChangeRequestModalOpen, setDateChangeRequestModalOpen] = useState(false);
  const [pendingTab, setPendingTab] = useState<'demandas' | 'datas'>('demandas');
  const [dateChangeRequests, setDateChangeRequests] = useState<CardDueDateChangeRequest[]>([]);
  const [loadingDateChangeRequests, setLoadingDateChangeRequests] = useState(false);

  // Regra diferente para "demandas" vs "solicitações de reajuste de data".
  // Demandas: somente supervisor/admin.
  // Solicitação de data: somente supervisor/admin.
  const canEvaluateDemands = user?.role === 'supervisor' || user?.role === 'admin';
  const canEvaluateDateRequests = user?.role === 'supervisor' || user?.role === 'admin';

  // As duas tabs (Demandas e Solicitações de data) devem aparecer para todos.
  // Apenas aprovar/recusar continua restrito.
  
  const [alertDialogOpen, setAlertDialogOpen] = useState(false);
  const [alertMessage, setAlertMessage] = useState('');
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [projectFormData, setProjectFormData] = useState({
    nome: '',
    descricao: '',
    sprint: '',
  });
  const [projectFormLoading, setProjectFormLoading] = useState(false);
  const [projectFormError, setProjectFormError] = useState('');
  
  // Estados para paginação infinita de cada subseção
  const [projetosEmSprintPage, setProjetosEmSprintPage] = useState(1);
  const [projetosEmPlanejamentoPage, setProjetosEmPlanejamentoPage] = useState(1);
  const [projetosConcluidosPage, setProjetosConcluidosPage] = useState(1);
  const itemsPerPage = 50;
  
  // Refs para os elementos de scroll infinito
  const sprintScrollRef = useRef<HTMLDivElement>(null);
  const planejamentoScrollRef = useRef<HTMLDivElement>(null);
  const concluidosScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [projectsData, sprintsData, cardsData, usersData] = await Promise.all([
        projectService.getAll(),
        sprintService.getAll(),
        cardService.getAllWithSuggestions(),
        userService.getAll(),
      ]);
      // Garantir que os dados são arrays
      setProjects(Array.isArray(projectsData) ? projectsData : []);
      setSprints(Array.isArray(sprintsData) ? sprintsData : []);
      setCards(Array.isArray(cardsData) ? cardsData : []);
      setUsers(Array.isArray(usersData) ? usersData : []);
      // Carregar solicitações pendentes para exibir a lista a todos os usuários.
      // Aprovar/Recusar continua restrito no front (e no backend).
      setLoadingDateChangeRequests(true);
      try {
        const reqs = await cardDateChangeRequestService.list({ status: 'pending' });
        setDateChangeRequests(Array.isArray(reqs) ? reqs : []);
      } catch {
        setDateChangeRequests([]);
      } finally {
        setLoadingDateChangeRequests(false);
      }
      
    } catch (error) {
      console.error('Erro ao carregar dados:', error);
    } finally {
      setLoading(false);
    }
  };

  const openSuggestionDialog = () => {
    setSuggestionFormData({
      nome: '',
      descricao: '',
      script_url: '',
      area: 'backend',
      tipo: 'feature',
      prioridade: 'media',
    });
    setSuggestionFormError('');
    setSuggestionDialogOpen(true);
  };

  const openCreateDemandChoice = () => {
    setCreateDemandChoiceOpen(true);
  };

  const handleApproveDateChange = async (id: number) => {
    try {
      await cardDateChangeRequestService.approve(id);
      // Recarregar lista
      const reqs = await cardDateChangeRequestService.list({ status: 'pending' });
      setDateChangeRequests(Array.isArray(reqs) ? reqs : []);
      // Recarregar cards/projetos para refletir nova data no resto do sistema
      loadData();
    } catch (e) {
      setAlertMessage('Erro ao aprovar solicitação.');
      setAlertDialogOpen(true);
    }
  };

  const handleRejectDateChange = async (id: number) => {
    try {
      await cardDateChangeRequestService.reject(id);
      const reqs = await cardDateChangeRequestService.list({ status: 'pending' });
      setDateChangeRequests(Array.isArray(reqs) ? reqs : []);
    } catch (e) {
      setAlertMessage('Erro ao recusar solicitação.');
      setAlertDialogOpen(true);
    }
  };

  const openCreateProjectDialog = () => {
    setEditingProject(null);
    setProjectFormData({
      nome: '',
      descricao: '',
      sprint: '',
    });
    setProjectFormError('');
    setProjectDialogOpen(true);
  };

  const handleProjectSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setProjectFormError('');
    
    if (!projectFormData.nome.trim()) {
      setProjectFormError('O nome do projeto é obrigatório.');
      return;
    }
    
    if (!projectFormData.sprint) {
      setProjectFormError('A sprint é obrigatória.');
      return;
    }
    
    setProjectFormLoading(true);

    try {
      if (editingProject) {
        await projectService.update(editingProject.id, projectFormData);
      } else {
        await projectService.create(projectFormData);
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
        } else if (errorData.nome) {
          errorMessage = Array.isArray(errorData.nome) ? errorData.nome[0] : errorData.nome;
        } else if (errorData.sprint) {
          errorMessage = Array.isArray(errorData.sprint) ? errorData.sprint[0] : errorData.sprint;
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

  const handleSuggestionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSuggestionFormError('');
    setSuggestionFormLoading(true);

    try {
      // Buscar projeto "Sugestões" (independente de ter sprint ou não)
      let sugestoesProject = projects.find(p => p.nome === 'Sugestões');
      
      if (!sugestoesProject) {
        // Se não existe, criar projeto "Sugestões"
        // Precisamos de uma sprint, então vamos usar a primeira sprint disponível
        const firstSprint = sprints[0];
        if (!firstSprint) {
          setSuggestionFormError('É necessário ter pelo menos uma sprint cadastrada.');
          setSuggestionFormLoading(false);
          return;
        }
        
        sugestoesProject = await projectService.create({
          nome: 'Sugestões',
          descricao: 'Projeto para armazenar sugestões de novos projetos',
          sprint: firstSprint.id,
        });
        // Recarregar dados para garantir que temos o projeto atualizado
        await loadData();
        // Buscar novamente após recarregar
        const updatedProjects = await projectService.getAll();
        sugestoesProject = updatedProjects.find(p => p.nome === 'Sugestões');
        if (!sugestoesProject) {
          setSuggestionFormError('Erro ao criar projeto Sugestões.');
          setSuggestionFormLoading(false);
          return;
        }
      }

      // Criar card no projeto "Sugestões" com status "a_desenvolver"
      const newCard = await cardService.create({
        nome: suggestionFormData.nome,
        descricao: suggestionFormData.descricao || '',
        script_url: suggestionFormData.script_url || null,
        projeto: sugestoesProject.id,
        area: suggestionFormData.area,
        tipo: suggestionFormData.tipo,
        prioridade: suggestionFormData.prioridade,
        status: 'a_desenvolver',
      });
      
      // Recarregar o card completo para garantir que temos o criado_por
      const fullCard = await cardService.getById(newCard.id);

      // Adicionar o novo card localmente sem recarregar tudo
      setCards((prevCards) => [...prevCards, fullCard]);

      setSuggestionDialogOpen(false);
    } catch (err: any) {
      const errorData = err.response?.data;
      let errorMessage = 'Erro ao criar sugestão';
      if (errorData) {
        if (typeof errorData === 'string') {
          errorMessage = errorData;
        } else if (errorData.message) {
          errorMessage = errorData.message;
        } else if (errorData.detail) {
          errorMessage = errorData.detail;
        } else if (errorData.nome) {
          errorMessage = Array.isArray(errorData.nome) ? errorData.nome[0] : errorData.nome;
        } else {
          const firstError = Object.values(errorData)[0];
          if (Array.isArray(firstError)) {
            errorMessage = firstError[0] as string;
          }
        }
      }
      setSuggestionFormError(errorMessage);
    } finally {
      setSuggestionFormLoading(false);
    }
  };

  const openDemandViewDialog = (card: CardType) => {
    setSelectedDemand(card);
    setDemandViewDialogOpen(true);
  };

  const openEditDemandDialog = (card: CardType) => {
    setEditingDemand(card);
    setEditDemandFormData({
      nome: card.nome,
      descricao: card.descricao || '',
      script_url: card.script_url || '',
      area: card.area,
      tipo: card.tipo,
      prioridade: card.prioridade,
    });
    setEditDemandFormError('');
    setEditDemandDialogOpen(true);
    setDemandViewDialogOpen(false);
  };

  const handleEditDemandSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingDemand) return;
    
    setEditDemandFormError('');
    setEditDemandFormLoading(true);

    try {
      const updatedCard = await cardService.update(editingDemand.id, {
        nome: editDemandFormData.nome,
        descricao: editDemandFormData.descricao || '',
        script_url: editDemandFormData.script_url || null,
        area: editDemandFormData.area,
        tipo: editDemandFormData.tipo,
        prioridade: editDemandFormData.prioridade,
      });

      // Atualizar o card localmente sem recarregar tudo
      setCards((prevCards) =>
        prevCards.map((card) => (card.id === editingDemand.id ? updatedCard : card))
      );

      setEditDemandDialogOpen(false);
      setEditingDemand(null);
    } catch (err: any) {
      const errorData = err.response?.data;
      let errorMessage = 'Erro ao atualizar demanda';
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
      setEditDemandFormError(errorMessage);
    } finally {
      setEditDemandFormLoading(false);
    }
  };

  const openEvaluationDialog = (card: CardType) => {
    setSelectedCard(card);
    setEvaluationFormData({
      sprint: '',
      projeto: '',
    });
    setEvaluationFormError('');
    setEvaluationDialogOpen(true);
    setDemandViewDialogOpen(false);
  };

  const confirmDiscardDemand = async () => {
    if (!demandToDiscard) return;
    await handleDiscardDemand(demandToDiscard);
    setDiscardDialogOpen(false);
    setDemandToDiscard(null);
  };

  const handleDiscardDemand = async (card: CardType) => {
    setDiscardLoading(true);
    try {
      // Se o usuário for o criador da demanda, deletar diretamente
      if (card.criado_por && String(card.criado_por) === String(user?.id)) {
        await cardService.delete(card.id);
        // Remover o card localmente sem recarregar tudo
        setCards((prevCards) => prevCards.filter((c) => c.id !== card.id));
        setDemandViewDialogOpen(false);
        setAlertMessage('Demanda deletada com sucesso.');
        setAlertDialogOpen(true);
        return;
      }
      
      // Se não for o criador (supervisor/admin), mover para "Projetos Descartados"
      // Buscar ou criar projeto "Projetos Descartados"
      let descartadosProject = projects.find(p => p.nome === 'Projetos Descartados');
      
      if (!descartadosProject) {
        // Criar projeto "Projetos Descartados" se não existir
        // Precisamos de uma sprint, então vamos usar a primeira sprint disponível
        const firstSprint = sprints[0];
        if (!firstSprint) {
          setAlertMessage('É necessário ter pelo menos uma sprint cadastrada.');
          setAlertDialogOpen(true);
          return;
        }
        
        descartadosProject = await projectService.create({
          nome: 'Projetos Descartados',
          descricao: 'Projetos e demandas descartadas',
          sprint: firstSprint.id,
        });
        
        // Recarregar dados para garantir que temos o projeto atualizado
        await loadData();
        // Buscar novamente após recarregar
        const updatedProjects = await projectService.getAll();
        descartadosProject = updatedProjects.find(p => p.nome === 'Projetos Descartados');
        
        if (!descartadosProject) {
          setAlertMessage('Erro ao criar projeto Projetos Descartados.');
          setAlertDialogOpen(true);
          return;
        }
      }

      // Mover o card para o projeto "Projetos Descartados"
      const updatedCard = await cardService.update(card.id, {
        projeto: descartadosProject.id,
        status: 'a_desenvolver', // Manter status, mas em projeto descartado
      });

      // Atualizar o card localmente sem recarregar tudo
      setCards((prevCards) =>
        prevCards.map((c) => (c.id === card.id ? updatedCard : c))
      );

      setDemandViewDialogOpen(false);
    } catch (err: any) {
      const errorData = err.response?.data;
      let errorMessage = 'Erro ao descartar demanda';
      if (errorData) {
        if (typeof errorData === 'string') {
          errorMessage = errorData;
        } else if (errorData.message) {
          errorMessage = errorData.message;
        } else if (errorData.detail) {
          errorMessage = errorData.detail;
        }
      }
      setAlertMessage(errorMessage);
      setAlertDialogOpen(true);
    } finally {
      setDiscardLoading(false);
    }
  };

  const handleEvaluationSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCard) return;
    
    setEvaluationFormError('');
    
    if (!evaluationFormData.sprint || !evaluationFormData.projeto) {
      setEvaluationFormError('Selecione uma sprint e um projeto.');
      return;
    }

    setEvaluationFormLoading(true);

    try {
      // Atualizar o card para o novo projeto e mudar status para "a_desenvolver"
      await cardService.update(selectedCard.id, {
        projeto: evaluationFormData.projeto,
        status: 'a_desenvolver',
      });

      setEvaluationDialogOpen(false);
      loadData();
    } catch (err: any) {
      const errorData = err.response?.data;
      let errorMessage = 'Erro ao avaliar sugestão';
      if (errorData) {
        if (typeof errorData === 'string') {
          errorMessage = errorData;
        } else if (errorData.message) {
          errorMessage = errorData.message;
        } else if (errorData.detail) {
          errorMessage = errorData.detail;
        }
      }
      setEvaluationFormError(errorMessage);
    } finally {
      setEvaluationFormLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'criado':
        return 'bg-blue-100 text-blue-800';
      case 'em_avaliacao':
        return 'bg-yellow-100 text-yellow-800';
      case 'aprovado':
        return 'bg-green-100 text-green-800';
      case 'em_desenvolvimento':
        return 'bg-purple-100 text-purple-800';
      case 'entregue':
        return 'bg-gray-100 text-gray-800';
      case 'homologado':
        return 'bg-emerald-100 text-emerald-800';
      case 'adiado':
        return 'bg-orange-100 text-orange-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'criado':
        return <FolderKanban className="h-4 w-4" />;
      case 'em_avaliacao':
        return <AlertCircle className="h-4 w-4" />;
      case 'aprovado':
        return <CheckCircle2 className="h-4 w-4" />;
      case 'em_desenvolvimento':
        return <Clock className="h-4 w-4" />;
      case 'entregue':
        return <CheckCircle2 className="h-4 w-4" />;
      case 'homologado':
        return <CheckCircle2 className="h-4 w-4" />;
      case 'adiado':
        return <XCircle className="h-4 w-4" />;
      default:
        return <FolderKanban className="h-4 w-4" />;
    }
  };

  // Filtrar projetos que são sugestões (projeto "Sugestões")
  const sugestoesProject = projects.find(p => p.nome === 'Sugestões');
  const sugestoesCards = sugestoesProject 
    ? cards.filter(c => String(c.projeto || '') === String(sugestoesProject.id || '') && c.status === 'a_desenvolver')
    : [];
  
  // Filtrar projetos normais (excluindo "Sugestões" e "Projetos Descartados")
  const projetosNormais = projects.filter(p => p.nome !== 'Sugestões' && p.nome !== 'Projetos Descartados');
  
  // Projetos descartados (projeto especial "Projetos Descartados")
  const projetosDescartadosProject = projects.find(p => p.nome === 'Projetos Descartados');
  const projetosDescartados = projetosDescartadosProject ? [projetosDescartadosProject] : [];
  
  // Categorizar projetos
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  
  const projetosConcluidos = projetosNormais.filter((project) => {
    // Projetos com status "entregue" ou "homologado" são concluídos
    if (project.status === 'entregue' || project.status === 'homologado') {
      return true;
    }
    
    // Projetos que não estão em sprint mas pertenceram a sprints passadas são concluídos
    const projectSprint = sprints.find(s => String(s.id || '') === String(project.sprint || ''));
    if (projectSprint) {
      const sprintFim = new Date(projectSprint.data_fim);
      sprintFim.setHours(0, 0, 0, 0);
      
      // Se a sprint já passou, o projeto é considerado concluído
      if (hoje > sprintFim) {
        return true;
      }
    }
    
    return false;
  });
  
  // Projetos que não estão concluídos
  const projetosNaoConcluidos = projetosNormais.filter((project) => {
    return !projetosConcluidos.some(p => String(p.id || '') === String(project.id || ''));
  });
  
  const projetosEmPlanejamento = projetosNaoConcluidos.filter((project) => {
    const projectSprint = sprints.find(s => String(s.id || '') === String(project.sprint || ''));
    if (!projectSprint) return true; // Sem sprint = em planejamento
    
    const sprintInicio = new Date(projectSprint.data_inicio);
    sprintInicio.setHours(0, 0, 0, 0);
    
    // Se a sprint ainda não começou, está em planejamento
    return hoje < sprintInicio;
  });
  
  const projetosEmSprint = projetosNaoConcluidos.filter((project) => {
    const projectSprint = sprints.find(s => String(s.id || '') === String(project.sprint || ''));
    if (!projectSprint) return false;
    
    const sprintInicio = new Date(projectSprint.data_inicio);
    const sprintFim = new Date(projectSprint.data_fim);
    sprintInicio.setHours(0, 0, 0, 0);
    sprintFim.setHours(0, 0, 0, 0);
    
    // Se está dentro do período da sprint
    return hoje >= sprintInicio && hoje <= sprintFim;
  });

  // Configurar IntersectionObserver para cada subseção (após calcular as variáveis)
  useEffect(() => {
    const observers: IntersectionObserver[] = [];
    
    // Observer para Projetos em Sprint
    if (sprintScrollRef.current && projetosEmSprint.length > projetosEmSprintPage * itemsPerPage) {
      const observer = new IntersectionObserver(
        (entries) => {
          if (entries[0].isIntersecting && projetosEmSprint.length > projetosEmSprintPage * itemsPerPage) {
            setProjetosEmSprintPage(prev => prev + 1);
          }
        },
        { threshold: 0.1 }
      );
      observer.observe(sprintScrollRef.current);
      observers.push(observer);
    }
    
    // Observer para Projetos em Planejamento
    if (planejamentoScrollRef.current && projetosEmPlanejamento.length > projetosEmPlanejamentoPage * itemsPerPage) {
      const observer = new IntersectionObserver(
        (entries) => {
          if (entries[0].isIntersecting && projetosEmPlanejamento.length > projetosEmPlanejamentoPage * itemsPerPage) {
            setProjetosEmPlanejamentoPage(prev => prev + 1);
          }
        },
        { threshold: 0.1 }
      );
      observer.observe(planejamentoScrollRef.current);
      observers.push(observer);
    }
    
    // Observer para Projetos Concluídos
    if (concluidosScrollRef.current && projetosConcluidos.length > projetosConcluidosPage * itemsPerPage) {
      const observer = new IntersectionObserver(
        (entries) => {
          if (entries[0].isIntersecting && projetosConcluidos.length > projetosConcluidosPage * itemsPerPage) {
            setProjetosConcluidosPage(prev => prev + 1);
          }
        },
        { threshold: 0.1 }
      );
      observer.observe(concluidosScrollRef.current);
      observers.push(observer);
    }
    
    return () => {
      observers.forEach(observer => observer.disconnect());
    };
  }, [projetosEmSprint.length, projetosEmPlanejamento.length, projetosConcluidos.length, projetosEmSprintPage, projetosEmPlanejamentoPage, projetosConcluidosPage]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-[var(--color-muted-foreground)]">Carregando projetos...</div>
      </div>
    );
  }

  return (
    <div className="space-y-[16px]">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-foreground)]">Demandas</h1>
          <p className="text-sm text-[var(--color-muted-foreground)] mt-1">
            Todos os projetos cadastrados no sistema
          </p>
        </div>
        <Button onClick={openCreateDemandChoice} className="min-w-[151px]">
          <Plus className="h-4 w-4 mr-2" />
          Criar Demanda
        </Button>
      </div>

      {/* Painel de Pendências (Demandas vs Solicitações) - visível para todos; ações restritas */}
      <Card className="mb-[24px]">
          <Tabs value={pendingTab} onValueChange={(v) => setPendingTab(v as any)}>
            <CardHeader>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <CardTitle>Pendências</CardTitle>
                  <CardDescription>Demandas a avaliar e solicitações de alteração de datas</CardDescription>
                </div>
                <div className="rounded-[12px] border border-[var(--color-border)] bg-transparent p-[6px]">
                  <TabsList className="w-full flex gap-[6px] bg-transparent p-0 h-auto">
                    <TabsTrigger
                      value="demandas"
                      className="flex-1 rounded-[10px] border border-transparent bg-transparent px-3 py-2 text-sm text-[var(--color-muted-foreground)] transition-colors hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)] data-[state=active]:border-[var(--color-border)] data-[state=active]:bg-[var(--color-background)] data-[state=active]:text-[var(--color-foreground)] data-[state=active]:font-semibold"
                    >
                      Demandas a avaliar ({sugestoesCards.length})
                    </TabsTrigger>
                    <TabsTrigger
                      value="datas"
                      className="flex-1 rounded-[10px] border border-transparent bg-transparent px-3 py-2 text-sm text-[var(--color-muted-foreground)] transition-colors hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)] data-[state=active]:border-[var(--color-border)] data-[state=active]:bg-[var(--color-background)] data-[state=active]:text-[var(--color-foreground)] data-[state=active]:font-semibold"
                    >
                      Solicitações de data ({dateChangeRequests.length})
                    </TabsTrigger>
                  </TabsList>
                </div>
              </div>
            </CardHeader>

            <CardContent>
              <TabsContent value="demandas" className="mt-0">
                {sugestoesCards.length === 0 ? (
                  <p className="text-center py-[32px] text-[var(--color-muted-foreground)]">
                    Não há demandas para serem avaliadas no momento.
                  </p>
                ) : (
                  <div className="space-y-[8px] max-h-[400px] overflow-y-auto pr-2">
                    {sugestoesCards.map((card) => {
                      const isCreator = card.criado_por && String(card.criado_por) === String(user?.id);
                      return (
                        <div
                          key={card.id}
                          className="flex items-center justify-between gap-3 p-[12px] border border-[var(--color-border)] rounded-[8px] hover:bg-[var(--color-accent)] transition-colors cursor-pointer min-w-0"
                          onClick={() => openDemandViewDialog(card)}
                        >
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-[var(--color-foreground)] truncate">{card.nome}</div>
                            {card.descricao && (
                              <div className="text-sm text-[var(--color-muted-foreground)] mt-1 line-clamp-2 overflow-hidden break-words">
                                {card.descricao}
                              </div>
                            )}
                            <div className="flex items-center gap-2 mt-2">
                              <Badge variant="outline">{card.area_display || card.area}</Badge>
                              <Badge variant="outline">{card.tipo_display || card.tipo}</Badge>
                              <Badge variant="outline">{card.prioridade_display || card.prioridade}</Badge>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 ml-4 shrink-0">
                            {isCreator && (
                              <>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openEditDemandDialog(card);
                                  }}
                                  title="Editar demanda"
                                  className="h-8 w-8 p-0"
                                >
                                  <Pencil className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setDemandToDiscard(card);
                                    setDiscardDialogOpen(true);
                                  }}
                                  title="Deletar demanda"
                                  className="h-8 w-8 p-0"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </>
                            )}
                            {canEvaluateDemands && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openEvaluationDialog(card);
                                }}
                              >
                                <Eye className="h-4 w-4 mr-2" />
                                Avaliar
                              </Button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </TabsContent>

              <TabsContent value="datas" className="mt-0">
                  {loadingDateChangeRequests ? (
                    <div className="flex items-center justify-center py-8 text-[var(--color-muted-foreground)]">
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      Carregando solicitações...
                    </div>
                  ) : dateChangeRequests.length === 0 ? (
                    <p className="text-center py-[32px] text-[var(--color-muted-foreground)]">
                      Não há solicitações pendentes no momento.
                    </p>
                  ) : (
                    <div className="space-y-[8px] max-h-[400px] overflow-y-auto pr-2">
                      {dateChangeRequests.map((req) => (
                        <div
                          key={req.id}
                          className="flex items-center justify-between gap-3 p-[12px] border border-[var(--color-border)] rounded-[8px] hover:bg-[var(--color-accent)] transition-colors min-w-0"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-[var(--color-foreground)] truncate">
                              {req.card_detail?.nome || `Card #${req.card}`}
                            </div>
                            <div className="text-sm text-[var(--color-muted-foreground)] mt-1">
                              Solicitante: {req.requested_by_name || req.requested_by}
                            </div>
                            <div className="text-sm text-[var(--color-muted-foreground)] mt-1">
                              Nova data: {formatDate(req.requested_date)}
                            </div>
                            {req.reason && (
                              <div className="text-sm text-[var(--color-muted-foreground)] mt-1 line-clamp-2">
                                Motivo: {req.reason}
                              </div>
                            )}
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {canEvaluateDateRequests ? (
                              <>
                                <Button variant="outline" onClick={() => handleRejectDateChange(req.id)}>
                                  Recusar
                                </Button>
                                <Button onClick={() => handleApproveDateChange(req.id)}>Aprovar</Button>
                              </>
                            ) : (
                              <Badge variant="secondary">Somente avaliadores</Badge>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </TabsContent>
            </CardContent>
          </Tabs>
        </Card>
      

      {/* Lista de Projetos */}
      <div className="space-y-[24px]">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-[var(--color-foreground)]">Projetos Criados</h1>
          <Button onClick={openCreateProjectDialog} className="min-w-[151px]">
            <Plus className="h-4 w-4 mr-2" />
            Criar Projeto
          </Button>
        </div>
        
        <div className="space-y-[24px]">
          {/* Projetos em Sprint */}
          <Card>
          <CardHeader>
            <CardTitle>{projetosEmSprint.length} {projetosEmSprint.length === 1 ? 'Projeto em Sprint' : 'Projetos em Sprint'}</CardTitle>
            <CardDescription>
              Projetos atualmente em execução em sprints ativas
            </CardDescription>
          </CardHeader>
          <CardContent>
            {projetosEmSprint.length === 0 ? (
              <p className="text-center py-[32px] text-[var(--color-muted-foreground)]">
                Nenhum projeto em sprint ativa no momento.
              </p>
            ) : (
              <>
                <div className="grid gap-[16px] md:grid-cols-2 lg:grid-cols-3">
                  {projetosEmSprint.slice(0, projetosEmSprintPage * itemsPerPage).map((project) => {
                  const projectCards = cards.filter(c => String(c.projeto || '') === String(project.id || ''));
                  const totalCards = projectCards.length;
                  const cardsEntregues = projectCards.filter(c => c.status === 'finalizado' || c.status === 'inviabilizado').length;
                  const cardsEmDesenvolvimento = projectCards.filter(c => c.status === 'em_desenvolvimento').length;
                  const projectSprint = sprints.find(s => String(s.id || '') === String(project.sprint || ''));
                  
                  return (
                    <Card
                      key={project.id}
                      className="cursor-pointer hover:shadow-md transition-shadow"
                      onClick={() => navigate(`/projects/${project.id}`)}
                    >
                      <CardHeader>
                        <div className="flex items-start justify-between">
                          <CardTitle className="text-lg">{project.nome}</CardTitle>
                          <Badge className={getStatusColor(project.status)}>
                            <div className="flex items-center gap-1">
                              {getStatusIcon(project.status)}
                              <span>{project.status_display || project.status}</span>
                            </div>
                          </Badge>
                        </div>
                        {project.descricao && (
                          <CardDescription className="mt-2">{project.descricao}</CardDescription>
                        )}
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-2 text-sm text-[var(--color-muted-foreground)]">
                          {projectSprint && (
                            <div className="flex items-center gap-2">
                              <Calendar className="h-4 w-4" />
                              <span>Em Sprint: {projectSprint.nome}</span>
                            </div>
                          )}
                          <div className="flex items-center gap-2">
                            <FolderKanban className="h-4 w-4" />
                            <span>{totalCards} cards total</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <CheckCircle2 className="h-4 w-4 text-green-500" />
                            <span>{cardsEntregues} entregues</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Clock className="h-4 w-4 text-blue-500" />
                            <span>{cardsEmDesenvolvimento} em desenvolvimento</span>
                          </div>
                          {project.gerente_name && (
                            <div className="flex items-center gap-2">
                              <UserIcon className="h-4 w-4" />
                              <span>Gerente: {project.gerente_name}</span>
                            </div>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                    );
                  })}
                  </div>
                  {projetosEmSprint.length > projetosEmSprintPage * itemsPerPage && (
                    <div 
                      ref={sprintScrollRef}
                      className="mt-[16px] text-center"
                    >
                      <Loader2 className="h-6 w-6 animate-spin text-[var(--color-primary)] mx-auto" />
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          {/* Projetos em Planejamento */}
          <Card>
            <CardHeader>
              <CardTitle>{projetosEmPlanejamento.length} {projetosEmPlanejamento.length === 1 ? 'Projeto em Planejamento' : 'Projetos em Planejamento'}</CardTitle>
              <CardDescription>
                Projetos aguardando início de desenvolvimento
              </CardDescription>
            </CardHeader>
            <CardContent>
              {projetosEmPlanejamento.length === 0 ? (
                <p className="text-center py-[32px] text-[var(--color-muted-foreground)]">
                  Nenhum projeto em planejamento no momento.
                </p>
              ) : (
                <>
                  <div className="grid gap-[16px] md:grid-cols-2 lg:grid-cols-3">
                    {projetosEmPlanejamento.slice(0, projetosEmPlanejamentoPage * itemsPerPage).map((project) => {
                  const projectCards = cards.filter(c => String(c.projeto || '') === String(project.id || ''));
                  const totalCards = projectCards.length;
                  const cardsEntregues = projectCards.filter(c => c.status === 'finalizado' || c.status === 'inviabilizado').length;
                  const cardsEmDesenvolvimento = projectCards.filter(c => c.status === 'em_desenvolvimento').length;
                  const projectSprint = sprints.find(s => String(s.id || '') === String(project.sprint || ''));
                  
                  return (
                    <Card
                      key={project.id}
                      className="cursor-pointer hover:shadow-md transition-shadow"
                      onClick={() => navigate(`/projects/${project.id}`)}
                    >
                      <CardHeader>
                        <div className="flex items-start justify-between">
                          <CardTitle className="text-lg">{project.nome}</CardTitle>
                          <Badge className={getStatusColor(project.status)}>
                            <div className="flex items-center gap-1">
                              {getStatusIcon(project.status)}
                              <span>{project.status_display || project.status}</span>
                            </div>
                          </Badge>
                        </div>
                        {project.descricao && (
                          <CardDescription className="mt-2">{project.descricao}</CardDescription>
                        )}
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-2 text-sm text-[var(--color-muted-foreground)]">
                          {projectSprint && (
                            <div className="flex items-center gap-2">
                              <Calendar className="h-4 w-4" />
                              <span>Sprint: {projectSprint.nome}</span>
                            </div>
                          )}
                          <div className="flex items-center gap-2">
                            <FolderKanban className="h-4 w-4" />
                            <span>{totalCards} cards total</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <CheckCircle2 className="h-4 w-4 text-green-500" />
                            <span>{cardsEntregues} entregues</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Clock className="h-4 w-4 text-blue-500" />
                            <span>{cardsEmDesenvolvimento} em desenvolvimento</span>
                          </div>
                          {project.gerente_name && (
                            <div className="flex items-center gap-2">
                              <UserIcon className="h-4 w-4" />
                              <span>Gerente: {project.gerente_name}</span>
                            </div>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                    );
                  })}
                  </div>
                  {projetosEmPlanejamento.length > projetosEmPlanejamentoPage * itemsPerPage && (
                    <div 
                      ref={planejamentoScrollRef}
                      className="mt-[16px] text-center"
                    >
                      <Loader2 className="h-6 w-6 animate-spin text-[var(--color-primary)] mx-auto" />
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          {/* Projetos Concluídos */}
          <Card>
            <CardHeader>
              <CardTitle>{projetosConcluidos.length} {projetosConcluidos.length === 1 ? 'Projeto Concluído' : 'Projetos Concluídos'}</CardTitle>
              <CardDescription>
                Projetos finalizados e entregues
              </CardDescription>
            </CardHeader>
            <CardContent>
              {projetosConcluidos.length === 0 ? (
                <p className="text-center py-[32px] text-[var(--color-muted-foreground)]">
                  Nenhum projeto concluído no momento.
                </p>
              ) : (
                <>
                  <div className="grid gap-[16px] md:grid-cols-2 lg:grid-cols-3">
                    {projetosConcluidos.slice(0, projetosConcluidosPage * itemsPerPage).map((project) => {
                  const projectCards = cards.filter(c => String(c.projeto || '') === String(project.id || ''));
                  const totalCards = projectCards.length;
                  const cardsEntregues = projectCards.filter(c => c.status === 'finalizado' || c.status === 'inviabilizado').length;
                  const cardsEmDesenvolvimento = projectCards.filter(c => c.status === 'em_desenvolvimento').length;
                  const projectSprint = sprints.find(s => String(s.id || '') === String(project.sprint || ''));
                  
                  return (
                    <Card
                      key={project.id}
                      className="cursor-pointer hover:shadow-md transition-shadow"
                      onClick={() => navigate(`/projects/${project.id}`)}
                    >
                      <CardHeader>
                        <div className="flex items-start justify-between">
                          <CardTitle className="text-lg">{project.nome}</CardTitle>
                          <Badge className={getStatusColor(project.status)}>
                            <div className="flex items-center gap-1">
                              {getStatusIcon(project.status)}
                              <span>{project.status_display || project.status}</span>
                            </div>
                          </Badge>
                        </div>
                        {project.descricao && (
                          <CardDescription className="mt-2">{project.descricao}</CardDescription>
                        )}
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-2 text-sm text-[var(--color-muted-foreground)]">
                          {projectSprint && (
                            <div className="flex items-center gap-2">
                              <Calendar className="h-4 w-4" />
                              <span>Sprint: {projectSprint.nome}</span>
                            </div>
                          )}
                          <div className="flex items-center gap-2">
                            <FolderKanban className="h-4 w-4" />
                            <span>{totalCards} cards total</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <CheckCircle2 className="h-4 w-4 text-green-500" />
                            <span>{cardsEntregues} entregues</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Clock className="h-4 w-4 text-blue-500" />
                            <span>{cardsEmDesenvolvimento} em desenvolvimento</span>
                          </div>
                          {project.gerente_name && (
                            <div className="flex items-center gap-2">
                              <UserIcon className="h-4 w-4" />
                              <span>Gerente: {project.gerente_name}</span>
                            </div>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                    );
                  })}
                  </div>
                  {projetosConcluidos.length > projetosConcluidosPage * itemsPerPage && (
                    <div 
                      ref={concluidosScrollRef}
                      className="mt-[16px] text-center"
                    >
                      <Loader2 className="h-6 w-6 animate-spin text-[var(--color-primary)] mx-auto" />
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          {/* Projetos Descartados */}
          {projetosDescartados.length > 0 && (
            <div>
              <h3 className="text-lg font-medium text-[var(--color-foreground)] mb-4">
                {projetosDescartados.length} Projetos Descartados
              </h3>
              <div className="grid gap-[16px] md:grid-cols-2 lg:grid-cols-3">
                {projetosDescartados.map((project) => {
                const projectCards = cards.filter(c => String(c.projeto || '') === String(project.id || ''));
                const totalCards = projectCards.length;
                const cardsEntregues = projectCards.filter(c => c.status === 'finalizado' || c.status === 'inviabilizado').length;
                const cardsEmDesenvolvimento = projectCards.filter(c => c.status === 'em_desenvolvimento').length;
                
                return (
                  <Card
                    key={project.id}
                    className="cursor-pointer hover:shadow-md transition-shadow"
                    onClick={() => navigate(`/projects/${project.id}`)}
                  >
                    <CardHeader>
                      <div className="flex items-start justify-between">
                        <CardTitle className="text-lg">{project.nome}</CardTitle>
                        <Badge className="bg-red-100 text-red-800">
                          <div className="flex items-center gap-1">
                            <XCircle className="h-4 w-4" />
                            <span>Descartado</span>
                          </div>
                        </Badge>
                      </div>
                      {project.descricao && (
                        <CardDescription className="mt-2">{project.descricao}</CardDescription>
                      )}
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2 text-sm text-[var(--color-muted-foreground)]">
                        <div className="flex items-center gap-2">
                          <FolderKanban className="h-4 w-4" />
                          <span>{totalCards} demandas descartadas</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <CheckCircle2 className="h-4 w-4 text-green-500" />
                          <span>{cardsEntregues} entregues</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Clock className="h-4 w-4 text-blue-500" />
                          <span>{cardsEmDesenvolvimento} em desenvolvimento</span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
                })}
              </div>
            </div>
          )}
        </div>
      </div>


      {/* Dialog de Visualização de Demanda */}
      <Dialog open={demandViewDialogOpen} onOpenChange={setDemandViewDialogOpen}>
        <DialogContent className="max-w-[700px]">
          <DialogHeader>
            <DialogTitle>Detalhes da Demanda</DialogTitle>
            <DialogDescription>
              Informações completas da demanda
            </DialogDescription>
          </DialogHeader>

          {selectedDemand && (
            <div className="space-y-[16px] mt-[16px]">
              {/* Informações do Criador */}
              <div className="flex items-center gap-4 p-[16px] border border-[var(--color-border)] rounded-[8px] bg-[var(--color-muted)]/30">
                <Avatar className="h-[48px] w-[48px]">
                  {selectedDemand.criado_por_profile_picture_url ? (
                    <AvatarImage src={selectedDemand.criado_por_profile_picture_url} alt={selectedDemand.criado_por_name || ''} />
                  ) : null}
                  <AvatarFallback>
                    {selectedDemand.criado_por_name
                      ? selectedDemand.criado_por_name.substring(0, 2).toUpperCase()
                      : 'U'}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1">
                  <div className="font-medium text-[var(--color-foreground)]">
                    {selectedDemand.criado_por_name || 'Usuário desconhecido'}
                  </div>
                  {selectedDemand.created_at && (
                    <div className="text-xs text-[var(--color-muted-foreground)] mt-1">
                      Criado em: {new Date(selectedDemand.created_at).toLocaleString('pt-BR', {
                        day: '2-digit',
                        month: '2-digit',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* Informações da Demanda */}
              <div className="space-y-[16px]">
                <div className="space-y-[8px]">
                  <Label>Nome da Demanda</Label>
                  <div className="p-[12px] bg-[var(--color-background)] border border-[var(--color-border)] rounded-[8px]">
                    {selectedDemand.nome}
                  </div>
                </div>

                <div className="space-y-[8px]">
                  <Label>Descrição / Instruções</Label>
                  <div className="p-[12px] bg-[var(--color-background)] border border-[var(--color-border)] rounded-[8px] min-h-[100px] whitespace-pre-wrap">
                    {selectedDemand.descricao || 'Sem descrição'}
                  </div>
                </div>

                {selectedDemand.script_url && (
                  <div className="space-y-[8px]">
                    <Label>Link do Script</Label>
                    <div className="p-[12px] bg-[var(--color-background)] border border-[var(--color-border)] rounded-[8px]">
                      <a 
                        href={selectedDemand.script_url} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="text-[var(--color-primary)] hover:underline"
                      >
                        {selectedDemand.script_url}
                      </a>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-3 gap-[16px]">
                  <div className="space-y-[8px]">
                    <Label>Área</Label>
                    <div className="p-[12px] bg-[var(--color-background)] border border-[var(--color-border)] rounded-[8px] min-h-[48px] flex items-center">
                      {selectedDemand.area_display || selectedDemand.area}
                    </div>
                  </div>

                  <div className="space-y-[8px]">
                    <Label>Tipo</Label>
                    <div className="p-[12px] bg-[var(--color-background)] border border-[var(--color-border)] rounded-[8px] min-h-[48px] flex items-center">
                      {selectedDemand.tipo_display || selectedDemand.tipo}
                    </div>
                  </div>

                  <div className="space-y-[8px]">
                    <Label>Prioridade</Label>
                    <div className="p-[12px] bg-[var(--color-background)] border border-[var(--color-border)] rounded-[8px] min-h-[48px] flex items-center">
                      {selectedDemand.prioridade_display || selectedDemand.prioridade}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <div className="flex items-center justify-between w-full">
              <div className="flex gap-2">
                {/* Botões de editar/deletar apenas para o criador */}
                {selectedDemand && selectedDemand.criado_por && String(selectedDemand.criado_por) === String(user?.id) && (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        if (selectedDemand) {
                          openEditDemandDialog(selectedDemand);
                        }
                      }}
                    >
                      <Pencil className="h-4 w-4 mr-2" />
                      Editar
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      onClick={() => {
                        setDemandToDiscard(selectedDemand);
                        setDiscardDialogOpen(true);
                        setDemandViewDialogOpen(false);
                      }}
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Deletar
                    </Button>
                  </>
                )}
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={() => setDemandViewDialogOpen(false)}>
                  Fechar
                </Button>
                {/* Botão Avaliar apenas para supervisor (demandas) */}
                {selectedDemand && canEvaluateDemands && (
                  <Button
                    type="button"
                    onClick={() => {
                      setDemandViewDialogOpen(false);
                      openEvaluationDialog(selectedDemand);
                    }}
                  >
                    Avaliar e Atribuir
                  </Button>
                )}
              </div>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog de Edição de Demanda */}
      <Dialog open={editDemandDialogOpen} onOpenChange={setEditDemandDialogOpen}>
        <DialogContent className="max-w-[600px]">
          <DialogHeader>
            <DialogTitle>Editar Demanda</DialogTitle>
            <DialogDescription>
              Atualize as informações da demanda
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleEditDemandSubmit} className="space-y-[16px] mt-[16px]">
            <div className="space-y-[8px]">
              <Label htmlFor="edit-demand-nome">Nome do Projeto *</Label>
              <Input
                id="edit-demand-nome"
                placeholder="Ex: Certidões PE"
                value={editDemandFormData.nome}
                onChange={(e) => setEditDemandFormData({ ...editDemandFormData, nome: e.target.value })}
                required
              />
            </div>

            <div className="space-y-[8px]">
              <Label htmlFor="edit-demand-descricao">Descrição / Instruções</Label>
              <Textarea
                id="edit-demand-descricao"
                placeholder="Descreva o projeto, requisitos, objetivos, etc..."
                value={editDemandFormData.descricao}
                onChange={(e) => setEditDemandFormData({ ...editDemandFormData, descricao: e.target.value })}
                rows={4}
              />
            </div>

            <div className="space-y-[8px]">
              <Label htmlFor="edit-demand-script_url">Link do Script</Label>
              <Input
                id="edit-demand-script_url"
                type="url"
                placeholder="https://exemplo.com/script..."
                value={editDemandFormData.script_url}
                onChange={(e) => setEditDemandFormData({ ...editDemandFormData, script_url: e.target.value })}
              />
            </div>

            <div className="grid grid-cols-2 gap-[16px]">
              <div className="space-y-[8px]">
                <Label htmlFor="edit-demand-area">Área *</Label>
                <select
                  id="edit-demand-area"
                  className="flex h-[40px] w-full rounded-[8px] border border-[var(--color-input)] bg-[var(--color-background)] px-[12px] py-[8px] text-sm ring-offset-[var(--color-background)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] focus-visible:ring-offset-2"
                  value={editDemandFormData.area}
                  onChange={(e) => setEditDemandFormData({ ...editDemandFormData, area: e.target.value })}
                  required
                >
                  {CARD_AREAS.map((area) => (
                    <option key={area.value} value={area.value}>{area.label}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-[8px]">
                <Label htmlFor="edit-demand-tipo">Tipo *</Label>
                <select
                  id="edit-demand-tipo"
                  className="flex h-[40px] w-full rounded-[8px] border border-[var(--color-input)] bg-[var(--color-background)] px-[12px] py-[8px] text-sm ring-offset-[var(--color-background)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] focus-visible:ring-offset-2"
                  value={editDemandFormData.tipo}
                  onChange={(e) => setEditDemandFormData({ ...editDemandFormData, tipo: e.target.value })}
                  required
                >
                  {CARD_TYPES.map((type) => (
                    <option key={type.value} value={type.value}>{type.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-[8px]">
              <Label htmlFor="edit-demand-prioridade">Prioridade *</Label>
              <select
                id="edit-demand-prioridade"
                className="flex h-[40px] w-full rounded-[8px] border border-[var(--color-input)] bg-[var(--color-background)] px-[12px] py-[8px] text-sm ring-offset-[var(--color-background)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] focus-visible:ring-offset-2"
                value={editDemandFormData.prioridade}
                onChange={(e) => setEditDemandFormData({ ...editDemandFormData, prioridade: e.target.value })}
                required
              >
                {CARD_PRIORITIES.map((priority) => (
                  <option key={priority.value} value={priority.value}>{priority.label}</option>
                ))}
              </select>
            </div>

            {editDemandFormError && (
              <div className="p-[8px] text-sm text-[var(--color-destructive)] bg-red-50 border border-red-200 rounded-[8px]">
                {editDemandFormError}
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditDemandDialogOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={editDemandFormLoading}>
                {editDemandFormLoading ? 'Salvando...' : 'Salvar Alterações'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Dialog de Sugestão */}
      <Dialog open={suggestionDialogOpen} onOpenChange={setSuggestionDialogOpen}>
        <DialogContent className="max-w-[600px]">
          <DialogHeader>
            <DialogTitle>Nova Sugestão de Projeto</DialogTitle>
            <DialogDescription>
              Crie uma sugestão de novo projeto. Ela será avaliada e poderá ser atribuída a uma sprint.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSuggestionSubmit} className="space-y-[16px] mt-[16px]">
            <div className="space-y-[8px]">
              <Label htmlFor="suggestion-nome">Nome do Projeto *</Label>
              <Input
                id="suggestion-nome"
                placeholder="Ex: Certidões PE"
                value={suggestionFormData.nome}
                onChange={(e) => setSuggestionFormData({ ...suggestionFormData, nome: e.target.value })}
                required
              />
            </div>

            <div className="space-y-[8px]">
              <Label htmlFor="suggestion-descricao">Descrição / Instruções</Label>
              <Textarea
                id="suggestion-descricao"
                placeholder="Descreva o projeto, requisitos, objetivos, etc..."
                value={suggestionFormData.descricao}
                onChange={(e) => setSuggestionFormData({ ...suggestionFormData, descricao: e.target.value })}
                rows={4}
              />
            </div>

            <div className="space-y-[8px]">
              <Label htmlFor="suggestion-script_url">Link do Script</Label>
              <Input
                id="suggestion-script_url"
                type="url"
                placeholder="https://exemplo.com/script..."
                value={suggestionFormData.script_url}
                onChange={(e) => setSuggestionFormData({ ...suggestionFormData, script_url: e.target.value })}
              />
            </div>

            <div className="grid grid-cols-2 gap-[16px]">
              <div className="space-y-[8px]">
                <Label htmlFor="suggestion-area">Área *</Label>
                <select
                  id="suggestion-area"
                  className="flex h-[40px] w-full rounded-[8px] border border-[var(--color-input)] bg-[var(--color-background)] px-[12px] py-[8px] text-sm"
                  value={suggestionFormData.area}
                  onChange={(e) => setSuggestionFormData({ ...suggestionFormData, area: e.target.value })}
                  required
                >
                  {CARD_AREAS.map((area) => (
                    <option key={area.value} value={area.value}>{area.label}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-[8px]">
                <Label htmlFor="suggestion-tipo">Tipo *</Label>
                <select
                  id="suggestion-tipo"
                  className="flex h-[40px] w-full rounded-[8px] border border-[var(--color-input)] bg-[var(--color-background)] px-[12px] py-[8px] text-sm"
                  value={suggestionFormData.tipo}
                  onChange={(e) => setSuggestionFormData({ ...suggestionFormData, tipo: e.target.value })}
                  required
                >
                  {CARD_TYPES.map((tipo) => (
                    <option key={tipo.value} value={tipo.value}>{tipo.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-[8px]">
              <Label htmlFor="suggestion-prioridade">Prioridade *</Label>
              <select
                id="suggestion-prioridade"
                className="flex h-[40px] w-full rounded-[8px] border border-[var(--color-input)] bg-[var(--color-background)] px-[12px] py-[8px] text-sm"
                value={suggestionFormData.prioridade}
                onChange={(e) => setSuggestionFormData({ ...suggestionFormData, prioridade: e.target.value })}
                required
              >
                {CARD_PRIORITIES.map((prioridade) => (
                  <option key={prioridade.value} value={prioridade.value}>{prioridade.label}</option>
                ))}
              </select>
            </div>

            {suggestionFormError && (
              <div className="p-[8px] text-sm text-[var(--color-destructive)] bg-red-50 border border-red-200 rounded-[8px]">
                {suggestionFormError}
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setSuggestionDialogOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={suggestionFormLoading}>
                {suggestionFormLoading ? 'Criando...' : 'Criar Demanda'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Modal de escolha: criar demanda vs solicitar data */}
      <Dialog open={createDemandChoiceOpen} onOpenChange={setCreateDemandChoiceOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>O que você quer criar?</DialogTitle>
            <DialogDescription>Escolha uma opção</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 mt-4">
            <Button
              className="h-28 w-full rounded-[12px] px-4 py-3 text-sm"
              onClick={() => {
                setCreateDemandChoiceOpen(false);
                openSuggestionDialog();
              }}
            >
              Criar uma demanda
            </Button>
            <Button
              variant="outline"
              className="h-28 w-full rounded-[12px] px-4 py-3 text-sm"
              onClick={() => {
                setCreateDemandChoiceOpen(false);
                setDateChangeRequestModalOpen(true);
              }}
            >
              Solicitar ajuste de data
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <RequestDueDateChangeModal
        open={dateChangeRequestModalOpen}
        onOpenChange={setDateChangeRequestModalOpen}
        onCreated={() => loadData()}
      />

      {/* Dialog de Avaliação */}
      <Dialog open={evaluationDialogOpen} onOpenChange={setEvaluationDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Avaliar Sugestão</DialogTitle>
            <DialogDescription>
              Atribua esta sugestão a uma sprint e projeto para iniciar o desenvolvimento.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleEvaluationSubmit} className="space-y-[16px] mt-[16px]">
            <div className="space-y-[8px]">
              <Label htmlFor="evaluation-sprint">Sprint *</Label>
              <select
                id="evaluation-sprint"
                className="flex h-[40px] w-full rounded-[8px] border border-[var(--color-input)] bg-[var(--color-background)] px-[12px] py-[8px] text-sm"
                value={evaluationFormData.sprint}
                onChange={(e) => {
                  setEvaluationFormData({ ...evaluationFormData, sprint: e.target.value, projeto: '' });
                }}
                required
              >
                <option value="">Selecione uma sprint</option>
                {sprints.map((sprint) => (
                  <option key={sprint.id} value={sprint.id}>
                    {sprint.nome} ({formatDate(sprint.data_inicio)} - {formatDate(sprint.data_fim)})
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-[8px]">
              <Label htmlFor="evaluation-projeto">Projeto *</Label>
              <select
                id="evaluation-projeto"
                className="flex h-[40px] w-full rounded-[8px] border border-[var(--color-input)] bg-[var(--color-background)] px-[12px] py-[8px] text-sm"
                value={evaluationFormData.projeto}
                onChange={(e) => setEvaluationFormData({ ...evaluationFormData, projeto: e.target.value })}
                required
                disabled={!evaluationFormData.sprint}
              >
                <option value="">Selecione um projeto</option>
                {evaluationFormData.sprint &&
                  projects
                    .filter((p) => String(p.sprint || '') === String(evaluationFormData.sprint || ''))
                    .filter((p) => p.nome !== 'Sugestões')
                    .map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.nome}
                      </option>
                    ))}
              </select>
            </div>

            {evaluationFormError && (
              <div className="p-[8px] text-sm text-[var(--color-destructive)] bg-red-50 border border-red-200 rounded-[8px]">
                {evaluationFormError}
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEvaluationDialogOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={evaluationFormLoading}>
                {evaluationFormLoading ? 'Atribuindo...' : 'Atribuir e Iniciar'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Dialog de Criação/Edição de Projeto */}
      <Dialog open={projectDialogOpen} onOpenChange={setProjectDialogOpen}>
        <DialogContent className="max-w-[600px]">
          <DialogHeader>
            <DialogTitle>
              {editingProject ? 'Editar Projeto' : 'Criar Projeto'}
            </DialogTitle>
            <DialogDescription>
              {editingProject 
                ? 'Atualize as informações do projeto.'
                : 'Crie um novo projeto e atribua-o a uma sprint.'}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleProjectSubmit} className="space-y-[16px] mt-[16px]">
            <div className="space-y-[8px]">
              <Label htmlFor="project-nome">Nome do Projeto *</Label>
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

            <div className="space-y-[8px]">
              <Label htmlFor="project-sprint">Sprint *</Label>
              <select
                id="project-sprint"
                className="flex h-[40px] w-full rounded-[8px] border border-[var(--color-input)] bg-[var(--color-background)] px-[12px] py-[8px] text-sm"
                value={projectFormData.sprint}
                onChange={(e) => setProjectFormData({ ...projectFormData, sprint: e.target.value })}
                required
                disabled={!!editingProject}
              >
                <option value="">Selecione uma sprint</option>
                {sprints.map((sprint) => (
                  <option key={sprint.id} value={sprint.id}>
                    {sprint.nome} ({formatDate(sprint.data_inicio)} - {formatDate(sprint.data_fim)})
                  </option>
                ))}
              </select>
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

      {/* Discard Demand Confirmation Dialog */}
      <Dialog open={discardDialogOpen} onOpenChange={setDiscardDialogOpen}>
        <DialogContent onClose={() => {
          setDiscardDialogOpen(false);
          setDemandToDiscard(null);
        }}>
          <DialogHeader>
            <DialogTitle>Confirmar Descarte</DialogTitle>
            <DialogDescription>
              {demandToDiscard
                ? `Tem certeza que deseja descartar a demanda "${demandToDiscard.nome}"? Ela será movida para "Projetos Descartados".`
                : 'Tem certeza que deseja descartar esta demanda? Ela será movida para "Projetos Descartados".'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setDiscardDialogOpen(false);
                setDemandToDiscard(null);
              }}
              disabled={discardLoading}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={confirmDiscardDemand}
              disabled={discardLoading}
            >
              {discardLoading ? (
                <>
                  <Loader2 className="mr-[8px] h-[16px] w-[16px] animate-spin" />
                  Descartando...
                </>
              ) : (
                'Descartar'
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
    </div>
  );
}

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { SprintPeriodHelpNote } from '@/components/SprintPeriodHelpNote';
import { useAuth } from '@/context/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
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
import type { Sprint } from '@/services/sprintService';
import type { Project } from '@/services/projectService';
import {
  Plus,
  Calendar,
  Clock,
  FolderKanban,
  Loader2,
  Pencil,
  Trash2,
  Zap,
  User,
  Search,
  SlidersHorizontal,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  AlertCircle,
  XCircle,
} from 'lucide-react';
import { calcularDiasTotais, calcularDiasUteis } from '@/lib/dateUtils';
import {
  fechamentoIsoToDatetimeLocal,
  datetimeLocalToFechamentoIso,
  isSprintPastFechamento,
  sprintFimDiaParaCalendario,
  sprintInicioDiaParaCalendario,
} from '@/lib/sprintFechamento';

type SortField = 'nome' | 'created_at' | 'supervisor_name' | 'projects_count';
type SortDirection = 'asc' | 'desc';

export default function Sprints() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [showFinishedSprints, setShowFinishedSprints] = useState(true);

  // Search and filter state for sprints
  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState<SortField>('created_at');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [showFilters, setShowFilters] = useState(false);

  // Sprint dialog state
  const [sprintDialogOpen, setSprintDialogOpen] = useState(false);
  const [editingSprint, setEditingSprint] = useState<Sprint | null>(null);
  const [sprintFormLoading, setSprintFormLoading] = useState(false);
  const [sprintFormError, setSprintFormError] = useState('');
  const [sprintFormData, setSprintFormData] = useState({
    nome: '',
    data_inicio: '',
    fechamento_em: '',
  });

  // Delete confirmation dialog state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [sprintToDelete, setSprintToDelete] = useState<Sprint | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Finalizar sprint dialog state
  const [finalizarDialogOpen, setFinalizarDialogOpen] = useState(false);
  const [sprintToFinalizar, setSprintToFinalizar] = useState<Sprint | null>(null);
  const [finalizarLoading, setFinalizarLoading] = useState(false);
  const [finalizarError, setFinalizarError] = useState('');

  const canCreate = user?.role === 'supervisor' || user?.role === 'admin';
  const canDeleteFinished = user?.role === 'admin';
  const canFinalizar = user?.role === 'supervisor' || user?.role === 'admin';

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [sprintsData, projectsData] = await Promise.all([
        sprintService.getAll().catch((err) => {
          console.error('Erro ao carregar sprints:', err);
          return [];
        }),
        projectService.getAll().catch((err) => {
          console.error('Erro ao carregar projetos:', err);
          return [];
        }),
      ]);
      setSprints(Array.isArray(sprintsData) ? sprintsData : []);
      setProjects(Array.isArray(projectsData) ? projectsData : []);
    } catch (error) {
      console.error('Erro ao carregar dados:', error);
      setSprints([]);
      setProjects([]);
    } finally {
      setLoading(false);
    }
  };

  // Removido: Lógica de seleção automática de sprint via state

  const getProjectsForSprint = (sprintId: string) => {
    return projects.filter((p) => {
      const projectSprintId = String(p.sprint || '');
      const targetSprintId = String(sprintId || '');
      const normalizedName = normalizeProjectName(p.nome || '');
      const isSupportProject = normalizedName === 'suporte' || normalizedName.includes('suporte');
      return projectSprintId === targetSprintId && !isSupportProject;
    });
  };

  // Categorizar sprints (início e fim respeitam data e hora)
  const categorizeSprints = (sprintsToCategorize: Sprint[]) => {
    const nowMs = Date.now();

    const emAndamento: Sprint[] = [];
    const planejadas: Sprint[] = [];
    const finalizadas: Sprint[] = [];

    sprintsToCategorize.forEach((sprint) => {
      const startMs = new Date(sprint.data_inicio).getTime();

      if (sprint.finalizada) {
        finalizadas.push(sprint);
      } else if (nowMs < startMs) {
        planejadas.push(sprint);
      } else {
        emAndamento.push(sprint);
      }
    });

    // Ordenar planejadas por data de início (mais próximas primeiro)
    planejadas.sort(
      (a, b) =>
        new Date(a.data_inicio).getTime() - new Date(b.data_inicio).getTime()
    );

    // Ordenar finalizadas por data de fim (mais recentes primeiro)
    finalizadas.sort(
      (a, b) =>
        new Date(b.fechamento_em || b.data_fim || '').getTime() -
        new Date(a.fechamento_em || a.data_fim || '').getTime()
    );

    return { emAndamento, planejadas, finalizadas };
  };

  // Filter and sort sprints
  const getFilteredAndSortedSprints = () => {
    let filtered = [...sprints];

    // Search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (sprint) =>
          sprint.nome.toLowerCase().includes(query) ||
          (sprint.supervisor_name && sprint.supervisor_name.toLowerCase().includes(query))
      );
    }

    // Sort
    filtered.sort((a, b) => {
      let comparison = 0;

      switch (sortField) {
        case 'nome':
          comparison = a.nome.localeCompare(b.nome);
          break;
        case 'created_at':
          comparison = new Date(a.created_at || '').getTime() - new Date(b.created_at || '').getTime();
          break;
        case 'supervisor_name':
          comparison = (a.supervisor_name || '').localeCompare(b.supervisor_name || '');
          break;
        case 'projects_count':
          const aCount = getProjectsForSprint(a.id).length;
          const bCount = getProjectsForSprint(b.id).length;
          comparison = aCount - bCount;
          break;
        default:
          comparison = 0;
      }

      return sortDirection === 'asc' ? comparison : -comparison;
    });

    return filtered;
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const getSortIcon = (field: SortField) => {
    if (sortField !== field) {
      return <ArrowUpDown className="h-[14px] w-[14px]" />;
    }
    return sortDirection === 'asc' 
      ? <ArrowUp className="h-[14px] w-[14px]" />
      : <ArrowDown className="h-[14px] w-[14px]" />;
  };

  // Sprint handlers
  const openCreateSprintDialog = () => {
    setEditingSprint(null);
    setSprintFormData({
      nome: '',
      data_inicio: '',
      fechamento_em: '',
    });
    setSprintFormError(''); // Limpar erro ao abrir o modal
    setSprintDialogOpen(true);
  };

  const openEditSprintDialog = (e: React.MouseEvent, sprint: Sprint) => {
    e.stopPropagation();
    if (isSprintPastFechamento(sprint)) {
      // Sprints finalizadas não podem ser editadas - já está bloqueado no botão
      return;
    }
    setEditingSprint(sprint);

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

      const sprintData = {
        nome: sprintFormData.nome,
        data_inicio: inicioIso,
        fechamento_em: fechamentoIso,
      };

      if (editingSprint) {
        if (isSprintPastFechamento(editingSprint)) {
          setSprintFormError('Sprints finalizadas não podem ser editadas.');
          setSprintFormLoading(false);
          return;
        }
        await sprintService.update(editingSprint.id, sprintData);
      } else {
        await sprintService.create({
          ...sprintData,
          supervisor: user!.id.toString(),
        });
      }
      setSprintDialogOpen(false);
      loadData();
    } catch (err: any) {
      if (err?.code === 'ECONNABORTED' || err?.message?.includes?.('timeout')) {
        setSprintFormError(
          'Tempo esgotado ao falar com o servidor. Confirme que a API está a correr e, se usar outra porta (ex.: 8001), defina VITE_API_URL no frontend.'
        );
        return;
      }
      if (err?.code === 'ERR_NETWORK' && !err?.response) {
        setSprintFormError(
          'Não foi possível ligar à API. Verifique se o backend está a correr e se VITE_API_URL aponta para a porta certa (ex.: http://127.0.0.1:8001/api).'
        );
        return;
      }
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

  const handleDeleteSprint = (e: React.MouseEvent, sprint: Sprint) => {
    e.stopPropagation();
    setSprintToDelete(sprint);
    setDeleteDialogOpen(true);
  };

  const confirmDeleteSprint = async () => {
    if (!sprintToDelete) return;

    setDeleteLoading(true);
    try {
      await sprintService.delete(sprintToDelete.id);
      setDeleteDialogOpen(false);
      setSprintToDelete(null);
      loadData();
    } catch (error) {
      console.error('Erro ao excluir sprint:', error);
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleFinalizarSprint = (e: React.MouseEvent, sprint: Sprint) => {
    e.stopPropagation();
    setSprintToFinalizar(sprint);
    setFinalizarError('');
    setFinalizarDialogOpen(true);
  };

  const confirmFinalizarSprint = async () => {
    if (!sprintToFinalizar) return;
    setFinalizarLoading(true);
    setFinalizarError('');
    try {
      await sprintService.finalizar(sprintToFinalizar.id);
      setFinalizarDialogOpen(false);
      setSprintToFinalizar(null);
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
      return { label: 'Finalizada', variant: 'secondary' as const };
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

  const getDaysUntilStart = (sprint: Sprint): number | null => {
    const startMs = new Date(sprint.data_inicio).getTime();
    const nowMs = Date.now();
    if (nowMs < startMs) {
      return Math.ceil((startMs - nowMs) / (1000 * 60 * 60 * 24));
    }
    return null;
  };

  const isSprintFinished = (sprint: Sprint) => isSprintPastFechamento(sprint);

  const formatDate = (dateString: string) => {
    if (!dateString) return 'N/A';
    
    // Se a data está no formato YYYY-MM-DD, parsear manualmente para evitar problemas de timezone
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
      const [year, month, day] = dateString.split('-').map(Number);
      // Criar data no timezone local (não UTC)
      const date = new Date(year, month - 1, day);
      return date.toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      });
    }
    
    // Se tem hora (datetime), extrair apenas a parte da data
    if (/^\d{4}-\d{2}-\d{2}T/.test(dateString)) {
      const datePart = dateString.split('T')[0];
      const [year, month, day] = datePart.split('-').map(Number);
      const date = new Date(year, month - 1, day);
      return date.toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      });
    }
    
    // Para outros formatos, usar Date normalmente
    return new Date(dateString).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  };

  const formatDateTime = (dateString?: string) => {
    if (!dateString) return 'N/A';
    const d = new Date(dateString);
    if (Number.isNaN(d.getTime())) return 'N/A';
    return d.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[256px]">
        <Loader2 className="h-[32px] w-[32px] animate-spin text-[var(--color-primary)]" />
      </div>
    );
  }

  // View: Sprint selecionada movida para SprintDetails.tsx
  // Esta página agora apenas lista sprints
  // O código da sprint aberta foi movido para SprintDetails.tsx

  // View: Lista de Sprints
  const filteredSprints = getFilteredAndSortedSprints();

  return (
    <div className="space-y-[24px]">
      {/* Actions */}
      <div className="flex items-center justify-between gap-[16px]">
        <p className="text-[var(--color-muted-foreground)]">
          Gerencie as sprints e seus prazos
        </p>
        {canCreate && (
          <Button onClick={openCreateSprintDialog}>
            <Plus className="mr-[8px] h-[16px] w-[16px]" />
            Nova Sprint
          </Button>
        )}
      </div>

      {/* Search and Filters */}
      <div className="space-y-[16px]">
        <div className="flex flex-col sm:flex-row gap-[16px]">
          {/* Search Bar */}
          <div className="relative flex-1">
            <Search className="absolute left-[12px] top-1/2 -translate-y-1/2 h-[18px] w-[18px] text-[var(--color-muted-foreground)]" />
            <Input
              type="text"
              placeholder="Pesquisar sprints por nome ou criador..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-[40px]"
            />
          </div>
          {/* Filter Toggle */}
          <Button
            variant={showFilters ? "default" : "outline"}
            onClick={() => setShowFilters(!showFilters)}
            className="flex items-center gap-[8px]"
          >
            <SlidersHorizontal className="h-[16px] w-[16px]" />
            Filtros
          </Button>
        </div>

        {/* Sort Buttons */}
        {showFilters && (
          <div className="flex flex-wrap gap-[8px] p-[16px] bg-[var(--color-muted)]/30 rounded-[12px] border border-[var(--color-border)]">
            <span className="text-sm text-[var(--color-muted-foreground)] mr-[8px] self-center">Ordenar por:</span>
            <Button
              variant={sortField === 'nome' ? "default" : "outline"}
              size="sm"
              onClick={() => handleSort('nome')}
              className="flex items-center gap-[4px]"
            >
              Alfabética
              {getSortIcon('nome')}
            </Button>
            <Button
              variant={sortField === 'created_at' ? "default" : "outline"}
              size="sm"
              onClick={() => handleSort('created_at')}
              className="flex items-center gap-[4px]"
            >
              Data de Criação
              {getSortIcon('created_at')}
            </Button>
            <Button
              variant={sortField === 'supervisor_name' ? "default" : "outline"}
              size="sm"
              onClick={() => handleSort('supervisor_name')}
              className="flex items-center gap-[4px]"
            >
              Criador
              {getSortIcon('supervisor_name')}
            </Button>
            <Button
              variant={sortField === 'projects_count' ? "default" : "outline"}
              size="sm"
              onClick={() => handleSort('projects_count')}
              className="flex items-center gap-[4px]"
            >
              Qtd. Projetos
              {getSortIcon('projects_count')}
            </Button>
          </div>
        )}

        {/* Results count */}
        {searchQuery && (
          <p className="text-sm text-[var(--color-muted-foreground)]">
            {filteredSprints.length} sprint{filteredSprints.length !== 1 ? 's' : ''} encontrada{filteredSprints.length !== 1 ? 's' : ''}
          </p>
        )}
      </div>

      {/* Categorizar sprints */}
      {(() => {
        const { emAndamento, planejadas, finalizadas } = categorizeSprints(filteredSprints);

        if (filteredSprints.length === 0) {
          return (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-[48px]">
                <Zap className="h-[48px] w-[48px] text-[var(--color-muted-foreground)] mb-[16px]" />
                <p className="text-lg font-medium text-[var(--color-foreground)]">
                  {searchQuery ? 'Nenhuma sprint encontrada para esta pesquisa' : 'Nenhuma sprint encontrada'}
                </p>
                <p className="text-[var(--color-muted-foreground)]">
                  {searchQuery 
                    ? 'Tente uma pesquisa diferente.'
                    : canCreate 
                      ? 'Clique em "Nova Sprint" para criar a primeira.' 
                      : 'Aguarde a criação de uma sprint.'}
                </p>
                {searchQuery && (
                  <Button
                    variant="outline"
                    onClick={() => setSearchQuery('')}
                    className="mt-[16px]"
                  >
                    Limpar pesquisa
                  </Button>
                )}
              </CardContent>
            </Card>
          );
        }

        return (
          <div className="space-y-[24px]">
            {/* Sprint em Andamento - Ocupa toda a linha */}
            <div className="space-y-[16px]">
              <h2 className="text-lg font-semibold text-[var(--color-foreground)]">
                Sprint em Andamento
              </h2>
              {emAndamento.length > 0 ? (
                emAndamento.map((sprint) => {
                  const sprintProjects = getProjectsForSprint(sprint.id);
                  const stats = {
                    total: sprint.cards_total ?? 0,
                    finalizados: sprint.cards_finalizados ?? 0,
                    emAndamento: sprint.cards_em_andamento ?? 0,
                    emAtraso: sprint.cards_em_atraso ?? 0,
                  };
                  return (
                    <Card
                      key={sprint.id}
                      className="group relative cursor-pointer hover:shadow-md transition-shadow w-full"
                      onClick={() => navigate(`/sprints/${sprint.id}`)}
                    >
                      <CardHeader className="p-[24px] pb-[16px]">
                        <div className="flex items-start justify-between">
                          <div className="flex items-center gap-[16px]">
                            <div className="flex h-[48px] w-[48px] items-center justify-center rounded-[8px] bg-[var(--color-primary)]/10">
                              <Zap className="h-[24px] w-[24px] text-[var(--color-primary)]" />
                            </div>
                            <div>
                              <CardTitle className="text-xl">{sprint.nome}</CardTitle>
                              <div className="flex items-center gap-[12px] mt-[8px]">
                                {sprint.finalizada ? (
                                  <Badge variant="secondary">Finalizada</Badge>
                                ) : (
                                  <Badge variant="default">Em Andamento</Badge>
                                )}
                                <span className="text-sm text-[var(--color-muted-foreground)]">
                                  {formatDateTime(sprint.data_inicio)} → {formatDateTime(sprint.fechamento_em)}
                                </span>
                              </div>
                            </div>
                          </div>
                          {((canCreate && !isSprintFinished(sprint)) || canFinalizar || (canDeleteFinished && isSprintFinished(sprint))) && (
                            <div className="flex gap-[8px] opacity-0 group-hover:opacity-100 transition-opacity">
                              {canFinalizar && !sprint.finalizada && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={(e) => handleFinalizarSprint(e, sprint)}
                                  className="h-[32px] w-[32px]"
                                  title="Finalizar sprint"
                                >
                                  <CheckCircle2 className="h-[16px] w-[16px] text-green-600" />
                                </Button>
                              )}
                              {canCreate && !isSprintFinished(sprint) && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={(e) => openEditSprintDialog(e, sprint)}
                                  className="h-[32px] w-[32px]"
                                >
                                  <Pencil className="h-[16px] w-[16px]" />
                                </Button>
                              )}
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={(e) => handleDeleteSprint(e, sprint)}
                                className="h-[32px] w-[32px]"
                              >
                                <Trash2 className="h-[16px] w-[16px] text-red-500" />
                              </Button>
                            </div>
                          )}
                        </div>
                      </CardHeader>
                      <CardContent className="p-[24px] pt-0">
                        {/* Subcards de Estatísticas */}
                        <div className="grid grid-cols-2 md:grid-cols-5 lg:grid-cols-6 gap-[16px]">
                          <div className="bg-[var(--color-muted)]/30 rounded-[8px] border border-[var(--color-border)] p-[16px]">
                            <div className="flex items-center gap-[8px] mb-[8px]">
                              <FolderKanban className="h-[16px] w-[16px] text-[var(--color-muted-foreground)]" />
                              <span className="text-xs text-[var(--color-muted-foreground)]">Projetos</span>
                            </div>
                            <p className="text-2xl font-bold text-[var(--color-foreground)]">
                              {sprintProjects.length}
                            </p>
                          </div>
                          <div className="bg-[var(--color-muted)]/30 rounded-[8px] border border-[var(--color-border)] p-[16px]">
                            <div className="flex items-center gap-[8px] mb-[8px]">
                              <Zap className="h-[16px] w-[16px] text-[var(--color-muted-foreground)]" />
                              <span className="text-xs text-[var(--color-muted-foreground)]">Total Cards</span>
                            </div>
                            <p className="text-2xl font-bold text-[var(--color-foreground)]">
                              {stats.total}
                            </p>
                          </div>
                          <div className="bg-[var(--color-muted)]/30 rounded-[8px] border border-[var(--color-border)] p-[16px]">
                            <div className="flex items-center gap-[8px] mb-[8px]">
                              <CheckCircle2 className="h-[16px] w-[16px] text-green-600" />
                              <span className="text-xs text-[var(--color-muted-foreground)]">Entregues</span>
                            </div>
                            <p className="text-2xl font-bold text-green-600">
                              {stats.finalizados}
                            </p>
                          </div>
                          <div className="bg-[var(--color-muted)]/30 rounded-[8px] border border-[var(--color-border)] p-[16px]">
                            <div className="flex items-center gap-[8px] mb-[8px]">
                              <AlertCircle className="h-[16px] w-[16px] text-blue-600" />
                              <span className="text-xs text-[var(--color-muted-foreground)]">Em Andamento</span>
                            </div>
                            <p className="text-2xl font-bold text-blue-600">
                              {stats.emAndamento}
                            </p>
                          </div>
                          <div className="bg-[var(--color-muted)]/30 rounded-[8px] border border-[var(--color-border)] p-[16px]">
                            <div className="flex items-center gap-[8px] mb-[8px]">
                              <XCircle className="h-[16px] w-[16px] text-red-600" />
                              <span className="text-xs text-[var(--color-muted-foreground)]">Entregues atrasados</span>
                            </div>
                            <p className="text-2xl font-bold text-red-600">
                              {sprint.cards_entregues_atrasados ?? 0}
                            </p>
                          </div>
                          <div className="bg-[var(--color-muted)]/30 rounded-[8px] border border-[var(--color-border)] p-[16px]">
                            <div className="flex items-center gap-[8px] mb-[8px]">
                              <AlertCircle className="h-[16px] w-[16px] text-amber-600" />
                              <span className="text-xs text-[var(--color-muted-foreground)]">Abertos atrasados</span>
                            </div>
                            <p className="text-2xl font-bold text-amber-600">
                              {sprint.cards_abertos_atrasados ?? 0}
                            </p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })
              ) : (
                <Card>
                  <CardContent className="flex flex-col items-center justify-center py-[48px]">
                    <Zap className="h-[48px] w-[48px] text-[var(--color-muted-foreground)] mb-[16px]" />
                    <p className="text-lg font-medium text-[var(--color-foreground)]">
                      Nenhuma sprint em andamento
                    </p>
                    <p className="text-[var(--color-muted-foreground)]">
                      Não há sprints em andamento no momento.
                    </p>
                  </CardContent>
                </Card>
              )}
            </div>

            {/* Sprints Planejadas */}
            <div className="space-y-[16px]">
              <h2 className="text-lg font-semibold text-[var(--color-foreground)]">
                Sprints Planejadas
              </h2>
              {planejadas.length > 0 ? (
                <div className="grid gap-[16px] md:grid-cols-2 lg:grid-cols-3">
                  {planejadas.map((sprint) => {
                    const status = getSprintStatus(sprint);
                    const sprintProjects = getProjectsForSprint(sprint.id);
                    return (
                      <Card
                        key={sprint.id}
                        className="group relative cursor-pointer hover:shadow-md transition-shadow"
                        onClick={() => navigate(`/sprints/${sprint.id}`)}
                      >
                        <CardHeader className="p-[16px] pb-[8px]">
                          <div className="flex items-start justify-between">
                            <div className="flex items-center gap-[16px]">
                              <div className="flex h-[40px] w-[40px] items-center justify-center rounded-[8px] bg-[var(--color-primary)]/10">
                                <Zap className="h-[20px] w-[20px] text-[var(--color-primary)]" />
                              </div>
                              <div>
                                <CardTitle className="text-lg">{sprint.nome}</CardTitle>
                                <div className="flex items-center gap-2 mt-[8px]">
                                  {sprint.finalizada ? (
                                    <Badge variant="secondary">Finalizada</Badge>
                                  ) : (
                                    <>
                                      <Badge variant={status.variant}>
                                        {status.label}
                                      </Badge>
                                      {status.label === 'Futura' && getDaysUntilStart(sprint) !== null && (
                                        <Badge variant="outline" className="text-xs">
                                          Inicia em {getDaysUntilStart(sprint)} {getDaysUntilStart(sprint) === 1 ? 'dia' : 'dias'}
                                        </Badge>
                                      )}
                                    </>
                                  )}
                                </div>
                              </div>
                            </div>
                            {((canCreate && !isSprintFinished(sprint)) || canFinalizar || (canDeleteFinished && isSprintFinished(sprint))) && (
                              <div className="flex gap-[8px] opacity-0 group-hover:opacity-100 transition-opacity">
                                {canFinalizar && !sprint.finalizada && (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={(e) => handleFinalizarSprint(e, sprint)}
                                    className="h-[32px] w-[32px]"
                                    title="Finalizar sprint"
                                  >
                                    <CheckCircle2 className="h-[16px] w-[16px] text-green-600" />
                                  </Button>
                                )}
                                {canCreate && !isSprintFinished(sprint) && (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={(e) => openEditSprintDialog(e, sprint)}
                                    className="h-[32px] w-[32px]"
                                  >
                                    <Pencil className="h-[16px] w-[16px]" />
                                  </Button>
                                )}
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={(e) => handleDeleteSprint(e, sprint)}
                                  className="h-[32px] w-[32px]"
                                >
                                  <Trash2 className="h-[16px] w-[16px] text-red-500" />
                                </Button>
                              </div>
                            )}
                          </div>
                        </CardHeader>
                        <CardContent className="p-[16px] pt-0 space-y-[8px]">
                          <div className="flex items-center gap-[8px] text-sm text-[var(--color-muted-foreground)]">
                            <User className="h-[16px] w-[16px]" />
                            <span>Criado por: {sprint.supervisor_name || 'N/A'}</span>
                          </div>
                          <div className="flex items-center gap-[8px] text-sm text-[var(--color-muted-foreground)]">
                            <Calendar className="h-[16px] w-[16px]" />
                            <span>
                              {formatDateTime(sprint.data_inicio)} → {formatDateTime(sprint.fechamento_em)}
                            </span>
                          </div>
                          <div className="flex items-center gap-[8px] text-sm text-[var(--color-muted-foreground)]">
                            <Clock className="h-[16px] w-[16px]" />
                            <span>
                              Criada em: {formatDateTime(sprint.created_at)}
                            </span>
                          </div>
                          <div className="flex items-center gap-[8px] text-sm text-[var(--color-muted-foreground)]">
                            <CheckCircle2 className="h-[16px] w-[16px]" />
                            <span>
                              Fechada em: {sprint.finalizada ? formatDateTime(sprint.updated_at) : 'Sprint aberta'}
                            </span>
                          </div>
                          <div className="flex items-center gap-[8px] text-sm text-[var(--color-muted-foreground)]">
                            <Clock className="h-[16px] w-[16px]" />
                            <span>
                              Duração: {calcularDiasTotais(sprintInicioDiaParaCalendario(sprint), sprintFimDiaParaCalendario(sprint))} dias ({calcularDiasUteis(sprintInicioDiaParaCalendario(sprint), sprintFimDiaParaCalendario(sprint))} úteis)
                            </span>
                          </div>
                          <div className="flex items-center gap-[8px] text-sm text-[var(--color-muted-foreground)]">
                            <FolderKanban className="h-[16px] w-[16px]" />
                            <span>{sprintProjects.length} projetos</span>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              ) : (
                <Card>
                  <CardContent className="flex flex-col items-center justify-center py-[48px]">
                    <Zap className="h-[48px] w-[48px] text-[var(--color-muted-foreground)] mb-[16px]" />
                    <p className="text-lg font-medium text-[var(--color-foreground)]">
                      Nenhuma sprint planejada
                    </p>
                    <p className="text-[var(--color-muted-foreground)]">
                      Não há sprints planejadas no momento.
                    </p>
                  </CardContent>
                </Card>
              )}
            </div>

            {/* Sprints Finalizadas - Menu Recolhível */}
            <div className="space-y-[16px]">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-[var(--color-foreground)]">
                  Sprints Finalizadas
                </h2>
                {finalizadas.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowFinishedSprints(!showFinishedSprints)}
                    className="flex items-center gap-[8px]"
                  >
                    {showFinishedSprints ? (
                      <>
                        <ChevronUp className="h-[16px] w-[16px]" />
                        Ocultar
                      </>
                    ) : (
                      <>
                        <ChevronDown className="h-[16px] w-[16px]" />
                        Mostrar ({finalizadas.length})
                      </>
                    )}
                  </Button>
                )}
              </div>
              {finalizadas.length > 0 ? (
                showFinishedSprints && (
                  <div className="grid gap-[16px] md:grid-cols-2 lg:grid-cols-3">
                    {finalizadas.map((sprint) => {
                      const status = getSprintStatus(sprint);
                      const sprintProjects = getProjectsForSprint(sprint.id);
                      return (
                        <Card
                          key={sprint.id}
                          className="group relative cursor-pointer hover:shadow-md transition-shadow"
                          onClick={() => navigate(`/sprints/${sprint.id}`)}
                        >
                          <CardHeader className="p-[16px] pb-[8px]">
                            <div className="flex items-start justify-between">
                              <div className="flex items-center gap-[16px]">
                                <div className="flex h-[40px] w-[40px] items-center justify-center rounded-[8px] bg-[var(--color-primary)]/10">
                                  <Zap className="h-[20px] w-[20px] text-[var(--color-primary)]" />
                                </div>
                                <div>
                                  <CardTitle className="text-lg">{sprint.nome}</CardTitle>
                                  <div className="flex items-center gap-2 mt-[8px]">
                                    {sprint.finalizada ? (
                                      <Badge variant="secondary">Finalizada</Badge>
                                    ) : (
                                      <>
                                        <Badge variant={status.variant}>
                                          {status.label}
                                        </Badge>
                                        {status.label === 'Futura' && getDaysUntilStart(sprint) !== null && (
                                          <Badge variant="outline" className="text-xs">
                                            Inicia em {getDaysUntilStart(sprint)} {getDaysUntilStart(sprint) === 1 ? 'dia' : 'dias'}
                                          </Badge>
                                        )}
                                      </>
                                    )}
                                  </div>
                                </div>
                              </div>
                              {((canCreate && !isSprintFinished(sprint)) || canFinalizar || (canDeleteFinished && isSprintFinished(sprint))) && (
                                <div className="flex gap-[8px] opacity-0 group-hover:opacity-100 transition-opacity">
                                  {canFinalizar && !sprint.finalizada && (
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      onClick={(e) => handleFinalizarSprint(e, sprint)}
                                      className="h-[32px] w-[32px]"
                                      title="Finalizar sprint"
                                    >
                                      <CheckCircle2 className="h-[16px] w-[16px] text-green-600" />
                                    </Button>
                                  )}
                                  {canCreate && !isSprintFinished(sprint) && (
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      onClick={(e) => openEditSprintDialog(e, sprint)}
                                      className="h-[32px] w-[32px]"
                                    >
                                      <Pencil className="h-[16px] w-[16px]" />
                                    </Button>
                                  )}
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={(e) => handleDeleteSprint(e, sprint)}
                                    className="h-[32px] w-[32px]"
                                  >
                                    <Trash2 className="h-[16px] w-[16px] text-red-500" />
                                  </Button>
                                </div>
                              )}
                            </div>
                          </CardHeader>
                          <CardContent className="p-[16px] pt-0 space-y-[8px]">
                            <div className="flex items-center gap-[8px] text-sm text-[var(--color-muted-foreground)]">
                              <User className="h-[16px] w-[16px]" />
                              <span>Criado por: {sprint.supervisor_name || 'N/A'}</span>
                            </div>
                            <div className="flex items-center gap-[8px] text-sm text-[var(--color-muted-foreground)]">
                              <Calendar className="h-[16px] w-[16px]" />
                              <span>
                                {formatDateTime(sprint.data_inicio)} → {formatDateTime(sprint.fechamento_em)}
                              </span>
                            </div>
                            <div className="flex items-center gap-[8px] text-sm text-[var(--color-muted-foreground)]">
                              <Clock className="h-[16px] w-[16px]" />
                              <span>
                              Criada em: {formatDateTime(sprint.created_at)}
                            </span>
                          </div>
                          <div className="flex items-center gap-[8px] text-sm text-[var(--color-muted-foreground)]">
                            <CheckCircle2 className="h-[16px] w-[16px]" />
                            <span>
                              Fechada em: {sprint.finalizada ? formatDateTime(sprint.updated_at) : 'Sprint aberta'}
                            </span>
                          </div>
                          <div className="flex items-center gap-[8px] text-sm text-[var(--color-muted-foreground)]">
                            <Clock className="h-[16px] w-[16px]" />
                            <span>
                                Duração: {calcularDiasTotais(sprintInicioDiaParaCalendario(sprint), sprintFimDiaParaCalendario(sprint))} dias ({calcularDiasUteis(sprintInicioDiaParaCalendario(sprint), sprintFimDiaParaCalendario(sprint))} úteis)
                              </span>
                            </div>
                            <div className="flex items-center gap-[8px] text-sm text-[var(--color-muted-foreground)]">
                              <FolderKanban className="h-[16px] w-[16px]" />
                              <span>{sprintProjects.length} projetos</span>
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                )
              ) : (
                <Card>
                  <CardContent className="flex flex-col items-center justify-center py-[48px]">
                    <Zap className="h-[48px] w-[48px] text-[var(--color-muted-foreground)] mb-[16px]" />
                    <p className="text-lg font-medium text-[var(--color-foreground)]">
                      Nenhuma sprint finalizada
                    </p>
                    <p className="text-[var(--color-muted-foreground)]">
                      Não há sprints finalizadas no momento.
                    </p>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        );
      })()}

      {/* Sprint Dialog */}
      <Dialog open={sprintDialogOpen} onOpenChange={setSprintDialogOpen}>
        <DialogContent onClose={() => setSprintDialogOpen(false)}>
          <DialogHeader>
            <DialogTitle>
              {editingSprint ? 'Editar Sprint' : 'Nova Sprint'}
            </DialogTitle>
            <DialogDescription>
              {editingSprint
                ? 'Atualize o nome, o instante de início e o instante de fechamento.'
                : 'Defina o nome, quando a sprint começa (data e hora) e quando ela fecha automaticamente.'}
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
              <Label htmlFor="sprint-data-inicio">Data e hora de início</Label>
              <Input
                id="sprint-data-inicio"
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
              <Label htmlFor="sprint-fechamento-em">Data e hora de fechamento</Label>
              <Input
                id="sprint-fechamento-em"
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
                ) : editingSprint ? (
                  'Salvar Alterações'
                ) : (
                  'Criar Sprint'
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent onClose={() => {
          setDeleteDialogOpen(false);
          setSprintToDelete(null);
        }}>
          <DialogHeader>
            <DialogTitle>Confirmar Exclusão</DialogTitle>
            <DialogDescription>
              {sprintToDelete && isSprintFinished(sprintToDelete) && !canDeleteFinished
                ? 'Apenas administradores podem excluir sprints finalizadas.'
                : sprintToDelete
                ? `Tem certeza que deseja excluir a sprint "${sprintToDelete.nome}"? Esta ação não pode ser desfeita.`
                : 'Tem certeza que deseja excluir esta sprint? Esta ação não pode ser desfeita.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setDeleteDialogOpen(false);
                setSprintToDelete(null);
              }}
              disabled={deleteLoading}
            >
              Cancelar
            </Button>
            {sprintToDelete && (!isSprintFinished(sprintToDelete) || canDeleteFinished) && (
              <Button
                type="button"
                variant="destructive"
                onClick={confirmDeleteSprint}
                disabled={deleteLoading}
              >
                {deleteLoading ? (
                  <>
                    <Loader2 className="mr-[8px] h-[16px] w-[16px] animate-spin" />
                    Excluindo...
                  </>
                ) : (
                  'Excluir'
                )}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Finalizar Sprint Confirmation Dialog */}
      <Dialog open={finalizarDialogOpen} onOpenChange={setFinalizarDialogOpen}>
        <DialogContent
          onClose={() => {
            setFinalizarDialogOpen(false);
            setSprintToFinalizar(null);
            setFinalizarError('');
          }}
        >
          <DialogHeader>
            <DialogTitle>Finalizar sprint</DialogTitle>
            <DialogDescription>
              {sprintToFinalizar
                ? `Tem certeza que deseja finalizar a sprint "${sprintToFinalizar.nome}"? Projetos com cards não entregues serão replicados para a próxima sprint.`
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
                setSprintToFinalizar(null);
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

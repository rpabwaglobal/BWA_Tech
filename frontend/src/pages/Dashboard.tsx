import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { useSprintKanbanWebSocket } from '@/hooks/useSprintKanbanWebSocket';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { sprintService } from '@/services/sprintService';
import { projectService } from '@/services/projectService';
import { cardService, type Card as CardType } from '@/services/cardService';
import { userService, type User } from '@/services/userService';
import type { Project } from '@/services/projectService';
import { formatDate } from '@/lib/dateUtils';
import { QuickCreateCardModal } from '@/components/QuickCreateCardModal';
import { ROUTES } from '@/routes';
import { getSprintEmAndamentoPrincipal } from '@/lib/sprintFechamento';
import { isAdminUser } from '@/lib/roles';
import {
  Zap,
  FolderKanban,
  CheckCircle2,
  Clock,
  TrendingUp,
  Users,
  Code,
  UserX,
  Plus,
  ListChecks,
  Shield,
} from 'lucide-react';

type Stats = {
  totalSprints: number;
  sprintsEmAndamento: number;
  totalProjects: number;
  projetosSprintsAtivas: number;
  activeProjects: number;
  completedProjects: number;
  cardsConcluidosSprintsAtivas: number;
  totalCardsConcluidos: number;
  cardsADesenvolverSprintsAtivas: number;
  cardsEmDesenvolvimentoSprintsAtivas: number;
}

export default function Dashboard() {
  const { user } = useAuth();
  const [stats, setStats] = useState<Stats>({
    totalSprints: 0,
    sprintsEmAndamento: 0,
    totalProjects: 0,
    projetosSprintsAtivas: 0,
    activeProjects: 0,
    completedProjects: 0,
    cardsConcluidosSprintsAtivas: 0,
    totalCardsConcluidos: 0,
    cardsADesenvolverSprintsAtivas: 0,
    cardsEmDesenvolvimentoSprintsAtivas: 0,
  });
  const [recentProjects, setRecentProjects] = useState<Project[]>([]);
  const [cardsInDevelopment, setCardsInDevelopment] = useState<(CardType & { projeto_nome?: string })[]>([]);
  const [developersWithoutCards, setDevelopersWithoutCards] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  /** ID da sprint em andamento — usado no atalho "Meus Cards". */
  const [activeSprintId, setActiveSprintId] = useState<string | null>(null);
  const [quickCreateOpen, setQuickCreateOpen] = useState(false);
  const navigate = useNavigate();

  const developersRef = useRef<User[]>([]);
  const projetosSprintsAtivasRef = useRef<Project[]>([]);
  const refreshDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const recomputeDevelopersWithoutCards = useCallback(
    (cardsSprintsAtivas: CardType[]) => {
      const developers = developersRef.current;
      const allCardsInDevelopment = cardsSprintsAtivas.filter((card) => {
        const statusNormalized = (card.status || '').toLowerCase();
        return statusNormalized === 'em_desenvolvimento';
      });

      const usersWithCards = new Set<string>();
      allCardsInDevelopment.forEach((card) => {
        if (card.responsavel) usersWithCards.add(String(card.responsavel));
      });

      const usersWithout = developers.filter(
        (dev) =>
          dev.role !== 'admin' &&
          dev.role !== 'supervisor' &&
          !usersWithCards.has(String(dev.id)),
      );

      setDevelopersWithoutCards(usersWithout);
    },
    [],
  );

  const refreshDevelopersWithoutCards = useCallback(async () => {
    const projetos = projetosSprintsAtivasRef.current;
    if (!projetos.length) {
      setDevelopersWithoutCards(developersRef.current);
      return;
    }
    try {
      const cardsSprintsAtivas = (
        await Promise.all(
          projetos.map((project) => cardService.getByProject(project.id).catch(() => [])),
        )
      ).flat();
      recomputeDevelopersWithoutCards(cardsSprintsAtivas);
    } catch (error) {
      console.error('Erro ao atualizar usuários sem card:', error);
    }
  }, [recomputeDevelopersWithoutCards]);

  const scheduleRefreshUsersWithoutCards = useCallback(() => {
    if (refreshDebounceRef.current) clearTimeout(refreshDebounceRef.current);
    refreshDebounceRef.current = setTimeout(() => {
      void refreshDevelopersWithoutCards();
    }, 250);
  }, [refreshDevelopersWithoutCards]);

  useSprintKanbanWebSocket({
    sprintId: activeSprintId,
    enabled: Boolean(activeSprintId),
    onKanbanChanged: scheduleRefreshUsersWithoutCards,
  });

  useEffect(() => {
    return () => {
      if (refreshDebounceRef.current) clearTimeout(refreshDebounceRef.current);
    };
  }, []);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [sprints, projects, allUsers] = await Promise.all([
        sprintService.getAll().catch(() => []),
        projectService.getAll().catch(() => []),
        userService.getAll().catch(() => []),
      ]);
      
      // Filtrar apenas usuários que não são admin nem supervisor
      const developers = allUsers.filter(
        (u) => u.role !== 'admin' && u.role !== 'supervisor',
      );
      developersRef.current = developers;

      const activeProjects = projects.filter(
        (p) => p.status === 'em_desenvolvimento' || p.status === 'em_avaliacao'
      ).length;

      const completedProjects = projects.filter(
        (p) => p.status === 'finalizado' || p.status === 'homologado'
      ).length;

      // Sprints em andamento: não finalizadas, já iniciadas e antes do instante de fechamento
      const now = new Date();
      const sprintsEmAndamento = sprints.filter((sprint) => {
        if (sprint.finalizada) return false;
        const start = new Date(sprint.data_inicio);
        start.setHours(0, 0, 0, 0);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const fechamento = new Date(sprint.fechamento_em);
        return today >= start && now <= fechamento;
      });

      // Guarda a primeira sprint ativa para o atalho "Meus Cards"
      setActiveSprintId(
        (() => {
          const principal = getSprintEmAndamentoPrincipal(sprints);
          return principal ? String(principal.id) : null;
        })(),
      );

      // Filtrar projetos das sprints em andamento
      const projetosSprintsAtivas = projects.filter((project) => {
        return sprintsEmAndamento.some((sprint) => {
          const projectSprintId = String(project.sprint || '');
          const sprintId = String(sprint.id || '');
          return projectSprintId === sprintId;
        });
      });
      projetosSprintsAtivasRef.current = projetosSprintsAtivas;

      // Carregar apenas cards de projetos em sprints ativas (evita baixar cards do sistema inteiro)
      const cardsSprintsAtivas = (
        await Promise.all(
          projetosSprintsAtivas.map((project) =>
            cardService.getByProject(project.id).catch(() => [])
          )
        )
      ).flat();

      // Contar cards concluídos das sprints ativas
      const cardsConcluidosSprintsAtivas = projetosSprintsAtivas.reduce(
        (acc, project) => acc + (project.cards_entregues_count ?? 0),
        0
      );

      // Contar total de cards concluídos no geral
      const totalCardsConcluidos = projects.reduce(
        (acc, project) => acc + (project.cards_entregues_count ?? 0),
        0
      );

      // Contar cards "A desenvolver" das sprints ativas
      const cardsADesenvolverSprintsAtivas = cardsSprintsAtivas.filter(
        (card) => card.status === 'a_desenvolver'
      ).length;

      // Contar cards "Em desenvolvimento" das sprints ativas
      const cardsEmDesenvolvimentoSprintsAtivas = cardsSprintsAtivas.filter(
        (card) => card.status === 'em_desenvolvimento'
      ).length;

      setStats({
        totalSprints: sprints.length, // Total de sprints
        sprintsEmAndamento: sprintsEmAndamento.length, // Sprints em andamento
        totalProjects: projects.length,
        projetosSprintsAtivas: projetosSprintsAtivas.length, // Projetos das sprints ativas
        activeProjects,
        completedProjects,
        cardsConcluidosSprintsAtivas, // Cards concluídos das sprints ativas
        totalCardsConcluidos, // Total de cards concluídos
        cardsADesenvolverSprintsAtivas, // Cards "A desenvolver" das sprints ativas
        cardsEmDesenvolvimentoSprintsAtivas, // Cards "Em desenvolvimento" das sprints ativas
      });

      setRecentProjects(projects.slice(0, 5));

      // Filtrar cards em desenvolvimento apenas das sprints em andamento
      const allCardsInDevelopment = cardsSprintsAtivas.filter((card) => {
        // Verificar se o status é 'em_desenvolvimento' (comparação case-insensitive)
        const statusNormalized = (card.status || '').toLowerCase();
        if (statusNormalized !== 'em_desenvolvimento') return false;
        return true;
      });

      const cardsEmDesenvolvimento = allCardsInDevelopment.map((card) => {
        // Tentar encontrar o projeto, mas não bloquear se não encontrar
        const projeto = projects.find((p) => {
          const projectId = String(p.id || '');
          const cardProjectId = String(card.projeto || '');
          return projectId === cardProjectId;
        });
        
        return {
          ...card,
          projeto_nome: projeto?.nome || card.projeto || 'Projeto não encontrado',
        };
      });

      setCardsInDevelopment(cardsEmDesenvolvimento);

      recomputeDevelopersWithoutCards(cardsSprintsAtivas);
    } catch (error) {
      console.error('Erro ao carregar dados:', error);
    } finally {
      setLoading(false);
    }
  };

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Bom dia';
    if (hour < 18) return 'Boa tarde';
    return 'Boa noite';
  };

  /** Pega os 2 primeiros nomes (do first_name) capitalizados.
   *  Fallback para username se first_name vazio. */
  const getDisplayName = (): string => {
    const raw = (user?.first_name ?? '').trim();
    if (!raw) return user?.username ?? '';
    const cap = (w: string) =>
      w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : '';
    return raw
      .split(/\s+/)
      .slice(0, 2)
      .map(cap)
      .join(' ');
  };

  const statCards = [
    {
      title: 'Sprints Ativas',
      value: stats.sprintsEmAndamento,
      subtitle: `Sprints Ativas`,
      totalValue: stats.totalSprints,
      icon: Zap,
      color: 'text-blue-600',
      bgColor: 'bg-blue-50',
    },
    {
      title: 'Total de Projetos',
      value: stats.projetosSprintsAtivas,
      subtitle: `Projetos na Sprint`,
      totalValue: stats.totalProjects,
      icon: FolderKanban,
      color: 'text-purple-600',
      bgColor: 'bg-purple-50',
    },
    {
      title: 'Cards em Andamento',
      value: stats.cardsEmDesenvolvimentoSprintsAtivas,
      subtitle: `Em desenvolvimento`,
      totalValue: stats.cardsADesenvolverSprintsAtivas,
      icon: Clock,
      color: 'text-amber-600',
      bgColor: 'bg-amber-50',
    },
    {
      title: 'Concluídos',
      value: stats.cardsConcluidosSprintsAtivas,
      subtitle: `Concluídos na Sprint Atual`,
      totalValue: stats.totalCardsConcluidos,
      icon: CheckCircle2,
      color: 'text-green-600',
      bgColor: 'bg-green-50',
    },
  ];

  const getStatusBadge = (status: string) => {
    const statusMap: Record<string, { label: string; variant: 'default' | 'secondary' | 'success' | 'warning' | 'destructive' }> = {
      backlog: { label: 'Backlog', variant: 'secondary' },
      em_avaliacao: { label: 'Em Avaliação', variant: 'warning' },
      em_desenvolvimento: { label: 'Em Desenvolvimento', variant: 'default' },
      entregue: { label: 'Entregue', variant: 'success' },
      homologado: { label: 'Homologado', variant: 'success' },
      finalizado: { label: 'Finalizado', variant: 'success' },
    };
    const config = statusMap[status] || { label: status, variant: 'secondary' as const };
    return <Badge variant={config.variant}>{config.label}</Badge>;
  };

  const calculateDaysRemaining = (dataFim: string | null | undefined): number | null => {
    if (!dataFim) return null;
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    const fim = new Date(dataFim);
    fim.setHours(0, 0, 0, 0);
    const diffTime = fim.getTime() - hoje.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  };

  const getInitials = (name: string | undefined): string => {
    if (!name) return '?';
    const parts = name.trim().split(' ');
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  };

  // Nome exibido para usuários: Primeiro nome + primeiro sobrenome (do campo last_name quando existir)
  const getShortDisplayName = (user: User): string => {
    const firstRaw = user.first_name?.trim() ?? '';
    const lastRaw = user.last_name?.trim() ?? '';

    const firstParts = firstRaw.split(/\s+/).filter(Boolean);
    const lastParts = lastRaw.split(/\s+/).filter(Boolean);

    const firstName = firstParts[0] ?? '';
    const firstSurname = lastParts[0] ?? (firstParts.length > 1 ? firstParts[1] : '');

    const name = `${firstName} ${firstSurname}`.trim();
    return name || user.username || '';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[256px]">
        <div className="animate-spin rounded-full h-[32px] w-[32px] border-b-2 border-[var(--color-primary)]"></div>
      </div>
    );
  }

  return (
    <div className="space-y-[16px]">
      {/* Greeting + caixa de Atalhos Rápidos (direita, slim e alinhada
          verticalmente ao bloco de saudação). */}
      <div className="flex items-center justify-between gap-[16px] flex-wrap">
        <div className="min-w-0 flex-1">
          <h2 className="text-2xl font-semibold text-[var(--color-foreground)]">
            {getGreeting()}, {getDisplayName()}!
          </h2>
          <p className="mt-[8px] text-[var(--color-muted-foreground)]">
            Aqui está um resumo do seu ambiente de trabalho.
          </p>
        </div>

        <div className="shrink-0 rounded-lg border border-[var(--color-border)] bg-[var(--color-card)]/40 px-3 py-2.5">
          <div className="text-[10px] uppercase tracking-wider font-medium text-[var(--color-muted-foreground)] mb-2">
            Atalhos Rápidos
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="default"
              onClick={() => setQuickCreateOpen(true)}
              className="gap-2"
            >
              <Plus className="h-4 w-4" />
              Criar Card
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                if (!activeSprintId || !user?.id) return;
                navigate(`${ROUTES.sprintPorId(activeSprintId)}?dev=${user.id}`);
              }}
              disabled={!activeSprintId}
              title={!activeSprintId ? 'Nenhuma sprint em andamento' : undefined}
              className="gap-2"
            >
              <ListChecks className="h-4 w-4" />
              Meus Cards
            </Button>
            {isAdminUser(user) && (
              <Button
                type="button"
                variant="outline"
                onClick={() => navigate(ROUTES.administracao)}
                className="gap-2"
              >
                <Shield className="h-4 w-4" />
                Administração
              </Button>
            )}
          </div>
        </div>
      </div>

      <QuickCreateCardModal isOpen={quickCreateOpen} onClose={() => setQuickCreateOpen(false)} />

      {/* Stats Grid - gap de 16px */}
      <div className="grid gap-[16px] md:grid-cols-2 lg:grid-cols-4">
        {statCards.map((stat) => {
          const Icon = stat.icon;
          return (
            <Card key={stat.title}>
              <CardHeader className="flex flex-row items-center justify-between p-[16px] pb-[8px]">
                <CardTitle className="text-sm font-medium text-[var(--color-muted-foreground)]">
                  {stat.title}
                </CardTitle>
                <div className={`rounded-[8px] p-[8px] ${stat.bgColor}`}>
                  <Icon className={`h-[16px] w-[16px] ${stat.color}`} />
                </div>
              </CardHeader>
              <CardContent className="p-[16px] pt-0">
                <div className="flex items-baseline gap-[8px]">
                  <div className="text-3xl font-bold text-[var(--color-foreground)]">
                    {stat.value}
                  </div>
                  {stat.subtitle && (
                    <span className="text-xs text-[var(--color-muted-foreground)]">
                      {stat.subtitle}
                    </span>
                  )}
                </div>
                {stat.subtitle && (
                  <div className="mt-[4px] text-xs text-[var(--color-muted-foreground)] text-right">
                    {stat.title === 'Cards em Andamento' 
                      ? `${stat.totalValue || stat.value} a desenvolver`
                      : `${stat.totalValue || stat.value} total`}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Cards em Desenvolvimento e Desenvolvedores sem Projeto */}
      <div className="grid gap-[16px] md:grid-cols-2">
        {/* Cards em Desenvolvimento */}
        <Card>
          <CardHeader className="p-[24px]">
            <CardTitle className="flex items-center gap-[8px]">
              <Code className="h-[20px] w-[20px]" />
              Cards em Desenvolvimento
            </CardTitle>
            <CardDescription>
              Cards que estão sendo desenvolvidos atualmente
            </CardDescription>
          </CardHeader>
          <CardContent className="p-[24px] pt-0">
            {cardsInDevelopment.length === 0 ? (
              <p className="text-center py-[32px] text-[var(--color-muted-foreground)]">
                Nenhum card em desenvolvimento no momento.
              </p>
            ) : (
              <div className="space-y-[16px] max-h-[400px] overflow-y-auto pr-2">
                {cardsInDevelopment.map((card) => {
                  const diasRestantes = calculateDaysRemaining(card.data_fim);
                  const isOverdue = diasRestantes !== null && diasRestantes < 0;
                  
                  return (
                    <div
                      key={card.id}
                      className="flex items-center justify-between p-[16px] rounded-[8px] border border-[var(--color-border)] hover:bg-[var(--color-accent)] transition-colors"
                    >
                      <div className="flex items-center gap-[16px]">
                        {/* Avatar do desenvolvedor */}
                        {card.responsavel_name ? (
                          <Avatar className="h-[40px] w-[40px] shrink-0">
                            {card.responsavel_profile_picture_url ? (
                              <AvatarImage src={card.responsavel_profile_picture_url} alt={card.responsavel_name} />
                            ) : null}
                            <AvatarFallback className="bg-[var(--color-primary)]/10 text-[var(--color-primary)] text-sm font-medium">
                              {getInitials(card.responsavel_name)}
                            </AvatarFallback>
                          </Avatar>
                        ) : (
                          <div className="flex h-[40px] w-[40px] items-center justify-center rounded-full bg-[var(--color-muted)] text-[var(--color-muted-foreground)] text-sm font-medium shrink-0">
                            ?
                          </div>
                        )}

                        {/* Informações do card */}
                        <div>
                          <p className="font-medium text-[var(--color-foreground)]">
                            {card.nome}
                          </p>
                          <p className="text-sm text-[var(--color-muted-foreground)]">
                            {card.projeto_nome}
                          </p>
                          {/* Data de início (seta) data de entrega | dias restantes */}
                          <div className="flex items-center gap-[8px] text-xs text-[var(--color-muted-foreground)] mt-[4px]">
                            {card.data_inicio ? (
                              <span>{formatDate(card.data_inicio)}</span>
                            ) : (
                              <span>-</span>
                            )}
                            <span>→</span>
                            {card.data_fim ? (
                              <span>{formatDate(card.data_fim)}</span>
                            ) : (
                              <span>-</span>
                            )}
                            {card.data_fim && diasRestantes !== null && (
                              <>
                                <span>|</span>
                                <span className={isOverdue ? 'text-red-600 font-semibold' : ''}>
                                  {isOverdue ? `${Math.abs(diasRestantes)} dias de atraso` : `${diasRestantes} dias restantes`}
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Usuários sem card */}
        <Card>
          <CardHeader className="p-[24px]">
            <CardTitle className="flex items-center gap-[8px]">
              <UserX className="h-[20px] w-[20px]" />
              Usuários sem card
            </CardTitle>
            <CardDescription>
              Sem card em desenvolvimento na sprint em andamento
            </CardDescription>
          </CardHeader>
          <CardContent className="p-[24px] pt-0">
            {developersWithoutCards.length === 0 ? (
              <p className="text-center py-[32px] text-[var(--color-muted-foreground)]">
                Todos os usuários têm card em desenvolvimento.
              </p>
            ) : (
              <div className="space-y-[16px] max-h-[400px] overflow-y-auto pr-2">
                {developersWithoutCards.map((developer) => {
                  const displayName = getShortDisplayName(developer);

                  return (
                    <div
                      key={developer.id}
                      className="flex items-center justify-between p-[16px] rounded-[8px] border border-[var(--color-border)] hover:bg-[var(--color-accent)] transition-colors"
                    >
                      <div className="flex items-center gap-[16px]">
                        {/* Avatar do desenvolvedor */}
                        <Avatar className="h-[40px] w-[40px] shrink-0">
                          {developer.profile_picture_url ? (
                            <AvatarImage src={developer.profile_picture_url} alt={displayName} />
                          ) : null}
                          <AvatarFallback className="bg-[var(--color-primary)]/10 text-[var(--color-primary)] text-sm font-medium">
                            {getInitials(displayName)}
                          </AvatarFallback>
                        </Avatar>

                        {/* Informações do desenvolvedor */}
                        <div>
                          <p className="font-medium text-[var(--color-foreground)]">
                            {displayName}
                          </p>
                          <p className="text-sm text-[var(--color-muted-foreground)]">
                            {developer.email}
                          </p>
                          <p className="text-xs text-[var(--color-muted-foreground)] mt-[4px]">
                            {developer.role_display || developer.role}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent Projects */}
      <Card>
        <CardHeader className="p-[24px]">
          <CardTitle className="flex items-center gap-[8px]">
            <TrendingUp className="h-[20px] w-[20px]" />
            Projetos Recentes
          </CardTitle>
          <CardDescription>
            Últimos projetos adicionados ao sistema
          </CardDescription>
        </CardHeader>
        <CardContent className="p-[24px] pt-0">
          {recentProjects.length === 0 ? (
            <p className="text-center py-[32px] text-[var(--color-muted-foreground)]">
              Nenhum projeto encontrado.
            </p>
          ) : (
            <div className="space-y-[16px]">
              {recentProjects.map((project) => (
                <div
                  key={project.id}
                  className="flex items-center justify-between p-[16px] rounded-[8px] border border-[var(--color-border)] hover:bg-[var(--color-accent)] transition-colors"
                >
                  <div className="flex items-center gap-[16px]">
                    <div className="flex h-[40px] w-[40px] items-center justify-center rounded-[8px] bg-[var(--color-primary)]/10">
                      <FolderKanban className="h-[20px] w-[20px] text-[var(--color-primary)]" />
                    </div>
                    <div>
                      <p className="font-medium text-[var(--color-foreground)]">
                        {project.nome}
                      </p>
                      <p className="text-sm text-[var(--color-muted-foreground)]">
                        {project.sprint_name || 'Sem sprint'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-[16px]">
                    {project.desenvolvedor_name && (
                      <div className="flex items-center gap-[8px] text-sm text-[var(--color-muted-foreground)]">
                        <Users className="h-[16px] w-[16px]" />
                        {project.desenvolvedor_name}
                      </div>
                    )}
                    {getStatusBadge(project.status)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

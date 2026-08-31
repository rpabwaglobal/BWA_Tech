import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { useSprintKanbanWebSocket } from '@/hooks/useSprintKanbanWebSocket';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import type { Card as CardType } from '@/services/cardService';
import { dashboardService } from '@/services/dashboardService';
import type { User } from '@/services/userService';
import { formatDate } from '@/lib/dateUtils';
import { QuickCreateCardModal } from '@/components/QuickCreateCardModal';
import { ROUTES } from '@/routes';
import {
  Zap,
  FolderKanban,
  CheckCircle2,
  Clock,
  Code,
  UserX,
  Plus,
  ListChecks,
} from 'lucide-react';
import { NumeroCrescente } from '@/components/NumeroCrescente';
import { TelaComCarregamento } from '@/components/TelaComCarregamento';

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
  const [cardsInDevelopment, setCardsInDevelopment] = useState<(CardType & { projeto_nome?: string })[]>([]);
  const [developersWithoutCards, setDevelopersWithoutCards] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  /** ID da sprint em andamento — usado no atalho "Meus Cards". */
  const [activeSprintId, setActiveSprintId] = useState<string | null>(null);
  const [quickCreateOpen, setQuickCreateOpen] = useState(false);
  const navigate = useNavigate();

  /** Base do card "Usuários sem card": SÓ quem participa do trabalho (tem a
   * permissão `view_content`). Quem não participa não enxerga sprint, projeto
   * nem card — cobrar card dessa pessoa não faz sentido. */
  const developersRef = useRef<User[]>([]);
  const refreshDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);



  const refreshDevelopersWithoutCards = useCallback(async () => {
    // Rebusca a lista de PESSOAS junto com os cards — não só os cards. Quem foi
    // desativado (ou perdeu `view_content`) some de
    // `/users/?participa_do_trabalho=true`, mas continuaria em `developersRef`,
    // que só é preenchido no load inicial. Sem isto, desativar alguém — que
    // agora também solta os cards abertos da pessoa — faria todo Dashboard
    // aberto recalcular, não achar mais card dela e PROMOVÊ-LA para "Usuários
    // sem card": o oposto exato do esperado, na tela em que o gestor está
    // olhando logo após desativar a conta. Custo: uma requisição por janela de
    // debounce, ao lado das N de cards que já acontecem aqui.
    // O refresh do tempo real também era N+1: buscava participantes e depois
    // os cards de cada projeto. O resumo já traz a resposta pronta, então aqui
    // é a MESMA requisição da carga inicial — barata o bastante para caber num
    // debounce de 250 ms.
    try {
      const resumo = await dashboardService.obterResumo();
      developersRef.current = resumo.usuarios_sem_card;
      setDevelopersWithoutCards(resumo.usuarios_sem_card);
      setCardsInDevelopment(resumo.cards.lista_em_desenvolvimento);
    } catch (error) {
      console.error('Erro ao atualizar usuários sem card:', error);
    }
  }, []);

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
      // UMA REQUISIÇÃO, e não quarenta.
      //
      // Antes esta função paginava TODOS os projetos em sequência e depois
      // disparava uma busca de cards POR PROJETO, baixando centenas de cards
      // completos para no fim calcular contagens e um conjunto de ids. Medido
      // no navegador: LCP de 6,53 s.
      //
      // Agora o servidor responde o que a tela pergunta. As regras de negócio
      // (o que conta como projeto ativo, quem é o fluxo de monitoramento, qual
      // é a sprint principal) foram para lá EXATAMENTE como estavam aqui —
      // conferidas contra o cálculo antigo, métrica por métrica, nos dados de
      // produção.
      const resumo = await dashboardService.obterResumo();

      developersRef.current = resumo.usuarios_sem_card;
      setActiveSprintId(
        resumo.sprints.principal_id !== null ? String(resumo.sprints.principal_id) : null,
      );

      setStats({
        totalSprints: resumo.sprints.total,
        sprintsEmAndamento: resumo.sprints.em_andamento,
        totalProjects: resumo.projetos.total,
        projetosSprintsAtivas: resumo.projetos.em_sprints_ativas,
        activeProjects: resumo.projetos.ativos,
        completedProjects: resumo.projetos.concluidos,
        cardsConcluidosSprintsAtivas: resumo.cards.entregues_sprints_ativas,
        totalCardsConcluidos: resumo.cards.entregues_total,
        cardsADesenvolverSprintsAtivas: resumo.cards.a_desenvolver,
        cardsEmDesenvolvimentoSprintsAtivas: resumo.cards.em_desenvolvimento,
      });

      setCardsInDevelopment(resumo.cards.lista_em_desenvolvimento);
      setDevelopersWithoutCards(resumo.usuarios_sem_card);
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

  // O RETORNO ANTECIPADO DO CARREGAMENTO SAIU DAQUI, como na página do projeto.
  //
  // A tela renderiza inteira desde o primeiro quadro — saudação, atalhos, os
  // cartões de número, as listas — desfocada, e fica nítida quando o resumo
  // chega. Trocar a página por um spinner e depois pelo conteúdo faz o layout
  // aparecer do nada: o olho não tem para onde ir e a espera parece maior do
  // que foi.
  //
  // Os números nascem em zero e as listas vazias, então a estrutura desenhada
  // durante o carregamento é a real — não é um esqueleto falso que depois é
  // substituído por outra coisa.
  return (
    <TelaComCarregamento carregando={loading} mensagem="Carregando Dashboard…" className="space-y-[16px]">
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
                    <NumeroCrescente valor={stat.value} />
                  </div>
                  {stat.subtitle && (
                    <span className="text-xs text-[var(--color-muted-foreground)]">
                      {stat.subtitle}
                    </span>
                  )}
                </div>
                {stat.subtitle && (
                  <div className="mt-[4px] text-xs text-[var(--color-muted-foreground)] text-right">
                    <NumeroCrescente valor={stat.totalValue || stat.value} />
                    {stat.title === 'Cards em Andamento' ? ' a desenvolver' : ' total'}
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
                {cardsInDevelopment.map((card, i) => {
                  const diasRestantes = calculateDaysRemaining(card.data_fim);
                  const isOverdue = diasRestantes !== null && diasRestantes < 0;
                  
                  return (
                    <div
                      key={card.id}
                      className="card-entra flex items-center justify-between p-[16px] rounded-[8px] border border-[var(--color-border)] hover:bg-[var(--color-accent)] transition-colors"
                      style={{ animationDelay: `${60 + Math.min(i, 6) * 45}ms` }}
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
                {developersWithoutCards.map((developer, i) => {
                  const displayName = getShortDisplayName(developer);

                  return (
                    <div
                      key={developer.id}
                      className="card-entra flex items-center justify-between p-[16px] rounded-[8px] border border-[var(--color-border)] hover:bg-[var(--color-accent)] transition-colors"
                      style={{ animationDelay: `${60 + Math.min(i, 6) * 45}ms` }}
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

    </TelaComCarregamento>
  );
}

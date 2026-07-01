import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { userService } from '@/services/userService';
import { sprintService } from '@/services/sprintService';
import { projectService } from '@/services/projectService';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ROUTES } from '@/routes';
import {
  Shield,
  Users,
  FolderKanban,
  Zap,
  Sparkles,
  Target,
  BarChart3,
  FileText,
  Headset,
  ExternalLink,
  Loader2,
} from 'lucide-react';

type AdminTool = {
  title: string;
  description: string;
  href: string;
  external?: boolean;
  icon: typeof Shield;
};

const ADMIN_TOOLS: AdminTool[] = [
  {
    title: 'Pessoas',
    description: 'Gerir equipe, hierarquias e cargos — incluindo promoção a supervisor.',
    href: ROUTES.pessoas,
    icon: Users,
  },
  {
    title: 'Projetos',
    description: 'Arquivar projetos e excluir demandas inviabilizadas.',
    href: ROUTES.projetos,
    icon: FolderKanban,
  },
  {
    title: 'Sprints',
    description: 'Excluir sprints finalizadas e gerir o ciclo de iterações.',
    href: ROUTES.sprint,
    icon: Zap,
  },
  {
    title: 'Geek Day',
    description: 'Sorteio, reset e gestão completa do evento interno.',
    href: ROUTES.diaGeek,
    icon: Sparkles,
  },
  {
    title: 'Prioridades',
    description: 'Configurar horário limite das prioridades semanais.',
    href: ROUTES.prioridades,
    icon: Target,
  },
  {
    title: 'Métricas',
    description: 'Indicadores operacionais e acompanhamento da operação.',
    href: ROUTES.metricas,
    icon: BarChart3,
  },
  {
    title: 'Relatórios',
    description: 'Relatórios executivos e exportações gerenciais.',
    href: ROUTES.relatorios,
    icon: FileText,
  },
  {
    title: 'Suporte',
    description: 'Kanban completo de tickets e movimentação entre abas.',
    href: ROUTES.suporte,
    icon: Headset,
  },
  {
    title: 'Painel Django',
    description: 'Administração avançada do banco e modelos no servidor.',
    href: '/admin/',
    external: true,
    icon: ExternalLink,
  },
];

export default function Admin() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [userCount, setUserCount] = useState(0);
  const [sprintCount, setSprintCount] = useState(0);
  const [projectCount, setProjectCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [users, sprints, projects] = await Promise.all([
          userService.getAll().catch(() => []),
          sprintService.getAll().catch(() => []),
          projectService.getAll().catch(() => []),
        ]);
        if (cancelled) return;
        setUserCount(users.length);
        setSprintCount(sprints.length);
        setProjectCount(projects.length);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-[16px]">
      <div className="flex flex-wrap items-start justify-between gap-[16px]">
        <div className="min-w-0">
          <div className="flex items-center gap-[10px]">
            <div className="flex h-[40px] w-[40px] items-center justify-center rounded-[10px] bg-[var(--color-primary)]/10">
              <Shield className="h-[20px] w-[20px] text-[var(--color-primary)]" />
            </div>
            <div>
              <h2 className="text-2xl font-semibold text-[var(--color-foreground)]">Administração</h2>
              <p className="text-sm text-[var(--color-muted-foreground)]">
                Ferramentas exclusivas para administradores da plataforma.
              </p>
            </div>
          </div>
          {user && (
            <p className="mt-[10px] text-xs text-[var(--color-muted-foreground)]">
              Sessão: <span className="font-medium text-[var(--color-foreground)]">{user.email}</span>
            </p>
          )}
        </div>
      </div>

      <div className="grid gap-[16px] sm:grid-cols-3">
        {[
          { label: 'Usuários ativos', value: userCount },
          { label: 'Sprints', value: sprintCount },
          { label: 'Projetos', value: projectCount },
        ].map((stat) => (
          <Card key={stat.label}>
            <CardHeader className="p-[16px] pb-[8px]">
              <CardTitle className="text-sm font-medium text-[var(--color-muted-foreground)]">
                {stat.label}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-[16px] pt-0">
              {loading ? (
                <Loader2 className="h-5 w-5 animate-spin text-[var(--color-muted-foreground)]" />
              ) : (
                <div className="text-3xl font-bold text-[var(--color-foreground)]">{stat.value}</div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-[16px] md:grid-cols-2 xl:grid-cols-3">
        {ADMIN_TOOLS.map((tool) => {
          const Icon = tool.icon;
          const content = (
            <Card className="h-full transition-shadow hover:shadow-md">
              <CardHeader className="p-[20px] pb-[8px]">
                <CardTitle className="flex items-center gap-[8px] text-base">
                  <Icon className="h-[18px] w-[18px] shrink-0 text-[var(--color-primary)]" />
                  {tool.title}
                </CardTitle>
                <CardDescription className="text-sm leading-snug">{tool.description}</CardDescription>
              </CardHeader>
              <CardContent className="p-[20px] pt-0">
                <Button type="button" variant="outline" size="sm" className="pointer-events-none">
                  Acessar
                </Button>
              </CardContent>
            </Card>
          );

          if (tool.external) {
            return (
              <a
                key={tool.title}
                href={tool.href}
                target="_blank"
                rel="noreferrer"
                className="block rounded-[inherit] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
              >
                {content}
              </a>
            );
          }

          return (
            <Link
              key={tool.title}
              to={tool.href}
              className="block rounded-[inherit] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
            >
              {content}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

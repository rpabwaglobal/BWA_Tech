import { Link, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useSidebar } from '@/context/SidebarContext';
import { Button } from '@/components/ui/button';
import { sprintService } from '@/services/sprintService';
import { getSprintEmAndamentoPrincipal } from '@/lib/sprintFechamento';
import { BarChart3, CheckSquare, ChevronLeft, ChevronRight, FileText, FolderKanban, Headset, LayoutDashboard, LogOut, Settings, Sparkles, Target, Trophy, Users, Zap } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import { ROUTES, isNavRouteActive } from '@/routes';
import { hasPermission } from '@/lib/permissions';

// `requires`: o item só aparece para quem tem a permissão.
// `view_content` é o piso de leitura do trabalho — sem ela a API devolve 403 em
// sprint/projeto/card, então mostrar o item levaria a uma tela de erro. Fora da
// lista ficam só Suporte (alguém sem acesso precisa conseguir PEDIR acesso) e o
// perfil, no header.
const navigation = [
  { path: ROUTES.painel, label: 'Dashboard', icon: LayoutDashboard, requires: 'view_content' },
  { path: ROUTES.sprint, label: 'Sprints', icon: Zap, requires: 'view_content' },
  { path: ROUTES.projetos, label: 'Projetos', icon: FolderKanban, requires: 'view_content' },
  { path: ROUTES.prioridades, label: 'Prioridades', icon: Target, requires: 'view_content' },
  { path: ROUTES.meusAfazeres, label: 'Meus Afazeres', icon: CheckSquare, requires: 'view_content' },
  { path: ROUTES.pessoas, label: 'Pessoas', icon: Users, requires: 'view_content' },
  { path: ROUTES.metricas, label: 'Métricas', icon: BarChart3, requires: 'view_metrics' },
  { path: ROUTES.relatorios, label: 'Relatórios', icon: FileText, requires: 'view_metrics' },
  { path: ROUTES.suporte, label: 'Suporte', icon: Headset },
  { path: ROUTES.diaGeek, label: 'Geek Day', icon: Sparkles, requires: 'view_geekday' },
];

/** Itens que dependem da permissão de gerenciar Score. */
const scoreNavigation = [
  { path: ROUTES.score, label: 'Score', icon: Trophy },
];

/** Link do menu Sprints → sprint em andamento (ou gerenciar se não houver ativa). */
function SprintNavItem({
  collapsed,
  isActive,
}: {
  collapsed: boolean;
  isActive: boolean;
}) {
  const [href, setHref] = useState<string>(ROUTES.sprint);

  useEffect(() => {
    let cancelled = false;
    void sprintService.getAll().then((sprints) => {
      if (cancelled) return;
      const active = getSprintEmAndamentoPrincipal(sprints);
      setHref(active ? ROUTES.sprintPorId(String(active.id)) : ROUTES.sprintGerenciar);
    }).catch(() => {
      if (!cancelled) setHref(ROUTES.sprintGerenciar);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Link
      to={href}
      className={cn(
        'flex items-center gap-[16px] rounded-[8px] px-[16px] py-[8px] text-sm font-medium transition-colors h-[40px]',
        isActive
          ? 'bg-white/22 text-white shadow-sm'
          : 'text-white/80 hover:bg-white/10 hover:text-white',
        collapsed && 'justify-center px-[8px]',
      )}
      title={collapsed ? 'Sprints' : undefined}
    >
      <Zap className="h-[20px] w-[20px] shrink-0" />
      {!collapsed && <span>Sprints</span>}
    </Link>
  );
}

export default function Sidebar() {
  const { collapsed, toggle } = useSidebar();
  const location = useLocation();
  const { user, logout, profilePictureUrl } = useAuth();

  const getInitials = (name: string) => {
    return name.substring(0, 2).toUpperCase();
  };

  const formatUserName = (u: { first_name?: string; last_name?: string; username: string } | null) => {
    if (!u) return '';

    // Se tiver first_name e last_name, formatar como "Nome S."
    if (u.first_name && u.last_name) {
      const firstName = u.first_name.trim();
      const lastName = u.last_name.trim();
      const formattedFirstName = firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase();
      const lastNameInitial = lastName.charAt(0).toUpperCase();
      return `${formattedFirstName} ${lastNameInitial}.`;
    }

    // Se tiver apenas first_name
    if (u.first_name) {
      const firstName = u.first_name.trim();
      return firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase();
    }

    // Fallback para username com primeira letra maiúscula
    return u.username.charAt(0).toUpperCase() + u.username.slice(1).toLowerCase();
  };

  return (
    <aside
      className={cn(
        "fixed left-0 top-0 z-40 h-screen border-r border-white/10 bg-sidebar-gradient transition-all duration-300",
        collapsed ? "w-[64px]" : "w-[256px]"
      )}
    >
      <div className="flex h-full flex-col">
        {/* Header - 64px (8 * 8) */}
        <div className="flex h-[64px] items-center border-b border-white/15 px-[16px]">
          {!collapsed && (
            <div className="flex-1 flex items-center justify-center">
              <img
                src="/assets/bwa-white.png"
                alt="BWA Tech"
                className="h-[28px] w-auto"
              />
            </div>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={toggle}
            className={cn("h-[40px] w-[40px] text-white hover:bg-white/15 hover:text-white", collapsed && "mx-auto")}
          >
            {collapsed ? <ChevronRight className="h-[16px] w-[16px]" /> : <ChevronLeft className="h-[16px] w-[16px]" />}
          </Button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-[8px] flex flex-col min-h-0">
          <div className="space-y-[8px] overflow-y-auto pr-[4px]">
            {navigation
              .filter((item) => !('requires' in item) || hasPermission(user, item.requires as string))
              .map((item) => {
              const isActive = isNavRouteActive(item.path, location.pathname);
              const Icon = item.icon;

              if (item.path === ROUTES.sprint) {
                return (
                  <SprintNavItem
                    key={item.path}
                    collapsed={collapsed}
                    isActive={isActive}
                  />
                );
              }

              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={cn(
                    "flex items-center gap-[16px] rounded-[8px] px-[16px] py-[8px] text-sm font-medium transition-colors h-[40px]",
                    isActive
                      ? "bg-white/22 text-white shadow-sm"
                      : "text-white/80 hover:bg-white/10 hover:text-white",
                    collapsed && "justify-center px-[8px]"
                  )}
                  title={collapsed ? item.label : undefined}
                >
                  <Icon className="h-[20px] w-[20px] shrink-0" />
                  {!collapsed && <span>{item.label}</span>}
                </Link>
              );
            })}
            {hasPermission(user, 'manage_score') &&
              scoreNavigation.map((item) => {
                const isActive = isNavRouteActive(item.path, location.pathname);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    className={cn(
                      "flex items-center gap-[16px] rounded-[8px] px-[16px] py-[8px] text-sm font-medium transition-colors h-[40px]",
                      isActive
                        ? "bg-white/22 text-white shadow-sm"
                        : "text-white/80 hover:bg-white/10 hover:text-white",
                      collapsed && "justify-center px-[8px]"
                    )}
                    title={collapsed ? item.label : undefined}
                  >
                    <Icon className="h-[20px] w-[20px] shrink-0" />
                    {!collapsed && <span>{item.label}</span>}
                  </Link>
                );
              })}
          </div>
          {/* Configurações — parte de baixo */}
          <div className="mt-auto space-y-[8px]">
            <Link
              to={ROUTES.configuracoes}
              className={cn(
                "flex items-center gap-[16px] rounded-[8px] px-[16px] py-[8px] text-sm font-medium transition-colors h-[40px]",
                location.pathname === ROUTES.configuracoes
                  ? "bg-white/22 text-white shadow-sm"
                  : "text-white/80 hover:bg-white/10 hover:text-white",
                collapsed && "justify-center px-[8px]"
              )}
              title={collapsed ? 'Configurações' : undefined}
            >
              <Settings className="h-[20px] w-[20px] shrink-0" />
              {!collapsed && <span>Configurações</span>}
            </Link>
          </div>
        </nav>

        {/* User — a foto e o nome levam ao perfil; o botão de sair fica FORA do
            link, senão sair navegaria para o perfil no mesmo clique. */}
        <div className="border-t border-white/20 p-[16px]">
          <div className={cn("flex items-center gap-[16px]", collapsed && "justify-center")}>
            <Link
              to={ROUTES.perfil}
              title={collapsed ? 'Meu perfil' : 'Ver meu perfil'}
              className={cn(
                "flex min-w-0 flex-1 items-center gap-[16px] rounded-[8px] p-[4px] transition-colors",
                location.pathname === ROUTES.perfil
                  ? "bg-white/22 shadow-sm"
                  : "hover:bg-white/10",
                collapsed && "flex-none justify-center"
              )}
            >
              <Avatar className="h-[40px] w-[40px] ring-2 ring-white/30">
                {profilePictureUrl && <AvatarImage src={profilePictureUrl} alt="" />}
                <AvatarFallback className="text-sm bg-white/90 text-[#3a2557]">
                  {user ? getInitials(user.username) : 'U'}
                </AvatarFallback>
              </Avatar>
              {!collapsed && (
                <div className="flex-1 min-w-0">
                  <p className="truncate text-sm font-semibold text-white drop-shadow-sm">
                    {formatUserName(user)}
                  </p>
                  <p className="truncate text-xs text-white/75">
                    {user?.role_display}
                  </p>
                </div>
              )}
            </Link>
            {!collapsed && (
              <Button variant="ghost" size="icon" onClick={logout} className="h-[40px] w-[40px] shrink-0 text-white hover:bg-white/15 hover:text-white">
                <LogOut className="h-[16px] w-[16px]" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}

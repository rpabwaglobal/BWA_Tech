import { Link, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useSidebar } from '@/context/SidebarContext';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { sprintService } from '@/services/sprintService';
import { getSprintEmAndamentoPrincipal } from '@/lib/sprintFechamento';
import {
  LayoutDashboard,
  Zap,
  FolderKanban,
  Users,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Target,
  Sparkles,
  CheckSquare,
  Settings,
  Shield,
  BarChart3,
  FileText,
  Headset,
  Trophy,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ROUTES, isNavRouteActive } from '@/routes';
import { isAdminUser, isSupervisorOrAdmin } from '@/lib/roles';

const navigation = [
  { path: ROUTES.painel, label: 'Dashboard', icon: LayoutDashboard },
  { path: ROUTES.sprint, label: 'Sprints', icon: Zap },
  { path: ROUTES.projetos, label: 'Projetos', icon: FolderKanban },
  { path: ROUTES.prioridades, label: 'Prioridades', icon: Target },
  { path: ROUTES.meusAfazeres, label: 'Meus Afazeres', icon: CheckSquare },
  { path: ROUTES.pessoas, label: 'Pessoas', icon: Users },
  { path: ROUTES.metricas, label: 'Métricas', icon: BarChart3 },
  { path: ROUTES.relatorios, label: 'Relatórios', icon: FileText },
  { path: ROUTES.suporte, label: 'Suporte', icon: Headset },
  { path: ROUTES.diaGeek, label: 'Geek Day', icon: Sparkles },
];

/** Itens visíveis apenas para supervisor/admin. */
const supervisorNavigation = [
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
  const [href, setHref] = useState(ROUTES.sprint);

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
            {navigation.map((item) => {
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
            {isSupervisorOrAdmin(user) &&
              supervisorNavigation.map((item) => {
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
          {/* Configurações e Administração — parte de baixo */}
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
            {isAdminUser(user) && (
              <Link
                to={ROUTES.administracao}
                className={cn(
                  "flex items-center gap-[16px] rounded-[8px] px-[16px] py-[8px] text-sm font-medium transition-colors h-[40px]",
                  location.pathname === ROUTES.administracao
                    ? "bg-white/22 text-white shadow-sm"
                    : "text-white/80 hover:bg-white/10 hover:text-white",
                  collapsed && "justify-center px-[8px]"
                )}
                title={collapsed ? 'Administração' : undefined}
              >
                <Shield className="h-[20px] w-[20px] shrink-0" />
                {!collapsed && <span>Administração</span>}
              </Link>
            )}
          </div>
        </nav>

        {/* User */}
        <div className="border-t border-white/20 p-[16px]">
          <div className={cn("flex items-center gap-[16px]", collapsed && "justify-center")}>
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
            {!collapsed && (
              <Button variant="ghost" size="icon" onClick={logout} className="h-[40px] w-[40px] text-white hover:bg-white/15 hover:text-white">
                <LogOut className="h-[16px] w-[16px]" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}

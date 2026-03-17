import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { useSidebar } from '@/context/SidebarContext';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { useTheme } from '@/context/ThemeContext';
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
  BarChart3,
  FileText,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const navigation = [
  { path: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/sprints', label: 'Sprints', icon: Zap },
  { path: '/projects', label: 'Projetos', icon: FolderKanban },
  { path: '/priorities', label: 'Prioridades', icon: Target },
  { path: '/mytasks', label: 'Meus Afazeres', icon: CheckSquare },
  { path: '/people', label: 'Pessoas', icon: Users },
  { path: '/metrics', label: 'Métricas', icon: BarChart3 },
  { path: '/reports', label: 'Relatórios', icon: FileText },
  { path: '/geekday', label: 'Geek Day', icon: Sparkles },
];

export default function Sidebar() {
  const { collapsed, toggle } = useSidebar();
  const location = useLocation();
  const { user, logout, profilePictureUrl } = useAuth();
  const { theme } = useTheme();

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
        "fixed left-0 top-0 z-40 h-screen border-r border-[var(--color-border)] bg-[var(--color-card)] transition-all duration-300",
        collapsed ? "w-[64px]" : "w-[256px]"
      )}
    >
      <div className="flex h-full flex-col">
        {/* Header - 64px (8 * 8) */}
        <div className="flex h-[64px] items-center border-b border-[var(--color-border)] px-[16px]">
          {!collapsed && (
            <div className="flex-1 flex items-center justify-center">
              <img
                src={theme === 'dark' ? '/assets/bwa-white.png' : '/assets/bwa-black.png'}
                alt="BWA Tech"
                className="h-[28px] w-auto"
              />
            </div>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={toggle}
            className={cn("h-[40px] w-[40px]", collapsed && "mx-auto")}
          >
            {collapsed ? <ChevronRight className="h-[16px] w-[16px]" /> : <ChevronLeft className="h-[16px] w-[16px]" />}
          </Button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-[8px] p-[8px] flex flex-col">
          <div className="space-y-[8px]">
            {navigation.map((item) => {
              const isActive = location.pathname === item.path;
              const Icon = item.icon;
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={cn(
                    "flex items-center gap-[16px] rounded-[8px] px-[16px] py-[8px] text-sm font-medium transition-colors h-[40px]",
                    isActive
                      ? "bg-[var(--color-primary)] text-[var(--color-primary-foreground)]"
                      : "text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)]",
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
          {/* Configurações - parte de baixo */}
          <Link
            to="/settings"
            className={cn(
              "flex items-center gap-[16px] rounded-[8px] px-[16px] py-[8px] text-sm font-medium transition-colors h-[40px] mt-auto",
              location.pathname === '/settings'
                ? "bg-[var(--color-primary)] text-[var(--color-primary-foreground)]"
                : "text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)]",
              collapsed && "justify-center px-[8px]"
            )}
            title={collapsed ? 'Configurações' : undefined}
          >
            <Settings className="h-[20px] w-[20px] shrink-0" />
            {!collapsed && <span>Configurações</span>}
          </Link>
        </nav>

        {/* User */}
        <div className="border-t border-[var(--color-border)] p-[16px]">
          <div className={cn("flex items-center gap-[16px]", collapsed && "justify-center")}>
            <Avatar className="h-[40px] w-[40px]">
              {profilePictureUrl && <AvatarImage src={profilePictureUrl} alt="" />}
              <AvatarFallback className="text-sm">
                {user ? getInitials(user.username) : 'U'}
              </AvatarFallback>
            </Avatar>
            {!collapsed && (
              <div className="flex-1 min-w-0">
                <p className="truncate text-sm font-medium text-[var(--color-foreground)]">
                  {formatUserName(user)}
                </p>
                <p className="truncate text-xs text-[var(--color-muted-foreground)]">
                  {user?.role_display}
                </p>
              </div>
            )}
            {!collapsed && (
              <Button variant="ghost" size="icon" onClick={logout} className="h-[40px] w-[40px]">
                <LogOut className="h-[16px] w-[16px]" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}

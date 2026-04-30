import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import { useSidebar } from '@/context/SidebarContext';
import { NotificationsButton } from '@/components/NotificationsButton';
import { cn } from '@/lib/utils';
import { useTheme } from '@/context/ThemeContext';
import { Moon, Sun } from 'lucide-react';

const pageTitles: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/sprints': 'Sprints',
  '/projects': 'Projetos',
  '/people': 'Pessoas',
  '/priorities': 'Prioridades',
  '/mytasks': 'Meus Afazeres',
  '/support': 'Suporte',
  '/geekday': 'Geek Day',
  '/settings': 'Configurações',
  '/tree': 'Árvore de Projetos',
  '/suggestions': 'Sugestões',
};

export default function Layout() {
  const location = useLocation();
  const { collapsed } = useSidebar();
  const { theme, toggleTheme } = useTheme();
  const pathname = location.pathname;

  // Títulos baseados na rota \"mãe\" (ex.: /projects e /projects/:id → \"Projetos\")
  let pageTitle = pageTitles[pathname];
  if (!pageTitle) {
    if (pathname.startsWith('/projects')) {
      pageTitle = 'Projetos';
    } else if (pathname.startsWith('/sprints')) {
      pageTitle = 'Sprints';
    } else if (pathname.startsWith('/priorities')) {
      pageTitle = 'Prioridades';
    } else if (pathname.startsWith('/mytasks')) {
      pageTitle = 'Meus Afazeres';
    } else if (pathname.startsWith('/people')) {
      pageTitle = 'Pessoas';
    } else if (pathname.startsWith('/metrics')) {
      pageTitle = 'Métricas';
    } else if (pathname.startsWith('/support')) {
      pageTitle = 'Suporte';
    } else if (pathname.startsWith('/geekday')) {
      pageTitle = 'Geek Day';
    } else if (pathname.startsWith('/settings')) {
      pageTitle = 'Configurações';
    } else {
      pageTitle = 'BWA Tech';
    }
  }

  return (
    <div className="min-h-screen bg-[var(--color-background)]">
      <Sidebar />
      
      {/* Main content area - margem esquerda ajusta com o sidebar */}
      <div
        className={cn(
          "transition-all duration-300",
          collapsed ? "pl-[64px]" : "pl-[256px]"
        )}
      >
        {/* Header - 64px (8 * 8) */}
        <header className="sticky top-0 z-30 flex h-[64px] items-center border-b border-[var(--color-border)] bg-[var(--color-card)] px-[32px]">
          {/* Coluna esquerda: título da página mãe */}
          <div className="flex items-center">
            <h1 className="text-lg font-semibold text-[var(--color-foreground)]">
              {pageTitle}
            </h1>
          </div>

          {/* Coluna central: logo do site */}
          <div className="flex-1 flex justify-center">
            <img
              src={theme === 'dark' ? '/assets/bwa-tech-white.png' : '/assets/bwa-tech-black.png'}
              alt="BWA Tech"
              className="h-[32px] w-auto"
            />
          </div>

          {/* Coluna direita: actions (tema, notificações) */}
          <div className="flex items-center gap-[16px]">
            <button
              type="button"
              role="switch"
              aria-checked={theme === 'dark'}
              aria-label={
                theme === 'dark'
                  ? 'Modo escuro ativo. Clique para modo claro'
                  : 'Modo claro ativo. Clique para modo escuro'
              }
              title={theme === 'dark' ? 'Alternar para modo claro' : 'Alternar para modo escuro'}
              onClick={toggleTheme}
              className={cn(
                'relative inline-flex h-9 w-14 shrink-0 cursor-pointer items-center rounded-full border border-[var(--color-border)] p-1 shadow-inner transition-colors',
                'bg-[var(--color-muted)] hover:bg-[var(--color-accent)]',
              )}
            >
              <span
                className="pointer-events-none absolute inset-0 flex items-center justify-between px-[6px]"
                aria-hidden
              >
                <Sun
                  className={cn(
                    'h-[14px] w-[14px] shrink-0 transition-opacity',
                    theme === 'light'
                      ? 'text-amber-500 opacity-100'
                      : 'text-[var(--color-muted-foreground)] opacity-40',
                  )}
                />
                <Moon
                  className={cn(
                    'h-[14px] w-[14px] shrink-0 transition-opacity',
                    theme === 'dark'
                      ? 'text-indigo-300 opacity-100'
                      : 'text-[var(--color-muted-foreground)] opacity-40',
                  )}
                />
              </span>
              <span
                className={cn(
                  'relative z-10 h-7 w-7 rounded-full border border-[var(--color-border)] bg-[var(--color-card)] shadow-md transition-transform duration-200 ease-out',
                  theme === 'dark' ? 'translate-x-5' : 'translate-x-0',
                )}
                aria-hidden
              />
            </button>
            <NotificationsButton />
          </div>
        </header>
        
        {/* Content area - padding de 32px (4 * 8) */}
        <main className="p-[32px]">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

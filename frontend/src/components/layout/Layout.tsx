import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import { useSidebar } from '@/context/SidebarContext';
import { NotificationsButton } from '@/components/NotificationsButton';
import { cn } from '@/lib/utils';
import { useTheme } from '@/context/ThemeContext';
import { Moon, Sun } from 'lucide-react';
import { ROUTES } from '@/routes';

const pageTitlesExact: Record<string, string> = {
  [ROUTES.painel]: 'Dashboard',
  [ROUTES.sprint]: 'Sprints',
  [ROUTES.projetos]: 'Projetos',
  [ROUTES.pessoas]: 'Pessoas',
  [ROUTES.prioridades]: 'Prioridades',
  [ROUTES.meusAfazeres]: 'Meus Afazeres',
  [ROUTES.suporte]: 'Suporte',
  [ROUTES.diaGeek]: 'Geek Day',
  [ROUTES.configuracoes]: 'Configurações',
  '/tree': 'Árvore de Projetos',
  '/suggestions': 'Sugestões',
};

export default function Layout() {
  const location = useLocation();
  const { collapsed } = useSidebar();
  const { theme, toggleTheme } = useTheme();
  const pathname = location.pathname;

  let pageTitle = pageTitlesExact[pathname];
  if (!pageTitle) {
    if (pathname.startsWith('/sprint/')) {
      pageTitle = 'Sprints';
    } else if (pathname.startsWith('/projeto/')) {
      pageTitle = 'Projetos';
    } else if (pathname.startsWith(ROUTES.prioridades)) {
      pageTitle = 'Prioridades';
    } else if (pathname.startsWith(ROUTES.meusAfazeres)) {
      pageTitle = 'Meus Afazeres';
    } else if (pathname.startsWith(ROUTES.pessoas)) {
      pageTitle = 'Pessoas';
    } else if (pathname.startsWith(ROUTES.metricas)) {
      pageTitle = 'Métricas';
    } else if (pathname.startsWith(ROUTES.relatorios)) {
      pageTitle = 'Relatórios';
    } else if (pathname.startsWith(ROUTES.suporte)) {
      pageTitle = 'Suporte';
    } else if (pathname.startsWith(ROUTES.diaGeek)) {
      pageTitle = 'Geek Day';
    } else if (pathname.startsWith(ROUTES.configuracoes)) {
      pageTitle = 'Configurações';
    } else {
      pageTitle = 'BWA Tech';
    }
  }

  return (
    <div className="flex min-h-screen bg-[var(--color-background)]">
      <Sidebar />

      {/* Main content area - margem esquerda ajusta com o sidebar */}
      <div
        className={cn(
          'flex min-h-screen min-w-0 flex-1 flex-col transition-all duration-300',
          collapsed ? 'pl-[64px]' : 'pl-[256px]',
        )}
      >
        {/* Header - 64px (8 * 8) */}
        <header className="sticky top-0 z-30 flex h-[64px] shrink-0 items-center border-b border-[var(--color-border)] bg-[var(--color-card)] px-[32px]">
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
        <main className="flex min-h-0 flex-1 flex-col p-[32px]">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

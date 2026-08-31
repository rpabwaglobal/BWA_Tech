import { useRef } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import { useSidebar } from '@/context/SidebarContext';
import { NotificationsButton } from '@/components/NotificationsButton';
import { cn } from '@/lib/utils';
import { useTheme } from '@/context/ThemeContext';
import { ROUTES } from '@/routes';

/** Oito raios, um a cada 45 graus. Menos que isso lê como estrela; mais, como
 *  um borrão no tamanho em que o disco aparece. */
const RAIOS_DO_SOL = [0, 45, 90, 135, 180, 225, 270, 315];

const pageTitlesExact: Record<string, string> = {
  [ROUTES.painel]: 'Dashboard',
  [ROUTES.sprintGerenciar]: 'Gerenciar Sprints',
  [ROUTES.projetos]: 'Projetos',
  [ROUTES.pessoas]: 'Pessoas',
  [ROUTES.prioridades]: 'Prioridades',
  [ROUTES.meusAfazeres]: 'Meus Afazeres',
  [ROUTES.suporte]: 'Suporte',
  [ROUTES.diaGeek]: 'Geek Day',
  [ROUTES.configuracoes]: 'Configurações',
  [ROUTES.perfil]: 'Meu perfil',
  '/tree': 'Árvore de Projetos',
  '/suggestions': 'Sugestões',
};

export default function Layout() {
  const location = useLocation();
  const { collapsed } = useSidebar();
  const { theme, toggleTheme } = useTheme();
  const botaoDoTema = useRef<HTMLButtonElement>(null);
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
    <div className="flex min-h-screen bg-app-mesh">
      <Sidebar />

      {/* Main content area - margem esquerda ajusta com o sidebar */}
      <div
        className={cn(
          'flex min-h-screen min-w-0 flex-1 flex-col transition-all duration-300',
          collapsed ? 'pl-[64px]' : 'pl-[256px]',
        )}
      >
        {/* Header - 64px (8 * 8) */}
        <header className="sticky top-0 z-30 flex h-[64px] shrink-0 items-center border-header-gradient bg-[var(--color-card)] px-[32px]">
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
            {/* ── Sol/lua, e o círculo que abre a partir dele ──
                O disco morfa em vez de trocar de ícone: o núcleo é o mesmo, e é
                a mordida crescendo que faz a lua. Toda a aparência vive em
                `.interruptor-tema__*` no index.css.

                SEM FUNDO PRÓPRIO, DE PROPÓSITO: a mordida é pintada com
                `var(--color-card)`, a cor do cabeçalho. Se o botão tivesse fundo
                (ou um hover que o mudasse), a mordida teria de acompanhar cada
                estado — e no primeiro esquecimento apareceria um círculo cinza
                dentro da lua. */}
            <button
              ref={botaoDoTema}
              type="button"
              role="switch"
              aria-checked={theme === 'dark'}
              aria-label={
                theme === 'dark'
                  ? 'Modo escuro ativo. Clique para modo claro'
                  : 'Modo claro ativo. Clique para modo escuro'
              }
              title={theme === 'dark' ? 'Alternar para modo claro' : 'Alternar para modo escuro'}
              onClick={() => {
                // O CENTRO DO BOTÃO é de onde o círculo abre. Medido no clique,
                // e não guardado: a barra lateral recolhe e o cabeçalho se
                // reorganiza, então uma medida velha nasceria fora do lugar.
                const r = botaoDoTema.current?.getBoundingClientRect();
                toggleTheme(
                  r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : undefined,
                );
              }}
              className={cn(
                'interruptor-tema flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full',
                'transition-colors hover:bg-[var(--color-accent)]',
              )}
            >
              <span className="interruptor-tema__disco" aria-hidden>
                <span className="interruptor-tema__raios">
                  {RAIOS_DO_SOL.map((grau) => (
                    <span
                      key={grau}
                      className="interruptor-tema__raio"
                      style={{ transform: `rotate(${grau}deg) translateY(-11px)` }}
                    />
                  ))}
                </span>
                <span className="interruptor-tema__nucleo" />
                <span className="interruptor-tema__mordida" />
              </span>
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

import { BrowserRouter as Router, Routes, Route, Navigate, useParams } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { NotificationProvider } from './context/NotificationContext';
import { SidebarProvider } from './context/SidebarContext';
import Login from './pages/Login';
import Register from './pages/Register';
import RecoverAccount from './pages/RecoverAccount';
import Dashboard from './pages/Dashboard';
import Sprints from './pages/Sprints';
import SprintEntryRedirect from './components/SprintEntryRedirect';
import SprintDetails from './pages/SprintDetails';
import ProjectDetails from './pages/ProjectDetails';
import Projects from './pages/Projects';
import People from './pages/People';
import Priorities from './pages/Priorities';
import MyTasks from './pages/MyTasks';
import GeekDay from './pages/GeekDay';
import Settings from './pages/Settings';
import Perfil from './pages/Perfil';
import Metrics from './pages/Metrics';
import Reports from './pages/Reports';
import Support from './pages/Support';
import Score from './pages/Score';
import FeedbackPublico from './pages/FeedbackPublico';
import Layout from './components/layout/Layout';
import { Loader2, ShieldAlert } from 'lucide-react';
import { ROUTES } from './routes';
import { hasPermission } from './lib/permissions';

function LegacyProjectToProjeto() {
  const { id } = useParams();
  return <Navigate to={ROUTES.projeto(id!)} replace />;
}

function LegacySprintPorIdRedirect() {
  const { sprintId } = useParams();
  return <Navigate to={ROUTES.sprintPorId(sprintId!)} replace />;
}

function LegacyProjectCardRedirect() {
  const { id, cardId } = useParams();
  return <Navigate to={ROUTES.projetoCard(id!, cardId!)} replace />;
}

function LegacySprintCardRedirect() {
  const { sprintId, cardId } = useParams();
  return <Navigate to={ROUTES.sprintCard(sprintId!, cardId!)} replace />;
}

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--color-background)]">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--color-primary)]" />
      </div>
    );
  }

  return isAuthenticated ? <>{children}</> : <Navigate to={ROUTES.entrar} />;
}

function PublicRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--color-background)]">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--color-primary)]" />
      </div>
    );
  }

  return isAuthenticated ? <Navigate to={ROUTES.painel} /> : <>{children}</>;
}

/** Guard de rota baseado numa permissão granular do catálogo. */
function PermissionRoute({ codename, children }: { codename: string; children: React.ReactNode }) {
  const { isAuthenticated, loading, user } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--color-background)]">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--color-primary)]" />
      </div>
    );
  }

  if (!isAuthenticated) return <Navigate to={ROUTES.entrar} />;

  if (!hasPermission(user, codename)) {
    // Mandar para o painel é o fallback normal — MAS o painel também exige
    // `view_content`. Para quem não a tem, redirecionar para lá seria um laço
    // infinito. Nesse caso a tela explica o que falta, que é a informação de
    // que essa pessoa precisa: ela não errou o caminho, ainda não foi liberada.
    if (!hasPermission(user, 'view_content')) return <SemAcesso />;
    return <Navigate to={ROUTES.painel} replace />;
  }

  return <>{children}</>;
}

/** Conta autenticada que ainda não recebeu acesso ao conteúdo da plataforma. */
function SemAcesso() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-6 text-center">
      <div className="rounded-full bg-[var(--color-muted)] p-4">
        <ShieldAlert className="h-7 w-7 text-[var(--color-muted-foreground)]" strokeWidth={1.5} />
      </div>
      <h1 className="text-xl font-semibold text-[var(--color-foreground)]">
        Sua conta ainda não foi liberada
      </h1>
      <p className="max-w-md text-sm leading-relaxed text-[var(--color-muted-foreground)]">
        Você entrou, mas ainda não tem um cargo e um setor atribuídos — por isso as
        sprints, os projetos e os cards não aparecem. Peça a um gestor da plataforma
        para liberar o seu acesso.
      </p>
    </div>
  );
}

function AppRoutes() {
  return (
    <Routes>
      {/* Formulário público de feedback — a única rota ANÔNIMA de conteúdo.
          Fica FORA de `PublicRoute` (que mandaria um funcionário logado para o
          painel, e quem abre o link pode estar logado no mesmo navegador) e FORA
          do bloco `path="/"` com PrivateRoute/Layout (que carregaria sidebar,
          notificações e WebSocket para um estranho). Caminho literal porque
          `routes.ts` é da navegação interna, e este link nunca é navegado de
          dentro do sistema: ele é copiado e enviado à mão. */}
      <Route path="/feedback/:token" element={<FeedbackPublico />} />

      {/* Rotas públicas (português) */}
      <Route
        path={ROUTES.entrar}
        element={
          <PublicRoute>
            <Login />
          </PublicRoute>
        }
      />
      <Route
        path={ROUTES.cadastro}
        element={
          <PublicRoute>
            <Register />
          </PublicRoute>
        }
      />
      <Route
        path={ROUTES.recuperarConta}
        element={
          <PublicRoute>
            <RecoverAccount />
          </PublicRoute>
        }
      />
      {/* Redirecionamento de URLs antigas (inglês) */}
      <Route path="/login" element={<Navigate to={ROUTES.entrar} replace />} />
      <Route path="/register" element={<Navigate to={ROUTES.cadastro} replace />} />

      <Route
        path="/"
        element={
          <PrivateRoute>
            <NotificationProvider>
              <SidebarProvider>
                <Layout />
              </SidebarProvider>
            </NotificationProvider>
          </PrivateRoute>
        }
      >
        {/* As rotas de conteúdo exigem `view_content`: sem ela a API responde
            403, e sem a guarda quem digitasse a URL cairia numa tela quebrada em
            vez de um aviso. As rotas de redirecionamento ficam de fora — elas só
            apontam para uma rota que já tem a guarda. */}
        <Route index element={<Navigate to={ROUTES.painel} replace />} />
        <Route path={ROUTES.painel.replace(/^\//, '')} element={
            <PermissionRoute codename="view_content">
              <Dashboard />
            </PermissionRoute>
          } />
        <Route path={ROUTES.sprintGerenciar.replace(/^\//, '')} element={
            <PermissionRoute codename="view_content">
              <Sprints />
            </PermissionRoute>
          } />
        <Route path="sprint/:sprintId/card/:cardId" element={
            <PermissionRoute codename="view_content">
              <SprintDetails />
            </PermissionRoute>
          } />
        <Route path="sprint/:sprintId" element={
            <PermissionRoute codename="view_content">
              <SprintDetails />
            </PermissionRoute>
          } />
        <Route path={ROUTES.sprint.replace(/^\//, '')} element={<SprintEntryRedirect />} />
        <Route path="iteracoes" element={<Navigate to={ROUTES.sprint} replace />} />
        <Route path="iteracao/:sprintId" element={<LegacySprintPorIdRedirect />} />
        <Route path="sprints" element={<Navigate to={ROUTES.sprint} replace />} />
        <Route path="sprints/:sprintId/card/:cardId" element={<LegacySprintCardRedirect />} />
        <Route path="sprints/:sprintId" element={<LegacySprintPorIdRedirect />} />
        <Route path="projeto/:id/card/:cardId" element={
            <PermissionRoute codename="view_content">
              <ProjectDetails />
            </PermissionRoute>
          } />
        <Route path="projeto/:id" element={
            <PermissionRoute codename="view_content">
              <ProjectDetails />
            </PermissionRoute>
          } />
        <Route path={ROUTES.projetos.replace(/^\//, '')} element={
            <PermissionRoute codename="view_content">
              <Projects />
            </PermissionRoute>
          } />
        <Route path={ROUTES.pessoas.replace(/^\//, '')} element={
            <PermissionRoute codename="view_content">
              <People />
            </PermissionRoute>
          } />
        <Route path={ROUTES.prioridades.replace(/^\//, '')} element={
            <PermissionRoute codename="view_content">
              <Priorities />
            </PermissionRoute>
          } />
        <Route path="meus-afazeres" element={
            <PermissionRoute codename="view_content">
              <MyTasks />
            </PermissionRoute>
          } />
        <Route
          path={ROUTES.metricas.replace(/^\//, '')}
          element={
            <PermissionRoute codename="view_metrics">
              <Metrics />
            </PermissionRoute>
          }
        />
        <Route
          path={ROUTES.relatorios.replace(/^\//, '')}
          element={
            <PermissionRoute codename="view_metrics">
              <Reports />
            </PermissionRoute>
          }
        />
        <Route path={ROUTES.suporte.replace(/^\//, '')} element={<Support />} />
        <Route
          path={ROUTES.score.replace(/^\//, '')}
          element={
            <PermissionRoute codename="manage_score">
              <Score />
            </PermissionRoute>
          }
        />
        <Route
          path="dia-geek"
          element={
            <PermissionRoute codename="view_geekday">
              <GeekDay />
            </PermissionRoute>
          }
        />
        <Route path={ROUTES.configuracoes.replace(/^\//, '')} element={<Settings />} />
        <Route path={ROUTES.perfil.replace(/^\//, '')} element={<Perfil />} />

        {/* Legado: painel e demais rotas em inglês */}
        <Route path="dashboard" element={<Navigate to={ROUTES.painel} replace />} />
        <Route path="people" element={<Navigate to={ROUTES.pessoas} replace />} />
        <Route path="priorities" element={<Navigate to={ROUTES.prioridades} replace />} />
        <Route path="mytasks" element={<Navigate to={ROUTES.meusAfazeres} replace />} />
        <Route path="metrics" element={<Navigate to={ROUTES.metricas} replace />} />
        <Route path="reports" element={<Navigate to={ROUTES.relatorios} replace />} />
        <Route path="support" element={<Navigate to={ROUTES.suporte} replace />} />
        <Route path="geekday" element={<Navigate to={ROUTES.diaGeek} replace />} />
        <Route path="settings" element={<Navigate to={ROUTES.configuracoes} replace />} />
        <Route path="projects" element={<Navigate to={ROUTES.projetos} replace />} />
        <Route path="projects/:id/card/:cardId" element={<LegacyProjectCardRedirect />} />
        <Route path="projects/:id" element={<LegacyProjectToProjeto />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Router>
        <AppRoutes />
      </Router>
    </AuthProvider>
  );
}

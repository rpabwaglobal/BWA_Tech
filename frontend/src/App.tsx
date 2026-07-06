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
import Admin from './pages/Admin';
import Metrics from './pages/Metrics';
import Reports from './pages/Reports';
import Support from './pages/Support';
import Score from './pages/Score';
import Layout from './components/layout/Layout';
import { Loader2 } from 'lucide-react';
import { ROUTES } from './routes';
import { isAdminUser, isSupervisorOrAdmin } from './lib/roles';

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

function AdminRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, loading, user } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--color-background)]">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--color-primary)]" />
      </div>
    );
  }

  if (!isAuthenticated) return <Navigate to={ROUTES.entrar} />;
  if (!isAdminUser(user)) return <Navigate to={ROUTES.painel} replace />;

  return <>{children}</>;
}

function SupervisorRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, loading, user } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--color-background)]">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--color-primary)]" />
      </div>
    );
  }

  if (!isAuthenticated) return <Navigate to={ROUTES.entrar} />;
  if (!isSupervisorOrAdmin(user)) return <Navigate to={ROUTES.painel} replace />;

  return <>{children}</>;
}

function AppRoutes() {
  return (
    <Routes>
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
        <Route index element={<Navigate to={ROUTES.painel} replace />} />
        <Route path={ROUTES.painel.replace(/^\//, '')} element={<Dashboard />} />
        <Route path="sprint/gerenciar" element={<Sprints />} />
        <Route path="sprint/:sprintId/card/:cardId" element={<SprintDetails />} />
        <Route path="sprint/:sprintId" element={<SprintDetails />} />
        <Route path={ROUTES.sprint.replace(/^\//, '')} element={<SprintEntryRedirect />} />
        <Route path="iteracoes" element={<Navigate to={ROUTES.sprint} replace />} />
        <Route path="iteracao/:sprintId" element={<LegacySprintPorIdRedirect />} />
        <Route path="sprints" element={<Navigate to={ROUTES.sprint} replace />} />
        <Route path="sprints/:sprintId/card/:cardId" element={<LegacySprintCardRedirect />} />
        <Route path="sprints/:sprintId" element={<LegacySprintPorIdRedirect />} />
        <Route path="projeto/:id/card/:cardId" element={<ProjectDetails />} />
        <Route path="projeto/:id" element={<ProjectDetails />} />
        <Route path={ROUTES.projetos.replace(/^\//, '')} element={<Projects />} />
        <Route path={ROUTES.pessoas.replace(/^\//, '')} element={<People />} />
        <Route path={ROUTES.prioridades.replace(/^\//, '')} element={<Priorities />} />
        <Route path="meus-afazeres" element={<MyTasks />} />
        <Route path={ROUTES.metricas.replace(/^\//, '')} element={<Metrics />} />
        <Route path={ROUTES.relatorios.replace(/^\//, '')} element={<Reports />} />
        <Route path={ROUTES.suporte.replace(/^\//, '')} element={<Support />} />
        <Route
          path={ROUTES.score.replace(/^\//, '')}
          element={
            <SupervisorRoute>
              <Score />
            </SupervisorRoute>
          }
        />
        <Route path="dia-geek" element={<GeekDay />} />
        <Route path={ROUTES.configuracoes.replace(/^\//, '')} element={<Settings />} />
        <Route
          path={ROUTES.administracao.replace(/^\//, '')}
          element={
            <AdminRoute>
              <Admin />
            </AdminRoute>
          }
        />

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
        <Route path="admin" element={<Navigate to={ROUTES.administracao} replace />} />
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

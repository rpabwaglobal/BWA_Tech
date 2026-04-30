import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { NotificationProvider } from './context/NotificationContext';
import { SidebarProvider } from './context/SidebarContext';
import Login from './pages/Login';
import Register from './pages/Register';
import Dashboard from './pages/Dashboard';
import Sprints from './pages/Sprints';
import SprintDetails from './pages/SprintDetails';
import ProjectDetails from './pages/ProjectDetails';
import Projects from './pages/Projects';
import People from './pages/People';
import Priorities from './pages/Priorities';
import MyTasks from './pages/MyTasks';
import GeekDay from './pages/GeekDay';
import Settings from './pages/Settings';
import Metrics from './pages/Metrics';
import Reports from './pages/Reports';
import Support from './pages/Support';
import Layout from './components/layout/Layout';
import { Loader2 } from 'lucide-react';

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--color-background)]">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--color-primary)]" />
      </div>
    );
  }

  return isAuthenticated ? <>{children}</> : <Navigate to="/login" />;
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

  return isAuthenticated ? <Navigate to="/dashboard" /> : <>{children}</>;
}

function AppRoutes() {
  return (
    <Routes>
      <Route
        path="/login"
        element={
          <PublicRoute>
            <Login />
          </PublicRoute>
        }
      />
      <Route
        path="/register"
        element={
          <PublicRoute>
            <Register />
          </PublicRoute>
        }
      />
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
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="sprints/:sprintId" element={<SprintDetails />} />
        <Route path="sprints" element={<Sprints />} />
        <Route path="projects/:id" element={<ProjectDetails />} />
        <Route path="projects" element={<Projects />} />
        <Route path="people" element={<People />} />
        <Route path="priorities" element={<Priorities />} />
        <Route path="mytasks" element={<MyTasks />} />
        <Route path="metrics" element={<Metrics />} />
        <Route path="reports" element={<Reports />} />
        <Route path="support" element={<Support />} />
        <Route path="geekday" element={<GeekDay />} />
        <Route path="settings" element={<Settings />} />
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

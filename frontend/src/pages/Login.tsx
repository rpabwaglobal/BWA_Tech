import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2 } from 'lucide-react';
import { ROUTES } from '../routes';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await login(username, password);
      navigate(ROUTES.painel);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Credenciais inválidas. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--color-secondary)] p-[var(--space-2)]">
      <Card className="w-full max-w-[400px]">
        <CardHeader className="space-y-[var(--space-1)] p-[var(--space-3)] pb-0 text-center">
          <CardTitle className="text-2xl font-bold tracking-tight">
            BWA Tech
          </CardTitle>
          <CardDescription>
            Gerenciador de Projetos
          </CardDescription>
        </CardHeader>
        <CardContent className="p-[var(--space-3)]">
          <form onSubmit={handleSubmit} className="space-y-[var(--space-2)]">
            <div className="space-y-[var(--space-1)]">
              <Label htmlFor="username">Usuário</Label>
              <Input
                id="username"
                type="text"
                placeholder="Digite seu nome de usuário"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                autoFocus
                autoComplete="username"
              />
            </div>

            <div className="space-y-[var(--space-1)]">
              <Label htmlFor="password">Senha</Label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
            </div>

            {error && (
              <div className="p-[var(--space-1)] text-sm text-[var(--color-destructive)] bg-red-50 border border-red-200 rounded-[var(--radius-md)]">
                {error}
              </div>
            )}

            <Button type="submit" className="w-full mt-[var(--space-1)]" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="mr-[var(--space-1)] h-4 w-4 animate-spin" />
                  Autenticando...
                </>
              ) : (
                'Entrar'
              )}
            </Button>

            <p className="text-center text-sm text-muted-foreground mt-[var(--space-2)]">
              Não tem conta?{' '}
              <Link to={ROUTES.cadastro} className="text-[var(--color-primary)] font-medium hover:underline">
                Criar conta
              </Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

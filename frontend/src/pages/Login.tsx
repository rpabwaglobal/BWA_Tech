import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { ROUTES } from '../routes';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const { theme } = useTheme();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const successMessage = searchParams.get('recovered') === '1'
    ? 'Senha redefinida com sucesso! Faça login.'
    : '';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await login(email, password);
      navigate(ROUTES.painel);
    } catch (err: any) {
      const status = err.response?.status;
      // Mensagem genérica para evitar enumeração de usuários
      if (status === 429) {
        setError('Muitas tentativas. Aguarde alguns minutos e tente novamente.');
      } else {
        setError('Credenciais inválidas. Tente novamente.');
      }
      // Detalhe vai apenas para o console (ajuda debug sem vazar para UI)
      if (import.meta.env.DEV) console.debug('[Login] failed', status);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--color-background)] p-[var(--space-2)]">
      <Card className="w-full max-w-[400px]">
        <CardHeader className="space-y-[var(--space-1)] p-[var(--space-3)] pb-0 text-center">
          <img
            src={theme === 'dark' ? '/assets/bwa-tech-white.png' : '/assets/bwa-tech-black.png'}
            alt="BWA Tech"
            className="h-8 mx-auto"
          />
          <CardDescription>
            Gerenciador de Projetos
          </CardDescription>
        </CardHeader>
        <CardContent className="p-[var(--space-3)]">
          <form onSubmit={handleSubmit} className="space-y-[var(--space-2)]">
            <div className="space-y-[var(--space-1)]">
              <Label htmlFor="email">E-mail</Label>
              <Input
                id="email"
                type="email"
                placeholder="usuario@bwa.global"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
                autoComplete="email"
              />
            </div>

            <div className="space-y-[var(--space-1)]">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Senha</Label>
                <Link
                  to={ROUTES.recuperarConta}
                  className="text-xs text-[var(--color-muted-foreground)] hover:text-[var(--color-primary)] hover:underline transition-colors"
                >
                  Esqueci minha senha
                </Link>
              </div>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  className="w-full pr-9"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-0 top-0 h-8 w-8 shrink-0"
                  onClick={() => setShowPassword((v) => !v)}
                  title={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            {successMessage && (
              <div className="p-[var(--space-1)] text-sm text-green-700 bg-green-50 border border-green-200 rounded-[var(--radius-md)]">
                {successMessage}
              </div>
            )}

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

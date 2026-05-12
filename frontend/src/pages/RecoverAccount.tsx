import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { authService } from '../services/authService';
import { useTheme } from '../context/ThemeContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { ROUTES } from '../routes';

const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]).{12,}$/;
const RECOVERY_CODE_REGEX = /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;
const PASSWORD_RULES_LABEL = 'Mínimo 12 caracteres com maiúscula, minúscula, número e caractere especial.';

function formatRecoveryCode(raw: string): string {
  const clean = raw.replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 12);
  const parts = [clean.slice(0, 4), clean.slice(4, 8), clean.slice(8, 12)].filter(Boolean);
  return parts.join('-');
}

export default function RecoverAccount() {
  const [recoveryCode, setRecoveryCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { theme } = useTheme();
  const navigate = useNavigate();

  const passwordStrength = (() => {
    if (!newPassword) return 0;
    let score = 0;
    if (newPassword.length >= 8) score++;
    if (/[A-Z]/.test(newPassword)) score++;
    if (/[a-z]/.test(newPassword)) score++;
    if (/[\W_]/.test(newPassword)) score++;
    return score;
  })();
  const strengthLabels = ['', 'Fraca', 'Razoável', 'Boa', 'Forte'];
  const strengthColors = ['', 'bg-red-500', 'bg-yellow-400', 'bg-blue-400', 'bg-green-500'];

  const handleCodeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setRecoveryCode(formatRecoveryCode(e.target.value));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!RECOVERY_CODE_REGEX.test(recoveryCode)) {
      setError('Código deve estar no formato XXXX-XXXX-XXXX.');
      return;
    }
    if (!PASSWORD_REGEX.test(newPassword)) {
      setError(PASSWORD_RULES_LABEL);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('As senhas não coincidem.');
      return;
    }
    setLoading(true);
    try {
      await authService.recoverAccount(recoveryCode, newPassword);
      navigate(ROUTES.entrar + '?recovered=1');
    } catch (err: any) {
      // Mensagem genérica (mitigação de enumeração / timing).
      const status = err.response?.status;
      if (status === 429) {
        setError('Muitas tentativas. Aguarde alguns minutos.');
      } else {
        setError('Código inválido ou expirado.');
      }
      if (import.meta.env.DEV) console.debug('[Recover] failed', status);
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
            Recuperação de conta
          </CardDescription>
        </CardHeader>
        <CardContent className="p-[var(--space-3)]">
          <form onSubmit={handleSubmit} className="space-y-[var(--space-2)]">
            <div className="space-y-[var(--space-1)]">
              <Label htmlFor="recoveryCode">Código de recuperação</Label>
              <Input
                id="recoveryCode"
                type="text"
                placeholder="XXXX-XXXX-XXXX"
                value={recoveryCode}
                onChange={handleCodeChange}
                maxLength={14}
                required
                autoFocus
                autoComplete="off"
                className="font-mono tracking-widest"
              />
            </div>

            <div className="space-y-[var(--space-1)]">
              <Label htmlFor="newPassword">Nova senha</Label>
              <div className="relative">
                <Input
                  id="newPassword"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="8+ caracteres, maiúscula, minúscula e especial"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  autoComplete="new-password"
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
              {newPassword && (
                <div className="space-y-1">
                  <div className="flex gap-1">
                    {[1, 2, 3, 4].map((level) => (
                      <div
                        key={level}
                        className={`h-1 flex-1 rounded-full transition-colors ${
                          passwordStrength >= level
                            ? strengthColors[passwordStrength]
                            : 'bg-[var(--color-border)]'
                        }`}
                      />
                    ))}
                  </div>
                  <p className="text-xs text-[var(--color-muted-foreground)]">
                    Senha: {strengthLabels[passwordStrength]}
                  </p>
                </div>
              )}
            </div>

            <div className="space-y-[var(--space-1)]">
              <Label htmlFor="confirmPassword">Confirmar senha</Label>
              <div className="relative">
                <Input
                  id="confirmPassword"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Digite a senha novamente"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  autoComplete="new-password"
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

            {error && (
              <div className="p-[var(--space-1)] text-sm text-[var(--color-destructive)] bg-red-50 border border-red-200 rounded-[var(--radius-md)]">
                {error}
              </div>
            )}

            <Button type="submit" className="w-full mt-[var(--space-1)]" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="mr-[var(--space-1)] h-4 w-4 animate-spin" />
                  Redefinindo senha...
                </>
              ) : (
                'Redefinir senha'
              )}
            </Button>

            <p className="text-center text-sm text-muted-foreground mt-[var(--space-2)]">
              Lembrou sua senha?{' '}
              <Link to={ROUTES.entrar} className="text-[var(--color-primary)] font-medium hover:underline">
                Entrar
              </Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

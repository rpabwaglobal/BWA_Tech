import { useState, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import type { User } from '../services/authService';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ImageCrop } from '@/components/ui/image-crop';
import { Loader2, UserPlus, Camera, Eye, EyeOff, Copy, Check } from 'lucide-react';
import { ROUTES } from '../routes';

const EMAIL_DOMAIN = '@bwa.global';
// Mínimo 12 chars + maiúscula + minúscula + dígito + especial (whitelist explícito).
const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]).{12,}$/;
const PASSWORD_RULES_LABEL =
  'Mínimo 12 caracteres com maiúscula, minúscula, número e caractere especial.';
// Tipos permitidos para foto de perfil (defesa em profundidade — backend revalida).
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

function generateRandomPassword(): string {
  // 12 chars mínimo (regex exige), com CSPRNG (crypto.getRandomValues).
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghjkmnpqrstuvwxyz';
  const digits = '23456789';
  const special = '!@#$%&*';
  const cryptoRand = (max: number): number => {
    const arr = new Uint32Array(1);
    crypto.getRandomValues(arr);
    return arr[0] % max;
  };
  const pick = (s: string) => s[cryptoRand(s.length)];
  let p = pick(upper) + pick(lower) + pick(digits) + pick(special);
  const all = upper + lower + digits + special;
  for (let i = 0; i < 12; i++) p += pick(all);
  // Embaralha com Fisher–Yates baseado em CSPRNG
  const arr = p.split('');
  for (let i = arr.length - 1; i > 0; i--) {
    const j = cryptoRand(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.join('');
}

export default function Register() {
  const [firstName, setFirstName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [profilePictureFile, setProfilePictureFile] = useState<File | null>(null);
  const [profilePreviewUrl, setProfilePreviewUrl] = useState<string | null>(null);
  const [cropOpen, setCropOpen] = useState(false);
  const [cropSource, setCropSource] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState('');
  const [pendingUser, setPendingUser] = useState<User | null>(null);
  const [showRecoveryModal, setShowRecoveryModal] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { register, finalizeAuth } = useAuth();
  const navigate = useNavigate();

  const passwordStrength = (() => {
    if (!password) return 0;
    let score = 0;
    if (password.length >= 8) score++;
    if (/[A-Z]/.test(password)) score++;
    if (/[a-z]/.test(password)) score++;
    if (/[\W_]/.test(password)) score++;
    return score;
  })();
  const strengthLabels = ['', 'Fraca', 'Razoável', 'Boa', 'Forte'];
  const strengthColors = ['', 'bg-red-500', 'bg-yellow-400', 'bg-blue-400', 'bg-green-500'];

  const displayName = firstName.trim() || username;
  const displayNameAbbreviated = (() => {
    const name = displayName.trim();
    if (!name) return '';
    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length <= 1) return name;
    return parts[0] + ' ' + parts.slice(1).map((p) => p[0] + '.').join(' ');
  })();
  const getInitials = () => {
    if (firstName.trim()) {
      const parts = firstName.trim().split(/\s+/);
      if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
      return firstName.trim().substring(0, 2).toUpperCase();
    }
    if (username) return username.substring(0, 2).toUpperCase();
    return 'U';
  };

  const handlePhotoClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Whitelist explícito de tipos (SVG/HEIC ficam de fora — risco XSS)
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      setError('Imagem deve ser JPEG, PNG ou WebP.');
      e.target.value = '';
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError('Imagem deve ter no máximo 5 MB.');
      e.target.value = '';
      return;
    }
    setError('');
    const reader = new FileReader();
    reader.onload = () => {
      setCropSource(reader.result as string);
      setCropOpen(true);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleCropComplete = (dataUrl: string) => {
    setCropOpen(false);
    setCropSource(null);
    setProfilePreviewUrl(dataUrl);
    fetch(dataUrl)
      .then((r) => r.blob())
      .then((blob) => {
        const file = new File([blob], 'profile.png', { type: 'image/png' });
        setProfilePictureFile(file);
      });
  };

  const handleCopyCode = async () => {
    await navigator.clipboard.writeText(recoveryCode);
    setCodeCopied(true);
    setTimeout(() => setCodeCopied(false), 2000);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const emailTrim = email.trim().toLowerCase();
    if (!emailTrim.endsWith(EMAIL_DOMAIN)) {
      setError(`O e-mail deve ser do domínio ${EMAIL_DOMAIN}`);
      return;
    }
    if (!PASSWORD_REGEX.test(password)) {
      setError(PASSWORD_RULES_LABEL);
      return;
    }
    if (password !== confirmPassword) {
      setError('As senhas não coincidem.');
      return;
    }
    setLoading(true);

    try {
      const { recovery_code, user } = await register({
        first_name: firstName.trim(),
        username,
        email,
        password,
        profile_picture: profilePictureFile ?? undefined,
      });
      setRecoveryCode(recovery_code);
      setPendingUser(user);
      setShowRecoveryModal(true);
    } catch (err: unknown) {
      const ax = err as { response?: { data?: Record<string, string | string[]> } };
      const data = ax.response?.data;
      let message = 'Erro ao criar conta. Tente novamente.';
      if (data) {
        const first = (v: string | string[] | undefined) =>
          Array.isArray(v) ? v[0] : typeof v === 'string' ? v : undefined;
        message =
          first(data.first_name) ??
          first(data.username) ??
          first(data.email) ??
          first(data.password) ??
          first(data.confirm_password) ??
          message;
      }
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--color-background)] p-[var(--space-2)]">
      <Card className="w-full max-w-[400px]">
          <CardHeader className="space-y-[var(--space-1)] p-[var(--space-3)] pb-0 text-center">
            <CardTitle className="text-2xl font-bold tracking-tight">
              Criar conta
            </CardTitle>
            <CardDescription>
              BWA Tech - Seu gerenciador de projetos.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-[var(--space-3)]">
            <form onSubmit={handleSubmit} className="space-y-[var(--space-2)]">
              <div className="space-y-[var(--space-1)]">
                <Label htmlFor="firstName">Nome *</Label>
                <Input
                  id="firstName"
                  type="text"
                  placeholder="Nome exibido na plataforma"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  required
                  autoComplete="name"
                />
              </div>

              <div className="space-y-[var(--space-1)]">
                <Label htmlFor="email">E-mail *</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="email@bwa.global"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                />
              </div>

              <div className="space-y-[var(--space-1)]">
                <Label htmlFor="username">Login *</Label>
                <Input
                  id="username"
                  type="text"
                  placeholder="Usuário para entrar no sistema"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  autoComplete="username"
                />
              </div>

              <div className="space-y-[var(--space-1)]">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="password">Senha *</Label>
                  <button
                    type="button"
                    onClick={() => {
                      const p = generateRandomPassword();
                      setPassword(p);
                      setConfirmPassword(p);
                      setShowPassword(true);
                    }}
                    className="text-sm text-[var(--color-primary)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] rounded"
                  >
                    Gerar senha aleatória
                  </button>
                </div>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="12+ chars, maiúscula, minúscula, número e especial"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
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
                {password && (
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
                <Label htmlFor="confirmPassword">Repetir senha *</Label>
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

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFileChange}
              />

              {/* Prévia do perfil + botão Selecionar imagem à direita */}
              <div className="flex items-center gap-4">
                <div className="flex flex-1 min-w-0 items-center gap-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-muted)]/50 p-4">
                  <Avatar className="h-10 w-10 flex-shrink-0">
                    {profilePreviewUrl && <AvatarImage src={profilePreviewUrl} alt="" />}
                    <AvatarFallback className="text-sm">
                      {getInitials()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="truncate text-sm font-medium text-[var(--color-foreground)]">
                      {displayNameAbbreviated || displayName || 'Seu nome'}
                    </p>
                    <p className="truncate text-xs text-[var(--color-muted-foreground)]">
                      Desenvolvedor
                    </p>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handlePhotoClick}
                  className="h-16 w-16 shrink-0 rounded-xl flex flex-col items-center justify-center gap-0.5 p-2"
                  title="Selecionar imagem"
                >
                  <Camera className="h-5 w-5 shrink-0" />
                  <span className="flex flex-col items-center text-[10px] leading-tight font-medium">
                    <span>Selecionar</span>
                    <span>Imagem</span>
                  </span>
                </Button>
              </div>

              {error && (
                <div className="p-[var(--space-1)] text-sm text-[var(--color-destructive)] bg-red-50 border border-red-200 rounded-[var(--radius-md)]">
                  {error}
                </div>
              )}

              <Button type="submit" className="w-full mt-[var(--space-1)]" disabled={loading}>
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Criando conta...
                  </>
                ) : (
                  <>
                    <UserPlus className="mr-2 h-4 w-4" />
                    Criar conta
                  </>
                )}
              </Button>

              <p className="text-center text-sm text-muted-foreground">
                Já tem conta?{' '}
                <Link to={ROUTES.entrar} className="text-[var(--color-primary)] font-medium hover:underline">
                  Entrar
                </Link>
              </p>
            </form>
          </CardContent>
        </Card>

      {/* Modal de recorte de foto */}
      <Dialog open={cropOpen} onOpenChange={setCropOpen}>
        <DialogContent className="max-w-[90vw] sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Recortar foto</DialogTitle>
          </DialogHeader>
          {cropSource && (
            <ImageCrop
              src={cropSource}
              onCropComplete={handleCropComplete}
              aspect={1}
              circularCrop
              maxSize={512}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Modal de código de recuperação — não pode ser fechado sem confirmar */}
      <Dialog open={showRecoveryModal} onOpenChange={() => {}}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Guarde seu código de recuperação</DialogTitle>
            <DialogDescription>
              Anote este código em local seguro. Ele é a única forma de recuperar
              o acesso à sua conta caso esqueça a senha.
            </DialogDescription>
          </DialogHeader>
          <div className="my-2 flex items-center justify-between gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-muted)]/50 px-4 py-3">
            <span className="font-mono text-lg font-bold tracking-widest text-[var(--color-foreground)]">
              {recoveryCode}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={handleCopyCode}
              title="Copiar código"
              className="shrink-0"
            >
              {codeCopied
                ? <Check className="h-4 w-4 text-green-500" />
                : <Copy className="h-4 w-4" />}
            </Button>
          </div>
          <Button
            type="button"
            className="w-full"
            onClick={() => {
              setShowRecoveryModal(false);
              if (pendingUser) finalizeAuth(pendingUser);
              navigate(ROUTES.painel);
            }}
          >
            Entendi, já anotei meu código
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}

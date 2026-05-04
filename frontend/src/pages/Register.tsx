import { useState, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ImageCrop } from '@/components/ui/image-crop';
import { Loader2, UserPlus, Camera, Eye, EyeOff } from 'lucide-react';
import { ROUTES } from '../routes';

const EMAIL_DOMAIN = '@bwa.global';
const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*[\W_]).{8,}$/;

function generateRandomPassword(): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghjkmnpqrstuvwxyz';
  const digits = '23456789';
  const special = '!@#$%&*';
  const pick = (s: string) => s[Math.floor(Math.random() * s.length)];
  let p = pick(upper) + pick(lower) + pick(digits) + pick(special);
  const all = upper + lower + digits + special;
  for (let i = 0; i < 8; i++) p += pick(all);
  return p.split('').sort(() => Math.random() - 0.5).join('');
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { register } = useAuth();
  const navigate = useNavigate();

  const displayName = firstName.trim() || username;
  /** Nome para prévia: primeiro nome por extenso, sobrenome(s) abreviado(s) (ex.: Italo Martins → Italo M.) */
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
    if (!file || !file.type.startsWith('image/')) return;
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const emailTrim = email.trim().toLowerCase();
    if (!emailTrim.endsWith(EMAIL_DOMAIN)) {
      setError(`O e-mail deve ser do domínio ${EMAIL_DOMAIN}`);
      return;
    }
    if (!PASSWORD_REGEX.test(password)) {
      setError('A senha deve ter no mínimo 8 caracteres, letra maiúscula, minúscula e um caractere especial.');
      return;
    }
    if (password !== confirmPassword) {
      setError('As senhas não coincidem.');
      return;
    }
    setLoading(true);

    try {
      await register({
        first_name: firstName.trim(),
        username,
        email,
        password,
        profile_picture: profilePictureFile ?? undefined,
      });
      navigate(ROUTES.painel);
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
    <div className="min-h-screen flex items-center justify-center bg-[var(--color-secondary)] p-[var(--space-2)]">
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
                    placeholder="8+ caracteres, maiúscula, minúscula e especial"
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
    </div>
  );
}

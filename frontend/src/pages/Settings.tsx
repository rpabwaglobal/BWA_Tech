import { useEffect, useState, useRef } from 'react';
import { useAuth } from '@/context/AuthContext';
import { userService } from '@/services/userService';
import { authService } from '@/services/authService';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ImageCrop } from '@/components/ui/image-crop';
import { Loader2, Camera, RefreshCw, KeyRound } from 'lucide-react';

export default function Settings() {
  const { user, refreshUser, profilePictureUrl } = useAuth();
  const [firstName, setFirstName] = useState(user?.first_name ?? '');
  const [lastName, setLastName] = useState(user?.last_name ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [profileSuccess, setProfileSuccess] = useState('');

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');

  const [cropOpen, setCropOpen] = useState(false);
  const [cropSource, setCropSource] = useState<string | null>(null);
  const [photoLoading, setPhotoLoading] = useState(false);
  const [photoError, setPhotoError] = useState('');
  const [photoSuccess, setPhotoSuccess] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Recovery code (acesso/rotação) — código não expira por tempo; só é invalidado
  // ao gerar um novo ou ao usar no fluxo de recuperação.
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
  const [recoveryLoading, setRecoveryLoading] = useState(true);
  const [recoveryError, setRecoveryError] = useState('');
  const [regenOpen, setRegenOpen] = useState(false);
  const [regenLoading, setRegenLoading] = useState(false);

  useEffect(() => {
    let mounted = true;
    authService
      .getRecoveryCode()
      .then((data) => {
        if (!mounted) return;
        setRecoveryCode(data.recovery_code);
      })
      .catch(() => {
        if (!mounted) return;
        setRecoveryError('Não foi possível carregar o código.');
      })
      .finally(() => mounted && setRecoveryLoading(false));
    return () => {
      mounted = false;
    };
  }, []);

  const handleRegenerate = async () => {
    setRegenLoading(true);
    setRecoveryError('');
    try {
      const data = await authService.regenerateRecoveryCode();
      setRecoveryCode(data.recovery_code);
      setRegenOpen(false);
    } catch {
      setRecoveryError('Erro ao gerar novo código.');
    } finally {
      setRegenLoading(false);
    }
  };

  const getInitials = () => {
    if (!user) return 'U';
    if (user.first_name && user.last_name) {
      return `${user.first_name[0]}${user.last_name[0]}`.toUpperCase();
    }
    return user.username.substring(0, 2).toUpperCase();
  };

  const handleProfileSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setProfileError('');
    setProfileSuccess('');
    setProfileLoading(true);
    try {
      await userService.update(user.id, {
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        email: email.trim(),
      });
      await refreshUser();
      setProfileSuccess('Perfil atualizado com sucesso.');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: Record<string, string[]> } })?.response?.data;
      const firstKey = msg && Object.keys(msg)[0];
      const firstMsg = firstKey && Array.isArray(msg[firstKey]) ? msg[firstKey][0] : null;
      setProfileError(firstMsg ?? 'Erro ao atualizar perfil.');
    } finally {
      setProfileLoading(false);
    }
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError('');
    setPasswordSuccess('');
    if (newPassword !== confirmPassword) {
      setPasswordError('A nova senha e a confirmação não coincidem.');
      return;
    }
    if (newPassword.length < 8) {
      setPasswordError('A nova senha deve ter pelo menos 8 caracteres.');
      return;
    }
    setPasswordLoading(true);
    try {
      await authService.changePassword(currentPassword, newPassword);
      setPasswordSuccess('Senha alterada com sucesso.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: Record<string, string[]> } })?.response?.data;
      const firstKey = msg && Object.keys(msg)[0];
      const firstMsg = firstKey && Array.isArray(msg[firstKey]) ? msg[firstKey][0] : null;
      setPasswordError(firstMsg ?? 'Erro ao alterar senha.');
    } finally {
      setPasswordLoading(false);
    }
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

  const handleCropComplete = async (dataUrl: string) => {
    setCropOpen(false);
    setCropSource(null);
    setPhotoError('');
    setPhotoSuccess('');
    setPhotoLoading(true);
    try {
      const blob = await fetch(dataUrl).then((r) => r.blob());
      await authService.uploadProfilePicture(blob);
      await refreshUser();
      setPhotoSuccess('Foto de perfil salva com sucesso.');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: Record<string, string[]> } })?.response?.data;
      const firstKey = msg && Object.keys(msg)[0];
      const firstMsg = firstKey && Array.isArray(msg[firstKey]) ? msg[firstKey][0] : null;
      setPhotoError(firstMsg ?? 'Erro ao salvar foto.');
    } finally {
      setPhotoLoading(false);
    }
  };

  return (
    <div className="space-y-8 max-w-2xl mx-auto w-full px-4 py-6">
      <Card>
        <CardHeader>
          <CardTitle>Perfil</CardTitle>
          <CardDescription>Altere seu nome e e-mail.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center gap-6">
            <div className="relative">
              <Avatar className="h-20 w-20">
                {profilePictureUrl && <AvatarImage src={profilePictureUrl} alt="" />}
                <AvatarFallback className="text-xl">{getInitials()}</AvatarFallback>
              </Avatar>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFileChange}
              />
              <Button
                type="button"
                variant="secondary"
                size="icon"
                className="absolute -bottom-1 -right-1 h-8 w-8 rounded-full"
                onClick={handlePhotoClick}
                title="Alterar foto"
              >
                <Camera className="h-4 w-4" />
              </Button>
            </div>
            <div>
              <p className="text-sm font-medium text-[var(--color-foreground)]">Foto de perfil</p>
              <p className="text-xs text-[var(--color-muted-foreground)]">
                Clique no ícone para escolher uma imagem e recortar. A foto será salva e exibida para todos no sistema.
              </p>
              {photoLoading && (
                <p className="text-xs text-[var(--color-muted-foreground)] mt-1 flex items-center gap-1">
                  <Loader2 className="h-3 w-3 animate-spin" /> Salvando...
                </p>
              )}
              {photoError && (
                <p className="text-xs text-[var(--color-destructive)] mt-1">{photoError}</p>
              )}
              {photoSuccess && (
                <p className="text-xs text-green-600 dark:text-green-400 mt-1">{photoSuccess}</p>
              )}
            </div>
          </div>

          <form onSubmit={handleProfileSubmit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="firstName">Nome</Label>
                <Input
                  id="firstName"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="Nome"
                />
                <p className="text-xs text-[var(--color-muted-foreground)]">
                  O nome será exibido no seu perfil no sistema, mas não altera o login (usuário).
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="lastName">Sobrenome</Label>
                <Input
                  id="lastName"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="Sobrenome"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">E-mail</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="email@exemplo.com"
              />
            </div>
            {profileError && (
              <p className="text-sm text-[var(--color-destructive)]">{profileError}</p>
            )}
            {profileSuccess && (
              <p className="text-sm text-green-600 dark:text-green-400">{profileSuccess}</p>
            )}
            <Button type="submit" disabled={profileLoading}>
              {profileLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Salvando...
                </>
              ) : (
                'Salvar perfil'
              )}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Senha</CardTitle>
          <CardDescription>Altere sua senha de acesso.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handlePasswordSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="currentPassword">Senha atual</Label>
              <Input
                id="currentPassword"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="••••••••"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="newPassword">Nova senha</Label>
              <Input
                id="newPassword"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Mínimo 8 caracteres"
                minLength={8}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirmar nova senha</Label>
              <Input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
              />
            </div>
            {passwordError && (
              <p className="text-sm text-[var(--color-destructive)]">{passwordError}</p>
            )}
            {passwordSuccess && (
              <p className="text-sm text-green-600 dark:text-green-400">{passwordSuccess}</p>
            )}
            <Button type="submit" disabled={passwordLoading}>
              {passwordLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Alterando...
                </>
              ) : (
                'Alterar senha'
              )}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5" />
            Código de recuperação
          </CardTitle>
          <CardDescription>
            Use este código para recuperar sua conta caso esqueça a senha. Guarde-o em
            local seguro. Não compartilhe com ninguém.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {recoveryLoading ? (
            <div className="flex items-center gap-2 text-sm text-[var(--color-muted-foreground)]">
              <Loader2 className="h-4 w-4 animate-spin" />
              Carregando...
            </div>
          ) : (
            <>
              <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-muted)]/50 px-4 py-4">
                <span className="block font-mono text-2xl font-bold tracking-widest text-[var(--color-foreground)] text-center select-all">
                  {recoveryCode ?? '—'}
                </span>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--color-muted-foreground)]">
                <span>
                  {recoveryCode
                    ? 'Este código não expira. Ao gerar um novo, o atual é invalidado.'
                    : 'Você ainda não tem um código. Gere um agora para conseguir recuperar a conta.'}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setRegenOpen(true)}
                  className="gap-1.5"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  {recoveryCode ? 'Gerar novo código' : 'Gerar código'}
                </Button>
              </div>

              {recoveryError && (
                <p className="text-sm text-[var(--color-destructive)]">{recoveryError}</p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={cropOpen} onOpenChange={setCropOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Recortar foto</DialogTitle>
          </DialogHeader>
          {cropSource && (
            <ImageCrop
              src={cropSource}
              onCropComplete={handleCropComplete}
              aspect={1}
              circularCrop
              maxSize={256}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={regenOpen} onOpenChange={(open) => !regenLoading && setRegenOpen(open)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Gerar novo código de recuperação?</DialogTitle>
            <DialogDescription>
              O código atual será invalidado imediatamente. Apenas o novo código permitirá
              recuperar sua conta. Tem certeza?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setRegenOpen(false)}
              disabled={regenLoading}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={handleRegenerate}
              disabled={regenLoading}
            >
              {regenLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Gerando...
                </>
              ) : (
                'Sim, gerar novo'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

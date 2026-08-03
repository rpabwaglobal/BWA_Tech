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
import { Badge } from '@/components/ui/badge';
import { getCargoColor, getCargoLabel, chipStyle } from '@/lib/catalog-style';
import { SetoresDoUsuario } from '@/components/SetoresDoUsuario';
import { Loader2, Camera, RefreshCw, KeyRound } from 'lucide-react';

export function PerfilTab() {
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
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Perfil</CardTitle>
          <CardDescription>Altere sua foto, seu nome e seu e-mail.</CardDescription>
        </CardHeader>
        {/* Duas colunas: identidade (foto, cargo, setor) à esquerda; campos
            editáveis à direita. Empilha em telas estreitas. */}
        <CardContent className="grid gap-6 md:grid-cols-[minmax(0,180px)_minmax(0,1fr)]">
          <div className="flex flex-col items-center gap-3 text-center">
            <div className="relative">
              <Avatar className="h-32 w-32">
                {profilePictureUrl && <AvatarImage src={profilePictureUrl} alt="" />}
                <AvatarFallback className="text-3xl">{getInitials()}</AvatarFallback>
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
                className="absolute bottom-1 right-1 h-9 w-9 rounded-full shadow-sm"
                onClick={handlePhotoClick}
                title="Alterar foto"
              >
                <Camera className="h-4 w-4" />
              </Button>
            </div>

            <p className="max-w-full truncate text-xs text-[var(--color-muted-foreground)]">
              {user?.username}
            </p>

            {/* Cargo e setores não são editáveis aqui: quem define é quem
                administra usuários. Por isso ficam como identidade, junto da
                foto, e não como campo desabilitado no formulário ao lado.
                O rótulo do cargo vem do backend (`role_display`), que já resolve
                pelo catálogo; o helper local é reserva, porque antes de o
                catálogo carregar ele devolveria o codename cru.
                Os setores são TODOS os da pessoa, não só o primário — quem está
                em dois setores precisa ver os dois no próprio perfil. */}
            <div className="flex flex-col items-center gap-2">
              <Badge className="border whitespace-nowrap" style={chipStyle(getCargoColor(user?.role))}>
                {user?.role_display || getCargoLabel(user?.role) || '—'}
              </Badge>
              <SetoresDoUsuario usuario={user} className="justify-center" vazio="Sem setor" />
            </div>

            <p className="text-xs text-[var(--color-muted-foreground)]">
              Cargo e setores são definidos por quem administra usuários.
            </p>

            {photoLoading && (
              <p className="flex items-center gap-1 text-xs text-[var(--color-muted-foreground)]">
                <Loader2 className="h-3 w-3 animate-spin" /> Salvando...
              </p>
            )}
            {photoError && <p className="text-xs text-[var(--color-destructive)]">{photoError}</p>}
            {photoSuccess && (
              <p className="text-xs text-green-600 dark:text-green-400">{photoSuccess}</p>
            )}
          </div>

          <form onSubmit={handleProfileSubmit} className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="firstName">Nome</Label>
                <Input
                  id="firstName"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="Nome"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lastName">Sobrenome</Label>
                <Input
                  id="lastName"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="Sobrenome"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email">E-mail</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="email@exemplo.com"
              />
            </div>
            <p className="text-xs text-[var(--color-muted-foreground)]">
              Nome e sobrenome aparecem no seu perfil, mas não alteram o login ({user?.username}).
            </p>
            {profileError && (
              <p className="text-sm text-[var(--color-destructive)]">{profileError}</p>
            )}
            {profileSuccess && (
              <p className="text-sm text-green-600 dark:text-green-400">{profileSuccess}</p>
            )}
            <div className="flex justify-end">
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
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Senha e código de recuperação no mesmo card: são as duas formas de
          entrar na conta — uma para trocar o acesso, outra para recuperá-lo. */}
      <Card>
        <CardHeader>
          <CardTitle>Acesso à conta</CardTitle>
          <CardDescription>
            Altere sua senha e mantenha à mão o código que recupera a conta se você esquecê-la.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6 md:grid-cols-2">
          <form onSubmit={handlePasswordSubmit} className="space-y-3">
            <div className="space-y-1.5">
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
            <div className="space-y-1.5">
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
            <div className="space-y-1.5">
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
            <div className="flex justify-end">
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
            </div>
          </form>

          <div className="space-y-3 md:border-l md:border-[var(--color-border)] md:pl-6">
            <div className="space-y-1">
              <p className="flex items-center gap-2 text-sm font-medium text-[var(--color-foreground)]">
                <KeyRound className="h-4 w-4" />
                Código de recuperação
              </p>
              <p className="text-xs text-[var(--color-muted-foreground)]">
                Guarde em local seguro e não compartilhe: quem tiver este código consegue
                redefinir sua senha.
              </p>
            </div>

            {recoveryLoading ? (
              <div className="flex items-center gap-2 text-sm text-[var(--color-muted-foreground)]">
                <Loader2 className="h-4 w-4 animate-spin" />
                Carregando...
              </div>
            ) : (
              <>
                <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-muted)]/50 px-4 py-4">
                  <span className="block select-all text-center font-mono text-2xl font-bold tracking-widest text-[var(--color-foreground)]">
                    {recoveryCode ?? '—'}
                  </span>
                </div>

                <p className="text-xs text-[var(--color-muted-foreground)]">
                  {recoveryCode
                    ? 'Este código não expira. Ao gerar um novo, o atual é invalidado.'
                    : 'Você ainda não tem um código. Gere um agora para conseguir recuperar a conta.'}
                </p>

                {recoveryError && (
                  <p className="text-sm text-[var(--color-destructive)]">{recoveryError}</p>
                )}

                <div className="flex justify-end">
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
              </>
            )}
          </div>
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

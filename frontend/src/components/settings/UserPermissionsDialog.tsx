import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { hasPermission } from '@/lib/permissions';
import {
  userService,
  type User,
  type PermissionCatalogEntry,
  type CatalogItem,
} from '@/services/userService';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Switch } from '@/components/ui/switch';
import { FilterSelect } from '@/components/ui/filter-select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Loader2, ShieldAlert, Plus, Search, KeyRound, Copy, Check } from 'lucide-react';
import { SetoresDoUsuario } from '@/components/SetoresDoUsuario';

function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return '?';
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return `${partes[0][0]}${partes[partes.length - 1][0]}`.toUpperCase();
}

function displayName(user: User): string {
  const nome = `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim();
  return nome || user.username;
}

function extractApiError(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  const data = (err as { response?: { data?: Record<string, unknown> } })?.response?.data;
  if (data) {
    const firstKey = Object.keys(data)[0];
    const val = firstKey ? data[firstKey] : undefined;
    if (Array.isArray(val) && typeof val[0] === 'string') return val[0];
    if (typeof val === 'string') return val;
  }
  return fallback;
}

/** Campo de catálogo (Cargo/Setor): seleciona um item existente ou cria um
 * novo inline. `onChange`/`onCreate` devem rejeitar com um `Error` cuja
 * `message` já é a mensagem amigável a exibir. */
function CatalogSelectField({
  label,
  options,
  value,
  onChange,
  onCreate,
  disabled,
  placeholder,
  searchPlaceholder,
  clearable = true,
}: {
  label: string;
  options: CatalogItem[];
  value: string;
  onChange: (value: string) => Promise<void>;
  onCreate: (nome: string) => Promise<CatalogItem>;
  disabled?: boolean;
  placeholder: string;
  searchPlaceholder: string;
  clearable?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [newNome, setNewNome] = useState('');
  const [creatingBusy, setCreatingBusy] = useState(false);

  const filterOptions = useMemo(
    () => options.map((o) => ({ value: o.codename, label: o.nome })),
    [options],
  );

  const handleSelect = async (v: string) => {
    setBusy(true);
    setError('');
    try {
      await onChange(v);
    } catch (err) {
      setError(extractApiError(err, 'Não foi possível salvar.'));
    } finally {
      setBusy(false);
    }
  };

  const handleCreate = async () => {
    const nome = newNome.trim();
    if (!nome) return;
    setCreatingBusy(true);
    setError('');
    try {
      const item = await onCreate(nome);
      setNewNome('');
      setCreating(false);
      await handleSelect(item.codename);
    } catch (err) {
      setError(extractApiError(err, 'Não foi possível criar.'));
    } finally {
      setCreatingBusy(false);
    }
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-[var(--color-foreground)]">{label}</p>
        {!creating && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            disabled={disabled}
            className="flex items-center gap-1 text-xs text-[var(--color-primary)] hover:underline disabled:opacity-50 disabled:no-underline disabled:cursor-not-allowed"
          >
            <Plus className="h-3 w-3" />
            Criar novo
          </button>
        )}
      </div>

      {creating ? (
        <div className="flex items-center gap-2">
          <Input
            autoFocus
            value={newNome}
            onChange={(e) => setNewNome(e.target.value)}
            placeholder={`Nome do novo ${label.toLowerCase()}`}
            className="h-9"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void handleCreate();
              }
              if (e.key === 'Escape') {
                setCreating(false);
                setNewNome('');
              }
            }}
          />
          <Button type="button" size="sm" onClick={handleCreate} disabled={creatingBusy || !newNome.trim()}>
            {creatingBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Criar'}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              setCreating(false);
              setNewNome('');
            }}
            disabled={creatingBusy}
          >
            Cancelar
          </Button>
        </div>
      ) : (
        <FilterSelect
          options={filterOptions}
          value={value}
          onChange={handleSelect}
          placeholder={placeholder}
          searchPlaceholder={searchPlaceholder}
          clearable={clearable}
          disabled={disabled || busy}
        />
      )}
      {error && <p className="text-xs text-[var(--color-destructive)]">{error}</p>}
    </div>
  );
}

type Props = {
  user: User;
  catalog: PermissionCatalogEntry[];
  cargos: CatalogItem[];
  setores: CatalogItem[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdated: (updated: User) => void;
  onCargoCreated: (cargo: CatalogItem) => void;
  onSetorCreated: (setor: CatalogItem) => void;
};

export function UserPermissionsDialog({
  user,
  catalog,
  cargos,
  setores,
  open,
  onOpenChange,
  onUpdated,
  onCargoCreated,
  onSetorCreated,
}: Props) {
  const { user: currentUser } = useAuth();

  // Cargo, setor e permissões são EDITADOS aqui e só vão para o servidor no
  // botão. Antes os dois selects salvavam no `onChange` — o que já era
  // discutível e virou defeito quando o cargo passou a conceder permissão:
  // escolher um cargo mudava o acesso da pessoa na hora, sem ninguém confirmar
  // nada, e o botão "Salvar permissões" logo abaixo dava a entender o oposto.
  const [cargoPendente, setCargoPendente] = useState(user.role);
  const [setorPendente, setSetorPendente] = useState(user.setor ?? '');
  const [selected, setSelected] = useState<Set<string>>(new Set(user.permissions ?? []));
  const [savingPermissions, setSavingPermissions] = useState(false);
  const [permissionsError, setPermissionsError] = useState('');
  const [permissionsSuccess, setPermissionsSuccess] = useState('');

  const [activeLoading, setActiveLoading] = useState(false);
  const [activeError, setActiveError] = useState('');

  // Redefinição de senha — `senhaGerada` só existe em memória: o backend
  // devolve a senha uma única vez e não guarda como recuperá-la.
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [resetError, setResetError] = useState('');
  const [resetOk, setResetOk] = useState('');
  const [senhaGerada, setSenhaGerada] = useState('');
  const [senhaCopiada, setSenhaCopiada] = useState(false);

  const [permSearch, setPermSearch] = useState('');

  useEffect(() => {
    setCargoPendente(user.role);
    setSetorPendente(user.setor ?? '');
    setSelected(new Set(user.permissions ?? []));
    setPermissionsError('');
    setPermissionsSuccess('');
    setActiveError('');
    setResetError('');
    setResetOk('');
    setSenhaGerada('');
    setSenhaCopiada(false);
    setPermSearch('');
    // `open` entra aqui para que a senha gerada não sobreviva ao fechamento do
    // modal: fechou, sumiu.
  }, [user, open]);

  const groupedCatalog = useMemo(() => {
    const groups = new Map<string, PermissionCatalogEntry[]>();
    for (const entry of catalog) {
      const list = groups.get(entry.area) ?? [];
      list.push(entry);
      groups.set(entry.area, list);
    }
    return [...groups.entries()];
  }, [catalog]);

  const catalogoVisivel = useMemo(() => {
    const q = permSearch.trim().toLowerCase();
    if (!q) return groupedCatalog;
    return groupedCatalog
      .map(([area, entries]) => {
        const achou = entries.filter((e) =>
          `${e.name} ${e.area} ${e.codename}`.toLowerCase().includes(q),
        );
        return [area, achou] as [string, PermissionCatalogEntry[]];
      })
      .filter(([, entries]) => entries.length > 0);
  }, [groupedCatalog, permSearch]);

  /** Permissões que o CARGO do alvo já concede.
   *
   * Desde que o cargo virou fonte de autorização de verdade no backend, o
   * `permissions` do usuário é a UNIÃO de "vem do cargo" com "personalizada".
   * Esta tela edita só a segunda metade — sem separar as duas, ela reenviaria
   * o template inteiro como personalizado (ver `handleSalvar`). */
  // Olha o cargo PENDENTE, não o salvo: assim que o operador escolhe outro
  // cargo, os switches já mostram o que aquele cargo concederá. Prévia honesta
  // do que o botão vai efetivar.
  const doCargo = useMemo(
    () => new Set(cargos.find((c) => c.codename === cargoPendente)?.permissoes_padrao ?? []),
    [cargos, cargoPendente],
  );
  const nomeDoCargo = cargos.find((c) => c.codename === cargoPendente)?.nome || user.role_display;

  const isSelf = String(user.id) === String(currentUser?.id);
  const targetIsAdmin = user.role === 'admin';
  const currentIsAdmin = currentUser?.role === 'admin';
  const canManage = !isSelf && (!targetIsAdmin || currentIsAdmin);
  // Redefinir senha é gate próprio no backend (manage_users) e nunca vale para
  // a própria conta — quem quer trocar a sua vai em Configurações → Perfil.
  const canResetPassword = canManage && hasPermission(currentUser, 'manage_users');

  const togglePermission = (codename: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(codename)) next.delete(codename);
      else next.add(codename);
      return next;
    });
  };

  const cargoMudou = cargoPendente !== user.role;
  const setorMudou = setorPendente !== (user.setor ?? '');
  const personalizadas = useMemo(
    // Grava só o que é PERSONALIZADO. Reenviar o que vem do cargo congelaria
    // o template dentro do usuário: a partir daí, editar o cargo não
    // alcançaria mais esta pessoa — que é justamente o defeito que a mudança
    // do backend veio corrigir. O acesso efetivo não muda: o cargo continua
    // concedendo essas permissões pela união.
    () => [...selected].filter((codename) => !doCargo.has(codename)).sort(),
    [selected, doCargo],
  );
  const permissoesMudaram = useMemo(() => {
    const salvas = new Set(user.permissions ?? []);
    const cargoSalvo = new Set(
      cargos.find((c) => c.codename === user.role)?.permissoes_padrao ?? [],
    );
    const antes = [...salvas].filter((c) => !cargoSalvo.has(c)).sort();
    return antes.join('|') !== personalizadas.join('|');
  }, [user.permissions, user.role, cargos, personalizadas]);
  const temPendencia = cargoMudou || setorMudou || permissoesMudaram;

  const handleSalvar = async () => {
    setSavingPermissions(true);
    setPermissionsError('');
    setPermissionsSuccess('');
    try {
      // Cargo/setor primeiro: as permissões personalizadas são calculadas
      // DESCONTANDO o que o cargo concede, então o cargo precisa já ser o novo
      // quando o backend recebe a lista. Invertendo a ordem, uma permissão que
      // o cargo novo concede seria gravada como personalizada e ficaria
      // congelada no usuário.
      let atualizado = user;
      if (cargoMudou || setorMudou) {
        const payload: { role?: string; setor?: string } = {};
        if (cargoMudou) payload.role = cargoPendente;
        if (setorMudou) payload.setor = setorPendente;
        atualizado = await userService.update(String(user.id), payload);
      }
      if (permissoesMudaram) {
        atualizado = await userService.setPermissions(user.id, personalizadas);
      }
      onUpdated(atualizado);
      setPermissionsSuccess('Alterações salvas com sucesso.');
    } catch (err) {
      setPermissionsError(extractApiError(err, 'Não foi possível salvar as alterações.'));
    } finally {
      setSavingPermissions(false);
    }
  };

  const handleDescartar = () => {
    setCargoPendente(user.role);
    setSetorPendente(user.setor ?? '');
    setSelected(new Set(user.permissions ?? []));
    setPermissionsError('');
    setPermissionsSuccess('');
  };

  const handleToggleActive = async (nextActive: boolean) => {
    setActiveLoading(true);
    setActiveError('');
    try {
      const updated = await userService.setActive(user.id, nextActive);
      onUpdated(updated);
    } catch {
      setActiveError('Não foi possível alterar o status do usuário.');
    } finally {
      setActiveLoading(false);
    }
  };

  const handleResetPassword = async () => {
    setResetLoading(true);
    setResetError('');
    setResetOk('');
    setSenhaGerada('');
    setSenhaCopiada(false);
    try {
      const data = await userService.resetPassword(user.id);
      setSenhaGerada(data.senha_gerada ?? '');
      setResetOk(data.detail || 'Senha redefinida.');
      setResetConfirmOpen(false);
    } catch (err) {
      // O backend recusa com `detail` (sem permissão, própria conta); só cai no
      // texto genérico quando a falha é de rede.
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setResetError(detail || 'Não foi possível redefinir a senha.');
    } finally {
      setResetLoading(false);
    }
  };

  const handleCopiarSenha = async () => {
    try {
      await navigator.clipboard.writeText(senhaGerada);
      setSenhaCopiada(true);
      window.setTimeout(() => setSenhaCopiada(false), 2000);
    } catch {
      setResetError('Não foi possível copiar. Selecione a senha e copie manualmente.');
    }
  };

  // Só estado local — quem grava é o botão. `CatalogSelectField` espera uma
  // Promise, então devolvemos uma já resolvida.
  const handleRoleChange = async (value: string) => {
    setCargoPendente(value);
    setPermissionsSuccess('');
  };

  const handleSetorChange = async (value: string) => {
    setSetorPendente(value);
    setPermissionsSuccess('');
  };

  const handleCreateCargo = async (nome: string): Promise<CatalogItem> => {
    const item = await userService.createCargo({ nome });
    onCargoCreated(item);
    return item;
  };

  const handleCreateSetor = async (nome: string): Promise<CatalogItem> => {
    const item = await userService.createSetor({ nome });
    onSetorCreated(item);
    return item;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} containerClassName="max-w-5xl">
      <DialogContent
        onClose={() => onOpenChange(false)}
        className="flex max-h-[88vh] flex-col md:overflow-y-hidden"
      >
        <DialogHeader>
          <DialogTitle>Gerenciar usuário</DialogTitle>
        </DialogHeader>

        {!canManage && (
          <div className="mt-2 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              {isSelf
                ? 'Você não pode editar os próprios cargo, setor, permissões ou status por aqui.'
                : 'Usuários admin só podem ser gerenciados por outro admin.'}
            </span>
          </div>
        )}

        {/* Identidade + vínculos à esquerda; permissões à direita. Nome, e-mail
            e foto são só leitura: quem os edita é a própria pessoa, em
            Configurações → Perfil. */}
        {/* `md:overflow-hidden` + `min-h-0` nas DUAS colunas: linha de grid tem
            altura automática e estica até o item mais alto, então sem isto a
            coluna da esquerda (foto, cargo, setor, lista de setores) empurrava a
            grade para além do `max-h` do modal e o container cortava o rodapé —
            os botões sumiam e só apareciam dando zoom out. Cada coluna rola por
            si; abaixo de `md` elas empilham e quem rola é o modal inteiro. */}
        <div className="mt-4 grid min-h-0 flex-1 gap-6 md:grid-cols-[minmax(0,340px)_minmax(0,1fr)] md:overflow-hidden">
          <div className="min-h-0 space-y-4 md:overflow-y-auto md:pr-2">
            <div className="flex flex-col items-center gap-3 text-center">
              <Avatar className="h-28 w-28">
                {user.profile_picture_url ? (
                  <AvatarImage src={user.profile_picture_url} alt={displayName(user)} />
                ) : null}
                <AvatarFallback className="bg-[var(--color-muted)] text-2xl text-[var(--color-muted-foreground)]">
                  {iniciais(displayName(user))}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 w-full">
                <p className="truncate text-base font-semibold text-[var(--color-foreground)]">
                  {displayName(user)}
                </p>
                <p className="truncate text-xs text-[var(--color-muted-foreground)]">{user.email}</p>
                {/* Vários usuários têm o próprio e-mail como login; repetir a
                    mesma string embaixo dela não informa nada. */}
                {user.username !== user.email && user.username !== displayName(user) && (
                  <p className="truncate text-xs text-[var(--color-muted-foreground)]">{user.username}</p>
                )}
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 rounded-md border border-[var(--color-border)] px-3 py-2.5">
              <div className="min-w-0">
                <p className="text-sm font-medium text-[var(--color-foreground)]">Acesso à plataforma</p>
                <p className="text-xs text-[var(--color-muted-foreground)]">
                  {user.is_active ? 'Ativo — pode logar e usar o sistema.' : 'Inativo — login e sessões revogados.'}
                </p>
                {activeError && <p className="mt-1 text-xs text-[var(--color-destructive)]">{activeError}</p>}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {activeLoading && <Loader2 className="h-4 w-4 animate-spin text-[var(--color-muted-foreground)]" />}
                <Switch
                  checked={!!user.is_active}
                  onCheckedChange={handleToggleActive}
                  disabled={!canManage || activeLoading}
                  aria-label="Ativo/Inativo"
                />
              </div>
            </div>

            {canResetPassword && (
              <div className="space-y-2 rounded-md border border-[var(--color-border)] px-3 py-2.5">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-[var(--color-foreground)]">Senha</p>
                    <p className="text-xs text-[var(--color-muted-foreground)]">
                      Gera uma senha nova para entregar à pessoa.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setResetConfirmOpen(true)}
                    disabled={resetLoading}
                    className="shrink-0 gap-1.5"
                  >
                    <KeyRound className="h-3.5 w-3.5" />
                    Redefinir senha
                  </Button>
                </div>

                {/* A senha chega uma única vez do backend; se sair da tela sem ser
                    copiada, só resta redefinir de novo. */}
                {senhaGerada && (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-muted)]/50 px-3 py-2">
                      <span className="min-w-0 flex-1 select-all break-all font-mono text-sm font-bold tracking-wider text-[var(--color-foreground)]">
                        {senhaGerada}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={handleCopiarSenha}
                        title="Copiar senha"
                        className="shrink-0"
                      >
                        {senhaCopiada ? (
                          <Check className="h-4 w-4 text-green-600 dark:text-green-400" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                    <p className="text-xs font-medium text-amber-700 dark:text-amber-400">
                      Copie agora: esta senha não será exibida de novo. Entregue-a por um canal
                      seguro e peça que a pessoa a troque no primeiro acesso.
                    </p>
                  </div>
                )}

                {resetOk && !senhaGerada && (
                  <p className="text-xs text-green-600 dark:text-green-400">{resetOk}</p>
                )}
                {resetError && <p className="text-xs text-[var(--color-destructive)]">{resetError}</p>}
              </div>
            )}

            <CatalogSelectField
              label="Cargo"
              options={cargos}
              value={cargoPendente}
              onChange={handleRoleChange}
              onCreate={handleCreateCargo}
              disabled={!canManage}
              placeholder="Selecione um cargo"
              searchPlaceholder="Buscar cargo..."
              clearable={false}
            />

            {/* O select troca o setor PRIMÁRIO (o que a plataforma usa como
                "de onde a pessoa é"). A pessoa pode estar em mais de um, e é a
                lista abaixo que mostra o vínculo inteiro. */}
            <div className="space-y-2">
              <CatalogSelectField
                label="Setor primário"
                options={setores}
                value={setorPendente}
                onChange={handleSetorChange}
                onCreate={handleCreateSetor}
                disabled={!canManage}
                placeholder="Sem setor definido"
                searchPlaceholder="Buscar setor..."
              />
              <div className="space-y-1.5 rounded-md border border-[var(--color-border)] px-3 py-2.5">
                <p className="text-xs font-medium text-[var(--color-foreground)]">
                  Setores desta pessoa
                </p>
                <SetoresDoUsuario usuario={user} vazio="Nenhum setor." />
                <p className="text-[11px] leading-[15px] text-[var(--color-muted-foreground)]">
                  Atribuir um setor real tira a pessoa de “Sem Setor” automaticamente.
                </p>
              </div>
            </div>

            <p className="text-xs text-[var(--color-muted-foreground)]">
              Nome, e-mail e foto são editados pelo próprio usuário em Configurações → Perfil.
            </p>
          </div>

          <div className="flex min-h-0 flex-col gap-3 md:border-l md:border-[var(--color-border)] md:pl-6">
            <div>
              <p className="text-sm font-medium text-[var(--color-foreground)]">Permissões</p>
              <p className="text-xs text-[var(--color-muted-foreground)]">
                O que esta pessoa pode fazer. É a soma do que o cargo concede com o que você
                marcar aqui — as que vêm do cargo aparecem marcadas como “do cargo” e só saem
                editando o cargo.
              </p>
            </div>

            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-muted-foreground)]" />
              <Input
                value={permSearch}
                onChange={(e) => setPermSearch(e.target.value)}
                placeholder="Buscar permissão..."
                className="h-9 pl-9"
              />
            </div>

            <div className="min-h-0 flex-1 md:overflow-y-auto md:pr-2">
              {groupedCatalog.length === 0 ? (
                <p className="text-xs text-[var(--color-muted-foreground)]">Carregando catálogo...</p>
              ) : catalogoVisivel.length === 0 ? (
                <p className="text-xs text-[var(--color-muted-foreground)]">
                  Nenhuma permissão encontrada para “{permSearch.trim()}”.
                </p>
              ) : (
                <div className="space-y-4">
                  {catalogoVisivel.map(([area, entries]) => (
                    <div key={area}>
                      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">
                        {area}
                      </p>
                      <div className="space-y-2">
                        {entries.map((entry) => {
                          // Permissão do cargo não se tira por usuário: o
                          // backend soma cargo + personalizadas, então desligar
                          // aqui não mudaria nada. O switch fica travado e a
                          // origem fica escrita, em vez de o clique não surtir
                          // efeito e a tela parecer quebrada.
                          const vemDoCargo = doCargo.has(entry.codename);
                          return (
                            <label
                              key={entry.codename}
                              htmlFor={`perm-${entry.codename}`}
                              className="flex cursor-pointer items-center justify-between gap-3 rounded-md border border-[var(--color-border)] px-3 py-2"
                            >
                              <span className="min-w-0 text-sm text-[var(--color-foreground)]">
                                {entry.name}
                                {vemDoCargo && (
                                  <span
                                    className="ml-2 whitespace-nowrap rounded-full border border-[var(--color-border)] bg-[var(--color-muted)] px-2 py-[1px] text-[10px] font-medium text-[var(--color-muted-foreground)]"
                                    title={`Concedida pelo cargo ${nomeDoCargo}. Para tirar, edite o cargo.`}
                                  >
                                    do cargo
                                  </span>
                                )}
                              </span>
                              <Switch
                                id={`perm-${entry.codename}`}
                                checked={vemDoCargo || selected.has(entry.codename)}
                                onCheckedChange={() => togglePermission(entry.codename)}
                                disabled={!canManage || vemDoCargo}
                              />
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {permissionsError && <p className="text-sm text-[var(--color-destructive)]">{permissionsError}</p>}
            {permissionsSuccess && (
              <p className="text-sm text-green-600 dark:text-green-400">{permissionsSuccess}</p>
            )}

            <div className="flex flex-wrap items-center justify-end gap-2">
              {temPendencia && (
                <span className="mr-auto text-xs text-[var(--color-muted-foreground)]">
                  Alterações não salvas
                  {cargoMudou && ' · cargo'}
                  {setorMudou && ' · setor primário'}
                  {permissoesMudaram && ' · permissões'}
                </span>
              )}
              <Button
                type="button"
                variant="outline"
                onClick={handleDescartar}
                disabled={!temPendencia || savingPermissions}
              >
                Descartar
              </Button>
              <Button
                type="button"
                onClick={handleSalvar}
                disabled={!canManage || savingPermissions || !temPendencia}
              >
                {savingPermissions ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Salvando...
                  </>
                ) : (
                  'Salvar alterações'
                )}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>

      <ConfirmDialog
        open={resetConfirmOpen}
        variant="destructive"
        title="Redefinir a senha desta pessoa?"
        description={
          <>
            A senha atual de <strong>{displayName(user)}</strong> deixa de funcionar imediatamente e
            todas as sessões abertas são encerradas — a pessoa é deslogada de todos os dispositivos.
          </>
        }
        details={
          <p className="text-xs text-[var(--color-muted-foreground)]">
            Uma senha nova será gerada e exibida uma única vez, para você entregar à pessoa.
          </p>
        }
        confirmLabel="Redefinir senha"
        loading={resetLoading}
        onConfirm={handleResetPassword}
        onCancel={() => setResetConfirmOpen(false)}
      />
    </Dialog>
  );
}

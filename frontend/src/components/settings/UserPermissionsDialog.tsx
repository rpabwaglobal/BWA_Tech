import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import {
  userService,
  type User,
  type PermissionCatalogEntry,
  type CatalogItem,
} from '@/services/userService';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Switch } from '@/components/ui/switch';
import { FilterSelect } from '@/components/ui/filter-select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Loader2, ShieldAlert, Plus } from 'lucide-react';

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

  const [selected, setSelected] = useState<Set<string>>(new Set(user.permissions ?? []));
  const [savingPermissions, setSavingPermissions] = useState(false);
  const [permissionsError, setPermissionsError] = useState('');
  const [permissionsSuccess, setPermissionsSuccess] = useState('');

  const [activeLoading, setActiveLoading] = useState(false);
  const [activeError, setActiveError] = useState('');

  useEffect(() => {
    setSelected(new Set(user.permissions ?? []));
    setPermissionsError('');
    setPermissionsSuccess('');
    setActiveError('');
  }, [user]);

  const groupedCatalog = useMemo(() => {
    const groups = new Map<string, PermissionCatalogEntry[]>();
    for (const entry of catalog) {
      const list = groups.get(entry.area) ?? [];
      list.push(entry);
      groups.set(entry.area, list);
    }
    return [...groups.entries()];
  }, [catalog]);

  const isSelf = String(user.id) === String(currentUser?.id);
  const targetIsAdmin = user.role === 'admin';
  const currentIsAdmin = currentUser?.role === 'admin';
  const canManage = !isSelf && (!targetIsAdmin || currentIsAdmin);

  const togglePermission = (codename: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(codename)) next.delete(codename);
      else next.add(codename);
      return next;
    });
  };

  const handleSavePermissions = async () => {
    setSavingPermissions(true);
    setPermissionsError('');
    setPermissionsSuccess('');
    try {
      const updated = await userService.setPermissions(user.id, [...selected]);
      onUpdated(updated);
      setPermissionsSuccess('Permissões salvas com sucesso.');
    } catch {
      setPermissionsError('Não foi possível salvar as permissões.');
    } finally {
      setSavingPermissions(false);
    }
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

  const handleRoleChange = async (value: string) => {
    try {
      const updated = await userService.update(String(user.id), { role: value });
      onUpdated(updated);
    } catch (err) {
      throw new Error(extractApiError(err, 'Não foi possível alterar o cargo.'));
    }
  };

  const handleSetorChange = async (value: string) => {
    try {
      const updated = await userService.update(String(user.id), { setor: value });
      onUpdated(updated);
    } catch (err) {
      throw new Error(extractApiError(err, 'Não foi possível alterar o setor.'));
    }
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
    <Dialog open={open} onOpenChange={onOpenChange} containerClassName="max-w-xl">
      <DialogContent onClose={() => onOpenChange(false)} className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <Avatar className="h-11 w-11 shrink-0">
              {user.profile_picture_url ? <AvatarImage src={user.profile_picture_url} alt={displayName(user)} /> : null}
              <AvatarFallback className="bg-[var(--color-muted)] text-sm text-[var(--color-muted-foreground)]">
                {iniciais(displayName(user))}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <DialogTitle className="truncate">{displayName(user)}</DialogTitle>
              <p className="text-xs text-[var(--color-muted-foreground)]">{user.role_display}</p>
            </div>
          </div>
        </DialogHeader>

        {!canManage && (
          <div className="mt-2 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
            <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
            <span>
              {isSelf
                ? 'Você não pode editar os próprios cargo, setor, permissões ou status por aqui.'
                : 'Usuários admin só podem ser gerenciados por outro admin.'}
            </span>
          </div>
        )}

        <div className="mt-4 space-y-5">
          <div className="flex items-center justify-between gap-3 rounded-md border border-[var(--color-border)] px-3 py-2.5">
            <div>
              <p className="text-sm font-medium text-[var(--color-foreground)]">Acesso à plataforma</p>
              <p className="text-xs text-[var(--color-muted-foreground)]">
                {user.is_active ? 'Ativo — pode logar e usar o sistema.' : 'Inativo — login e sessões revogados.'}
              </p>
              {activeError && <p className="text-xs text-[var(--color-destructive)] mt-1">{activeError}</p>}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {activeLoading && <Loader2 className="h-4 w-4 animate-spin text-[var(--color-muted-foreground)]" />}
              <Switch
                checked={!!user.is_active}
                onCheckedChange={handleToggleActive}
                disabled={!canManage || activeLoading}
                aria-label="Ativo/Inativo"
              />
            </div>
          </div>

          <CatalogSelectField
            label="Cargo"
            options={cargos}
            value={user.role}
            onChange={handleRoleChange}
            onCreate={handleCreateCargo}
            disabled={!canManage}
            placeholder="Selecione um cargo"
            searchPlaceholder="Buscar cargo..."
            clearable={false}
          />

          <CatalogSelectField
            label="Setor"
            options={setores}
            value={user.setor ?? ''}
            onChange={handleSetorChange}
            onCreate={handleCreateSetor}
            disabled={!canManage}
            placeholder="Sem setor definido"
            searchPlaceholder="Buscar setor..."
          />

          <div className="space-y-3">
            <p className="text-sm font-medium text-[var(--color-foreground)]">Permissões</p>
            {groupedCatalog.length === 0 ? (
              <p className="text-xs text-[var(--color-muted-foreground)]">Carregando catálogo...</p>
            ) : (
              <div className="space-y-4">
                {groupedCatalog.map(([area, entries]) => (
                  <div key={area}>
                    <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">
                      {area}
                    </p>
                    <div className="space-y-2">
                      {entries.map((entry) => (
                        <label
                          key={entry.codename}
                          htmlFor={`perm-${entry.codename}`}
                          className="flex items-center justify-between gap-3 rounded-md border border-[var(--color-border)] px-3 py-2 cursor-pointer"
                        >
                          <span className="text-sm text-[var(--color-foreground)]">{entry.name}</span>
                          <Switch
                            id={`perm-${entry.codename}`}
                            checked={selected.has(entry.codename)}
                            onCheckedChange={() => togglePermission(entry.codename)}
                            disabled={!canManage}
                          />
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {permissionsError && <p className="text-sm text-[var(--color-destructive)]">{permissionsError}</p>}
            {permissionsSuccess && (
              <p className="text-sm text-green-600 dark:text-green-400">{permissionsSuccess}</p>
            )}

            <Button
              type="button"
              onClick={handleSavePermissions}
              disabled={!canManage || savingPermissions}
              className="w-full"
            >
              {savingPermissions ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Salvando...
                </>
              ) : (
                'Salvar permissões'
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

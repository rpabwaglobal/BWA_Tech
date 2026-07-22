import { useEffect, useMemo, useState } from 'react';
import { userService, type User, type PermissionCatalogEntry, type CatalogItem } from '@/services/userService';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FilterSelect } from '@/components/ui/filter-select';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Loader2, Search, Users as UsersIcon, Tag, Building2, ShieldCheck, X } from 'lucide-react';
import { UserPermissionsDialog } from './UserPermissionsDialog';

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

const STATUS_OPTIONS = [
  { value: 'ativo', label: 'Ativos' },
  { value: 'inativo', label: 'Inativos' },
];

type BulkMode = 'cargo' | 'setor' | 'permissions' | null;

export function GerenciamentoUsuarios() {
  const [users, setUsers] = useState<User[]>([]);
  const [catalog, setCatalog] = useState<PermissionCatalogEntry[]>([]);
  const [cargos, setCargos] = useState<CatalogItem[]>([]);
  const [setores, setSetores] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedUser, setSelectedUser] = useState<User | null>(null);

  // Filtros (client-side sobre a lista completa)
  const [search, setSearch] = useState('');
  const [cargoFilter, setCargoFilter] = useState('');
  const [setorFilter, setSetorFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  // Multi-seleção
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Bulk
  const [bulkMode, setBulkMode] = useState<BulkMode>(null);
  const [bulkCargo, setBulkCargo] = useState('');
  const [bulkApplyTemplate, setBulkApplyTemplate] = useState(false);
  const [bulkSetor, setBulkSetor] = useState('');
  const [bulkPermMode, setBulkPermMode] = useState<'set' | 'add' | 'remove'>('add');
  const [bulkPerms, setBulkPerms] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkError, setBulkError] = useState('');

  const reload = async () => {
    const list = await userService.getAllManagement();
    setUsers(list);
  };

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    Promise.all([
      userService.getAllManagement(),
      userService.getPermissionsCatalog(),
      userService.getCargos(),
      userService.getSetores(),
    ])
      .then(([userList, catalogList, cargoList, setorList]) => {
        if (!mounted) return;
        setUsers(userList);
        setCatalog(catalogList);
        setCargos(cargoList);
        setSetores(setorList);
      })
      .catch(() => mounted && setError('Não foi possível carregar os usuários.'))
      .finally(() => mounted && setLoading(false));
    return () => {
      mounted = false;
    };
  }, []);

  const cargoOptions = useMemo(() => cargos.map((c) => ({ value: c.codename, label: c.nome })), [cargos]);
  const setorOptions = useMemo(() => setores.map((s) => ({ value: s.codename, label: s.nome })), [setores]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users
      .filter((u) => {
        if (q) {
          const blob = `${displayName(u)} ${u.username} ${u.email}`.toLowerCase();
          if (!blob.includes(q)) return false;
        }
        if (cargoFilter && u.role !== cargoFilter) return false;
        if (setorFilter && (u.setor ?? '') !== setorFilter) return false;
        if (statusFilter === 'ativo' && !u.is_active) return false;
        if (statusFilter === 'inativo' && u.is_active) return false;
        return true;
      })
      .sort((a, b) => displayName(a).localeCompare(displayName(b), 'pt-BR'));
  }, [users, search, cargoFilter, setorFilter, statusFilter]);

  const filteredIds = useMemo(() => filtered.map((u) => String(u.id)), [filtered]);
  const allFilteredSelected = filteredIds.length > 0 && filteredIds.every((id) => selectedIds.has(id));

  const toggleOne = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAllFiltered = () =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) filteredIds.forEach((id) => next.delete(id));
      else filteredIds.forEach((id) => next.add(id));
      return next;
    });
  const clearSelection = () => setSelectedIds(new Set());

  const handleUserUpdated = (updated: User) => {
    setUsers((prev) => prev.map((u) => (String(u.id) === String(updated.id) ? updated : u)));
    setSelectedUser(updated);
  };

  const openBulk = (mode: BulkMode) => {
    setBulkError('');
    setBulkCargo('');
    setBulkApplyTemplate(false);
    setBulkSetor('');
    setBulkPermMode('add');
    setBulkPerms(new Set());
    setBulkMode(mode);
  };

  const groupedCatalog = useMemo(() => {
    const g = new Map<string, PermissionCatalogEntry[]>();
    for (const e of catalog) {
      const list = g.get(e.area) ?? [];
      list.push(e);
      g.set(e.area, list);
    }
    return [...g.entries()];
  }, [catalog]);

  const bulkIds = useMemo(() => [...selectedIds], [selectedIds]);

  const runBulk = async () => {
    setBulkLoading(true);
    setBulkError('');
    try {
      if (bulkMode === 'cargo') {
        if (!bulkCargo) throw new Error('Selecione um cargo.');
        await userService.bulkAssignCargo(bulkIds, bulkCargo, bulkApplyTemplate);
      } else if (bulkMode === 'setor') {
        await userService.bulkAssignSetor(bulkIds, bulkSetor);
      } else if (bulkMode === 'permissions') {
        await userService.bulkSetPermissions(bulkIds, [...bulkPerms], bulkPermMode);
      }
      await reload();
      clearSelection();
      setBulkMode(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Não foi possível aplicar.';
      const data = (err as { response?: { data?: Record<string, unknown> } })?.response?.data;
      const first = data && Object.values(data)[0];
      setBulkError(Array.isArray(first) ? String(first[0]) : (typeof first === 'string' ? first : msg));
    } finally {
      setBulkLoading(false);
    }
  };

  const bulkTitle =
    bulkMode === 'cargo' ? 'Atribuir cargo em massa'
    : bulkMode === 'setor' ? 'Atribuir setor em massa'
    : 'Definir permissões em massa';

  const bulkDetails = (
    <div className="space-y-3">
      <p className="text-sm text-[var(--color-muted-foreground)]">
        {bulkIds.length} usuário(s) selecionado(s) serão alterados.
      </p>
      {bulkMode === 'cargo' && (
        <>
          <FilterSelect
            options={cargoOptions}
            value={bulkCargo}
            onChange={setBulkCargo}
            placeholder="Selecione o cargo"
            searchPlaceholder="Buscar cargo..."
            clearable={false}
          />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={bulkApplyTemplate} onChange={(e) => setBulkApplyTemplate(e.target.checked)} className="h-4 w-4" />
            Aplicar permissões-padrão do cargo (substitui as permissões atuais)
          </label>
        </>
      )}
      {bulkMode === 'setor' && (
        <FilterSelect
          options={setorOptions}
          value={bulkSetor}
          onChange={setBulkSetor}
          placeholder="Sem setor (limpar)"
          searchPlaceholder="Buscar setor..."
        />
      )}
      {bulkMode === 'permissions' && (
        <>
          <div className="flex gap-2">
            {(['add', 'remove', 'set'] as const).map((m) => (
              <Button key={m} type="button" size="sm" variant={bulkPermMode === m ? 'default' : 'outline'} onClick={() => setBulkPermMode(m)}>
                {m === 'add' ? 'Adicionar' : m === 'remove' ? 'Remover' : 'Substituir'}
              </Button>
            ))}
          </div>
          {bulkPermMode === 'set' && (
            <p className="text-xs text-[var(--color-destructive)]">Substituir troca TODAS as permissões dos selecionados.</p>
          )}
          <div className="max-h-[220px] space-y-2 overflow-y-auto rounded-md border border-[var(--color-border)] p-2">
            {groupedCatalog.map(([area, entries]) => (
              <div key={area}>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">{area}</p>
                {entries.map((e) => (
                  <label key={e.codename} className="flex items-center gap-2 py-0.5 text-sm">
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={bulkPerms.has(e.codename)}
                      onChange={() =>
                        setBulkPerms((prev) => {
                          const next = new Set(prev);
                          if (next.has(e.codename)) next.delete(e.codename);
                          else next.add(e.codename);
                          return next;
                        })
                      }
                    />
                    {e.name}
                  </label>
                ))}
              </div>
            ))}
          </div>
        </>
      )}
      {bulkError && <p className="text-sm text-[var(--color-destructive)]">{bulkError}</p>}
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UsersIcon className="h-5 w-5" />
          Usuários
        </CardTitle>
        <CardDescription>
          Ative, desative e atribua permissões. Clique numa linha para editar, ou selecione vários para ações em massa.
        </CardDescription>

        <div className="flex flex-col gap-3 pt-2 lg:flex-row lg:flex-wrap lg:items-center">
          <div className="relative min-w-0 flex-1 lg:min-w-[240px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-muted-foreground)]" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por nome, usuário ou e-mail..." className="pl-9" />
          </div>
          <FilterSelect className="w-full lg:w-[180px]" options={cargoOptions} value={cargoFilter} onChange={setCargoFilter} placeholder="Todos os cargos" searchPlaceholder="Buscar cargo..." />
          <FilterSelect className="w-full lg:w-[180px]" options={setorOptions} value={setorFilter} onChange={setSetorFilter} placeholder="Todos os setores" searchPlaceholder="Buscar setor..." />
          <FilterSelect className="w-full lg:w-[150px]" options={STATUS_OPTIONS} value={statusFilter} onChange={setStatusFilter} placeholder="Todos os status" searchPlaceholder="Buscar status..." />
        </div>
      </CardHeader>

      <CardContent>
        {error && <p className="mb-3 text-sm text-[var(--color-destructive)]">{error}</p>}

        {selectedIds.size > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-[var(--color-primary)]/40 bg-[var(--color-primary)]/5 px-3 py-2">
            <span className="text-sm font-medium">{selectedIds.size} selecionado(s)</span>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => openBulk('cargo')}>
                <Tag className="h-3.5 w-3.5" /> Atribuir cargo
              </Button>
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => openBulk('setor')}>
                <Building2 className="h-3.5 w-3.5" /> Atribuir setor
              </Button>
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => openBulk('permissions')}>
                <ShieldCheck className="h-3.5 w-3.5" /> Permissões
              </Button>
              <Button size="sm" variant="ghost" className="gap-1.5" onClick={clearSelection}>
                <X className="h-3.5 w-3.5" /> Limpar
              </Button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-[var(--color-muted-foreground)]">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando...
          </div>
        ) : (
          <div className="overflow-x-auto rounded-md border border-[var(--color-border)]">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-[var(--color-muted)]/50">
                  <th className="w-0 border-b border-[var(--color-border)] p-3">
                    <input type="checkbox" className="h-4 w-4" checked={allFilteredSelected} onChange={toggleAllFiltered} aria-label="Selecionar todos" />
                  </th>
                  <th className="border-b border-[var(--color-border)] p-3 text-left font-medium">Usuário</th>
                  <th className="border-b border-[var(--color-border)] p-3 text-left font-medium">Cargo</th>
                  <th className="border-b border-[var(--color-border)] p-3 text-left font-medium">Setor</th>
                  <th className="border-b border-[var(--color-border)] p-3 text-left font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="p-8 text-center text-sm text-[var(--color-muted-foreground)]">
                      Nenhum usuário encontrado.
                    </td>
                  </tr>
                ) : (
                  filtered.map((u) => {
                    const id = String(u.id);
                    const checked = selectedIds.has(id);
                    return (
                      <tr
                        key={u.id}
                        className={`border-b border-[var(--color-border)] transition-colors last:border-b-0 hover:bg-[var(--color-accent)] ${checked ? 'bg-[var(--color-primary)]/5' : ''}`}
                      >
                        <td className="p-3" onClick={(e) => e.stopPropagation()}>
                          <input type="checkbox" className="h-4 w-4" checked={checked} onChange={() => toggleOne(id)} aria-label={`Selecionar ${displayName(u)}`} />
                        </td>
                        <td className="cursor-pointer p-3" onClick={() => setSelectedUser(u)}>
                          <div className="flex items-center gap-3">
                            <Avatar className="h-9 w-9 shrink-0">
                              {u.profile_picture_url ? <AvatarImage src={u.profile_picture_url} alt={displayName(u)} /> : null}
                              <AvatarFallback className="bg-[var(--color-muted)] text-xs text-[var(--color-muted-foreground)]">
                                {iniciais(displayName(u))}
                              </AvatarFallback>
                            </Avatar>
                            <div className="min-w-0">
                              <p className="truncate font-medium text-[var(--color-foreground)]">{displayName(u)}</p>
                              <p className="truncate text-xs text-[var(--color-muted-foreground)]">{u.email}</p>
                            </div>
                          </div>
                        </td>
                        <td className="cursor-pointer p-3 text-[var(--color-foreground)]" onClick={() => setSelectedUser(u)}>{u.role_display}</td>
                        <td className="cursor-pointer p-3 text-[var(--color-muted-foreground)]" onClick={() => setSelectedUser(u)}>{u.setor_display || '—'}</td>
                        <td className="cursor-pointer p-3" onClick={() => setSelectedUser(u)}>
                          <Badge variant={u.is_active ? 'success' : 'secondary'}>{u.is_active ? 'Ativo' : 'Inativo'}</Badge>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>

      {selectedUser && (
        <UserPermissionsDialog
          user={selectedUser}
          catalog={catalog}
          cargos={cargos}
          setores={setores}
          open={!!selectedUser}
          onOpenChange={(open) => !open && setSelectedUser(null)}
          onUpdated={handleUserUpdated}
          onCargoCreated={(cargo) => setCargos((prev) => [...prev, cargo])}
          onSetorCreated={(setor) => setSetores((prev) => [...prev, setor])}
        />
      )}

      {bulkMode && (
        <ConfirmDialog
          open={!!bulkMode}
          title={bulkTitle}
          details={bulkDetails}
          confirmLabel="Aplicar"
          variant={bulkMode === 'permissions' && bulkPermMode === 'set' ? 'destructive' : 'default'}
          loading={bulkLoading}
          onConfirm={runBulk}
          onCancel={() => setBulkMode(null)}
        />
      )}
    </Card>
  );
}

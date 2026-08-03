import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { hasPermission } from '@/lib/permissions';
import { userService, type User } from '@/services/userService';
import { Card, CardContent } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, Users as UsersIcon, Search, Settings } from 'lucide-react';
import {
  getCargoColor,
  getCargoLabel,
  getSetorColor,
  chipStyle,
  listarSetoresDoUsuario,
} from '@/lib/catalog-style';
import { SetoresDoUsuario } from '@/components/SetoresDoUsuario';

function iniciais(nome: string): string {
  const p = nome.trim().split(/\s+/).filter(Boolean);
  if (p.length === 0) return '?';
  if (p.length === 1) return p[0].slice(0, 2).toUpperCase();
  return `${p[0][0]}${p[p.length - 1][0]}`.toUpperCase();
}
function displayName(u: User): string {
  const nome = `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim();
  return nome || u.username;
}

const SEM_SETOR = '__sem_setor__';

/** Mural read-only da equipe agrupado por setor. Substitui o antigo organograma
 * (ReactFlow + drag de cargos). Toda a gestão real vive em
 * Configurações → Gerenciamento de Usuários / Setores e Cargos. */
export default function People() {
  const navigate = useNavigate();
  const { user } = useAuth();
  // Botao 'Gerenciar usuarios' aparece para quem administra usuarios.
  const canManage = hasPermission(user, 'manage_users');

  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    userService
      .getAll()
      .then((list) => mounted && setUsers(list))
      .catch(() => mounted && setError('Não foi possível carregar a equipe.'))
      .finally(() => mounted && setLoading(false));
    return () => {
      mounted = false;
    };
  }, []);

  const grupos = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtrados = users.filter((u) => {
      if (!q) return true;
      return `${displayName(u)} ${u.username} ${u.email}`.toLowerCase().includes(q);
    });
    const map = new Map<string, { label: string; codename: string; cor: string; users: User[] }>();
    for (const u of filtrados) {
      // A pessoa entra em TODOS os setores dela — quem está em Tecnologia e
      // Comercial aparece nos dois cards. Antes o mural só olhava o primário e
      // um dos setores da pessoa simplesmente não a listava.
      const setores = listarSetoresDoUsuario(u);
      if (setores.length === 0) {
        const g = map.get(SEM_SETOR) ?? {
          label: 'Sem setor', codename: '', cor: getSetorColor(null), users: [],
        };
        g.users.push(u);
        map.set(SEM_SETOR, g);
        continue;
      }
      for (const s of setores) {
        const g = map.get(s.codename) ?? {
          label: s.nome, codename: s.codename, cor: s.cor || getSetorColor(s.codename), users: [],
        };
        g.users.push(u);
        map.set(s.codename, g);
      }
    }
    return [...map.values()]
      .map((g) => ({ ...g, users: g.users.sort((a, b) => displayName(a).localeCompare(displayName(b), 'pt-BR')) }))
      .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
  }, [users, search]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-[var(--color-foreground)]">
            <UsersIcon className="h-6 w-6" /> Pessoas
          </h1>
          <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
            A equipe organizada por setor. {canManage ? 'Gerencie cargos, setores e permissões em Configurações.' : ''}
          </p>
        </div>
        {canManage && (
          <Button variant="outline" className="gap-2" onClick={() => navigate('/configuracoes?tab=usuarios')}>
            <Settings className="h-4 w-4" /> Gerenciar usuários
          </Button>
        )}
      </div>

      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-muted-foreground)]" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar pessoa..." className="pl-9" />
      </div>

      {error && <p className="text-sm text-[var(--color-destructive)]">{error}</p>}

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-[var(--color-muted-foreground)]">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando...
        </div>
      ) : grupos.length === 0 ? (
        <p className="py-16 text-center text-sm text-[var(--color-muted-foreground)]">Nenhuma pessoa encontrada.</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {grupos.map((g) => (
            <Card key={g.codename || SEM_SETOR}>
              <CardContent className="p-4">
                <div className="mb-3 flex items-center gap-2">
                  <span className="h-3 w-3 rounded-full" style={{ backgroundColor: g.cor }} />
                  <h2 className="text-sm font-semibold text-[var(--color-foreground)]">{g.label}</h2>
                  <Badge variant="secondary" className="ml-auto">{g.users.length}</Badge>
                </div>
                <div className="space-y-2">
                  {g.users.map((u) => (
                    <div key={u.id} className="flex items-center gap-3 rounded-md border border-[var(--color-border)] px-3 py-2">
                      <Avatar className="h-8 w-8 shrink-0">
                        {u.profile_picture_url ? <AvatarImage src={u.profile_picture_url} alt={displayName(u)} /> : null}
                        <AvatarFallback className="bg-[var(--color-muted)] text-[10px] text-[var(--color-muted-foreground)]">
                          {iniciais(displayName(u))}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-[var(--color-foreground)]">{displayName(u)}</p>
                        <p className="truncate text-xs text-[var(--color-muted-foreground)]">{u.email}</p>
                        {/* De dentro de um card só dá para saber que a pessoa
                            também está em outro setor se isso estiver escrito
                            aqui. Só aparece para quem tem mais de um — repetir
                            o setor do cabeçalho em todo mundo seria ruído. */}
                        {listarSetoresDoUsuario(u).length > 1 && (
                          <SetoresDoUsuario
                            usuario={u}
                            curto
                            max={3}
                            vazio=""
                            className="mt-1"
                            badgeClassName="px-[6px] py-0 text-[10px] font-medium"
                          />
                        )}
                      </div>
                      <Badge className="border shrink-0 whitespace-nowrap" style={chipStyle(getCargoColor(u.role))}>
                        {getCargoLabel(u.role) || u.role_display}
                      </Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

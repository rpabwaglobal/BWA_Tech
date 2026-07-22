import { useEffect, useMemo, useState, useCallback, type ReactNode } from 'react';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { Loader2, Headset, Trophy, Users, Layers, Tag, Target } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FilterSelect } from '@/components/ui/filter-select';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { suporteService, catalogNome, type ChamadoSuporte } from '@/services/suporteService';
import { suporteTimelineService } from '@/services/suporteTimelineService';
import { userService, type User } from '@/services/userService';

/** Cor da barra por cargo — mesma paleta do gráfico "Cards finalizados por
 * usuário" (Metrics.tsx). */
function getRoleBarColor(role: string): string {
  switch (role) {
    case 'admin':
      return '#c4b5fd'; // purple-300
    case 'supervisor':
      return '#93c5fd'; // blue-300
    case 'gerente':
      return '#86efac'; // green-300
    case 'desenvolvedor':
      return '#fdba74'; // orange-300
    case 'dados':
      return '#c4b5fd'; // purple-300
    case 'processos':
      return '#fca5a5'; // red-300
    default:
      return '#9ca3af'; // gray-400
  }
}

/** Altura de cada linha nas barras horizontais (px) e nº máximo de barras
 * visíveis antes de aparecer a rolagem interna. */
const LINHA_PX = 48;
const MAX_LINHAS_VISIVEIS = 10;

/** Altura real do gráfico (todas as barras) e altura visível (rola no excedente). */
function alturasBarras(rowCount: number): { inner: number; outer: number } {
  const inner = Math.min(1400, Math.max(320, rowCount * LINHA_PX));
  const outer = Math.min(inner, MAX_LINHAS_VISIVEIS * LINHA_PX);
  return { inner, outer };
}

type Escopo = 'year' | 'month' | 'interval';

const MONTH_NAMES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function ticketDate(t: ChamadoSuporte): Date | null {
  if (!t.data_abertura) return null;
  const d = new Date(t.data_abertura);
  return Number.isNaN(d.getTime()) ? null : d;
}

function normalizeNome(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
}

function displayUserName(u: User): string {
  const full = `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim();
  return full || u.username;
}

function iniciais(nome: string): string {
  const parts = nome.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

type RankRow = { label: string; count: number };

function rankBy(
  tickets: ChamadoSuporte[],
  keyFn: (t: ChamadoSuporte) => string | null | undefined,
): RankRow[] {
  const map = new Map<string, number>();
  for (const t of tickets) {
    const k = (keyFn(t) ?? '').trim();
    if (!k) continue;
    map.set(k, (map.get(k) ?? 0) + 1);
  }
  return [...map.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'pt-BR'));
}

/** Campo de filtro: rótulo pequeno acima do controle. */
function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] text-[var(--color-muted-foreground)]">{label}</span>
      {children}
    </div>
  );
}

type Opcoes = { anos: number[]; tipos: string[]; usuarios: string[] };

/** Estado + UI de filtros de um card (período por ano/mês/intervalo + usuário +
 * tipo). Cada card instancia o próprio hook → filtros independentes, no header. */
function useTicketFilter(tickets: ChamadoSuporte[], opcoes: Opcoes) {
  const now = new Date();
  const [escopo, setEscopo] = useState<Escopo>('month');
  const [ano, setAno] = useState<number>(now.getFullYear());
  const [mes, setMes] = useState<number>(now.getMonth() + 1);
  const [ini, setIni] = useState('');
  const [fim, setFim] = useState('');
  const [usuarios, setUsuarios] = useState<string[]>([]);
  const [tipo, setTipo] = useState('');

  const filtrados = useMemo(() => {
    return tickets.filter((t) => {
      const d = ticketDate(t);
      if (!d) return false;
      if (escopo === 'year') {
        if (d.getFullYear() !== ano) return false;
      } else if (escopo === 'month') {
        if (d.getFullYear() !== ano || d.getMonth() + 1 !== mes) return false;
      } else {
        if (ini && d < new Date(`${ini}T00:00:00`)) return false;
        if (fim && d > new Date(`${fim}T23:59:59`)) return false;
      }
      if (usuarios.length && !usuarios.includes((t.usuario_nome ?? '').trim())) return false;
      if (tipo && catalogNome(t.tipo) !== tipo) return false;
      return true;
    });
  }, [tickets, escopo, ano, mes, ini, fim, usuarios, tipo]);

  const label =
    escopo === 'year'
      ? `Ano ${ano}`
      : escopo === 'month'
        ? `${MONTH_NAMES[mes - 1]} de ${ano}`
        : ini || fim
          ? `${ini || '…'} a ${fim || '…'}`
          : 'Intervalo (defina as datas)';

  const ui = (
    <div className="flex flex-wrap items-end gap-x-3 gap-y-2 pt-2">
      <FilterField label="Escopo">
        <FilterSelect
          className="min-w-[130px]"
          clearable={false}
          value={escopo}
          onChange={(v) => setEscopo(v as Escopo)}
          placeholder="Escopo"
          searchPlaceholder="Buscar..."
          options={[
            { value: 'month', label: 'Por mês' },
            { value: 'year', label: 'Por ano' },
            { value: 'interval', label: 'Por intervalo' },
          ]}
        />
      </FilterField>

      {escopo !== 'interval' && (
        <FilterField label="Ano">
          <FilterSelect
            className="min-w-[100px]"
            clearable={false}
            value={String(ano)}
            onChange={(v) => setAno(Number(v))}
            placeholder="Ano"
            searchPlaceholder="Buscar ano..."
            options={opcoes.anos.map((a) => ({ value: String(a), label: String(a) }))}
          />
        </FilterField>
      )}

      {escopo === 'month' && (
        <FilterField label="Mês">
          <FilterSelect
            className="min-w-[130px]"
            clearable={false}
            value={String(mes)}
            onChange={(v) => setMes(Number(v))}
            placeholder="Mês"
            searchPlaceholder="Buscar mês..."
            options={MONTH_NAMES.map((nome, i) => ({ value: String(i + 1), label: nome }))}
          />
        </FilterField>
      )}

      {escopo === 'interval' && (
        <>
          <FilterField label="De">
            <Input type="date" className="min-w-[140px]" value={ini} onChange={(e) => setIni(e.target.value)} />
          </FilterField>
          <FilterField label="Até">
            <Input type="date" className="min-w-[140px]" value={fim} onChange={(e) => setFim(e.target.value)} />
          </FilterField>
        </>
      )}

      <FilterField label="Usuário">
        <FilterSelect
          className="min-w-[170px]"
          multiple
          values={usuarios}
          onValuesChange={setUsuarios}
          placeholder="Todos"
          searchPlaceholder="Buscar usuário..."
          options={opcoes.usuarios.map((u) => ({ value: u, label: u }))}
        />
      </FilterField>

      <FilterField label="Tipo">
        <FilterSelect
          className="min-w-[150px]"
          value={tipo}
          onChange={setTipo}
          placeholder="Todos"
          searchPlaceholder="Buscar tipo..."
          options={opcoes.tipos.map((t) => ({ value: t, label: t }))}
        />
      </FilterField>
    </div>
  );

  return { filtrados, ui, label };
}

/** Gráfico de linha: abertura de tickets por dia. */
function GraficoAberturaPorDia({ tickets, opcoes }: { tickets: ChamadoSuporte[]; opcoes: Opcoes }) {
  const filtro = useTicketFilter(tickets, opcoes);
  const porDia = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of filtro.filtrados) {
      const d = ticketDate(t);
      if (!d) continue;
      const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([iso, qtd]) => ({ dia: iso.slice(5).replace('-', '/'), qtd }));
  }, [filtro.filtrados]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Headset className="h-5 w-5" />
          Abertura de tickets por dia
        </CardTitle>
        <CardDescription>Tickets abertos por dia — {filtro.label}.</CardDescription>
        {filtro.ui}
      </CardHeader>
      <CardContent>
        {porDia.length === 0 ? (
          <p className="py-10 text-center text-sm text-[var(--color-muted-foreground)]">
            Nenhum ticket aberto no período.
          </p>
        ) : (
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={porDia} margin={{ left: 4, right: 12, top: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                <XAxis
                  dataKey="dia"
                  tick={{ fontSize: 11, fill: 'var(--color-muted-foreground)' }}
                  interval="preserveStartEnd"
                  minTickGap={16}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 11, fill: 'var(--color-muted-foreground)' }}
                  width={28}
                />
                <Tooltip
                  cursor={{ stroke: 'var(--color-muted)', strokeWidth: 1 }}
                  contentStyle={{
                    background: 'var(--color-card)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  labelFormatter={(l) => `Dia ${l}`}
                />
                <Line
                  type="monotone"
                  dataKey="qtd"
                  name="Tickets"
                  stroke="var(--color-primary)"
                  strokeWidth={2}
                  dot={{ r: 3, fill: 'var(--color-primary)', strokeWidth: 0 }}
                  activeDot={{ r: 5 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

type UserInfo = { foto: string | null; role: string };
type PodioRow = { label: string; count: number; foto: string | null };

/** Pódio dos 3 primeiros: foto + nome acima e número (tickets) no degrau.
 * Ordem visual clássica 2º-1º-3º, com os degraus encostados formando um bloco. */
function Podio({ top }: { top: PodioRow[] }) {
  const col = (row: PodioRow | undefined, pos: 1 | 2 | 3) => {
    const cfg =
      pos === 1
        ? { degrau: 'h-[84px]', cor: '#D4AF37', avatar: 'h-16 w-16', ring: 'ring-[#D4AF37]' }
        : pos === 2
          ? { degrau: 'h-[64px]', cor: '#B4B4B4', avatar: 'h-14 w-14', ring: 'ring-[#B4B4B4]' }
          : { degrau: 'h-[48px]', cor: '#CD7F32', avatar: 'h-12 w-12', ring: 'ring-[#CD7F32]' };
    return (
      <div className="flex w-[116px] flex-col items-center">
        {row ? (
          <>
            <Avatar className={cn(cfg.avatar, 'shrink-0 ring-2 ring-offset-2 ring-offset-[var(--color-card)]', cfg.ring)}>
              {row.foto ? <AvatarImage src={row.foto} alt={row.label} /> : null}
              <AvatarFallback className="bg-[var(--color-muted)] text-xs text-[var(--color-muted-foreground)]">
                {iniciais(row.label)}
              </AvatarFallback>
            </Avatar>
            <span
              className="mt-1 mb-1 max-w-full truncate px-1 text-center text-xs font-medium text-[var(--color-foreground)]"
              title={row.label}
            >
              {row.label}
            </span>
          </>
        ) : (
          <div className="flex-1" />
        )}
        <div
          className={cn('flex w-full flex-col items-center justify-center', cfg.degrau, row ? 'rounded-t-md' : '')}
          style={{ background: row ? cfg.cor : 'transparent' }}
        >
          {row && (
            <>
              <span className="text-xl font-bold leading-none text-white drop-shadow">{row.count}</span>
              <span className="mt-[3px] text-[10px] font-semibold text-white/85">{pos}º</span>
            </>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="mx-auto mt-4 flex max-w-[420px] items-end justify-center gap-2">
      {col(top[1], 2)}
      {col(top[0], 1)}
      {col(top[2], 3)}
    </div>
  );
}

/** Card de responsável pela solução: filtros + pódio no header e gráfico de
 * barras horizontais (foto+nome no eixo Y) no corpo — reativos aos filtros. */
function ResponsavelCard({
  tickets,
  opcoes,
  infoDe,
  resolvidoEmMap,
}: {
  tickets: ChamadoSuporte[];
  opcoes: Opcoes;
  infoDe: (nome: string) => UserInfo;
  /** chamado.id → ISO da conclusão (timeline). Usado pra separar o modal em
   * dentro/fora do prazo, igual à tabela de SLA. */
  resolvidoEmMap: Record<number, string>;
}) {
  const filtro = useTicketFilter(tickets, opcoes);
  const [sel, setSel] = useState<string | null>(null);
  const [tab, setTab] = useState<'onTime' | 'late' | 'sem'>('onTime');
  const rows = useMemo(
    () =>
      rankBy(filtro.filtrados, (t) => t.responsavel_solucao).map((r) => {
        const info = infoDe(r.label);
        return { ...r, foto: info.foto, role: info.role };
      }),
    [filtro.filtrados, infoDe],
  );
  const podio = rows.slice(0, 3);
  const chartData = rows.map((r) => ({ name: r.label, count: r.count, foto: r.foto, role: r.role }));
  // Grossura igual à dos gráficos de projetos/cards (48px/linha, sem barSize),
  // mostrando no máx. 10 barras e rolando o excedente.
  const { inner: innerHeight, outer: outerHeight } = alturasBarras(rows.length);

  const ticketsSel = useMemo(
    () =>
      sel
        ? filtro.filtrados
            .filter((t) => (t.responsavel_solucao ?? '').trim() === sel)
            .sort((a, b) => (b.data_abertura ?? '').localeCompare(a.data_abertura ?? ''))
        : [],
    [sel, filtro.filtrados],
  );
  // Mesmas abas da tabela de SLA. `semMedicao` mantém o total do modal igual
  // ao número da barra (o gráfico conta todo ticket com responsável, inclusive
  // os que ainda não foram resolvidos).
  const grupos = useMemo(() => agruparPorSla(ticketsSel, resolvidoEmMap), [ticketsSel, resolvidoEmMap]);
  const abrirResponsavel = (nome: string) => {
    const g = agruparPorSla(
      filtro.filtrados.filter((t) => (t.responsavel_solucao ?? '').trim() === nome),
      resolvidoEmMap,
    );
    setTab(g.onTime.length ? 'onTime' : g.late.length ? 'late' : 'sem');
    setSel(nome);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Trophy className="h-5 w-5" />
          Responsável pela solução
        </CardTitle>
        <CardDescription>Quem mais resolveu tickets — {filtro.label}.</CardDescription>
        {filtro.ui}
        {podio.length > 0 && <Podio top={podio} />}
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-[var(--color-muted-foreground)]">
            Nenhum ticket com responsável no período.
          </p>
        ) : (
          <div
            className="w-full overflow-y-auto overflow-x-hidden rounded-md"
            style={{ height: `${outerHeight}px` }}
          >
            <div style={{ height: `${innerHeight}px` }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 16, top: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" horizontal={false} />
                <XAxis
                  type="number"
                  allowDecimals={false}
                  tick={{ fontSize: 11, fill: 'var(--color-muted-foreground)' }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={200}
                  interval={0}
                  tickLine={false}
                  axisLine={false}
                  tick={((props: { x?: number; y?: number; payload?: { value?: string }; index?: number }) => {
                    const { x = 0, y = 0, payload, index } = props;
                    const i =
                      typeof index === 'number' && index >= 0
                        ? index
                        : chartData.findIndex((r) => r.name === payload?.value);
                    const row = i >= 0 ? chartData[i] : undefined;
                    if (!row) return <g />;
                    return (
                      <g transform={`translate(${x},${y})`}>
                        <foreignObject x={-192} y={-16} width={186} height={32} style={{ overflow: 'visible' }}>
                          <div className="flex h-8 items-center gap-2 pr-1">
                            <Avatar className="h-6 w-6 shrink-0 border border-[var(--color-border)]/60">
                              {row.foto ? <AvatarImage src={row.foto} alt={row.name} /> : null}
                              <AvatarFallback className="bg-[var(--color-muted)] text-[9px] text-[var(--color-muted-foreground)]">
                                {iniciais(row.name)}
                              </AvatarFallback>
                            </Avatar>
                            <span className="min-w-0 flex-1 truncate text-xs font-medium text-[var(--color-foreground)]">
                              {row.name}
                            </span>
                          </div>
                        </foreignObject>
                      </g>
                    );
                  }) as never}
                />
                <Tooltip
                  cursor={{ fill: 'var(--color-muted)', opacity: 0.3 }}
                  contentStyle={{
                    background: 'var(--color-card)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Bar
                  dataKey="count"
                  name="Tickets"
                  radius={[0, 4, 4, 0]}
                  cursor="pointer"
                  onClick={((data: { name?: string }) => {
                    if (data?.name) abrirResponsavel(data.name);
                  }) as never}
                >
                  {chartData.map((row) => (
                    <Cell key={row.name} fill={getRoleBarColor(row.role)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            </div>
          </div>
        )}

      </CardContent>

      <Dialog
        open={!!sel}
        onOpenChange={(o) => {
          if (!o) setSel(null);
        }}
        containerClassName="max-w-2xl"
      >
        <DialogContent onClose={() => setSel(null)} className="flex max-h-[90vh] flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Trophy className="h-5 w-5" />
              Tickets resolvidos por {sel}
            </DialogTitle>
            <p className="text-sm text-[var(--color-muted-foreground)]">
              {ticketsSel.length} ticket(s) — {filtro.label}
              {grupos.onTime.length + grupos.late.length > 0 && (
                <>
                  {' '}
                  · {grupos.onTime.length} de {grupos.onTime.length + grupos.late.length} no prazo (
                  {Math.round(
                    (grupos.onTime.length / (grupos.onTime.length + grupos.late.length)) * 100,
                  )}
                  %)
                </>
              )}
            </p>
          </DialogHeader>

          {ticketsSel.length === 0 ? (
            <p className="py-8 text-center text-sm text-[var(--color-muted-foreground)]">
              Nenhum ticket deste responsável no período filtrado.
            </p>
          ) : (
            <div className="mt-2 flex min-h-0 flex-1 flex-col gap-0">
              <div className="flex gap-[8px] border-b border-[var(--color-border)]">
                <Button
                  type="button"
                  variant="ghost"
                  disabled={grupos.onTime.length === 0}
                  onClick={() => setTab('onTime')}
                  className={cn(
                    'h-auto rounded-none border-b-2 border-transparent px-[16px] py-[8px]',
                    tab === 'onTime'
                      ? 'border-[var(--color-primary)] font-semibold text-[var(--color-primary)]'
                      : 'text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]',
                  )}
                >
                  No prazo ({grupos.onTime.length})
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={grupos.late.length === 0}
                  onClick={() => setTab('late')}
                  className={cn(
                    'h-auto rounded-none border-b-2 border-transparent px-[16px] py-[8px]',
                    tab === 'late'
                      ? 'border-[var(--color-primary)] font-semibold text-[var(--color-primary)]'
                      : 'text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]',
                  )}
                >
                  Fora do prazo ({grupos.late.length})
                </Button>
                {grupos.semMedicao.length > 0 && (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setTab('sem')}
                    title="Tickets ainda não resolvidos ou sem data de conclusão registrada"
                    className={cn(
                      'h-auto rounded-none border-b-2 border-transparent px-[16px] py-[8px]',
                      tab === 'sem'
                        ? 'border-[var(--color-primary)] font-semibold text-[var(--color-primary)]'
                        : 'text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]',
                    )}
                  >
                    Sem medição ({grupos.semMedicao.length})
                  </Button>
                )}
              </div>
              <div className="min-h-0 max-h-[min(60vh,520px)] flex-1 overflow-y-auto pr-1 pt-3">
                {tab === 'sem' ? (
                  grupos.semMedicao.length > 0 ? (
                    <ul className="space-y-2">
                      {grupos.semMedicao.map((t) => (
                        <SlaTicketRow key={t.id} ticket={t} medida={null} />
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-[var(--color-muted-foreground)]">
                      Nenhum ticket sem medição neste filtro.
                    </p>
                  )
                ) : (tab === 'onTime' ? grupos.onTime : grupos.late).length > 0 ? (
                  <ul className="space-y-2">
                    {(tab === 'onTime' ? grupos.onTime : grupos.late).map((item) => (
                      <SlaTicketRow key={item.ticket.id} ticket={item.ticket} medida={item} />
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-[var(--color-muted-foreground)]">
                    {tab === 'onTime'
                      ? 'Nenhum ticket no prazo neste filtro.'
                      : 'Nenhum ticket fora do prazo neste filtro.'}
                  </p>
                )}
              </div>
              <DialogFooter className="mt-0 shrink-0 border-t border-[var(--color-border)] pt-4">
                <Button type="button" variant="outline" onClick={() => setSel(null)}>
                  Fechar
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

/** SLA de resolução dos tickets: 24h entre a abertura e a resolução. */
const SLA_HORAS = 24;

/** Ticket já medido: guarda as duas pontas e o tempo, pra listar no modal
 * sem recalcular. `resolucao` vem da timeline (nunca de data_atualizacao). */
type SlaTicket = {
  ticket: ChamadoSuporte;
  abertura: Date;
  resolucao: Date;
  horas: number;
};

type SlaLinha = {
  total: number;
  onTime: number;
  late: number;
  onTimeTickets: SlaTicket[];
  lateTickets: SlaTicket[];
};

/** Mede um ticket: abertura → conclusão (data da timeline). Retorna null
 * quando não dá pra medir — não resolvido, sem abertura, ou sem evento de
 * conclusão registrado. Fonte ÚNICA da medição: as duas telas (tabela de SLA
 * e modal do gráfico de responsáveis) usam esta função pra não divergirem. */
function medirSla(t: ChamadoSuporte, resolvidoEmMap: Record<number, string>): SlaTicket | null {
  if (t.status !== 'Resolvido') return null;
  const iso = resolvidoEmMap[t.id];
  if (!iso || !t.data_abertura) return null;
  const abertura = new Date(t.data_abertura);
  const resolucao = new Date(iso);
  if (Number.isNaN(abertura.getTime()) || Number.isNaN(resolucao.getTime())) return null;
  return {
    ticket: t,
    abertura,
    resolucao,
    horas: (resolucao.getTime() - abertura.getTime()) / 3_600_000,
  };
}

/** Separa uma lista de tickets nas abas do modal. `semMedicao` existe pra o
 * total do modal bater com o número mostrado no gráfico/tabela. */
function agruparPorSla(tickets: ChamadoSuporte[], resolvidoEmMap: Record<number, string>) {
  const onTime: SlaTicket[] = [];
  const late: SlaTicket[] = [];
  const semMedicao: ChamadoSuporte[] = [];
  for (const t of tickets) {
    const medida = medirSla(t, resolvidoEmMap);
    if (!medida) semMedicao.push(t);
    else if (medida.horas <= SLA_HORAS) onTime.push(medida);
    else late.push(medida);
  }
  const recentesPrimeiro = (a: SlaTicket, b: SlaTicket) => b.resolucao.getTime() - a.resolucao.getTime();
  onTime.sort(recentesPrimeiro);
  late.sort(recentesPrimeiro);
  semMedicao.sort((a, b) => (b.data_abertura ?? '').localeCompare(a.data_abertura ?? ''));
  return { onTime, late, semMedicao };
}

/** "3h12" / "2d 4h" — leitura rápida do tempo de resolução. */
function formatDuracao(horas: number): string {
  if (horas < 1) return `${Math.max(1, Math.round(horas * 60))}min`;
  if (horas < 24) {
    const h = Math.floor(horas);
    const m = Math.round((horas - h) * 60);
    return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
  }
  const d = Math.floor(horas / 24);
  const h = Math.round(horas % 24);
  return h ? `${d}d ${h}h` : `${d}d`;
}

function formatDataHora(d: Date): string {
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Linha de ticket no modal de SLA — espelha o MetricsDeliveredCardRow da
 * página de Métricas (mesmo layout de badge + grade de datas). A variante sai
 * da própria medição: badge e grupo nunca podem divergir. `medida = null` é o
 * ticket que não dá pra medir (não resolvido ou sem data de conclusão). */
function SlaTicketRow({ ticket: t, medida }: { ticket: ChamadoSuporte; medida: SlaTicket | null }) {
  const variant = medida ? (medida.horas <= SLA_HORAS ? 'onTime' : 'late') : 'sem';
  const aberturaTxt = t.data_abertura ? formatDataHora(new Date(t.data_abertura)) : '—';
  return (
    <li>
      <div className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-card)] p-3 text-left text-sm">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <span className="font-medium text-[var(--color-foreground)]">
            #{t.id} · {catalogNome(t.item)} — {catalogNome(t.motivo)}
          </span>
          {variant === 'onTime' ? (
            <Badge className="shrink-0 border-green-600/40 bg-green-500/15 text-green-800 dark:text-green-400">
              No prazo · {formatDuracao(medida!.horas)}
            </Badge>
          ) : variant === 'late' ? (
            <Badge className="shrink-0 border-red-600/40 bg-red-500/15 text-red-800 dark:text-red-400">
              Fora do prazo · {formatDuracao(medida!.horas)}
            </Badge>
          ) : (
            <Badge variant="secondary" className="shrink-0">
              {t.status === 'Resolvido' ? 'Sem data de conclusão' : t.status}
            </Badge>
          )}
        </div>
        <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">
          {catalogNome(t.tipo)}
          {t.usuario_nome ? ` · Solicitante: ${t.usuario_nome}` : ''}
        </p>
        <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs sm:grid-cols-3">
          <div>
            <dt className="text-[var(--color-muted-foreground)]">Aberto em</dt>
            <dd className="font-medium text-[var(--color-foreground)]">{aberturaTxt}</dd>
          </div>
          <div>
            <dt className="text-[var(--color-muted-foreground)]">Concluído em</dt>
            <dd className="font-medium text-[var(--color-foreground)]">
              {medida ? formatDataHora(medida.resolucao) : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-[var(--color-muted-foreground)]">Tempo até a conclusão</dt>
            <dd
              className={cn(
                'font-medium',
                variant === 'late' ? 'text-[var(--color-destructive)]' : 'text-[var(--color-foreground)]',
              )}
            >
              {medida ? formatDuracao(medida.horas) : '—'}
            </dd>
          </div>
        </dl>
        {!medida && t.status === 'Resolvido' && (
          <p className="mt-2 text-xs text-[var(--color-warning,#b45309)]">
            Sem registro de mudança de etapa no quadro do BWA — fora do cálculo de SLA.
          </p>
        )}
        {t.descricao && (
          <p className="mt-2 line-clamp-2 text-xs text-[var(--color-foreground)]/80">{t.descricao}</p>
        )}
      </div>
    </li>
  );
}

/** Tabela de consistência de SLA (mesmo layout da "Consistência de entrega" dos
 * projetos/cards), por responsável pela solução. Considera apenas tickets
 * resolvidos e classifica dentro/fora do prazo de 24h. */
function TabelaSlaSuporte({
  tickets,
  opcoes,
  infoDe,
  resolvidoEmMap,
  erroResolvidoEm,
}: {
  tickets: ChamadoSuporte[];
  opcoes: Opcoes;
  infoDe: (nome: string) => UserInfo;
  /** chamado.id → ISO da última troca de etapa (timeline local). Fonte
   * confiável de "quando foi resolvido"; `data_atualizacao` é auto_now e
   * pode ser reescrito por toques sem relação com a conclusão. */
  resolvidoEmMap: Record<number, string>;
  /** true = não foi possível carregar as datas de conclusão. Sem elas o SLA
   * não é calculável — mostramos o aviso em vez de números incorretos. */
  erroResolvidoEm: boolean;
}) {
  const filtro = useTicketFilter(tickets, opcoes);
  /** Responsável selecionado (clique na linha) → abre o modal com os tickets. */
  const [sel, setSel] = useState<string | null>(null);
  const [tab, setTab] = useState<'onTime' | 'late'>('onTime');
  const { linhas, semDataConclusao } = useMemo(() => {
    const map = new Map<string, SlaLinha>();
    let semData = 0;
    for (const t of filtro.filtrados) {
      if (t.status !== 'Resolvido') continue;
      const nome = (t.responsavel_solucao ?? '').trim();
      if (!nome) continue;
      // Só a timeline (evento real de troca pra etapa Concluído) conta pro
      // SLA. `data_atualizacao` NÃO é usado nem como fallback — é auto_now e
      // pode ser reescrito por toques sem relação com a conclusão (essa era
      // a causa do bug: um card resolvido dia 03 aparecia "atualizado" dia
      // 11 sem nenhuma mudança de etapa real). Ticket sem esse evento
      // registrado fica de fora do cálculo em vez de entrar com data errada.
      const item = medirSla(t, resolvidoEmMap);
      if (!item) {
        semData += 1;
        continue;
      }
      const rec = map.get(nome) ?? { total: 0, onTime: 0, late: 0, onTimeTickets: [], lateTickets: [] };
      rec.total += 1;
      if (item.horas <= SLA_HORAS) {
        rec.onTime += 1;
        rec.onTimeTickets.push(item);
      } else {
        rec.late += 1;
        rec.lateTickets.push(item);
      }
      map.set(nome, rec);
    }
    // Mais recentes primeiro dentro de cada aba do modal.
    const porConclusaoDesc = (a: SlaTicket, b: SlaTicket) => b.resolucao.getTime() - a.resolucao.getTime();
    const linhas = [...map.entries()]
      .map(([nome, r]) => ({
        nome,
        ...r,
        onTimeTickets: [...r.onTimeTickets].sort(porConclusaoDesc),
        lateTickets: [...r.lateTickets].sort(porConclusaoDesc),
        pct: r.total ? Math.round((r.onTime / r.total) * 100) : 0,
        foto: infoDe(nome).foto,
      }))
      .sort(
        (a, b) => b.pct - a.pct || b.total - a.total || a.nome.localeCompare(b.nome, 'pt-BR'),
      );
    return { linhas, semDataConclusao: semData };
  }, [filtro.filtrados, infoDe, resolvidoEmMap]);

  const totalResolvidos = linhas.reduce((s, l) => s + l.total, 0);
  const totalOnTime = linhas.reduce((s, l) => s + l.onTime, 0);
  const pctGeral = totalResolvidos ? Math.round((totalOnTime / totalResolvidos) * 100) : 0;
  // Linha do responsável aberto no modal. Derivada (não duplicada em estado)
  // pra acompanhar sozinha a troca de filtro de período.
  const selLinha = useMemo(() => linhas.find((l) => l.nome === sel) ?? null, [linhas, sel]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Target className="h-5 w-5" />
          Consistência de SLA (24h)
        </CardTitle>
        <CardDescription>
          Tickets resolvidos dentro do prazo de {SLA_HORAS}h (da abertura até a data em que o
          card foi movido pra etapa Concluído), por responsável — {filtro.label}.
          {totalResolvidos > 0 && (
            <>
              {' '}
              No período: <strong>{totalOnTime}</strong> de <strong>{totalResolvidos}</strong>{' '}
              resolvidos no prazo (<strong>{pctGeral}%</strong>).
            </>
          )}
          {!erroResolvidoEm && semDataConclusao > 0 && (
            <>
              {' '}
              <span className="text-[var(--color-warning,#b45309)]">
                {semDataConclusao} ticket{semDataConclusao > 1 ? 's' : ''} resolvido
                {semDataConclusao > 1 ? 's' : ''} sem data de conclusão registrada — fora deste
                cálculo (o card nunca teve a etapa alterada pelo quadro do BWA).
              </span>
            </>
          )}
        </CardDescription>
        {filtro.ui}
      </CardHeader>
      <CardContent>
        {erroResolvidoEm ? (
          <p className="py-6 text-center text-sm text-[var(--color-destructive)]">
            Não foi possível carregar as datas de conclusão dos tickets. O SLA depende delas para
            ser calculado corretamente, então preferimos não exibir números do que exibir errado.
            Recarregue a página; se persistir, avise o time de tecnologia.
          </p>
        ) : linhas.length === 0 ? (
          <p className="py-6 text-center text-sm text-[var(--color-muted-foreground)]">
            Nenhum ticket resolvido no período.
          </p>
        ) : (
          <div className="overflow-hidden rounded-md border border-[var(--color-border)]">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-[var(--color-muted)]/50">
                  <th className="w-0 whitespace-nowrap border-b border-r border-[var(--color-border)] p-3 text-center font-medium">
                    Top
                  </th>
                  <th className="border-b border-r border-[var(--color-border)] p-3 text-left font-medium">
                    Responsável
                  </th>
                  <th className="border-b border-r border-[var(--color-border)] p-3 text-right font-medium">
                    Resolvidos
                  </th>
                  <th className="border-b border-r border-[var(--color-border)] p-3 text-right font-medium">
                    No prazo
                  </th>
                  <th className="border-b border-r border-[var(--color-border)] p-3 text-right font-medium">
                    Fora do prazo
                  </th>
                  <th className="border-b border-[var(--color-border)] p-3 text-right font-medium">
                    % no prazo
                  </th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((row, i) => {
                  const rank = i + 1;
                  const rowBg =
                    row.total === 0
                      ? 'bg-[var(--color-muted)]/25'
                      : row.pct < 85
                        ? 'bg-[#fca5a540]'
                        : 'bg-[#86efac40]';
                  const pctColor =
                    row.total === 0
                      ? 'text-[var(--color-muted-foreground)]'
                      : row.pct >= 90
                        ? 'text-green-700 dark:text-green-400'
                        : row.pct >= 85
                          ? 'text-yellow-600 dark:text-yellow-500'
                          : 'text-red-700 dark:text-red-400';
                  const topCell =
                    rank === 1 ? (
                      <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-amber-400 text-xs font-bold text-amber-950 shadow-sm" title="Ouro">
                        1
                      </span>
                    ) : rank === 2 ? (
                      <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-slate-300 text-xs font-bold text-slate-800 shadow-sm" title="Prata">
                        2
                      </span>
                    ) : rank === 3 ? (
                      <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-amber-700 text-xs font-bold text-amber-100 shadow-sm" title="Bronze">
                        3
                      </span>
                    ) : (
                      <span className="text-[var(--color-foreground)]">{rank}</span>
                    );
                  const abrir = () => {
                    if (row.total === 0) return;
                    // Abre já na aba que tem conteúdo (se só houver atrasados,
                    // não faz sentido cair numa aba vazia).
                    setTab(row.onTime > 0 ? 'onTime' : 'late');
                    setSel(row.nome);
                  };
                  return (
                    <tr
                      key={row.nome}
                      role={row.total > 0 ? 'button' : undefined}
                      tabIndex={row.total > 0 ? 0 : undefined}
                      title={row.total > 0 ? 'Ver tickets deste responsável' : undefined}
                      className={`${rowBg} border-b border-[var(--color-border)]${
                        row.total > 0 ? ' cursor-pointer hover:opacity-90' : ''
                      }`}
                      onClick={abrir}
                      onKeyDown={(e) => {
                        if (row.total > 0 && (e.key === 'Enter' || e.key === ' ')) {
                          e.preventDefault();
                          abrir();
                        }
                      }}
                    >
                      <td className="w-0 whitespace-nowrap border-r border-[var(--color-border)] p-3">
                        <div className="flex justify-center">{topCell}</div>
                      </td>
                      <td className="border-r border-[var(--color-border)] p-3">
                        <div className="flex items-center gap-2">
                          <Avatar className="h-8 w-8 shrink-0">
                            {row.foto ? <AvatarImage src={row.foto} alt={row.nome} /> : null}
                            <AvatarFallback className="bg-[var(--color-muted)] text-xs text-[var(--color-muted-foreground)]">
                              {iniciais(row.nome)}
                            </AvatarFallback>
                          </Avatar>
                          <span className="font-medium">{row.nome}</span>
                        </div>
                      </td>
                      <td className="border-r border-[var(--color-border)] p-3 text-right">{row.total}</td>
                      <td className={`border-r border-[var(--color-border)] p-3 text-right ${row.onTime > 0 ? 'font-medium text-green-700 dark:text-green-400' : ''}`}>
                        {row.onTime}
                      </td>
                      <td className={`border-r border-[var(--color-border)] p-3 text-right ${row.late > 0 ? 'font-medium text-red-700 dark:text-red-400' : ''}`}>
                        {row.late}
                      </td>
                      <td className={`p-3 text-right font-semibold ${pctColor}`}>{row.pct}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>

      {/* Clique numa linha → tickets do responsável, separados por dentro/fora
          do prazo (mesmas abas do modal "Cards entregues" de Métricas). */}
      <Dialog
        open={selLinha != null}
        onOpenChange={(o) => {
          if (!o) setSel(null);
        }}
        containerClassName="max-w-2xl"
      >
        <DialogContent onClose={() => setSel(null)} className="flex max-h-[90vh] flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Target className="h-5 w-5" />
              Tickets resolvidos
            </DialogTitle>
            <p className="text-sm text-[var(--color-muted-foreground)]">
              {selLinha ? `${selLinha.nome} · ${filtro.label}` : ''}
              {selLinha ? ` · ${selLinha.onTime} de ${selLinha.total} no prazo (${selLinha.pct}%)` : ''}
            </p>
          </DialogHeader>
          {selLinha && (
            <div className="mt-2 flex min-h-0 flex-1 flex-col gap-0">
              <div className="flex gap-[8px] border-b border-[var(--color-border)]">
                <Button
                  type="button"
                  variant="ghost"
                  disabled={selLinha.onTimeTickets.length === 0}
                  onClick={() => setTab('onTime')}
                  className={cn(
                    'h-auto rounded-none border-b-2 border-transparent px-[16px] py-[8px]',
                    tab === 'onTime'
                      ? 'border-[var(--color-primary)] font-semibold text-[var(--color-primary)]'
                      : 'text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]',
                  )}
                >
                  No prazo ({selLinha.onTimeTickets.length})
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={selLinha.lateTickets.length === 0}
                  onClick={() => setTab('late')}
                  className={cn(
                    'h-auto rounded-none border-b-2 border-transparent px-[16px] py-[8px]',
                    tab === 'late'
                      ? 'border-[var(--color-primary)] font-semibold text-[var(--color-primary)]'
                      : 'text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]',
                  )}
                >
                  Fora do prazo ({selLinha.lateTickets.length})
                </Button>
              </div>
              <div className="min-h-0 max-h-[min(60vh,520px)] flex-1 overflow-y-auto pr-1 pt-3">
                {(tab === 'onTime' ? selLinha.onTimeTickets : selLinha.lateTickets).length > 0 ? (
                  <ul className="space-y-2">
                    {(tab === 'onTime' ? selLinha.onTimeTickets : selLinha.lateTickets).map((item) => (
                      <SlaTicketRow key={item.ticket.id} ticket={item.ticket} medida={item} />
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-[var(--color-muted-foreground)]">
                    {tab === 'onTime'
                      ? 'Nenhum ticket no prazo neste filtro.'
                      : 'Nenhum ticket fora do prazo neste filtro.'}
                  </p>
                )}
              </div>
              <DialogFooter className="mt-0 shrink-0 border-t border-[var(--color-border)] pt-4">
                <Button type="button" variant="outline" onClick={() => setSel(null)}>
                  Fechar
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

/** Card de ranking em barras horizontais Recharts (mesma grossura dos gráficos
 * de projetos/cards). `variant="user"` mostra avatar + cor por cargo no eixo. */
function BarRankCard({
  title,
  icon,
  tickets,
  opcoes,
  keyFn,
  variant = 'plain',
  infoDe,
  limit,
  emptyLabel = 'Sem dados no período.',
}: {
  title: string;
  icon: ReactNode;
  tickets: ChamadoSuporte[];
  opcoes: Opcoes;
  keyFn: (t: ChamadoSuporte) => string | null | undefined;
  variant?: 'plain' | 'user';
  infoDe?: (nome: string) => UserInfo;
  /** Limita ao top N. */
  limit?: number;
  emptyLabel?: string;
}) {
  const filtro = useTicketFilter(tickets, opcoes);
  const rows = useMemo(() => {
    const ranked = rankBy(filtro.filtrados, keyFn);
    const limited = limit != null ? ranked.slice(0, limit) : ranked;
    return limited.map((r) => {
      const info = variant === 'user' && infoDe ? infoDe(r.label) : { foto: null, role: '' };
      return { name: r.label, count: r.count, foto: info.foto, role: info.role };
    });
  }, [filtro.filtrados, keyFn, variant, infoDe, limit]);
  // Mostra no máx. 10 barras; o excedente rola internamente.
  const { inner: innerHeight, outer: outerHeight } = alturasBarras(rows.length);
  const yWidth = variant === 'user' ? 200 : 240;

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          {icon}
          {title}
        </CardTitle>
        <CardDescription>{filtro.label}</CardDescription>
        {filtro.ui}
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-[var(--color-muted-foreground)]">{emptyLabel}</p>
        ) : (
          <div
            className="w-full max-h-[min(85vh,1400px)] overflow-y-auto overflow-x-hidden rounded-md"
            style={{ height: `${outerHeight}px` }}
          >
            <div style={{ height: `${innerHeight}px` }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows} layout="vertical" margin={{ left: 8, right: 16, top: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" horizontal={false} />
                <XAxis
                  type="number"
                  allowDecimals={false}
                  tick={{ fontSize: 11, fill: 'var(--color-muted-foreground)' }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={yWidth}
                  interval={0}
                  tickLine={false}
                  axisLine={false}
                  tick={((props: { x?: number; y?: number; payload?: { value?: string }; index?: number }) => {
                    const { x = 0, y = 0, payload, index } = props;
                    const i =
                      typeof index === 'number' && index >= 0
                        ? index
                        : rows.findIndex((r) => r.name === payload?.value);
                    const row = i >= 0 ? rows[i] : undefined;
                    if (!row) return <g />;
                    return (
                      <g transform={`translate(${x},${y})`}>
                        <foreignObject x={-(yWidth - 8)} y={-16} width={yWidth - 12} height={32} style={{ overflow: 'visible' }}>
                          <div className="flex h-8 items-center gap-2 pr-1">
                            {variant === 'user' && (
                              <Avatar className="h-6 w-6 shrink-0 border border-[var(--color-border)]/60">
                                {row.foto ? <AvatarImage src={row.foto} alt={row.name} /> : null}
                                <AvatarFallback className="bg-[var(--color-muted)] text-[9px] text-[var(--color-muted-foreground)]">
                                  {iniciais(row.name)}
                                </AvatarFallback>
                              </Avatar>
                            )}
                            <span
                              className="min-w-0 flex-1 truncate text-xs font-medium text-[var(--color-foreground)]"
                              title={row.name}
                            >
                              {row.name}
                            </span>
                          </div>
                        </foreignObject>
                      </g>
                    );
                  }) as never}
                />
                <Tooltip
                  cursor={{ fill: 'var(--color-muted)', opacity: 0.3 }}
                  contentStyle={{
                    background: 'var(--color-card)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Bar dataKey="count" name="Tickets" fill="var(--color-primary)" radius={[0, 4, 4, 0]}>
                  {variant === 'user'
                    ? rows.map((row) => <Cell key={row.name} fill={getRoleBarColor(row.role)} />)
                    : null}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function MetricasSuporte() {
  const [tickets, setTickets] = useState<ChamadoSuporte[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [resolvidoEmMap, setResolvidoEmMap] = useState<Record<number, string>>({});
  const [erroResolvidoEm, setErroResolvidoEm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void Promise.all([
      suporteService.listByUsuario(),
      userService.getAll().catch(() => [] as User[]),
    ])
      .then(([list, us]) => {
        if (cancelled) return;
        setTickets(list);
        setUsers(us);
        // Datas reais de conclusão (timeline local) — base do cálculo de SLA.
        // Se isto falhar, o SLA NÃO cai pra data_atualizacao (era o bug):
        // sinalizamos o erro e a tabela avisa em vez de mostrar número errado.
        void suporteTimelineService
          .getResolvidoEmMap()
          .then((map) => {
            if (cancelled) return;
            setResolvidoEmMap(map);
            setErroResolvidoEm(false);
          })
          .catch(() => {
            if (!cancelled) setErroResolvidoEm(true);
          });
      })
      .catch(() => {
        if (!cancelled) setErro('Não foi possível carregar os tickets de suporte.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Mapa nome-normalizado → { foto, role } (casa o responsável com o user do BWA).
  const infoByNome = useMemo(() => {
    const map = new Map<string, UserInfo>();
    for (const u of users) {
      map.set(normalizeNome(displayUserName(u)), {
        foto: u.profile_picture_url ?? null,
        role: u.role ?? '',
      });
    }
    return map;
  }, [users]);

  const infoDe = useCallback(
    (nome: string): UserInfo => infoByNome.get(normalizeNome(nome)) ?? { foto: null, role: '' },
    [infoByNome],
  );

  const opcoes: Opcoes = useMemo(() => {
    const anos = new Set<number>();
    const tipos = new Set<string>();
    const usuarios = new Set<string>();
    for (const t of tickets) {
      const d = ticketDate(t);
      if (d) anos.add(d.getFullYear());
      const tn = catalogNome(t.tipo);
      if (tn && tn !== '—') tipos.add(tn);
      const un = (t.usuario_nome ?? '').trim();
      if (un) usuarios.add(un);
    }
    anos.add(new Date().getFullYear());
    return {
      anos: [...anos].sort((a, b) => b - a),
      tipos: [...tipos].sort((a, b) => a.localeCompare(b, 'pt-BR')),
      usuarios: [...usuarios].sort((a, b) => a.localeCompare(b, 'pt-BR')),
    };
  }, [tickets]);

  const totais = useMemo(() => {
    const total = tickets.length;
    const resolvidos = tickets.filter((t) => t.status === 'Resolvido').length;
    const cancelados = tickets.filter((t) => t.status === 'Cancelado').length;
    return { total, resolvidos, abertos: total - resolvidos - cancelados };
  }, [tickets]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--color-primary)]" />
      </div>
    );
  }

  if (erro) {
    return (
      <div className="rounded-[10px] border border-red-200 bg-red-50 px-[14px] py-[10px] text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200">
        {erro}
      </div>
    );
  }

  return (
    <div className="space-y-[20px]">
      {/* Totais absolutos */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-[var(--color-muted-foreground)]">Tickets (total)</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{totais.total}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-[var(--color-muted-foreground)]">Resolvidos</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{totais.resolvidos}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-[var(--color-muted-foreground)]">
              Em aberto / andamento
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{totais.abertos}</p>
          </CardContent>
        </Card>
      </div>

      {/* Um gráfico por linha, na ordem pedida */}
      <TabelaSlaSuporte
        tickets={tickets}
        opcoes={opcoes}
        infoDe={infoDe}
        resolvidoEmMap={resolvidoEmMap}
        erroResolvidoEm={erroResolvidoEm}
      />

      <ResponsavelCard
        tickets={tickets}
        opcoes={opcoes}
        infoDe={infoDe}
        resolvidoEmMap={resolvidoEmMap}
      />

      <GraficoAberturaPorDia tickets={tickets} opcoes={opcoes} />

      <BarRankCard
        title="Itens / motivos mais frequentes"
        icon={<Layers className="h-[18px] w-[18px]" />}
        tickets={tickets}
        opcoes={opcoes}
        keyFn={(t) => `${catalogNome(t.item)} — ${catalogNome(t.motivo)}`}
      />

      <BarRankCard
        title="Tickets por tipo"
        icon={<Tag className="h-[18px] w-[18px]" />}
        tickets={tickets}
        opcoes={opcoes}
        keyFn={(t) => catalogNome(t.tipo)}
      />

      <BarRankCard
        title="Quantidade por solicitante"
        icon={<Users className="h-[18px] w-[18px]" />}
        tickets={tickets}
        opcoes={opcoes}
        keyFn={(t) => t.usuario_nome}
      />
    </div>
  );
}

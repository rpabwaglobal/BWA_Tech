import { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import confetti from 'canvas-confetti';
import { useAuth } from '@/context/AuthContext';
import { hasPermission } from '@/lib/permissions';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FilterSelect } from '@/components/ui/filter-select';
import { chipStyle } from '@/lib/catalog-style';
import { userService, participaDoTrabalho, type CatalogItem } from '@/services/userService';
import {
  geekdayService,
  geekdayGrupoService,
  type GeekDayUserStatus,
  type GeekDayDraw,
  type GeekDayGrupo,
} from '@/services/geekdayService';
import {
  AlertTriangle, Check, Loader2, Plus, RotateCcw, Settings2, Trash2, Trophy, Users,
} from 'lucide-react';
import { formatDate } from '@/lib/dateUtils';
import { cn } from '@/lib/utils';
import { DatePicker } from '@/components/ui/date-picker';
import { PrizeWheel } from '@mertercelik/react-prize-wheel';
import type { Sector, PrizeWheelRef } from '@mertercelik/react-prize-wheel';
import '@mertercelik/react-prize-wheel/style.css';
import './GeekDay.css';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DndContext,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay,
  useDroppable,
} from '@dnd-kit/core';
import {
  useSortable,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { TelaComCarregamento } from '@/components/TelaComCarregamento';

/** Cor de fallback dos chips de setor — mesma dos diálogos de setores. */
const COR_SETOR_PADRAO = '#94a3b8';

/** Mensagem de erro vinda da API. O backend do Geek Day já responde em
 * português (`detail` ou erro de campo); o fallback só entra quando a falha é
 * de rede e não há corpo nenhum para mostrar. */
function extractApiError(err: unknown, fallback: string): string {
  const data = (err as { response?: { data?: Record<string, unknown> } })?.response?.data;
  if (data) {
    const k = Object.keys(data)[0];
    const v = k ? data[k] : undefined;
    if (Array.isArray(v) && typeof v[0] === 'string') return v[0];
    if (typeof v === 'string') return v;
  }
  return fallback;
}

function SetorChip({ nome, cor }: { nome: string; cor?: string | null }) {
  return (
    <span
      className="inline-flex items-center rounded-full border px-[10px] py-[2px] text-xs font-medium"
      style={chipStyle(cor || COR_SETOR_PADRAO)}
    >
      {nome}
    </span>
  );
}

function Caixa({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded-[3px] border transition-colors',
        checked
          ? 'border-[var(--color-primary)] bg-[var(--color-primary)] text-white'
          : 'border-[var(--color-border)] bg-[var(--color-background)]',
      )}
    >
      {checked && <Check className="h-[12px] w-[12px]" strokeWidth={3} />}
    </span>
  );
}

type GerenciarGruposDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Propaga a lista atualizada para a tela (seletor e cabeçalho) a cada
   * alteração, para o gestor ver o efeito sem fechar o diálogo. */
  onChanged: (grupos: GeekDayGrupo[]) => void;
};

/**
 * Administração dos grupos de Geek Day: criar, renomear, juntar/separar
 * setores e excluir grupo sem histórico.
 *
 * Vive num diálogo, e não na própria tela, porque a tela do sorteio ocupa a
 * altura toda com a roleta e as duas listas — encaixar um CRUD ali empurraria
 * a roleta para fora da dobra. Quem abre precisa de `manage_geekday`; o
 * endpoint também exige.
 */
function GerenciarGruposDialog({ open, onOpenChange, onChanged }: GerenciarGruposDialogProps) {
  const [grupos, setGrupos] = useState<GeekDayGrupo[]>([]);
  const [setores, setSetores] = useState<CatalogItem[]>([]);
  const [selecionadoId, setSelecionadoId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const [novoNome, setNovoNome] = useState('');
  const [nomeEditado, setNomeEditado] = useState('');
  const [confirmandoExclusao, setConfirmandoExclusao] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelado = false;
    setLoading(true);
    setErro('');
    setNovoNome('');
    setConfirmandoExclusao(false);
    void (async () => {
      try {
        const [lista, catalogo] = await Promise.all([
          geekdayGrupoService.listar(),
          userService.getSetores(),
        ]);
        if (cancelado) return;
        setGrupos(lista);
        setSetores(catalogo);
        setSelecionadoId((prev) => (prev != null && lista.some((g) => g.id === prev) ? prev : lista[0]?.id ?? null));
      } catch (err) {
        if (!cancelado) setErro(extractApiError(err, 'Não foi possível carregar os grupos do Geek Day.'));
      } finally {
        if (!cancelado) setLoading(false);
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [open]);

  const selecionado = grupos.find((g) => g.id === selecionadoId) ?? null;

  // O nome do campo acompanha o grupo escolhido; sem isto, trocar de grupo
  // deixaria no input o nome do anterior e um "Renomear" enganoso.
  useEffect(() => {
    setNomeEditado(grupos.find((g) => g.id === selecionadoId)?.nome ?? '');
    setConfirmandoExclusao(false);
  }, [selecionadoId, grupos]);

  /** Setor -> id do grupo dono. Um setor pertence a no máximo um grupo (é
   * UNIQUE no banco), então marcar o dono aqui já explica por que a linha de
   * um setor ocupado aparece bloqueada. */
  const donoDoSetor = useMemo(() => {
    const mapa = new Map<string, number>();
    for (const g of grupos) for (const s of g.setores_detalhe) mapa.set(String(s.id), g.id);
    return mapa;
  }, [grupos]);

  const nomeDoGrupo = (id: number) => grupos.find((g) => g.id === id)?.nome ?? 'outro grupo';

  /** Toda mutação recarrega a lista inteira: remover um setor daqui muda o
   * mundo lá fora (ele volta a ter grupo próprio), e recompor isso na mão
   * deixaria a tela mentindo. */
  const executar = async (
    acao: () => Promise<void>,
    fallback: string,
    depois?: (lista: GeekDayGrupo[]) => void,
  ) => {
    setSalvando(true);
    setErro('');
    try {
      await acao();
      const lista = await geekdayGrupoService.listar();
      setGrupos(lista);
      onChanged(lista);
      depois?.(lista);
    } catch (err) {
      setErro(extractApiError(err, fallback));
    } finally {
      setSalvando(false);
    }
  };

  const criar = () => {
    const nome = novoNome.trim();
    if (!nome) return;
    let criadoId: number | null = null;
    void executar(
      async () => {
        criadoId = (await geekdayGrupoService.criar(nome)).id;
        setNovoNome('');
      },
      'Não foi possível criar o grupo.',
      (lista) => {
        if (criadoId != null && lista.some((g) => g.id === criadoId)) setSelecionadoId(criadoId);
      },
    );
  };

  const renomear = () => {
    if (!selecionado) return;
    const nome = nomeEditado.trim();
    if (!nome || nome === selecionado.nome) return;
    void executar(
      () => geekdayGrupoService.renomear(selecionado.id, nome).then(() => undefined),
      'Não foi possível renomear o grupo.',
    );
  };

  const alternarSetor = (setorId: number, jaEstaNoGrupo: boolean) => {
    if (!selecionado) return;
    void executar(
      () => (jaEstaNoGrupo
        ? geekdayGrupoService.removerSetor(selecionado.id, setorId)
        : geekdayGrupoService.adicionarSetor(selecionado.id, setorId)
      ).then(() => undefined),
      jaEstaNoGrupo
        ? 'Não foi possível remover o setor do grupo.'
        : 'Não foi possível adicionar o setor ao grupo.',
    );
  };

  const excluir = () => {
    if (!selecionado) return;
    void executar(
      () => geekdayGrupoService.excluir(selecionado.id),
      'Não foi possível excluir o grupo.',
      (lista) => {
        setConfirmandoExclusao(false);
        setSelecionadoId(lista[0]?.id ?? null);
      },
    );
  };

  const fechar = () => {
    if (!salvando) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && fechar()} containerClassName="max-w-3xl">
      <DialogContent onClose={salvando ? undefined : fechar}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5 text-[var(--color-primary)]" />
            Grupos do Geek Day
          </DialogTitle>
          <DialogDescription>
            Um grupo é o conjunto de setores que sorteia junto e compartilha a mesma fila. Por
            padrão cada setor é o próprio grupo — junte setores aqui quando eles apresentarem
            no mesmo Geek Day.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-[var(--color-primary)]" />
          </div>
        ) : (
          <div className="mt-4 grid gap-4 md:grid-cols-[240px_1fr]">
            {/* Coluna esquerda: os grupos existentes e a criação de um novo */}
            <div className="space-y-2">
              <Label>Grupos ({grupos.length})</Label>
              <div className="max-h-[280px] overflow-y-auto rounded-md border border-[var(--color-border)]">
                {grupos.length === 0 ? (
                  <p className="p-4 text-center text-sm text-[var(--color-muted-foreground)]">
                    Nenhum grupo ainda.
                  </p>
                ) : (
                  grupos.map((g) => (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => setSelecionadoId(g.id)}
                      className={cn(
                        'block w-full px-3 py-2 text-left transition-colors hover:bg-[var(--color-accent)]',
                        g.id === selecionadoId ? 'bg-[var(--color-accent)]' : '',
                      )}
                    >
                      <span className="block truncate text-sm font-medium">{g.nome}</span>
                      <span className="block truncate text-xs text-[var(--color-muted-foreground)]">
                        {g.setores_detalhe.length === 0
                          ? 'Sem setores'
                          : g.setores_detalhe.map((s) => s.nome).join(', ')}
                      </span>
                    </button>
                  ))
                )}
              </div>
              <div className="flex gap-2">
                <Input
                  placeholder="Nome do novo grupo"
                  value={novoNome}
                  onChange={(e) => setNovoNome(e.target.value)}
                  disabled={salvando}
                />
                <Button
                  type="button"
                  className="shrink-0 gap-1.5"
                  disabled={salvando || !novoNome.trim()}
                  onClick={criar}
                >
                  <Plus className="h-4 w-4" />
                  Criar
                </Button>
              </div>
            </div>

            {/* Coluna direita: o grupo escolhido */}
            {selecionado ? (
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label>Nome do grupo</Label>
                  <div className="flex gap-2">
                    <Input
                      value={nomeEditado}
                      onChange={(e) => setNomeEditado(e.target.value)}
                      disabled={salvando}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      className="shrink-0"
                      disabled={salvando || !nomeEditado.trim() || nomeEditado.trim() === selecionado.nome}
                      onClick={renomear}
                    >
                      Renomear
                    </Button>
                  </div>
                  <p className="text-xs text-[var(--color-muted-foreground)]">
                    Ciclo atual: {selecionado.current_cycle} — resetar o sorteio deste grupo não
                    mexe na fila dos outros.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label>Setores que sorteiam juntos</Label>
                  <div className="max-h-[240px] overflow-y-auto rounded-md border border-[var(--color-border)]">
                    {setores.length === 0 ? (
                      <p className="p-4 text-center text-sm text-[var(--color-muted-foreground)]">
                        Nenhum setor cadastrado.
                      </p>
                    ) : (
                      setores.map((s) => {
                        const dono = donoDoSetor.get(String(s.id));
                        const neste = dono === selecionado.id;
                        const ocupado = dono != null && !neste;
                        return (
                          <button
                            key={s.id}
                            type="button"
                            disabled={salvando || ocupado}
                            onClick={() => alternarSetor(Number(s.id), neste)}
                            className={cn(
                              'flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors',
                              ocupado
                                ? 'cursor-not-allowed opacity-60'
                                : 'hover:bg-[var(--color-accent)]',
                              neste ? 'bg-[var(--color-accent)]/60' : '',
                            )}
                          >
                            <Caixa checked={neste} />
                            <span
                              aria-hidden
                              className="h-[10px] w-[10px] shrink-0 rounded-full"
                              style={{ backgroundColor: s.cor || COR_SETOR_PADRAO }}
                            />
                            <span className="min-w-0 flex-1 truncate">{s.nome}</span>
                            {ocupado && (
                              <span className="shrink-0 text-[11px] text-[var(--color-muted-foreground)]">
                                no grupo «{nomeDoGrupo(dono)}»
                              </span>
                            )}
                          </button>
                        );
                      })
                    )}
                  </div>
                  <p className="text-xs text-[var(--color-muted-foreground)]">
                    Cada setor pertence a um grupo só — para movê-lo, tire-o do grupo atual
                    primeiro. Setor que sai daqui volta a ter o Geek Day dele.
                  </p>
                </div>

                {confirmandoExclusao ? (
                  <div className="rounded-md border border-[var(--color-destructive)]/40 bg-[var(--color-destructive)]/10 px-3 py-2.5">
                    <p className="flex items-center gap-1.5 text-sm font-semibold text-[var(--color-destructive)]">
                      <AlertTriangle className="h-4 w-4" />
                      Excluir «{selecionado.nome}»?
                    </p>
                    <p className="mt-1.5 text-sm leading-snug text-[var(--color-foreground)]">
                      Só dá para excluir um grupo que ainda não tem sorteio registrado — o
                      histórico de quem já apresentou não é apagado. Os setores dele voltam a
                      ter o Geek Day próprio.
                    </p>
                    <div className="mt-2.5 flex gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={salvando}
                        onClick={() => setConfirmandoExclusao(false)}
                      >
                        Cancelar
                      </Button>
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        disabled={salvando}
                        onClick={excluir}
                      >
                        {salvando
                          ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Excluindo...</>
                          : 'Excluir grupo'}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-1.5 text-[var(--color-destructive)]"
                    disabled={salvando}
                    onClick={() => setConfirmandoExclusao(true)}
                  >
                    <Trash2 className="h-4 w-4" />
                    Excluir grupo
                  </Button>
                )}
              </div>
            ) : (
              <p className="flex items-center justify-center rounded-md border border-dashed border-[var(--color-border)] p-6 text-center text-sm text-[var(--color-muted-foreground)]">
                Crie um grupo para começar.
              </p>
            )}
          </div>
        )}

        {erro && <p className="mt-3 text-sm text-[var(--color-destructive)]">{erro}</p>}

        <DialogFooter className="mt-6 gap-2 sm:gap-2">
          <Button type="button" variant="outline" onClick={fechar} disabled={salvando}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function GeekDay() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<'sorteio' | 'historico'>('sorteio');
  const [users, setUsers] = useState<GeekDayUserStatus[]>([]);
  const [historico, setHistorico] = useState<GeekDayDraw[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSpinning, setIsSpinning] = useState(false);
  /** Roleta em primeiro plano durante o sorteio. Entra ANTES do giro e sai
   *  quando o resultado é confirmado — ver `handleSpin`/`handleSpinEnd`. */
  const [roletaEmDestaque, setRoletaEmDestaque] = useState(false);
  const [winner, setWinner] = useState<GeekDayUserStatus | null>(null);
  const [showWinnerDialog, setShowWinnerDialog] = useState(false);
  const [showResetDialog, setShowResetDialog] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [confirmingWinner, setConfirmingWinner] = useState(false);
  const [winnerPresentationDate, setWinnerPresentationDate] = useState<string>('');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  /** Grupo do próprio usuário — o Geek Day dele, resolvido pelo setor primário. */
  const [meuGrupo, setMeuGrupo] = useState<GeekDayGrupo | null>(null);
  /** Todos os grupos, só para quem pode olhar além do próprio. */
  const [grupos, setGrupos] = useState<GeekDayGrupo[]>([]);
  const [grupoSelecionadoId, setGrupoSelecionadoId] = useState<number | null>(null);
  const [showGruposDialog, setShowGruposDialog] = useState(false);
  const wheelRef = useRef<PrizeWheelRef>(null);
  const confettiFiredRef = useRef(false);
  const winnerAvatarRef = useRef<HTMLDivElement>(null);

  // As 3 flags abaixo controlavam ações distintas (arrastar cards, girar a
  // roleta, resetar) com listas de cargos ligeiramente diferentes entre si —
  // mas o backend sempre usou a MESMA regra (supervisor/gerente/admin) pras
  // 4 ações equivalentes. Unificadas na permissão granular `manage_geekday`,
  // que reflete exatamente essa regra (editável por usuário na tela de
  // Gerenciamento de Usuários).
  const isSupervisor = hasPermission(user, 'manage_geekday');
  const isGestor = hasPermission(user, 'manage_geekday');
  const canReset = hasPermission(user, 'manage_geekday');

  // Trocar de grupo é o mesmo gate do `?grupo=` no backend: administrar o
  // ritual OU já enxergar todos os setores. Quem não tem nenhuma das duas vê
  // apenas o próprio grupo — sem seletor, sem escolha.
  const podeTrocarGrupo = isGestor || hasPermission(user, 'view_cross_setor');

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  /** Grupo que a tela está mostrando: o escolhido no seletor, ou o do usuário. */
  const grupoExibido = useMemo(
    () => grupos.find((g) => g.id === grupoSelecionadoId) ?? meuGrupo,
    [grupos, grupoSelecionadoId, meuGrupo],
  );

  /** Opções do seletor. Se a listagem falhar (ou vier vazia), ao menos o
   * próprio grupo aparece — a tela nunca fica sem identificar onde está. */
  const opcoesGrupo = useMemo(() => {
    const base = grupos.length > 0 ? grupos : meuGrupo ? [meuGrupo] : [];
    return base.map((g) => ({ value: String(g.id), label: g.nome }));
  }, [grupos, meuGrupo]);

  /** Id enviado como `?grupo=` nas chamadas de sorteio. Fica `undefined`
   * enquanto a tela está no grupo do próprio usuário: sem o parâmetro o
   * backend resolve exatamente o mesmo grupo e não exige permissão extra de
   * quem só abre o próprio Geek Day. */
  const grupoParam = meuGrupo && grupoSelecionadoId != null && grupoSelecionadoId !== meuGrupo.id
    ? grupoSelecionadoId
    : undefined;

  /** `meu` cria o grupo do setor do usuário se ainda não existir — é por isso
   * que a tela sempre tem um grupo para mostrar, mesmo em base nova. */
  const recarregarGrupos = async () => {
    try {
      const [meu, lista] = await Promise.all([
        geekdayGrupoService.meu(),
        podeTrocarGrupo ? geekdayGrupoService.listar() : Promise.resolve<GeekDayGrupo[]>([]),
      ]);
      setMeuGrupo(meu);
      setGrupos(lista);
      // Mantém o grupo que o gestor estava olhando, a menos que ele tenha
      // deixado de existir (excluído na administração de grupos).
      setGrupoSelecionadoId((prev) => (prev != null && lista.some((g) => g.id === prev) ? prev : meu.id));
    } catch (error: any) {
      console.error('Erro ao carregar o grupo do Geek Day:', error);
    }
  };

  useEffect(() => {
    void recarregarGrupos();
  }, [podeTrocarGrupo]);

  useEffect(() => {
    loadData();
  }, [activeTab, grupoParam]);

  // Confetti em tela cheia: dispara sempre que o modal do ganhador abre (com foto ou só iniciais)
  useEffect(() => {
    if (!showWinnerDialog || !winner) {
      confettiFiredRef.current = false;
      return;
    }
    if (confettiFiredRef.current) return;
    confettiFiredRef.current = true;

    const colors = ['#a786ff', '#fd8bbc', '#eca184', '#f8deb1'];

    const fireFromCenter = () => {
      // Origem: centro do avatar (foto ou iniciais) ou centro da tela se ref ainda não montou
      let originX = 0.5;
      let originY = 0.5;
      const el = winnerAvatarRef.current;
      if (el) {
        const rect = el.getBoundingClientRect();
        originX = (rect.left + rect.width / 2) / window.innerWidth;
        originY = (rect.top + rect.height / 2) / window.innerHeight;
      }

      const end = Date.now() + 4 * 1000; // 4 segundos
      const angles = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330];

      const frame = () => {
        if (Date.now() > end) return;
        const angle = angles[Math.floor(Math.random() * angles.length)];
        confetti({
          particleCount: 12,
          angle,
          spread: 55,
          startVelocity: 55,
          origin: { x: originX, y: originY },
          colors,
          zIndex: 55,
        });
        requestAnimationFrame(frame);
      };
      frame();

      // Cliques devem passar pelo canvas do confetti para o backdrop
      const styleCanvas = () => {
        document.body.querySelectorAll('canvas').forEach((c) => {
          if (Number((c as HTMLCanvasElement).style.zIndex) === 55)
            (c as HTMLCanvasElement).style.pointerEvents = 'none';
        });
      };
      setTimeout(styleCanvas, 100);
    };

    // Dar tempo ao portal do Dialog montar antes de disparar (ref pode estar null no primeiro tick)
    const t = setTimeout(fireFromCenter, 350);
    return () => clearTimeout(t);
  }, [showWinnerDialog, winner]);

  // Polling para atualização em tempo real (apenas na aba de sorteio)
  // Desabilitado durante drag para evitar conflitos
  useEffect(() => {
    if (activeTab !== 'sorteio') return;

    const interval = setInterval(() => {
      // Recarregar dados a cada 10 segundos para sincronização em tempo real
      // Não recarregar se estiver arrastando ou se a página não estiver visível
      if (!dragging && document.visibilityState === 'visible') {
        loadData(false); // Não mostrar loading durante polling
      }
    }, 10000); // Aumentado para 10 segundos para reduzir requisições

    return () => clearInterval(interval);
    // `grupoParam` entra nas dependências para o polling não continuar batendo
    // no grupo anterior depois que o gestor troca de grupo no seletor.
  }, [activeTab, dragging, grupoParam]);

  const loadData = async (showLoading = true) => {
    try {
      if (showLoading) {
        setLoading(true);
      }
      if (activeTab === 'sorteio') {
        const usersData = await geekdayService.getUsersStatus(grupoParam);
        setUsers(usersData);
      } else {
        const historicoData = await geekdayService.getHistorico(grupoParam);
        setHistorico(historicoData);
      }
    } catch (error: any) {
      console.error('Erro ao carregar dados:', error);
    } finally {
      if (showLoading) {
        setLoading(false);
      }
    }
  };

  // Função para obter cor baseada no role do usuário
  const getRoleColor = (role: string): string => {
    switch (role) {
      case 'supervisor':
        return '#93c5fd';
      case 'gerente':
        return '#86efac';
      case 'desenvolvedor':
        return '#fdba74';
      case 'dados':
        return '#c4b5fd';
      case 'processos':
        return '#fca5a5';
      case 'admin':
        return '#c4b5fd';
      default:
        return '#9ca3af';
    }
  };

  /** Está na FILA quem ainda não foi sorteado no ciclo E participa do trabalho.
   *
   * O segundo teste é o "visitante não é sorteado". O backend já não manda
   * visitante nenhum que não tenha sorteio no ciclo, mas manda o que JÁ foi
   * sorteado — senão não haveria card para arrastar de volta e desfazer. Esse
   * fica só em "Já Sorteados": desmarcá-lo é permitido, recolocá-lo na fila
   * não. Repetir o critério aqui também evita que afrouxar o backend um dia
   * devolva o visitante à roleta em silêncio. */
  const estaNaFila = (u: GeekDayUserStatus) => !u.ja_sorteado && participaDoTrabalho(u);

  // Converter usuários disponíveis em setores para a roleta
  // Ordena por role para agrupar cores similares
  const getSectors = (): Sector[] => {
    const availableUsers = users.filter(estaNaFila);

    // A biblioteca requer entre 2 e 24 setores
    if (availableUsers.length === 0 || availableUsers.length < 2) {
      return [];
    }

    // Se houver mais de 24 usuários, limitar a 24 para a roleta
    const usersForWheel = availableUsers.slice(0, 24);

    // Ordenar por role para agrupar cores similares
    const roleOrder = ['supervisor', 'gerente', 'desenvolvedor', 'dados', 'processos', 'admin'];
    const sortedUsers = [...usersForWheel].sort((a, b) => {
      const aIndex = roleOrder.indexOf(a.role || 'desenvolvedor');
      const bIndex = roleOrder.indexOf(b.role || 'desenvolvedor');
      return aIndex - bIndex;
    });

    // Criar setores com probabilidade igual para todos
    return sortedUsers.map((user, index) => ({
      id: user.id,
      label: getUserDisplayName(user),
      text: getUserDisplayName(user),
      probability: 10, // Probabilidade igual para todos
    }));
  };

  // Obter array de cores para a roleta
  // A biblioteca alterna entre dois tons de azul claro
  const getWheelColors = (): [string, string] => {
    return ['#93c5fd', '#bfdbfe']; // Azul claro (blue-300) e azul mais claro (blue-200)
  };


  const handleSpinStart = () => {
    setIsSpinning(true);
    setWinner(null);
    setShowWinnerDialog(false);
    setWinnerPresentationDate('');
  };

  const handleSpinEnd = (sector: Sector) => {
    setIsSpinning(false);
    setRoletaEmDestaque(false);
    
    // Encontrar o usuário correspondente ao setor sorteado pela roleta
    const usuarioSorteado = users.find(u => String(u.id) === String(sector.id));
    
    if (usuarioSorteado) {
      // O ganhador é definido pela roleta
      setWinner(usuarioSorteado);
      setShowWinnerDialog(true);
      setWinnerPresentationDate('');
    }
  };

  const handleSpin = () => {
    if (!wheelRef.current || isSpinning || sectors.length === 0) return;
    // SÓ EXPANDE AQUI. Quem dispara o giro é o fim da transição de tamanho
    // (`onTransitionEnd` no elemento da roleta): girar junto com o movimento
    // somaria duas animações no mesmo instante e a roleta pareceria tremer.
    setRoletaEmDestaque(true);
  };

  /** Chamado quando a expansão termina. É daqui que o giro parte. */
  const iniciarGiroAposExpandir = useCallback(() => {
    if (isSpinning || !wheelRef.current) return;
    wheelRef.current.spin();
  }, [isSpinning]);

  // REDE DE SEGURANÇA, E NÃO REDUNDÂNCIA.
  //
  // O giro parte do `transitionend` da expansão — mas quem tem
  // `prefers-reduced-motion` recebe `transition: none`, e aí o evento NUNCA
  // dispara: sem isto, o sorteio simplesmente não aconteceria para essas
  // pessoas, e o botão pareceria quebrado. O tempo é folgado de propósito
  // (maior que os 320ms da transição), então em uso normal quem chega primeiro
  // é sempre o evento; a guarda de `isSpinning` impede o giro em dobro.
  useEffect(() => {
    if (!roletaEmDestaque) return;
    const t = window.setTimeout(iniciarGiroAposExpandir, 450);
    return () => window.clearTimeout(t);
  }, [roletaEmDestaque, iniciarGiroAposExpandir]);

  const handleConfirmWinner = async () => {
    if (!winner || confirmingWinner) return;

    setConfirmingWinner(true);
    try {
      // Marcar o usuário escolhido pela roleta como sorteado no backend
      const resultado = await geekdayService.marcarComoSorteado(
        String(winner.id),
        'Sorteado pela roleta',
        winnerPresentationDate || null,
        grupoParam
      );
      console.log('Sorteio confirmado no backend:', resultado);
      
      // Fechar o modal e limpar o winner
      setShowWinnerDialog(false);
      const winnerId = winner.id;
      setWinner(null);
      setWinnerPresentationDate('');
      
      // Aguardar um pouco para garantir que o backend processou completamente
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // Recarregar dados do backend para garantir sincronização
      await loadData();
      
      // Verificar se o usuário foi atualizado corretamente
      const updatedUsers = await geekdayService.getUsersStatus(grupoParam);
      const updatedUser = updatedUsers.find(u => String(u.id) === String(winnerId));
      console.log('Usuário após recarregar:', updatedUser ? { id: updatedUser.id, ja_sorteado: updatedUser.ja_sorteado } : 'não encontrado');
      
      if (updatedUser && !updatedUser.ja_sorteado) {
        console.error('Usuário não foi marcado como sorteado. Tentando recarregar novamente...');
        await loadData();
      }
    } catch (error: any) {
      console.error('Erro ao confirmar sorteio:', error);
      // Mesmo com erro, fechar o modal
      setShowWinnerDialog(false);
      setWinner(null);
      setWinnerPresentationDate('');
    } finally {
      setConfirmingWinner(false);
    }
  };

  const handleResetar = async () => {
    if (resetting || !canReset) return;

    setResetting(true);
    try {
      await geekdayService.resetarSorteios(grupoParam);
      setShowResetDialog(false);
      setWinner(null);
      // O ciclo é do grupo e a tela mostra esse número: recarregar os grupos
      // evita exibir o ciclo anterior até o próximo refresh.
      await recarregarGrupos();
      loadData();
    } catch (error: any) {
      console.error('Erro ao resetar sorteios:', error);
    } finally {
      setResetting(false);
    }
  };

  // Handlers para drag and drop
  const handleDragStart = (event: any) => {
    if (!isSupervisor) {
      console.log('Drag bloqueado: usuário não é supervisor');
      return;
    }
    console.log('Drag iniciado:', event.active.id);
    setActiveId(event.active.id);
    setDragging(true);
  };

  const handleDragEnd = async (event: any) => {
    const { active, over } = event;
    const wasDragging = dragging;
    console.log('Drag finalizado:', { active: active.id, over: over?.id, wasDragging, isSupervisor });
    setActiveId(null);
    setDragging(false);

    if (!over || !isSupervisor || !wasDragging) {
      console.log('Drag cancelado:', { over: !!over, isSupervisor, wasDragging });
      return;
    }

    const draggedUser = users.find(u => String(u.id) === String(active.id));
    if (!draggedUser) return;

    // Identificar a lista de destino
    let targetList = over.id;
    
    // Se o over.id não for uma das listas, pode ser que seja um card dentro da lista
    // Nesse caso, precisamos encontrar em qual lista o card está
    if (targetList !== 'sorted-list' && targetList !== 'available-list') {
      // Verificar se é um card (usuário) - se for, encontrar em qual lista ele está
      const targetUser = users.find(u => String(u.id) === String(targetList));
      if (targetUser) {
        // Se soltou em um card, usar a lista onde esse card está
        targetList = targetUser.ja_sorteado ? 'sorted-list' : 'available-list';
      } else {
        // Se não é um usuário, tentar encontrar o droppable através do DOM
        // Usar o elemento que está sendo arrastado para encontrar a posição
        const activeElement = document.querySelector(`[data-id="${active.id}"]`);
        if (activeElement) {
          // Verificar em qual lista o elemento ativo está atualmente
          const currentList = draggedUser.ja_sorteado ? 'sorted-list' : 'available-list';
          
          const sortedListElement = document.querySelector('[data-droppable-id="sorted-list"]');
          const availableListElement = document.querySelector('[data-droppable-id="available-list"]');
          
          // Se soltou em um elemento que não é uma lista válida, usar heurística: se soltou em um card de outra lista,
          // usar a lista oposta
          if (currentList === 'sorted-list') {
            targetList = 'available-list';
          } else {
            targetList = 'sorted-list';
          }
        } else {
          // Se não conseguiu identificar, não fazer nada
          console.log('Lista de destino não identificada:', targetList, over);
          return;
        }
      }
    }

    const isTargetSorted = targetList === 'sorted-list';
    const isTargetAvailable = targetList === 'available-list';

    // Se não identificou uma lista válida, não fazer nada
    if (!isTargetSorted && !isTargetAvailable) {
      console.log('Lista de destino não identificada:', targetList);
      return;
    }

    // Se arrastou para a mesma lista, não fazer nada
    if ((isTargetSorted && draggedUser.ja_sorteado) || 
        (isTargetAvailable && !draggedUser.ja_sorteado)) {
      return;
    }

    try {
      if (isTargetSorted) {
        // Marcar como sorteado
        await geekdayService.marcarComoSorteado(
          String(draggedUser.id), 'Movido manualmente pelo supervisor', null, grupoParam,
        );
      } else if (isTargetAvailable) {
        // Desmarcar como sorteado
        await geekdayService.desmarcarComoSorteado(String(draggedUser.id), grupoParam);
      }
      
      // Atualizar estado local imediatamente para feedback visual
      setUsers(prev => prev.map(u => 
        String(u.id) === String(draggedUser.id) 
          ? { ...u, ja_sorteado: isTargetSorted }
          : u
      ));
      
      // Aguardar um pouco antes de recarregar para evitar conflitos
      setTimeout(() => {
        if (!dragging) {
          loadData();
        }
      }, 500);
    } catch (error: any) {
      console.error('Erro ao mover usuário:', error);
      // Reverter mudança local em caso de erro
      await loadData();
    }
  };

  // Componente de card arrastável
  const DraggableUserCard = ({ user, isSorted }: { user: GeekDayUserStatus; isSorted: boolean }) => {
    const {
      attributes,
      listeners,
      setNodeRef,
      transform,
      transition,
      isDragging,
    } = useSortable({ 
      id: user.id, 
      disabled: !isSupervisor 
    });

    const style = {
      transform: CSS.Transform.toString(transform),
      transition,
      opacity: isDragging ? 0.5 : 1,
    };

    const canDrag = isSupervisor;

    if (isSorted) {
      return (
        <div
          ref={setNodeRef}
          style={style}
          {...attributes}
          {...listeners}
          className={cn(
            "rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] hover:bg-[var(--color-accent)] transition-colors",
            !canDrag ? 'opacity-50 cursor-not-allowed' : 'cursor-move'
          )}
        >
          <CardContent className="flex items-center gap-3 p-[10px]">
            <Avatar className="h-[40px] w-[40px]">
              {user.profile_picture_url ? (
                <AvatarImage src={user.profile_picture_url} alt={getUserDisplayName(user)} />
              ) : null}
              <AvatarFallback className="bg-[var(--color-muted)] text-[var(--color-muted-foreground)]">
                {user.first_name?.charAt(0) || user.username?.charAt(0) || 'U'}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="font-medium text-sm truncate text-green-500">
                  {getUserDisplayName(user)}
                </p>
                <Check className="h-4 w-4 text-green-500 shrink-0" strokeWidth={3} />
              </div>
              <p className="text-xs text-green-500 truncate">
                {rotuloCargo(user)}
              </p>
              {/* Está aqui só por causa do sorteio DESTE ciclo: não participa
                  mais do trabalho, então pode sair da lista mas não volta para
                  a fila. Sem esta linha o gestor arrastaria o card de volta e
                  o veria sumir, sem entender o porquê. */}
              {!participaDoTrabalho(user) && (
                <p className="text-[11px] text-[var(--color-muted-foreground)] truncate">
                  Não participa do sorteio — arraste para desfazer
                </p>
              )}
            </div>
          </CardContent>
        </div>
      );
    }

    return (
      <div
        ref={setNodeRef}
        style={style}
        {...attributes}
        {...listeners}
        className={cn(
          "rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] text-[var(--color-card-foreground)] shadow hover:shadow-md transition-shadow",
          !canDrag ? 'opacity-50 cursor-not-allowed' : 'cursor-move'
        )}
      >
        <CardContent className="flex items-center gap-3 p-4">
          <Avatar className="h-[40px] w-[40px]">
            {user.profile_picture_url ? (
              <AvatarImage src={user.profile_picture_url} alt={getUserDisplayName(user)} />
            ) : null}
            <AvatarFallback className="bg-[var(--color-muted)] text-[var(--color-muted-foreground)]">
              {user.first_name?.charAt(0) || user.username?.charAt(0) || 'U'}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm truncate">
              {getUserDisplayName(user)}
            </p>
            <p className="text-xs text-[var(--color-muted-foreground)] truncate">
              {rotuloCargo(user)}
            </p>
          </div>
        </CardContent>
      </div>
    );
  };

  // Componente de área droppable
  const DroppableList = ({ 
    id, 
    title, 
    count, 
    children, 
    isEmpty 
  }: { 
    id: string; 
    title: string; 
    count: number; 
    children: React.ReactNode;
    isEmpty: boolean;
  }) => {
    const { setNodeRef, isOver } = useDroppable({ 
      id,
      disabled: !isSupervisor
    });

    return (
      <Card 
        ref={setNodeRef} 
        className={cn(
          "flex flex-col min-h-0 h-full",
          isOver && isSupervisor ? 'ring-2 ring-[var(--color-primary)]' : ''
        )}
      >
        <CardHeader className="shrink-0 pb-3">
          <CardTitle className="text-base">{title} ({count})</CardTitle>
        </CardHeader>
        <CardContent className="flex-1 min-h-0 overflow-hidden pt-0">
          <div className="space-y-1 h-full overflow-y-auto pr-2">
            {isEmpty ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <p className="text-sm text-[var(--color-muted-foreground)]">
                  {id === 'available-list' 
                    ? 'Todos os usuários já foram sorteados!'
                    : 'Nenhum usuário sorteado ainda'}
                </p>
              </div>
            ) : (
              children
            )}
          </div>
        </CardContent>
      </Card>
    );
  };

  const getUserDisplayName = (user: GeekDayUserStatus) => {
    if (user.first_name && user.last_name) {
      return `${user.first_name} ${user.last_name}`;
    } else if (user.first_name) {
      return user.first_name;
    } else if (user.last_name) {
      return user.last_name;
    }
    return user.username;
  };

  /** Rótulo do cargo para exibir. Prefere o `role_display` que o backend já
   * manda pronto (vem do catálogo, então cobre cargos criados pelo admin); o
   * mapa fixo abaixo é só retaguarda. O CODENAME (`role`) continua sendo o que
   * decide cor e ordem na roleta. */
  const rotuloCargo = (u: GeekDayUserStatus): string =>
    u.role_display || getRoleDisplayName(u.role || 'desenvolvedor');

  const getRoleDisplayName = (role: string): string => {
    switch (role) {
      case 'supervisor':
        return 'Supervisor';
      case 'gerente':
        return 'Gerente de Projeto';
      case 'desenvolvedor':
        return 'Desenvolvedor';
      case 'dados':
        return 'Dados';
      case 'processos':
        return 'Processos';
      case 'admin':
        return 'Admin';
      default:
        return role.charAt(0).toUpperCase() + role.slice(1);
    }
  };

  const getUserInitials = (user: GeekDayUserStatus) => {
    if (user.first_name && user.last_name) {
      return `${user.first_name[0]}${user.last_name[0]}`.toUpperCase();
    } else if (user.first_name) {
      return user.first_name.substring(0, 2).toUpperCase();
    } else if (user.last_name) {
      return user.last_name.substring(0, 2).toUpperCase();
    }
    return user.username.substring(0, 2).toUpperCase();
  };

  const availableUsers = users.filter(estaNaFila);
  const sortedUsers = users.filter(u => u.ja_sorteado);
  const sectors = getSectors();

  // A biblioteca da roleta exige de 2 a 24 fatias. Com o Geek Day por grupo de
  // setores isso passou a acontecer bem mais (grupo pequeno, ou fila quase no
  // fim), então só a ROLETA some — as listas continuam na tela para o gestor
  // marcar quem falta arrastando.
  const roletaIndisponivel = sectors.length < 2;

  return (
    <TelaComCarregamento carregando={loading} mensagem="Carregando Geek Day…" className="flex flex-col h-[calc(100vh-128px)] space-y-[24px]">
      <div className="shrink-0">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-[var(--color-foreground)]">Geek Day</h1>
            <p className="text-sm text-[var(--color-muted-foreground)] mt-1">
              {grupoExibido ? (
                <>
                  Sorteio do grupo{' '}
                  <strong className="text-[var(--color-foreground)]">{grupoExibido.nome}</strong>
                  {' '}— cada grupo tem a própria fila e o próprio ciclo (atual: {grupoExibido.current_cycle}).
                </>
              ) : (
                'Sistema de sorteio para o Geek Day'
              )}
            </p>
          </div>

          {/* Seletor e administração só para quem pode sair do próprio grupo
              (`podeTrocarGrupo` já engloba quem tem `manage_geekday`). */}
          {podeTrocarGrupo && (
            <div className="flex flex-wrap items-center gap-2">
              {podeTrocarGrupo && opcoesGrupo.length > 0 && (
                <FilterSelect
                  options={opcoesGrupo}
                  value={grupoSelecionadoId != null ? String(grupoSelecionadoId) : ''}
                  onChange={(v) => v && setGrupoSelecionadoId(Number(v))}
                  clearable={false}
                  className="min-w-[220px]"
                  placeholder="Grupo do Geek Day"
                  searchPlaceholder="Buscar grupo..."
                />
              )}
              {isGestor && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={() => setShowGruposDialog(true)}
                >
                  <Settings2 className="h-4 w-4" />
                  Gerenciar grupos
                </Button>
              )}
            </div>
          )}
        </div>

        {/* Quais setores sorteiam juntos neste grupo */}
        {grupoExibido && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {grupoExibido.setores_detalhe.length === 0 ? (
              <span className="text-xs text-[var(--color-muted-foreground)]">
                Nenhum setor vinculado a este grupo.
              </span>
            ) : (
              grupoExibido.setores_detalhe.map((s) => (
                <SetorChip key={s.id} nome={s.nome} cor={s.cor} />
              ))
            )}
            {grupoParam != null && (
              <Badge variant="outline" className="text-[11px]">
                Você está vendo o Geek Day de outro grupo
              </Badge>
            )}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-[8px] border-b border-[var(--color-border)] shrink-0">
        <Button
          variant="ghost"
          onClick={() => setActiveTab('sorteio')}
          className={cn(
            "rounded-none border-b-2 border-transparent px-[16px] py-[8px] h-auto",
            activeTab === 'sorteio'
              ? "border-[var(--color-primary)] text-[var(--color-primary)] font-semibold"
              : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
          )}
        >
          Sorteio
        </Button>
        <Button
          variant="ghost"
          onClick={() => setActiveTab('historico')}
          className={cn(
            "rounded-none border-b-2 border-transparent px-[16px] py-[8px] h-auto",
            activeTab === 'historico'
              ? "border-[var(--color-primary)] text-[var(--color-primary)] font-semibold"
              : "text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
          )}
        >
          Histórico
        </Button>
        {canReset && activeTab === 'sorteio' && (
          <div className="ml-auto">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowResetDialog(true)}
              className="gap-2"
            >
              <RotateCcw className="h-4 w-4" />
              Resetar Sorteios
            </Button>
          </div>
        )}
      </div>

      {/* Conteúdo da aba Sorteio */}
      {activeTab === 'sorteio' && (
        <div className="flex-1 min-h-0 flex flex-col">
          {/* Área de sorteio */}
          <Card className="card-entra flex-1 min-h-0 flex flex-col">
            <CardContent className="flex-1 min-h-0 overflow-hidden p-6">
              {users.length > 0 ? (
                <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 h-full">
                  {/* Coluna esquerda: Roleta */}
                  <div className="lg:col-span-2 flex flex-col items-center justify-center space-y-3 h-full min-h-0">
                    <div className="w-full flex-1 flex items-center justify-center min-h-0 relative">
                      {/* Fundo desfocado do sorteio. Fica FORA do elemento da
                          roleta para não desfocá-la também. */}
                      {roletaEmDestaque && <div className="roleta-destaque-fundo" />}
                      <div
                        onTransitionEnd={(e) => {
                          // Só o fim da transição de TAMANHO conta: o mesmo
                          // elemento dispara `transitionend` para cada
                          // propriedade animada, e reagir a todas giraria a
                          // roleta duas vezes.
                          if (e.propertyName === 'width') iniciarGiroAposExpandir();
                        }}
                        className={cn(
                        // A ALTURA manda, e a largura acompanha.
                        //
                        // Antes eram `w-full` E `h-full` junto com
                        // `aspect-square`: os tres brigam, a caixa ficava mais
                        // LARGA que alta, a roleta era dimensionada pela
                        // largura e o `overflow-hidden` cortava o circulo em
                        // baixo. Com a altura mandando (`h-full` + `w-auto`), o
                        // quadrado sempre cabe na vertical; `max-w-full` cobre
                        // o caso oposto, de uma coluna estreita demais.
                        "h-full max-h-[500px] w-auto max-w-full aspect-square relative rounded-2xl overflow-hidden roulette-wrapper",
                        roletaIndisponivel && "bg-[var(--color-muted)]",
                        roletaEmDestaque && "roleta-em-destaque",
                      )}>
                        {!roletaIndisponivel && (
                          <PrizeWheel
                            ref={wheelRef}
                            sectors={sectors}
                            onSpinStart={handleSpinStart}
                            onSpinEnd={handleSpinEnd}
                            duration={4}
                            minSpins={5}
                            maxSpins={8}
                            wheelColors={getWheelColors()}
                            textColor="#ffffff"
                            textFontSize={16}
                          />
                        )}
                        {/* Overlay escuro quando não está sorteando. Some
                            durante a expansão: manter o botão sobre a roleta
                            enquanto ela cresce faz a cena parecer travada. */}
                        {!isSpinning && !roletaEmDestaque && (
                          <div className="absolute inset-0 bg-black/60 rounded-2xl flex items-center justify-center z-10 backdrop-blur-sm">
                            {roletaIndisponivel ? (
                              <div className="text-center p-6">
                                <p className="text-white font-semibold text-lg mb-2">
                                  {availableUsers.length === 0
                                    ? 'Todos já foram sorteados neste grupo!'
                                    : 'Falta só 1 participante na fila.'}
                                </p>
                                <p className="text-white/80 text-sm mb-4">
                                  {availableUsers.length === 0
                                    ? 'Use "Resetar Sorteios" para abrir um novo ciclo — o histórico é preservado.'
                                    : 'A roleta precisa de pelo menos 2 na fila. Marque quem falta arrastando o card para "Já Sorteados".'}
                                </p>
                                {canReset && availableUsers.length === 0 && (
                                  <Button
                                    variant="default"
                                    size="lg"
                                    onClick={() => setShowResetDialog(true)}
                                    className="gap-2 shadow-lg"
                                  >
                                    <RotateCcw className="h-5 w-5" />
                                    Resetar Sorteios
                                  </Button>
                                )}
                              </div>
                            ) : (
                              /* Botão de sorteio sobreposto */
                              isGestor && (
                                <Button
                                  onClick={handleSpin}
                                  disabled={isSpinning || availableUsers.length < 2}
                                  size="lg"
                                  className="gap-2 shadow-lg"
                                >
                                  <Trophy className="h-5 w-5" />
                                  Girar Roleta
                                </Button>
                              )
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Resultado do sorteio */}
                    {winner && (
                      <div className="flex flex-col items-center justify-center p-3 bg-green-50 dark:bg-green-900/20 rounded-lg border-2 border-green-500 w-full max-w-xs flex-shrink-0">
                        <Trophy className="h-8 w-8 text-green-500 mb-2" />
                        <h3 className="text-base font-bold text-green-700 dark:text-green-400 mb-1">
                          Parabéns!
                        </h3>
                        <p className="text-xs text-green-600 dark:text-green-300 text-center">
                          {getUserDisplayName(winner)} foi sorteado!
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Coluna direita: Listas de usuários */}
                  <div className="lg:col-span-3 flex flex-col min-h-0 h-full">
                    <DndContext
                      sensors={sensors}
                      collisionDetection={closestCorners}
                      onDragStart={handleDragStart}
                      onDragEnd={handleDragEnd}
                    >
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 h-full">
                        {/* Lista de usuários participando do sorteio */}
                        <DroppableList
                          id="available-list"
                          title="Participantes"
                          count={availableUsers.length}
                          isEmpty={availableUsers.length === 0}
                        >
                          {availableUsers.map((user, iEntrada) => (
                            // Invólucro: o card é arrastável e o nó dele
                            // recebe transform do dnd — animar ali o faria
                            // escapar do dedo.
                            <div
                              key={user.id}
                              className="card-entra"
                              style={{ animationDelay: `${60 + Math.min(iEntrada, 6) * 45}ms` }}
                            >
                              <DraggableUserCard user={user} isSorted={false} />
                            </div>
                          ))}
                        </DroppableList>

                        {/* Lista de usuários já sorteados */}
                        <DroppableList
                          id="sorted-list"
                          title="Já Sorteados"
                          count={sortedUsers.length}
                          isEmpty={sortedUsers.length === 0}
                        >
                          {sortedUsers.map((user, iEntrada) => (
                            // Invólucro: o card é arrastável e o nó dele
                            // recebe transform do dnd — animar ali o faria
                            // escapar do dedo.
                            <div
                              key={user.id}
                              className="card-entra"
                              style={{ animationDelay: `${60 + Math.min(iEntrada, 6) * 45}ms` }}
                            >
                              <DraggableUserCard user={user} isSorted={true} />
                            </div>
                          ))}
                        </DroppableList>
                      </div>
                      <DragOverlay>
                        {activeId ? (() => {
                          const activeUser = users.find(u => String(u.id) === String(activeId));
                          return (
                            <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] shadow-lg p-4">
                              <div className="flex items-center gap-3">
                                <Avatar className="h-[40px] w-[40px]">
                                  {activeUser?.profile_picture_url ? (
                                    <AvatarImage src={activeUser.profile_picture_url} alt={getUserDisplayName(activeUser || users[0])} />
                                  ) : null}
                                  <AvatarFallback className="bg-[var(--color-muted)] text-[var(--color-muted-foreground)]">
                                    {activeUser?.first_name?.charAt(0) || activeUser?.username?.charAt(0) || 'U'}
                                  </AvatarFallback>
                                </Avatar>
                                <div>
                                  <p className="font-medium text-sm">
                                    {getUserDisplayName(activeUser || users[0])}
                                  </p>
                                </div>
                              </div>
                            </div>
                          );
                        })() : null}
                      </DragOverlay>
                    </DndContext>
                  </div>
                </div>
                  ) : (
                    /* Grupo sem ninguém: o roster é montado pelo setor PRIMÁRIO
                       de cada pessoa E pela participação no trabalho, então
                       grupo sem setor (ou só com quem apenas assiste) não tem
                       quem sortear. */
                    <div className="flex flex-col items-center justify-center h-full min-h-0">
                      <div className="w-full max-w-lg h-full max-h-[500px] aspect-square relative rounded-2xl overflow-hidden roulette-wrapper bg-[var(--color-muted)] flex items-center justify-center">
                        {/* Overlay escuro com mensagem */}
                        <div className="absolute inset-0 bg-black/60 rounded-2xl flex items-center justify-center z-10 backdrop-blur-sm">
                          <div className="text-center p-6">
                            <p className="text-white font-semibold text-lg mb-2">
                              {grupoExibido
                                ? `O grupo ${grupoExibido.nome} ainda não tem participantes.`
                                : 'Este grupo ainda não tem participantes.'}
                            </p>
                            <p className="text-white/80 text-sm mb-4">
                              Participa do sorteio quem tem um dos setores do grupo como setor
                              principal e trabalha em sprints, projetos e cards — quem só
                              assiste ao Geek Day não entra na roleta.
                              {isGestor && ' Use "Gerenciar grupos" para incluir setores aqui.'}
                            </p>
                            {isGestor && (
                              <Button
                                variant="default"
                                size="lg"
                                onClick={() => setShowGruposDialog(true)}
                                className="gap-2 shadow-lg"
                              >
                                <Settings2 className="h-5 w-5" />
                                Gerenciar grupos
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Conteúdo da aba Histórico */}
      {activeTab === 'historico' && (
        <Card className="card-entra flex-1 min-h-0 flex flex-col">
          <CardHeader className="shrink-0">
            <CardTitle>Histórico de Sorteios</CardTitle>
          </CardHeader>
          <CardContent className="flex-1 min-h-0 overflow-y-auto">
            {historico.length === 0 ? (
              <div className="text-center p-8 text-[var(--color-muted-foreground)]">
                <p>Nenhum sorteio realizado ainda.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {historico.map((draw, iEntrada) => (
                  <Card
                    key={draw.id}
                    className="card-entra"
                    style={{ animationDelay: `${60 + Math.min(iEntrada, 6) * 45}ms` }}
                  >
                    <CardContent className="flex items-center justify-between p-4">
                      <div className="flex items-center gap-4">
                        <Avatar className="h-[40px] w-[40px]">
                          {draw.usuario_profile_picture ? (
                            <AvatarImage src={draw.usuario_profile_picture} alt={draw.usuario_name} />
                          ) : null}
                          <AvatarFallback className="bg-[var(--color-muted)] text-[var(--color-muted-foreground)]">
                            {draw.usuario_name?.charAt(0) || 'U'}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="font-medium">{draw.usuario_name}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <p className="text-sm text-[var(--color-muted-foreground)]">
                              {formatDate(draw.data_sorteio)}
                            </p>
                            {draw.data_apresentacao && (
                              <Badge variant="outline" className="text-xs">
                                Apresentação: {formatDate(draw.data_apresentacao)}
                              </Badge>
                            )}
                            {draw.sorteado_por_name && (
                              <span className="text-xs text-[var(--color-muted-foreground)]">
                                por {draw.sorteado_por_name}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Dialog de ganhador do sorteio */}
      <Dialog open={showWinnerDialog} onOpenChange={(open) => {
        if (!open && !confirmingWinner) {
          // Não permitir fechar enquanto está confirmando
          setShowWinnerDialog(false);
          setWinner(null);
          setWinnerPresentationDate('');
        }
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-center">Ganhador do Sorteio!</DialogTitle>
            <DialogDescription className="text-center">
              A roleta escolheu o ganhador
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center justify-center py-6">
            {/* Ref para origem do confetti (centro do avatar – foto ou iniciais) */}
            <div ref={winnerAvatarRef}>
              <Avatar className="h-24 w-24 shrink-0 mb-4 ring-4 ring-green-500/30">
              {winner?.profile_picture_url ? (
                <AvatarImage src={winner.profile_picture_url} alt={winner ? getUserDisplayName(winner) : ''} />
              ) : null}
              <AvatarFallback className="bg-[var(--color-muted)] text-[var(--color-muted-foreground)] text-2xl">
                {winner
                  ? (winner.first_name && winner.last_name
                      ? `${winner.first_name.charAt(0)}${winner.last_name.charAt(0)}`.toUpperCase()
                      : winner.first_name?.charAt(0) || winner.username?.substring(0, 2).toUpperCase() || 'U')
                  : 'U'}
              </AvatarFallback>
            </Avatar>
            </div>
            <Trophy className="h-8 w-8 text-green-500 mb-2" aria-hidden />
            <h3 className="text-2xl font-bold text-green-700 dark:text-green-400 mb-2 text-center">
              {winner && getUserDisplayName(winner)}
            </h3>
            <p className="text-sm text-[var(--color-muted-foreground)] text-center">
              {winner && rotuloCargo(winner)}
            </p>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">
              Data de apresentação (opcional)
            </label>
            <DatePicker
              value={winnerPresentationDate}
              onChange={(e) => setWinnerPresentationDate(e.target.value)}
              title="Selecionar Data de Apresentação"
              placeholder="Clique para selecionar a data"
            />
          </div>
          <DialogFooter>
            <Button
              onClick={handleConfirmWinner}
              disabled={confirmingWinner}
              className="w-full gap-2"
            >
              {confirmingWinner ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Confirmando...
                </>
              ) : (
                <>
                  <Check className="h-4 w-4" />
                  Confirmar e Fechar
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog de resetar sorteios */}
      <Dialog open={showResetDialog} onOpenChange={setShowResetDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Resetar Sorteios</DialogTitle>
            <DialogDescription>
              Abre um novo ciclo{grupoExibido ? <> no grupo <strong className="text-[var(--color-foreground)]">{grupoExibido.nome}</strong></> : null}:
              todos os participantes dele voltam a poder ser sorteados. A fila dos outros grupos
              não é tocada e o histórico é preservado.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowResetDialog(false)}
              disabled={resetting}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={handleResetar}
              disabled={resetting}
            >
              {resetting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Resetando...
                </>
              ) : (
                'Resetar'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Administração dos grupos — só para quem tem manage_geekday */}
      {isGestor && (
        <GerenciarGruposDialog
          open={showGruposDialog}
          onOpenChange={(aberto) => {
            setShowGruposDialog(aberto);
            // Ao fechar, o grupo exibido pode ter mudado de setores (ou ter
            // sido excluído): revalida a seleção e recarrega o roster, que é
            // montado a partir dos setores do grupo.
            if (!aberto) {
              void recarregarGrupos();
              void loadData(false);
            }
          }}
          onChanged={(lista) => {
            setGrupos(lista);
            setGrupoSelecionadoId((prev) => (
              prev != null && lista.some((g) => g.id === prev)
                ? prev
                : meuGrupo?.id ?? lista[0]?.id ?? null
            ));
          }}
        />
      )}
    </TelaComCarregamento>
  );
}

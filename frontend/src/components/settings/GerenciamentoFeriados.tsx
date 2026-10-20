import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useAuth } from '@/context/AuthContext';
import { hasPermission } from '@/lib/permissions';
import {
  feriadosCadastradosService,
  type FeriadoAbrangencia,
  type FeriadoCadastrado,
  type FeriadoCadastradoInput,
} from '@/services/feriadosService';

/**
 * A metade CADASTRADA dos feriados: estaduais do RN, municipais de Natal e
 * recessos da empresa.
 *
 * OS NACIONAIS NÃO APARECEM AQUI, e isso é a decisão central da tela. Eles são
 * calculados (`@/lib/feriados` e `apps/projects/feriados.py`), não existem como
 * registro, e listá-los só ofereceria editar o que não dá para editar. A API
 * recusa cadastrar um dia que já é nacional pelo mesmo motivo: duas respostas
 * para o mesmo dia foi exatamente o problema que o módulo de feriados encerrou.
 */

const ABRANGENCIAS: ReadonlyArray<{ valor: FeriadoAbrangencia; label: string }> = [
  { valor: 'estadual', label: 'Estadual (RN)' },
  { valor: 'municipal', label: 'Municipal (Natal)' },
  { valor: 'empresa', label: 'Recesso ou ponto facultativo' },
];

/** A primeira mensagem que a API devolver, ou o texto de reserva.
 *
 * A validação mais importante desta tela — "este dia já é feriado nacional" —
 * vem do servidor, então engolir a mensagem dele deixaria a pessoa sem saber
 * por que o cadastro não passou.
 */
function erroDaApi(err: unknown, reserva: string): string {
  const data = (err as { response?: { data?: Record<string, unknown> } })?.response?.data;
  if (data) {
    const chave = Object.keys(data)[0];
    const valor = chave ? data[chave] : undefined;
    if (Array.isArray(valor) && typeof valor[0] === 'string') return valor[0];
    if (typeof valor === 'string') return valor;
  }
  return reserva;
}

/** DD/MM/AAAA a partir de YYYY-MM-DD, sem passar por `new Date`.
 *
 * `new Date('2026-06-29')` é meia-noite UTC, que em Brasília cai no dia 28 —
 * formatar por ali mostraria a véspera. A string já vem no formato certo, então
 * basta reordenar.
 */
function formatarData(iso: string): string {
  const [ano, mes, dia] = iso.split('-');
  return dia && mes && ano ? `${dia}/${mes}/${ano}` : iso;
}

export function GerenciamentoFeriados() {
  const { user } = useAuth();
  const podeEditar = hasPermission(user, 'manage_feriados');

  const [itens, setItens] = useState<FeriadoCadastrado[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');

  const [emEdicao, setEmEdicao] = useState<FeriadoCadastrado | null>(null);
  const [formAberto, setFormAberto] = useState(false);

  const [aExcluir, setAExcluir] = useState<FeriadoCadastrado | null>(null);
  const [excluindo, setExcluindo] = useState(false);
  const [erroExcluir, setErroExcluir] = useState('');

  useEffect(() => {
    let vivo = true;
    setCarregando(true);
    feriadosCadastradosService
      .listar()
      .then((lista) => {
        if (!vivo) return;
        setItens(lista);
        setErro('');
      })
      .catch(() => vivo && setErro('Não foi possível carregar os feriados cadastrados.'))
      .finally(() => vivo && setCarregando(false));
    return () => {
      vivo = false;
    };
  }, []);

  // Mais recentes primeiro: quem abre a tela quer ver o que vem a seguir, não
  // o que passou há três anos.
  const ordenados = useMemo(
    () => [...itens].sort((a, b) => b.data.localeCompare(a.data)),
    [itens],
  );

  const aoSalvar = (salvo: FeriadoCadastrado) => {
    setItens((antes) => {
      const existe = antes.some((x) => x.id === salvo.id);
      return existe ? antes.map((x) => (x.id === salvo.id ? salvo : x)) : [...antes, salvo];
    });
  };

  const confirmarExclusao = async () => {
    if (!aExcluir) return;
    setExcluindo(true);
    setErroExcluir('');
    try {
      await feriadosCadastradosService.excluir(aExcluir.id);
      setItens((antes) => antes.filter((x) => x.id !== aExcluir.id));
      setAExcluir(null);
    } catch (err) {
      setErroExcluir(erroDaApi(err, 'Não foi possível excluir.'));
    } finally {
      setExcluindo(false);
    }
  };

  if (carregando) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-[var(--color-muted-foreground)]">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {erro && <p className="text-sm text-[var(--color-destructive)]">{erro}</p>}

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <CalendarDays className="h-5 w-5" /> Feriados
              </CardTitle>
              <CardDescription>
                Feriados estaduais, municipais e recessos da empresa. Eles saem do prazo dos
                chamados de suporte e do tempo de desenvolvimento dos cards. Os feriados
                nacionais — incluindo Carnaval, Sexta-feira Santa e Corpus Christi — já são
                calculados automaticamente e não precisam ser cadastrados.
              </CardDescription>
            </div>
            {podeEditar && (
              <Button
                onClick={() => {
                  setEmEdicao(null);
                  setFormAberto(true);
                }}
                className="gap-2"
              >
                <Plus className="h-4 w-4" /> Novo feriado
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {ordenados.length === 0 ? (
            <p className="py-8 text-center text-sm text-[var(--color-muted-foreground)]">
              Nenhum feriado cadastrado. Os nacionais continuam valendo mesmo assim.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-md border border-[var(--color-border)]">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-muted-foreground)]">
                    <th className="px-[12px] py-[8px] font-medium">Data</th>
                    <th className="px-[12px] py-[8px] font-medium">Nome</th>
                    <th className="px-[12px] py-[8px] font-medium">Repete</th>
                    <th className="px-[12px] py-[8px] font-medium">Abrangência</th>
                    <th className="px-[12px] py-[8px] font-medium">Observação</th>
                    {podeEditar && <th className="w-[96px] px-[12px] py-[8px]" />}
                  </tr>
                </thead>
                <tbody>
                  {ordenados.map((f) => (
                    <tr key={f.id} className="border-b border-[var(--color-border)] last:border-0">
                      <td className="whitespace-nowrap px-[12px] py-[8px] tabular-nums">
                        {formatarData(f.data)}
                      </td>
                      <td className="px-[12px] py-[8px]">{f.nome}</td>
                      <td className="whitespace-nowrap px-[12px] py-[8px] text-[var(--color-muted-foreground)]">
                        {f.recorrente ? 'Todo ano' : 'Só nesta data'}
                      </td>
                      <td className="px-[12px] py-[8px] text-[var(--color-muted-foreground)]">
                        {f.abrangencia_display ??
                          ABRANGENCIAS.find((a) => a.valor === f.abrangencia)?.label ??
                          f.abrangencia}
                      </td>
                      <td className="px-[12px] py-[8px] text-[var(--color-muted-foreground)]">
                        {f.observacao || '—'}
                      </td>
                      {podeEditar && (
                        <td className="px-[12px] py-[8px]">
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              title={`Editar ${f.nome}`}
                              onClick={() => {
                                setEmEdicao(f);
                                setFormAberto(true);
                              }}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              title={`Excluir ${f.nome}`}
                              onClick={() => {
                                setAExcluir(f);
                                setErroExcluir('');
                              }}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {formAberto && (
        <FeriadoFormDialog
          item={emEdicao}
          open={formAberto}
          onOpenChange={setFormAberto}
          onSaved={aoSalvar}
        />
      )}

      {aExcluir && (
        <ConfirmDialog
          open={!!aExcluir}
          title={`Excluir o feriado "${aExcluir.nome}"?`}
          description={`${formatarData(aExcluir.data)} volta a contar como dia útil nos prazos.`}
          details={
            erroExcluir ? (
              <p className="text-sm text-[var(--color-destructive)]">{erroExcluir}</p>
            ) : undefined
          }
          confirmLabel="Excluir"
          variant="destructive"
          loading={excluindo}
          onConfirm={confirmarExclusao}
          onCancel={() => setAExcluir(null)}
        />
      )}
    </div>
  );
}

function FeriadoFormDialog({
  item,
  open,
  onOpenChange,
  onSaved,
}: {
  item?: FeriadoCadastrado | null;
  open: boolean;
  onOpenChange: (aberto: boolean) => void;
  onSaved: (f: FeriadoCadastrado) => void;
}) {
  const editando = !!item;
  const [data, setData] = useState('');
  const [nome, setNome] = useState('');
  const [abrangencia, setAbrangencia] = useState<FeriadoAbrangencia>('municipal');
  const [recorrente, setRecorrente] = useState(true);
  const [observacao, setObservacao] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  useEffect(() => {
    setData(item?.data ?? '');
    setNome(item?.nome ?? '');
    setAbrangencia(item?.abrangencia ?? 'municipal');
    // Novo cadastro já vem marcado: feriado estadual e municipal é data fixa
    // anual na esmagadora maioria. Recesso de um ano só é a exceção, e quem o
    // cadastra desmarca — a coluna "Repete" na tabela deixa o resultado à vista.
    setRecorrente(item?.recorrente ?? true);
    setObservacao(item?.observacao ?? '');
    setErro('');
  }, [item, open]);

  const salvar = async () => {
    if (!data || !nome.trim()) {
      setErro('Informe a data e o nome.');
      return;
    }
    setSalvando(true);
    setErro('');
    const payload: FeriadoCadastradoInput = {
      data,
      nome: nome.trim(),
      abrangencia,
      recorrente,
      observacao: observacao.trim(),
    };
    try {
      const salvo = editando
        ? await feriadosCadastradosService.atualizar(item!.id, payload)
        : await feriadosCadastradosService.criar(payload);
      onSaved(salvo);
      onOpenChange(false);
    } catch (err) {
      // A mensagem do servidor é a que importa aqui: é ela que explica
      // "este dia já é feriado nacional" e "já existe feriado nesta data".
      setErro(erroDaApi(err, 'Não foi possível salvar.'));
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editando ? 'Editar feriado' : 'Novo feriado'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="feriado-data">Data</Label>
            <Input
              id="feriado-data"
              type="date"
              value={data}
              onChange={(e) => setData(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="feriado-nome">Nome</Label>
            <Input
              id="feriado-nome"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Ex.: Dia de São Pedro"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="feriado-abrangencia">Abrangência</Label>
            <select
              id="feriado-abrangencia"
              value={abrangencia}
              onChange={(e) => setAbrangencia(e.target.value as FeriadoAbrangencia)}
              className="h-9 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-background)] px-[12px] text-sm text-[var(--color-foreground)]"
            >
              {ABRANGENCIAS.map((a) => (
                <option key={a.valor} value={a.valor}>
                  {a.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-start justify-between gap-4 rounded-md border border-[var(--color-border)] px-[12px] py-[10px]">
            <div className="space-y-1">
              <Label htmlFor="feriado-recorrente">Repete todo ano</Label>
              <p className="text-xs text-[var(--color-muted-foreground)]">
                Deixe marcado para feriados de data fixa, como o 3 de outubro. Desmarque
                para recesso ou ponto facultativo de um ano só.
              </p>
            </div>
            <Switch
              id="feriado-recorrente"
              checked={recorrente}
              onCheckedChange={setRecorrente}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="feriado-obs">Observação (opcional)</Label>
            <Input
              id="feriado-obs"
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              placeholder="Ex.: decreto municipal 1234/2026"
            />
          </div>

          {erro && <p className="text-sm text-[var(--color-destructive)]">{erro}</p>}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={salvando}>
            Cancelar
          </Button>
          <Button onClick={salvar} disabled={salvando} className="gap-2">
            {salvando && <Loader2 className="h-4 w-4 animate-spin" />}
            {editando ? 'Salvar' : 'Cadastrar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

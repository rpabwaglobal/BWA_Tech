import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, Loader2, MessageCircle, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { FeedbackCardBloco } from '@/components/FeedbackCardBloco';
import { FeedbackConsolidadoDialog } from '@/components/FeedbackConsolidadoDialog';
import ReportTablePreviewDialog from '@/components/reports/ReportTablePreviewDialog';
import { CORES_ETAPAS_FEEDBACK, acharProjetoMonitoramento } from '@/lib/monitoramentoFeedback';
import { projectService } from '@/services/projectService';
import { cardService } from '@/services/cardService';
import {
  buscarPedidosDosCards,
  exportarFeedbacks,
  previaFeedbacks,
  type PedidoFeedbackResumo,
} from '@/services/pedidoFeedbackService';
import type { Card as CardType } from '@/services/cardService';
import type { Project } from '@/services/projectService';

/**
 * O QUADRO DO FLUXO DE FEEDBACK, agora dentro da página de Relatórios.
 *
 * Ele saiu da listagem de Projetos e do quadro da sprint: continua sendo um
 * projeto por dentro (é o que dá cards, etapas e histórico de graça), mas
 * deixou de se misturar ao trabalho de sprint na navegação. Quem procura
 * feedback procura em Relatórios.
 *
 * SÓ LEITURA. Não há arrastar aqui, e isso não é limitação de tempo: o backend
 * recusa criar/editar/excluir no fluxo, e mover entre etapas é uma decisão que
 * o quadro do projeto já oferece. Este painel serve para VER e COPIAR o link.
 */
export function PainelFeedbacks() {
  const [projeto, setProjeto] = useState<Project | null>(null);
  const [cards, setCards] = useState<CardType[]>([]);
  const [etapas, setEtapas] = useState<{ key: string; label: string }[]>([]);
  const [pedidos, setPedidos] = useState<Record<string, PedidoFeedbackResumo>>({});
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [busca, setBusca] = useState('');
  const [cardAberto, setCardAberto] = useState<CardType | null>(null);
  /** Formato em download, ou `null`. Trava OS DOIS botões durante o processo:
   *  dois cliques seguidos gerariam a planilha duas vezes no servidor. */
  const [exportando, setExportando] = useState<'xlsx' | 'csv' | null>(null);

  /**
   * Formato com a PRÉ-VISUALIZAÇÃO aberta, ou `null`.
   *
   * O clique no botão não baixa mais direto: abre a mesma janela de preview dos
   * relatórios de Cards, e o download sai do "Gerar e baixar" lá dentro. É a
   * diferença entre conferir antes e descobrir o problema com o arquivo já no
   * e-mail de alguém.
   */
  const [previaAberta, setPreviaAberta] = useState<'xlsx' | 'csv' | null>(null);

  const baixar = async (formato: 'xlsx' | 'csv') => {
    setExportando(formato);
    try {
      await exportarFeedbacks(formato);
      setPreviaAberta(null);
    } catch {
      setErro('Não foi possível gerar o arquivo. Tente de novo.');
    } finally {
      setExportando(null);
    }
  };

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro('');
    try {
      // O fluxo é achado pelo PAR DE FLAGS (projeto sistêmico em sprint
      // sistêmica), nunca pelo nome — renomear pela interface não pode quebrar
      // a tela. Ver `isProjetoMonitoramento`.
      const projetos = await projectService.getAll();
      const encontrado = acharProjetoMonitoramento(projetos);
      if (!encontrado) {
        setProjeto(null);
        setCards([]);
        return;
      }
      setProjeto(encontrado);

      const [listaCards, config] = await Promise.all([
        cardService.getByProject(String(encontrado.id)),
        projectService.getKanbanConfig(String(encontrado.id)).catch(() => ({ stages: [] })),
      ]);
      setCards(listaCards);
      setEtapas(
        (config.stages ?? []).map((e: { key: string; label: string }) => ({
          key: e.key,
          label: e.label,
        })),
      );

      // Uma requisição em lote para todos os cards: o link e o contador de cada
      // um vêm juntos, em vez de uma chamada por card.
      setPedidos(await buscarPedidosDosCards(listaCards.map((c) => c.id)).catch(() => ({})));
    } catch {
      setErro('Não foi possível carregar o fluxo de feedbacks.');
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const cardsFiltrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return cards;
    return cards.filter((c) => (c.nome || '').toLowerCase().includes(q));
  }, [cards, busca]);

  const porEtapa = useCallback(
    (key: string) => cardsFiltrados.filter((c) => c.status === key),
    [cardsFiltrados],
  );

  if (carregando) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center rounded-[14px] border border-[var(--color-border)] bg-[var(--color-card)]">
        <Loader2 className="h-5 w-5 animate-spin text-[var(--color-muted-foreground)]" />
      </div>
    );
  }

  if (erro || !projeto) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 rounded-[14px] border border-[var(--color-border)] bg-[var(--color-card)] p-[24px] text-center">
        <MessageCircle className="h-6 w-6 text-[var(--color-muted-foreground)]" />
        <p className="text-sm text-[var(--color-muted-foreground)]">
          {erro || 'O fluxo de feedbacks ainda não existe. Ele é criado sozinho na primeira entrega de um card marcado.'}
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-[14px] rounded-[14px] border border-[var(--color-border)] bg-[var(--color-card)] p-[14px]">
      <div className="flex flex-wrap items-center justify-between gap-[10px]">
        <div>
          <h2 className="text-lg font-semibold text-[var(--color-foreground)]">Feedbacks</h2>
          <p className="text-xs text-[var(--color-muted-foreground)]">
            {cards.length} card{cards.length === 1 ? '' : 's'} no fluxo · o envio do link é manual
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-[8px]">
          <div className="relative min-h-[40px] w-full sm:w-[240px]">
            <Search className="absolute left-[12px] top-1/2 h-[16px] w-[16px] -translate-y-1/2 text-[var(--color-muted-foreground)]" />
            <Input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar card..."
              className="pl-[36px]"
            />
          </div>

          {/* MESMO BOTÃO do "Gerar relatório" do painel de relatórios: o
              degradê da marca, texto branco e a sombra roxa. As duas telas
              oferecem a mesma coisa — baixar uma tabela —, e com aparências
              diferentes pareciam recursos distintos.

              A EXPORTAÇÃO IGNORA A BUSCA DE PROPÓSITO: o arquivo é o conjunto
              COMPLETO de feedbacks. Um relatório que muda conforme o que ficou
              digitado no campo ao lado seria uma armadilha silenciosa — a pessoa
              exporta, manda por e-mail, e o destinatário não teria como saber
              que houve recorte. */}
          {([
            { formato: 'xlsx' as const, label: 'Excel' },
            { formato: 'csv' as const, label: 'CSV' },
          ]).map((opt) => (
            <Button
              key={opt.formato}
              type="button"
              onClick={() => setPreviaAberta(opt.formato)}
              disabled={!!exportando}
              className="shrink-0"
              title={`Baixar todos os feedbacks em ${opt.label}`}
              style={{
                background: 'linear-gradient(135deg, #754c99, #8fd0d7)',
                color: '#ffffff',
                border: 'none',
                boxShadow: '0 4px 14px rgba(117,76,153,0.35)',
              }}
            >
              {exportando === opt.formato ? (
                <><Loader2 className="mr-[8px] h-[14px] w-[14px] animate-spin" /> Gerando…</>
              ) : (
                <><Download className="mr-[8px] h-[14px] w-[14px]" /> {opt.label}</>
              )}
            </Button>
          ))}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 gap-[14px] overflow-x-auto pb-[8px]">
        {etapas.map((etapa) => {
          const daEtapa = porEtapa(etapa.key);
          return (
            <div
              key={etapa.key}
              className="flex h-full w-[300px] shrink-0 flex-col rounded-[12px] border border-[var(--color-border)] bg-[var(--color-muted)]/25"
            >
              <div className="flex items-center justify-between gap-[8px] border-b border-[var(--color-border)] p-[12px]">
                <span className="flex items-center gap-[8px] text-sm font-semibold text-[var(--color-foreground)]">
                  {/* A cor sai do mapa das etapas do fluxo; uma key desconhecida
                      só perde a bolinha, nada quebra. */}
                  <span
                    className={cn(
                      'h-[10px] w-[10px] shrink-0 rounded-full',
                      CORES_ETAPAS_FEEDBACK[etapa.key] ?? 'bg-[var(--color-muted)]',
                    )}
                  />
                  {etapa.label}
                </span>
                <span className="text-xs text-[var(--color-muted-foreground)]">{daEtapa.length}</span>
              </div>

              <div className="min-h-0 flex-1 space-y-[8px] overflow-y-auto p-[10px]">
                {daEtapa.length === 0 ? (
                  <p className="py-[16px] text-center text-xs text-[var(--color-muted-foreground)]">
                    Nenhum card
                  </p>
                ) : (
                  daEtapa.map((card) => (
                    <button
                      key={card.id}
                      type="button"
                      onClick={() => setCardAberto(card)}
                      className="w-full rounded-[8px] border border-[var(--color-border)] bg-[var(--color-kanban-card)] p-[10px] text-left shadow-sm transition-shadow hover:shadow-md"
                    >
                      <p className="truncate text-sm font-medium text-[var(--color-foreground)]">
                        {card.nome}
                      </p>
                      {pedidos[String(card.id)] && (
                        <FeedbackCardBloco pedido={pedidos[String(card.id)]} />
                      )}
                    </button>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* O MESMO diálogo dos relatórios de Cards — não uma cópia parecida.
          `fetchPage` entrega a página; "Gerar e baixar" chama o download. */}
      {previaAberta && (
        <ReportTablePreviewDialog
          open
          title="Feedbacks"
          format={previaAberta}
          fetchPage={(offset, limit) => previaFeedbacks(offset, limit)}
          onGenerate={() => { void baixar(previaAberta); }}
          onClose={() => setPreviaAberta(null)}
        />
      )}

      {cardAberto && (
        <FeedbackConsolidadoDialog
          card={cardAberto}
          resumo={pedidos[String(cardAberto.id)] ?? null}
          open={!!cardAberto}
          onOpenChange={(aberto) => {
            if (!aberto) setCardAberto(null);
          }}
          // Sem "ir para o card": Relatórios não tem o diálogo de edição, e o
          // prop é opcional justamente para o botão sumir em vez de existir
          // sem destino. Quem precisa editar abre o projeto.
          onFalhaAoCopiar={() => {}}
        />
      )}
    </div>
  );
}

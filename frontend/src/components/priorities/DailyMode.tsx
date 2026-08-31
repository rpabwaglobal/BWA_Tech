import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { KanbanCardPreview } from '@/components/KanbanCardPreview';
import {
  dailyService,
  indexarExtrasPorUsuario,
  type DailyExtrasUsuario,
} from '@/services/dailyService';
import { cn } from '@/lib/utils';
import type { CardData, UserWithCards } from '@/pages/Priorities';

/**
 * Daily Mode — a página de Prioridades conduzida UMA PESSOA POR VEZ.
 *
 * A visualização em grade responde "como está a equipe?" de relance. A reunião
 * diária faz outra pergunta, e uma de cada vez: "o que VOCÊ está tocando, o que
 * entregou e o que te trava?". Com onze pessoas na tela, quem fala precisa
 * procurar o próprio cartão antes de começar — e quem ouve não sabe para onde
 * olhar.
 *
 * Daí as três colunas e a fila de avatares no rodapé: a tela inteira é de uma
 * pessoa só, e a fila mostra quem já passou e quanto falta.
 *
 * OS CARDS SÃO OS DO KANBAN, e não uma cópia com a mesma cara. `KanbanCardPreview`
 * é o único componente de card exportado do projeto (o `KanbanCard` de verdade
 * vive dentro de `ProjectDetails.tsx`, não é exportado e chama `useSortable`
 * direto, então quebra fora de um `DndContext`). Cor de prioridade, badges de
 * área e tipo, atraso e link de script vêm de lá — se o card do quadro mudar,
 * este muda junto.
 */

interface DailyModeProps {
  usuarios: UserWithCards[];
  /** Para o selo "você". */
  usuarioLogadoId?: string | number | null;
  /** Abre o modal de leitura. O segundo argumento evita a espera: quando a tela
   * já tem o card, o modal pinta na hora e a busca vira confirmação. */
  onCardClick: (cardId: string, card?: CardData) => void;
}

const EM_ANDAMENTO = new Set(['em_desenvolvimento', 'em_homologacao']);

function iniciais(usuario: UserWithCards['usuario']): string {
  const nome = `${usuario.first_name ?? ''} ${usuario.last_name ?? ''}`.trim();
  if (nome) {
    const partes = nome.split(/\s+/);
    return (partes[0][0] + (partes.length > 1 ? partes[partes.length - 1][0] : '')).toUpperCase();
  }
  return usuario.username.slice(0, 2).toUpperCase();
}

function nomeExibido(usuario: UserWithCards['usuario']): string {
  const nome = `${usuario.first_name ?? ''} ${usuario.last_name ?? ''}`.trim();
  return nome || usuario.username;
}

function horaDe(iso: string | null | undefined): string {
  if (!iso) return '';
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return '';
  return data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

/** O rótulo de seção: o mesmo peso visual nas três colunas. */
function TituloDaColuna({ texto, contador, tom }: {
  texto: string;
  contador?: number;
  tom?: 'concluido' | 'semana';
}) {
  return (
    <div className="flex items-baseline gap-[8px]">
      <span className="text-[11px] font-bold tracking-[1.2px] text-[var(--color-muted-foreground)]">
        {texto}
      </span>
      {contador !== undefined && (
        <span
          className={cn(
            'ml-auto text-xs font-semibold',
            tom === 'concluido'
              ? 'text-emerald-600 dark:text-emerald-400'
              : 'text-[var(--color-primary)]',
          )}
        >
          {contador}
        </span>
      )}
    </div>
  );
}

/**
 * O separador de grupo dentro de uma coluna: rótulo, contagem e um filete até a
 * borda.
 *
 * UM COMPONENTE PARA OS DOIS AGRUPAMENTOS — por projeto na primeira coluna e
 * por dia na terceira. Escrito duas vezes, bastaria alguém ajustar um para os
 * dois ficarem diferentes, e ninguém abre as duas colunas lado a lado para
 * notar meio pixel de diferença.
 */
function SeparadorDeGrupo({ rotulo, contador }: { rotulo: string; contador: number }) {
  return (
    <div className="flex items-center gap-[8px]">
      {/* `min-w-0` + `truncate`: nome de projeto é escrito por gente e pode ser
          longo. Sem isto ele empurra o filete para fora e a coluna ganha barra
          de rolagem horizontal — foi assim que a terceira coluna quebrou. */}
      <span className="min-w-0 truncate text-xs font-bold text-[var(--color-foreground)]">
        {rotulo}
      </span>
      <span className="shrink-0 text-[11px] text-[var(--color-muted-foreground)]">{contador}</span>
      <div className="h-px flex-1 bg-[var(--color-border)]" />
    </div>
  );
}

/** O vazio de uma coluna, centrado nos dois eixos — e não colado no topo. */
function ColunaVazia({ texto }: { texto: string }) {
  return (
    <div className="flex flex-1 items-center justify-center px-[12px] text-center">
      <p className="text-sm italic text-[var(--color-muted-foreground)]">{texto}</p>
    </div>
  );
}

export function DailyMode({ usuarios, usuarioLogadoId, onCardClick }: DailyModeProps) {
  const [indice, setIndice] = useState(0);
  const [visitados, setVisitados] = useState<Set<number>>(() => new Set([0]));
  const [direcao, setDirecao] = useState<'avante' | 'atras'>('avante');
  const [extras, setExtras] = useState<Map<string, DailyExtrasUsuario>>(() => new Map());
  const [carregandoExtras, setCarregandoExtras] = useState(true);
  const [erroExtras, setErroExtras] = useState(false);

  const total = usuarios.length;
  // A lista pode encolher entre um render e outro (recarga em tempo real). Sem
  // esta trava o índice aponta para fora do array e a tela fica em branco.
  const posicao = total === 0 ? 0 : Math.min(indice, total - 1);
  const pessoa = usuarios[posicao];

  // ── extras do daily ───────────────────────────────────────────────────
  // Buscados SÓ AQUI, e não na página: o modo normal não usa nada disto, e
  // pagar a consulta das entregas de sete dias para quem nunca abre o daily
  // seria custo puro.
  useEffect(() => {
    let vivo = true;
    // SEM `setCarregandoExtras(true)` AQUI. O efeito roda uma vez só (lista de
    // dependências vazia) e o estado inicial já é "carregando" — marcar de novo
    // no corpo do efeito é um setState síncrono que dispara um render extra sem
    // mudar nada. É o que a regra `react-hooks/set-state-in-effect` acusa.
    dailyService
      .getExtras()
      .then((dados) => {
        if (!vivo) return;
        setExtras(indexarExtrasPorUsuario(dados));
      })
      .catch(() => {
        if (!vivo) return;
        // O DAILY NÃO CAI POR CAUSA DISTO. As duas primeiras colunas vêm do
        // payload que a página já tem; falhar aqui deve custar as entregas e o
        // texto do impedimento, não a reunião inteira.
        setErroExtras(true);
      })
      .finally(() => {
        if (vivo) setCarregandoExtras(false);
      });
    return () => {
      vivo = false;
    };
  }, []);

  const irPara = useCallback(
    (alvo: number, sentido: 'avante' | 'atras') => {
      if (total === 0) return;
      const destino = ((alvo % total) + total) % total; // dá a volta nas pontas
      setDirecao(sentido);
      setIndice(destino);
      setVisitados((atuais) => new Set(atuais).add(destino));
    },
    [total],
  );

  const anterior = useCallback(() => irPara(posicao - 1, 'atras'), [irPara, posicao]);
  const proximo = useCallback(() => irPara(posicao + 1, 'avante'), [irPara, posicao]);

  // ── setas do teclado ──────────────────────────────────────────────────
  // Quem conduz a daily fica com a mão no teclado e falando ao mesmo tempo;
  // caçar o botão com o mouse a cada pessoa atrapalha a reunião.
  useEffect(() => {
    const aoTeclar = (evento: KeyboardEvent) => {
      if (evento.key !== 'ArrowLeft' && evento.key !== 'ArrowRight') return;
      if (evento.altKey || evento.ctrlKey || evento.metaKey) return;

      // NÃO SEQUESTRAR A SETA DE QUEM ESTÁ ESCREVENDO nem de quem abriu o card:
      // o modal de leitura fica por cima, e navegar por trás dele trocaria a
      // pessoa sem ninguém ver.
      const alvo = evento.target as HTMLElement | null;
      if (
        alvo?.tagName === 'INPUT' ||
        alvo?.tagName === 'TEXTAREA' ||
        alvo?.tagName === 'SELECT' ||
        alvo?.isContentEditable
      ) {
        return;
      }
      if (document.querySelector('[role="dialog"]')) return;

      evento.preventDefault();
      if (evento.key === 'ArrowRight') proximo();
      else anterior();
    };
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [anterior, proximo]);

  const extrasDaPessoa = pessoa ? extras.get(String(pessoa.usuario.id)) : undefined;

  /** O motivo de CADA card travado, indexado por id do card. */
  const motivoPorCard = useMemo(() => {
    const mapa = new Map<string, string>();
    for (const p of extrasDaPessoa?.pendencias ?? []) mapa.set(String(p.card_id), p.motivo);
    return mapa;
  }, [extrasDaPessoa]);

  const { emAndamento, parados, concluidosHoje } = useMemo(() => {
    const cards = pessoa?.cards ?? [];
    return {
      emAndamento: cards.filter((c) => EM_ANDAMENTO.has(c.status)),
      parados: cards.filter((c) => c.status === 'parado_pendencias'),
      concluidosHoje: cards.filter((c) => c.status === 'finalizado'),
    };
  }, [pessoa]);

  /**
   * Os cards da primeira coluna agrupados por projeto.
   *
   * A ORDEM DOS PROJETOS SEGUE A DOS CARDS, e não o alfabeto: o servidor já
   * devolve ordenado por prioridade (`absoluta > alta > media > baixa`, em
   * views.py), então o projeto do card mais urgente aparece primeiro. Ordenar
   * por nome aqui jogaria fora esse trabalho em silêncio.
   *
   * Os travados entram no MESMO grupo do projeto deles, depois dos que estão
   * andando — o agrupamento é por projeto, e separar por status de novo dentro
   * dele desfaria o que ele existe para mostrar.
   */
  const gruposPorProjeto = useMemo(() => {
    const ordem: string[] = [];
    const porProjeto = new Map<string, CardData[]>();
    for (const card of [...emAndamento, ...parados]) {
      const nome = card.projeto_detail?.nome?.trim() || 'Sem projeto';
      if (!porProjeto.has(nome)) {
        porProjeto.set(nome, []);
        ordem.push(nome);
      }
      porProjeto.get(nome)!.push(card);
    }
    // A POSIÇÃO DA CASCATA É CONTÍNUA entre os grupos: reiniciar o atraso a
    // cada projeto faria o primeiro card de cada grupo entrar junto com o
    // primeiro do grupo anterior, e o escalonamento viraria um piscar.
    let posicaoNaColuna = 0;
    return ordem.map((nome) => ({
      nome,
      cards: porProjeto.get(nome)!.map((card) => ({ card, ordem: posicaoNaColuna++ })),
    }));
  }, [emAndamento, parados]);

  if (total === 0 || !pessoa) {
    return (
      <div className="daily-entra rounded-[14px] border border-[var(--color-border)] bg-[var(--color-card)] py-[48px] text-center text-[var(--color-muted-foreground)]">
        Nenhuma pessoa para conduzir a daily.
      </div>
    );
  }

  const souEu = usuarioLogadoId != null && String(usuarioLogadoId) === String(pessoa.usuario.id);
  const classeDaTroca = direcao === 'avante' ? 'daily-pessoa-avante' : 'daily-pessoa-atras';
  const entregas = extrasDaPessoa?.entregas ?? [];

  /** O card em si — sempre o do kanban, nunca uma cópia. */
  const renderCard = (card: CardData, i: number, canto?: React.ReactNode) => (
    <div
      key={card.id}
      className="card-entra"
      style={{ animationDelay: `${60 + Math.min(i, 6) * 45}ms` }}
    >
      <KanbanCardPreview
        card={card}
        onClick={() => onCardClick(card.id, card)}
        topRightSlot={canto}
      />
    </div>
  );

  return (
    <div className="daily-entra flex flex-col gap-[14px] lg:min-h-0 lg:flex-1">
      <div className="grid grid-cols-1 gap-[16px] lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(300px,1.15fr)_minmax(0,1fr)_minmax(0,1fr)]">

        {/* ── A pessoa e o que ela está tocando ── */}
        <section
          key={`pessoa-${pessoa.usuario.id}`}
          className={cn(
            'flex min-h-0 flex-col gap-[12px] overflow-y-auto rounded-[14px] border border-[var(--color-border)] bg-[var(--color-card)] p-[16px]',
            classeDaTroca,
          )}
        >
          <div className="flex items-center gap-[12px]">
            <Avatar className="h-[44px] w-[44px] shrink-0">
              {pessoa.usuario.profile_picture_url && (
                <AvatarImage src={pessoa.usuario.profile_picture_url} alt={nomeExibido(pessoa.usuario)} />
              )}
              <AvatarFallback className="text-sm font-bold">{iniciais(pessoa.usuario)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-[8px]">
                <h2 className="truncate text-lg font-bold text-[var(--color-foreground)]">
                  {nomeExibido(pessoa.usuario)}
                </h2>
                {souEu && (
                  <span className="shrink-0 rounded-full bg-[var(--color-primary)]/15 px-[8px] py-[2px] text-[11px] font-bold text-[var(--color-primary)]">
                    você
                  </span>
                )}
              </div>
              {/* Os contadores moram aqui, na mesma linha do cargo, e não em
                  caixas próprias: a coluna precisa caber sem rolagem. */}
              <div className="mt-[3px] flex flex-wrap items-center gap-x-[8px] text-xs text-[var(--color-muted-foreground)]">
                <span className="truncate">{pessoa.usuario.role_display}</span>
                <span aria-hidden>·</span>
                <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                  {concluidosHoje.length} hoje
                </span>
                <span aria-hidden>·</span>
                <span className="font-semibold text-[var(--color-primary)]">
                  {extrasDaPessoa?.total_entregas ?? 0} na semana
                </span>
              </div>
            </div>
          </div>

          <TituloDaColuna texto="EM DESENVOLVIMENTO" />
          {gruposPorProjeto.length > 0 ? (
            <div className="flex flex-col gap-[14px]">
              {gruposPorProjeto.map((grupo) => (
                <div key={grupo.nome}>
                  <SeparadorDeGrupo rotulo={grupo.nome} contador={grupo.cards.length} />
                  <div className="mt-[8px] flex flex-col gap-[8px]">
                    {grupo.cards.map(({ card, ordem }) => {
                      const travado = card.status === 'parado_pendencias';
                      if (!travado) return renderCard(card, ordem);

                      // ── O que está travado ──
                      // O CARD VEM JUNTO, e o motivo colado nele. Antes o
                      // impedimento era um bloco solto no rodapé da coluna, sem
                      // dizer de qual card falava — e o card travado nem
                      // aparecia. Aqui a tira nasce presa ao card: o invólucro
                      // recorta os cantos e o card perde o arredondamento de
                      // baixo, então os dois leem como uma peça só.
                      const motivo = motivoPorCard.get(String(card.id));
                      return (
                        <div
                          key={card.id}
                          className="card-entra overflow-hidden rounded-[8px]"
                          style={{ animationDelay: `${60 + Math.min(ordem, 6) * 45}ms` }}
                        >
                          <KanbanCardPreview
                            card={card}
                            className="rounded-b-none"
                            onClick={() => onCardClick(card.id, card)}
                          />
                          <div className="flex gap-[8px] border border-t-0 border-[var(--color-destructive)]/30 bg-[var(--color-destructive)]/10 px-[12px] py-[8px]">
                            <AlertTriangle className="mt-[1px] h-[14px] w-[14px] shrink-0 text-[var(--color-destructive)]" />
                            <div className="min-w-0">
                              <div className="text-[10px] font-bold tracking-[0.4px] text-[var(--color-destructive)]">
                                PARADO POR PENDÊNCIAS
                              </div>
                              <div className="mt-[2px] text-xs leading-[1.35] text-[var(--color-foreground)]">
                                {motivo || (
                                  /* Acontece de verdade: card parado sem motivo
                                     escrito. Dizer isso é honesto; inventar um
                                     texto não seria. */
                                  <span className="italic text-[var(--color-muted-foreground)]">
                                    Sem motivo registrado no card.
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            /* TAMANHO DE CARD, e não uma tira fina. O vazio ocupa o lugar
               que um card ocuparia — assim a coluna não muda de altura quando a
               pessoa pega um card, e o espaço lê como "aqui caberia trabalho"
               em vez de um aviso solto.

               140px sai da conta do próprio card, com as alturas de linha lidas
               do CSS compilado (`text-sm` = 20px, `text-xs` = 16px): 24 de
               padding + 20 do título + 22 do prazo + 26 das etiquetas + 40 de
               descrição em duas linhas + 26 do rodapé = 158 para um card cheio,
               118 para um sem descrição. 140 fica no meio dos dois.

               `rounded-[8px]` é o raio do card, e não os 12 que estavam aqui. */
            <div className="flex min-h-[140px] items-center justify-center rounded-[8px] border border-dashed border-[var(--color-border)] p-[16px] text-center text-sm italic text-[var(--color-muted-foreground)]">
              Nenhum card em desenvolvimento
            </div>
          )}
        </section>

        {/* ── Concluídos hoje ── */}
        <section
          key={`hoje-${pessoa.usuario.id}`}
          className={cn(
            'flex min-h-0 flex-col rounded-[14px] border border-[var(--color-border)] bg-[var(--color-card)] p-[16px]',
            classeDaTroca,
          )}
        >
          <TituloDaColuna texto="CONCLUÍDOS HOJE" contador={concluidosHoje.length} tom="concluido" />
          <div className="mt-[12px] flex min-h-0 flex-1 flex-col gap-[8px] overflow-y-auto pr-[4px]">
            {concluidosHoje.length > 0 ? (
              concluidosHoje.map((card, i) =>
                renderCard(
                  card,
                  i,
                  <span className="flex items-center gap-[3px] rounded-full bg-emerald-500/20 px-[6px] py-[2px] text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">
                    <Check className="h-[10px] w-[10px]" />
                    {horaDe(card.finalizado_em) || 'Concluído'}
                  </span>,
                ),
              )
            ) : (
              <ColunaVazia texto="Nenhum card concluído hoje" />
            )}
          </div>
        </section>

        {/* ── Últimos dias ── */}
        <section
          key={`semana-${pessoa.usuario.id}`}
          className={cn(
            'flex min-h-0 flex-col rounded-[14px] border border-[var(--color-border)] bg-[var(--color-card)] p-[16px]',
            classeDaTroca,
          )}
        >
          <TituloDaColuna
            texto="ÚLTIMA SEMANA"
            contador={extrasDaPessoa?.total_entregas ?? 0}
            tom="semana"
          />
          <div className="mt-[12px] flex min-h-0 flex-1 flex-col gap-[14px] overflow-y-auto pr-[4px]">
            {carregandoExtras ? (
              <div className="flex items-center gap-[8px] text-sm text-[var(--color-muted-foreground)]">
                <Loader2 className="h-[14px] w-[14px] animate-spin" />
                Carregando entregas…
              </div>
            ) : erroExtras ? (
              <ColunaVazia texto="Não foi possível carregar as entregas dos últimos dias." />
            ) : entregas.length > 0 ? (
              entregas.map((dia, iDia) => (
                <div
                  key={dia.dia}
                  className="card-entra"
                  style={{ animationDelay: `${60 + Math.min(iDia, 6) * 45}ms` }}
                >
                  <SeparadorDeGrupo rotulo={dia.label} contador={dia.items.length} />
                  <div className="mt-[8px] flex flex-col gap-[2px]">
                    {dia.items.map((item) => (
                      /* CLICÁVEIS como os das outras colunas: a entrega da
                         semana passada é o card que mais gera "que card era
                         esse?" na reunião. Aqui só temos id, nome e projeto (a
                         listagem é enxuta de propósito), então o modal busca o
                         resto — e abre na hora, com o próprio indicador de
                         carregamento. */
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => onCardClick(item.id)}
                        /* SEM MARGEM NEGATIVA. O `-mx-[6px]` com
                           `w-[calc(100%+12px)]` fazia o botão vazar 6px para
                           fora da caixa em cada lado, e o pai tem
                           `overflow-y-auto` — que, pela regra do CSS, força o
                           outro eixo a `auto` também. Resultado: barra de
                           rolagem HORIZONTAL na coluna inteira. O realce de
                           hover agora fica dentro da caixa. */
                        className="flex w-full items-baseline gap-[8px] rounded-[6px] px-[6px] py-[4px] text-left transition-colors hover:bg-[var(--color-accent)]"
                      >
                        <span className="mt-[6px] h-[6px] w-[6px] shrink-0 rounded-full bg-[var(--color-primary)]/60" />
                        {/* `min-w-0` deixa o nome encolher; sem ele o texto
                            longo empurra a linha e transborda de novo. */}
                        <span className="min-w-0 flex-1 break-words text-sm leading-[1.35] text-[var(--color-foreground)]">
                          {item.nome}
                        </span>
                        {/* O projeto era `shrink-0`: um nome comprido não tinha
                            como ceder e estourava a largura. Agora ele cede até
                            40% e corta. */}
                        <span className="max-w-[40%] shrink-0 truncate text-[11px] text-[var(--color-muted-foreground)]">
                          {item.projeto}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ))
            ) : (
              <ColunaVazia texto="Nenhuma entrega registrada nos últimos dias" />
            )}
          </div>
        </section>
      </div>

      {/* ── A fila ──
          No RODAPÉ, e com os avatares centralizados: a barra é o mapa da
          reunião, não um cabeçalho. */}
      <nav
        aria-label="Navegação entre as pessoas da daily"
        className="flex items-center gap-[12px] rounded-[14px] border border-[var(--color-border)] bg-[var(--color-card)] px-[12px] py-[6px]"
      >
        <Button
          variant="ghost"
          size="icon"
          onClick={anterior}
          aria-label="Pessoa anterior"
          className="h-[34px] w-[34px] shrink-0 rounded-full"
        >
          <ChevronLeft className="h-[18px] w-[18px]" />
        </Button>

        <div className="flex min-w-0 flex-1 items-center justify-center gap-[6px] overflow-x-auto">
          {usuarios.map((u, i) => {
            const ativo = i === posicao;
            const jaPassou = visitados.has(i) && !ativo;
            return (
              /* QUEM ESTÁ FALANDO APARECE MAIOR, e não com um anel em volta.
                 O anel (`ring` + `ring-offset`) desenha fora da caixa do botão
                 e era cortado em cima e embaixo pela barra. O tamanho diz a
                 mesma coisa sem sair do próprio espaço.

                 A CAIXA É FIXA em 52px mesmo com o avatar mudando de tamanho:
                 se ela crescesse junto, a fila inteira se reorganizaria a cada
                 troca de pessoa e os avatares dançariam de lugar. */
              <button
                key={u.usuario.id}
                type="button"
                onClick={() => irPara(i, i > posicao ? 'avante' : 'atras')}
                aria-current={ativo ? 'true' : undefined}
                aria-label={nomeExibido(u.usuario)}
                title={nomeExibido(u.usuario)}
                className={cn(
                  'flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full transition-opacity duration-200',
                  ativo ? 'opacity-100' : jaPassou ? 'opacity-75 hover:opacity-100' : 'opacity-55 hover:opacity-100',
                )}
              >
                <span
                  className={cn(
                    'relative block transition-all duration-200 ease-out',
                    ativo ? 'h-[46px] w-[46px]' : 'h-[36px] w-[36px]',
                  )}
                >
                  <Avatar className="h-full w-full">
                    {u.usuario.profile_picture_url && (
                      <AvatarImage src={u.usuario.profile_picture_url} alt="" />
                    )}
                    <AvatarFallback className={cn('font-semibold', ativo ? 'text-sm' : 'text-xs')}>
                      {iniciais(u.usuario)}
                    </AvatarFallback>
                  </Avatar>
                  {jaPassou && (
                    <span className="absolute -bottom-[1px] -right-[1px] flex h-[14px] w-[14px] items-center justify-center rounded-full border-2 border-[var(--color-card)] bg-emerald-500">
                      <Check className="h-[8px] w-[8px] text-white" strokeWidth={4} />
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex shrink-0 items-center gap-[10px] border-l border-[var(--color-border)] pl-[12px]">
          <span className="text-xs text-[var(--color-muted-foreground)]">
            {posicao + 1} de {total}
          </span>
          <Button onClick={proximo} className="h-[34px] rounded-full pl-[14px] pr-[8px] text-sm">
            Próximo
            <ChevronRight className="ml-[4px] h-[16px] w-[16px]" />
          </Button>
        </div>
      </nav>
    </div>
  );
}

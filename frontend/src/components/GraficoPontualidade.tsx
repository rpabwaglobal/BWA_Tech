import type { ReactNode } from 'react';
import { CartesianGrid, LabelList, Line, LineChart, XAxis, YAxis } from 'recharts';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import type { ResumoPontualidade } from '@/lib/pontualidade';

/**
 * "% entregue no prazo" por grupo — o mesmo gráfico nas duas abas de Métricas.
 *
 * UM COMPONENTE SÓ, porque a pergunta é a mesma: cards de projeto por sprint ou
 * por mês, chamados de suporte por mês. Só o critério de "no prazo" muda, e ele
 * já foi resolvido antes de chegar aqui — `resumirPontualidade` recebe os itens
 * normalizados. Duas cópias deste gráfico divergiriam no eixo, no arredondamento
 * ou no aviso, e a tela passaria a contar duas histórias.
 *
 * O AVISO DOS EXCLUÍDOS NÃO É ENFEITE. Um card sem prazo definido não é
 * atrasado — ninguém disse quando ele vencia —, então ele sai do denominador.
 * Mas sair em silêncio faria um percentual calculado sobre três cards parecer
 * tão sólido quanto um calculado sobre trezentos. A tela de Suporte já segue
 * essa regra com os tickets sem data de conclusão; aqui é a mesma.
 */

const config = {
  percentual: { label: 'No prazo', color: 'var(--color-primary)' },
} satisfies ChartConfig;

/** Abaixo disto o ponto fica em tom de alerta. Não é meta contratada: é o
 *  ponto em que a maioria das entregas passou do prazo, e ler isso no gráfico
 *  de relance vale mais que conferir número por número. */
const LIMIAR_ATENCAO = 50;

/**
 * O ponto da linha, colorido pelo próprio valor.
 *
 * NUMA LINHA A COR NÃO PODE VIVER NO TRAÇO. O traço é um só e atravessa
 * períodos bons e ruins; pintá-lo inteiro de vermelho por causa de um mês
 * difamaria os outros. Então o traço fica neutro e o ALERTA MORA NO PONTO, que
 * é onde o valor de fato está.
 *
 * O tipo que o Recharts passa para um `dot` customizado é frouxo, por isso os
 * campos chegam opcionais e a função devolve `null` quando falta coordenada —
 * desenhar em `NaN` some da tela sem avisar.
 */
function PontoDaLinha(props: {
  cx?: number;
  cy?: number;
  payload?: { percentual?: number; rotulo?: string };
}) {
  const { cx, cy, payload } = props;
  if (typeof cx !== 'number' || typeof cy !== 'number') return null;

  const valor = payload?.percentual ?? 0;
  const cor = valor < LIMIAR_ATENCAO ? 'var(--color-destructive)' : 'var(--color-primary)';

  return (
    <circle
      cx={cx}
      cy={cy}
      r={4}
      fill={cor}
      stroke="var(--color-background)"
      strokeWidth={2}
    />
  );
}

export function GraficoPontualidade({
  resumo,
  titulo,
  descricao,
  icone,
  acoes,
  rotuloItem,
  textoVazio,
}: {
  resumo: ResumoPontualidade;
  titulo: string;
  descricao: ReactNode;
  icone?: ReactNode;
  /** Controles do cabeçalho — por exemplo, o alternador sprint/mês. */
  acoes?: ReactNode;
  /** Como chamar o que está sendo contado: 'card', 'chamado'. */
  rotuloItem: { singular: string; plural: string };
  textoVazio: string;
}) {
  const { grupos, semResposta } = resumo;

  const dados = grupos.map((g) => ({
    rotulo: g.rotulo,
    percentual: Math.round(g.percentual * 10) / 10,
    noPrazo: g.noPrazo,
    total: g.total,
  }));

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              {icone}
              {titulo}
            </CardTitle>
            <CardDescription>{descricao}</CardDescription>
          </div>
          {acoes}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {dados.length === 0 ? (
          <p className="py-10 text-center text-sm text-[var(--color-muted-foreground)]">
            {textoVazio}
          </p>
        ) : (
          <ChartContainer
            config={config}
            className="h-[300px] w-full aspect-auto [&_.recharts-surface]:overflow-visible"
          >
            <LineChart data={dados} margin={{ left: 4, right: 16, top: 28, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="rotulo"
                tickLine={false}
                axisLine={false}
                interval={0}
                angle={dados.length > 8 ? -35 : 0}
                textAnchor={dados.length > 8 ? 'end' : 'middle'}
                height={dados.length > 8 ? 64 : 32}
              />
              {/* Eixo preso em 0–100: deixar o Recharts escolher o topo faria
                  92% ocupar a altura inteira e parecer 100%, e a comparação
                  entre dois períodos passaria a depender do maior deles. Numa
                  LINHA isso pesa ainda mais — a inclinação é o que se lê, e um
                  eixo elástico inventa subidas e quedas que não existem. */}
              <YAxis
                domain={[0, 100]}
                ticks={[0, 25, 50, 75, 100]}
                tickLine={false}
                axisLine={false}
                width={40}
                tickFormatter={(v: number) => `${v}%`}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    nameKey="rotulo"
                    // O tipo que o Recharts declara para o item do tooltip é
                    // `{}`, então a linha de dados só chega por asserção. O
                    // `?.` cobre o caso real de ela não vir.
                    formatter={(valor: unknown, _nome: unknown, entrada: unknown) => {
                      const d = (entrada as { payload?: (typeof dados)[number] } | undefined)
                        ?.payload;
                      if (!d) return `${String(valor)}%`;
                      const nome = d.total === 1 ? rotuloItem.singular : rotuloItem.plural;
                      return `${d.percentual}% — ${d.noPrazo} de ${d.total} ${nome} no prazo`;
                    }}
                  />
                }
              />
              <Line
                type="monotone"
                dataKey="percentual"
                stroke="var(--color-primary)"
                strokeWidth={2}
                // `false` desliga a animação de entrada: com ela, o gráfico
                // redesenha do zero a cada troca de agrupamento e a leitura
                // fica piscando.
                isAnimationActive={false}
                dot={<PontoDaLinha />}
                activeDot={{ r: 6 }}
                // A linha NÃO se interrompe em grupo ausente porque grupo sem
                // nada julgável nem chega aqui — ele é omitido em
                // `resumirPontualidade`, não vira zero.
                connectNulls={false}
              >
                <LabelList
                  dataKey="percentual"
                  position="top"
                  offset={10}
                  className="fill-[var(--color-muted-foreground)]"
                  fontSize={12}
                  formatter={(v: unknown) => `${String(v)}%`}
                />
              </Line>
            </LineChart>
          </ChartContainer>
        )}

        {semResposta > 0 && (
          <p className="text-xs text-[var(--color-muted-foreground)]">
            {semResposta} {semResposta === 1 ? rotuloItem.singular : rotuloItem.plural}{' '}
            {semResposta === 1 ? 'ficou' : 'ficaram'} fora desta conta por não ter prazo ou
            data de conclusão registrada. Sem essas duas datas não dá para dizer se
            {semResposta === 1 ? ' saiu' : ' saíram'} no prazo, e chutar um dos lados seria
            inventar o número.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

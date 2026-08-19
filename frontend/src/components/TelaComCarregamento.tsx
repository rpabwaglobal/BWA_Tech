import { useEffect, useState, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * O PADRÃO DE CARREGAMENTO DAS TELAS, num lugar só.
 *
 * A tela renderiza INTEIRA desde o primeiro quadro — cabeçalho, cartões,
 * listas — desfocada, com um aviso do que está sendo esperado. Quando os dados
 * chegam, o conteúdo entra e só então o desfoque sai.
 *
 * POR QUE NÃO UM SPINNER NO LUGAR DA PÁGINA: trocar a tela por uma bolinha e
 * depois pelo conteúdo faz o layout aparecer do nada. O olho não tem para onde
 * ir enquanto espera, e a espera parece maior do que foi. Mostrando a estrutura
 * desde o começo, a pessoa já sabe o que vem e onde vai olhar.
 *
 * POR QUE O DESFOQUE SAI POR ÚLTIMO: as listas entram em cascata
 * (`.card-entra`), e a cascata mantém cada item invisível durante o próprio
 * atraso (`animation-fill-mode: backwards`). Tirar o desfoque no instante em
 * que os dados chegam deixava a tela nítida e VAZIA por meio segundo, e o
 * efeito lido era "carregou nada e depois encheu". Agora o conteúdo se compõe
 * sob o desfoque e a tela resolve depois — que é a ordem que se espera.
 *
 * POR QUE UM COMPONENTE, e não o trecho copiado em cada página: são dez telas
 * com o mesmo comportamento. Copiado, bastaria ajustar uma para as outras nove
 * ficarem diferentes — e ninguém percebe, porque ninguém abre dez páginas lado
 * a lado. Aqui, mudar o tempo ou o texto muda em todas de uma vez.
 */

/** O maior atraso da cascata (60 + 6 x 45) mais a duração de um item (420ms).
 *  Espelha `.card-entra` no index.css: se aquele tempo mudar, este muda junto. */
export const ENTRADA_MS = 60 + 6 * 45 + 420;

export function TelaComCarregamento({
  carregando,
  mensagem,
  className,
  children,
}: {
  carregando: boolean;
  /** O que está sendo esperado. "Carregando…" sozinho não diz nada; "Carregando
   *  sprints…" diz por que a espera existe. */
  mensagem: string;
  /** Classes do bloco de conteúdo (o que a página usava na própria raiz). */
  className?: string;
  children: ReactNode;
}) {
  const [revelado, setRevelado] = useState(false);

  useEffect(() => {
    if (carregando) return;
    const t = window.setTimeout(() => setRevelado(true), ENTRADA_MS);
    return () => window.clearTimeout(t);
  }, [carregando]);

  return (
    <div className="relative">
      {/* FORA do bloco desfocado, senão o próprio aviso sairia borrado — e um
          aviso ilegível é pior que nenhum. */}
      {carregando && (
        <div className="aviso-carregando">
          <div className="flex items-center gap-[10px] rounded-full border border-[var(--color-border)] bg-[var(--color-card)] px-[16px] py-[8px] shadow-sm">
            <Loader2 className="h-[16px] w-[16px] animate-spin text-[var(--color-primary)]" />
            <span className="text-sm text-[var(--color-muted-foreground)]">{mensagem}</span>
          </div>
        </div>
      )}

      <div className={cn('tela-conteudo', !revelado && 'tela-carregando', className)}>
        {children}
      </div>
    </div>
  );
}

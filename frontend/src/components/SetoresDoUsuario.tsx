import { Badge } from '@/components/ui/badge';
import {
  chipStyle,
  listarSetoresDoUsuario,
  type UsuarioComSetores,
} from '@/lib/catalog-style';
import { cn } from '@/lib/utils';

/** Cor de reserva quando o setor vier sem `cor` (o model tem default, então na
 * prática só acontece com o fallback de payload antigo). */
const COR_PADRAO = '#94a3b8';

type Props = {
  usuario: UsuarioComSetores | null | undefined;
  /** Quantas tags desenhar antes de resumir o resto num "+N". Sem limite por
   * padrão — use onde o espaço é apertado (célula de tabela, coluna estreita). */
  max?: number;
  /** Usa o rótulo curto do setor ("Tech" em vez de "Tecnologia"). O nome
   * inteiro continua acessível pelo `title` da tag. */
  curto?: boolean;
  /** Texto de quando a pessoa não tem setor nenhum. String vazia não desenha
   * nada (para telas em que a ausência de setor não deve ocupar espaço). */
  vazio?: string;
  className?: string;
  badgeClassName?: string;
};

/** Todas as tags de setor de uma pessoa.
 *
 * Existe porque o setor de um usuário deixou de ser UM: quem está em Tecnologia
 * e Comercial precisa aparecer nos dois em toda tela que mostra "o setor dele".
 * Centralizar aqui evita que cada tela reinvente a regra do "+N" e do fallback
 * de quem não tem setor — e mantém a mesma tag (`chipStyle` + `Badge`) que o
 * resto do produto já usa para cargo e para compartilhamento entre setores. */
export function SetoresDoUsuario({
  usuario,
  max,
  curto = false,
  vazio = 'Sem setor',
  className,
  badgeClassName,
}: Props) {
  const setores = listarSetoresDoUsuario(usuario);

  if (setores.length === 0) {
    if (!vazio) return null;
    return (
      <div className={cn('flex flex-wrap items-center gap-1', className)}>
        <span className="text-xs text-[var(--color-muted-foreground)]">{vazio}</span>
      </div>
    );
  }

  const limite = max && max > 0 ? max : setores.length;
  const visiveis = setores.slice(0, limite);
  const ocultos = setores.slice(limite);

  return (
    <div className={cn('flex flex-wrap items-center gap-1', className)}>
      {visiveis.map((setor) => (
        <Badge
          key={setor.codename}
          className={cn('border whitespace-nowrap', badgeClassName)}
          style={chipStyle(setor.cor || COR_PADRAO)}
          // O título repete o nome inteiro: com `curto` (ou com a tag truncada
          // pela coluna) é o único caminho para ler o setor por extenso.
          title={setor.is_primary ? `${setor.nome} — setor primário` : setor.nome}
        >
          {curto ? setor.label_curto || setor.nome : setor.nome}
        </Badge>
      ))}
      {ocultos.length > 0 && (
        // Truncar sem dar caminho para ver o resto esconde informação: o "+N"
        // carrega os nomes que ficaram de fora no `title`.
        <Badge
          className={cn(
            'whitespace-nowrap border-[var(--color-border)] bg-[var(--color-muted)] text-[var(--color-muted-foreground)]',
            badgeClassName,
          )}
          title={ocultos.map((setor) => setor.nome).join(', ')}
        >
          +{ocultos.length}
        </Badge>
      )}
    </div>
  );
}

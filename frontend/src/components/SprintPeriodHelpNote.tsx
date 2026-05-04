import { Link } from 'react-router-dom';
import { ROUTES } from '@/routes';

type Props = {
  /** Mostrar link para /prioridades (supervisor/admin) */
  showPrioritiesLink?: boolean;
};

/**
 * Explica que a data de início é só o dia; o fechamento automático usa o instante
 * definido em "Data e hora de fechamento" na sprint (não o horário global em Prioridades).
 */
export function SprintPeriodHelpNote({ showPrioritiesLink = true }: Props) {
  return (
    <div
      className="rounded-lg border border-[var(--color-border)] bg-[var(--color-muted)]/40 px-3 py-2.5 text-xs leading-relaxed text-[var(--color-foreground)]"
      role="note"
    >
      <p className="font-medium">Sobre datas e fechamento</p>
      <p className="mt-1.5 text-[var(--color-muted-foreground)]">
        A <strong>data de início</strong> grava apenas o dia. O <strong>fechamento automático</strong> da sprint ocorre no
        instante que você definir em <strong>Data e hora de fechamento</strong> — não usa o &quot;Horário limite&quot; de{' '}
        {showPrioritiesLink ? (
          <Link to={ROUTES.prioridades} className="font-medium text-[var(--color-primary)] underline underline-offset-2">
            Prioridades
          </Link>
        ) : (
          <strong>Prioridades</strong>
        )}
        , que continua valendo só para o fluxo semanal de prioridades.
      </p>
    </div>
  );
}

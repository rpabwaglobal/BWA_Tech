import { Link } from 'react-router-dom';

type Props = {
  /** Mostrar link para /prioridades (supervisor/admin) */
  showPrioritiesLink?: boolean;
};

/**
 * Explica que o período da sprint grava só datas; o horário de fechamento automático vem da config global em Prioridades.
 */
export function SprintPeriodHelpNote({ showPrioritiesLink = true }: Props) {
  return (
    <div
      className="rounded-lg border border-[var(--color-border)] bg-[var(--color-muted)]/40 px-3 py-2.5 text-xs leading-relaxed text-[var(--color-foreground)]"
      role="note"
    >
      <p className="font-medium">Sobre datas e horário de fechamento</p>
      <p className="mt-1.5 text-[var(--color-muted-foreground)]">
        Apenas o <strong>dia</strong> de início e o <strong>dia</strong> de fim são guardados. O fechamento automático da sprint
        no último dia ocorre à hora definida em{' '}
        {showPrioritiesLink ? (
          <Link to="/priorities" className="font-medium text-[var(--color-primary)] underline underline-offset-2">
            Prioridades
          </Link>
        ) : (
          <strong>Prioridades</strong>
        )}
        {' '}
        (modo <strong>semana</strong>), campo <strong>Horário limite</strong> — não pela hora escolhida num calendário de sprint.
      </p>
    </div>
  );
}

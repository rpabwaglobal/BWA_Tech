import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { sprintService } from '@/services/sprintService';
import { getSprintEmAndamentoPrincipal } from '@/lib/sprintFechamento';
import { ROUTES } from '@/routes';

/** `/sprint` → sprint em andamento; sem ativa, vai para a lista de gerenciamento. */
export default function SprintEntryRedirect() {
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const sprints = await sprintService.getAll();
        if (cancelled) return;
        const active = getSprintEmAndamentoPrincipal(sprints);
        if (active) {
          navigate(ROUTES.sprintPorId(String(active.id)), { replace: true });
        } else {
          navigate(ROUTES.sprintGerenciar, { replace: true });
        }
      } catch {
        if (!cancelled) navigate(ROUTES.sprintGerenciar, { replace: true });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  return (
    <div className="flex h-[256px] items-center justify-center">
      <Loader2 className="h-[32px] w-[32px] animate-spin text-[var(--color-primary)]" />
    </div>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ChevronDown, Loader2, Search } from 'lucide-react';
import { sprintService, type Sprint } from '@/services/sprintService';
import { projectService, type Project } from '@/services/projectService';
import { ROUTES } from '@/routes';
import { cn } from '@/lib/utils';

type Props = {
  isOpen: boolean;
  onClose: () => void;
};

type SprintStatus = 'em_andamento' | 'futura';
type SprintWithStatus = Sprint & { _status: SprintStatus };

function sprintStatusSuffix(status: SprintStatus): string {
  return status === 'em_andamento' ? '(Em andamento)' : '(Sprint futura)';
}

/**
 * Modal de atalho rápido (Dashboard → "Criar Card") para selecionar a sprint
 * (em andamento ou planejada) e um projeto dela. Ao confirmar, navega para
 * /projeto/<id>?newCard=1 que abre o formulário de criação do card.
 */
export function QuickCreateCardModal({ isOpen, onClose }: Props) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sprints, setSprints] = useState<SprintWithStatus[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedSprintId, setSelectedSprintId] = useState<string>('');
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [sprintSearch, setSprintSearch] = useState('');
  const [projectSearch, setProjectSearch] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    let mounted = true;
    setLoading(true);
    setError('');
    setSelectedSprintId('');
    setSelectedProjectId('');
    setProjects([]);
    setSprintSearch('');
    setProjectSearch('');

    Promise.all([sprintService.getAll(), projectService.getAll()])
      .then(([allSprints, allProjects]) => {
        if (!mounted) return;
        const now = new Date();
        // Não-finalizadas: em andamento (now no intervalo) OU futuras (data_inicio > now).
        // Exclui as que já passaram do fechamento sem ter sido finalizadas.
        const visibleSprints: SprintWithStatus[] = allSprints
          .filter((s) => !s.finalizada)
          .map<SprintWithStatus | null>((s) => {
            const inicio = s.data_inicio ? new Date(s.data_inicio) : null;
            const fim = s.fechamento_em ? new Date(s.fechamento_em) : null;
            if (fim && fim < now) return null;
            if (inicio && inicio > now) {
              return { ...s, _status: 'futura' as const };
            }
            return { ...s, _status: 'em_andamento' as const };
          })
          .filter((s): s is SprintWithStatus => s !== null)
          .sort((a, b) => {
            if (a._status !== b._status) return a._status === 'em_andamento' ? -1 : 1;
            return new Date(a.data_inicio).getTime() - new Date(b.data_inicio).getTime();
          });

        setSprints(visibleSprints);
        setProjects(allProjects);
        if (visibleSprints.length === 1) {
          setSelectedSprintId(String(visibleSprints[0].id));
        }
      })
      .catch(() => {
        if (!mounted) return;
        setError('Não foi possível carregar sprints e projetos.');
      })
      .finally(() => mounted && setLoading(false));

    return () => {
      mounted = false;
    };
  }, [isOpen]);

  const projectsOfSprint = useMemo(() => {
    if (!selectedSprintId) return [];
    return projects.filter((p) => String(p.sprint) === String(selectedSprintId));
  }, [projects, selectedSprintId]);

  // Filtros de busca (case-insensitive)
  const filteredSprints = useMemo(() => {
    const q = sprintSearch.trim().toLowerCase();
    if (!q) return sprints;
    return sprints.filter((s) => s.nome.toLowerCase().includes(q));
  }, [sprints, sprintSearch]);

  const filteredProjects = useMemo(() => {
    const q = projectSearch.trim().toLowerCase();
    if (!q) return projectsOfSprint;
    return projectsOfSprint.filter((p) => p.nome.toLowerCase().includes(q));
  }, [projectsOfSprint, projectSearch]);

  useEffect(() => {
    setSelectedProjectId('');
    setProjectSearch('');
  }, [selectedSprintId]);

  const selectedSprint = sprints.find((s) => String(s.id) === selectedSprintId);
  const selectedProject = projectsOfSprint.find((p) => String(p.id) === selectedProjectId);

  const handleContinue = () => {
    if (!selectedProjectId) return;
    onClose();
    navigate(`${ROUTES.projeto(selectedProjectId)}?newCard=1`);
  };

  const triggerClass =
    'flex h-9 w-full items-center justify-between rounded-md border border-[var(--color-border)] bg-[var(--color-input,transparent)] px-3 py-1 text-sm shadow-sm transition-colors hover:bg-[var(--color-accent)]/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-ring)] disabled:cursor-not-allowed disabled:opacity-50';

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {/* `overflow-visible` permite que os dropdowns escapem da caixa do
          modal (sem ele, o `overflow-y-auto` default do DialogContent
          cortava o menu na borda inferior). Conteúdo aqui é pequeno, não
          precisa de scroll interno. */}
      <DialogContent onClose={onClose} className="sm:max-w-[440px] gap-6 overflow-visible">
        <DialogHeader className="space-y-3">
          <DialogTitle className="text-xl">Criar card</DialogTitle>
          <DialogDescription className="text-sm leading-relaxed">
            Escolha a sprint em andamento ou planejada e o projeto onde o card será criado.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-[var(--color-muted-foreground)]" />
          </div>
        ) : sprints.length === 0 ? (
          <p className="text-sm text-[var(--color-muted-foreground)]">
            Não há sprints em andamento nem planejadas. Crie uma sprint antes.
          </p>
        ) : (
          // pt-2: respiro extra entre a descrição e o primeiro seletor (acima do gap-6 do DialogContent).
          // space-y-6: mais ar entre os dois seletores.
          <div className="pt-2 space-y-6">
            {/* Sprint */}
            <div className="space-y-2">
              <Label>Selecionar Sprint</Label>
              <DropdownMenu className="block w-full">
                <DropdownMenuTrigger className={triggerClass}>
                  {selectedSprint ? (
                    <span className="flex items-center gap-2 truncate">
                      <span className="truncate">{selectedSprint.nome}</span>
                      <span className="text-[var(--color-muted-foreground)] text-xs">
                        {sprintStatusSuffix(selectedSprint._status)}
                      </span>
                    </span>
                  ) : (
                    <span className="text-[var(--color-muted-foreground)]">Selecione...</span>
                  )}
                  <ChevronDown className="h-4 w-4 opacity-60 shrink-0" />
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  className="w-full max-h-[280px] overflow-hidden p-0"
                  style={{ width: '100%' }}
                >
                  {/* Barra de busca fixa no topo da lista */}
                  <div className="sticky top-0 z-10 bg-[var(--color-popover)] border-b border-[var(--color-border)] p-2">
                    <div className="relative">
                      <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--color-muted-foreground)]" />
                      <Input
                        autoFocus
                        value={sprintSearch}
                        onChange={(e) => setSprintSearch(e.target.value)}
                        placeholder="Buscar sprint..."
                        className="h-8 pl-7 text-sm"
                      />
                    </div>
                  </div>
                  <div className="max-h-[228px] overflow-y-auto p-1">
                    {filteredSprints.length === 0 ? (
                      <div className="px-3 py-2 text-xs text-[var(--color-muted-foreground)]">
                        Nenhuma sprint encontrada.
                      </div>
                    ) : (
                      filteredSprints.map((s) => (
                        <DropdownMenuItem
                          key={s.id}
                          onSelect={() => setSelectedSprintId(String(s.id))}
                          className={cn(
                            'flex items-center justify-between gap-2',
                            String(s.id) === selectedSprintId && 'bg-[var(--color-accent)]/60',
                          )}
                        >
                          <span className="truncate">{s.nome}</span>
                          <span className="text-[var(--color-muted-foreground)] text-xs shrink-0">
                            {sprintStatusSuffix(s._status)}
                          </span>
                        </DropdownMenuItem>
                      ))
                    )}
                  </div>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {/* Projeto */}
            <div className="space-y-2">
              <Label>Projeto</Label>
              <DropdownMenu className="block w-full">
                <DropdownMenuTrigger
                  className={triggerClass}
                  disabled={!selectedSprintId}
                >
                  {selectedProject ? (
                    <span className="truncate">{selectedProject.nome}</span>
                  ) : (
                    <span className="text-[var(--color-muted-foreground)]">
                      {selectedSprintId
                        ? projectsOfSprint.length === 0
                          ? 'Esta sprint não tem projetos'
                          : 'Selecione...'
                        : 'Escolha uma sprint primeiro'}
                    </span>
                  )}
                  <ChevronDown className="h-4 w-4 opacity-60 shrink-0" />
                </DropdownMenuTrigger>
                {selectedSprintId && projectsOfSprint.length > 0 && (
                  <DropdownMenuContent
                    align="start"
                    className="w-full max-h-[280px] overflow-hidden p-0"
                    style={{ width: '100%' }}
                  >
                    <div className="sticky top-0 z-10 bg-[var(--color-popover)] border-b border-[var(--color-border)] p-2">
                      <div className="relative">
                        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--color-muted-foreground)]" />
                        <Input
                          autoFocus
                          value={projectSearch}
                          onChange={(e) => setProjectSearch(e.target.value)}
                          placeholder="Buscar projeto..."
                          className="h-8 pl-7 text-sm"
                        />
                      </div>
                    </div>
                    <div className="max-h-[228px] overflow-y-auto p-1">
                      {filteredProjects.length === 0 ? (
                        <div className="px-3 py-2 text-xs text-[var(--color-muted-foreground)]">
                          Nenhum projeto encontrado.
                        </div>
                      ) : (
                        filteredProjects.map((p) => (
                          <DropdownMenuItem
                            key={p.id}
                            onSelect={() => setSelectedProjectId(String(p.id))}
                            className={cn(
                              'truncate',
                              String(p.id) === selectedProjectId && 'bg-[var(--color-accent)]/60',
                            )}
                          >
                            {p.nome}
                          </DropdownMenuItem>
                        ))
                      )}
                    </div>
                  </DropdownMenuContent>
                )}
              </DropdownMenu>
            </div>
          </div>
        )}

        {error && <p className="text-sm text-[var(--color-destructive)]">{error}</p>}

        <DialogFooter className="gap-2 sm:gap-2 sm:space-x-0 sm:flex-row sm:justify-stretch">
          <Button type="button" variant="outline" size="lg" onClick={onClose} className="flex-1 text-base">
            Cancelar
          </Button>
          <Button
            type="button"
            size="lg"
            onClick={handleContinue}
            disabled={!selectedProjectId || loading}
            className="flex-1 text-base"
          >
            Continuar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

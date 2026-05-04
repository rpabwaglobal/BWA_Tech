import { useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { projectService, type Project } from '@/services/projectService';
import { sprintService, type Sprint } from '@/services/sprintService';
import { ROUTES } from '@/routes';

const SUPPORT_STAGE_KEYS_ORDER = [
  'a_desenvolver',      // Tickets abertos
  'em_desenvolvimento',
  'parado_pendencias',
  'inviabilizado',
  'finalizado',         // Concluído
] as const;

export default function Support() {
  const [loading, setLoading] = useState(true);
  const [projects, setProjects] = useState<Project[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadOrCreateSupportProject = async () => {
      try {
        setLoading(true);
        setError(null);

        const projectsData = await projectService.getAll();
        const normalizedProjects = Array.isArray(projectsData) ? projectsData : [];

        const existingSupportProject = findSupportProject(normalizedProjects);
        if (existingSupportProject) {
          await ensureSupportProjectStages(existingSupportProject.id);
          setProjects(normalizedProjects);
          return;
        }

        const sprintsData = await sprintService.getAll();
        const normalizedSprints = Array.isArray(sprintsData) ? sprintsData : [];

        if (normalizedSprints.length === 0) {
          setProjects(normalizedProjects);
          setError('Não foi possível criar o projeto de suporte automaticamente porque não existe nenhuma sprint cadastrada.');
          return;
        }

        const sprintToUse = pickBestSprint(normalizedSprints);
        const created = await projectService.create({
          nome: 'Suporte',
          descricao: 'Projeto automático do sistema para tickets de suporte.',
          sprint: sprintToUse.id,
        });

        await ensureSupportProjectStages(created.id);
        setProjects([created, ...normalizedProjects]);
      } finally {
        setLoading(false);
      }
    };

    loadOrCreateSupportProject();
  }, []);

  const supportProject = useMemo(() => findSupportProject(projects), [projects]);

  if (loading) {
    return (
      <div className="h-[calc(100vh-128px)] flex items-center justify-center text-[var(--color-muted-foreground)]">
        <Loader2 className="h-[20px] w-[20px] animate-spin mr-[8px]" />
        Carregando projeto de suporte...
      </div>
    );
  }

  if (!supportProject) {
    return (
      <div className="h-[calc(100vh-128px)] flex items-center justify-center">
        <div className="rounded-[12px] border border-[var(--color-border)] bg-[var(--color-card)] p-[20px] max-w-[560px]">
          <h2 className="text-lg font-semibold text-[var(--color-foreground)]">Não foi possível abrir o suporte</h2>
          <p className="text-sm text-[var(--color-muted-foreground)] mt-[8px]">{error ?? 'Tente novamente em instantes.'}</p>
        </div>
      </div>
    );
  }

  return <Navigate to={ROUTES.projeto(String(supportProject.id))} replace />;
}

function normalize(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function findSupportProject(projects: Project[]) {
  const byExactName = projects.find((project) => normalize(project.nome) === 'suporte');
  if (byExactName) return byExactName;

  const byContains = projects.find((project) => normalize(project.nome).includes('suporte'));
  if (byContains) return byContains;

  return null;
}

function pickBestSprint(sprints: Sprint[]) {
  const now = Date.now();

  const activeSprint = sprints.find((sprint) => {
    const inicio = new Date(sprint.data_inicio).getTime();
    const fim = new Date(sprint.fechamento_em).getTime();
    return now >= inicio && now <= fim;
  });
  if (activeSprint) return activeSprint;

  const nextSprint = sprints
    .filter((sprint) => new Date(sprint.data_inicio).getTime() > now)
    .sort((a, b) => new Date(a.data_inicio).getTime() - new Date(b.data_inicio).getTime())[0];
  if (nextSprint) return nextSprint;

  return sprints
    .slice()
    .sort((a, b) => new Date(b.data_inicio).getTime() - new Date(a.data_inicio).getTime())[0];
}

async function ensureSupportProjectStages(projectId: string) {
  try {
    const cfg = await projectService.getKanbanConfig(projectId);
    const currentKeys = (cfg?.stages || []).map((stage: any) => String(stage.key));

    const allowedKeys = new Set(SUPPORT_STAGE_KEYS_ORDER);
    const missing = SUPPORT_STAGE_KEYS_ORDER.filter((key) => !currentKeys.includes(key));
    const extras = currentKeys.filter((key) => !allowedKeys.has(key as any));

    if (missing.length > 0) {
      await Promise.all(missing.map((key) => projectService.addKanbanStage(projectId, key).catch(() => null)));
    }

    if (extras.length > 0) {
      // Se houver cards em etapas extras, move para "finalizado" antes de remover.
      await Promise.all(
        extras.map((key) =>
          projectService.removeKanbanStage(projectId, key, 'finalizado').catch(() => null),
        ),
      );
    }

    await projectService.updateKanbanConfigReorder(projectId, [...SUPPORT_STAGE_KEYS_ORDER]);
  } catch {
    // Não bloquear a navegação para o suporte caso a API de configuração falhe.
  }
}

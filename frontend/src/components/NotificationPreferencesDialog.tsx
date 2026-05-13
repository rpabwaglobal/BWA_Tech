import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  notificationService,
  type NotificationPreferences,
  type NotificationTypeSlug,
} from '@/services/notificationService';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type TypeMeta = {
  slug: NotificationTypeSlug;
  label: string;
  description: string;
  defaultOn: boolean;
};

const DEFAULT_ON_TYPES: TypeMeta[] = [
  { slug: 'card_updated', label: 'Cards atualizados', description: 'Quando dados ou comentários de um card mudam.', defaultOn: true },
  { slug: 'card_deleted', label: 'Cards deletados', description: 'Quando um card seu é removido.', defaultOn: true },
  { slug: 'project_created', label: 'Projetos criados', description: 'Quando você é atribuído como gerente de um projeto.', defaultOn: true },
  { slug: 'card_overdue', label: 'Cards atrasados', description: 'Quando um card seu passou da data limite.', defaultOn: true },
  { slug: 'card_due_24h', label: 'Vencimento em 24h', description: 'Aviso 24h antes do vencimento.', defaultOn: true },
  { slug: 'card_due_1h', label: 'Vencimento em 1h', description: 'Aviso 1h antes do vencimento.', defaultOn: true },
  { slug: 'card_due_10min', label: 'Vencimento em 10min', description: 'Último alerta antes de vencer.', defaultOn: true },
];

const DEFAULT_OFF_TYPES: TypeMeta[] = [
  { slug: 'card_created', label: 'Cards criados', description: 'Quando um card é atribuído a você ou ao seu projeto.', defaultOn: false },
  { slug: 'card_moved', label: 'Cards movidos', description: 'Quando o status (etapa) de um card muda.', defaultOn: false },
  { slug: 'sprint_created', label: 'Sprints criadas', description: 'Quando uma nova sprint é criada (vai para todos).', defaultOn: false },
  { slug: 'role_changed', label: 'Mudanças de cargo', description: 'Quando seu cargo é alterado por um administrador.', defaultOn: false },
];

const DEFAULTS: NotificationPreferences = {
  card_updated: true,
  card_deleted: true,
  project_created: true,
  card_overdue: true,
  card_due_24h: true,
  card_due_1h: true,
  card_due_10min: true,
  card_created: false,
  card_moved: false,
  sprint_created: false,
  role_changed: false,
};

export function NotificationPreferencesDialog({ open, onOpenChange }: Props) {
  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<NotificationTypeSlug | null>(null);
  const [error, setError] = useState('');

  // Carregar ao abrir
  useEffect(() => {
    if (!open) return;
    let mounted = true;
    setLoading(true);
    setError('');
    notificationService
      .getPreferences()
      .then((data) => {
        if (!mounted) return;
        setPrefs(data);
      })
      .catch(() => {
        if (!mounted) return;
        setError('Não foi possível carregar suas preferências.');
      })
      .finally(() => mounted && setLoading(false));
    return () => {
      mounted = false;
    };
  }, [open]);

  const handleToggle = async (slug: NotificationTypeSlug, next: boolean) => {
    if (!prefs) return;
    // Optimistic update
    const previous = prefs;
    setPrefs({ ...prefs, [slug]: next });
    setSaving(slug);
    setError('');
    try {
      const updated = await notificationService.updatePreferences({ [slug]: next });
      setPrefs(updated);
    } catch {
      // Revert em erro
      setPrefs(previous);
      setError('Erro ao salvar. Tente novamente.');
    } finally {
      setSaving(null);
    }
  };

  const handleRestoreDefaults = async () => {
    if (!prefs) return;
    const previous = prefs;
    setPrefs(DEFAULTS);
    setError('');
    try {
      const updated = await notificationService.updatePreferences(DEFAULTS);
      setPrefs(updated);
    } catch {
      setPrefs(previous);
      setError('Erro ao restaurar padrões.');
    }
  };

  const renderRow = (meta: TypeMeta) => {
    const checked = prefs ? prefs[meta.slug] : meta.defaultOn;
    const isSaving = saving === meta.slug;
    return (
      <div
        key={meta.slug}
        className="flex items-start justify-between gap-4 py-3"
      >
        <div className="flex-1 min-w-0">
          <label
            htmlFor={`notif-${meta.slug}`}
            className="text-sm font-medium text-[var(--color-foreground)] cursor-pointer"
          >
            {meta.label}
          </label>
          <p className="text-xs text-[var(--color-muted-foreground)] mt-0.5">
            {meta.description}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0 pt-0.5">
          {isSaving && <Loader2 className="h-3 w-3 animate-spin text-[var(--color-muted-foreground)]" />}
          <Switch
            id={`notif-${meta.slug}`}
            checked={checked}
            onCheckedChange={(next) => handleToggle(meta.slug, next)}
            disabled={loading || isSaving}
            aria-label={meta.label}
          />
        </div>
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Preferências de notificação</DialogTitle>
          <DialogDescription>
            Escolha quais tipos de notificação você deseja receber. As mudanças são salvas automaticamente.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-[var(--color-muted-foreground)]" />
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)] mb-1">
                Notificações padrão
              </h3>
              <p className="text-xs text-[var(--color-muted-foreground)] mb-2">
                Recomendado deixar ligado.
              </p>
              <div className="divide-y divide-[var(--color-border)]">
                {DEFAULT_ON_TYPES.map(renderRow)}
              </div>
            </div>

            <Separator />

            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-muted-foreground)] mb-1">
                Notificações adicionais
              </h3>
              <p className="text-xs text-[var(--color-muted-foreground)] mb-2">
                Desligadas por padrão (podem gerar muito ruído).
              </p>
              <div className="divide-y divide-[var(--color-border)]">
                {DEFAULT_OFF_TYPES.map(renderRow)}
              </div>
            </div>

            {error && (
              <p className="text-sm text-[var(--color-destructive)]">{error}</p>
            )}

            <div className="flex items-center justify-between pt-2">
              <Button type="button" variant="ghost" size="sm" onClick={handleRestoreDefaults}>
                Restaurar padrões
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                Fechar
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

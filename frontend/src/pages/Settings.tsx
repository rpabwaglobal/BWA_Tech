import { useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { isSupervisorOrAdmin } from '@/lib/roles';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { PerfilTab } from '@/components/settings/PerfilTab';
import { GerenciamentoUsuarios } from '@/components/settings/GerenciamentoUsuarios';
import { GerenciamentoSetoresCargos } from '@/components/settings/GerenciamentoSetoresCargos';

const TABS = [
  { key: 'perfil' as const, label: 'Configurações do Perfil' },
  { key: 'usuarios' as const, label: 'Gerenciamento de Usuários' },
  { key: 'setores-cargos' as const, label: 'Gerenciamento de Setores e Cargos' },
];
type TabKey = (typeof TABS)[number]['key'];

export default function Settings() {
  const { user } = useAuth();
  const canManageUsers = isSupervisorOrAdmin(user);
  const [activeTab, setActiveTab] = useState<TabKey>(() => {
    const t = new URLSearchParams(window.location.search).get('tab');
    if (t === 'usuarios' || t === 'setores-cargos' || t === 'perfil') return t;
    return 'perfil';
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--color-foreground)]">
          Configurações
        </h1>
        <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
          {canManageUsers
            ? 'Gerencie seu perfil e os usuários da plataforma.'
            : 'Gerencie seu perfil e sua conta.'}
        </p>
      </div>

      {canManageUsers && (
        <div className="flex items-center gap-[8px] border-b border-[var(--color-border)]">
          {TABS.map((t) => (
            <Button
              key={t.key}
              variant="ghost"
              onClick={() => setActiveTab(t.key)}
              className={cn(
                'rounded-none border-b-2 border-transparent px-[16px] py-[8px] h-auto',
                activeTab === t.key
                  ? 'border-[var(--color-primary)] text-[var(--color-primary)] font-semibold'
                  : 'text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]',
              )}
            >
              {t.label}
            </Button>
          ))}
        </div>
      )}

      {!canManageUsers ? (
        <PerfilTab />
      ) : activeTab === 'usuarios' ? (
        <GerenciamentoUsuarios />
      ) : activeTab === 'setores-cargos' ? (
        <GerenciamentoSetoresCargos />
      ) : (
        <PerfilTab />
      )}
    </div>
  );
}

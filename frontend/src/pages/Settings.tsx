import { useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { abasVisiveisPara, type AbaConfiguracoesKey } from '@/lib/configuracoesAbas';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { GerenciamentoUsuarios } from '@/components/settings/GerenciamentoUsuarios';
import { GerenciamentoCargos } from '@/components/settings/GerenciamentoCargos';
import { GerenciamentoSetores } from '@/components/settings/GerenciamentoSetores';
import { GerenciamentoFeriados } from '@/components/settings/GerenciamentoFeriados';

/** Cada aba exige a permissão que a própria API cobra — quem só administra
 * setores não vê a aba de cargos, e vice-versa. O perfil saiu daqui: virou
 * página própria, acessível pela engrenagem no cabeçalho.
 *
 * A lista foi para `lib/configuracoesAbas` porque o menu lateral precisa da
 * MESMA resposta para decidir se mostra o item de Configurações. */
type TabKey = AbaConfiguracoesKey;

export default function Settings() {
  const { user } = useAuth();

  const visiveis = abasVisiveisPara(user);

  const [activeTab, setActiveTab] = useState<TabKey | null>(() => {
    const t = new URLSearchParams(window.location.search).get('tab');
    if (t === 'usuarios' || t === 'cargos' || t === 'setores' || t === 'feriados') return t;
    return null;
  });

  // Sem aba escolhida (ou apontando para uma que este usuário não acessa),
  // abre na primeira disponível.
  const abaAtual =
    visiveis.find((t) => t.key === activeTab)?.key ?? visiveis[0]?.key ?? null;

  if (visiveis.length === 0) {
    return (
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--color-foreground)]">
          Configurações
        </h1>
        <p className="text-sm text-[var(--color-muted-foreground)]">
          Você não tem permissão para gerenciar usuários, cargos, setores ou feriados. Suas configurações
          pessoais ficam na engrenagem, no canto superior direito.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--color-foreground)]">
          Configurações
        </h1>
        <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
          Gerencie os usuários, os cargos, os setores e os feriados da plataforma.
        </p>
      </div>

      <div className="flex items-center gap-[8px] border-b border-[var(--color-border)]">
        {visiveis.map((t) => (
          <Button
            key={t.key}
            variant="ghost"
            onClick={() => setActiveTab(t.key)}
            className={cn(
              'rounded-none border-b-2 border-transparent px-[16px] py-[8px] h-auto',
              abaAtual === t.key
                ? 'border-[var(--color-primary)] text-[var(--color-primary)] font-semibold'
                : 'text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]',
            )}
          >
            {t.label}
          </Button>
        ))}
      </div>

      {abaAtual === 'usuarios' && <GerenciamentoUsuarios />}
      {abaAtual === 'cargos' && <GerenciamentoCargos />}
      {abaAtual === 'setores' && <GerenciamentoSetores />}
      {abaAtual === 'feriados' && <GerenciamentoFeriados />}
    </div>
  );
}

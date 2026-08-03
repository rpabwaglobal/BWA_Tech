import { PerfilTab } from '@/components/settings/PerfilTab';

/** Configurações da própria conta. Saiu das abas de Configurações (que são de
 * gestão da plataforma) e virou página própria, aberta pela engrenagem no
 * cabeçalho — todo usuário tem acesso, inclusive visitante. */
export default function Perfil() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--color-foreground)]">
          Meu perfil
        </h1>
        <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
          Seus dados, sua senha e o código de recuperação da conta.
        </p>
      </div>

      <PerfilTab />
    </div>
  );
}

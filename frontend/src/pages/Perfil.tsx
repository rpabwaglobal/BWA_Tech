import { useEffect, useState } from 'react';
import { PerfilTab } from '@/components/settings/PerfilTab';
import { versaoService } from '@/services/versaoService';

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

      <VersaoDoSistema />
    </div>
  );
}

/** A versão do BWA Tech, no rodapé da página.
 *
 * Fica aqui, e não no menu ou no cabeçalho, porque a pergunta "qual versão está
 * no ar?" quase sempre aparece junto de outra: alguém vai reportar um problema
 * e precisa dizer em que versão viu. O perfil é a página que todo usuário
 * alcança, inclusive visitante.
 *
 * Some quando a API não responde: ver `versaoService.obter`.
 */
function VersaoDoSistema() {
  const [versao, setVersao] = useState('');

  useEffect(() => {
    let cancelado = false;
    void versaoService.obter().then((v) => {
      if (!cancelado) setVersao(v);
    });
    return () => {
      cancelado = true;
    };
  }, []);

  if (!versao) return null;

  return (
    // A margem NEGATIVA desconta o `space-y-6` do container da página.
    // O rodapé de versão não é uma seção como as outras — ele pertence
    // visualmente ao card acima. Com os 24px do container mais um padding
    // próprio, ficava um vão grande o bastante para parecer conteúdo faltando.
    <p className="-mt-[16px] text-center text-xs text-[var(--color-muted-foreground)]">
      BWA Tech · versão {versao}
    </p>
  );
}

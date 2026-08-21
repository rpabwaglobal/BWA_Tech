import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/** As três coisas que uma etapa de trabalho exige antes de receber um card. */
export type CampoObrigatorio = 'responsavel' | 'data_inicio' | 'data_fim';

/**
 * OS RÓTULOS SÃO OS DO FORMULÁRIO, letra por letra.
 *
 * A mensagem anterior dizia "desenvolvedor atribuído" e o campo no formulário se
 * chama "Responsável" — quem lia o aviso procurava um campo com outro nome. O
 * aviso existe para mandar a pessoa a um lugar; ele tem de usar a placa que está
 * pendurada lá.
 */
const CAMPOS: Record<CampoObrigatorio, { rotulo: string; ajuda: string }> = {
  responsavel: {
    rotulo: 'Responsável',
    ajuda: 'quem vai tocar o card',
  },
  data_inicio: {
    rotulo: 'Data e Hora de Início',
    ajuda: 'preenchida sozinha ao entrar em desenvolvimento',
  },
  data_fim: {
    rotulo: 'Data e Hora de Entrega',
    ajuda: 'o prazo combinado para a entrega',
  },
};

/**
 * O AVISO DE QUE FALTAM DADOS PARA MOVER O CARD.
 *
 * Antes isto era o diálogo genérico de "Atenção" — o mesmo usado por outras
 * quinze mensagens da tela —, com a lista dos campos escrita dentro de um
 * parágrafo, e ele abria AO MESMO TEMPO que o formulário do card. Dois problemas:
 *
 * 1. OS DOIS EM CIMA UM DO OUTRO. O aviso aparecia sobre o card já aberto, então
 *    o primeiro contato com a tela era um empilhamento. Agora o card só abre
 *    quando este diálogo sai — uma coisa de cada vez, na ordem em que se pensa
 *    nelas: primeiro o que falta, depois onde preencher.
 * 2. A LISTA ERA TEXTO CORRIDO ("1. Data de entrega"), numerada dentro de uma
 *    frase. O que a pessoa precisa levar daqui é UM campo, e ele tem de sair da
 *    tela com destaque — não diluído num parágrafo que também explica a regra.
 *
 * O DESTAQUE REPETE O DO FORMULÁRIO. O asterisco âmbar é o mesmo `RequiredMark`
 * que marca o campo lá dentro, e a borda âmbar é a mesma família do anel que
 * pisca no campo vazio. Quando o formulário abrir, a pessoa reconhece a marca em
 * vez de reprocurar.
 */
export function ModalDadosObrigatorios({
  aberto,
  etapa,
  campos,
  onPreencher,
}: {
  aberto: boolean;
  /** O nome da etapa de destino, como aparece na coluna. */
  etapa: string;
  campos: CampoObrigatorio[];
  /** Fecha o aviso E abre o formulário. É o único caminho de saída — inclusive
   *  o X e o Esc passam por aqui, porque o movimento do card já está pendente:
   *  sair sem preencher deixaria a pessoa sem nada na tela e sem entender por
   *  que o card voltou para a coluna de origem. */
  onPreencher: () => void;
}) {
  const umCampoSo = campos.length === 1;

  return (
    <Dialog open={aberto} onOpenChange={(v) => { if (!v) onPreencher(); }}>
      <DialogContent className="max-w-[520px]" onClose={onPreencher}>
        <DialogHeader>
          <DialogTitle>
            {umCampoSo ? 'Falta um dado para mover o card' : 'Faltam dados para mover o card'}
          </DialogTitle>
          <DialogDescription>
            {/* O NOME DA ETAPA ENTRA NA FRASE. "Esta etapa exige" obriga a pessoa
                a lembrar para onde arrastou; dizer o nome fecha a questão. */}
            A etapa <span className="font-semibold text-[var(--color-foreground)]">{etapa}</span>{' '}
            só recebe cards com {umCampoSo ? 'este campo preenchido' : 'estes campos preenchidos'}:
          </DialogDescription>
        </DialogHeader>

        <ul className="mt-[4px] flex flex-col gap-[8px]">
          {campos.map((chave) => (
            <li
              key={chave}
              className="flex items-start gap-[10px] rounded-[8px] border border-[#C79200]/45 bg-[#C79200]/8 px-[14px] py-[11px]"
            >
              <span
                aria-hidden
                className="mt-[1px] text-[1.2em] font-bold leading-none text-[#C79200]"
              >
                *
              </span>
              <span className="min-w-0">
                <span className="block font-semibold text-[var(--color-foreground)]">
                  {CAMPOS[chave].rotulo}
                </span>
                <span className="mt-[1px] block text-sm text-[var(--color-muted-foreground)]">
                  {CAMPOS[chave].ajuda}
                </span>
              </span>
            </li>
          ))}
        </ul>

        <p className="mt-[10px] text-sm text-[var(--color-muted-foreground)]">
          {/* Diz o que vai acontecer, e não o que o botão é. A pessoa precisa
              saber que o card NÃO ficou parado no meio do caminho. */}
          O card continua em sua etapa atual até você preencher e salvar. No
          formulário, {umCampoSo ? 'o campo aparece destacado' : 'os campos aparecem destacados'}.
        </p>

        <DialogFooter>
          <Button type="button" onClick={onPreencher}>
            Preencher agora
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ExternalLink, Loader2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { DateTimePicker } from '@/components/ui/datetime-picker';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { getRoleColor, getRoleLabel } from '@/components/ui/user-select';
import {
  type Card as CardType, CARD_AREAS, CARD_TYPES, CARD_PRIORITIES, CARD_STATUSES,
} from '@/services/cardService';
import { normalizeExternalUrl } from '@/lib/utils';
import { ROUTES } from '@/routes';

/**
 * O CARD ABERTO PARA LEITURA, com o caminho para editá-lo onde se edita.
 *
 * Nasceu como 221 linhas dentro de `Priorities.tsx`. Virou componente quando a
 * tela de Score precisou do mesmo modal: duplicar um formulário desse tamanho é
 * exatamente o padrão que este projeto já paga caro — quadros e painéis que
 * divergem sem ninguém ter decidido isso, porque ninguém abre os dois lado a
 * lado para notar.
 *
 * TODO CAMPO É `disabled`, e isso é a feature. Este modal existe para MOSTRAR o
 * card no contexto de outra tela (a reunião diária, a atribuição de score), onde
 * editar não faz sentido e salvar sem querer faria estrago. Quem quer editar vai
 * para o quadro do projeto, e é o que o botão do rodapé faz.
 *
 * O BOTÃO ABRE O CARD, não a página do projeto. Antes ele navegava para
 * `/projeto/:id` e deixava a pessoa procurando o card no quadro. A rota
 * `/projeto/:id/card/:cardId` já existia e o `ProjectDetails` já a trata na
 * entrada — era só usá-la.
 *
 * NÃO RECEBE A LISTA DE USUÁRIOS. O responsável é mostrado a partir do que o
 * próprio card carrega (`responsavel_name` e `responsavel_role`). Um
 * `UserSelect` desabilitado obrigaria toda tela que use este modal a buscar a
 * lista inteira de usuários para exibir um nome que já estava em mãos.
 */
export function VerCardModal({
  aberto,
  onClose,
  card,
  carregando = false,
}: {
  aberto: boolean;
  onClose: () => void;
  /** `null` enquanto carrega. */
  card: CardType | null;
  carregando?: boolean;
}) {
  const navigate = useNavigate();

  // Os mesmos campos que o formulário de edição usa, derivados do card em vez
  // de virem de um estado que o pai tenha de preencher e manter em dia.
  const dados = useMemo(() => ({
    nome: card?.nome || '',
    descricao: card?.descricao || '',
    script_url: card?.script_url || '',
    area: card?.area || 'backend',
    tipo: card?.tipo || 'feature',
    prioridade: card?.prioridade || 'media',
    status: card?.status || 'a_desenvolver',
    responsavel: card?.responsavel || '',
    data_inicio: card?.data_inicio || '',
    data_fim: card?.data_fim || '',
  }), [card]);

  return (
  <Dialog open={aberto} onOpenChange={(v) => { if (!v) onClose(); }}>
    <DialogContent onClose={onClose} className="max-w-[600px]">
      <DialogHeader>
        <DialogTitle>Ver Card</DialogTitle>
        <DialogDescription>
          Visualize as informações do card (somente visualização)
        </DialogDescription>
      </DialogHeader>

      {carregando ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-8 w-8 animate-spin text-[var(--color-primary)]" />
        </div>
      ) : (
        <form className="space-y-[16px] mt-[16px] max-h-[70vh] overflow-y-auto pr-[8px]">
          <div className="space-y-[8px]">
            <Label htmlFor="card-nome">Nome do Card *</Label>
            <Input
              id="card-nome"
              placeholder="Ex: Certidões PE"
              value={dados.nome}
              onChange={() => {}}
              required
              disabled={true}
            />
          </div>

          <div className="space-y-[8px]">
            <Label htmlFor="card-descricao">Descrição / Instruções</Label>
            <Textarea
              id="card-descricao"
              placeholder="Descreva o card, instruções detalhadas, requisitos, etc..."
              value={dados.descricao}
              onChange={() => {}}
              rows={4}
              disabled={true}
            />
          </div>

          <div className="space-y-[8px] rounded-lg border border-[var(--color-border)] p-[12px]">
            <div className="space-y-[6px]">
              <Label>Link do Script</Label>
              {dados.script_url ? (
                <a
                  href={normalizeExternalUrl(dados.script_url)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-[6px] rounded-md bg-[var(--color-accent)] px-[10px] py-[6px] text-sm text-[var(--color-primary)] underline underline-offset-2 hover:opacity-75 break-all"
                >
                  <ExternalLink className="h-[13px] w-[13px] shrink-0" />
                  {dados.script_url}
                </a>
              ) : (
                <p className="text-xs text-[var(--color-muted-foreground)]">Sem script.</p>
              )}
            </div>

            {card?.links && card.links.length > 0 && (
              <>
                <div className="border-t border-[var(--color-border)]" />
                <div className="space-y-[6px]">
                  <Label>Links adicionais</Label>
                  <div className="space-y-[4px]">
                    {card.links.map((link, idx) => (
                      <a
                        key={idx}
                        href={normalizeExternalUrl(link.url)}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={link.url}
                        className="flex items-center gap-[6px] rounded-md bg-[var(--color-accent)] px-[10px] py-[6px] text-sm text-[var(--color-primary)] underline underline-offset-2 hover:opacity-75"
                      >
                        <ExternalLink className="h-[13px] w-[13px] shrink-0" />
                        <span className="flex-1 truncate">{link.label.trim() ? link.label : link.url}</span>
                      </a>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="grid grid-cols-2 gap-[16px]">
            <div className="space-y-[8px]">
              <Label htmlFor="card-area">Área *</Label>
              <select
                id="card-area"
                className="flex h-[40px] w-full rounded-[8px] border border-[var(--color-input)] bg-[var(--color-background)] px-[12px] py-[8px] text-sm ring-offset-[var(--color-background)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
                value={dados.area}
                onChange={() => {}}
                required
                disabled={true}
              >
                {CARD_AREAS.map((area) => (
                  <option key={area.value} value={area.value}>{area.label}</option>
                ))}
              </select>
            </div>

            <div className="space-y-[8px]">
              <Label htmlFor="card-tipo">Tipo *</Label>
              <select
                id="card-tipo"
                className="flex h-[40px] w-full rounded-[8px] border border-[var(--color-input)] bg-[var(--color-background)] px-[12px] py-[8px] text-sm ring-offset-[var(--color-background)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
                value={dados.tipo}
                onChange={() => {}}
                required
                disabled={true}
              >
                {CARD_TYPES.map((tipo) => (
                  <option key={tipo.value} value={tipo.value}>{tipo.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-[16px]">
            <div className="space-y-[8px]">
              <Label htmlFor="card-prioridade">Prioridade *</Label>
              <select
                id="card-prioridade"
                className="flex h-[40px] w-full rounded-[8px] border border-[var(--color-input)] bg-[var(--color-background)] px-[12px] py-[8px] text-sm ring-offset-[var(--color-background)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
                value={dados.prioridade}
                onChange={() => {}}
                required
                disabled={true}
              >
                {CARD_PRIORITIES.map((prioridade) => (
                  <option key={prioridade.value} value={prioridade.value}>{prioridade.label}</option>
                ))}
              </select>
            </div>

            <div className="space-y-[8px]">
              <Label htmlFor="card-status">Status *</Label>
              <select
                id="card-status"
                className="flex h-[40px] w-full rounded-[8px] border border-[var(--color-input)] bg-[var(--color-background)] px-[12px] py-[8px] text-sm ring-offset-[var(--color-background)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
                value={dados.status}
                onChange={() => {}}
                required
                disabled={true}
              >
                {CARD_STATUSES.map((status) => (
                  <option key={status.value} value={status.value}>{status.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-[8px]">
            <Label htmlFor="card-responsavel">Responsável</Label>
            <div className="flex h-[40px] items-center gap-[8px] rounded-[8px] border border-[var(--color-input)] bg-[var(--color-background)] px-[12px] text-sm opacity-50">
              {card?.responsavel_role && (
                <Badge
                  variant="secondary"
                  className={`shrink-0 whitespace-nowrap text-[10px] px-[6px] py-[2px] rounded-full ${getRoleColor(card.responsavel_role)}`}
                >
                  {getRoleLabel(card.responsavel_role)}
                </Badge>
              )}
              <span className="truncate">
                {card?.responsavel_name || 'Não atribuído'}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-[16px]">
            <div className="space-y-[8px]">
              <Label htmlFor="card-data_inicio">Data e Hora de Início</Label>
              <DateTimePicker
                id="card-data_inicio"
                value={dados.data_inicio}
                onChange={() => {}}
                disabled={true}
              />
              <p className="text-xs text-[var(--color-muted-foreground)]">
                Preenchida automaticamente com a data e hora atual
              </p>
            </div>

            <div className="space-y-[8px]">
              <Label htmlFor="card-data_fim">Data e Hora de Entrega</Label>
              <DateTimePicker
                id="card-data_fim"
                value={dados.data_fim}
                onChange={() => {}}
                disabled={true}
              />
            </div>
          </div>

          <DialogFooter>
            <Button 
              type="button" 
              variant="outline" 
              onClick={onClose}
            >
              Fechar
            </Button>
            {card?.projeto && (
              <Button 
                type="button"
                onClick={() => {
                  onClose();
                  navigate(ROUTES.projetoCard(
                    String(card.projeto), String(card.id)));
                }}
              >
                Ir para o card no projeto
              </Button>
            )}
          </DialogFooter>
        </form>
      )}
    </DialogContent>
  </Dialog>
  );
}

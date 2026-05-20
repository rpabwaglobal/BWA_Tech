import { Calendar } from 'lucide-react';
import { PRIORITY_HEX, PRIORITY_LABEL, type DemoKanbanCard } from './demoData';

/** Replica o KanbanCard real com showPriorityColorsOnCards=true:
 * fundo pastel da prioridade + texto preto + badges com cor própria. */
export default function DemoCard({
  card,
  className,
  style,
}: {
  card: DemoKanbanCard;
  className?: string;
  style?: React.CSSProperties;
}) {
  const priorityColor = PRIORITY_HEX[card.prioridade];
  return (
    <div
      className={
        'p-[8px] rounded-[6px] border-l-[3px] shadow-sm ' + (className ?? '')
      }
      style={{
        backgroundColor: priorityColor,
        borderLeftColor: priorityColor,
        borderLeftStyle: 'solid',
        ...style,
      }}
    >
      <div className="flex items-start gap-[4px]">
        <span className="text-[10px] font-semibold text-black truncate flex-1 leading-tight">
          {card.nome}
        </span>
      </div>

      {card.data_fim && (
        <div className="flex items-center gap-[3px] mt-[4px] text-[9px] text-black/70">
          <Calendar className="h-[9px] w-[9px]" />
          {card.data_fim}
        </div>
      )}

      <div className="flex flex-wrap gap-[3px] mt-[4px]">
        {card.area_display && (
          <span className={'text-[8px] font-semibold px-[5px] py-[1px] rounded-full ' + card.area_color}>
            {card.area_display}
          </span>
        )}
        {card.tipo_display && (
          <span className="text-[8px] font-medium px-[5px] py-[1px] rounded-full bg-gray-100 text-gray-800">
            {card.tipo_display}
          </span>
        )}
      </div>

      {card.descricao && (
        <p className="mt-[4px] text-[8px] text-black/75 line-clamp-2 leading-tight">
          {card.descricao}
        </p>
      )}

      <div className="flex items-center justify-between mt-[6px] gap-[4px]">
        <div className="flex items-center gap-[3px] min-w-0 flex-1">
          {card.responsavel_initials && (
            <div className="h-[14px] w-[14px] rounded-full bg-[var(--color-primary)] text-white text-[7px] font-bold flex items-center justify-center shrink-0">
              {card.responsavel_initials}
            </div>
          )}
          {card.responsavel_name && (
            <span className="text-[8px] text-black/80 truncate font-medium">
              {card.responsavel_name}
            </span>
          )}
        </div>
        <span className="text-[7px] font-bold px-[4px] py-[1px] rounded-full bg-gray-100 text-gray-800 shrink-0">
          {PRIORITY_LABEL[card.prioridade]}
        </span>
      </div>
    </div>
  );
}

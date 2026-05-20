import * as React from "react";
import { Calendar, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export interface DateRangePickerProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange'> {
  startValue?: string; // YYYY-MM-DD or YYYY-MM-DDTHH:mm
  endValue?: string;
  onStartChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onEndChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  /** Só envia YYYY-MM-DD (sem hora). Esconde seletores de hora — alinhado ao backend que usa só a data. */
  dateOnly?: boolean;
  dialogTitle?: string;
}

// Converte YYYY-MM-DDTHH:mm para DD/MM/YYYY HH:mm
const formatToDisplay = (isoDateTime: string): string => {
  if (!isoDateTime) return '';
  const [datePart, timePart] = isoDateTime.split('T');
  if (!datePart) return '';
  
  const [year, month, day] = datePart.split('-');
  const dateStr = `${day}/${month}/${year}`;
  
  if (timePart) {
    const [hours, minutes] = timePart.split(':');
    return `${dateStr} ${hours}:${minutes}`;
  }
  return dateStr;
};

// Converte Date para YYYY-MM-DDTHH:mm
const formatToISO = (date: Date, time: { hours: number; minutes: number }): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(time.hours).padStart(2, '0');
  const minutes = String(time.minutes).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
};

// Converte YYYY-MM-DDTHH:mm para Date
const parseISO = (isoDateTime: string): Date | null => {
  if (!isoDateTime) return null;
  const [datePart] = isoDateTime.split('T');
  if (!datePart) return null;
  
  const [year, month, day] = datePart.split('-').map(Number);
  return new Date(year, month - 1, day);
};

// Extrai hora de YYYY-MM-DDTHH:mm
const extractTime = (isoDateTime: string): { hours: number; minutes: number } => {
  if (!isoDateTime) return { hours: 0, minutes: 0 };
  const [, timePart] = isoDateTime.split('T');
  if (!timePart) return { hours: 0, minutes: 0 };
  
  const [hours, minutes] = timePart.split(':').map(Number);
  return { hours: hours || 0, minutes: minutes || 0 };
};

const toYmd = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const DateRangePicker = React.forwardRef<HTMLInputElement, DateRangePickerProps>(
  (
    {
      className,
      startValue = '',
      endValue = '',
      onStartChange,
      onEndChange,
      disabled,
      dateOnly = false,
      dialogTitle,
      ...props
    },
    ref,
  ) => {
    const [isOpen, setIsOpen] = React.useState(false);
    const [startDate, setStartDate] = React.useState<Date | null>(() => parseISO(startValue));
    const [endDate, setEndDate] = React.useState<Date | null>(() => parseISO(endValue));
    const [hoverDate, setHoverDate] = React.useState<Date | null>(null);
    const [startTime, setStartTime] = React.useState<{ hours: number; minutes: number }>(() => {
      if (startValue) {
        return extractTime(startValue);
      }
      // Se não tem valor, usar hora atual
      const now = new Date();
      return { hours: now.getHours(), minutes: now.getMinutes() };
    });
    const [endTime, setEndTime] = React.useState<{ hours: number; minutes: number }>(() => {
      if (endValue) {
        return extractTime(endValue);
      }
      // Se não tem valor, usar 18:00 por padrão
      return { hours: 18, minutes: 0 };
    });
    const [currentMonth, setCurrentMonth] = React.useState(new Date());
    const [selectingStart, setSelectingStart] = React.useState(true); // true = selecionando início, false = selecionando fim
    
    // Atualiza quando valores externos mudam
    React.useEffect(() => {
      const parsedStart = parseISO(startValue);
      const parsedEnd = parseISO(endValue);
      if (parsedStart) {
        setStartDate(parsedStart);
        setStartTime(extractTime(startValue));
      } else {
        // Se não tem valor, usar hora atual
        const now = new Date();
        setStartTime({ hours: now.getHours(), minutes: now.getMinutes() });
      }
      if (parsedEnd) {
        setEndDate(parsedEnd);
        setEndTime(extractTime(endValue));
      } else {
        // Se não tem valor, usar 18:00 por padrão
        setEndTime({ hours: 18, minutes: 0 });
      }
    }, [startValue, endValue]);
    
    // Quando abrir o modal, resetar hover e atualizar horários padrão
    React.useEffect(() => {
      if (isOpen) {
        setHoverDate(null);
        // Se não tem início, começar selecionando início
        if (!startDate) {
          setSelectingStart(true);
          // Atualizar hora de início para hora atual se não tem valor
          if (!startValue) {
            const now = new Date();
            setStartTime({ hours: now.getHours(), minutes: now.getMinutes() });
          }
        } else if (!endDate) {
          setSelectingStart(false);
        }
        // Atualizar hora de fim para 18:00 se não tem valor
        if (!endValue) {
          setEndTime({ hours: 18, minutes: 0 });
        }
      }
    }, [isOpen, startDate, endDate, startValue, endValue]);

    const handleConfirm = () => {
      if (!startDate || !endDate) {
        // Não permitir confirmar sem ambas as datas
        return;
      }
      
      // Se a data de início é depois da data de fim, trocar
      const start = new Date(startDate);
      const end = new Date(endDate);
      start.setHours(0, 0, 0, 0);
      end.setHours(0, 0, 0, 0);
      
      let finalStartDate = startDate;
      let finalEndDate = endDate;
      let finalStartTime = startTime;
      let finalEndTime = endTime;
      
      if (start > end) {
        // Trocar as datas
        finalStartDate = endDate;
        finalEndDate = startDate;
        finalStartTime = endTime;
        finalEndTime = startTime;
      }
      
      if (dateOnly) {
        onStartChange?.({
          target: { value: toYmd(finalStartDate) },
        } as React.ChangeEvent<HTMLInputElement>);
        onEndChange?.({
          target: { value: toYmd(finalEndDate) },
        } as React.ChangeEvent<HTMLInputElement>);
        setIsOpen(false);
        return;
      }

      const startIso = formatToISO(finalStartDate, finalStartTime);
      const endIso = formatToISO(finalEndDate, finalEndTime);

      onStartChange?.({ target: { value: startIso } } as React.ChangeEvent<HTMLInputElement>);
      onEndChange?.({ target: { value: endIso } } as React.ChangeEvent<HTMLInputElement>);

      setIsOpen(false);
    };

    const handleClear = () => {
      setStartDate(null);
      setEndDate(null);
      setHoverDate(null);
      setStartTime({ hours: 0, minutes: 0 });
      setEndTime({ hours: 0, minutes: 0 });
      onStartChange?.({ target: { value: '' } } as React.ChangeEvent<HTMLInputElement>);
      onEndChange?.({ target: { value: '' } } as React.ChangeEvent<HTMLInputElement>);
      setIsOpen(false);
    };

    // Calendário
    const getDaysInMonth = (date: Date) => {
      const year = date.getFullYear();
      const month = date.getMonth();
      const firstDay = new Date(year, month, 1);
      const lastDay = new Date(year, month + 1, 0);
      const daysInMonth = lastDay.getDate();
      const startingDayOfWeek = firstDay.getDay();
      
      const days: (number | null)[] = [];
      
      // Dias do mês anterior para preencher a primeira semana
      for (let i = 0; i < startingDayOfWeek; i++) {
        days.push(null);
      }
      
      // Dias do mês atual
      for (let i = 1; i <= daysInMonth; i++) {
        days.push(i);
      }
      
      return days;
    };

    const isToday = (day: number | null, month: Date) => {
      if (day === null) return false;
      const today = new Date();
      return (
        day === today.getDate() &&
        month.getMonth() === today.getMonth() &&
        month.getFullYear() === today.getFullYear()
      );
    };

    const isStartDate = (day: number | null, month: Date) => {
      if (day === null || !startDate) return false;
      return (
        day === startDate.getDate() &&
        month.getMonth() === startDate.getMonth() &&
        month.getFullYear() === startDate.getFullYear()
      );
    };

    const isEndDate = (day: number | null, month: Date) => {
      if (day === null || !endDate) return false;
      return (
        day === endDate.getDate() &&
        month.getMonth() === endDate.getMonth() &&
        month.getFullYear() === endDate.getFullYear()
      );
    };

    const isInRange = (day: number | null, month: Date) => {
      if (day === null) return false;
      
      const checkDate = new Date(month.getFullYear(), month.getMonth(), day);
      checkDate.setHours(0, 0, 0, 0);
      
      // Se ambas as datas estão selecionadas, verificar intervalo
      if (startDate && endDate) {
        const start = new Date(startDate);
        const end = new Date(endDate);
        start.setHours(0, 0, 0, 0);
        end.setHours(0, 0, 0, 0);
        
        // Garantir que start < end
        const actualStart = start < end ? start : end;
        const actualEnd = start < end ? end : start;
        
        return checkDate > actualStart && checkDate < actualEnd;
      }
      
      // Se apenas início está selecionado e há hover, mostrar preview
      if (startDate && hoverDate && !endDate) {
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        const hover = new Date(hoverDate);
        hover.setHours(0, 0, 0, 0);
        
        // Garantir que start < hover
        const actualStart = start < hover ? start : hover;
        const actualEnd = start < hover ? hover : start;
        
        return checkDate > actualStart && checkDate < actualEnd;
      }
      
      return false;
    };

    const handleDayClick = (day: number) => {
      const clickedDate = new Date(currentMonth);
      clickedDate.setDate(day);
      clickedDate.setHours(0, 0, 0, 0);
      
      if (selectingStart || !startDate) {
        // Selecionar início
        setStartDate(clickedDate);
        setSelectingStart(false); // Próximo clique será fim
        setHoverDate(null);
        // Se não tem hora de início definida ou é a primeira seleção, usar hora atual
        if (!startValue || (startTime.hours === 0 && startTime.minutes === 0)) {
          const now = new Date();
          setStartTime({ hours: now.getHours(), minutes: now.getMinutes() });
        }
      } else {
        // Selecionar fim
        setEndDate(clickedDate);
        setHoverDate(null);
        // Se não tem hora de fim definida, usar 18:00
        if (!endValue || (endTime.hours === 0 && endTime.minutes === 0)) {
          setEndTime({ hours: 18, minutes: 0 });
        }
        // Se ambas estão selecionadas, pode clicar novamente para resetar e começar novo intervalo
        if (startDate && endDate) {
          setStartDate(clickedDate);
          setEndDate(null);
          setSelectingStart(false);
          // Resetar hora de início para hora atual
          const now = new Date();
          setStartTime({ hours: now.getHours(), minutes: now.getMinutes() });
          setEndTime({ hours: 18, minutes: 0 });
        }
      }
    };

    const handleDayHover = (day: number | null) => {
      if (day === null) {
        setHoverDate(null);
        return;
      }
      
      // Só mostrar hover se já tem início selecionado e ainda não tem fim
      if (startDate && !endDate) {
        const hoveredDate = new Date(currentMonth);
        hoveredDate.setDate(day);
        hoveredDate.setHours(0, 0, 0, 0);
        setHoverDate(hoveredDate);
      } else {
        setHoverDate(null);
      }
    };

    const monthNames = [
      'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
      'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
    ];

    const weekDays = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

    const navigateMonth = (direction: 'prev' | 'next') => {
      const newMonth = new Date(currentMonth);
      if (direction === 'prev') {
        newMonth.setMonth(newMonth.getMonth() - 1);
      } else {
        newMonth.setMonth(newMonth.getMonth() + 1);
      }
      setCurrentMonth(newMonth);
    };

    const goToToday = () => {
      const today = new Date();
      setCurrentMonth(today);
    };

    const startDisplay = formatToDisplay(startValue);
    const endDisplay = formatToDisplay(endValue);

    return (
      <>
        <div className="relative">
          <input
            type="text"
            readOnly
            placeholder="Clique para selecionar intervalo de datas"
            className={cn(
              "flex h-[40px] w-full rounded-[8px] border border-[var(--color-input)] bg-[var(--color-background)] px-[16px] pr-[80px] py-[8px] text-sm ring-offset-background",
              "placeholder:text-[var(--color-muted-foreground)]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] focus-visible:ring-offset-2",
              "disabled:cursor-not-allowed disabled:opacity-50",
              "cursor-pointer",
              !startDisplay && !endDisplay && "text-[var(--color-muted-foreground)]",
              (startDisplay || endDisplay) && "text-[var(--color-foreground)]",
              className
            )}
            value={startDisplay && endDisplay ? `${startDisplay} - ${endDisplay}` : startDisplay || endDisplay || ''}
            onClick={() => !disabled && setIsOpen(true)}
            disabled={disabled}
            {...props}
          />
          <button
            type="button"
            onClick={() => !disabled && setIsOpen(true)}
            disabled={disabled}
            className="absolute right-[12px] top-1/2 -translate-y-1/2 text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] transition-colors disabled:opacity-50"
            title="Escolher intervalo de datas"
          >
            <Calendar className="h-[20px] w-[20px]" />
          </button>
        </div>

        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogContent className="max-w-[500px] p-0" onClose={() => setIsOpen(false)}>
            <DialogHeader className="p-6 pb-4">
              <DialogTitle>{dialogTitle ?? 'Selecionar intervalo de datas'}</DialogTitle>
            </DialogHeader>

            <div className="p-6 pt-0 space-y-6">
              {/* Calendário */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => navigateMonth('prev')}
                    className="h-8 w-8 p-0"
                  >
                    ←
                  </Button>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-[var(--color-foreground)]">
                      {monthNames[currentMonth.getMonth()]} {currentMonth.getFullYear()}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={goToToday}
                      className="h-7 px-2 text-xs"
                    >
                      Hoje
                    </Button>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => navigateMonth('next')}
                    className="h-8 w-8 p-0"
                  >
                    →
                  </Button>
                </div>

                <div className="grid grid-cols-7 gap-1">
                  {weekDays.map((day) => (
                    <div
                      key={day}
                      className="text-center text-xs font-medium text-[var(--color-muted-foreground)] py-2"
                    >
                      {day}
                    </div>
                  ))}
                  {getDaysInMonth(currentMonth).map((day, index) => (
                    <button
                      key={index}
                      type="button"
                      onClick={() => day !== null && handleDayClick(day)}
                      onMouseEnter={() => handleDayHover(day)}
                      onMouseLeave={() => handleDayHover(null)}
                      disabled={day === null}
                      className={cn(
                        "h-9 w-9 rounded-[8px] text-sm transition-colors",
                        day === null && "cursor-default",
                        day !== null && "hover:bg-[var(--color-accent)]",
                        // Data de hoje
                        isToday(day, currentMonth) && "bg-green-100 text-green-700 font-semibold",
                        // Data de início (cor primária)
                        isStartDate(day, currentMonth) && "bg-[var(--color-primary)] text-[var(--color-primary-foreground)] font-semibold hover:opacity-90",
                        // Data de fim (cor primária)
                        isEndDate(day, currentMonth) && !isStartDate(day, currentMonth) && "bg-[var(--color-primary)] text-[var(--color-primary-foreground)] font-semibold hover:opacity-90",
                        // Datas no intervalo (cor primária suave)
                        isInRange(day, currentMonth) && !isStartDate(day, currentMonth) && !isEndDate(day, currentMonth) && "bg-[var(--color-accent)] text-[var(--color-accent-foreground)]",
                        // Outras datas
                        !isStartDate(day, currentMonth) && !isEndDate(day, currentMonth) && !isToday(day, currentMonth) && !isInRange(day, currentMonth) && "text-[var(--color-foreground)]"
                      )}
                    >
                      {day}
                    </button>
                  ))}
                </div>
                
                {/* Instruções */}
                <div className="text-xs text-[var(--color-muted-foreground)] text-center pt-2 border-t border-[var(--color-border)]">
                  {!startDate && "Clique na data de início da sprint"}
                  {startDate && !endDate && "Clique na data de fim da sprint"}
                  {startDate && endDate && "Intervalo selecionado. Clique em uma nova data para redefinir."}
                </div>
              </div>

              {/* Seletores de Hora (omitidos em dateOnly: o backend da sprint usa só calendário) */}
              {!dateOnly && (
              <div className="space-y-4">
                <div className="text-sm font-medium text-[var(--color-foreground)]">
                  Horários
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  {/* Hora de Início */}
                  <div className="space-y-2">
                    <label className="text-xs text-[var(--color-muted-foreground)]">
                      Início
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min="0"
                        max="23"
                        value={startTime.hours}
                        onChange={(e) => {
                          const hours = Math.max(0, Math.min(23, parseInt(e.target.value) || 0));
                          setStartTime({ ...startTime, hours });
                        }}
                        className="flex-1 h-8 rounded-[8px] border border-[var(--color-input)] bg-[var(--color-background)] px-3 text-center text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
                        placeholder="00"
                      />
                      <span className="text-sm font-semibold">:</span>
                      <input
                        type="number"
                        min="0"
                        max="59"
                        value={startTime.minutes}
                        onChange={(e) => {
                          const minutes = Math.max(0, Math.min(59, parseInt(e.target.value) || 0));
                          setStartTime({ ...startTime, minutes });
                        }}
                        className="flex-1 h-8 rounded-[8px] border border-[var(--color-input)] bg-[var(--color-background)] px-3 text-center text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
                        placeholder="00"
                      />
                    </div>
                  </div>
                  
                  {/* Hora de Fim */}
                  <div className="space-y-2">
                    <label className="text-xs text-[var(--color-muted-foreground)]">
                      Fim
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min="0"
                        max="23"
                        value={endTime.hours}
                        onChange={(e) => {
                          const hours = Math.max(0, Math.min(23, parseInt(e.target.value) || 0));
                          setEndTime({ ...endTime, hours });
                        }}
                        className="flex-1 h-8 rounded-[8px] border border-[var(--color-input)] bg-[var(--color-background)] px-3 text-center text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
                        placeholder="00"
                      />
                      <span className="text-sm font-semibold">:</span>
                      <input
                        type="number"
                        min="0"
                        max="59"
                        value={endTime.minutes}
                        onChange={(e) => {
                          const minutes = Math.max(0, Math.min(59, parseInt(e.target.value) || 0));
                          setEndTime({ ...endTime, minutes });
                        }}
                        className="flex-1 h-8 rounded-[8px] border border-[var(--color-input)] bg-[var(--color-background)] px-3 text-center text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
                        placeholder="00"
                      />
                    </div>
                  </div>
                </div>
              </div>
              )}

              {/* Botões de ação */}
              <div className="flex items-center justify-between gap-3 pt-4 border-t border-[var(--color-border)]">
                <Button
                  variant="outline"
                  onClick={handleClear}
                  className="flex-1"
                >
                  Limpar
                </Button>
                <Button
                  onClick={handleConfirm}
                  className="flex-1"
                  disabled={!startDate || !endDate}
                >
                  Confirmar
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </>
    );
  }
);

DateRangePicker.displayName = "DateRangePicker";

export { DateRangePicker };

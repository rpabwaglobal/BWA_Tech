import * as React from "react";
import { Calendar, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export interface DateTimePickerProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange'> {
  value?: string; // YYYY-MM-DDTHH:mm format
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  suggestedDate?: string; // YYYY-MM-DDTHH:mm format - Data sugerida baseada em dias úteis
  /** Título do diálogo (calendário + hora). */
  pickerTitle?: string;
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
const formatToISO = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
};

// Converte YYYY-MM-DDTHH:mm para Date
const parseISO = (isoDateTime: string): Date | null => {
  if (!isoDateTime) return null;
  const [datePart, timePart] = isoDateTime.split('T');
  if (!datePart) return null;
  
  const [year, month, day] = datePart.split('-').map(Number);
  let hours = 0;
  let minutes = 0;
  
  if (timePart) {
    const [h, m] = timePart.split(':').map(Number);
    hours = h || 0;
    minutes = m || 0;
  }
  
  return new Date(year, month - 1, day, hours, minutes);
};

const DateTimePicker = React.forwardRef<HTMLInputElement, DateTimePickerProps>(
  ({ className, value = '', onChange, disabled, suggestedDate, pickerTitle = 'Selecionar data e hora', ...props }, ref) => {
    const [isOpen, setIsOpen] = React.useState(false);
    const [selectedDate, setSelectedDate] = React.useState<Date | null>(() => {
      const parsed = parseISO(value);
      if (parsed) return parsed;
      // Não selecionar nenhuma data por padrão
      return null;
    });
    const [selectedTime, setSelectedTime] = React.useState<{ hours: number; minutes: number }>(() => {
      const parsed = parseISO(value);
      if (parsed) {
        return { hours: parsed.getHours(), minutes: parsed.getMinutes() };
      }
      // Se não tem valor, usar hora padrão 18:00
      return { hours: 18, minutes: 0 };
    });
    const [currentMonth, setCurrentMonth] = React.useState(new Date());
    
    // Parse da data sugerida
    const suggestedDateObj = suggestedDate ? parseISO(suggestedDate) : null;

    // Atualiza quando value muda externamente
    React.useEffect(() => {
      const parsed = parseISO(value);
      if (parsed) {
        setSelectedDate(parsed);
        setSelectedTime({ hours: parsed.getHours(), minutes: parsed.getMinutes() });
      } else {
        // Se não tem valor, usar data de hoje e hora 18:00
        const today = new Date();
        setSelectedDate(today);
        setSelectedTime({ hours: 18, minutes: 0 });
      }
    }, [value]);
    
    // Quando abrir o modal, se não tiver valor, não selecionar data mas usar hora 18:00
    React.useEffect(() => {
      if (isOpen && !value) {
        setSelectedDate(null);
        setSelectedTime({ hours: 18, minutes: 0 });
      }
    }, [isOpen, value]);

    const handleConfirm = () => {
      if (!selectedDate) {
        // Se não há data selecionada, usar a data de hoje
        const today = new Date();
        today.setHours(selectedTime.hours, selectedTime.minutes, 0, 0);
        const isoValue = formatToISO(today);
        
        const syntheticEvent = {
          target: {
            value: isoValue,
          },
        } as React.ChangeEvent<HTMLInputElement>;
        
        onChange?.(syntheticEvent);
        setIsOpen(false);
        return;
      }
      
      const date = new Date(selectedDate);
      date.setHours(selectedTime.hours, selectedTime.minutes, 0, 0);
      const isoValue = formatToISO(date);
      
      const syntheticEvent = {
        target: {
          value: isoValue,
        },
      } as React.ChangeEvent<HTMLInputElement>;
      
      onChange?.(syntheticEvent);
      setIsOpen(false);
    };

    const handleClear = () => {
      const syntheticEvent = {
        target: {
          value: '',
        },
      } as React.ChangeEvent<HTMLInputElement>;
      
      onChange?.(syntheticEvent);
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

    const isSelected = (day: number | null, month: Date) => {
      if (day === null || !selectedDate) return false;
      return (
        day === selectedDate.getDate() &&
        month.getMonth() === selectedDate.getMonth() &&
        month.getFullYear() === selectedDate.getFullYear()
      );
    };

    const isSuggested = (day: number | null, month: Date) => {
      if (day === null || !suggestedDateObj) return false;
      return (
        day === suggestedDateObj.getDate() &&
        month.getMonth() === suggestedDateObj.getMonth() &&
        month.getFullYear() === suggestedDateObj.getFullYear()
      );
    };

    const isInRange = (day: number | null, month: Date) => {
      if (day === null) return false;
      
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      // Data do dia sendo verificado
      const checkDate = new Date(month.getFullYear(), month.getMonth(), day);
      checkDate.setHours(0, 0, 0, 0);
      
      // Se a data verificada é hoje ou antes, não está no intervalo
      if (checkDate <= today) return false;
      
      // Data final do intervalo (sugerida ou selecionada)
      let endDate: Date | null = null;
      
      // Se há uma data selecionada e ela é futura, usar ela
      if (selectedDate) {
        const selectedDateOnly = new Date(selectedDate);
        selectedDateOnly.setHours(0, 0, 0, 0);
        if (selectedDateOnly >= today) {
          endDate = selectedDateOnly;
        }
      }
      
      // Se não há data selecionada ou a selecionada não é futura, usar a sugerida
      if (!endDate && suggestedDateObj) {
        const suggestedDateOnly = new Date(suggestedDateObj);
        suggestedDateOnly.setHours(0, 0, 0, 0);
        if (suggestedDateOnly > today) {
          endDate = suggestedDateOnly;
        }
      }
      
      // Se não há data final, não está no intervalo
      if (!endDate) return false;
      
      // Verificar se está no intervalo (hoje até a data final, excluindo hoje e a data final)
      return checkDate > today && checkDate < endDate;
    };

    const handleDayClick = (day: number) => {
      const newDate = new Date(currentMonth);
      newDate.setDate(day);
      setSelectedDate(newDate);
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
      setSelectedDate(today);
      setSelectedTime({ hours: today.getHours(), minutes: today.getMinutes() });
    };

    const displayValue = formatToDisplay(value);

    return (
      <>
        <div className="relative">
          <input
            type="text"
            readOnly
            placeholder="Clique para selecionar data e hora"
            className={cn(
              'flex h-[42px] w-full rounded-[10px] border border-[var(--color-input)] bg-[var(--color-card)] px-[14px] pr-[80px] py-[8px] text-sm shadow-sm ring-offset-[var(--color-background)] transition-[box-shadow,border-color]',
              'placeholder:text-[var(--color-muted-foreground)]',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-background)]',
              'hover:border-[var(--color-muted-foreground)]/35',
              'disabled:cursor-not-allowed disabled:opacity-50',
              'cursor-pointer',
              !displayValue && 'text-[var(--color-muted-foreground)]',
              displayValue && 'text-[var(--color-foreground)] font-medium',
              className
            )}
            value={displayValue || ''}
            onClick={() => !disabled && setIsOpen(true)}
            disabled={disabled}
            {...props}
          />
          <button
            type="button"
            onClick={() => !disabled && setIsOpen(true)}
            disabled={disabled}
            className="absolute right-[12px] top-1/2 -translate-y-1/2 text-[var(--color-muted-foreground)] transition-colors hover:text-[var(--color-foreground)] disabled:opacity-50"
            title="Escolher data e hora"
          >
            <Calendar className="h-[20px] w-[20px] shrink-0" aria-hidden />
          </button>
        </div>

        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogContent
            className="flex max-h-[min(90dvh,640px)] max-w-[min(100vw-24px,520px)] flex-col gap-0 overflow-hidden rounded-[12px] border border-[var(--color-border)] bg-[var(--color-popover)] p-0 text-[var(--color-popover-foreground)] shadow-lg"
            onClose={() => setIsOpen(false)}
          >
            <DialogHeader className="shrink-0 border-b border-[var(--color-border)] bg-[var(--color-muted)]/25 px-5 py-3 sm:px-6 sm:py-4">
              <DialogTitle className="text-base font-semibold">{pickerTitle}</DialogTitle>
            </DialogHeader>

            <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-5 py-4 [-webkit-overflow-scrolling:touch] sm:px-6">
              <div className="space-y-4 pb-1">
                {/* Calendário */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => navigateMonth('prev')}
                      className="h-7 w-7 shrink-0 p-0"
                    >
                      ←
                    </Button>
                    <div className="flex min-w-0 flex-wrap items-center justify-center gap-1.5">
                      <span className="text-center text-sm font-semibold text-[var(--color-foreground)]">
                        {monthNames[currentMonth.getMonth()]} {currentMonth.getFullYear()}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={goToToday}
                        className="h-6 px-2 text-xs"
                      >
                        Hoje
                      </Button>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => navigateMonth('next')}
                      className="h-7 w-7 shrink-0 p-0"
                    >
                      →
                    </Button>
                  </div>

                  <div className="grid grid-cols-7 gap-0.5 sm:gap-1">
                    {weekDays.map((day) => (
                      <div
                        key={day}
                        className="py-1 text-center text-[10px] font-medium text-[var(--color-muted-foreground)] sm:text-xs"
                      >
                        {day}
                      </div>
                    ))}
                    {getDaysInMonth(currentMonth).map((day, index) => (
                      <button
                        key={index}
                        type="button"
                        onClick={() => day !== null && handleDayClick(day)}
                        disabled={day === null}
                        className={cn(
                          'h-7 w-7 rounded-[6px] text-xs transition-colors sm:h-8 sm:w-8 sm:rounded-[8px] sm:text-sm',
                          day === null && 'cursor-default',
                          day !== null && 'hover:bg-[var(--color-accent)]',
                          isSelected(day, currentMonth) &&
                            'bg-[var(--color-primary)] font-semibold text-[var(--color-primary-foreground)] shadow-sm hover:bg-[var(--color-primary)]/92',
                          isToday(day, currentMonth) &&
                            !isSelected(day, currentMonth) &&
                            'border border-emerald-500/45 bg-emerald-500/12 font-semibold text-emerald-900 dark:border-emerald-400/40 dark:bg-emerald-500/18 dark:text-emerald-100',
                          isSuggested(day, currentMonth) &&
                            !isSelected(day, currentMonth) &&
                            'border-2 border-[var(--color-primary)]/55 bg-[var(--color-primary)]/12 font-semibold text-[var(--color-foreground)]',
                          isInRange(day, currentMonth) &&
                            !isSelected(day, currentMonth) &&
                            !isSuggested(day, currentMonth) &&
                            !isToday(day, currentMonth) &&
                            'bg-[var(--color-muted)]/90 text-[var(--color-foreground)] dark:bg-[var(--color-muted)]/50',
                          !isSelected(day, currentMonth) &&
                            !isToday(day, currentMonth) &&
                            !isSuggested(day, currentMonth) &&
                            !isInRange(day, currentMonth) &&
                            day !== null &&
                            'text-[var(--color-foreground)]',
                        )}
                      >
                        {day}
                      </button>
                    ))}
                  </div>

                  {/* Legenda */}
                  <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1.5 border-t border-[var(--color-border)] pt-2">
                    <div className="flex items-center gap-1.5">
                      <div className="h-3 w-3 shrink-0 rounded border border-emerald-500/50 bg-emerald-500/15 dark:bg-emerald-500/25" />
                      <span className="text-[11px] text-[var(--color-muted-foreground)] sm:text-xs">Hoje</span>
                    </div>
                    <span className="text-[11px] text-[var(--color-border)] sm:text-xs">|</span>
                    <div className="flex items-center gap-1.5">
                      <div className="h-3 w-3 shrink-0 rounded bg-[var(--color-muted)]/90 dark:bg-[var(--color-muted)]/50" />
                      <span className="text-[11px] text-[var(--color-muted-foreground)] sm:text-xs">Intervalo</span>
                    </div>
                    <span className="text-[11px] text-[var(--color-border)] sm:text-xs">|</span>
                    <div className="flex items-center gap-1.5">
                      <div className="h-3 w-3 shrink-0 rounded border-2 border-[var(--color-primary)]/70 bg-[var(--color-primary)]/15" />
                      <span className="text-[11px] text-[var(--color-muted-foreground)] sm:text-xs">Sugerida</span>
                    </div>
                    <span className="text-[11px] text-[var(--color-border)] sm:text-xs">|</span>
                    <div className="flex items-center gap-1.5">
                      <div className="h-3 w-3 shrink-0 rounded bg-[var(--color-primary)] shadow-sm" />
                      <span className="text-[11px] text-[var(--color-muted-foreground)] sm:text-xs">Selecionada</span>
                    </div>
                  </div>
                </div>

                {/* Seletor de Hora */}
                <div className="rounded-[10px] border border-[var(--color-border)] bg-[var(--color-muted)]/20 p-3 dark:bg-[var(--color-muted)]/15 sm:p-4">
                  <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-[var(--color-foreground)]">
                    <Clock className="h-3.5 w-3.5 shrink-0 text-[var(--color-primary)] sm:h-4 sm:w-4" aria-hidden />
                    Hora
                  </div>
                  <div className="flex items-end gap-2 sm:gap-3">
                    <div className="min-w-0 flex-1">
                      <label className="mb-0.5 block text-[11px] text-[var(--color-muted-foreground)] sm:text-xs">
                        Horas
                      </label>
                      <div className="flex items-center gap-1.5 sm:gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            const newHours = selectedTime.hours > 0 ? selectedTime.hours - 1 : 23;
                            setSelectedTime({ ...selectedTime, hours: newHours });
                          }}
                          className="h-7 w-7 shrink-0 p-0 sm:h-8 sm:w-8"
                        >
                          −
                        </Button>
                        <input
                          type="number"
                          min="0"
                          max="23"
                          value={selectedTime.hours}
                          onChange={(e) => {
                            const hours = Math.max(0, Math.min(23, parseInt(e.target.value) || 0));
                            setSelectedTime({ ...selectedTime, hours });
                          }}
                          className="h-8 min-w-0 flex-1 rounded-[8px] border border-[var(--color-input)] bg-[var(--color-background)] px-1 text-center text-xs font-medium tabular-nums text-[var(--color-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] sm:h-9 sm:px-2 sm:text-sm"
                        />
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            const newHours = selectedTime.hours < 23 ? selectedTime.hours + 1 : 0;
                            setSelectedTime({ ...selectedTime, hours: newHours });
                          }}
                          className="h-7 w-7 shrink-0 p-0 sm:h-8 sm:w-8"
                        >
                          +
                        </Button>
                      </div>
                    </div>
                    <div
                      className="shrink-0 pb-1 text-xl font-semibold tabular-nums text-[var(--color-muted-foreground)] sm:text-2xl"
                      aria-hidden
                    >
                      :
                    </div>
                    <div className="min-w-0 flex-1">
                      <label className="mb-0.5 block text-[11px] text-[var(--color-muted-foreground)] sm:text-xs">
                        Minutos
                      </label>
                      <div className="flex items-center gap-1.5 sm:gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            const newMinutes = selectedTime.minutes > 0 ? selectedTime.minutes - 1 : 59;
                            setSelectedTime({ ...selectedTime, minutes: newMinutes });
                          }}
                          className="h-7 w-7 shrink-0 p-0 sm:h-8 sm:w-8"
                        >
                          −
                        </Button>
                        <input
                          type="number"
                          min="0"
                          max="59"
                          value={selectedTime.minutes}
                          onChange={(e) => {
                            const minutes = Math.max(0, Math.min(59, parseInt(e.target.value) || 0));
                            setSelectedTime({ ...selectedTime, minutes });
                          }}
                          className="h-8 min-w-0 flex-1 rounded-[8px] border border-[var(--color-input)] bg-[var(--color-background)] px-1 text-center text-xs font-medium tabular-nums text-[var(--color-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] sm:h-9 sm:px-2 sm:text-sm"
                        />
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            const newMinutes = selectedTime.minutes < 59 ? selectedTime.minutes + 1 : 0;
                            setSelectedTime({ ...selectedTime, minutes: newMinutes });
                          }}
                          className="h-7 w-7 shrink-0 p-0 sm:h-8 sm:w-8"
                        >
                          +
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Botões de ação */}
                <div className="flex items-center justify-between gap-2 border-t border-[var(--color-border)] pt-3 sm:gap-3 sm:pt-4">
                  <Button
                    variant="outline"
                    onClick={handleClear}
                    className="h-9 flex-1 text-sm sm:h-10"
                  >
                    Limpar
                  </Button>
                  <Button
                    onClick={handleConfirm}
                    className="h-9 flex-1 text-sm sm:h-10"
                  >
                    Confirmar
                  </Button>
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </>
    );
  }
);

DateTimePicker.displayName = "DateTimePicker";

export { DateTimePicker };

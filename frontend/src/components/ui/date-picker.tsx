import * as React from "react";
import { Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export interface DatePickerProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange"> {
  value?: string; // YYYY-MM-DD
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  title?: string;
  placeholder?: string;
}

const formatToDisplay = (isoDate: string): string => {
  if (!isoDate) return "";
  const [year, month, day] = isoDate.split("-");
  if (!year || !month || !day) return "";
  return `${day}/${month}/${year}`;
};

const formatToISO = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const parseISO = (isoDate: string): Date | null => {
  if (!isoDate) return null;
  const [year, month, day] = isoDate.split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
};

const DatePicker = React.forwardRef<HTMLInputElement, DatePickerProps>(
  (
    {
      className,
      value = "",
      onChange,
      disabled,
      title = "Selecionar Data",
      placeholder = "Clique para selecionar uma data",
      ...props
    },
    ref
  ) => {
    const [isOpen, setIsOpen] = React.useState(false);
    const [selectedDate, setSelectedDate] = React.useState<Date | null>(() => parseISO(value));
    const [currentMonth, setCurrentMonth] = React.useState<Date>(() => parseISO(value) || new Date());

    React.useEffect(() => {
      const parsed = parseISO(value);
      setSelectedDate(parsed);
      setCurrentMonth(parsed || new Date());
    }, [value]);

    const emitChange = (nextValue: string) => {
      const syntheticEvent = {
        target: { value: nextValue },
      } as React.ChangeEvent<HTMLInputElement>;
      onChange?.(syntheticEvent);
    };

    const handleConfirm = () => {
      emitChange(selectedDate ? formatToISO(selectedDate) : "");
      setIsOpen(false);
    };

    const handleClear = () => {
      emitChange("");
      setIsOpen(false);
    };

    const getDaysInMonth = (date: Date) => {
      const year = date.getFullYear();
      const month = date.getMonth();
      const firstDay = new Date(year, month, 1);
      const lastDay = new Date(year, month + 1, 0);
      const daysInMonth = lastDay.getDate();
      const startingDayOfWeek = firstDay.getDay();

      const days: (number | null)[] = [];
      for (let i = 0; i < startingDayOfWeek; i++) days.push(null);
      for (let i = 1; i <= daysInMonth; i++) days.push(i);
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

    const handleDayClick = (day: number) => {
      const newDate = new Date(currentMonth);
      newDate.setDate(day);
      setSelectedDate(newDate);
    };

    const monthNames = [
      "Janeiro",
      "Fevereiro",
      "Março",
      "Abril",
      "Maio",
      "Junho",
      "Julho",
      "Agosto",
      "Setembro",
      "Outubro",
      "Novembro",
      "Dezembro",
    ];
    const weekDays = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

    const navigateMonth = (direction: "prev" | "next") => {
      const newMonth = new Date(currentMonth);
      newMonth.setMonth(newMonth.getMonth() + (direction === "prev" ? -1 : 1));
      setCurrentMonth(newMonth);
    };

    const goToToday = () => {
      const today = new Date();
      setCurrentMonth(today);
      setSelectedDate(today);
    };

    const displayValue = formatToDisplay(value);

    return (
      <>
        <div className="relative">
          <input
            ref={ref}
            type="text"
            readOnly
            placeholder={placeholder}
            className={cn(
              "flex h-[40px] w-full rounded-[8px] border border-[var(--color-input)] bg-[var(--color-background)] px-[16px] pr-[80px] py-[8px] text-sm ring-offset-background",
              "placeholder:text-[var(--color-muted-foreground)]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] focus-visible:ring-offset-2",
              "disabled:cursor-not-allowed disabled:opacity-50",
              "cursor-pointer",
              !displayValue && "text-[var(--color-muted-foreground)]",
              displayValue && "text-[var(--color-foreground)]",
              className
            )}
            value={displayValue || ""}
            onClick={() => !disabled && setIsOpen(true)}
            disabled={disabled}
            {...props}
          />
          <button
            type="button"
            onClick={() => !disabled && setIsOpen(true)}
            disabled={disabled}
            className="absolute right-[12px] top-1/2 -translate-y-1/2 text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] transition-colors disabled:opacity-50"
            title="Escolher data"
          >
            <Calendar className="h-[20px] w-[20px]" />
          </button>
        </div>

        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogContent className="max-w-[500px] p-0" onClose={() => setIsOpen(false)}>
            <DialogHeader className="p-6 pb-4">
              <DialogTitle>{title}</DialogTitle>
            </DialogHeader>

            <div className="p-6 pt-0 space-y-6">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => navigateMonth("prev")}
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
                    onClick={() => navigateMonth("next")}
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
                      disabled={day === null}
                      className={cn(
                        "h-9 w-9 rounded-[8px] text-sm transition-colors",
                        day === null && "cursor-default",
                        day !== null && "hover:bg-[var(--color-accent)]",
                        isToday(day, currentMonth) && "bg-green-100 text-green-700 font-semibold",
                        isSelected(day, currentMonth) && "bg-blue-600 text-white font-semibold hover:bg-blue-700",
                        !isSelected(day, currentMonth) &&
                          !isToday(day, currentMonth) &&
                          "text-[var(--color-foreground)]"
                      )}
                    >
                      {day}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between gap-3 pt-4 border-t border-[var(--color-border)]">
                <Button variant="outline" onClick={handleClear} className="flex-1">
                  Limpar
                </Button>
                <Button onClick={handleConfirm} className="flex-1">
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

DatePicker.displayName = "DatePicker";

export { DatePicker };


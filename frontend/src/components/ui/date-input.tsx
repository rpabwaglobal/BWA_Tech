import * as React from "react";
import { Calendar } from "lucide-react";
import { cn } from "@/lib/utils";

export interface DateInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange'> {
  value?: string; // YYYY-MM-DD format
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

// Converte YYYY-MM-DD para DD/MM/YYYY
const formatToDisplay = (isoDate: string): string => {
  if (!isoDate) return '';
  const [year, month, day] = isoDate.split('-');
  return `${day}/${month}/${year}`;
};

// Converte DD/MM/YYYY para YYYY-MM-DD
const formatToISO = (displayDate: string): string => {
  if (!displayDate) return '';
  // Remove caracteres não numéricos
  const numbers = displayDate.replace(/\D/g, '');
  if (numbers.length < 8) return '';
  
  const day = numbers.substring(0, 2);
  const month = numbers.substring(2, 4);
  const year = numbers.substring(4, 8);
  
  // Validação básica
  if (parseInt(day) > 31 || parseInt(month) > 12) return '';
  
  return `${year}-${month}-${day}`;
};

// Aplica máscara DD/MM/YYYY
const applyMask = (value: string): string => {
  const numbers = value.replace(/\D/g, '');
  if (numbers.length === 0) return '';
  if (numbers.length <= 2) return numbers;
  if (numbers.length <= 4) return `${numbers.substring(0, 2)}/${numbers.substring(2)}`;
  return `${numbers.substring(0, 2)}/${numbers.substring(2, 4)}/${numbers.substring(4, 8)}`;
};

const DateInput = React.forwardRef<HTMLInputElement, DateInputProps>(
  ({ className, value = '', onChange, ...props }, ref) => {
    const inputRef = React.useRef<HTMLInputElement>(null);
    const [displayValue, setDisplayValue] = React.useState(formatToDisplay(value));
    const [isFocused, setIsFocused] = React.useState(false);

    // Merge refs
    React.useImperativeHandle(ref, () => inputRef.current!);

    // Atualiza displayValue quando value muda externamente
    React.useEffect(() => {
      if (!isFocused) {
        setDisplayValue(formatToDisplay(value));
      }
    }, [value, isFocused]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const inputValue = e.target.value;
      
      // Se o valor já está em formato ISO (YYYY-MM-DD), converter diretamente
      if (/^\d{4}-\d{2}-\d{2}$/.test(inputValue)) {
        const display = formatToDisplay(inputValue);
        setDisplayValue(display);
        const syntheticEvent = {
          ...e,
          target: {
            ...e.target,
            value: inputValue, // Já está em formato ISO
          },
        } as React.ChangeEvent<HTMLInputElement>;
        onChange?.(syntheticEvent);
        return;
      }
      
      // Caso contrário, aplicar máscara e converter
      const masked = applyMask(inputValue);
      setDisplayValue(masked);
      
      // Converte para ISO e chama onChange
      const isoDate = formatToISO(masked);
      if (isoDate || masked.length === 0) {
        const syntheticEvent = {
          ...e,
          target: {
            ...e.target,
            value: isoDate,
          },
        } as React.ChangeEvent<HTMLInputElement>;
        onChange?.(syntheticEvent);
      }
    };

    const handleFocus = () => {
      setIsFocused(true);
    };

    const handleBlur = () => {
      setIsFocused(false);
      // Garante que o valor está completo ao perder o foco
      if (displayValue && displayValue.length === 10) {
        const isoDate = formatToISO(displayValue);
        if (isoDate) {
          setDisplayValue(formatToDisplay(isoDate));
        }
      }
    };

    const handleIconClick = () => {
      // Cria um input temporário type="date" para usar o picker nativo
      const tempInput = document.createElement('input');
      tempInput.type = 'date';
      tempInput.value = value || '';
      tempInput.style.position = 'fixed';
      tempInput.style.opacity = '0';
      tempInput.style.pointerEvents = 'none';
      document.body.appendChild(tempInput);
      
      tempInput.showPicker();
      
      tempInput.addEventListener('change', (e) => {
        const target = e.target as HTMLInputElement;
        if (target.value) {
          // O picker retorna formato ISO (YYYY-MM-DD), converter para display
          const display = formatToDisplay(target.value);
          setDisplayValue(display);
          
          // Chamar onChange com o valor ISO diretamente
          const syntheticEvent = {
            target: {
              ...inputRef.current!,
              value: target.value, // Formato ISO: YYYY-MM-DD
            },
          } as React.ChangeEvent<HTMLInputElement>;
          onChange?.(syntheticEvent);
        }
        document.body.removeChild(tempInput);
      });
      
      tempInput.addEventListener('cancel', () => {
        document.body.removeChild(tempInput);
      });
    };

    return (
      <div className="relative">
        <input
          type="text"
          inputMode="numeric"
          placeholder="Dia/Mês/Ano"
          maxLength={10}
          className={cn(
            "flex h-[40px] w-full rounded-[8px] border border-[var(--color-input)] bg-[var(--color-background)] px-[16px] pr-[48px] py-[8px] text-sm ring-offset-background",
            "placeholder:text-[var(--color-muted-foreground)]",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] focus-visible:ring-offset-2",
            "disabled:cursor-not-allowed disabled:opacity-50",
            className
          )}
          ref={inputRef}
          value={displayValue}
          onChange={handleChange}
          onFocus={handleFocus}
          onBlur={handleBlur}
          {...props}
        />
        <button
          type="button"
          onClick={handleIconClick}
          className="absolute right-[12px] top-1/2 -translate-y-1/2 text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] transition-colors"
        >
          <Calendar className="h-[20px] w-[20px]" />
        </button>
      </div>
    );
  }
);
DateInput.displayName = "DateInput";

export { DateInput };

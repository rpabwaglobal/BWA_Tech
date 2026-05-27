import { useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Check, ChevronDown, Search, X as XIcon } from 'lucide-react';

export type FilterMultiSelectOption = {
  value: string;
  label: string;
};

type FilterMultiSelectProps = {
  options: FilterMultiSelectOption[];
  /** IDs selecionados. */
  value: string[];
  /** Recebe o array completo de IDs selecionados. */
  onChange: (value: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
  /** Se true, exibe X que limpa todas as seleções. Default true. */
  clearable?: boolean;
  className?: string;
  searchPlaceholder?: string;
};

/**
 * Multi-select com checkboxes — clicar num item ALTERNA a seleção SEM
 * fechar o dropdown. Click fora ou no chevron fecha. Mostra "N selecionadas"
 * no trigger; ou o label único se houver só uma escolha.
 *
 * Modelado em cima do FilterSelect (mesma estética). Não suporta `role`
 * (não tem caso de uso atual em multi-select de usuários).
 */
export function FilterMultiSelect({
  options,
  value,
  onChange,
  placeholder = 'Selecione...',
  disabled = false,
  clearable = true,
  className = 'w-full',
  searchPlaceholder = 'Buscar...',
}: FilterMultiSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const selectedSet = new Set(value);

  const filteredOptions = options.filter((opt) => {
    if (!searchQuery.trim()) return true;
    return opt.label.toLowerCase().includes(searchQuery.toLowerCase());
  });

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setSearchQuery('');
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    const t = window.setTimeout(() => searchInputRef.current?.focus(), 0);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.clearTimeout(t);
    };
  }, [isOpen]);

  const toggle = (optionValue: string) => {
    if (selectedSet.has(optionValue)) {
      onChange(value.filter((v) => v !== optionValue));
    } else {
      onChange([...value, optionValue]);
    }
    // NÃO fecha — permanece aberto pra escolher mais.
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange([]);
  };

  // Texto do trigger
  let triggerText: React.ReactNode = (
    <span className="text-[var(--color-muted-foreground)]">{placeholder}</span>
  );
  if (value.length === 1) {
    const only = options.find((o) => o.value === value[0]);
    triggerText = <span className="truncate">{only?.label ?? value[0]}</span>;
  } else if (value.length > 1) {
    triggerText = (
      <span className="truncate">
        <span className="font-semibold">{value.length}</span> selecionada{value.length > 1 ? 's' : ''}
      </span>
    );
  }

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className="flex h-[40px] w-full items-center justify-between rounded-[8px] border border-[var(--color-input)] bg-[var(--color-background)] px-[12px] py-[8px] text-sm ring-offset-[var(--color-background)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <div className="flex min-w-0 flex-1 items-center gap-2">{triggerText}</div>
        <div className="ml-2 flex items-center gap-1">
          {clearable && value.length > 0 && !disabled && (
            <XIcon
              className="h-4 w-4 text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
              onClick={handleClear}
            />
          )}
          <ChevronDown
            className={`h-4 w-4 text-[var(--color-muted-foreground)] transition-transform ${isOpen ? 'rotate-180' : ''}`}
          />
        </div>
      </button>

      {/* Chips das seleções (visíveis quando fechado) */}
      {!isOpen && value.length > 0 && (
        <div className="mt-[8px] flex flex-wrap gap-[6px]">
          {value.map((id) => {
            const opt = options.find((o) => o.value === id);
            const label = opt?.label ?? id;
            return (
              <span
                key={id}
                className="inline-flex items-center gap-[6px] rounded-full border border-[var(--color-primary)]/40 bg-[var(--color-primary)]/12 px-[10px] py-[3px] text-xs font-medium text-[var(--color-foreground)]"
              >
                {label}
                {!disabled && (
                  <button
                    type="button"
                    onClick={() => onChange(value.filter((v) => v !== id))}
                    className="text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
                    aria-label={`Remover ${label}`}
                  >
                    <XIcon className="h-[12px] w-[12px]" />
                  </button>
                )}
              </span>
            );
          })}
        </div>
      )}

      {isOpen && (
        <div className="absolute z-50 mt-1 flex max-h-[320px] w-full flex-col overflow-hidden rounded-[8px] border border-[var(--color-border)] bg-[var(--color-card)] shadow-lg">
          {/* Busca */}
          <div className="border-b border-[var(--color-border)] p-2">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-muted-foreground)]" />
              <Input
                ref={searchInputRef}
                type="text"
                placeholder={searchPlaceholder}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-9 pl-8"
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          </div>

          {/* Lista */}
          <div className="flex-1 overflow-y-auto">
            {filteredOptions.length === 0 ? (
              <div className="p-4 text-center text-sm text-[var(--color-muted-foreground)]">
                Nenhuma opção encontrada
              </div>
            ) : (
              filteredOptions.map((opt) => {
                const checked = selectedSet.has(opt.value);
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => toggle(opt.value)}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--color-accent)] ${
                      checked ? 'bg-[var(--color-accent)]/60' : ''
                    }`}
                  >
                    <span
                      aria-hidden
                      className={`flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded-[3px] border transition-colors ${
                        checked
                          ? 'border-[var(--color-primary)] bg-[var(--color-primary)] text-white'
                          : 'border-[var(--color-border)] bg-[var(--color-background)]'
                      }`}
                    >
                      {checked && <Check className="h-[12px] w-[12px]" strokeWidth={3} />}
                    </span>
                    <span className="min-w-0 truncate">{opt.label}</span>
                  </button>
                );
              })
            )}
          </div>

          {/* Footer com contagem + limpar/fechar */}
          {value.length > 0 && (
            <div className="flex items-center justify-between border-t border-[var(--color-border)] bg-[var(--color-input)]/40 px-3 py-2 text-xs">
              <span className="text-[var(--color-muted-foreground)]">
                {value.length} selecionada{value.length > 1 ? 's' : ''}
              </span>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => onChange([])}
                  className="font-semibold text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
                >
                  Limpar
                </button>
                <button
                  type="button"
                  onClick={() => { setIsOpen(false); setSearchQuery(''); }}
                  className="font-semibold text-[var(--color-primary)] hover:underline"
                >
                  Fechar
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

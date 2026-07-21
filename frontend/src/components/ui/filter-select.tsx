import { useState, useRef, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import { getRoleColor, getRoleFullLabel, getRoleLabel } from '@/components/ui/user-select';

export type FilterSelectOption = {
  value: string;
  label: string;
  /** Quando definido, exibe badge de papel à esquerda do nome (como no UserSelect). */
  role?: string;
};

type FilterSelectProps = {
  options: FilterSelectOption[];
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  /** Quando true, mostra um X que limpa a seleção (envia '' no onChange).
   * Default true. Setar false em campos cuja seleção é sempre obrigatória
   * (ex.: escopo, ano, mês). */
  clearable?: boolean;
  /** Largura do componente. Default 'w-full' — para usar dentro de wrappers
   * de largura fixa, passar `'min-w-[180px]'` ou similar. */
  className?: string;
  /** Placeholder do campo de busca. Default "Buscar...". */
  searchPlaceholder?: string;
  /** Habilita seleção múltipla. Usa `values`/`onValuesChange` em vez de
   * `value`/`onChange`. O dropdown permanece aberto ao alternar itens. */
  multiple?: boolean;
  /** Valores selecionados no modo múltiplo. */
  values?: string[];
  /** Callback do modo múltiplo. */
  onValuesChange?: (values: string[]) => void;
};

export function FilterSelect({
  options,
  value = '',
  onChange,
  placeholder = 'Selecione...',
  disabled = false,
  clearable = true,
  className = 'w-full',
  searchPlaceholder = 'Buscar...',
  multiple = false,
  values = [],
  onValuesChange,
}: FilterSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const selectedOption = options.find((opt) => opt.value === value) || null;
  const hasSelection = multiple ? values.length > 0 : !!selectedOption;
  // Mostra o slot de role só se ALGUMA opção tiver role definido — evita
  // padding esquerdo "vazio" em filtros que não envolvem usuários.
  const anyHasRole = options.some((o) => !!o.role);

  const filteredOptions = options.filter((opt) => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    const blob = [
      opt.label,
      opt.role ?? '',
      opt.role ? getRoleFullLabel(opt.role) : '',
    ]
      .join(' ')
      .toLowerCase();
    return blob.includes(query);
  });

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setSearchQuery('');
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 0);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const handleSelect = (optionValue: string) => {
    if (multiple) {
      const next = values.includes(optionValue)
        ? values.filter((v) => v !== optionValue)
        : [...values, optionValue];
      onValuesChange?.(next);
      // Mantém o dropdown aberto para escolher vários.
      return;
    }
    onChange?.(optionValue);
    setIsOpen(false);
    setSearchQuery('');
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (multiple) {
      onValuesChange?.([]);
    } else {
      onChange?.('');
    }
    setIsOpen(false);
    setSearchQuery('');
  };

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className="flex h-[40px] w-full items-center justify-between rounded-[8px] border border-[var(--color-input)] bg-[var(--color-background)] px-[12px] py-[8px] text-sm ring-offset-[var(--color-background)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {multiple ? (
            values.length > 0 ? (
              <span className="truncate">
                {values.length === 1
                  ? options.find((o) => o.value === values[0])?.label ?? '1 selecionado'
                  : `${values.length} selecionados`}
              </span>
            ) : (
              <span className="text-[var(--color-muted-foreground)]">{placeholder}</span>
            )
          ) : selectedOption ? (
            <>
              {selectedOption.role ? (
                <Badge className={`${getRoleColor(selectedOption.role)} w-[64px] shrink-0 justify-center px-1 text-[10px]`}>
                  {getRoleLabel(selectedOption.role)}
                </Badge>
              ) : null}
              <span className="truncate">{selectedOption.label}</span>
            </>
          ) : (
            <span className="text-[var(--color-muted-foreground)]">{placeholder}</span>
          )}
        </div>
        <div className="flex items-center gap-1 ml-2">
          {clearable && hasSelection && !disabled && (
            <X
              className="h-4 w-4 text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
              onClick={handleClear}
            />
          )}
          <ChevronDown className={`h-4 w-4 text-[var(--color-muted-foreground)] transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </div>
      </button>

      {isOpen && (
        <div className="absolute z-50 w-full mt-1 rounded-[8px] border border-[var(--color-border)] bg-[var(--color-card)] shadow-lg max-h-[300px] overflow-hidden flex flex-col">
          {/* Barra de busca */}
          <div className="p-2 border-b border-[var(--color-border)]">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--color-muted-foreground)]" />
              <Input
                ref={searchInputRef}
                type="text"
                placeholder={searchPlaceholder}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 h-9"
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          </div>

          {/* Lista de opções */}
          <div className="overflow-y-auto flex-1">
            {filteredOptions.length === 0 ? (
              <div className="p-4 text-center text-sm text-[var(--color-muted-foreground)]">
                Nenhuma opção encontrada
              </div>
            ) : (
              filteredOptions.map((opt) => {
                const isSelected = multiple ? values.includes(opt.value) : opt.value === value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => handleSelect(opt.value)}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--color-accent)] ${
                      isSelected ? 'bg-[var(--color-accent)]' : ''
                    }`}
                  >
                    {multiple ? (
                      <span
                        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border ${
                          isSelected
                            ? 'border-[var(--color-primary)] bg-[var(--color-primary)] text-white'
                            : 'border-[var(--color-input)]'
                        }`}
                        aria-hidden
                      >
                        {isSelected && <Check className="h-3 w-3" />}
                      </span>
                    ) : null}
                    {anyHasRole ? (
                      opt.role ? (
                        <Badge className={`${getRoleColor(opt.role)} w-[64px] shrink-0 justify-center text-[10px]`}>
                          {getRoleLabel(opt.role)}
                        </Badge>
                      ) : (
                        <span className="w-[64px] shrink-0" aria-hidden />
                      )
                    ) : null}
                    <span className="min-w-0 truncate">{opt.label}</span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}


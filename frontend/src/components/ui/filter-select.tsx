import { useState, useRef, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ChevronDown, Search, X } from 'lucide-react';
import { getRoleColor, getRoleFullLabel, getRoleLabel } from '@/components/ui/user-select';

export type FilterSelectOption = {
  value: string;
  label: string;
  /** Quando definido, exibe badge de papel à esquerda do nome (como no UserSelect). */
  role?: string;
};

type FilterSelectProps = {
  options: FilterSelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
};

export function FilterSelect({
  options,
  value,
  onChange,
  placeholder = 'Selecione...',
  disabled = false,
}: FilterSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const selectedOption = options.find((opt) => opt.value === value) || null;

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
    onChange(optionValue);
    setIsOpen(false);
    setSearchQuery('');
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange('');
    setIsOpen(false);
    setSearchQuery('');
  };

  return (
    <div ref={containerRef} className="relative w-full">
      <button
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className="flex h-[40px] w-full items-center justify-between rounded-[8px] border border-[var(--color-input)] bg-[var(--color-background)] px-[12px] py-[8px] text-sm ring-offset-[var(--color-background)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {selectedOption ? (
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
          {selectedOption && !disabled && value !== '' && (
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
                placeholder="Buscar..."
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
                const isSelected = opt.value === value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => handleSelect(opt.value)}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--color-accent)] ${
                      isSelected ? 'bg-[var(--color-accent)]' : ''
                    }`}
                  >
                    {opt.role ? (
                      <Badge className={`${getRoleColor(opt.role)} w-[64px] shrink-0 justify-center text-[10px]`}>
                        {getRoleLabel(opt.role)}
                      </Badge>
                    ) : (
                      <span className="w-[64px] shrink-0" aria-hidden />
                    )}
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


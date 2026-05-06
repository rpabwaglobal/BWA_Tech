import { useState, useRef, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Search, ChevronDown, X } from 'lucide-react';
import type { User } from '@/services/userService';

type UserSelectProps = {
  users: User[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
};

export const getRoleColor = (role: string) => {
  switch (role) {
    case 'admin':
      return 'bg-purple-100 text-purple-800 border-purple-300';
    case 'supervisor':
      return 'bg-blue-100 text-blue-800 border-blue-300';
    case 'gerente':
      return 'bg-green-100 text-green-800 border-green-300';
    case 'desenvolvedor':
      return 'bg-orange-100 text-orange-800 border-orange-300';
    case 'dados':
      return 'bg-purple-100 text-purple-800 border-purple-300';
    case 'processos':
      return 'bg-red-100 text-red-800 border-red-300';
    default:
      return 'bg-gray-100 text-gray-800 border-gray-300';
  }
};

export const getRoleLabel = (role: string) => {
  switch (role) {
    case 'desenvolvedor':
      return 'Dev.';
    case 'dados':
      return 'Dados';
    case 'processos':
      return 'Proc.';
    case 'supervisor':
      return 'Super.';
    case 'gerente':
      return 'G. Proj.';
    case 'admin':
      return 'Admin';
    default:
      return role;
  }
};

export const getRoleFullLabel = (role: string) => {
  switch (role) {
    case 'desenvolvedor':
      return 'Desenvolvedor';
    case 'dados':
      return 'Dados';
    case 'processos':
      return 'Processos';
    case 'supervisor':
      return 'Supervisor';
    case 'gerente':
      return 'Gerente de Projetos';
    case 'admin':
      return 'Admin';
    default:
      return role;
  }
};

// Nome exibido para usuários: Primeiro nome + primeiro sobrenome
const getShortDisplayName = (user: User): string => {
  const firstRaw = user.first_name?.trim() ?? '';
  const lastRaw = user.last_name?.trim() ?? '';

  const firstParts = firstRaw.split(/\s+/).filter(Boolean);
  const lastParts = lastRaw.split(/\s+/).filter(Boolean);

  const firstName = firstParts[0] ?? '';
  const firstSurname = lastParts[0] ?? (firstParts.length > 1 ? firstParts[1] : '');

  const name = `${firstName} ${firstSurname}`.trim();
  return name || user.username || '';
};

export function UserSelect({ users, value, onChange, disabled = false, placeholder = 'Selecione um responsável' }: UserSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Filtrar usuários admin
  const availableUsers = users.filter(user => user.role !== 'admin');
  
  const selectedUser = availableUsers.find(u => String(u.id) === String(value));

  const filteredUsers = availableUsers.filter(user => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    const displayName = getShortDisplayName(user).toLowerCase();
    const username = user.username.toLowerCase();
    const roleLabel = getRoleFullLabel(user.role).toLowerCase();
    return displayName.includes(query) || username.includes(query) || roleLabel.includes(query);
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
      // Focus no input de busca quando abrir
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 0);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const handleSelect = (userId: string) => {
    onChange(userId);
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
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {selectedUser ? (
            <>
              <Badge className={`${getRoleColor(selectedUser.role)} w-[64px] justify-center`}>
                {getRoleLabel(selectedUser.role)}
              </Badge>
              <span className="truncate">
                {getShortDisplayName(selectedUser)}
              </span>
            </>
          ) : (
            <span className="text-[var(--color-muted-foreground)]">{placeholder}</span>
          )}
        </div>
        <div className="flex items-center gap-1 ml-2">
          {selectedUser && !disabled && (
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
                placeholder="Buscar por nome ou cargo..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 h-9"
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          </div>

          {/* Lista de usuários */}
          <div className="overflow-y-auto flex-1">
            {filteredUsers.length === 0 ? (
              <div className="p-4 text-center text-sm text-[var(--color-muted-foreground)]">
                Nenhum usuário encontrado
              </div>
            ) : (
              filteredUsers.map((user) => {
                const displayName = getShortDisplayName(user);
                const isSelected = String(user.id) === String(value);

                return (
                  <button
                    key={String(user.id)}
                    type="button"
                    onClick={() => handleSelect(String(user.id))}
                    className={`w-full px-3 py-2 text-left hover:bg-[var(--color-accent)] transition-colors flex items-center gap-2 ${
                      isSelected ? 'bg-[var(--color-accent)]' : ''
                    }`}
                  >
                    <Badge className={`${getRoleColor(user.role)} w-[64px] justify-center`}>
                      {getRoleLabel(user.role)}
                    </Badge>
                    <span className="text-sm">
                      {displayName}
                    </span>
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

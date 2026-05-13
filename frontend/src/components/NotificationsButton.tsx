import { useState, useRef, useEffect } from 'react';
import { Bell } from 'lucide-react';
import { useNotifications } from '@/context/NotificationContext';
import { NotificationsPanel } from './NotificationsPanel';
import { cn } from '@/lib/utils';

export function NotificationsButton() {
  const { unreadCount } = useNotifications();
  const [isOpen, setIsOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Fechar painel ao clicar fora
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        panelRef.current &&
        buttonRef.current &&
        !panelRef.current.contains(event.target as Node) &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [isOpen]);

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "relative flex items-center justify-center w-[40px] h-[40px] rounded-full",
          "bg-[var(--color-card)] border border-[var(--color-border)]",
          "hover:bg-[var(--color-accent)] transition-colors",
          "focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)] focus:ring-offset-2"
        )}
        aria-label="Notificações"
      >
        <Bell className="h-[20px] w-[20px] text-[var(--color-foreground)]" />
        
        {/* Badge vermelho — total não lidas (após filtragem por preferência no backend) */}
        {unreadCount > 0 && (
          <span
            className={cn(
              "absolute top-[-4px] right-[-4px]",
              "flex items-center justify-center",
              "min-w-[20px] h-[20px] px-[4px]",
              "bg-red-500 text-white text-xs font-semibold",
              "rounded-full border-2 border-[var(--color-background)]"
            )}
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Painel de notificações */}
      {isOpen && (
        <div ref={panelRef} className="absolute right-0 top-[48px] z-50">
          <NotificationsPanel onClose={() => setIsOpen(false)} />
        </div>
      )}
    </div>
  );
}

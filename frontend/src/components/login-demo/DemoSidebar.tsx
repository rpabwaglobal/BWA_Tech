import {
  LayoutDashboard,
  Zap,
  FolderKanban,
  Target,
  CheckSquare,
  Users,
  BarChart3,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const ITEMS = [
  { label: 'Dashboard', icon: LayoutDashboard },
  { label: 'Sprints', icon: Zap },
  { label: 'Projetos', icon: FolderKanban },
  { label: 'Prioridades', icon: Target },
  { label: 'Meus Afazeres', icon: CheckSquare },
  { label: 'Pessoas', icon: Users },
  { label: 'Métricas', icon: BarChart3 },
];

export default function DemoSidebar({ active }: { active: string }) {
  return (
    <aside className="w-[140px] h-full bg-sidebar-gradient border-r border-white/10 flex flex-col shrink-0">
      <div className="h-[44px] flex items-center justify-center border-b border-white/15 px-[8px]">
        <img src="/assets/bwa-white.png" alt="BWA" className="h-[18px] w-auto" />
      </div>
      <nav className="flex-1 p-[6px] space-y-[3px]">
        {ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = item.label === active;
          return (
            <div
              key={item.label}
              className={cn(
                'flex items-center gap-[8px] px-[8px] py-[5px] rounded-[6px] text-[10px] font-medium transition-colors',
                isActive
                  ? 'bg-white/22 text-white shadow-sm'
                  : 'text-white/75',
              )}
            >
              <Icon className="h-[12px] w-[12px] shrink-0" />
              <span className="truncate">{item.label}</span>
            </div>
          );
        })}
      </nav>
    </aside>
  );
}

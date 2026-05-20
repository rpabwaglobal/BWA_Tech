import { ReactNode } from 'react';

export default function DemoBrowserFrame({ children }: { children: ReactNode }) {
  return (
    <div className="w-full max-w-[820px] aspect-[16/10] rounded-[14px] overflow-hidden shadow-2xl bg-[var(--color-card)] border border-white/20 flex flex-col">
      {/* Barra superior estilo Chrome */}
      <div className="flex items-center gap-[10px] h-[34px] px-[14px] bg-[var(--color-surface-2)] border-b border-[var(--color-border)] shrink-0">
        <div className="flex gap-[6px]">
          <span className="w-[10px] h-[10px] rounded-full bg-[#ff5f57]" />
          <span className="w-[10px] h-[10px] rounded-full bg-[#febc2e]" />
          <span className="w-[10px] h-[10px] rounded-full bg-[#28c840]" />
        </div>
        <div className="flex-1 mx-[24px] h-[20px] rounded-full bg-[var(--color-muted)] flex items-center justify-center text-[10px] text-[var(--color-muted-foreground)] font-medium">
          https://tech.bwa.global/
        </div>
        <div className="w-[40px]" />
      </div>
      {/* Conteúdo interno do app */}
      <div className="flex-1 min-h-0 flex bg-[var(--color-background)] relative overflow-hidden">
        {children}
      </div>
    </div>
  );
}

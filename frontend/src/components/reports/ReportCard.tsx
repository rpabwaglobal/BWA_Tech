import type { LucideIcon } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export type ReportCardProps = {
  icon: LucideIcon;
  title: string;
  description: string;
  /** Desabilita o botão "Gerar" — usado quando há job em andamento. */
  disabled?: boolean;
  onClick: () => void;
};

/** Card individual de cada relatório no grid da página /relatorios.
 * Layout: ícone roxo + título + descrição + botão "Gerar". */
export default function ReportCard({
  icon: Icon,
  title,
  description,
  disabled = false,
  onClick,
}: ReportCardProps) {
  return (
    <Card className="flex flex-col">
      <CardHeader>
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-lg bg-[var(--color-primary)]/15 flex items-center justify-center shrink-0">
            <Icon className="h-5 w-5 text-[var(--color-primary)]" />
          </div>
          <div className="min-w-0">
            <CardTitle className="text-base leading-tight">{title}</CardTitle>
          </div>
        </div>
        <CardDescription className="text-xs">{description}</CardDescription>
      </CardHeader>
      <CardContent className="mt-auto pt-0">
        <Button
          type="button"
          variant="default"
          className="w-full"
          disabled={disabled}
          onClick={onClick}
        >
          Gerar relatório
        </Button>
      </CardContent>
    </Card>
  );
}

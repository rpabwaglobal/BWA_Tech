import { prazoVencido } from './prazoDoCard';
// A REGRA DE FERIADO SAIU DAQUI, e isso conserta mais do que uma duplicação.
//
// Este arquivo tinha a única implementação de feriados do frontend — fixos mais
// os móveis derivados da Páscoa — e ela era PRIVADA ao módulo. Resultado: o SLA
// dos chamados de suporte (`businessHours.ts`) não tinha como usá-la e contava
// feriado como dia normal, e o 20/11 faltava aqui desde que virou feriado
// nacional, em 2024.
//
// Agora a resposta vem de `@/lib/feriados`, que é a única do frontend e espelha
// `apps/projects/feriados.py` no backend. Lá também entram os feriados
// estaduais, municipais e recessos que a equipe cadastra — coisa que uma lista
// fixa no código nunca poderia cobrir.
import { isFeriado, isFimDeSemana } from './feriados';

// Calcula dias totais entre duas datas
export function calcularDiasTotais(dataInicio: string, dataFim: string): number {
  const inicio = new Date(dataInicio);
  const fim = new Date(dataFim);
  const diffTime = fim.getTime() - inicio.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1; // +1 para incluir o dia inicial
  return diffDays;
}

// Calcula dias úteis entre duas datas
export function calcularDiasUteis(dataInicio: string, dataFim: string): number {
  const inicio = new Date(dataInicio);
  const fim = new Date(dataFim);
  let diasUteis = 0;

  const dataAtual = new Date(inicio);
  while (dataAtual <= fim) {
    if (!isFimDeSemana(dataAtual) && !isFeriado(dataAtual)) {
      diasUteis++;
    }
    dataAtual.setDate(dataAtual.getDate() + 1);
  }

  return diasUteis;
}

// Formata data para exibição (dia mês ano)
export function formatDate(dateString: string): string {
  if (!dateString) return 'N/A';
  
  // Se a data está no formato YYYY-MM-DD, parsear manualmente para evitar problemas de timezone
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
    const [year, month, day] = dateString.split('-').map(Number);
    // Criar data no timezone local (não UTC)
    const date = new Date(year, month - 1, day);
    return date.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  }
  
  // Para outros formatos, usar Date normalmente
  return new Date(dateString).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

// Formata data e hora para exibição (dia mês ano hora:minuto)
export function formatDateTime(dateTimeString: string): string {
  if (!dateTimeString) return 'N/A';
  
  // Se está no formato YYYY-MM-DDTHH:mm ou YYYY-MM-DD HH:mm:ss
  // Parsear manualmente para evitar problemas de timezone
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(dateTimeString)) {
    const [datePart, timePart] = dateTimeString.split('T');
    const [year, month, day] = datePart.split('-').map(Number);
    const [hours, minutes] = timePart.split(':').map(Number);
    
    // Criar data no timezone local
    const date = new Date(year, month - 1, day, hours, minutes);
    return date.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
  
  // Para outros formatos, usar Date normalmente
  const date = new Date(dateTimeString);
  if (isNaN(date.getTime())) return 'N/A';
  
  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Verifica se um card em desenvolvimento já passou do prazo.
// A comparação mora em `prazoDoCard`, junto com a da entrega: o prazo "18:30"
// vale até 18:30:59 dos dois lados, senão o selo da tela contradiz o número
// gravado na métrica.
export function isCardAtrasado(card: { status: string; data_fim?: string | null }): boolean {
  if (card.status !== 'em_desenvolvimento') return false;
  return prazoVencido(card.data_fim);
}

/** Formata segundos corridos como "2d 5h", "12h", "45min". */
export function formatSegundosCorridos(seconds?: number | null): string {
  if (seconds == null) return '—';
  if (seconds <= 0) return '0h';
  const days = Math.floor(seconds / 86400);
  let remainder = seconds % 86400;
  const hours = Math.floor(remainder / 3600);
  remainder %= 3600;
  const minutes = Math.floor(remainder / 60);
  if (days && hours) return `${days}d ${hours}h`;
  if (days) return `${days}d`;
  if (hours && minutes) return `${hours}h ${minutes}min`;
  if (hours) return `${hours}h`;
  if (minutes) return `${minutes}min`;
  return '0h';
}

/** Formata minutos úteis como "1h 30min", "45min", "9h". */
export function formatMinutosUteis(minutes?: number | null): string {
  if (minutes == null) return '—';
  if (minutes <= 0) return '0min';
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours && mins) return `${hours}h ${mins}min`;
  if (hours) return `${hours}h`;
  return `${mins}min`;
}

// Feriados nacionais brasileiros (fixos)
const FERIADOS_FIXOS = [
  { mes: 1, dia: 1 },   // Confraternização Universal
  { mes: 4, dia: 21 },  // Tiradentes
  { mes: 5, dia: 1 },   // Dia do Trabalhador
  { mes: 9, dia: 7 },   // Independência do Brasil
  { mes: 10, dia: 12 }, // Nossa Senhora Aparecida
  { mes: 11, dia: 2 },  // Finados
  { mes: 11, dia: 15 }, // Proclamação da República
  { mes: 12, dia: 25 }, // Natal
];

// Calcula a Páscoa usando o algoritmo de Meeus/Jones/Butcher
function calcularPascoa(ano: number): Date {
  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(ano, mes - 1, dia);
}

// Retorna feriados móveis baseados na Páscoa
function getFeriadosMoveis(ano: number): Date[] {
  const pascoa = calcularPascoa(ano);
  const feriadosMoveis: Date[] = [];

  // Carnaval (47 dias antes da Páscoa - segunda e terça)
  const carnavalTerca = new Date(pascoa);
  carnavalTerca.setDate(pascoa.getDate() - 47);
  const carnavalSegunda = new Date(carnavalTerca);
  carnavalSegunda.setDate(carnavalTerca.getDate() - 1);
  feriadosMoveis.push(carnavalSegunda, carnavalTerca);

  // Sexta-feira Santa (2 dias antes da Páscoa)
  const sextaSanta = new Date(pascoa);
  sextaSanta.setDate(pascoa.getDate() - 2);
  feriadosMoveis.push(sextaSanta);

  // Corpus Christi (60 dias após a Páscoa)
  const corpusChristi = new Date(pascoa);
  corpusChristi.setDate(pascoa.getDate() + 60);
  feriadosMoveis.push(corpusChristi);

  return feriadosMoveis;
}

// Verifica se uma data é feriado
function isFeriado(data: Date): boolean {
  const ano = data.getFullYear();
  const mes = data.getMonth() + 1;
  const dia = data.getDate();

  // Verifica feriados fixos
  for (const feriado of FERIADOS_FIXOS) {
    if (feriado.mes === mes && feriado.dia === dia) {
      return true;
    }
  }

  // Verifica feriados móveis
  const feriadosMoveis = getFeriadosMoveis(ano);
  for (const feriado of feriadosMoveis) {
    if (
      feriado.getFullYear() === ano &&
      feriado.getMonth() === data.getMonth() &&
      feriado.getDate() === dia
    ) {
      return true;
    }
  }

  return false;
}

// Verifica se é final de semana
function isFimDeSemana(data: Date): boolean {
  const diaSemana = data.getDay();
  return diaSemana === 0 || diaSemana === 6; // Domingo = 0, Sábado = 6
}

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

// Verifica se um card está atrasado (status em_desenvolvimento e data_fim < agora)
export function isCardAtrasado(card: { status: string; data_fim?: string | null }): boolean {
  if (card.status !== 'em_desenvolvimento' || !card.data_fim) {
    return false;
  }
  
  const dataFim = new Date(card.data_fim);
  const agora = new Date();
  
  return dataFim < agora;
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

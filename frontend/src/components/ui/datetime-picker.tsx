import * as React from "react";
import { Calendar, ChevronDown, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export interface DateTimePickerProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange'> {
  value?: string; // YYYY-MM-DDTHH:mm format
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  suggestedDate?: string; // YYYY-MM-DDTHH:mm format - Data sugerida baseada em dias úteis
  /** Título do diálogo (calendário + hora). */
  pickerTitle?: string;
  /**
   * Só a data, sem hora — para quem escolhe um DIA e não um instante.
   *
   * Existe para que um filtro de período possa usar ESTE calendário, e não um
   * segundo. Os relatórios usavam um campo que abria o seletor nativo do
   * navegador, e o navegador o ancorava no canto superior esquerdo da janela,
   * longe do campo clicado. Copiar este componente para uma versão sem hora
   * criaria dois calendários para manter em sincronia — já era o caso de
   * `date-picker.tsx`, que ficou para trás e ainda pinta "hoje" com
   * `bg-green-100` fixo, ilegível no tema escuro.
   *
   * Muda três coisas: o valor sai como `YYYY-MM-DD` (sem `T`), o seletor de
   * hora some, e o realce de INTERVALO é desligado. O intervalo aqui significa
   * "os dias daqui até o prazo", que é leitura de prazo de card; num filtro de
   * período ele pintaria dias que não têm nada a ver com o que está sendo
   * escolhido.
   */
  somenteData?: boolean;
}

// Converte YYYY-MM-DDTHH:mm para DD/MM/YYYY HH:mm
const formatToDisplay = (isoDateTime: string): string => {
  if (!isoDateTime) return '';
  const [datePart, timePart] = isoDateTime.split('T');
  if (!datePart) return '';
  
  const [year, month, day] = datePart.split('-');
  const dateStr = `${day}/${month}/${year}`;
  
  if (timePart) {
    const [hours, minutes] = timePart.split(':');
    return `${dateStr} ${hours}:${minutes}`;
  }
  return dateStr;
};

// Converte Date para YYYY-MM-DDTHH:mm — ou só YYYY-MM-DD em modo somenteData.
const formatToISO = (date: Date, somenteData = false): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const dataISO = `${year}-${month}-${day}`;
  if (somenteData) return dataISO;
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${dataISO}T${hours}:${minutes}`;
};

// Converte YYYY-MM-DDTHH:mm para Date
const parseISO = (isoDateTime: string): Date | null => {
  if (!isoDateTime) return null;
  const [datePart, timePart] = isoDateTime.split('T');
  if (!datePart) return null;
  
  const [year, month, day] = datePart.split('-').map(Number);
  let hours = 0;
  let minutes = 0;
  
  if (timePart) {
    const [h, m] = timePart.split(':').map(Number);
    hours = h || 0;
    minutes = m || 0;
  }
  
  return new Date(year, month - 1, day, hours, minutes);
};

const DateTimePicker = React.forwardRef<HTMLInputElement, DateTimePickerProps>(
  ({ className, value = '', onChange, disabled, suggestedDate, pickerTitle, somenteData = false, ...props }, ref) => {
    const tituloDoDialogo =
      pickerTitle ?? (somenteData ? 'Selecionar data' : 'Selecionar data e hora');
    // Um texto só para o botão do ícone: `title` sozinho é o último recurso do
    // cálculo de nome acessível, então vai também como `aria-label`.
    const acaoDoBotao = somenteData ? 'Escolher data' : 'Escolher data e hora';
    const [isOpen, setIsOpen] = React.useState(false);
    const [selectedDate, setSelectedDate] = React.useState<Date | null>(() => {
      const parsed = parseISO(value);
      if (parsed) return parsed;
      // Não selecionar nenhuma data por padrão
      return null;
    });
    const [selectedTime, setSelectedTime] = React.useState<{ hours: number; minutes: number }>(() => {
      const parsed = parseISO(value);
      if (parsed) {
        return { hours: parsed.getHours(), minutes: parsed.getMinutes() };
      }
      // Se não tem valor, usar hora padrão 18:00
      return { hours: 18, minutes: 0 };
    });
    const [currentMonth, setCurrentMonth] = React.useState(new Date());
    /**
     * O QUE A GRADE ESTÁ MOSTRANDO: dias, meses ou anos.
     *
     * Sem isto, chegar a uma data distante era clicar em ← uma vez por mês —
     * doze cliques para voltar um ano. Num filtro de relatório, que é onde se
     * pede "de janeiro até março", isso é o uso NORMAL e não o excepcional.
     *
     * O painel troca no lugar, dentro da mesma caixa, em vez de abrir um
     * dropdown. O corpo do diálogo tem `overflow-y-auto`, e um menu posicionado
     * por `absolute` (como o `FilterSelect` do projeto) seria CORTADO por ele —
     * seria preciso um portal, com o z-index e o fechamento por clique-fora que
     * vêm junto. Trocar o conteúdo da grade não tem nenhum desses problemas, e
     * é o gesto que todo calendário usa.
     */
    const [modo, setModo] = React.useState<'dias' | 'meses' | 'anos'>('dias');

    /**
     * O MÊS EXIBIDO, SEMPRE ANCORADO NO DIA 1.
     *
     * `currentMonth` só responde "que mês a grade mostra" — o dia escolhido
     * mora em `selectedDate`. Mas ele guardava um dia de verdade, e
     * `setMonth`/`setFullYear` TRANSBORDAM quando o dia não existe no destino:
     *   new Date(2026, 0, 31).setMonth(1)  ->  03/03/2026
     * Ou seja, com 31/01 na tela, a seta → pulava fevereiro inteiro; fevereiro
     * ficava INALCANÇÁVEL pela navegação.
     *
     * Isso já existia, mas era quase invisível enquanto o mês exibido começava
     * sempre em `new Date()` — só quebrava se hoje fosse dia 29, 30 ou 31. Ao
     * passar a abrir no mês da data já escolhida, todo card com entrega em fim
     * de mês passaria a cair nele.
     */
    const mesAncorado = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);

    /**
     * O foco volta para o rótulo central depois de trocar de painel.
     *
     * Escolher um mês ou um ano DESMONTA o próprio botão que estava focado, e
     * o foco cai em `document.body`: quem navega por teclado perde o lugar e
     * recomeça do início do diálogo a cada escolha. O rótulo é o ponto certo
     * para voltar, porque é o controle que trouxe a pessoa até ali.
     */
    const rotuloRef = React.useRef<HTMLButtonElement>(null);
    const jaMontou = React.useRef(false);
    React.useEffect(() => {
      // Não rouba o foco na primeira renderização — só depois de uma TROCA.
      if (!jaMontou.current) {
        jaMontou.current = true;
        return;
      }
      rotuloRef.current?.focus();
    }, [modo]);

    // ABRIR CAI NO MÊS DA DATA JÁ ESCOLHIDA, e não no mês corrente.
    //
    // `currentMonth` nascia como `new Date()` e nunca era sincronizado com
    // `value`: um card com entrega em 15/12 abria o calendário em AGOSTO, e o
    // dia selecionado não aparecia em lugar nenhum — quem reabrisse para
    // conferir a data via um mês qualquer, sem nada marcado. O irmão
    // `date-picker.tsx` já fazia essa sincronia; este ficou sem.
    //
    // Feito na ABERTURA, e não num efeito de `value`: enquanto o diálogo está
    // aberto, quem navega para outro mês tem de continuar lá.
    //
    // Reabrir também volta para os dias — quem abre quer escolher uma data, não
    // continuar de onde parou no painel de anos da vez passada.
    React.useEffect(() => {
      if (!isOpen) return;
      setModo('dias');
      setCurrentMonth(mesAncorado(parseISO(value) || new Date()));
    }, [isOpen, value]);

    // A página de anos tem 12 posições, alinhadas em múltiplos de 12 para que
    // ← e → sempre andem uma página inteira, sem sobreposição.
    const PAGINA_DE_ANOS = 12;
    const primeiroAnoDaPagina =
      Math.floor(currentMonth.getFullYear() / PAGINA_DE_ANOS) * PAGINA_DE_ANOS;
    const anosDaPagina = Array.from(
      { length: PAGINA_DE_ANOS }, (_, i) => primeiroAnoDaPagina + i);
    
    // Parse da data sugerida
    const suggestedDateObj = suggestedDate ? parseISO(suggestedDate) : null;

    // Atualiza quando value muda externamente
    React.useEffect(() => {
      const parsed = parseISO(value);
      if (parsed) {
        setSelectedDate(parsed);
        setSelectedTime({ hours: parsed.getHours(), minutes: parsed.getMinutes() });
      } else {
        // Se não tem valor, usar data de hoje e hora 18:00
        const today = new Date();
        setSelectedDate(today);
        setSelectedTime({ hours: 18, minutes: 0 });
      }
    }, [value]);
    
    // Quando abrir o modal, se não tiver valor, não selecionar data mas usar hora 18:00
    React.useEffect(() => {
      if (isOpen && !value) {
        setSelectedDate(null);
        setSelectedTime({ hours: 18, minutes: 0 });
      }
    }, [isOpen, value]);

    const handleConfirm = () => {
      // SEM DIA ESCOLHIDO, NÃO SE GRAVA NADA.
      //
      // Aqui havia um atalho: "se não há data selecionada, usar hoje". Só que
      // abrir o diálogo com o campo vazio DESLIGA a seleção de propósito (o
      // efeito logo acima), justamente para que "nada escolhido" apareça como
      // nada escolhido — e então confirmar gravava hoje, contradizendo a
      // própria grade, que não tinha nenhum dia marcado.
      //
      // Era alcançável antes, mas só para quem abrisse e confirmasse sem
      // clicar. Com a navegação por mês e ano virou caminho curto e plausível:
      // dá para ir até Janeiro/2025, olhar a grade vazia, clicar em "Confirmar"
      // e o campo passar a exibir a data de HOJE. Num filtro de período isso é
      // um valor errado que ninguém tem motivo para desconfiar.
      //
      // O botão fica desabilitado neste estado, então este `return` é a segunda
      // barreira — e não a única.
      if (!selectedDate) return;

      const date = new Date(selectedDate);
      date.setHours(selectedTime.hours, selectedTime.minutes, 0, 0);
      const isoValue = formatToISO(date, somenteData);
      
      const syntheticEvent = {
        target: {
          value: isoValue,
        },
      } as React.ChangeEvent<HTMLInputElement>;
      
      onChange?.(syntheticEvent);
      setIsOpen(false);
    };

    const handleClear = () => {
      const syntheticEvent = {
        target: {
          value: '',
        },
      } as React.ChangeEvent<HTMLInputElement>;
      
      onChange?.(syntheticEvent);
      setIsOpen(false);
    };

    // Calendário
    const getDaysInMonth = (date: Date) => {
      const year = date.getFullYear();
      const month = date.getMonth();
      const firstDay = new Date(year, month, 1);
      const lastDay = new Date(year, month + 1, 0);
      const daysInMonth = lastDay.getDate();
      const startingDayOfWeek = firstDay.getDay();
      
      const days: (number | null)[] = [];
      
      // Dias do mês anterior para preencher a primeira semana
      for (let i = 0; i < startingDayOfWeek; i++) {
        days.push(null);
      }
      
      // Dias do mês atual
      for (let i = 1; i <= daysInMonth; i++) {
        days.push(i);
      }
      
      return days;
    };

    const isToday = (day: number | null, month: Date) => {
      if (day === null) return false;
      const today = new Date();
      return (
        day === today.getDate() &&
        month.getMonth() === today.getMonth() &&
        month.getFullYear() === today.getFullYear()
      );
    };

    const isSelected = (day: number | null, month: Date) => {
      if (day === null || !selectedDate) return false;
      return (
        day === selectedDate.getDate() &&
        month.getMonth() === selectedDate.getMonth() &&
        month.getFullYear() === selectedDate.getFullYear()
      );
    };

    const isSuggested = (day: number | null, month: Date) => {
      if (day === null || !suggestedDateObj) return false;
      return (
        day === suggestedDateObj.getDate() &&
        month.getMonth() === suggestedDateObj.getMonth() &&
        month.getFullYear() === suggestedDateObj.getFullYear()
      );
    };

    const isInRange = (day: number | null, month: Date) => {
      if (day === null) return false;
      // "Intervalo" = os dias daqui até o prazo. É leitura de PRAZO DE CARD;
      // num filtro de período pintaria dias sem relação com a escolha.
      if (somenteData) return false;
      
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      // Data do dia sendo verificado
      const checkDate = new Date(month.getFullYear(), month.getMonth(), day);
      checkDate.setHours(0, 0, 0, 0);
      
      // Se a data verificada é hoje ou antes, não está no intervalo
      if (checkDate <= today) return false;
      
      // Data final do intervalo (sugerida ou selecionada)
      let endDate: Date | null = null;
      
      // Se há uma data selecionada e ela é futura, usar ela
      if (selectedDate) {
        const selectedDateOnly = new Date(selectedDate);
        selectedDateOnly.setHours(0, 0, 0, 0);
        if (selectedDateOnly >= today) {
          endDate = selectedDateOnly;
        }
      }
      
      // Se não há data selecionada ou a selecionada não é futura, usar a sugerida
      if (!endDate && suggestedDateObj) {
        const suggestedDateOnly = new Date(suggestedDateObj);
        suggestedDateOnly.setHours(0, 0, 0, 0);
        if (suggestedDateOnly > today) {
          endDate = suggestedDateOnly;
        }
      }
      
      // Se não há data final, não está no intervalo
      if (!endDate) return false;
      
      // Verificar se está no intervalo (hoje até a data final, excluindo hoje e a data final)
      return checkDate > today && checkDate < endDate;
    };

    const handleDayClick = (day: number) => {
      const newDate = new Date(currentMonth);
      newDate.setDate(day);
      setSelectedDate(newDate);
    };

    const monthNames = [
      'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
      'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
    ];

    const weekDays = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

    const navigateMonth = (direction: 'prev' | 'next') => {
      const newMonth = mesAncorado(currentMonth);
      if (direction === 'prev') {
        newMonth.setMonth(newMonth.getMonth() - 1);
      } else {
        newMonth.setMonth(newMonth.getMonth() + 1);
      }
      setCurrentMonth(newMonth);
    };

    /** ← e → andam na unidade do que está na tela: mês, ano ou página de anos. */
    const navegar = (direcao: 'prev' | 'next') => {
      if (modo === 'dias') return navigateMonth(direcao);
      const passo = direcao === 'prev' ? -1 : 1;
      // Ancorado pelo mesmo motivo: 29/02 de um bissexto + 1 ano vira 01/03.
      const nova = mesAncorado(currentMonth);
      nova.setFullYear(
        nova.getFullYear() + (modo === 'meses' ? passo : passo * PAGINA_DE_ANOS));
      setCurrentMonth(nova);
    };

    /** `setMonth` numa data de dia 31 pula o mês curto (31/03 -> 01/05 em abril).
     *  Ancorar no dia 1 antes de trocar mês ou ano evita esse salto. */
    const irPara = ({ mes, ano }: { mes?: number; ano?: number }) => {
      const nova = mesAncorado(currentMonth);
      if (ano !== undefined) nova.setFullYear(ano);
      if (mes !== undefined) nova.setMonth(mes);
      setCurrentMonth(nova);
    };

    const goToToday = () => {
      const today = new Date();
      setCurrentMonth(mesAncorado(today));
      setSelectedDate(today);
      // A HORA NÃO É REDEFINIDA AQUI.
      //
      // Este botão fica entre ← e →, na barra de navegação, e é usado para se
      // situar no mês corrente. Ele também fazia
      // `setSelectedTime(agora.getHours(), agora.getMinutes())` — e como a hora
      // escolhida sobrevive à troca de dia, clicar em "Hoje" e depois escolher
      // outro dia gravava o prazo no RELÓGIO DO MOMENTO em vez das 18:00 que o
      // fluxo de prazo assume por padrão. Um card com entrega 25/08 18:00
      // virava 25/08 10:49 sem ninguém tocar no seletor de hora.
    };

    const displayValue = formatToDisplay(value);

    return (
      <>
        <div className="relative">
          <input
            // O componente é `forwardRef` e a `ref` chegava aqui para ser
            // DESCARTADA — quem a passasse não conseguiria focar o campo, sem
            // aviso nenhum. O irmão `date-picker.tsx` já a repassava.
            ref={ref}
            type="text"
            readOnly
            placeholder={somenteData ? 'Clique para selecionar a data' : 'Clique para selecionar data e hora'}
            className={cn(
              'flex h-[42px] w-full rounded-[10px] border border-[var(--color-input)] bg-[var(--color-card)] px-[14px] pr-[80px] py-[8px] text-sm shadow-sm ring-offset-[var(--color-background)] transition-[box-shadow,border-color]',
              'placeholder:text-[var(--color-muted-foreground)]',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-background)]',
              'hover:border-[var(--color-muted-foreground)]/35',
              'disabled:cursor-not-allowed disabled:opacity-50',
              'cursor-pointer',
              !displayValue && 'text-[var(--color-muted-foreground)]',
              displayValue && 'text-[var(--color-foreground)] font-medium',
              className
            )}
            value={displayValue || ''}
            onClick={() => !disabled && setIsOpen(true)}
            disabled={disabled}
            {...props}
          />
          <button
            type="button"
            onClick={() => !disabled && setIsOpen(true)}
            disabled={disabled}
            className="absolute right-[12px] top-1/2 -translate-y-1/2 text-[var(--color-muted-foreground)] transition-colors hover:text-[var(--color-foreground)] disabled:opacity-50"
            title={acaoDoBotao}
            aria-label={acaoDoBotao}
          >
            <Calendar className="h-[20px] w-[20px] shrink-0" aria-hidden />
          </button>
        </div>

        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogContent
            className="flex max-h-[min(90dvh,640px)] max-w-[min(100vw-24px,520px)] flex-col gap-0 overflow-hidden rounded-[12px] border border-[var(--color-border)] bg-[var(--color-popover)] p-0 text-[var(--color-popover-foreground)] shadow-lg"
            onClose={() => setIsOpen(false)}
          >
            <DialogHeader className="shrink-0 border-b border-[var(--color-border)] bg-[var(--color-muted)]/25 px-5 py-3 sm:px-6 sm:py-4">
              <DialogTitle className="text-base font-semibold">{tituloDoDialogo}</DialogTitle>
            </DialogHeader>

            <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-5 py-4 [-webkit-overflow-scrolling:touch] sm:px-6">
              <div className="space-y-4 pb-1">
                {/* Calendário */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => navegar('prev')}
                      className="h-7 w-7 shrink-0 p-0"
                    >
                      ←
                    </Button>
                    <div className="flex min-w-0 flex-wrap items-center justify-center gap-1.5">
                      {/* O RÓTULO É O CONTROLE. Clicar em "Agosto 2026" abre os
                          meses; clicar em "2026" abre os anos. É o gesto que
                          todo calendário usa, e evita dois seletores extras
                          disputando espaço num diálogo estreito. */}
                      <button
                        ref={rotuloRef}
                        type="button"
                        onClick={() =>
                          setModo(modo === 'dias' ? 'meses' : modo === 'meses' ? 'anos' : 'meses')
                        }
                        className="flex items-center gap-1 rounded-[6px] px-1.5 py-0.5 text-center text-sm font-semibold text-[var(--color-foreground)] transition-colors hover:bg-[var(--color-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
                        // COMPÕE o nome acessível em vez de SUBSTITUIR o texto
                        // visível. Um `aria-label` vence o conteúdo do botão, e
                        // com só a ação ("Escolher mês e ano") o mês e o ano na
                        // tela deixavam de ser anunciados — e não há outra fonte
                        // deles no diálogo, porque as células de dia trazem só o
                        // número e o título é genérico.
                        aria-label={
                          modo === 'dias'
                            ? `${monthNames[currentMonth.getMonth()]} ${currentMonth.getFullYear()}, escolher mês e ano`
                            : modo === 'meses'
                              ? `${currentMonth.getFullYear()}, escolher ano`
                              : `${primeiroAnoDaPagina} a ${primeiroAnoDaPagina + PAGINA_DE_ANOS - 1}, voltar para os meses`
                        }
                      >
                        {modo === 'dias' && `${monthNames[currentMonth.getMonth()]} ${currentMonth.getFullYear()}`}
                        {modo === 'meses' && currentMonth.getFullYear()}
                        {modo === 'anos' && `${primeiroAnoDaPagina} – ${primeiroAnoDaPagina + PAGINA_DE_ANOS - 1}`}
                        <ChevronDown
                          className={cn(
                            'h-3.5 w-3.5 shrink-0 text-[var(--color-muted-foreground)] transition-transform',
                            modo !== 'dias' && 'rotate-180',
                          )}
                          aria-hidden
                        />
                      </button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          goToToday();
                          // Sem isto, "Hoje" no painel de anos mudava a data por
                          // baixo e deixava a pessoa olhando anos, sem sinal de
                          // que algo tinha sido selecionado.
                          setModo('dias');
                        }}
                        className="h-6 px-2 text-xs"
                      >
                        Hoje
                      </Button>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => navegar('next')}
                      className="h-7 w-7 shrink-0 p-0"
                    >
                      →
                    </Button>
                  </div>

                  {/* A GRADE MOSTRA O QUE O MODO PEDIR: dias, meses ou anos.
                      A ALTURA MÍNIMA É O QUE SEGURA A CAIXA NO LUGAR. Sem ela
                      os painéis têm alturas diferentes — a grade de dias tem
                      cabeçalho de semana e 5 ou 6 linhas; meses e anos têm 4 —
                      e o diálogo encolhia visivelmente ao trocar de painel, o
                      que parece que outra coisa abriu. O valor cobre a grade de
                      dias de 6 linhas, que é a mais alta das três. */}
                  <div className="min-h-[218px] sm:min-h-[266px]">
                  {modo === 'dias' && (
                    <div className="grid grid-cols-7 gap-0.5 sm:gap-1">
                      {weekDays.map((day) => (
                        <div
                          key={day}
                          className="py-1 text-center text-[10px] font-medium text-[var(--color-muted-foreground)] sm:text-xs"
                        >
                          {day}
                        </div>
                      ))}
                      {getDaysInMonth(currentMonth).map((day, index) => (
                        <button
                          key={index}
                          type="button"
                          onClick={() => day !== null && handleDayClick(day)}
                          disabled={day === null}
                          className={cn(
                            'h-7 w-7 rounded-[6px] text-xs transition-colors sm:h-8 sm:w-8 sm:rounded-[8px] sm:text-sm',
                            day === null && 'cursor-default',
                            day !== null && 'hover:bg-[var(--color-accent)]',
                            isSelected(day, currentMonth) &&
                              'bg-[var(--color-primary)] font-semibold text-[var(--color-primary-foreground)] shadow-sm hover:bg-[var(--color-primary)]/92',
                            isToday(day, currentMonth) &&
                              !isSelected(day, currentMonth) &&
                              'border border-emerald-500/45 bg-emerald-500/12 font-semibold text-emerald-900 dark:border-emerald-400/40 dark:bg-emerald-500/18 dark:text-emerald-100',
                            isSuggested(day, currentMonth) &&
                              !isSelected(day, currentMonth) &&
                              'border-2 border-[var(--color-primary)]/55 bg-[var(--color-primary)]/12 font-semibold text-[var(--color-foreground)]',
                            isInRange(day, currentMonth) &&
                              !isSelected(day, currentMonth) &&
                              !isSuggested(day, currentMonth) &&
                              !isToday(day, currentMonth) &&
                              'bg-[var(--color-muted)]/90 text-[var(--color-foreground)] dark:bg-[var(--color-muted)]/50',
                            !isSelected(day, currentMonth) &&
                              !isToday(day, currentMonth) &&
                              !isSuggested(day, currentMonth) &&
                              !isInRange(day, currentMonth) &&
                              day !== null &&
                              'text-[var(--color-foreground)]',
                          )}
                        >
                          {day}
                        </button>
                      ))}
                    </div>
                  )}

                  {modo === 'meses' && (
                    <div className="grid grid-cols-3 gap-1.5">
                      {monthNames.map((nome, indice) => {
                        const ehOMesAtual =
                          indice === new Date().getMonth() &&
                          currentMonth.getFullYear() === new Date().getFullYear();
                        const ehOEscolhido =
                          !!selectedDate &&
                          indice === selectedDate.getMonth() &&
                          currentMonth.getFullYear() === selectedDate.getFullYear();
                        return (
                          <button
                            key={nome}
                            type="button"
                            onClick={() => {
                              irPara({ mes: indice });
                              // Escolher o mês devolve aos dias: ninguém abre
                              // este painel para parar nele.
                              setModo('dias');
                            }}
                            className={cn(
                              'h-9 rounded-[8px] text-xs font-medium transition-colors hover:bg-[var(--color-accent)] sm:text-sm',
                              ehOEscolhido
                                ? 'bg-[var(--color-primary)] text-[var(--color-primary-foreground)] shadow-sm hover:bg-[var(--color-primary)]/92'
                                : ehOMesAtual
                                  ? 'border border-emerald-500/45 bg-emerald-500/12 font-semibold text-emerald-900 dark:border-emerald-400/40 dark:bg-emerald-500/18 dark:text-emerald-100'
                                  : 'text-[var(--color-foreground)]',
                            )}
                          >
                            {/* Três letras: "Fevereiro" e "Setembro" não cabem
                                em coluna de terço num diálogo estreito. */}
                            {nome.slice(0, 3)}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {modo === 'anos' && (
                    <div className="grid grid-cols-3 gap-1.5">
                      {anosDaPagina.map((ano) => {
                        const ehOAnoAtual = ano === new Date().getFullYear();
                        const ehOEscolhido = !!selectedDate && ano === selectedDate.getFullYear();
                        return (
                          <button
                            key={ano}
                            type="button"
                            onClick={() => {
                              irPara({ ano });
                              // Ano escolhido leva aos MESES, e não direto aos
                              // dias: o mês herdado da tela anterior quase
                              // nunca é o que se quer de outro ano.
                              setModo('meses');
                            }}
                            className={cn(
                              'h-9 rounded-[8px] text-xs font-medium tabular-nums transition-colors hover:bg-[var(--color-accent)] sm:text-sm',
                              ehOEscolhido
                                ? 'bg-[var(--color-primary)] text-[var(--color-primary-foreground)] shadow-sm hover:bg-[var(--color-primary)]/92'
                                : ehOAnoAtual
                                  ? 'border border-emerald-500/45 bg-emerald-500/12 font-semibold text-emerald-900 dark:border-emerald-400/40 dark:bg-emerald-500/18 dark:text-emerald-100'
                                  : 'text-[var(--color-foreground)]',
                            )}
                          >
                            {ano}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  </div>

                  {/* LEGENDA SÓ DO QUE PODE ACONTECER, e só no painel de dias:
                      ela descreve as cores das células de DIA. Nos painéis de
                      mês e ano as mesmas cores dizem outra coisa ("o mês de
                      hoje", "o ano escolhido"), e a legenda ali seria ruído.
                      Ela listava os quatro estados sempre — inclusive "Sugerida"
                      em telas que nunca passam `suggestedDate`, e "Intervalo"
                      onde o intervalo está desligado. Legenda que descreve cor
                      que não aparece é pior que legenda nenhuma: manda procurar
                      algo que não existe. */}
                  {modo === 'dias' && (
                  <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1.5 border-t border-[var(--color-border)] pt-2">
                    {[
                      { chave: 'hoje', mostra: true, rotulo: 'Hoje',
                        classe: 'border border-emerald-500/50 bg-emerald-500/15 dark:bg-emerald-500/25' },
                      { chave: 'intervalo', mostra: !somenteData, rotulo: 'Intervalo',
                        classe: 'bg-[var(--color-muted)]/90 dark:bg-[var(--color-muted)]/50' },
                      { chave: 'sugerida', mostra: !!suggestedDateObj, rotulo: 'Sugerida',
                        classe: 'border-2 border-[var(--color-primary)]/70 bg-[var(--color-primary)]/15' },
                      { chave: 'selecionada', mostra: true, rotulo: 'Selecionada',
                        classe: 'bg-[var(--color-primary)] shadow-sm' },
                    ]
                      .filter((item) => item.mostra)
                      .map((item, indice) => (
                        <React.Fragment key={item.chave}>
                          {indice > 0 && (
                            <span className="text-[11px] text-[var(--color-border)] sm:text-xs">|</span>
                          )}
                          <div className="flex items-center gap-1.5">
                            <div className={cn('h-3 w-3 shrink-0 rounded', item.classe)} />
                            <span className="text-[11px] text-[var(--color-muted-foreground)] sm:text-xs">
                              {item.rotulo}
                            </span>
                          </div>
                        </React.Fragment>
                      ))}
                  </div>
                  )}
                </div>

                {/* Seletor de Hora — some quando só a data importa. */}
                {!somenteData && (
                <div className="rounded-[10px] border border-[var(--color-border)] bg-[var(--color-muted)]/20 p-3 dark:bg-[var(--color-muted)]/15 sm:p-4">
                  <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-[var(--color-foreground)]">
                    <Clock className="h-3.5 w-3.5 shrink-0 text-[var(--color-primary)] sm:h-4 sm:w-4" aria-hidden />
                    Hora
                  </div>
                  <div className="flex items-end gap-2 sm:gap-3">
                    <div className="min-w-0 flex-1">
                      <label className="mb-0.5 block text-[11px] text-[var(--color-muted-foreground)] sm:text-xs">
                        Horas
                      </label>
                      <div className="flex items-center gap-1.5 sm:gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            const newHours = selectedTime.hours > 0 ? selectedTime.hours - 1 : 23;
                            setSelectedTime({ ...selectedTime, hours: newHours });
                          }}
                          className="h-7 w-7 shrink-0 p-0 sm:h-8 sm:w-8"
                        >
                          −
                        </Button>
                        <input
                          type="number"
                          min="0"
                          max="23"
                          value={selectedTime.hours}
                          onChange={(e) => {
                            const hours = Math.max(0, Math.min(23, parseInt(e.target.value) || 0));
                            setSelectedTime({ ...selectedTime, hours });
                          }}
                          className="h-8 min-w-0 flex-1 rounded-[8px] border border-[var(--color-input)] bg-[var(--color-background)] px-1 text-center text-xs font-medium tabular-nums text-[var(--color-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] sm:h-9 sm:px-2 sm:text-sm"
                        />
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            const newHours = selectedTime.hours < 23 ? selectedTime.hours + 1 : 0;
                            setSelectedTime({ ...selectedTime, hours: newHours });
                          }}
                          className="h-7 w-7 shrink-0 p-0 sm:h-8 sm:w-8"
                        >
                          +
                        </Button>
                      </div>
                    </div>
                    <div
                      className="shrink-0 pb-1 text-xl font-semibold tabular-nums text-[var(--color-muted-foreground)] sm:text-2xl"
                      aria-hidden
                    >
                      :
                    </div>
                    <div className="min-w-0 flex-1">
                      <label className="mb-0.5 block text-[11px] text-[var(--color-muted-foreground)] sm:text-xs">
                        Minutos
                      </label>
                      <div className="flex items-center gap-1.5 sm:gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            const newMinutes = selectedTime.minutes > 0 ? selectedTime.minutes - 1 : 59;
                            setSelectedTime({ ...selectedTime, minutes: newMinutes });
                          }}
                          className="h-7 w-7 shrink-0 p-0 sm:h-8 sm:w-8"
                        >
                          −
                        </Button>
                        <input
                          type="number"
                          min="0"
                          max="59"
                          value={selectedTime.minutes}
                          onChange={(e) => {
                            const minutes = Math.max(0, Math.min(59, parseInt(e.target.value) || 0));
                            setSelectedTime({ ...selectedTime, minutes });
                          }}
                          className="h-8 min-w-0 flex-1 rounded-[8px] border border-[var(--color-input)] bg-[var(--color-background)] px-1 text-center text-xs font-medium tabular-nums text-[var(--color-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] sm:h-9 sm:px-2 sm:text-sm"
                        />
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            const newMinutes = selectedTime.minutes < 59 ? selectedTime.minutes + 1 : 0;
                            setSelectedTime({ ...selectedTime, minutes: newMinutes });
                          }}
                          className="h-7 w-7 shrink-0 p-0 sm:h-8 sm:w-8"
                        >
                          +
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
                )}

                {/* Botões de ação */}
                <div className="flex items-center justify-between gap-2 border-t border-[var(--color-border)] pt-3 sm:gap-3 sm:pt-4">
                  <Button
                    variant="outline"
                    onClick={handleClear}
                    className="h-9 flex-1 text-sm sm:h-10"
                  >
                    Limpar
                  </Button>
                  {/* Desabilitado enquanto nada estiver escolhido: sem isto o
                      botão parecia aceitar uma grade vazia. Quem quer esvaziar
                      o campo tem o "Limpar" ao lado. */}
                  <Button
                    onClick={handleConfirm}
                    disabled={!selectedDate}
                    className="h-9 flex-1 text-sm sm:h-10"
                  >
                    Confirmar
                  </Button>
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </>
    );
  }
);

DateTimePicker.displayName = "DateTimePicker";

export { DateTimePicker };

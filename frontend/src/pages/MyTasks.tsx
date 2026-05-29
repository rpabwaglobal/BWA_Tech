import { useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Archive,
  ArchiveRestore,
  Check,
  CheckSquare,
  Loader2,
  Palette,
  Pin,
  PinOff,
  Plus,
  Search,
  StickyNote,
  Trash2,
  X,
} from 'lucide-react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useDndMonitor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  type SortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { LayoutGroup, motion, useMotionValue, useSpring } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { DragHandle } from '@/components/ui/drag-handle';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  userNoteService,
  type UserNote,
  type UserNoteColor,
  type UserNoteItem,
  type UserNoteItemKind,
  type UserNoteItemInput,
} from '@/services/userNoteService';
import { cardPinService, type CardPin } from '@/services/cardPinService';
import { KanbanCardPreview } from '@/components/KanbanCardPreview';
import { ROUTES } from '@/routes';
import { cn } from '@/lib/utils';

type NoteFilter = 'active' | 'archived';

// Cada bloco do draft tem um _key estável p/ React; o id do backend (quando
// existe) é descartado já que a estratégia de update é replace-all no servidor.
// `parentKey` referencia o `_key` de outro item da mesma nota — usado pra
// indentação tipo árvore (sem precisar de PKs reais).
type DraftItem = UserNoteItem & { _key: string; parentKey: string | null };

/** Limite de profundidade visual da árvore. Frontend impede ir além;
 * backend não força (defesa em profundidade). */
const MAX_INDENT_DEPTH = 5;


type DraftNote = {
  id?: number;
  title: string;
  color: UserNoteColor;
  pinned: boolean;
  archived: boolean;
  items: DraftItem[];
};

// Paleta inspirada em 5 papéis Color Plus / Sirio Color.
// Hex light = aproximação visual do papel. Hex dark = versão escurecida do
// mesmo matiz. Aplicado via inline style para evitar problemas de purge/JIT
// com valores arbitrários no Tailwind.
type ColorSpec = {
  bg: string;
  bgDark: string;
  border: string;
  borderDark: string;
};

/** Limites de tamanho. O backend tem só title.max_length=200; o conteúdo
 * (items.text) é TextField sem limite — limitamos no frontend pra prevenir
 * abuso. Por item: 10k caracteres parece confortável tanto pra texto livre
 * quanto pra lista. */
const NOTE_TITLE_MAX = 200;
const NOTE_ITEM_TEXT_MAX = 10_000;

const COLOR_PALETTE: Record<UserNoteColor, ColorSpec | null> = {
  // null = usa as cores do tema (var(--color-card), var(--color-border))
  default: null,
  lilas: { bg: '#D7C8E8', bgDark: '#3A2D52', border: '#C0AEDB', borderDark: '#4F4271' },
  rosa:  { bg: '#F1CDD9', bgDark: '#4A2A38', border: '#E3B3C3', borderDark: '#693D50' },
  verde: { bg: '#C9DDA8', bgDark: '#2C3A1F', border: '#B4CD89', borderDark: '#3F5230' },
  azul:  { bg: '#BFD7E8', bgDark: '#1F3349', border: '#A5C2D9', borderDark: '#324B68' },
  bege:  { bg: '#F1E5A8', bgDark: '#3A3119', border: '#E0D08A', borderDark: '#544728' },
};

const COLOR_OPTIONS: Array<{ value: UserNoteColor; label: string }> = [
  { value: 'default', label: 'Padrão' },
  { value: 'lilas', label: 'Lilás (San Francisco)' },
  { value: 'rosa', label: 'Rosa (Verona)' },
  { value: 'verde', label: 'Verde (Tahiti)' },
  { value: 'azul', label: 'Azul (Celeste)' },
  { value: 'bege', label: 'Bege (Paglierino)' },
];

/** Hook leve para detectar dark mode pela classe no <html>. */
function useIsDark(): boolean {
  const [isDark, setIsDark] = useState(() =>
    typeof document !== 'undefined' && document.documentElement.classList.contains('dark'),
  );
  useEffect(() => {
    const root = document.documentElement;
    const obs = new MutationObserver(() => setIsDark(root.classList.contains('dark')));
    obs.observe(root, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);
  return isDark;
}

function getNoteStyle(color: UserNoteColor, isDark: boolean): React.CSSProperties {
  const spec = COLOR_PALETTE[color];
  if (!spec) return {};
  return {
    backgroundColor: isDark ? spec.bgDark : spec.bg,
    borderColor: isDark ? spec.borderDark : spec.border,
  };
}

function getSwatchStyle(color: UserNoteColor, isDark: boolean): React.CSSProperties {
  const spec = COLOR_PALETTE[color];
  if (!spec) {
    // Default: usa fundo do tema com checkerboard suave para indicar "sem cor"
    return {
      backgroundImage:
        'linear-gradient(135deg, transparent 45%, currentColor 45% 55%, transparent 55%)',
      backgroundColor: 'transparent',
      color: isDark ? '#94a3b8' : '#94a3b8',
    };
  }
  return { backgroundColor: isDark ? spec.bgDark : spec.bg };
}

const newKey = () => `tmp-${Math.random().toString(36).slice(2, 10)}`;

function toDraft(note: UserNote): DraftNote {
  const sorted = (note.items || []).slice().sort((a, b) => a.order - b.order);
  // Mapa PK → _key pra resolver parent (parent vem como FK numérica).
  const idToKey = new Map<number, string>();
  const items: DraftItem[] = sorted.map((it) => {
    const _key = it.id != null ? `id-${it.id}` : newKey();
    if (it.id != null) idToKey.set(it.id, _key);
    return { ...it, _key, parentKey: null };
  });
  for (let i = 0; i < items.length; i++) {
    const raw = sorted[i];
    if (raw.parent != null) {
      const parentKey = idToKey.get(raw.parent);
      if (parentKey) items[i].parentKey = parentKey;
    }
  }
  return {
    id: note.id,
    title: note.title,
    color: note.color,
    pinned: note.pinned,
    archived: note.archived,
    items,
  };
}

function emptyDraft(): DraftNote {
  return {
    title: '',
    color: 'default',
    pinned: false,
    archived: false,
    // Começa com um único bloco de texto vazio para o usuário digitar logo de cara.
    items: [{ _key: newKey(), kind: 'text', text: '', done: false, order: 0, parentKey: null }],
  };
}

function isDraftEmpty(draft: DraftNote): boolean {
  return !draft.title.trim() && draft.items.every((it) => !it.text.trim());
}

function draftToPayload(draft: DraftNote) {
  // Mantém só items com texto OU items que são pai de algum filho com texto
  // (não faz sentido descartar um pai vazio e manter os filhos órfãos).
  const hasContent = new Set<string>();
  for (const it of draft.items) if (it.text.trim().length > 0) hasContent.add(it._key);
  // Marca pais como "tem conteúdo" se algum filho descendente tem.
  const keyToItem = new Map(draft.items.map((it) => [it._key, it] as const));
  let changed = true;
  while (changed) {
    changed = false;
    for (const it of draft.items) {
      if (hasContent.has(it._key) && it.parentKey && !hasContent.has(it.parentKey)
          && keyToItem.has(it.parentKey)) {
        hasContent.add(it.parentKey);
        changed = true;
      }
    }
  }
  const kept = draft.items.filter((it) => hasContent.has(it._key));

  const cleanItems: UserNoteItemInput[] = kept.map((it, index) => ({
    kind: it.kind,
    text: it.text.trim(),
    done: it.kind === 'todo' ? it.done : false,
    order: index,
    client_id: it._key,
    parent_client_id:
      it.parentKey && hasContent.has(it.parentKey) ? it.parentKey : null,
  }));
  return {
    title: draft.title.trim(),
    color: draft.color,
    pinned: draft.pinned,
    archived: draft.archived,
    items: cleanItems,
  };
}

/** True se `candidateKey` é descendente (transitivo) de `ancestorKey`. */
function isDescendantOf(
  candidateKey: string,
  ancestorKey: string,
  items: DraftItem[],
): boolean {
  const byKey = new Map(items.map((it) => [it._key, it] as const));
  let cur: string | null = byKey.get(candidateKey)?.parentKey ?? null;
  const seen = new Set<string>();
  while (cur) {
    if (cur === ancestorKey) return true;
    if (seen.has(cur)) return false;
    seen.add(cur);
    cur = byKey.get(cur)?.parentKey ?? null;
  }
  return false;
}

/** Profundidade visual de um item (0 = raiz). Limitada a MAX_INDENT_DEPTH. */
function indentOf(item: DraftItem, byKey: Map<string, DraftItem>): number {
  let depth = 0;
  let cur: string | null = item.parentKey;
  const seen = new Set<string>();
  while (cur && depth < MAX_INDENT_DEPTH) {
    if (seen.has(cur)) break; // defesa contra ciclo
    seen.add(cur);
    const p = byKey.get(cur);
    if (!p) break;
    depth++;
    cur = p.parentKey;
  }
  return depth;
}

function ColorPicker({
  value,
  onChange,
}: {
  value: UserNoteColor;
  onChange: (color: UserNoteColor) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const isDark = useIsDark();

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  return (
    <div ref={wrapperRef} className="relative">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-8 w-8 p-0"
        title="Alterar cor"
        onClick={() => setOpen((prev) => !prev)}
      >
        <Palette className="h-4 w-4" />
      </Button>
      {open && (
        <div
          className="absolute bottom-full left-0 mb-2 z-50 flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-popover)] p-2 shadow-md"
        >
          {COLOR_OPTIONS.map((opt) => {
            const isSelected = value === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                title={opt.label}
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
                style={getSwatchStyle(opt.value, isDark)}
                className={cn(
                  'h-7 w-7 shrink-0 rounded-full border-2 transition-transform hover:scale-110',
                  isSelected
                    ? 'border-[var(--color-primary)] ring-2 ring-[var(--color-primary)]/30'
                    : 'border-[var(--color-border)]',
                )}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Ajusta a altura do textarea pra caber todo o conteúdo (sem scroll interno). */
function autoResize(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}

/** Bloco do conteúdo da nota (texto ou checklist) com:
 * - drag handle (6 pontinhos) à esquerda
 * - indentação visual proporcional ao `indent`
 * - Enter cria novo item logo abaixo (Shift+Enter quebra linha no Textarea)
 * - Tab indenta, Shift+Tab desindenta
 *
 * O wrapper sortable (SortableItemBlock) injeta `dragHandleRef`/`dragListeners`
 * que são repassados ao DragHandle.
 */
function ItemBlock({
  item,
  indent,
  onChange,
  onRemove,
  onConvert,
  onEnter,
  onIndent,
  onOutdent,
  autoFocus,
  dragHandleRef,
  dragListeners,
}: {
  item: DraftItem;
  indent: number;
  onChange: (next: DraftItem) => void;
  onRemove: () => void;
  onConvert: (next: UserNoteItemKind) => void;
  onEnter: () => void;
  onIndent: () => void;
  onOutdent: () => void;
  autoFocus?: boolean;
  dragHandleRef?: (el: HTMLElement | null) => void;
  dragListeners?: Record<string, (e: React.SyntheticEvent) => void>;
}) {
  // Único textarea (até pra kind=todo, pra ter quebra de linha automática).
  // <input> só renderiza 1 linha e fica fazendo overflow horizontal — feio
  // pra item de lista longo.
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (autoFocus) textareaRef.current?.focus();
  }, [autoFocus]);

  // Reajusta a altura sempre que o texto mudar OU o componente montar com
  // valor inicial (caso da nota carregada do servidor com texto longo).
  useEffect(() => {
    autoResize(textareaRef.current);
  }, [item.text]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      // Enter (sem shift): cria novo item logo abaixo, foca nele.
      // Shift+Enter cai aqui SEM ser interceptado, mantendo o newline nativo
      // do textarea (em todo ou em text).
      e.preventDefault();
      onEnter();
      return;
    }
    if (e.key === 'Tab') {
      // Tab indenta, Shift+Tab desindenta (estilo Notion/Keep).
      e.preventDefault();
      if (e.shiftKey) onOutdent();
      else onIndent();
      return;
    }
    if (e.key === 'Backspace' && item.text.length === 0) {
      // Backspace em item vazio remove o bloco.
      e.preventDefault();
      onRemove();
      return;
    }
  };

  // Step do indent. Toda a "árvore" visual (trunk + arms) é desenhada por
  // um único <svg> por pai no overlay do NoteEditor — ItemBlock só preocupa
  // com paddingLeft e conteúdo.
  const STEP = 26;
  return (
    <div
      className="group relative flex min-w-0 items-center gap-1"
      style={{ paddingLeft: `${indent * STEP}px` }}
    >
      <DragHandle
        ref={(el) => dragHandleRef?.(el)}
        {...(dragListeners as Record<string, (e: React.SyntheticEvent) => void>)}
        className="self-center"
      />
      {item.kind === 'todo' ? (
        <input
          type="checkbox"
          checked={item.done}
          onChange={(e) => onChange({ ...item, done: e.target.checked })}
          className="mt-1.5 h-4 w-4 shrink-0 self-start cursor-pointer rounded border-border accent-primary"
        />
      ) : (
        // Marcador "-" tipo bullet pra texto. Always visible. Click converte
        // pra item de lista (todo). Em vez de um caractere (em-dash render
        // baixo/grosso, depende da fonte), desenho um traço crisp via CSS:
        // <span> de 8×1px com bg=currentColor, centrado verticalmente no
        // 16px do button (mesmo y do checkbox, 14px do topo).
        <button
          type="button"
          onClick={() => onConvert('todo')}
          title="Converter em item de lista"
          className="mt-1.5 h-4 w-4 shrink-0 self-start flex items-center justify-center text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
        >
          <span aria-hidden className="block h-px w-2 bg-current" />
        </button>
      )}
      <Textarea
        ref={textareaRef}
        value={item.text}
        onChange={(e) => onChange({ ...item, text: e.target.value })}
        onInput={(e) => autoResize(e.currentTarget)}
        onKeyDown={handleKeyDown}
        placeholder={item.kind === 'todo' ? 'Item da lista' : 'Texto...'}
        maxLength={NOTE_ITEM_TEXT_MAX}
        rows={1}
        // wrap=soft + break-words = quebra de linha visual sem inserir \n.
        className={cn(
          'min-h-[28px] min-w-0 flex-1 resize-none overflow-hidden border-0 bg-transparent px-1 py-0.5 text-sm leading-snug whitespace-pre-wrap break-words [overflow-wrap:anywhere] shadow-none focus-visible:ring-0 focus-visible:ring-offset-0',
          item.kind === 'todo' && item.done && 'line-through text-muted-foreground',
        )}
      />
      <div className="flex shrink-0 self-start items-center pt-1 opacity-0 transition-opacity group-hover:opacity-100">
        {item.kind === 'todo' && (
          <button
            type="button"
            onClick={() => onConvert('text')}
            title="Converter em texto"
            className="rounded p-0.5 text-muted-foreground hover:text-foreground"
          >
            <span className="text-xs">¶</span>
          </button>
        )}
        <button
          type="button"
          onClick={onRemove}
          title="Remover bloco"
          className="rounded p-0.5 text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

/** Wrapper sortable em torno do ItemBlock. Usa `useSortable` do dnd-kit
 *  pra prover handle ref + listeners + transform. */
function SortableItemBlock(props: React.ComponentProps<typeof ItemBlock> & { id: string }) {
  const { id, ...rest } = props;
  const {
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
    attributes,
    listeners,
  } = useSortable({ id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };
  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      <ItemBlock
        {...rest}
        dragHandleRef={setActivatorNodeRef}
        dragListeners={listeners as Record<string, (e: React.SyntheticEvent) => void>}
      />
    </div>
  );
}

/** Faixa fininha entre items: hover mostra "+" pra inserir texto ou todo
 *  exatamente naquela posição. */
function InsertGap({
  onInsert,
}: {
  onInsert: (kind: UserNoteItemKind) => void;
}) {
  return (
    <div className="group/gap relative flex h-[6px] items-center">
      <div className="absolute inset-x-2 top-1/2 h-px -translate-y-1/2 bg-transparent transition-colors group-hover/gap:bg-[var(--color-primary)]/30" />
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 opacity-0 transition-opacity group-hover/gap:opacity-100">
        <div className="flex items-center gap-1 rounded-full border border-[var(--color-border)] bg-[var(--color-card)] px-1.5 py-0.5 shadow-sm">
          <button
            type="button"
            onClick={() => onInsert('text')}
            title="Inserir texto aqui"
            className="text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
          >
            <Plus className="h-3 w-3" />
          </button>
          <span className="text-[9px] font-bold uppercase tracking-wider text-[var(--color-muted-foreground)]">/</span>
          <button
            type="button"
            onClick={() => onInsert('todo')}
            title="Inserir item de lista aqui"
            className="text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
          >
            <CheckSquare className="h-3 w-3" />
          </button>
        </div>
      </div>
    </div>
  );
}


/** Wrapper sortable de um NoteCard. Sem drag handle visível: o card inteiro
 *  é arrastável (sensor com `distance: 6` no DndContext pai diferencia entre
 *  clique pra editar e arrastar). motion.div com `layoutId` único pra animar
 *  a transição pinned ↔ outras via framer-motion (shared element). */
function SortableNoteCardWrapper({
  noteId,
  layoutId,
  children,
}: {
  noteId: number;
  layoutId: string;
  children: () => React.ReactNode;
}) {
  const {
    setNodeRef,
    transform,
    transition,
    isDragging,
    attributes,
    listeners,
  } = useSortable({ id: noteId });
  // Sem framer-motion aqui — `layout`/`layoutId` brigavam com o transform
  // do dnd-kit e causavam distorção do card (esticava pra ocupar o slot
  // anterior). Agora só dnd-kit puro: animação suave de empurrar vem do
  // `transition` que o useSortable retorna pra cada item enquanto o drag
  // está ativo. Source fica invisível (visibility:hidden mantém espaço)
  // e o clone (DragPreviewCard via <DragOverlay>) segue o cursor sem
  // ser afetado por nada do layout.
  // Nota: a animação shared-element de pin↔unpin via layoutId foi removida
  // pelo mesmo motivo. Se quisermos de volta, melhor encapsular num
  // motion.div ao redor do container das sections (não no item).
  void layoutId;
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    visibility: isDragging ? 'hidden' : 'visible',
    cursor: isDragging ? 'grabbing' : 'grab',
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className="min-w-0 w-full"
      {...attributes}
      {...(listeners as Record<string, (e: React.SyntheticEvent) => void>)}
    >
      {children()}
    </div>
  );
}

/** Breakpoints (px do viewport → nº de colunas) usados pelo Masonry. */
const NOTES_MASONRY_BREAKPOINTS = { default: 1, 640: 2, 1024: 3, 1280: 4 };

/** Strategy custom pro SortableContext: igual ao rectSortingStrategy do dnd-kit
 *  mas FORÇA scaleX/Y = 1 (não escala o card pra caber no slot alvo). Sem isso,
 *  ao arrastar um card de tamanho diferente sobre outro, o "outro" estica/encolhe
 *  pra virar o tamanho do que está sendo arrastado — visualmente péssimo em
 *  layouts com cards de alturas heterogêneas (masonry estilo Keep).
 *  O reorder na lógica continua igual; só o feedback visual durante o drag muda. */
const noScaleRectSortingStrategy: SortingStrategy = ({
  rects,
  activeIndex,
  overIndex,
  index,
}) => {
  const newRects = [...rects];
  const [moved] = newRects.splice(activeIndex, 1);
  newRects.splice(overIndex, 0, moved);
  const oldRect = rects[index];
  const newRect = newRects[index];
  if (!newRect || !oldRect) return null;
  return {
    x: newRect.left - oldRect.left,
    y: newRect.top - oldRect.top,
    scaleX: 1,
    scaleY: 1,
  };
};

function useColumnCount(breakpoints: { default: number; [width: number]: number }): number {
  const sortedKeys = useMemo(
    () =>
      Object.keys(breakpoints)
        .filter((k) => k !== 'default')
        .map(Number)
        .sort((a, b) => b - a),
    [breakpoints],
  );
  const compute = useCallback(() => {
    if (typeof window === 'undefined') return breakpoints.default;
    const w = window.innerWidth;
    for (const bp of sortedKeys) {
      if (w >= bp) return breakpoints[bp];
    }
    return breakpoints.default;
  }, [breakpoints, sortedKeys]);
  const [cols, setCols] = useState<number>(compute);
  useEffect(() => {
    const handler = () => setCols(compute());
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, [compute]);
  return cols;
}

/** Masonry round-robin: distribui filhos em N colunas (i % N). Cada coluna é
 *  um flex flex-col vertical. NÃO usa CSS columns — assim o transform do
 *  dnd-kit pode mover items dentro de cada coluna sem o browser recalcular
 *  layout e distorcer cards adjacentes. */
function Masonry({
  children,
  breakpoints,
  gap = '12px',
}: {
  children: React.ReactNode[];
  breakpoints: { default: number; [width: number]: number };
  gap?: string;
}) {
  const cols = useColumnCount(breakpoints);
  const columns = useMemo(() => {
    const arr: React.ReactNode[][] = Array.from({ length: cols }, () => []);
    children.forEach((child, i) => arr[i % cols].push(child));
    return arr;
  }, [children, cols]);
  return (
    <div className="flex w-full items-start" style={{ gap }}>
      {columns.map((col, i) => (
        <div key={i} className="flex flex-1 min-w-0 flex-col" style={{ gap }}>
          {col}
        </div>
      ))}
    </div>
  );
}

/** Card preview renderizado dentro do <DragOverlay> enquanto o usuário
 *  arrasta. Não é o mesmo elemento da grade (esse fica invisível com
 *  opacity:0 mantendo o espaço). Aplica tilt suave baseado na velocidade
 *  horizontal do drag — sensação de "pendurado balançando". */
function DragPreviewCard({ note }: { note: UserNote }) {
  // Velocidade horizontal mapeada em rotação (graus). Spring amortece pra
  // ficar fluido em vez de "tremido".
  const rotate = useMotionValue(0);
  const rotateSpring = useSpring(rotate, { stiffness: 240, damping: 22 });
  const prevDx = useRef(0);

  useDndMonitor({
    onDragMove: (e) => {
      // delta.x do dnd-kit é cumulativo desde o início do drag; pegamos a
      // diferença em relação ao frame anterior pra estimar velocidade.
      const vx = e.delta.x - prevDx.current;
      prevDx.current = e.delta.x;
      // Clamp em ±6° pra não ficar exagerado.
      const target = Math.max(-6, Math.min(6, vx * 0.6));
      rotate.set(target);
    },
    onDragEnd: () => {
      rotate.set(0);
      prevDx.current = 0;
    },
    onDragCancel: () => {
      rotate.set(0);
      prevDx.current = 0;
    },
  });

  return (
    <motion.div
      style={{
        rotate: rotateSpring,
        cursor: 'grabbing',
        boxShadow: '0 12px 30px rgba(0,0,0,0.35)',
        // Não escala — usuário pediu pra "não ficar maior".
      }}
    >
      <NoteCard
        note={note}
        // Callbacks no-op — overlay é só visual.
        onClick={() => undefined}
        onTogglePin={() => undefined}
        onToggleArchive={() => undefined}
        onDelete={() => undefined}
        onChangeColor={() => undefined}
        onToggleItem={() => undefined}
      />
    </motion.div>
  );
}

function NoteCard({
  note,
  onClick,
  onTogglePin,
  onToggleArchive,
  onDelete,
  onChangeColor,
  onToggleItem,
  selectionMode = false,
  selected = false,
}: {
  note: UserNote;
  onClick: () => void;
  onTogglePin: () => void;
  onToggleArchive: () => void;
  onDelete: () => void;
  onChangeColor: (color: UserNoteColor) => void;
  /** Toggle do `done` de um item de checklist (todo). Recebe a posição no
   * array ordenado de items, NÃO o id. */
  onToggleItem: (itemIdx: number, done: boolean) => void;
  /** Em modo seleção: clique no card alterna a seleção (não abre o editor) e
   * as ações internas (pin, color, archive, delete, checkboxes de todos) são
   * escondidas/desabilitadas. */
  selectionMode?: boolean;
  selected?: boolean;
}) {
  const sortedItems = useMemo(
    () => (note.items || []).slice().sort((a, b) => a.order - b.order),
    [note.items],
  );
  // Mapa id → item pra resolver depth de cada filho via cadeia de `parent`.
  const itemsById = useMemo(() => {
    const m = new Map<number, UserNoteItem>();
    for (const it of sortedItems) if (it.id != null) m.set(it.id, it);
    return m;
  }, [sortedItems]);
  const depthOf = useCallback(
    (it: UserNoteItem): number => {
      let d = 0;
      let cur = it.parent ?? null;
      const seen = new Set<number>();
      while (cur != null && d < MAX_INDENT_DEPTH) {
        if (seen.has(cur)) break;
        seen.add(cur);
        const p = itemsById.get(cur);
        if (!p) break;
        d++;
        cur = p.parent ?? null;
      }
      return d;
    },
    [itemsById],
  );
  const MAX_VISIBLE = 12;
  const visibleItems = sortedItems.slice(0, MAX_VISIBLE);
  const hiddenCount = sortedItems.length - visibleItems.length;
  const isDark = useIsDark();
  // Step generoso pra afastar o texto da curva do L; preview também.
  const INDENT_STEP = 22;

  // Branches medidos por pai (mesma estratégia SVG do editor).
  const ulRef = useRef<HTMLUListElement | null>(null);
  const liRefs = useRef<Map<number, HTMLLIElement>>(new Map());
  const [branches, setBranches] = useState<Array<{
    key: number; top: number; left: number; width: number; height: number; childYs: number[];
  }>>([]);

  useLayoutEffect(() => {
    const ul = ulRef.current;
    if (!ul) return;
    const ulRect = ul.getBoundingClientRect();
    // mt-1 (4px) + half marker (8px) — center y dentro do <li>
    const MARKER_Y = 12;
    const ARM_W = INDENT_STEP - 12;
    const next: typeof branches = [];

    for (const item of visibleItems) {
      if (item.id == null) continue;
      const directChildren = visibleItems.filter((it) => it.parent === item.id);
      if (directChildren.length === 0) continue;
      const parentEl = liRefs.current.get(item.id);
      if (!parentEl) continue;
      const parentMarkerY =
        parentEl.getBoundingClientRect().top - ulRect.top + MARKER_Y;

      const childYs: number[] = [];
      for (const child of directChildren) {
        if (child.id == null) continue;
        const childEl = liRefs.current.get(child.id);
        if (!childEl) continue;
        const childMarkerY =
          childEl.getBoundingClientRect().top - ulRect.top + MARKER_Y;
        childYs.push(childMarkerY - parentMarkerY);
      }
      if (childYs.length === 0) continue;

      const parentDepth = depthOf(item);
      next.push({
        key: item.id,
        top: parentMarkerY,
        // Marker do pai começa em x=0 no slot (sem drag handle no preview);
        // centro do marcador ≈ 8px.
        left: parentDepth * INDENT_STEP + 8,
        width: ARM_W,
        height: Math.max(...childYs),
        childYs,
      });
    }

    setBranches((prev) => {
      const same =
        prev.length === next.length &&
        prev.every((p, i) => {
          const n = next[i];
          return (
            p.key === n.key && p.top === n.top && p.left === n.left &&
            p.width === n.width && p.height === n.height &&
            p.childYs.length === n.childYs.length &&
            p.childYs.every((y, k) => y === n.childYs[k])
          );
        });
      return same ? prev : next;
    });
  });

  return (
    <div
      style={getNoteStyle(note.color, isDark)}
      className={cn(
        'group min-w-0 w-full overflow-hidden rounded-lg border border-[var(--color-border)] shadow-sm transition-shadow hover:shadow-md bg-[var(--color-card)]',
        selected && 'ring-2 ring-[var(--color-primary)] border-[var(--color-primary)]',
      )}
    >
      <div className="relative cursor-pointer" onClick={onClick}>
        {!selectionMode && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onTogglePin();
            }}
            className="absolute right-2 top-2 rounded-full p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-background/60 hover:text-foreground group-hover:opacity-100"
            title={note.pinned ? 'Desafixar' : 'Fixar'}
          >
            {note.pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
          </button>
        )}
        <div className="min-w-0 p-3 space-y-2">
          {note.title && (
            <h3 className="min-w-0 pr-8 text-sm font-medium leading-snug break-words [overflow-wrap:anywhere]">
              {note.title}
            </h3>
          )}
          {visibleItems.length > 0 && (
            <ul ref={ulRef} className="relative min-w-0 space-y-1.5">
              {/* Overlay: 1 SVG por pai com trunk + arms. */}
              {branches.map((b) => (
                <svg
                  key={`br-${b.key}`}
                  aria-hidden
                  className="pointer-events-none absolute overflow-visible text-[var(--color-muted-foreground)]/30"
                  style={{
                    top: `${b.top}px`,
                    left: `${b.left}px`,
                    width: `${b.width + 1}px`,
                    height: `${b.height + 1}px`,
                  }}
                >
                  <line
                    x1={0.5} y1={0} x2={0.5} y2={b.height}
                    stroke="currentColor" strokeWidth={1}
                  />
                  {b.childYs.map((y, i) => (
                    <line
                      key={i}
                      x1={0.5} y1={y} x2={b.width} y2={y}
                      stroke="currentColor" strokeWidth={1}
                    />
                  ))}
                </svg>
              ))}
              {visibleItems.map((it, idx) => {
                const depth = depthOf(it);
                if (it.kind === 'todo') {
                  return (
                    <li
                      key={it.id ?? `idx-${idx}`}
                      ref={(el) => {
                        if (it.id == null) return;
                        if (el) liRefs.current.set(it.id, el);
                        else liRefs.current.delete(it.id);
                      }}
                      className="relative flex min-w-0 items-start gap-2 text-sm"
                      style={{ paddingLeft: `${depth * INDENT_STEP}px` }}
                    >

                      <input
                        type="checkbox"
                        checked={it.done}
                        disabled={selectionMode}
                        onChange={(e) => onToggleItem(idx, e.target.checked)}
                        onClick={(e) => e.stopPropagation()}
                        className={cn(
                          'mt-1 h-4 w-4 shrink-0 rounded border-border accent-primary',
                          selectionMode ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
                        )}
                      />
                      <span
                        className={cn(
                          'min-w-0 flex-1 break-words [overflow-wrap:anywhere]',
                          it.done && 'line-through text-muted-foreground',
                        )}
                      >
                        {it.text}
                      </span>
                    </li>
                  );
                }
                return (
                  <li
                    key={it.id ?? `idx-${idx}`}
                    ref={(el) => {
                      if (it.id == null) return;
                      if (el) liRefs.current.set(it.id, el);
                      else liRefs.current.delete(it.id);
                    }}
                    className="relative flex min-w-0 items-start gap-2 text-sm text-muted-foreground"
                    style={{ paddingLeft: `${depth * INDENT_STEP}px` }}
                  >

                    {/* Traço crisp via CSS (não caractere). mt-[11px] alinha
                        com o centro da primeira linha de texto (text-sm,
                        leading-snug ≈ 22px → centro y=11). */}
                    <span
                      aria-hidden
                      className="mt-[11px] block h-px w-2 shrink-0 bg-current"
                    />
                    <span className="min-w-0 flex-1 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                      {it.text}
                    </span>
                  </li>
                );
              })}
              {hiddenCount > 0 && (
                <li className="text-xs text-muted-foreground">+ {hiddenCount} bloco(s)</li>
              )}
            </ul>
          )}
          {!note.title && sortedItems.length === 0 && (
            <p className="text-sm italic text-muted-foreground">Anotação vazia</p>
          )}
        </div>
      </div>
      {!selectionMode && (
        <div className="flex items-center justify-end gap-0.5 px-2 pb-2 opacity-0 transition-opacity group-hover:opacity-100">
          <ColorPicker value={note.color} onChange={onChangeColor} />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            title={note.archived ? 'Desarquivar' : 'Arquivar'}
            onClick={(e) => {
              e.stopPropagation();
              onToggleArchive();
            }}
          >
            {note.archived ? (
              <ArchiveRestore className="h-4 w-4" />
            ) : (
              <Archive className="h-4 w-4" />
            )}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0 text-destructive hover:text-destructive"
            title="Excluir"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}

function NoteEditor({
  open,
  initial,
  onClose,
  onSave,
  onDelete,
  saving,
  isCreate = false,
}: {
  open: boolean;
  initial: DraftNote | null;
  onClose: () => void;
  onSave: (draft: DraftNote) => Promise<void>;
  onDelete: () => Promise<void>;
  saving: boolean;
  /** Modo criar: esconde botão de excluir, troca label do Salvar. */
  isCreate?: boolean;
}) {
  const [draft, setDraft] = useState<DraftNote>(emptyDraft());
  // _key do item recém-inserido — gerencia auto-focus após Enter / +Insert.
  const [autoFocusKey, setAutoFocusKey] = useState<string | null>(null);
  const isDark = useIsDark();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  // Refs pra medir o DOM e desenhar os trunks contínuos.
  const itemsContainerRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  // Branches medidos: para cada PAI com filhos diretos, um SVG com trunk
  // vertical + arms horizontais pra cada filho direto. Posicionado no
  // overlay sobre a lista de items.
  const [branches, setBranches] = useState<Array<{
    key: string;
    top: number;        // y absoluto da marca do pai dentro do container
    left: number;       // x absoluto da coluna do pai dentro do container
    width: number;      // largura do SVG (= comprimento do braço)
    height: number;     // altura do SVG (= trunk até o último filho direto)
    childYs: number[];  // y de cada filho direto, RELATIVO ao top do SVG
  }>>([]);

  useEffect(() => {
    if (open && initial) {
      setDraft({ ...initial });
      setAutoFocusKey(null);
    }
  }, [open, initial]);

  const byKey = useMemo(
    () => new Map(draft.items.map((it) => [it._key, it] as const)),
    [draft.items],
  );

  // Mede DOM e calcula, pra cada PAI com filhos diretos, um branch SVG:
  // trunk vertical do marcador do pai até o último filho direto + um arm
  // horizontal apontando pra cada filho direto. Grandchildren ganham seu
  // próprio branch (sub-trunk em outra coluna). Roda em useLayoutEffect
  // pra evitar flicker.
  useLayoutEffect(() => {
    if (!open) return;
    const container = itemsContainerRef.current;
    if (!container) return;
    const containerRect = container.getBoundingClientRect();
    const MARKER_Y_FROM_OUTER = 20; // InsertGap(6) + mt-1.5 (6) + half marker (8)
    const STEP_PX = 26;
    const ARM_W = STEP_PX - 12; // gap de 12px do trunk até o marcador do filho

    const next: typeof branches = [];
    for (const item of draft.items) {
      const directChildren = draft.items.filter((it) => it.parentKey === item._key);
      if (directChildren.length === 0) continue;
      const parentEl = itemRefs.current.get(item._key);
      if (!parentEl) continue;
      const parentTop = parentEl.getBoundingClientRect().top - containerRect.top;
      const parentMarkerY = parentTop + MARKER_Y_FROM_OUTER;

      const childYs: number[] = [];
      for (const child of directChildren) {
        const childEl = itemRefs.current.get(child._key);
        if (!childEl) continue;
        const childMarkerY =
          childEl.getBoundingClientRect().top - containerRect.top + MARKER_Y_FROM_OUTER;
        childYs.push(childMarkerY - parentMarkerY);
      }
      if (childYs.length === 0) continue;

      const parentDepth = indentOf(item, byKey);
      next.push({
        key: item._key,
        top: parentMarkerY,
        left: parentDepth * STEP_PX + 20,
        width: ARM_W,
        height: Math.max(...childYs),
        childYs,
      });
    }

    setBranches((prev) => {
      const same =
        prev.length === next.length &&
        prev.every((p, i) => {
          const n = next[i];
          return (
            p.key === n.key && p.top === n.top && p.left === n.left &&
            p.width === n.width && p.height === n.height &&
            p.childYs.length === n.childYs.length &&
            p.childYs.every((y, k) => y === n.childYs[k])
          );
        });
      return same ? prev : next;
    });
  });


  /** Insere um novo item em `index` (default: fim). Retorna o `_key` criado. */
  const insertItem = (
    kind: UserNoteItemKind,
    index?: number,
    parentKey: string | null = null,
  ): string => {
    const key = newKey();
    setDraft((prev) => {
      const arr = prev.items.slice();
      const at = index == null ? arr.length : Math.max(0, Math.min(arr.length, index));
      arr.splice(at, 0, {
        _key: key,
        kind,
        text: '',
        done: false,
        order: at,
        parentKey,
      });
      return { ...prev, items: arr };
    });
    setAutoFocusKey(key);
    return key;
  };

  const updateItem = (key: string, next: DraftItem) =>
    setDraft((prev) => ({
      ...prev,
      items: prev.items.map((it) => (it._key === key ? next : it)),
    }));

  /** Remove o item E todos os descendentes (sub-árvore inteira some). */
  const removeItem = (key: string) =>
    setDraft((prev) => {
      const descendants = new Set<string>([key]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const it of prev.items) {
          if (it.parentKey && descendants.has(it.parentKey) && !descendants.has(it._key)) {
            descendants.add(it._key);
            grew = true;
          }
        }
      }
      return { ...prev, items: prev.items.filter((it) => !descendants.has(it._key)) };
    });

  const convertItem = (key: string, next: UserNoteItemKind) =>
    setDraft((prev) => ({
      ...prev,
      items: prev.items.map((it) =>
        it._key === key ? { ...it, kind: next, done: next === 'todo' ? it.done : false } : it,
      ),
    }));

  /** Indenta o item: parent vira o item IMEDIATAMENTE ACIMA dele (no array
   * linear), desde que não crie ciclo nem exceda MAX_INDENT_DEPTH. */
  const indentItem = (key: string) =>
    setDraft((prev) => {
      const idx = prev.items.findIndex((it) => it._key === key);
      if (idx <= 0) return prev; // primeiro item não pode indentar
      const newParent = prev.items[idx - 1];
      const target = prev.items[idx];
      // Não permite criar ciclo: novo pai não pode ser descendente do alvo.
      if (isDescendantOf(newParent._key, key, prev.items)) return prev;
      const tentative = prev.items.map((it) =>
        it._key === key ? { ...it, parentKey: newParent._key } : it,
      );
      // Valida profundidade.
      const map = new Map(tentative.map((it) => [it._key, it] as const));
      if (indentOf(tentative[idx], map) > MAX_INDENT_DEPTH) return prev;
      return { ...prev, items: tentative };
    });

  /** Desindenta: parent vira o parent do parent atual (sobe um nível). */
  const outdentItem = (key: string) =>
    setDraft((prev) => {
      const item = prev.items.find((it) => it._key === key);
      if (!item || !item.parentKey) return prev;
      const parent = prev.items.find((it) => it._key === item.parentKey);
      const newParent = parent?.parentKey ?? null;
      return {
        ...prev,
        items: prev.items.map((it) =>
          it._key === key ? { ...it, parentKey: newParent } : it,
        ),
      };
    });

  /** Cria um novo item de mesmo tipo logo após `key`. Herda o parent. */
  const insertAfter = (key: string) => {
    const idx = draft.items.findIndex((it) => it._key === key);
    if (idx === -1) return;
    const source = draft.items[idx];
    insertItem(source.kind, idx + 1, source.parentKey);
  };

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over, delta } = e;
    if (!over || active.id === over.id) {
      // Drag sem reorder real — pode ainda querer mudar indent baseado em
      // delta horizontal puro.
      if (Math.abs(delta.x) > 30) {
        if (delta.x > 0) indentItem(String(active.id));
        else outdentItem(String(active.id));
      }
      return;
    }
    setDraft((prev) => {
      const oldIdx = prev.items.findIndex((it) => it._key === active.id);
      const newIdx = prev.items.findIndex((it) => it._key === over.id);
      if (oldIdx === -1 || newIdx === -1) return prev;
      const moved = arrayMove(prev.items, oldIdx, newIdx);
      // Mover um item move seus filhos junto: re-insere os descendentes
      // logo abaixo do item movido na ordem original deles.
      const movedKey = String(active.id);
      const descendantsInOrder = prev.items
        .filter((it) => it._key !== movedKey && isDescendantOf(it._key, movedKey, prev.items));
      const cleaned = moved.filter((it) => !descendantsInOrder.some((d) => d._key === it._key));
      const finalIdx = cleaned.findIndex((it) => it._key === movedKey);
      const out = [
        ...cleaned.slice(0, finalIdx + 1),
        ...descendantsInOrder,
        ...cleaned.slice(finalIdx + 1),
      ];
      return { ...prev, items: out };
    });
    // Após o reorder, ajusta indent se houve delta horizontal significativo.
    if (Math.abs(delta.x) > 30) {
      if (delta.x > 0) indentItem(String(active.id));
      else outdentItem(String(active.id));
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) void onSave(draft).then(onClose);
      }}
    >
      <DialogContent
        style={getNoteStyle(draft.color, isDark)}
        className="max-w-lg p-0"
      >
        <DialogHeader className="px-4 pt-4 pb-2">
          <DialogTitle className="sr-only">Editar anotação</DialogTitle>
          <DialogDescription className="sr-only">
            Edite o título e os blocos de conteúdo da anotação.
          </DialogDescription>
          <Input
            value={draft.title}
            onChange={(e) => setDraft((prev) => ({ ...prev, title: e.target.value }))}
            placeholder="Título"
            maxLength={NOTE_TITLE_MAX}
            className="h-8 border-0 bg-transparent px-1 text-base font-medium shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
          />
        </DialogHeader>
        <div className="space-y-0 px-4 pb-2">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={draft.items.map((it) => it._key)}
              strategy={verticalListSortingStrategy}
            >
              <div ref={itemsContainerRef} className="relative">
                {/* Overlay: 1 SVG por pai com filhos diretos — desenha trunk
                    vertical + arms horizontais. Único elemento por branch
                    (em vez de N spans). */}
                {branches.map((b) => (
                  <svg
                    key={`br-${b.key}`}
                    aria-hidden
                    className="pointer-events-none absolute overflow-visible text-[var(--color-muted-foreground)]/30"
                    style={{
                      top: `${b.top}px`,
                      left: `${b.left}px`,
                      width: `${b.width + 1}px`,
                      height: `${b.height + 1}px`,
                    }}
                  >
                    {/* Trunk vertical (x=0.5 pra crispness em 1px) */}
                    <line
                      x1={0.5} y1={0} x2={0.5} y2={b.height}
                      stroke="currentColor" strokeWidth={1}
                    />
                    {/* Arms horizontais — um por filho direto */}
                    {b.childYs.map((y, i) => (
                      <line
                        key={i}
                        x1={0.5} y1={y} x2={b.width} y2={y}
                        stroke="currentColor" strokeWidth={1}
                      />
                    ))}
                  </svg>
                ))}
              {draft.items.map((it, idx) => (
                <div
                  key={it._key}
                  ref={(el) => {
                    if (el) itemRefs.current.set(it._key, el);
                    else itemRefs.current.delete(it._key);
                  }}
                >
                  {/* Gap pra inserir item ACIMA deste */}
                  <InsertGap onInsert={(kind) => insertItem(kind, idx, it.parentKey)} />
                  <SortableItemBlock
                    id={it._key}
                    item={it}
                    indent={indentOf(it, byKey)}
                    autoFocus={
                      autoFocusKey === it._key ||
                      (autoFocusKey === null &&
                        idx === draft.items.length - 1 &&
                        !it.text)
                    }
                    onChange={(next) => updateItem(it._key, next)}
                    onRemove={() => removeItem(it._key)}
                    onConvert={(kind) => convertItem(it._key, kind)}
                    onEnter={() => insertAfter(it._key)}
                    onIndent={() => indentItem(it._key)}
                    onOutdent={() => outdentItem(it._key)}
                  />
                </div>
              ))}
              </div>
            </SortableContext>
            {/* Gap final pra inserir item ao FIM */}
            <InsertGap onInsert={(kind) => insertItem(kind)} />
          </DndContext>

          <div className="flex items-center gap-3 pt-2">
            <button
              type="button"
              onClick={() => insertItem('text')}
              className="flex items-center gap-1.5 px-1 py-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <Plus className="h-3.5 w-3.5" />
              Adicionar texto
            </button>
            <button
              type="button"
              onClick={() => insertItem('todo')}
              className="flex items-center gap-1.5 px-1 py-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <CheckSquare className="h-3.5 w-3.5" />
              Adicionar item de lista
            </button>
          </div>
        </div>
        <DialogFooter className="flex items-center justify-between gap-2 border-t border-border/40 bg-background/40 px-3 py-2 sm:justify-between">
          <div className="flex items-center gap-1">
            <ColorPicker
              value={draft.color}
              onChange={(color) => setDraft((prev) => ({ ...prev, color }))}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              title={draft.pinned ? 'Desafixar' : 'Fixar'}
              onClick={() => setDraft((prev) => ({ ...prev, pinned: !prev.pinned }))}
            >
              {draft.pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              title={draft.archived ? 'Desarquivar' : 'Arquivar'}
              onClick={() => setDraft((prev) => ({ ...prev, archived: !prev.archived }))}
            >
              {draft.archived ? (
                <ArchiveRestore className="h-4 w-4" />
              ) : (
                <Archive className="h-4 w-4" />
              )}
            </Button>
            {!isCreate && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                title="Excluir"
                onClick={() => void onDelete()}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
          <Button
            type="button"
            size="sm"
            onClick={() => void onSave(draft).then(onClose)}
            disabled={saving}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4 mr-1" />}
            {isCreate ? 'Criar' : 'Fechar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function MyTasks() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<'notes' | 'pins'>('notes');
  const [notes, setNotes] = useState<UserNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<NoteFilter>('active');
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [creatingOpen, setCreatingOpen] = useState(false);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [noteToDelete, setNoteToDelete] = useState<number | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  // Flag pra suprimir o auto-save do editor quando o fechamento vem de uma
  // exclusão bem-sucedida (sem essa flag, o PATCH dispararia pra um id que já
  // não existe → 404 cosmético com toast "Falha ao salvar a anotação").
  const skipNextEditorSaveRef = useRef(false);

  // Seleção múltipla (mesma UX do kanban: botão "Selecionar", barra inferior
  // com contagem + ações, dialog de confirmação para exclusão em massa).
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedNoteIds, setSelectedNoteIds] = useState<number[]>([]);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkDeleteLoading, setBulkDeleteLoading] = useState(false);

  const toggleNoteSelected = useCallback((id: number) => {
    setSelectedNoteIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }, []);

  const exitSelectionMode = useCallback(() => {
    setSelectionMode(false);
    setSelectedNoteIds([]);
  }, []);

  // Aba "Cards Fixados"
  const [pinnedCards, setPinnedCards] = useState<CardPin[]>([]);
  const [pinsLoading, setPinsLoading] = useState(false);
  const [pinsError, setPinsError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await userNoteService.list();
      setNotes(data);
    } catch (err) {
      console.error('Erro ao carregar anotações:', err);
      setError('Não foi possível carregar as anotações.');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadPins = useCallback(async () => {
    setPinsLoading(true);
    setPinsError(null);
    try {
      const data = await cardPinService.list();
      setPinnedCards(data);
    } catch (err) {
      console.error('Erro ao carregar cards fixados:', err);
      setPinsError('Não foi possível carregar os cards fixados.');
    } finally {
      setPinsLoading(false);
    }
  }, []);

  // Carrega notas no mount
  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (tab === 'pins') void loadPins();
  }, [tab, loadPins]);

  // Sair do modo seleção (e limpar IDs marcados) sempre que o usuário mudar de
  // aba ou de filtro — evita confusão de selecionar X notas ativas, trocar pra
  // arquivadas e clicar "Apagar" sem ver o que vai ser excluído.
  useEffect(() => {
    setSelectionMode(false);
    setSelectedNoteIds([]);
  }, [tab, filter]);

  const handleUnpin = useCallback(async (cardId: string) => {
    try {
      await cardPinService.unpin(cardId);
      setPinnedCards((prev) => prev.filter((p) => p.card !== cardId));
    } catch (err) {
      console.error('Erro ao desafixar card:', err);
      setPinsError('Falha ao desafixar o card.');
    }
  }, []);

  const handleOpenCard = useCallback(
    (pin: CardPin) => {
      const projectId = pin.card_detail.projeto;
      if (!projectId) return;
      navigate(ROUTES.projetoCard(projectId, pin.card));
    },
    [navigate],
  );

  const handleCreate = useCallback(
    async (draft: DraftNote) => {
      if (isDraftEmpty(draft)) return;
      setCreating(true);
      try {
        const created = await userNoteService.create(draftToPayload(draft));
        setNotes((prev) => [created, ...prev]);
      } catch (err) {
        console.error('Erro ao criar anotação:', err);
        setError('Falha ao criar a anotação.');
      } finally {
        setCreating(false);
      }
    },
    [],
  );

  const patchNote = useCallback(
    async (id: number, payload: Partial<ReturnType<typeof draftToPayload>>) => {
      setSavingId(id);
      try {
        const updated = await userNoteService.update(id, payload);
        setNotes((prev) => prev.map((n) => (n.id === id ? updated : n)));
        return updated;
      } catch (err) {
        console.error('Erro ao atualizar anotação:', err);
        setError('Falha ao salvar a anotação.');
        return null;
      } finally {
        setSavingId(null);
      }
    },
    [],
  );

  const handleSaveDraft = useCallback(
    async (draft: DraftNote) => {
      // Quando o editor é fechado em consequência de uma exclusão, suprimimos
      // o auto-save (caso contrário PATCH 404 + toast de erro espúrio).
      if (skipNextEditorSaveRef.current) {
        skipNextEditorSaveRef.current = false;
        return;
      }
      if (draft.id == null) return;
      await patchNote(draft.id, draftToPayload(draft));
    },
    [patchNote],
  );

  // Apenas dispara a confirmação. A exclusão real está em `confirmDelete`.
  const handleDelete = useCallback((id: number) => {
    setNoteToDelete(id);
  }, []);

  const handleBulkDeleteConfirm = useCallback(async () => {
    if (selectedNoteIds.length === 0) return;
    setBulkDeleteLoading(true);
    const failed: number[] = [];
    for (const id of selectedNoteIds) {
      try {
        await userNoteService.delete(id);
      } catch (err) {
        console.error('Erro ao excluir anotação em massa', id, err);
        failed.push(id);
      }
    }
    // Se o editor estava aberto numa nota deletada, suprime o auto-save.
    setEditingId((cur) => {
      if (cur != null && selectedNoteIds.includes(cur) && !failed.includes(cur)) {
        skipNextEditorSaveRef.current = true;
        return null;
      }
      return cur;
    });
    setNotes((prev) =>
      prev.filter((n) => !selectedNoteIds.includes(n.id) || failed.includes(n.id)),
    );
    setSelectedNoteIds(failed);
    setBulkDeleteLoading(false);
    setBulkDeleteOpen(false);
    if (failed.length === 0) {
      exitSelectionMode();
    } else {
      setError(`${failed.length} anotação(ões) não puderam ser excluídas.`);
    }
  }, [selectedNoteIds, exitSelectionMode]);

  const confirmDelete = useCallback(async () => {
    if (noteToDelete == null) return;
    setDeleteLoading(true);
    try {
      await userNoteService.delete(noteToDelete);
      // Se essa nota está aberta no editor, marcamos pra suprimir o auto-save
      // que o `onOpenChange(false)` dispararia ao fechar o dialog.
      setEditingId((cur) => {
        if (cur === noteToDelete) {
          skipNextEditorSaveRef.current = true;
          return null;
        }
        return cur;
      });
      setNotes((prev) => prev.filter((n) => n.id !== noteToDelete));
      setNoteToDelete(null);
    } catch (err) {
      console.error('Erro ao excluir anotação:', err);
      setError('Falha ao excluir a anotação.');
      // Mantém o dialog aberto pra usuário ver o erro e tentar de novo.
    } finally {
      setDeleteLoading(false);
    }
  }, [noteToDelete]);

  const togglePin = useCallback(
    (note: UserNote) => patchNote(note.id, { pinned: !note.pinned }),
    [patchNote],
  );

  const toggleArchive = useCallback(
    (note: UserNote) =>
      patchNote(note.id, { archived: !note.archived, pinned: note.archived ? note.pinned : false }),
    [patchNote],
  );

  const changeColor = useCallback(
    (note: UserNote, color: UserNoteColor) => patchNote(note.id, { color }),
    [patchNote],
  );

  // Sensors p/ DnD de cards. Distance > 6px evita clique acidental virar drag.
  const cardsDndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // ID da nota sendo arrastada — alimenta o <DragOverlay> com o clone que
  // segue o cursor. O original vira placeholder invisível enquanto isso.
  const [activeNoteId, setActiveNoteId] = useState<number | null>(null);
  const activeNote = useMemo(
    () => (activeNoteId != null ? notes.find((n) => n.id === activeNoteId) ?? null : null),
    [activeNoteId, notes],
  );

  /** Reordena as notes de uma section (pinned ou outras) e dispara PATCH de
   * `order` em paralelo. Atualização otimista — em caso de erro, reverte. */
  const reorderNotes = useCallback(
    async (section: 'pinned' | 'others', activeId: number, overId: number) => {
      if (activeId === overId) return;
      const snapshot = notes;
      // IMPORTANTE: filtrar E sortear pelo MESMO critério visual (pinned/others
      // useMemo usa sortBySectionOrder). Sem sortear aqui, findIndex retorna
      // posições do array bruto que não casam com a ordem visual — drag dá
      // arrayMove errado.
      const sortFn = (a: UserNote, b: UserNote) => {
        if (a.order !== b.order) return a.order - b.order;
        return b.updated_at.localeCompare(a.updated_at);
      };
      const sectionNotes = snapshot
        .filter((n) =>
          section === 'pinned' ? n.pinned && !n.archived : !n.pinned && !n.archived,
        )
        .sort(sortFn);
      const oldIdx = sectionNotes.findIndex((n) => n.id === activeId);
      const newIdx = sectionNotes.findIndex((n) => n.id === overId);
      if (oldIdx === -1 || newIdx === -1) return;
      const reordered = arrayMove(sectionNotes, oldIdx, newIdx);
      // Atribui novo `order` sequencial (0..N-1) dentro da section.
      const updates = reordered.map((n, i) => ({ id: n.id, order: i }));
      const updatesById = new Map(updates.map((u) => [u.id, u.order]));
      setNotes((prev) =>
        prev.map((n) =>
          updatesById.has(n.id) ? { ...n, order: updatesById.get(n.id)! } : n,
        ),
      );
      try {
        await Promise.all(
          updates
            .filter((u) => {
              const original = snapshot.find((n) => n.id === u.id);
              return original && original.order !== u.order;
            })
            .map((u) => userNoteService.update(u.id, { order: u.order })),
        );
      } catch (err) {
        console.error('Erro ao reordenar notas:', err);
        setError('Falha ao salvar a nova ordem. Recarregue a página.');
        setNotes(snapshot);
      }
    },
    [notes],
  );

  const toggleItemOnCard = useCallback(
    async (note: UserNote, itemIdx: number, done: boolean) => {
      const sorted = (note.items || []).slice().sort((a, b) => a.order - b.order);
      const nextItems = sorted.map((it, idx) => ({
        kind: it.kind,
        text: it.text,
        done: it.kind === 'todo' && idx === itemIdx ? done : it.done,
        order: idx,
      }));
      await patchNote(note.id, { items: nextItems });
    },
    [patchNote],
  );

  const filteredNotes = useMemo(() => {
    const term = search.trim().toLowerCase();
    return notes
      .filter((n) => (filter === 'archived' ? n.archived : !n.archived))
      .filter((n) => {
        if (!term) return true;
        const haystack = [n.title, ...(n.items || []).map((it) => it.text)]
          .join(' ')
          .toLowerCase();
        return haystack.includes(term);
      });
  }, [notes, filter, search]);

  /** Ordena por `order` ASC (definido pelo drag); tie-break: updated_at DESC
   * (mais recente primeiro — alinha com o ordering default do backend
   * `['-pinned', 'order', '-updated_at']`). Sem esse sort, reorder via drag
   * só atualizava o campo `order` mas a UI ficava na mesma ordem do array. */
  const sortBySectionOrder = (a: UserNote, b: UserNote) => {
    if (a.order !== b.order) return a.order - b.order;
    return b.updated_at.localeCompare(a.updated_at);
  };
  const pinned = useMemo(
    () => filteredNotes.filter((n) => n.pinned).sort(sortBySectionOrder),
    [filteredNotes],
  );
  const others = useMemo(
    () => filteredNotes.filter((n) => !n.pinned).sort(sortBySectionOrder),
    [filteredNotes],
  );

  const editingNote = useMemo(
    () => (editingId != null ? notes.find((n) => n.id === editingId) : null),
    [editingId, notes],
  );
  const editingDraft = useMemo(
    () => (editingNote ? toDraft(editingNote) : null),
    [editingNote],
  );
  // Estabiliza o `initial` do editor em modo create — sem useMemo o objeto vinha
  // novo a cada render e disparava o useEffect do NoteEditor em loop.
  const creatingInitial = useMemo(() => (creatingOpen ? emptyDraft() : null), [creatingOpen]);

  return (
    <div className="space-y-[24px]">
      <div>
        <h1 className="text-2xl font-bold text-[var(--color-foreground)]">Meus Afazeres</h1>
        <p className="text-sm text-[var(--color-muted-foreground)] mt-1">
          Anotações, listas e lembretes pessoais. Apenas você vê suas anotações.
        </p>
      </div>

      {/* Tabs (mesmo padrão de Prioridades/GeekDay) */}
      <div className="flex items-center gap-[8px] border-b border-[var(--color-border)] shrink-0">
        <Button
          variant="ghost"
          onClick={() => setTab('notes')}
          className={cn(
            'rounded-none border-b-2 border-transparent px-[16px] py-[8px] h-auto',
            tab === 'notes'
              ? 'border-[var(--color-primary)] text-[var(--color-primary)] font-semibold'
              : 'text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]',
          )}
        >
          <StickyNote className="mr-1.5 h-4 w-4" />
          Anotações
        </Button>
        <Button
          variant="ghost"
          onClick={() => setTab('pins')}
          className={cn(
            'rounded-none border-b-2 border-transparent px-[16px] py-[8px] h-auto',
            tab === 'pins'
              ? 'border-[var(--color-primary)] text-[var(--color-primary)] font-semibold'
              : 'text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]',
          )}
        >
          <Pin className="mr-1.5 h-4 w-4" />
          Cards Fixados
          {pinnedCards.length > 0 && (
            <span className="ml-1.5 rounded-full bg-[var(--color-primary)]/10 px-1.5 py-0.5 text-[10px] font-semibold text-[var(--color-primary)]">
              {pinnedCards.length}
            </span>
          )}
        </Button>
        {tab === 'notes' && (
          <div className="ml-auto inline-flex rounded-md border border-border bg-card p-0.5 text-sm">
            <button
              type="button"
              onClick={() => setFilter('active')}
              className={cn(
                'rounded-sm px-3 py-1 transition-colors',
                filter === 'active'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              Ativas
            </button>
            <button
              type="button"
              onClick={() => setFilter('archived')}
              className={cn(
                'rounded-sm px-3 py-1 transition-colors',
                filter === 'archived'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              Arquivadas
            </button>
          </div>
        )}
      </div>

      {tab === 'notes' && (
        <div>
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
            {/* Search ocupa o máximo de espaço disponível (flex-1). */}
            <div className="relative flex-1 min-w-0">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar anotações..."
                className="pl-9"
              />
            </div>
            {/* Botões à direita da search */}
            {filter === 'active' && !selectionMode && (
              <Button
                type="button"
                onClick={() => setCreatingOpen(true)}
                className="shrink-0"
                style={{
                  background: 'linear-gradient(135deg, #754c99, #8fd0d7)',
                  color: '#ffffff',
                  border: 'none',
                  boxShadow: '0 4px 14px rgba(117,76,153,0.35)',
                }}
              >
                <Plus className="h-4 w-4 mr-2" />
                Criar anotação
              </Button>
            )}
            <Button
              type="button"
              variant={selectionMode ? 'default' : 'outline'}
              onClick={() => {
                if (selectionMode) exitSelectionMode();
                else setSelectionMode(true);
              }}
              className="shrink-0"
            >
              <CheckSquare className="h-4 w-4 mr-2" />
              {selectionMode ? 'Sair da seleção' : 'Selecionar anotações'}
            </Button>
          </div>

          {error && (
            <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
              Carregando anotações...
            </div>
          ) : filter === 'archived' && filteredNotes.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-16 text-center text-muted-foreground">
              <StickyNote className="h-10 w-10 mb-3 opacity-50" />
              <p className="text-sm">
                {search
                  ? 'Nenhuma anotação encontrada para sua busca.'
                  : 'Nenhuma anotação arquivada.'}
              </p>
            </div>
          ) : (
            <LayoutGroup>
              <div className="space-y-6">
                {pinned.length > 0 && (
                  <section>
                    <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Fixadas
                    </h2>
                    <DndContext
                      sensors={cardsDndSensors}
                      collisionDetection={closestCenter}
                      onDragStart={(e) => setActiveNoteId(Number(e.active.id))}
                      onDragCancel={() => setActiveNoteId(null)}
                      onDragEnd={(e) => {
                        setActiveNoteId(null);
                        if (e.over && e.active.id !== e.over.id) {
                          void reorderNotes(
                            'pinned',
                            Number(e.active.id),
                            Number(e.over.id),
                          );
                        }
                      }}
                    >
                      <SortableContext
                        items={pinned.map((n) => n.id)}
                        strategy={noScaleRectSortingStrategy}
                      >
                        <Masonry breakpoints={NOTES_MASONRY_BREAKPOINTS}>
                          {pinned.map((note) => (
                            <SortableNoteCardWrapper
                              key={note.id}
                              noteId={note.id}
                              layoutId={`note-${note.id}`}
                            >
                              {() => (
                                <NoteCard
                                  note={note}
                                  selectionMode={selectionMode}
                                  selected={selectedNoteIds.includes(note.id)}
                                  onClick={() =>
                                    selectionMode
                                      ? toggleNoteSelected(note.id)
                                      : setEditingId(note.id)
                                  }
                                  onTogglePin={() => void togglePin(note)}
                                  onToggleArchive={() => void toggleArchive(note)}
                                  onDelete={() => handleDelete(note.id)}
                                  onChangeColor={(color) => void changeColor(note, color)}
                                  onToggleItem={(idx, done) =>
                                    void toggleItemOnCard(note, idx, done)
                                  }
                                />
                              )}
                            </SortableNoteCardWrapper>
                          ))}
                        </Masonry>
                      </SortableContext>
                      <DragOverlay
                        dropAnimation={{
                          duration: 220,
                          easing: 'cubic-bezier(0.25, 1, 0.5, 1)',
                        }}
                      >
                        {activeNote && pinned.some((n) => n.id === activeNote.id) ? (
                          <DragPreviewCard note={activeNote} />
                        ) : null}
                      </DragOverlay>
                    </DndContext>
                  </section>
                )}
                <section>
                  {pinned.length > 0 && (
                    <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Outras
                    </h2>
                  )}
                  <DndContext
                    sensors={cardsDndSensors}
                    collisionDetection={closestCenter}
                    onDragStart={(e) => setActiveNoteId(Number(e.active.id))}
                    onDragCancel={() => setActiveNoteId(null)}
                    onDragEnd={(e) => {
                      setActiveNoteId(null);
                      if (e.over && e.active.id !== e.over.id) {
                        void reorderNotes(
                          'others',
                          Number(e.active.id),
                          Number(e.over.id),
                        );
                      }
                    }}
                  >
                    <SortableContext
                      items={others.map((n) => n.id)}
                      strategy={noScaleRectSortingStrategy}
                    >
                      <Masonry breakpoints={NOTES_MASONRY_BREAKPOINTS}>
                        {others.map((note) => (
                          <SortableNoteCardWrapper
                            key={note.id}
                            noteId={note.id}
                            layoutId={`note-${note.id}`}
                          >
                            {() => (
                              <NoteCard
                                note={note}
                                selectionMode={selectionMode}
                                selected={selectedNoteIds.includes(note.id)}
                                onClick={() =>
                                  selectionMode
                                    ? toggleNoteSelected(note.id)
                                    : setEditingId(note.id)
                                }
                                onTogglePin={() => void togglePin(note)}
                                onToggleArchive={() => void toggleArchive(note)}
                                onDelete={() => handleDelete(note.id)}
                                onChangeColor={(color) => void changeColor(note, color)}
                                onToggleItem={(idx, done) =>
                                  void toggleItemOnCard(note, idx, done)
                                }
                              />
                            )}
                          </SortableNoteCardWrapper>
                        ))}
                      </Masonry>
                    </SortableContext>
                    <DragOverlay
                      dropAnimation={{
                        duration: 220,
                        easing: 'cubic-bezier(0.25, 1, 0.5, 1)',
                      }}
                    >
                      {activeNote && others.some((n) => n.id === activeNote.id) ? (
                        <DragPreviewCard note={activeNote} />
                      ) : null}
                    </DragOverlay>
                  </DndContext>
                </section>
              </div>
            </LayoutGroup>
          )}
        </div>
      )}

      {tab === 'pins' && (
        <div>
          {pinsError && (
            <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {pinsError}
            </div>
          )}
          {pinsLoading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
              Carregando cards fixados...
            </div>
          ) : pinnedCards.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-16 text-center text-muted-foreground">
              <Pin className="h-10 w-10 mb-3 opacity-50" />
              <p className="text-sm">
                Nenhum card fixado. Clique no <Pin className="inline h-3.5 w-3.5 mx-1" />
                ao lado da lixeira de um card no Kanban para fixá-lo aqui.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {pinnedCards.map((pin) => (
                <KanbanCardPreview
                  key={pin.id}
                  card={pin.card_detail}
                  onClick={() => handleOpenCard(pin)}
                  topRightSlot={
                    <button
                      type="button"
                      title="Desafixar"
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleUnpin(pin.card);
                      }}
                      className="rounded-full p-1 text-muted-foreground hover:bg-background/60 hover:text-foreground"
                    >
                      <PinOff className="h-3.5 w-3.5" />
                    </button>
                  }
                />
              ))}
            </div>
          )}
        </div>
      )}

      <NoteEditor
        open={editingId != null}
        initial={editingDraft}
        onClose={() => setEditingId(null)}
        onSave={handleSaveDraft}
        onDelete={async () => {
          if (editingId != null) await handleDelete(editingId);
        }}
        saving={savingId != null}
      />

      <NoteEditor
        open={creatingOpen}
        initial={creatingInitial}
        onClose={() => setCreatingOpen(false)}
        onSave={async (draft) => {
          await handleCreate(draft);
        }}
        onDelete={async () => setCreatingOpen(false)}
        saving={creating}
        isCreate
      />

      {/* Barra inferior flutuante (mesmo padrão do kanban) */}
      {selectedNoteIds.length > 0 && (
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center px-4">
          <div className="pointer-events-auto flex max-w-[min(100%,560px)] flex-wrap items-center justify-center gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-background)] px-5 py-3 shadow-lg">
            <span className="text-sm font-medium text-[var(--color-foreground)]">
              {selectedNoteIds.length} anotação(ões) selecionada(s)
            </span>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={() => setBulkDeleteOpen(true)}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Apagar
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={exitSelectionMode}>
              Cancelar
            </Button>
          </div>
        </div>
      )}

      {/* Dialog de confirmação de exclusão em massa */}
      <Dialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <DialogContent onClose={() => setBulkDeleteOpen(false)}>
          <DialogHeader>
            <DialogTitle>Apagar anotações selecionadas</DialogTitle>
            <DialogDescription>
              {selectedNoteIds.length} anotação(ões) serão removidas permanentemente.
              Esta ação não pode ser desfeita.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setBulkDeleteOpen(false)}
              disabled={bulkDeleteLoading}
            >
              Voltar
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void handleBulkDeleteConfirm()}
              disabled={bulkDeleteLoading}
            >
              {bulkDeleteLoading ? (
                <>
                  <Loader2 className="mr-[8px] h-[16px] w-[16px] animate-spin" />
                  Excluindo...
                </>
              ) : (
                'Confirmar exclusão'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={noteToDelete != null}
        onOpenChange={(o) => {
          if (!o) setNoteToDelete(null);
        }}
      >
        <DialogContent onClose={() => setNoteToDelete(null)}>
          <DialogHeader>
            <DialogTitle>Confirmar exclusão</DialogTitle>
            <DialogDescription>
              Tem certeza que deseja excluir esta anotação? Esta ação não pode ser desfeita.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setNoteToDelete(null)}
              disabled={deleteLoading}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void confirmDelete()}
              disabled={deleteLoading}
            >
              {deleteLoading ? (
                <>
                  <Loader2 className="mr-[8px] h-[16px] w-[16px] animate-spin" />
                  Excluindo...
                </>
              ) : (
                'Excluir'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

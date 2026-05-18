import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
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
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
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
} from '@/services/userNoteService';
import { cardPinService, type CardPin } from '@/services/cardPinService';
import { KanbanCardPreview } from '@/components/KanbanCardPreview';
import { ROUTES } from '@/routes';
import { cn } from '@/lib/utils';

type NoteFilter = 'active' | 'archived';

// Cada bloco do draft tem um _key estável p/ React; o id do backend (quando
// existe) é descartado já que a estratégia de update é replace-all no servidor.
type DraftItem = UserNoteItem & { _key: string };

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

/** Breakpoints (px do viewport → nº de colunas) usados pelo Masonry de notas
 * e de cards fixados. Espelha os antigos columns-1 / sm:columns-2 / lg:3 / xl:4. */
const NOTES_MASONRY_BREAKPOINTS = { default: 1, 640: 2, 1024: 3, 1280: 4 };

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
  return {
    id: note.id,
    title: note.title,
    color: note.color,
    pinned: note.pinned,
    archived: note.archived,
    items: (note.items || [])
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((it) => ({ ...it, _key: it.id != null ? `id-${it.id}` : newKey() })),
  };
}

function emptyDraft(): DraftNote {
  return {
    title: '',
    color: 'default',
    pinned: false,
    archived: false,
    // Começa com um único bloco de texto vazio para o usuário digitar logo de cara.
    items: [{ _key: newKey(), kind: 'text', text: '', done: false, order: 0 }],
  };
}

function isDraftEmpty(draft: DraftNote): boolean {
  return !draft.title.trim() && draft.items.every((it) => !it.text.trim());
}

function draftToPayload(draft: DraftNote) {
  const cleanItems = draft.items
    .filter((it) => it.text.trim().length > 0)
    .map((it, index) => ({
      kind: it.kind,
      text: it.text.trim(),
      done: it.kind === 'todo' ? it.done : false,
      order: index,
    }));
  return {
    title: draft.title.trim(),
    color: draft.color,
    pinned: draft.pinned,
    archived: draft.archived,
    items: cleanItems,
  };
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

/** Renderiza um bloco do conteúdo da nota — texto ou checklist — no editor.
 * Permite converter entre os dois tipos via botão hover. */
function ItemBlock({
  item,
  onChange,
  onRemove,
  onConvert,
  autoFocus,
}: {
  item: DraftItem;
  onChange: (next: DraftItem) => void;
  onRemove: () => void;
  onConvert: (next: UserNoteItemKind) => void;
  autoFocus?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!autoFocus) return;
    if (item.kind === 'todo') inputRef.current?.focus();
    else textareaRef.current?.focus();
  }, [autoFocus, item.kind]);

  // Reajusta a altura sempre que o texto mudar OU o componente montar com
  // valor inicial (caso da nota carregada do servidor com texto longo).
  useEffect(() => {
    if (item.kind === 'text') autoResize(textareaRef.current);
  }, [item.kind, item.text]);

  return (
    <div className="group flex items-start gap-2">
      {item.kind === 'todo' ? (
        <input
          type="checkbox"
          checked={item.done}
          onChange={(e) => onChange({ ...item, done: e.target.checked })}
          className="mt-1.5 h-4 w-4 shrink-0 cursor-pointer rounded border-border accent-primary"
        />
      ) : (
        // Bolinha "marcador" pra alinhar visualmente com checkbox; clica pra converter pra todo
        <button
          type="button"
          onClick={() => onConvert('todo')}
          title="Converter em item de lista"
          className="mt-1.5 h-4 w-4 shrink-0 rounded-sm border border-dashed border-[var(--color-muted-foreground)]/40 opacity-0 transition-opacity group-hover:opacity-100"
        />
      )}
      {item.kind === 'todo' ? (
        <Input
          ref={inputRef}
          value={item.text}
          onChange={(e) => onChange({ ...item, text: e.target.value })}
          placeholder="Item da lista"
          maxLength={NOTE_ITEM_TEXT_MAX}
          className={cn(
            'h-auto min-h-[28px] border-0 bg-transparent px-1 py-0.5 text-sm shadow-none focus-visible:ring-0 focus-visible:ring-offset-0',
            item.done && 'line-through text-muted-foreground',
          )}
        />
      ) : (
        <Textarea
          ref={textareaRef}
          value={item.text}
          onChange={(e) => onChange({ ...item, text: e.target.value })}
          onInput={(e) => autoResize(e.currentTarget)}
          placeholder="Texto..."
          maxLength={NOTE_ITEM_TEXT_MAX}
          rows={1}
          className="min-h-[28px] resize-none overflow-hidden border-0 bg-transparent px-1 py-0.5 text-sm shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
        />
      )}
      <div className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100">
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


/**
 * Layout masonry estilo Google Keep: N colunas verticais, cada card vai pra
 * próxima coluna em round-robin. Diferente de CSS multi-column (que tenta
 * balancear alturas e cria gaps imprevisíveis), todas as colunas começam no
 * topo e cada uma empilha seus cards com gap constante.
 */
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

function CreateNoteCard({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group w-full rounded-lg border-2 border-dashed border-[var(--color-border)]',
        'flex flex-col items-center justify-center gap-2 px-3 py-8',
        'text-[var(--color-muted-foreground)] transition-colors',
        'hover:border-[var(--color-primary)]/60 hover:text-[var(--color-primary)] hover:bg-[var(--color-primary)]/5',
      )}
    >
      <span className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-dashed border-current">
        <Plus className="h-5 w-5" />
      </span>
      <span className="text-sm font-medium">Criar uma anotação</span>
    </button>
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
  const MAX_VISIBLE = 12;
  const visibleItems = sortedItems.slice(0, MAX_VISIBLE);
  const hiddenCount = sortedItems.length - visibleItems.length;
  const isDark = useIsDark();

  return (
    <div
      style={getNoteStyle(note.color, isDark)}
      className={cn(
        'group rounded-lg border border-[var(--color-border)] shadow-sm transition-shadow hover:shadow-md bg-[var(--color-card)]',
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
        <div className="p-3 space-y-2">
          {note.title && (
            <h3 className="pr-8 text-sm font-medium leading-snug break-words">{note.title}</h3>
          )}
          {visibleItems.length > 0 && (
            <ul className="space-y-1.5">
              {visibleItems.map((it, idx) => {
                if (it.kind === 'todo') {
                  return (
                    <li
                      key={it.id ?? `idx-${idx}`}
                      className="flex items-start gap-2 text-sm"
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
                          'break-words',
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
                    className="whitespace-pre-wrap break-words text-sm text-muted-foreground"
                  >
                    {it.text}
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
  const isDark = useIsDark();

  useEffect(() => {
    if (open && initial) setDraft({ ...initial });
  }, [open, initial]);

  const addItem = (kind: UserNoteItemKind) =>
    setDraft((prev) => ({
      ...prev,
      items: [
        ...prev.items,
        { _key: newKey(), kind, text: '', done: false, order: prev.items.length },
      ],
    }));

  const updateItem = (key: string, next: DraftItem) =>
    setDraft((prev) => ({
      ...prev,
      items: prev.items.map((it) => (it._key === key ? next : it)),
    }));

  const removeItem = (key: string) =>
    setDraft((prev) => ({
      ...prev,
      items: prev.items.filter((it) => it._key !== key),
    }));

  const convertItem = (key: string, next: UserNoteItemKind) =>
    setDraft((prev) => ({
      ...prev,
      items: prev.items.map((it) =>
        it._key === key ? { ...it, kind: next, done: next === 'todo' ? it.done : false } : it,
      ),
    }));

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
        <div className="space-y-1 px-4 pb-2">
          {draft.items.map((it, idx) => (
            <ItemBlock
              key={it._key}
              item={it}
              autoFocus={idx === draft.items.length - 1 && !it.text}
              onChange={(next) => updateItem(it._key, next)}
              onRemove={() => removeItem(it._key)}
              onConvert={(kind) => convertItem(it._key, kind)}
            />
          ))}
          <div className="flex items-center gap-3 pt-1">
            <button
              type="button"
              onClick={() => addItem('text')}
              className="flex items-center gap-1.5 px-1 py-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <Plus className="h-3.5 w-3.5" />
              Adicionar texto
            </button>
            <button
              type="button"
              onClick={() => addItem('todo')}
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

  const pinned = useMemo(() => filteredNotes.filter((n) => n.pinned), [filteredNotes]);
  const others = useMemo(() => filteredNotes.filter((n) => !n.pinned), [filteredNotes]);

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
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative w-full sm:max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar anotações..."
                className="pl-9"
              />
            </div>
            <Button
              type="button"
              variant={selectionMode ? 'default' : 'outline'}
              size="sm"
              onClick={() => {
                if (selectionMode) exitSelectionMode();
                else setSelectionMode(true);
              }}
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
            <div className="space-y-6">
              {pinned.length > 0 && (
                <section>
                  <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Fixadas
                  </h2>
                  <Masonry breakpoints={NOTES_MASONRY_BREAKPOINTS}>
                    {pinned.map((note) => (
                      <NoteCard
                        key={note.id}
                        note={note}
                        selectionMode={selectionMode}
                        selected={selectedNoteIds.includes(note.id)}
                        onClick={() =>
                          selectionMode ? toggleNoteSelected(note.id) : setEditingId(note.id)
                        }
                        onTogglePin={() => void togglePin(note)}
                        onToggleArchive={() => void toggleArchive(note)}
                        onDelete={() => handleDelete(note.id)}
                        onChangeColor={(color) => void changeColor(note, color)}
                        onToggleItem={(idx, done) => void toggleItemOnCard(note, idx, done)}
                      />
                    ))}
                  </Masonry>
                </section>
              )}
              <section>
                {pinned.length > 0 && (
                  <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Outras
                  </h2>
                )}
                <Masonry breakpoints={NOTES_MASONRY_BREAKPOINTS}>
                  {[
                    ...(filter === 'active' && !search && !selectionMode
                      ? [<CreateNoteCard key="__create__" onClick={() => setCreatingOpen(true)} />]
                      : []),
                    ...others.map((note) => (
                      <NoteCard
                        key={note.id}
                        note={note}
                        selectionMode={selectionMode}
                        selected={selectedNoteIds.includes(note.id)}
                        onClick={() =>
                          selectionMode ? toggleNoteSelected(note.id) : setEditingId(note.id)
                        }
                        onTogglePin={() => void togglePin(note)}
                        onToggleArchive={() => void toggleArchive(note)}
                        onDelete={() => handleDelete(note.id)}
                        onChangeColor={(color) => void changeColor(note, color)}
                        onToggleItem={(idx, done) => void toggleItemOnCard(note, idx, done)}
                      />
                    )),
                  ]}
                </Masonry>
              </section>
            </div>
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

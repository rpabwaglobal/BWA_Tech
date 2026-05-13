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
  type UserNoteTodo,
} from '@/services/userNoteService';
import { cardPinService, type CardPin } from '@/services/cardPinService';
import { KanbanCardPreview } from '@/components/KanbanCardPreview';
import { ROUTES } from '@/routes';
import { cn } from '@/lib/utils';

type NoteFilter = 'active' | 'archived';

type DraftTodo = UserNoteTodo & { _key: string };

type DraftNote = {
  id?: number;
  title: string;
  body: string;
  color: UserNoteColor;
  pinned: boolean;
  archived: boolean;
  todos: DraftTodo[];
};

const COLOR_OPTIONS: Array<{ value: UserNoteColor; label: string; swatchClass: string }> = [
  { value: 'default', label: 'Padrão', swatchClass: 'bg-background border-border' },
  { value: 'red', label: 'Vermelho', swatchClass: 'bg-rose-200 dark:bg-rose-900' },
  { value: 'orange', label: 'Laranja', swatchClass: 'bg-orange-200 dark:bg-orange-900' },
  { value: 'yellow', label: 'Amarelo', swatchClass: 'bg-amber-200 dark:bg-amber-900' },
  { value: 'green', label: 'Verde', swatchClass: 'bg-emerald-200 dark:bg-emerald-900' },
  { value: 'teal', label: 'Verde-água', swatchClass: 'bg-teal-200 dark:bg-teal-900' },
  { value: 'blue', label: 'Azul', swatchClass: 'bg-sky-200 dark:bg-sky-900' },
  { value: 'purple', label: 'Roxo', swatchClass: 'bg-violet-200 dark:bg-violet-900' },
  { value: 'pink', label: 'Rosa', swatchClass: 'bg-pink-200 dark:bg-pink-900' },
  { value: 'gray', label: 'Cinza', swatchClass: 'bg-slate-300 dark:bg-slate-700' },
];

const NOTE_COLOR_CLASSES: Record<UserNoteColor, string> = {
  default: 'bg-card border-border',
  red: 'bg-rose-50 dark:bg-rose-950/40 border-rose-200/70 dark:border-rose-900/70',
  orange: 'bg-orange-50 dark:bg-orange-950/40 border-orange-200/70 dark:border-orange-900/70',
  yellow: 'bg-amber-50 dark:bg-amber-950/40 border-amber-200/70 dark:border-amber-900/70',
  green: 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200/70 dark:border-emerald-900/70',
  teal: 'bg-teal-50 dark:bg-teal-950/40 border-teal-200/70 dark:border-teal-900/70',
  blue: 'bg-sky-50 dark:bg-sky-950/40 border-sky-200/70 dark:border-sky-900/70',
  purple: 'bg-violet-50 dark:bg-violet-950/40 border-violet-200/70 dark:border-violet-900/70',
  pink: 'bg-pink-50 dark:bg-pink-950/40 border-pink-200/70 dark:border-pink-900/70',
  gray: 'bg-slate-100 dark:bg-slate-900/60 border-slate-200/70 dark:border-slate-800/70',
};

const newKey = () => `tmp-${Math.random().toString(36).slice(2, 10)}`;

function toDraft(note: UserNote): DraftNote {
  return {
    id: note.id,
    title: note.title,
    body: note.body,
    color: note.color,
    pinned: note.pinned,
    archived: note.archived,
    todos: (note.todos || [])
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((t) => ({ ...t, _key: t.id != null ? `id-${t.id}` : newKey() })),
  };
}

function emptyDraft(): DraftNote {
  return {
    title: '',
    body: '',
    color: 'default',
    pinned: false,
    archived: false,
    todos: [],
  };
}

function isDraftEmpty(draft: DraftNote): boolean {
  return !draft.title.trim() && !draft.body.trim() && draft.todos.every((t) => !t.label.trim());
}

function draftToPayload(draft: DraftNote) {
  const cleanTodos = draft.todos
    .filter((t) => t.label.trim().length > 0)
    .map((t, index) => ({ label: t.label.trim(), done: t.done, order: index }));
  return {
    title: draft.title.trim(),
    body: draft.body.trim(),
    color: draft.color,
    pinned: draft.pinned,
    archived: draft.archived,
    todos: cleanTodos,
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
        <div className="absolute bottom-full left-0 mb-2 z-50 grid grid-cols-5 gap-1.5 rounded-lg border border-border bg-popover p-2 shadow-md">
          {COLOR_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              title={opt.label}
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
              }}
              className={cn(
                'h-7 w-7 rounded-full border-2 transition-transform hover:scale-110',
                opt.swatchClass,
                value === opt.value ? 'border-primary ring-2 ring-primary/30' : 'border-border',
              )}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TodoLine({
  todo,
  onChange,
  onRemove,
  autoFocus,
}: {
  todo: DraftTodo;
  onChange: (next: DraftTodo) => void;
  onRemove: () => void;
  autoFocus?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  return (
    <div className="group flex items-center gap-2">
      <input
        type="checkbox"
        checked={todo.done}
        onChange={(e) => onChange({ ...todo, done: e.target.checked })}
        className="h-4 w-4 shrink-0 cursor-pointer rounded border-border accent-primary"
      />
      <Input
        ref={inputRef}
        value={todo.label}
        onChange={(e) => onChange({ ...todo, label: e.target.value })}
        placeholder="Item da lista"
        className={cn(
          'h-7 border-0 bg-transparent px-1 text-sm shadow-none focus-visible:ring-0 focus-visible:ring-offset-0',
          todo.done && 'line-through text-muted-foreground',
        )}
      />
      <button
        type="button"
        onClick={onRemove}
        className="opacity-0 transition-opacity group-hover:opacity-100"
        title="Remover item"
      >
        <X className="h-4 w-4 text-muted-foreground hover:text-foreground" />
      </button>
    </div>
  );
}

function NoteComposer({
  onCreate,
  busy,
}: {
  onCreate: (draft: DraftNote) => Promise<void>;
  busy: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState<DraftNote>(emptyDraft());
  const [showTodos, setShowTodos] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const close = useCallback(async () => {
    setExpanded(false);
    setShowTodos(false);
    if (!isDraftEmpty(draft)) {
      await onCreate(draft);
    }
    setDraft(emptyDraft());
  }, [draft, onCreate]);

  useEffect(() => {
    if (!expanded) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        void close();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [expanded, close]);

  const addTodo = () => {
    setDraft((prev) => ({
      ...prev,
      todos: [...prev.todos, { _key: newKey(), label: '', done: false, order: prev.todos.length }],
    }));
  };

  return (
    <div
      ref={wrapperRef}
      className={cn(
        'mx-auto w-full max-w-xl rounded-lg border shadow-sm transition-shadow',
        NOTE_COLOR_CLASSES[draft.color],
        expanded ? 'shadow-md' : '',
      )}
    >
      {!expanded ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-muted-foreground"
        >
          <Plus className="h-4 w-4" />
          <span>Criar uma anotação...</span>
        </button>
      ) : (
        <div className="p-3 space-y-2">
          <Input
            value={draft.title}
            onChange={(e) => setDraft((prev) => ({ ...prev, title: e.target.value }))}
            placeholder="Título"
            className="h-8 border-0 bg-transparent px-1 text-base font-medium shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
            autoFocus
          />
          {!showTodos && (
            <Textarea
              value={draft.body}
              onChange={(e) => setDraft((prev) => ({ ...prev, body: e.target.value }))}
              placeholder="Criar uma anotação..."
              className="min-h-[60px] border-0 bg-transparent px-1 text-sm shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 resize-none"
            />
          )}
          {showTodos && (
            <div className="space-y-1">
              {draft.todos.map((todo, idx) => (
                <TodoLine
                  key={todo._key}
                  todo={todo}
                  autoFocus={idx === draft.todos.length - 1 && !todo.label}
                  onChange={(next) =>
                    setDraft((prev) => ({
                      ...prev,
                      todos: prev.todos.map((t) => (t._key === todo._key ? next : t)),
                    }))
                  }
                  onRemove={() =>
                    setDraft((prev) => ({
                      ...prev,
                      todos: prev.todos.filter((t) => t._key !== todo._key),
                    }))
                  }
                />
              ))}
              <button
                type="button"
                onClick={addTodo}
                className="flex items-center gap-2 px-1 py-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <Plus className="h-3.5 w-3.5" />
                Adicionar item
              </button>
            </div>
          )}
          <div className="flex items-center justify-between pt-1">
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0"
                title={showTodos ? 'Voltar para texto' : 'Lista de itens'}
                onClick={() => {
                  if (!showTodos && draft.todos.length === 0) addTodo();
                  setShowTodos((v) => !v);
                }}
              >
                <CheckSquare className="h-4 w-4" />
              </Button>
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
            </div>
            <Button
              type="button"
              size="sm"
              onClick={() => void close()}
              disabled={busy}
              className="h-8"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Salvar'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function NoteCard({
  note,
  onClick,
  onTogglePin,
  onToggleArchive,
  onDelete,
  onChangeColor,
  onToggleTodo,
}: {
  note: UserNote;
  onClick: () => void;
  onTogglePin: () => void;
  onToggleArchive: () => void;
  onDelete: () => void;
  onChangeColor: (color: UserNoteColor) => void;
  onToggleTodo: (todoIdx: number, done: boolean) => void;
}) {
  const sortedTodos = useMemo(
    () => (note.todos || []).slice().sort((a, b) => a.order - b.order),
    [note.todos],
  );
  const visibleTodos = sortedTodos.slice(0, 8);
  const hiddenCount = sortedTodos.length - visibleTodos.length;

  return (
    <div
      className={cn(
        'group break-inside-avoid mb-3 rounded-lg border shadow-sm transition-shadow hover:shadow-md',
        NOTE_COLOR_CLASSES[note.color],
      )}
    >
      <div className="relative cursor-pointer" onClick={onClick}>
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
        <div className="p-3 space-y-2">
          {note.title && (
            <h3 className="pr-8 text-sm font-medium leading-snug break-words">{note.title}</h3>
          )}
          {note.body && (
            <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">
              {note.body}
            </p>
          )}
          {sortedTodos.length > 0 && (
            <ul className="space-y-1">
              {visibleTodos.map((todo, idx) => (
                <li
                  key={todo.id ?? idx}
                  className="flex items-start gap-2 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={todo.done}
                    onChange={(e) => onToggleTodo(idx, e.target.checked)}
                    onClick={(e) => e.stopPropagation()}
                    className="mt-1 h-4 w-4 shrink-0 cursor-pointer rounded border-border accent-primary"
                  />
                  <span
                    className={cn(
                      'break-words',
                      todo.done && 'line-through text-muted-foreground',
                    )}
                  >
                    {todo.label}
                  </span>
                </li>
              ))}
              {hiddenCount > 0 && (
                <li className="text-xs text-muted-foreground">+ {hiddenCount} item(s)</li>
              )}
            </ul>
          )}
          {!note.title && !note.body && sortedTodos.length === 0 && (
            <p className="text-sm italic text-muted-foreground">Anotação vazia</p>
          )}
        </div>
      </div>
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
}: {
  open: boolean;
  initial: DraftNote | null;
  onClose: () => void;
  onSave: (draft: DraftNote) => Promise<void>;
  onDelete: () => Promise<void>;
  saving: boolean;
}) {
  const [draft, setDraft] = useState<DraftNote>(emptyDraft());

  useEffect(() => {
    if (open && initial) setDraft({ ...initial });
  }, [open, initial]);

  const addTodo = () =>
    setDraft((prev) => ({
      ...prev,
      todos: [...prev.todos, { _key: newKey(), label: '', done: false, order: prev.todos.length }],
    }));

  const updateTodo = (key: string, next: DraftTodo) =>
    setDraft((prev) => ({
      ...prev,
      todos: prev.todos.map((t) => (t._key === key ? next : t)),
    }));

  const removeTodo = (key: string) =>
    setDraft((prev) => ({
      ...prev,
      todos: prev.todos.filter((t) => t._key !== key),
    }));

  const hasTodos = draft.todos.length > 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) void onSave(draft).then(onClose);
      }}
    >
      <DialogContent
        className={cn('max-w-lg p-0 overflow-hidden', NOTE_COLOR_CLASSES[draft.color])}
      >
        <DialogHeader className="px-4 pt-4 pb-2">
          <DialogTitle className="sr-only">Editar anotação</DialogTitle>
          <DialogDescription className="sr-only">
            Edite o título, conteúdo e itens da anotação.
          </DialogDescription>
          <Input
            value={draft.title}
            onChange={(e) => setDraft((prev) => ({ ...prev, title: e.target.value }))}
            placeholder="Título"
            className="h-8 border-0 bg-transparent px-1 text-base font-medium shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
          />
        </DialogHeader>
        <div className="space-y-2 px-4 pb-2">
          <Textarea
            value={draft.body}
            onChange={(e) => setDraft((prev) => ({ ...prev, body: e.target.value }))}
            placeholder="Anotação..."
            className="min-h-[120px] border-0 bg-transparent px-1 text-sm shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 resize-none"
          />
          {hasTodos && (
            <div className="space-y-1">
              {draft.todos.map((todo, idx) => (
                <TodoLine
                  key={todo._key}
                  todo={todo}
                  autoFocus={idx === draft.todos.length - 1 && !todo.label}
                  onChange={(next) => updateTodo(todo._key, next)}
                  onRemove={() => removeTodo(todo._key)}
                />
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={addTodo}
            className="flex items-center gap-2 px-1 py-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <Plus className="h-3.5 w-3.5" />
            Adicionar item de lista
          </button>
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
          </div>
          <Button
            type="button"
            size="sm"
            onClick={() => void onSave(draft).then(onClose)}
            disabled={saving}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4 mr-1" />}
            Fechar
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
  const [savingId, setSavingId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);

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

  useEffect(() => {
    if (tab === 'pins') void loadPins();
  }, [tab, loadPins]);

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
      if (draft.id == null) return;
      await patchNote(draft.id, draftToPayload(draft));
    },
    [patchNote],
  );

  const handleDelete = useCallback(async (id: number) => {
    if (!window.confirm('Excluir esta anotação? Esta ação não pode ser desfeita.')) return;
    try {
      await userNoteService.delete(id);
      setNotes((prev) => prev.filter((n) => n.id !== id));
      setEditingId((cur) => (cur === id ? null : cur));
    } catch (err) {
      console.error('Erro ao excluir anotação:', err);
      setError('Falha ao excluir a anotação.');
    }
  }, []);

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

  const toggleTodoOnCard = useCallback(
    async (note: UserNote, todoIdx: number, done: boolean) => {
      const sorted = (note.todos || []).slice().sort((a, b) => a.order - b.order);
      const nextTodos = sorted.map((t, idx) => ({
        label: t.label,
        done: idx === todoIdx ? done : t.done,
        order: idx,
      }));
      await patchNote(note.id, { todos: nextTodos });
    },
    [patchNote],
  );

  const filteredNotes = useMemo(() => {
    const term = search.trim().toLowerCase();
    return notes
      .filter((n) => (filter === 'archived' ? n.archived : !n.archived))
      .filter((n) => {
        if (!term) return true;
        const haystack = [n.title, n.body, ...(n.todos || []).map((t) => t.label)]
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

  return (
    <div className="container mx-auto py-6 px-4 max-w-6xl">
      <header className="mb-6 space-y-1">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-primary/10 p-2 text-primary">
            <StickyNote className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Meus Afazeres</h1>
            <p className="text-sm text-muted-foreground">
              Anotações, listas e lembretes pessoais. Apenas você vê suas anotações.
            </p>
          </div>
        </div>
      </header>

      {/* Tabs (mesmo padrão do GeekDay) */}
      <div className="mb-4 flex items-center gap-[8px] border-b border-[var(--color-border)] shrink-0">
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
            <div className="inline-flex rounded-md border border-border bg-card p-0.5 text-sm">
              <button
                type="button"
                onClick={() => setFilter('active')}
                className={cn(
                  'rounded-sm px-3 py-1.5 transition-colors',
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
                  'rounded-sm px-3 py-1.5 transition-colors',
                  filter === 'archived'
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                Arquivadas
              </button>
            </div>
          </div>

          {filter === 'active' && (
            <div className="mb-6">
              <NoteComposer onCreate={handleCreate} busy={creating} />
            </div>
          )}

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
          ) : filteredNotes.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-16 text-center text-muted-foreground">
              <StickyNote className="h-10 w-10 mb-3 opacity-50" />
              <p className="text-sm">
                {filter === 'archived'
                  ? 'Nenhuma anotação arquivada.'
                  : search
                    ? 'Nenhuma anotação encontrada para sua busca.'
                    : 'Suas anotações aparecerão aqui. Crie a primeira logo acima.'}
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              {pinned.length > 0 && (
                <section>
                  <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Fixadas
                  </h2>
                  <div className="columns-1 gap-3 sm:columns-2 lg:columns-3 xl:columns-4">
                    {pinned.map((note) => (
                      <NoteCard
                        key={note.id}
                        note={note}
                        onClick={() => setEditingId(note.id)}
                        onTogglePin={() => void togglePin(note)}
                        onToggleArchive={() => void toggleArchive(note)}
                        onDelete={() => void handleDelete(note.id)}
                        onChangeColor={(color) => void changeColor(note, color)}
                        onToggleTodo={(idx, done) => void toggleTodoOnCard(note, idx, done)}
                      />
                    ))}
                  </div>
                </section>
              )}
              {others.length > 0 && (
                <section>
                  {pinned.length > 0 && (
                    <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Outras
                    </h2>
                  )}
                  <div className="columns-1 gap-3 sm:columns-2 lg:columns-3 xl:columns-4">
                    {others.map((note) => (
                      <NoteCard
                        key={note.id}
                        note={note}
                        onClick={() => setEditingId(note.id)}
                        onTogglePin={() => void togglePin(note)}
                        onToggleArchive={() => void toggleArchive(note)}
                        onDelete={() => void handleDelete(note.id)}
                        onChangeColor={(color) => void changeColor(note, color)}
                        onToggleTodo={(idx, done) => void toggleTodoOnCard(note, idx, done)}
                      />
                    ))}
                  </div>
                </section>
              )}
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
    </div>
  );
}

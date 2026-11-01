import { isHttpUrl, NAMED_COLORS, parseColor, type FieldNode, type Format, type Source } from '@send-any-webhook/shared';
import { AlertTriangle, ChevronsUpDown, Plus, SlidersHorizontal, X } from 'lucide-react';
import { useRef, useState, type DragEvent } from 'react';
import { cn } from 'cn';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { DRAG_TYPE, TypeTag } from './field-tree';

export type SlotKind = 'text' | 'long' | 'url' | 'color' | 'date' | 'name';
export type PickHandler = (path: string) => void;

export interface SlotProps {
  label: string;
  kind: SlotKind;
  value: Source;
  onChange: (s: Source) => void;
  fields: FieldNode[];
  warnings?: string[];
  /** Registers this slot as the target for clicks in the field tree. */
  onActivate: (pick: PickHandler) => void;
  hint?: string;
  compact?: boolean;
}

const KIND_LABEL: Record<Source['kind'], string> = {
  empty: 'Empty',
  field: 'Field',
  static: 'Text',
  template: 'Template',
  valueMap: 'Value map',
};

function suitable(kind: SlotKind, f: FieldNode): boolean {
  const raw = f.preview?.replace(/^"|"$/g, '') ?? '';
  if (kind === 'url') return f.type === 'string' && isHttpUrl(raw);
  if (kind === 'date') return (f.type === 'string' && /^\d{4}-\d{2}-\d{2}/.test(raw)) || (f.type === 'number' && Number(raw) > 1e9);
  if (kind === 'color') return f.type === 'number' || (f.type === 'string' && parseColor(raw) !== null);
  return f.type !== 'object';
}

export function FieldPicker({
  value,
  onChange,
  fields,
  kind = 'text',
  only,
  placeholder = 'Choose a field',
}: {
  value: string;
  onChange: (path: string) => void;
  fields: FieldNode[];
  kind?: SlotKind;
  only?: (f: FieldNode) => boolean;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const list = only ? fields.filter(only) : fields;
  const suggested = list.filter((f) => suitable(kind, f));
  const other = list.filter((f) => !suitable(kind, f));
  const item = (f: FieldNode) => (
    <CommandItem
      key={f.path}
      value={f.path}
      onSelect={() => {
        onChange(f.path);
        setOpen(false);
      }}
      className="gap-1 text-xs"
    >
      <TypeTag type={f.type} />
      <span className="font-mono">{f.path}</span>
      {f.preview && <span className="text-muted-foreground ml-auto max-w-40 truncate">{f.preview}</span>}
    </CommandItem>
  );
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 min-w-0 flex-1 justify-between font-mono text-xs font-normal">
          <span className={cn('truncate', !value && 'text-muted-foreground font-sans')}>{value || placeholder}</span>
          <ChevronsUpDown className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(28rem,90vw)] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search fields…" className="text-xs" />
          <CommandList>
            <CommandEmpty>No matching field. Is the sample payload set?</CommandEmpty>
            {suggested.length > 0 && kind !== 'text' && kind !== 'long' && kind !== 'name' && (
              <CommandGroup heading="Suggested">{suggested.map(item)}</CommandGroup>
            )}
            <CommandGroup heading={kind === 'text' || kind === 'long' || kind === 'name' ? 'Fields' : 'Other fields'}>
              {(kind === 'text' || kind === 'long' || kind === 'name' ? list : other).map(item)}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function ColorInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const parsed = parseColor(value);
  const hex = parsed !== null ? `#${parsed.toString(16).padStart(6, '0')}` : '#5865f2';
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1">
      <input
        type="color"
        value={hex}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 w-9 shrink-0 cursor-pointer rounded border bg-transparent p-0.5"
        aria-label="Pick a color"
      />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? '#5865F2 or red'}
        className="h-8 min-w-0 text-xs"
        list="send-any-webhook-colors"
      />
      <datalist id="send-any-webhook-colors">
        {Object.keys(NAMED_COLORS).map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
    </div>
  );
}

function FormatPopover({ format = {}, onChange, field }: { format?: Format; onChange: (f: Format) => void; field?: FieldNode }) {
  const set = <K extends keyof Format>(k: K, v: Format[K] | undefined) => {
    const next = { ...format };
    if (v === undefined || v === '' || v === false) delete next[k];
    else next[k] = v;
    onChange(next);
  };
  const isArray = field?.type === 'array';
  const itemKeys = isArray ? (field.children?.[0]?.children ?? []).map((c) => c.key) : [];
  const active = Object.keys(format).length;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant={active ? 'secondary' : 'ghost'} size="sm" className="h-8 px-2" title="Format value">
          <SlidersHorizontal />
          {active > 0 && <span className="text-xs">{active}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 space-y-3" align="end">
        <div className="text-sm font-medium">Format value</div>
        {(isArray || format.join !== undefined || format.pluck) && (
          <div className="grid grid-cols-2 gap-2">
            {itemKeys.length > 0 && (
              <div className="space-y-1">
                <Label className="text-xs">From each item take</Label>
                <Select value={format.pluck ?? '__all'} onValueChange={(v) => set('pluck', v === '__all' ? undefined : v)}>
                  <SelectTrigger size="sm" className="w-full text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all">Whole item</SelectItem>
                    {itemKeys.map((k) => (
                      <SelectItem key={k} value={k}>
                        {k}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1">
              <Label className="text-xs">Join list with</Label>
              <Input className="h-8 text-xs" value={format.join ?? ''} placeholder=", " onChange={(e) => set('join', e.target.value || undefined)} />
            </div>
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-xs">Date</Label>
            <Select value={format.date ?? '__none'} onValueChange={(v) => set('date', v === '__none' ? undefined : (v as Format['date']))}>
              <SelectTrigger size="sm" className="w-full text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">As is</SelectItem>
                <SelectItem value="relative">Relative (in 2 days)</SelectItem>
                <SelectItem value="short">Date + time</SelectItem>
                <SelectItem value="long">Weekday, date + time</SelectItem>
                <SelectItem value="date">Date only</SelectItem>
                <SelectItem value="time">Time only</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Case</Label>
            <Select value={format.case ?? '__none'} onValueChange={(v) => set('case', v === '__none' ? undefined : (v as Format['case']))}>
              <SelectTrigger size="sm" className="w-full text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">As is</SelectItem>
                <SelectItem value="upper">UPPERCASE</SelectItem>
                <SelectItem value="lower">lowercase</SelectItem>
                <SelectItem value="title">Title Case</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Max length</Label>
            <Input
              className="h-8 text-xs"
              type="number"
              min={1}
              value={format.truncate ?? ''}
              onChange={(e) => set('truncate', e.target.value ? Math.max(1, Number(e.target.value)) : undefined)}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">If empty, show</Label>
            <Input className="h-8 text-xs" value={format.fallback ?? ''} placeholder="—" onChange={(e) => set('fallback', e.target.value)} />
          </div>
        </div>
        <div className="flex items-center justify-between">
          <Label className="text-xs">true/false as ✅/❌</Label>
          <Switch checked={!!format.boolEmoji} onCheckedChange={(v) => set('boolEmoji', v)} />
        </div>
        <div className="flex items-center justify-between">
          <Label className="text-xs">Number with separators (1,234)</Label>
          <Switch checked={!!format.number} onCheckedChange={(v) => set('number', v)} />
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ValueMapEditor({
  value,
  onChange,
  fields,
  kind,
}: {
  value: Extract<Source, { kind: 'valueMap' }>;
  onChange: (s: Source) => void;
  fields: FieldNode[];
  kind: SlotKind;
}) {
  const setCase = (i: number, patch: Partial<{ when: string; then: string }>) =>
    onChange({ ...value, cases: value.cases.map((c, j) => (i === j ? { ...c, ...patch } : c)) });
  const thenInput = (v: string, set: (v: string) => void, placeholder: string) =>
    kind === 'color' ? <ColorInput value={v} onChange={set} placeholder={placeholder} /> : (
      <Input className="h-8 min-w-0 flex-1 text-xs" value={v} onChange={(e) => set(e.target.value)} placeholder={placeholder} />
    );
  return (
    <div className="w-full space-y-1.5 rounded-md border p-2">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground w-12 text-xs">When</span>
        <FieldPicker value={value.path} onChange={(path) => onChange({ ...value, path })} fields={fields} />
      </div>
      {value.cases.map((c, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <span className="text-muted-foreground w-12 text-right text-xs">is</span>
          <Input className="h-8 w-28 text-xs" value={c.when} onChange={(e) => setCase(i, { when: e.target.value })} placeholder="value" />
          <span className="text-muted-foreground text-xs">→</span>
          {thenInput(c.then, (then) => setCase(i, { then }), 'show')}
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2"
            onClick={() => onChange({ ...value, cases: value.cases.filter((_, j) => j !== i) })}
            aria-label="Remove case"
          >
            <X />
          </Button>
        </div>
      ))}
      <div className="flex items-center gap-1.5">
        <span className="text-muted-foreground w-12 text-right text-xs">else</span>
        {thenInput(value.fallback ?? '', (fallback) => onChange({ ...value, fallback }), 'show (optional)')}
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 text-xs"
        onClick={() => onChange({ ...value, cases: [...value.cases, { when: '', then: '' }] })}
      >
        <Plus /> Add case
      </Button>
    </div>
  );
}

function convert(from: Source, to: Source['kind'], kind: SlotKind): Source {
  const path = from.kind === 'field' || from.kind === 'valueMap' ? from.path : '';
  switch (to) {
    case 'empty':
      return { kind: 'empty' };
    case 'field':
      return { kind: 'field', path };
    case 'static':
      return { kind: 'static', value: from.kind === 'static' || from.kind === 'template' ? from.value : '' };
    case 'template':
      return {
        kind: 'template',
        value: from.kind === 'template' || from.kind === 'static' ? from.value : path ? `{{ ${path} }}` : '',
      };
    case 'valueMap':
      return { kind: 'valueMap', path, cases: [{ when: '', then: kind === 'color' ? 'green' : '' }], fallback: '' };
  }
}

/** One mappable part of the Discord message: choose where its value comes from. */
export function SourceInput({ label, kind, value, onChange, fields, warnings, onActivate, hint, compact }: SlotProps) {
  const textRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const pick: PickHandler = (path) => {
    if (value.kind === 'template') {
      const el = textRef.current;
      const token = `{{ ${path} }}`;
      if (el) {
        const start = el.selectionStart ?? value.value.length;
        const end = el.selectionEnd ?? start;
        onChange({ kind: 'template', value: value.value.slice(0, start) + token + value.value.slice(end) });
        requestAnimationFrame(() => {
          el.focus();
          el.setSelectionRange(start + token.length, start + token.length);
        });
      } else onChange({ kind: 'template', value: value.value + token });
    } else if (value.kind === 'valueMap') {
      onChange({ ...value, path });
    } else {
      onChange({ kind: 'field', path, ...(value.kind === 'field' && value.format && { format: value.format }) });
    }
  };

  const onDrop = (e: DragEvent) => {
    const path = e.dataTransfer.getData(DRAG_TYPE);
    setDragOver(false);
    if (!path) return;
    e.preventDefault();
    pick(path);
  };

  const fieldNode = value.kind === 'field' ? flatFind(fields, value.path) : undefined;
  const longText = kind === 'long';

  return (
    <div
      data-mapping-slot={label}
      onFocusCapture={() => onActivate(pick)}
      onClickCapture={() => onActivate(pick)}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(DRAG_TYPE)) {
          e.preventDefault();
          setDragOver(true);
        }
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
      className={cn(
        'grid items-start gap-x-3 gap-y-1 rounded-md p-1 transition-colors',
        compact ? 'grid-cols-1' : 'sm:grid-cols-[8rem_1fr]',
        dragOver && 'bg-primary/10 ring-primary ring-2',
      )}
    >
      <Label className={cn('pt-2 text-xs', compact && 'pt-0')} title={hint}>
        {label}
      </Label>
      <div className="min-w-0 space-y-1">
        <div className="flex min-w-0 items-start gap-1.5">
          <Select value={value.kind} onValueChange={(k) => onChange(convert(value, k as Source['kind'], kind))}>
            <SelectTrigger size="sm" className="w-28 shrink-0 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(KIND_LABEL) as Source['kind'][]).map((k) => (
                <SelectItem key={k} value={k} className="text-xs">
                  {KIND_LABEL[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {value.kind === 'empty' && <span className="text-muted-foreground pt-2 text-xs">Drop a field here or pick a source</span>}
          {value.kind === 'field' && (
            <>
              <FieldPicker value={value.path} onChange={(path) => onChange({ ...value, path })} fields={fields} kind={kind} />
              <FormatPopover format={value.format} field={fieldNode} onChange={(format) => onChange({ ...value, format })} />
            </>
          )}
          {value.kind === 'static' &&
            (kind === 'color' ? (
              <ColorInput value={value.value} onChange={(v) => onChange({ kind: 'static', value: v })} />
            ) : longText ? (
              <Textarea className="min-h-16 text-xs" value={value.value} onChange={(e) => onChange({ kind: 'static', value: e.target.value })} />
            ) : (
              <Input className="h-8 min-w-0 text-xs" value={value.value} onChange={(e) => onChange({ kind: 'static', value: e.target.value })} />
            ))}
          {value.kind === 'template' &&
            (longText ? (
              <Textarea
                ref={textRef}
                className="min-h-16 font-mono text-xs"
                value={value.value}
                placeholder="Text with {{ fields }}; click a field on the left to insert it"
                onChange={(e) => onChange({ kind: 'template', value: e.target.value })}
              />
            ) : (
              <Input
                ref={textRef}
                className="h-8 min-w-0 font-mono text-xs"
                value={value.value}
                placeholder="Text with {{ fields }}"
                onChange={(e) => onChange({ kind: 'template', value: e.target.value })}
              />
            ))}
        </div>
        {value.kind === 'valueMap' && <ValueMapEditor value={value} onChange={onChange} fields={fields} kind={kind} />}
        {warnings?.map((w, i) => (
          <p key={i} className="flex items-start gap-1 text-xs text-amber-700 dark:text-amber-400">
            <AlertTriangle className="mt-0.5 size-3 shrink-0" /> {w}
          </p>
        ))}
      </div>
    </div>
  );
}

export function flatFind(nodes: FieldNode[], path: string): FieldNode | undefined {
  for (const n of nodes) {
    if (n.path === path) return n;
    const found = flatFind(n.children ?? [], path);
    if (found) return found;
  }
  return undefined;
}

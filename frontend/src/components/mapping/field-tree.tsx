import type { FieldNode, JsonType } from '@send-any-webhook/shared';
import { ChevronRight, GripVertical, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { cn } from 'cn';
import { Input } from '@/components/ui/input';

export const DRAG_TYPE = 'application/x-send-any-webhook-path';

const TYPE_STYLE: Record<JsonType, string> = {
  string: 'text-emerald-600 dark:text-emerald-400',
  number: 'text-sky-600 dark:text-sky-400',
  boolean: 'text-violet-600 dark:text-violet-400',
  null: 'text-muted-foreground',
  object: 'text-amber-600 dark:text-amber-400',
  array: 'text-pink-600 dark:text-pink-400',
};
const TYPE_LABEL: Record<JsonType, string> = { string: 'abc', number: '123', boolean: 'bool', null: 'null', object: '{ }', array: '[ ]' };

export function TypeTag({ type }: { type: JsonType }) {
  return <span className={cn('w-8 shrink-0 font-mono text-[10px]', TYPE_STYLE[type])}>{TYPE_LABEL[type]}</span>;
}

function matches(n: FieldNode, q: string): boolean {
  return n.path.toLowerCase().includes(q) || (n.children ?? []).some((c) => matches(c, q));
}

function Node({ node, depth, onPick, query }: { node: FieldNode; depth: number; onPick: (path: string) => void; query: string }) {
  const [open, setOpen] = useState(depth < 2);
  const hasChildren = !!node.children?.length;
  if (query && !matches(node, query)) return null;
  const expanded = open || !!query;
  return (
    <div>
      <div
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(DRAG_TYPE, node.path);
          e.dataTransfer.setData('text/plain', `{{ ${node.path} }}`);
          e.dataTransfer.effectAllowed = 'copy';
        }}
        onClick={() => onPick(node.path)}
        title={`${node.path}\nClick to use in the active slot, or drag onto a slot`}
        className="group hover:bg-accent flex cursor-pointer items-center gap-1 rounded px-1 py-0.5 text-xs"
        style={{ paddingLeft: depth * 12 + 4 }}
      >
        <button
          type="button"
          className={cn('text-muted-foreground size-4 shrink-0', !hasChildren && 'invisible')}
          onClick={(e) => {
            e.stopPropagation();
            setOpen(!open);
          }}
          aria-label={expanded ? 'Collapse' : 'Expand'}
        >
          <ChevronRight className={cn('size-3.5 transition-transform', expanded && 'rotate-90')} />
        </button>
        <TypeTag type={node.type} />
        <span className="shrink-0 font-mono font-medium">{node.key}</span>
        {node.preview && <span className="text-muted-foreground min-w-0 truncate">{node.preview}</span>}
        <GripVertical className="text-muted-foreground ml-auto size-3 shrink-0 opacity-0 group-hover:opacity-100" />
      </div>
      {hasChildren && expanded && node.children!.map((c) => <Node key={c.path} node={c} depth={depth + 1} onPick={onPick} query={query} />)}
    </div>
  );
}

export function FieldTree({ nodes, onPick }: { nodes: FieldNode[]; onPick: (path: string) => void }) {
  const [query, setQuery] = useState('');
  const q = useMemo(() => query.trim().toLowerCase(), [query]);
  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="text-muted-foreground absolute top-2 left-2 size-4" />
        <Input placeholder="Filter fields" value={query} onChange={(e) => setQuery(e.target.value)} className="h-8 pl-8 text-xs" />
      </div>
      {nodes.length === 0 ? (
        <p className="text-muted-foreground p-2 text-xs">No fields. Add a sample payload to map its fields.</p>
      ) : (
        <div className="-mx-1">
          {nodes.map((n) => (
            <Node key={n.path} node={n} depth={0} onPick={onPick} query={q} />
          ))}
        </div>
      )}
    </div>
  );
}

import { Check, Copy } from 'lucide-react';
import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { cn } from 'cn';
import type { QueueStatus } from '@/api/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { JsonEditorProps } from './json-editor';

export function CopyButton({ value, label = 'Copy', className }: { value: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={className}
      onClick={() => void navigator.clipboard.writeText(value).then(() => setCopied(true))}
    >
      {copied ? <Check /> : <Copy />}
      {copied ? 'Copied' : label}
    </Button>
  );
}

const STATUS_STYLE: Record<QueueStatus, string> = {
  pending: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  processing: 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300',
  delivered: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  failed: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  dead: 'bg-red-500/15 text-red-700 dark:text-red-300',
  skipped: 'bg-zinc-500/15 text-zinc-700 dark:text-zinc-300',
  rejected: 'bg-rose-500/15 text-rose-700 dark:text-rose-300',
};

export const STATUS_HELP: Record<QueueStatus, string> = {
  pending: 'Waiting to be sent',
  processing: 'Being sent right now',
  delivered: 'Discord accepted it',
  failed: 'Will be retried',
  dead: 'Gave up (or cancelled); retry manually',
  skipped: 'No template matched, relay disabled, or no templates',
  rejected: 'Refused on arrival (not JSON, too large, relay disabled)',
};

export function StatusBadge({ status }: { status: QueueStatus }) {
  return (
    <Badge variant="outline" className={cn('border-transparent capitalize', STATUS_STYLE[status])} title={STATUS_HELP[status]}>
      {status}
    </Badge>
  );
}

const LazyJsonEditor = lazy(() => import('./json-editor'));

/** CodeMirror JSON editor, loaded on first use to keep it out of the main bundle. */
export function JsonEditor(props: JsonEditorProps) {
  return (
    <Suspense fallback={<div className={cn('bg-muted/30 animate-pulse rounded-md border', props.className)} style={{ minHeight: props.minHeight ?? '160px' }} />}>
      <LazyJsonEditor {...props} />
    </Suspense>
  );
}

export function parseJson(text: string): { value: unknown; error: string | null } {
  if (!text.trim()) return { value: undefined, error: 'Empty' };
  try {
    return { value: JSON.parse(text), error: null };
  } catch (err) {
    return { value: undefined, error: (err as Error).message };
  }
}

export function PageHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="text-muted-foreground mt-1 text-sm">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-lg border border-dashed px-6 py-12 text-center">
      <div className="text-muted-foreground mb-3 [&_svg]:size-8">{icon}</div>
      <h3 className="font-medium">{title}</h3>
      {children && <div className="text-muted-foreground mt-1 max-w-md text-sm">{children}</div>}
    </div>
  );
}

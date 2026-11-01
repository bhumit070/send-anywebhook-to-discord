import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, ArrowUpDown, Ban, Filter, RefreshCw, ScrollText, Send, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { cn } from 'cn';
import { api, errorMessage, unwrap } from '@/api/client';
import { QUEUE_STATUSES, type QueueItem, type QueueStatus } from '@/api/types';
import { EmptyState, STATUS_HELP, StatusBadge } from '@/components/common';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useRelays } from '@/pages/relays';
import { dateTime, duration, relativeTime } from '@/lib/format';
import { LogDetailSheet } from './log-detail';

type SortKey = 'receivedAt' | 'relayName' | 'status' | 'attempts' | 'lastStatusCode' | 'nextAttemptAt' | 'deliveredAt';
const FILTER_KEYS = ['relayId', 'status', 'from', 'to', 'statusCode', 'hasError', 'q', 'path', 'pathValue'];

/** datetime-local value ↔ ISO */
const toLocalInput = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function LogsView({ fixedRelayId }: { fixedRelayId?: string }) {
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const relays = useRelays();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const [live, setLive] = useState(true);
  const [search, setSearch] = useState(params.get('q') ?? '');
  const [oldestCount, setOldestCount] = useState(10);
  const debounced = useDebounced(search);

  const update = (patch: Record<string, string | string[] | null>, resetPage = true) => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(patch)) {
          next.delete(k);
          if (Array.isArray(v)) v.forEach((x) => next.append(k, x));
          else if (v !== null && v !== '') next.set(k, v);
        }
        if (resetPage) next.delete('page');
        return next;
      },
      { replace: true },
    );
    setSelected(new Set());
  };

  useEffect(() => {
    if ((params.get('q') ?? '') !== debounced) update({ q: debounced });
  }, [debounced]);

  const statuses = params.getAll('status') as QueueStatus[];
  const relayIds = fixedRelayId ? [fixedRelayId] : params.getAll('relayId');
  const sort = params.get('sort') ?? 'receivedAt:desc';
  const [sortKey, sortDir] = sort.split(':') as [SortKey, 'asc' | 'desc'];
  const page = Number(params.get('page') ?? 1);
  const pageSize = Number(params.get('pageSize') ?? 50);
  const hasError = params.get('hasError');

  const query = useMemo(
    () => ({
      ...(relayIds.length && { relayId: relayIds }),
      ...(statuses.length && { status: statuses }),
      ...(params.get('from') && { from: params.get('from')! }),
      ...(params.get('to') && { to: params.get('to')! }),
      ...(params.get('statusCode') && { statusCode: Number(params.get('statusCode')) }),
      ...(hasError && { hasError: hasError === 'true' }),
      ...(params.get('q') && { q: params.get('q')! }),
      ...(params.get('path') && { path: params.get('path')! }),
      ...(params.get('path') && params.get('pathValue') !== null && { pathValue: params.get('pathValue')! }),
    }),
    [params.toString(), fixedRelayId],
  );

  const list = useQuery({
    queryKey: ['queue', 'list', query, sort, page, pageSize],
    queryFn: () => unwrap(api.GET('/api/queue', { params: { query: { ...query, sort, page, pageSize } } })),
    placeholderData: keepPreviousData,
    refetchInterval: live ? 5000 : false,
  });
  const stats = useQuery({
    queryKey: ['queue', 'stats', relayIds],
    queryFn: () => unwrap(api.GET('/api/queue/stats', { params: { query: relayIds.length ? { relayId: relayIds } : {} } })),
    refetchInterval: live ? 5000 : false,
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['queue'] });
    void qc.invalidateQueries({ queryKey: ['relays'] });
  };

  const bulk = useMutation({
    mutationFn: async (kind: 'send' | 'retry' | 'cancel' | 'oldest') => {
      const ids = [...selected];
      if (kind === 'send') {
        // The API sends at most 50 per request
        const results = [];
        for (let i = 0; i < ids.length; i += 50) {
          results.push(...(await unwrap(api.POST('/api/queue/send', { body: { ids: ids.slice(i, i + 50) } }))).results);
        }
        return { results };
      }
      if (kind === 'retry') return unwrap(api.POST('/api/queue/retry', { body: { ids } }));
      if (kind === 'cancel') return unwrap(api.POST('/api/queue/cancel', { body: { ids } }));
      return unwrap(
        api.POST('/api/queue/send-oldest', { body: { count: oldestCount, ...(relayIds.length && { relayId: relayIds }) } }),
      );
    },
    onSuccess: (res, kind) => {
      refresh();
      setSelected(new Set());
      if ('results' in res) {
        const ok = res.results.filter((r) => r.status === 'delivered').length;
        const msg = `${ok} of ${res.results.length} delivered`;
        if (ok === res.results.length) toast.success(msg);
        else toast.warning(msg, { description: res.results.find((r) => r.lastError)?.lastError ?? undefined });
      } else toast.success(`${res.affected} webhook(s) ${kind === 'retry' ? 'queued for retry' : 'cancelled'}`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const items = list.data?.items ?? [];
  const total = list.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / pageSize));

  // Live refresh or retention can shrink the list below the current page
  useEffect(() => {
    if (list.data && page > pages) update({ page: String(pages) }, false);
  });
  const allSelected = items.length > 0 && items.every((i) => selected.has(i.id));
  const activeFilters = FILTER_KEYS.filter((k) => (k === 'relayId' && fixedRelayId ? false : params.has(k))).length;
  const waiting = (stats.data?.counts.pending ?? 0) + (stats.data?.counts.failed ?? 0);

  const sortHeader = (key: SortKey, label: string, className?: string) => (
    <TableHead className={className}>
      <button
        type="button"
        className="hover:text-foreground inline-flex items-center gap-1"
        onClick={() => update({ sort: `${key}:${sortKey === key && sortDir === 'desc' ? 'asc' : 'desc'}` }, false)}
      >
        {label}
        {sortKey === key ? sortDir === 'desc' ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" /> : <ArrowUpDown className="size-3 opacity-40" />}
      </button>
    </TableHead>
  );

  return (
    <div className="space-y-4">
      {/* queue summary */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border p-3">
        {QUEUE_STATUSES.map((s) => {
          const on = statuses.includes(s);
          return (
            <button
              key={s}
              type="button"
              title={`${STATUS_HELP[s]}. Click to filter.`}
              onClick={() => update({ status: on ? statuses.filter((x) => x !== s) : [...statuses, s] })}
              className={cn('flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors', on ? 'border-primary bg-primary/5' : 'hover:bg-accent')}
            >
              <StatusBadge status={s} />
              <span className="tabular-nums">{stats.data?.counts[s] ?? '–'}</span>
            </button>
          );
        })}
        <div className="text-muted-foreground ml-auto flex flex-wrap items-center gap-2 text-xs">
          {stats.data?.oldestWaitingAt && <span>Oldest waiting: {relativeTime(stats.data.oldestWaitingAt)}</span>}
          {waiting > 0 && (
            <div className="flex items-center gap-1">
              <Input
                type="number"
                min={1}
                max={50}
                value={oldestCount}
                onChange={(e) => setOldestCount(Math.min(50, Math.max(1, Number(e.target.value))))}
                className="h-7 w-16 text-xs"
                aria-label="How many to send"
              />
              <Button size="sm" variant="outline" className="h-7 text-xs" disabled={bulk.isPending} onClick={() => bulk.mutate('oldest')}>
                <Send /> Send oldest now
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* filters */}
      <div className="flex flex-wrap items-center gap-2">
        <Input placeholder="Search payloads and errors…" value={search} onChange={(e) => setSearch(e.target.value)} className="h-8 w-64" />
        {!fixedRelayId && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                Relay {relayIds.length > 0 && <Badge variant="secondary">{relayIds.length}</Badge>}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuLabel>Relays</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {(relays.data ?? []).map((r) => (
                <DropdownMenuCheckboxItem
                  key={r.id}
                  checked={relayIds.includes(r.id)}
                  onSelect={(e) => e.preventDefault()}
                  onCheckedChange={(on) => update({ relayId: on ? [...relayIds, r.id] : relayIds.filter((x) => x !== r.id) })}
                >
                  {r.name}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <div className="flex items-center gap-1 text-xs">
          <Input
            type="datetime-local"
            className="h-8 w-48 text-xs"
            value={toLocalInput(params.get('from'))}
            onChange={(e) => update({ from: e.target.value ? new Date(e.target.value).toISOString() : null })}
            aria-label="From"
          />
          <span className="text-muted-foreground">to</span>
          <Input
            type="datetime-local"
            className="h-8 w-48 text-xs"
            value={toLocalInput(params.get('to'))}
            onChange={(e) => update({ to: e.target.value ? new Date(e.target.value).toISOString() : null })}
            aria-label="To"
          />
        </div>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm">
              <Filter /> More
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80 space-y-3" align="start">
            <div className="space-y-1">
              <Label className="text-xs">Discord HTTP status</Label>
              <Input
                type="number"
                className="h-8 text-xs"
                placeholder="e.g. 429"
                defaultValue={params.get('statusCode') ?? ''}
                onBlur={(e) => update({ statusCode: e.target.value || null })}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Errors</Label>
              <Select value={hasError ?? 'any'} onValueChange={(v) => update({ hasError: v === 'any' ? null : v })}>
                <SelectTrigger size="sm" className="w-full text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Any</SelectItem>
                  <SelectItem value="true">With an error</SelectItem>
                  <SelectItem value="false">Without errors</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Payload field equals</Label>
              <div className="flex gap-1">
                <Input
                  className="h-8 font-mono text-xs"
                  placeholder="data.task.id"
                  defaultValue={params.get('path') ?? ''}
                  onBlur={(e) => update({ path: e.target.value || null })}
                />
                <Input
                  className="h-8 text-xs"
                  placeholder="value (empty = exists)"
                  defaultValue={params.get('pathValue') ?? ''}
                  onBlur={(e) => update({ pathValue: e.target.value || null })}
                />
              </div>
            </div>
          </PopoverContent>
        </Popover>
        {activeFilters > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSearch('');
              update(Object.fromEntries(FILTER_KEYS.filter((k) => !(k === 'relayId' && fixedRelayId)).map((k) => [k, null])));
            }}
          >
            <X /> Clear filters ({activeFilters})
          </Button>
        )}
        <div className="ml-auto flex items-center gap-2 text-xs">
          <Switch id="live" checked={live} onCheckedChange={setLive} />
          <Label htmlFor="live" className="text-xs">
            Live
          </Label>
          <Button variant="ghost" size="sm" onClick={refresh} aria-label="Refresh">
            <RefreshCw className={cn(list.isFetching && 'animate-spin')} />
          </Button>
        </div>
      </div>

      {selected.size > 0 && (
        <div className="bg-muted/50 flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm">
          <span className="font-medium">{selected.size} selected</span>
          <Button size="sm" onClick={() => bulk.mutate('send')} disabled={bulk.isPending} title="Pending/failed only">
            <Send /> Send now
          </Button>
          <Button size="sm" variant="outline" onClick={() => bulk.mutate('retry')} disabled={bulk.isPending} title="Dead/failed/skipped only">
            <RefreshCw /> Retry
          </Button>
          <Button size="sm" variant="outline" onClick={() => bulk.mutate('cancel')} disabled={bulk.isPending} title="Pending/failed only">
            <Ban /> Cancel
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
        </div>
      )}

      {list.isError ? (
        <p className="text-destructive text-sm">{errorMessage(list.error)}</p>
      ) : !list.isPending && total === 0 ? (
        <EmptyState icon={<ScrollText />} title={activeFilters ? 'No webhooks match these filters' : 'No webhooks received yet'}>
          {activeFilters ? 'Try clearing some filters.' : 'Send something to a relay URL and it shows up here.'}
        </EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8">
                  <Checkbox
                    checked={allSelected}
                    onCheckedChange={(on) => setSelected(on ? new Set(items.map((i) => i.id)) : new Set())}
                    aria-label="Select page"
                  />
                </TableHead>
                {sortHeader('receivedAt', 'Received')}
                {!fixedRelayId && sortHeader('relayName', 'Relay')}
                {sortHeader('status', 'Status')}
                {sortHeader('attempts', 'Attempts')}
                {sortHeader('lastStatusCode', 'HTTP')}
                <TableHead>Error</TableHead>
                {sortHeader('nextAttemptAt', 'Next try')}
                <TableHead>Took</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((i: QueueItem) => (
                <TableRow key={i.id} className="cursor-pointer" data-state={selected.has(i.id) ? 'selected' : undefined} onClick={() => setOpenId(i.id)}>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={selected.has(i.id)}
                      onCheckedChange={(on) => {
                        const next = new Set(selected);
                        if (on) next.add(i.id);
                        else next.delete(i.id);
                        setSelected(next);
                      }}
                      aria-label="Select row"
                    />
                  </TableCell>
                  <TableCell className="whitespace-nowrap" title={dateTime(i.receivedAt)}>
                    {relativeTime(i.receivedAt)}
                  </TableCell>
                  {!fixedRelayId && <TableCell className="max-w-40 truncate">{i.relayName}</TableCell>}
                  <TableCell>
                    <StatusBadge status={i.status} />
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {i.attempts}/{i.maxAttempts}
                  </TableCell>
                  <TableCell className="tabular-nums">{i.lastStatusCode ?? '—'}</TableCell>
                  <TableCell className="text-muted-foreground max-w-80 truncate text-xs" title={i.lastError ?? undefined}>
                    {i.lastError ?? ''}
                  </TableCell>
                  <TableCell className="text-xs whitespace-nowrap">
                    {['pending', 'failed'].includes(i.status) ? relativeTime(i.nextAttemptAt) : '—'}
                  </TableCell>
                  <TableCell className="text-xs whitespace-nowrap">{duration(i.durationMs)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="text-muted-foreground">
            {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}
          </span>
          <div className="flex items-center gap-2">
            <Select value={String(pageSize)} onValueChange={(v) => update({ pageSize: v })}>
              <SelectTrigger size="sm" className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[25, 50, 100, 200].map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n} / page
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => update({ page: String(page - 1) }, false)}>
              Previous
            </Button>
            <span className="tabular-nums">
              {page} / {pages}
            </span>
            <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => update({ page: String(page + 1) }, false)}>
              Next
            </Button>
          </div>
        </div>
      )}

      <LogDetailSheet id={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}

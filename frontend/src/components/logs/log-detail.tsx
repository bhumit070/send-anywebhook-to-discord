import type { DiscordMessage } from '@send-any-webhook/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, ChevronRight, FileInput, RefreshCw, Repeat, Send } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { cn } from 'cn';
import { api, errorMessage, unwrap } from '@/api/client';
import type { Attempt, QueueDetail } from '@/api/types';
import { JsonEditor, StatusBadge } from '@/components/common';
import { DiscordPreview } from '@/components/discord/preview';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { dateTime, duration, prettyJson, relativeTime } from '@/lib/format';

function AttemptCard({ a }: { a: Attempt }) {
  const [open, setOpen] = useState(false);
  const ok = a.responseStatus !== null && a.responseStatus >= 200 && a.responseStatus < 300;
  return (
    <div className="rounded-md border">
      <button type="button" onClick={() => setOpen(!open)} className="hover:bg-accent/50 flex w-full items-center gap-2 p-2 text-left text-sm">
        <ChevronRight className={cn('size-4 shrink-0 transition-transform', open && 'rotate-90')} />
        <span className="font-medium">#{a.attemptNo}</span>
        <Badge variant="outline" className="capitalize">
          {a.trigger}
        </Badge>
        {a.stage === 'render' ? (
          <Badge variant="destructive">render error</Badge>
        ) : a.responseStatus !== null ? (
          <Badge variant={ok ? 'default' : 'destructive'}>HTTP {a.responseStatus}</Badge>
        ) : (
          <Badge variant="destructive">no response</Badge>
        )}
        <span className="text-muted-foreground ml-auto text-xs" title={dateTime(a.startedAt)}>
          {relativeTime(a.startedAt)} · {duration(a.durationMs)}
        </span>
      </button>
      {a.errorMessage && <p className="text-destructive px-3 pb-2 font-mono text-xs break-words">{a.errorMessage}</p>}
      {open && (
        <div className="space-y-3 border-t p-3">
          {a.errorStack && (
            <div>
              <div className="text-muted-foreground mb-1 text-xs font-medium">Stack trace</div>
              <pre className="bg-muted max-h-48 overflow-auto rounded p-2 text-[11px]">{a.errorStack}</pre>
            </div>
          )}
          {a.requestBody !== null && (
            <div>
              <div className="text-muted-foreground mb-1 text-xs font-medium">Sent to Discord</div>
              <JsonEditor value={prettyJson(a.requestBody)} readOnly minHeight="0" maxHeight="240px" />
            </div>
          )}
          {a.responseStatus !== null && (
            <div>
              <div className="text-muted-foreground mb-1 text-xs font-medium">Discord response</div>
              <pre className="bg-muted max-h-48 overflow-auto rounded p-2 text-[11px] whitespace-pre-wrap">
                {prettyJson(a.responseHeaders)}
                {'\n\n'}
                {a.responseBody || '(empty body)'}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function LogDetailSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const qc = useQueryClient();
  const detail = useQuery({
    queryKey: ['queue', id],
    queryFn: async () => (await unwrap(api.GET('/api/queue/{id}', { params: { path: { id: id! } } }))) as QueueDetail,
    enabled: !!id,
    refetchInterval: (q) => (['pending', 'processing', 'failed'].includes(q.state.data?.status ?? '') ? 3000 : false),
  });
  const d = detail.data;

  const action = useMutation({
    mutationFn: async (kind: 'send' | 'retry' | 'cancel' | 'replay' | 'sample') => {
      const path = { id: id! };
      if (kind === 'send') return unwrap(api.POST('/api/queue/{id}/send', { params: { path } }));
      if (kind === 'retry') return unwrap(api.POST('/api/queue/{id}/retry', { params: { path } }));
      if (kind === 'cancel') return unwrap(api.POST('/api/queue/{id}/cancel', { params: { path } }));
      if (kind === 'replay') return unwrap(api.POST('/api/queue/{id}/replay', { params: { path } }));
      return unwrap(
        api.PUT('/api/relays/{id}/sample', { params: { path: { id: d!.relayId! } }, body: { type: 'example', data: d!.payload } }),
      );
    },
    onSuccess: (res, kind) => {
      void qc.invalidateQueries({ queryKey: ['queue'] });
      void qc.invalidateQueries({ queryKey: ['relays'] });
      const r = res as { status?: string; lastError?: string | null; affected?: number };
      if (kind === 'sample') toast.success('Saved as the relay\'s sample payload');
      else if (kind === 'retry' || kind === 'cancel') toast.success(r.affected ? (kind === 'retry' ? 'Queued for retry' : 'Cancelled') : 'Nothing changed');
      else if (r.status === 'delivered') toast.success(kind === 'replay' ? 'Replayed and delivered' : 'Delivered');
      else toast.error(`${r.status}: ${r.lastError ?? 'not delivered'}`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <Sheet open={!!id} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            Webhook {d && <StatusBadge status={d.status} />}
          </SheetTitle>
          <SheetDescription className="font-mono text-xs">{id}</SheetDescription>
        </SheetHeader>
        {!d ? (
          <div className="space-y-3 px-4">
            <Skeleton className="h-24" />
            <Skeleton className="h-64" />
          </div>
        ) : (
          <div className="space-y-4 px-4 pb-6">
            <div className="flex flex-wrap gap-2">
              {['pending', 'failed'].includes(d.status) && (
                <Button size="sm" onClick={() => action.mutate('send')} disabled={action.isPending}>
                  <Send /> Send now
                </Button>
              )}
              {['dead', 'failed', 'skipped'].includes(d.status) && (
                <Button size="sm" variant="outline" onClick={() => action.mutate('retry')} disabled={action.isPending}>
                  <RefreshCw /> Retry
                </Button>
              )}
              {['pending', 'failed'].includes(d.status) && (
                <Button size="sm" variant="outline" onClick={() => action.mutate('cancel')} disabled={action.isPending}>
                  <Ban /> Cancel
                </Button>
              )}
              {d.payload !== null && (
                <Button size="sm" variant="outline" onClick={() => action.mutate('replay')} disabled={action.isPending}>
                  <Repeat /> Replay
                </Button>
              )}
              {d.payload !== null && d.relayId && (
                <Button size="sm" variant="ghost" onClick={() => action.mutate('sample')} disabled={action.isPending}>
                  <FileInput /> Use as sample
                </Button>
              )}
            </div>

            <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1.5 text-sm">
              <dt className="text-muted-foreground">Relay</dt>
              <dd>{d.relayId ? <Link className="hover:underline" to={`/relays/${d.relayId}`}>{d.relayName}</Link> : '—'}</dd>
              <dt className="text-muted-foreground">Received</dt>
              <dd>
                {dateTime(d.receivedAt)} {d.sourceIp && <span className="text-muted-foreground">from {d.sourceIp}</span>}
              </dd>
              <dt className="text-muted-foreground">Attempts</dt>
              <dd>
                {d.attempts} of {d.maxAttempts}
              </dd>
              {d.deliveredAt && (
                <>
                  <dt className="text-muted-foreground">Delivered</dt>
                  <dd>{dateTime(d.deliveredAt)}</dd>
                </>
              )}
              {['pending', 'failed'].includes(d.status) && (
                <>
                  <dt className="text-muted-foreground">Next attempt</dt>
                  <dd>{relativeTime(d.nextAttemptAt)}</dd>
                </>
              )}
              {d.templateId && d.relayId && (
                <>
                  <dt className="text-muted-foreground">Template</dt>
                  <dd>
                    <Link className="hover:underline" to={`/relays/${d.relayId}/templates/${d.templateId}`}>
                      Open template
                    </Link>
                  </dd>
                </>
              )}
              {d.lastError && (
                <>
                  <dt className="text-muted-foreground">Last error</dt>
                  <dd className="text-destructive font-mono text-xs break-words">{d.lastError}</dd>
                </>
              )}
            </dl>

            <Tabs defaultValue={d.rendered ? 'message' : d.attemptsLog.length ? 'attempts' : 'payload'}>
              <TabsList>
                <TabsTrigger value="message">Message</TabsTrigger>
                <TabsTrigger value="payload">Payload</TabsTrigger>
                <TabsTrigger value="headers">Headers</TabsTrigger>
                <TabsTrigger value="attempts">Attempts ({d.attemptsLog.length})</TabsTrigger>
              </TabsList>
              <TabsContent value="message">
                <DiscordPreview message={d.rendered as DiscordMessage | null} empty="No message was rendered for this webhook." />
              </TabsContent>
              <TabsContent value="payload">
                {d.payload === null ? (
                  <p className="text-muted-foreground text-sm">Rejected on arrival; the body was not stored.</p>
                ) : (
                  <JsonEditor value={prettyJson(d.payload)} readOnly maxHeight="60vh" />
                )}
              </TabsContent>
              <TabsContent value="headers">
                <JsonEditor value={prettyJson(d.headers)} readOnly maxHeight="60vh" />
              </TabsContent>
              <TabsContent value="attempts" className="space-y-2">
                {d.attemptsLog.length === 0 ? (
                  <p className="text-muted-foreground text-sm">No delivery attempts yet.</p>
                ) : (
                  [...d.attemptsLog].reverse().map((a) => <AttemptCard key={a.id} a={a} />)
                )}
              </TabsContent>
            </Tabs>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

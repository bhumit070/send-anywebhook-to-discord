import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Plus, Webhook } from 'lucide-react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { api, errorMessage, unwrap } from '@/api/client';
import type { QueueStatus, Relay } from '@/api/types';
import { CopyButton, EmptyState, PageHeader, StatusBadge } from '@/components/common';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { relativeTime } from '@/lib/format';

export function useRelays() {
  return useQuery({ queryKey: ['relays'], queryFn: () => unwrap(api.GET('/api/relays')), refetchInterval: 15_000 });
}

function RelayRow({ relay }: { relay: Relay }) {
  const qc = useQueryClient();
  const toggle = useMutation({
    mutationFn: (enabled: boolean) => unwrap(api.PATCH('/api/relays/{id}', { params: { path: { id: relay.id } }, body: { enabled } })),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['relays'] });
      toast.success(r.enabled ? `${r.name} enabled` : `${r.name} disabled`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const needsSetup = relay.templateCount === 0;

  return (
    <Card className="py-4">
      <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1 basis-64">
          <div className="flex items-center gap-2">
            <Link to={`/relays/${relay.id}`} className="truncate font-medium hover:underline">
              {relay.name}
            </Link>
            {!relay.enabled && <Badge variant="secondary">Disabled</Badge>}
            {needsSetup && (
              <Badge variant="outline" className="border-amber-500/40 text-amber-700 dark:text-amber-300">
                <AlertTriangle /> No template
              </Badge>
            )}
          </div>
          <div className="mt-1 flex min-w-0 items-center gap-2">
            <code className="text-muted-foreground truncate text-xs">{relay.ingestUrl}</code>
            <CopyButton value={relay.ingestUrl} label="Copy URL" className="h-7 shrink-0 px-2 text-xs" />
          </div>
        </div>
        <div className="text-sm">
          <div className="text-muted-foreground text-xs">Sends to</div>
          <Link to="/discord-webhooks" className="hover:underline">
            {relay.discordWebhook.name}
          </Link>
        </div>
        <div className="text-sm">
          <div className="text-muted-foreground text-xs">Last webhook</div>
          <div className="flex items-center gap-2">
            {relativeTime(relay.lastReceivedAt)}
            {relay.lastStatus && <StatusBadge status={relay.lastStatus as QueueStatus} />}
          </div>
        </div>
        <div className="text-sm">
          <div className="text-muted-foreground text-xs">Waiting</div>
          <Link to={`/logs?relayId=${relay.id}&status=pending&status=failed&status=processing`} className="hover:underline">
            {relay.backlog}
          </Link>
        </div>
        <div className="flex items-center gap-3">
          <Switch
            checked={relay.enabled}
            disabled={toggle.isPending}
            onCheckedChange={(v) => toggle.mutate(v)}
            aria-label={relay.enabled ? 'Disable relay' : 'Enable relay'}
          />
          <Button asChild variant="outline" size="sm">
            <Link to={needsSetup ? `/relays/${relay.id}/templates/new` : `/relays/${relay.id}`}>{needsSetup ? 'Set up' : 'Open'}</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function RelaysPage() {
  const relays = useRelays();
  return (
    <>
      <PageHeader
        title="Relays"
        description="Each relay gives you a URL to paste into another service, and posts what it receives to a Discord channel."
        actions={
          <Button asChild>
            <Link to="/relays/new">
              <Plus /> New relay
            </Link>
          </Button>
        }
      />
      {relays.isPending ? (
        <div className="space-y-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      ) : relays.isError ? (
        <p className="text-destructive text-sm">{errorMessage(relays.error)}</p>
      ) : relays.data.length === 0 ? (
        <EmptyState icon={<Webhook />} title="No relays yet">
          Create one, paste an example payload, map its fields to a Discord message, and you get a URL to give to the other service.
          <div className="mt-4">
            <Button asChild>
              <Link to="/relays/new">
                <Plus /> New relay
              </Link>
            </Button>
          </div>
        </EmptyState>
      ) : (
        <div className="space-y-3">
          {relays.data.map((r) => (
            <RelayRow key={r.id} relay={r} />
          ))}
        </div>
      )}
    </>
  );
}

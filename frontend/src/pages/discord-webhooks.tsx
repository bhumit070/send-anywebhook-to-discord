import { isDiscordWebhookUrl } from '@send-any-webhook/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Hash, Pencil, Plus, Send, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { api, errorMessage, unwrap } from '@/api/client';
import type { SavedWebhook } from '@/api/types';
import { EmptyState, PageHeader } from '@/components/common';
import { useSavedWebhooks } from '@/components/webhook-picker';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';

function useInvalidate() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['discord-webhooks'] });
    void qc.invalidateQueries({ queryKey: ['relays'] });
    void qc.invalidateQueries({ queryKey: ['relay'] });
  };
}

function AddWebhook() {
  const invalidate = useInvalidate();
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const urlInvalid = url !== '' && !isDiscordWebhookUrl(url);
  const add = useMutation({
    mutationFn: () => unwrap(api.POST('/api/discord-webhooks', { body: { name, url } })),
    onSuccess: (w) => {
      invalidate();
      setName('');
      setUrl('');
      toast.success(`Saved “${w.name}”`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    add.mutate();
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>Add a webhook</CardTitle>
        <CardDescription>In Discord: channel settings → Integrations → Webhooks → New Webhook → Copy Webhook URL.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid items-end gap-3 sm:grid-cols-[1fr_2fr_auto]">
          <div className="space-y-2">
            <Label htmlFor="new-name">Name</Label>
            <Input id="new-name" required maxLength={100} placeholder="#dev-alerts" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-url">Webhook URL</Label>
            <Input
              id="new-url"
              required
              placeholder="https://discord.com/api/webhooks/…"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              aria-invalid={urlInvalid}
            />
          </div>
          <Button type="submit" disabled={!name.trim() || !isDiscordWebhookUrl(url) || add.isPending}>
            <Plus /> Save
          </Button>
          {urlInvalid && <p className="text-destructive text-xs sm:col-span-3">That doesn't look like a Discord webhook URL.</p>}
        </form>
      </CardContent>
    </Card>
  );
}

function WebhookCard({ webhook }: { webhook: SavedWebhook }) {
  const invalidate = useInvalidate();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(webhook.name);
  const [url, setUrl] = useState('');
  const id = { params: { path: { id: webhook.id } } };

  const save = useMutation({
    mutationFn: () =>
      unwrap(
        api.PATCH('/api/discord-webhooks/{id}', {
          ...id,
          body: { ...(name.trim() !== webhook.name && { name: name.trim() }), ...(url.trim() && { url: url.trim() }) },
        }),
      ),
    onSuccess: () => {
      invalidate();
      setEditing(false);
      setUrl('');
      toast.success('Saved');
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const test = useMutation({
    mutationFn: () => unwrap(api.POST('/api/discord-webhooks/{id}/test', id)),
    onSuccess: (r) => (r.ok ? toast.success('Sent. Check your Discord channel.') : toast.error(r.error ?? 'Failed')),
    onError: (err) => toast.error(errorMessage(err)),
  });
  const remove = useMutation({
    mutationFn: () => unwrap(api.DELETE('/api/discord-webhooks/{id}', id)),
    onSuccess: () => {
      invalidate();
      toast.success(`Deleted “${webhook.name}”`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const inUse = webhook.relays.length > 0;

  return (
    <Card className="py-4">
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 font-medium">
              <Hash className="text-muted-foreground size-4" /> {webhook.name}
            </div>
            <code className="text-muted-foreground text-xs break-all">{webhook.url}</code>
            <div className="text-muted-foreground mt-1 text-xs">
              {inUse ? (
                <>
                  Used by{' '}
                  {webhook.relays.map((r, i) => (
                    <span key={r.id}>
                      {i > 0 && ', '}
                      <Link to={`/relays/${r.id}`} className="text-foreground hover:underline">
                        {r.name}
                      </Link>
                    </span>
                  ))}
                </>
              ) : (
                'Not used by any relay'
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => test.mutate()} disabled={test.isPending}>
              <Send /> Test
            </Button>
            <Button variant="outline" size="sm" onClick={() => setEditing(!editing)}>
              <Pencil /> Edit
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={inUse}
                  title={inUse ? 'Move its relays to another webhook first' : 'Delete'}
                  aria-label="Delete webhook"
                >
                  <Trash2 />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete “{webhook.name}”?</AlertDialogTitle>
                  <AlertDialogDescription>
                    It's removed from your saved list. The webhook itself keeps existing in Discord.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => remove.mutate()}>Delete</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
        {editing && (
          <div className="grid items-end gap-3 border-t pt-3 sm:grid-cols-[1fr_2fr_auto]">
            <div className="space-y-2">
              <Label htmlFor={`name-${webhook.id}`}>Name</Label>
              <Input id={`name-${webhook.id}`} maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`url-${webhook.id}`}>New URL (optional)</Label>
              <Input
                id={`url-${webhook.id}`}
                placeholder="Leave empty to keep the current URL"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                aria-invalid={url !== '' && !isDiscordWebhookUrl(url)}
              />
            </div>
            <Button
              onClick={() => save.mutate()}
              disabled={!name.trim() || (url !== '' && !isDiscordWebhookUrl(url)) || (name.trim() === webhook.name && !url) || save.isPending}
            >
              Save
            </Button>
            {inUse && url && (
              <p className="text-muted-foreground text-xs sm:col-span-3">
                All {webhook.relays.length} relay(s) using this webhook will send to the new URL.
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function DiscordWebhooksPage() {
  const saved = useSavedWebhooks();
  return (
    <>
      <PageHeader
        title="Discord webhooks"
        description="Save each Discord channel's webhook URL once, then pick it for any number of relays."
      />
      <div className="space-y-4">
        <AddWebhook />
        {saved.isPending ? (
          <Skeleton className="h-24" />
        ) : saved.isError ? (
          <p className="text-destructive text-sm">{errorMessage(saved.error)}</p>
        ) : saved.data.length === 0 ? (
          <EmptyState icon={<Hash />} title="No saved webhooks yet">
            Add one above, or paste a URL when creating a relay; it's saved here automatically.
          </EmptyState>
        ) : (
          saved.data.map((w) => <WebhookCard key={w.id} webhook={w} />)
        )}
      </div>
    </>
  );
}

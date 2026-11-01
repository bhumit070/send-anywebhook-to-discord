import { isDiscordWebhookUrl } from '@send-any-webhook/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { api, errorMessage, unwrap } from '@/api/client';
import type { SavedWebhook } from '@/api/types';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from '@/components/ui/select';

const NEW = '__new';

export function useSavedWebhooks() {
  return useQuery({ queryKey: ['discord-webhooks'], queryFn: () => unwrap(api.GET('/api/discord-webhooks')) });
}

/** Dialog that saves a Discord webhook to the user's list and reports the new one. */
export function NewWebhookDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (webhook: SavedWebhook) => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const urlInvalid = url !== '' && !isDiscordWebhookUrl(url);
  const create = useMutation({
    mutationFn: () => unwrap(api.POST('/api/discord-webhooks', { body: { name: name.trim(), url: url.trim() } })),
    onSuccess: async (webhook) => {
      await qc.invalidateQueries({ queryKey: ['discord-webhooks'] });
      onCreated(webhook);
      setName('');
      setUrl('');
      onOpenChange(false);
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    // The dialog renders in a portal, but React still bubbles events to the form around the picker
    e.stopPropagation();
    create.mutate();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) create.reset();
        onOpenChange(o);
      }}
    >
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>New Discord webhook</DialogTitle>
            <DialogDescription>
              In Discord: channel settings → Integrations → Webhooks → New Webhook → Copy Webhook URL. It's saved to your Discord webhooks so
              you can reuse it.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="new-webhook-name">Name</Label>
            <Input id="new-webhook-name" required autoFocus maxLength={100} placeholder="#dev-alerts" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-webhook-url">Webhook URL</Label>
            <Input
              id="new-webhook-url"
              required
              placeholder="https://discord.com/api/webhooks/…"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              aria-invalid={urlInvalid}
            />
            {urlInvalid && <p className="text-destructive text-xs">That doesn't look like a Discord webhook URL.</p>}
          </div>
          {create.isError && (
            <Alert variant="destructive">
              <AlertDescription>{errorMessage(create.error)}</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || !isDiscordWebhookUrl(url) || create.isPending}>
              Save and select
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Dropdown of saved Discord webhooks, with a dialog to add a new one (which is then selected). */
export function WebhookPicker({ value, onChange, id = 'webhook' }: { value: string | null; onChange: (id: string) => void; id?: string }) {
  const saved = useSavedWebhooks();
  const [dialogOpen, setDialogOpen] = useState(false);
  const list = saved.data ?? [];

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>Discord webhook</Label>
      <div className="flex gap-2">
        <Select
          value={value ?? ''}
          onValueChange={(v) => (v === NEW ? setDialogOpen(true) : onChange(v))}
          disabled={saved.isPending}
        >
          <SelectTrigger id={id} className="min-w-0 flex-1">
            <SelectValue placeholder={list.length ? 'Choose a Discord webhook' : 'No saved webhooks yet: create one'} />
          </SelectTrigger>
          <SelectContent>
            {list.map((w) => (
              <SelectItem key={w.id} value={w.id}>
                <span className="font-medium">{w.name}</span>
                <span className="text-muted-foreground ml-2 font-mono text-xs">{w.url.replace('https://discord.com/api/webhooks/', '…/')}</span>
              </SelectItem>
            ))}
            {list.length > 0 && <SelectSeparator />}
            <SelectItem value={NEW}>+ New webhook…</SelectItem>
          </SelectContent>
        </Select>
        <Button type="button" variant="outline" onClick={() => setDialogOpen(true)}>
          <Plus /> New webhook
        </Button>
      </div>
      <NewWebhookDialog open={dialogOpen} onOpenChange={setDialogOpen} onCreated={(w) => onChange(w.id)} />
    </div>
  );
}

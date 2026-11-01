import { isDiscordWebhookUrl } from '@send-any-webhook/shared';
import { useQuery } from '@tanstack/react-query';
import { api, unwrap } from '@/api/client';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from '@/components/ui/select';

/** What the relay API expects: a saved webhook, or a URL to save (reused if already saved). */
export type WebhookChoice =
  | { discordWebhookId: string }
  | { discordWebhookUrl: string; discordWebhookName?: string };

export interface PickerValue {
  savedId: string | null; // null = paste a new URL
  url: string;
  name: string;
}

export const NEW = '__new';

export function useSavedWebhooks() {
  return useQuery({ queryKey: ['discord-webhooks'], queryFn: () => unwrap(api.GET('/api/discord-webhooks')) });
}

/** The request fields for a picker value, or null when it isn't complete yet. */
export function webhookChoice(v: PickerValue): WebhookChoice | null {
  if (v.savedId) return { discordWebhookId: v.savedId };
  if (!isDiscordWebhookUrl(v.url)) return null;
  return { discordWebhookUrl: v.url.trim(), ...(v.name.trim() && { discordWebhookName: v.name.trim() }) };
}

/** Choose a saved Discord webhook, or paste a new URL (which gets saved for next time). */
export function WebhookPicker({ value, onChange, id = 'webhook' }: { value: PickerValue; onChange: (v: PickerValue) => void; id?: string }) {
  const saved = useSavedWebhooks();
  const isNew = value.savedId === null;
  const urlInvalid = isNew && value.url !== '' && !isDiscordWebhookUrl(value.url);

  return (
    <div className="space-y-3">
      {!!saved.data?.length && (
        <div className="space-y-2">
          <Label htmlFor={`${id}-select`}>Discord webhook</Label>
          <Select value={value.savedId ?? NEW} onValueChange={(v) => onChange({ ...value, savedId: v === NEW ? null : v })}>
            <SelectTrigger id={`${id}-select`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {saved.data.map((w) => (
                <SelectItem key={w.id} value={w.id}>
                  <span className="font-medium">{w.name}</span>
                  <span className="text-muted-foreground ml-2 font-mono text-xs">{w.url.replace('https://discord.com/api/webhooks/', '…/')}</span>
                </SelectItem>
              ))}
              <SelectSeparator />
              <SelectItem value={NEW}>+ Paste a new webhook URL</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
      {isNew && (
        <div className="grid gap-3 sm:grid-cols-[1fr_2fr]">
          <div className="space-y-2">
            <Label htmlFor={`${id}-name`}>Save as</Label>
            <Input id={`${id}-name`} placeholder="#dev-alerts" maxLength={100} value={value.name} onChange={(e) => onChange({ ...value, name: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${id}-url`}>Discord webhook URL</Label>
            <Input
              id={`${id}-url`}
              placeholder="https://discord.com/api/webhooks/…"
              value={value.url}
              onChange={(e) => onChange({ ...value, url: e.target.value })}
              aria-invalid={urlInvalid}
            />
          </div>
          <p className={`text-xs sm:col-span-2 ${urlInvalid ? 'text-destructive' : 'text-muted-foreground'}`}>
            {urlInvalid
              ? "That doesn't look like a Discord webhook URL."
              : 'Saved to your webhook list so you can reuse it. Pasting a URL you already saved reuses that one.'}
          </p>
        </div>
      )}
    </div>
  );
}

import { HMAC_PRESETS, INGEST_AUTH_LABELS, type IngestAuth, type IngestAuthType } from '@send-any-webhook/shared';
import { Fingerprint, KeyRound, Link2, UserLock } from 'lucide-react';
import { cn } from 'cn';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

/** Editable credentials; empty secret/password = generate (new) or keep (existing). */
export interface AuthDraft {
  type: IngestAuthType;
  headerName: string;
  secret: string;
  username: string;
  password: string;
  algorithm: 'sha256' | 'sha1' | 'sha512';
  encoding: 'hex' | 'base64';
  prefix: string;
}

export function authDraft(auth?: IngestAuth): AuthDraft {
  const d: AuthDraft = { type: 'token', headerName: '', secret: '', username: '', password: '', algorithm: 'sha256', encoding: 'hex', prefix: '' };
  if (!auth) return d;
  switch (auth.type) {
    case 'none':
      return { ...d, type: 'none' };
    case 'token':
      return { ...d, type: 'token', headerName: auth.headerName };
    case 'basic':
      return { ...d, type: 'basic', username: auth.username };
    case 'hmac':
      return { ...d, type: 'hmac', headerName: auth.headerName, algorithm: auth.algorithm, encoding: auth.encoding, prefix: auth.prefix };
  }
}

/** The API body for a draft; empty strings are left out so the server keeps or generates them. */
export function authInput(d: AuthDraft) {
  const opt = (k: string, v: string) => (v.trim() ? { [k]: v.trim() } : {});
  switch (d.type) {
    case 'none':
      return { type: 'none' as const };
    case 'token':
      return { type: 'token' as const, ...opt('headerName', d.headerName), ...opt('secret', d.secret) };
    case 'basic':
      return { type: 'basic' as const, ...opt('username', d.username), ...opt('password', d.password) };
    case 'hmac':
      return {
        type: 'hmac' as const,
        ...opt('headerName', d.headerName),
        ...opt('secret', d.secret),
        algorithm: d.algorithm,
        encoding: d.encoding,
        prefix: d.prefix,
      };
  }
}

const OPTIONS: { type: IngestAuthType; icon: React.ReactNode; hint: string }[] = [
  { type: 'token', icon: <KeyRound />, hint: 'Sender adds a header, e.g. Authorization: Bearer …' },
  { type: 'basic', icon: <UserLock />, hint: 'Also works as https://user:pass@host/… for URL-only services' },
  { type: 'hmac', icon: <Fingerprint />, hint: 'Sender signs each body (GitHub, Vikunja, …)' },
  { type: 'none', icon: <Link2 />, hint: 'Anyone with the URL can post' },
];

/** Lets the user choose how senders must authenticate, with the fields for that method. */
export function AuthEditor({ value, onChange, existing }: { value: AuthDraft; onChange: (d: AuthDraft) => void; existing?: IngestAuth }) {
  const set = (patch: Partial<AuthDraft>) => onChange({ ...value, ...patch });
  // Secrets are kept when the method stays the same, otherwise a new one is generated
  const keeps = existing?.type === value.type;
  const secretHint = keeps ? 'Leave empty to keep the current one' : 'Leave empty to generate a strong one';
  const preset = Object.entries(HMAC_PRESETS).find(
    ([, p]) => p.headerName === value.headerName && p.prefix === value.prefix && p.algorithm === value.algorithm && p.encoding === value.encoding,
  )?.[0];

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        {OPTIONS.map((o) => (
          <button
            key={o.type}
            type="button"
            onClick={() => set({ type: o.type })}
            aria-pressed={value.type === o.type}
            className={cn(
              'flex items-start gap-2 rounded-md border p-2.5 text-left transition-colors [&_svg]:mt-0.5 [&_svg]:size-4 [&_svg]:shrink-0',
              value.type === o.type ? 'border-primary bg-primary/5 ring-primary/30 ring-2' : 'hover:bg-accent',
            )}
          >
            {o.icon}
            <span>
              <span className="block text-sm font-medium">{INGEST_AUTH_LABELS[o.type]}</span>
              <span className="text-muted-foreground block text-xs">{o.hint}</span>
            </span>
          </button>
        ))}
      </div>

      {value.type === 'token' && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="auth-header">Header</Label>
            <Input id="auth-header" placeholder="Authorization" value={value.headerName} onChange={(e) => set({ headerName: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="auth-secret">Token</Label>
            <Input id="auth-secret" type="password" autoComplete="off" placeholder={secretHint} value={value.secret} onChange={(e) => set({ secret: e.target.value })} />
          </div>
          <p className="text-muted-foreground text-xs sm:col-span-2">
            Accepted as <code>Bearer &lt;token&gt;</code> or the bare token in that header.
          </p>
        </div>
      )}

      {value.type === 'basic' && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="auth-user">Username</Label>
            <Input id="auth-user" placeholder="webhook" value={value.username} onChange={(e) => set({ username: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="auth-pass">Password</Label>
            <Input id="auth-pass" type="password" autoComplete="new-password" placeholder={secretHint} value={value.password} onChange={(e) => set({ password: e.target.value })} />
          </div>
        </div>
      )}

      {value.type === 'hmac' && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="auth-preset">Format</Label>
            <Select
              value={preset ?? 'custom'}
              onValueChange={(k) => {
                const p = HMAC_PRESETS[k];
                if (p) set({ headerName: p.headerName, algorithm: p.algorithm, encoding: p.encoding, prefix: p.prefix });
              }}
            >
              <SelectTrigger id="auth-preset" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(HMAC_PRESETS).map(([k, p]) => (
                  <SelectItem key={k} value={k}>
                    {p.label}
                  </SelectItem>
                ))}
                <SelectItem value="custom">Custom</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="auth-sig-header">Signature header</Label>
            <Input id="auth-sig-header" placeholder="X-Signature" value={value.headerName} onChange={(e) => set({ headerName: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="auth-hmac-secret">Shared secret</Label>
            <Input
              id="auth-hmac-secret"
              type="password"
              autoComplete="off"
              placeholder={keeps ? 'Leave empty to keep the current one' : 'Paste the service\'s secret, or leave empty to generate'}
              value={value.secret}
              onChange={(e) => set({ secret: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-3 gap-2 sm:col-span-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Algorithm</Label>
              <Select value={value.algorithm} onValueChange={(v) => set({ algorithm: v as AuthDraft['algorithm'] })}>
                <SelectTrigger size="sm" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sha256">SHA-256</SelectItem>
                  <SelectItem value="sha1">SHA-1</SelectItem>
                  <SelectItem value="sha512">SHA-512</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Encoding</Label>
              <Select value={value.encoding} onValueChange={(v) => set({ encoding: v as AuthDraft['encoding'] })}>
                <SelectTrigger size="sm" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="hex">hex</SelectItem>
                  <SelectItem value="base64">base64</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs" htmlFor="auth-prefix">
                Prefix
              </Label>
              <Input id="auth-prefix" className="h-8" placeholder="e.g. sha256=" value={value.prefix} onChange={(e) => set({ prefix: e.target.value })} />
            </div>
          </div>
        </div>
      )}

      {value.type === 'none' && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-xs text-amber-800 dark:text-amber-300">
          Anyone who gets hold of the URL can post messages to your Discord channel. The URL contains a long random key, but it can leak
          through logs or screenshots.
        </p>
      )}
    </div>
  );
}

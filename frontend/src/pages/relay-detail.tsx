import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Eye, EyeOff, FileJson, KeyRound, Pencil, Plus, RotateCcw, Send, ShieldAlert, ShieldCheck, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { api, errorMessage, unwrap } from '@/api/client';
import type { RelayDetail, Template, TestResult } from '@/api/types';
import { INGEST_AUTH_LABELS, type IngestAuth } from '@send-any-webhook/shared';
import { CopyButton, EmptyState, JsonEditor, PageHeader } from '@/components/common';
import { LogsView } from '@/components/logs/logs-view';
import { relayCurl, SampleEditor } from '@/components/sample-editor';
import { AuthEditor, authDraft, authInput } from '@/components/auth-editor';
import { WebhookPicker } from '@/components/webhook-picker';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { prettyJson } from '@/lib/format';

function Confirm({
  trigger,
  title,
  description,
  action,
  onConfirm,
}: {
  trigger: React.ReactNode;
  title: string;
  description: string;
  action: string;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>{action}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function CredentialRows({ auth, reveal, ingestUrl }: { auth: IngestAuth; reveal: boolean; ingestUrl: string }) {
  const hide = (s: string) => (reveal ? s : '•'.repeat(Math.min(24, s.length)));
  const row = (label: string, value: string, copy = value) => (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-muted-foreground w-36 text-xs">{label}</span>
      <code className="min-w-0 flex-1 text-xs break-all">{value}</code>
      <CopyButton value={copy} className="h-7 px-2 text-xs" />
    </div>
  );
  if (auth.type === 'token') {
    const header = auth.headerName.toLowerCase() === 'authorization' ? `Bearer ${auth.secret}` : auth.secret;
    return (
      <>
        {row('Header', auth.headerName)}
        {row('Value', hide(header), header)}
      </>
    );
  }
  if (auth.type === 'basic') {
    const u = new URL(ingestUrl);
    u.username = encodeURIComponent(auth.username);
    u.password = encodeURIComponent(auth.password);
    return (
      <>
        {row('Username', auth.username)}
        {row('Password', hide(auth.password), auth.password)}
        {row('URL with credentials', reveal ? u.toString() : `${u.protocol}//${auth.username}:••••@${u.host}${u.pathname}`, u.toString())}
      </>
    );
  }
  if (auth.type === 'hmac') {
    return (
      <>
        {row('Shared secret', hide(auth.secret), auth.secret)}
        {row('Signature', `${auth.headerName}: ${auth.prefix}<${auth.algorithm.toUpperCase()} ${auth.encoding} of the body>`)}
      </>
    );
  }
  return null;
}

function SetupTab({ relay, justCreated }: { relay: RelayDetail; justCreated: boolean }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState(relay.name);
  const [webhookId, setWebhookId] = useState(relay.discordWebhook.id);
  const curl = relayCurl(relay);
  const [auth, setAuth] = useState(authDraft(relay.auth));
  const [attempts, setAttempts] = useState(String(relay.maxAttempts));
  const [reveal, setReveal] = useState(false);
  const saveAuth = useMutation({
    mutationFn: () => unwrap(api.PATCH('/api/relays/{id}', { params: { path: { id: relay.id } }, body: { auth: authInput(auth) } })),
    onSuccess: (r) => {
      invalidate();
      setAuth(authDraft((r as RelayDetail).auth));
      toast.success('Security settings saved. Update the sending service if its credentials changed.');
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const rotateAuth = useMutation({
    mutationFn: () => unwrap(api.POST('/api/relays/{id}/auth/rotate', { params: { path: { id: relay.id } } })),
    onSuccess: () => {
      invalidate();
      setReveal(true);
      toast.success('New secret generated. Update it in the sending service.');
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const changed = webhookId !== relay.discordWebhook.id;
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['relay', relay.id] });
    void qc.invalidateQueries({ queryKey: ['relays'] });
  };
  const patch = useMutation({
    mutationFn: (body: { name?: string; enabled?: boolean; discordWebhookId?: string; maxAttempts?: number }) =>
      unwrap(api.PATCH('/api/relays/{id}', { params: { path: { id: relay.id } }, body })),
    onSuccess: (r) => {
      invalidate();
      void qc.invalidateQueries({ queryKey: ['discord-webhooks'] });
      setWebhookId(r.discordWebhook.id);
      toast.success('Saved');
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const rotate = useMutation({
    mutationFn: () => unwrap(api.POST('/api/relays/{id}/rotate-key', { params: { path: { id: relay.id } } })),
    onSuccess: () => {
      invalidate();
      toast.success('New URL issued. Update it in the other service.');
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const ping = useMutation({
    mutationFn: async () =>
      (await unwrap(api.POST('/api/relays/{id}/test', { params: { path: { id: relay.id } }, body: {} }))) as TestResult,
    onSuccess: (r) => (r.ok ? toast.success('Sent. Check your Discord channel.') : toast.error(r.error ?? 'Failed')),
    onError: (err) => toast.error(errorMessage(err)),
  });
  const remove = useMutation({
    mutationFn: () => unwrap(api.DELETE('/api/relays/{id}', { params: { path: { id: relay.id } } })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['relays'] });
      toast.success('Relay deleted');
      void navigate('/');
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Webhook URL</CardTitle>
          <CardDescription>Paste this into the other service's webhook settings. It only accepts JSON (POST or PUT).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="bg-muted/40 flex flex-wrap items-center gap-2 rounded-md border p-3">
            <code className="min-w-0 flex-1 text-sm break-all">{relay.ingestUrl}</code>
            <CopyButton value={relay.ingestUrl} label="Copy URL" />
          </div>
          <details className="text-sm" open={justCreated}>
            <summary className="text-muted-foreground cursor-pointer">
              Try it with curl{relay.hasSample ? ' (sends your sample payload)' : ''}
            </summary>
            <div className="mt-2 flex items-start gap-2">
              <pre className="bg-muted max-h-80 flex-1 overflow-auto rounded p-2 text-xs">{curl}</pre>
              <CopyButton value={curl} />
            </div>
          </details>
          <Confirm
            trigger={
              <Button variant="outline" size="sm" disabled={rotate.isPending}>
                <KeyRound /> Issue a new URL
              </Button>
            }
            title="Issue a new URL?"
            description="The current URL stops working immediately. Anything still sending to it will get 404s until you update it."
            action="Issue new URL"
            onConfirm={() => rotate.mutate()}
          />
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {relay.auth.type === 'none' ? <ShieldAlert className="size-4 text-amber-600" /> : <ShieldCheck className="size-4 text-emerald-600" />}
            Security: {INGEST_AUTH_LABELS[relay.auth.type]}
          </CardTitle>
          <CardDescription>
            How the sending service proves it may post to this relay. Requests with missing or wrong credentials get <code>401</code> and are
            logged as rejected.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {relay.auth.type !== 'none' && (
            <div className="bg-muted/40 space-y-2 rounded-md border p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">Give these to the sending service</span>
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setReveal(!reveal)}>
                    {reveal ? <EyeOff /> : <Eye />} {reveal ? 'Hide' : 'Reveal'}
                  </Button>
                  <Confirm
                    trigger={
                      <Button variant="outline" size="sm" disabled={rotateAuth.isPending}>
                        <RotateCcw /> New {relay.auth.type === 'basic' ? 'password' : 'secret'}
                      </Button>
                    }
                    title="Generate a new secret?"
                    description="The current one stops working immediately. Requests using it get 401 until you update the sending service."
                    action="Generate"
                    onConfirm={() => rotateAuth.mutate()}
                  />
                </div>
              </div>
              <CredentialRows auth={relay.auth} reveal={reveal} ingestUrl={relay.ingestUrl} />
            </div>
          )}
          <AuthEditor value={auth} onChange={setAuth} existing={relay.auth} />
          <Button onClick={() => saveAuth.mutate()} disabled={saveAuth.isPending}>
            Save security settings
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Discord channel</CardTitle>
          <CardDescription>
            Sends to the saved webhook <span className="text-foreground font-medium">{relay.discordWebhook.name}</span>. Switch to another one,
            or add a new one. <Link to="/discord-webhooks" className="underline">Manage saved webhooks</Link>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <WebhookPicker id="relay-webhook" value={webhookId} onChange={setWebhookId} />
          <div className="flex flex-wrap gap-2">
            {changed && (
              <Button disabled={patch.isPending} onClick={() => patch.mutate({ discordWebhookId: webhookId })}>
                Use this webhook
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => ping.mutate()} disabled={ping.isPending}>
              <Send /> Send a test message
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="relay-name">Name</Label>
            <div className="flex gap-2">
              <Input id="relay-name" value={name} onChange={(e) => setName(e.target.value)} />
              <Button variant="outline" disabled={!name.trim() || name === relay.name || patch.isPending} onClick={() => patch.mutate({ name })}>
                Rename
              </Button>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="relay-attempts">Delivery attempts</Label>
            <div className="flex gap-2">
              <Input
                id="relay-attempts"
                type="number"
                min={1}
                max={20}
                className="w-24"
                value={attempts}
                onChange={(e) => setAttempts(e.target.value)}
              />
              <Button
                variant="outline"
                disabled={!/^\d+$/.test(attempts) || +attempts < 1 || +attempts > 20 || +attempts === relay.maxAttempts || patch.isPending}
                onClick={() => patch.mutate({ maxAttempts: Number(attempts) })}
              >
                Save
              </Button>
            </div>
            <p className="text-muted-foreground text-xs">
              How many times a webhook is tried when Discord or the network fails (1–20, default 5) before it's marked dead. Waits
              between tries: 10s, 1m, 5m, 30m, then 2h.
            </p>
          </div>
          <div className="flex items-center justify-between gap-4">
            <div>
              <Label>Enabled</Label>
              <p className="text-muted-foreground text-xs">When disabled, incoming webhooks are refused (and logged as rejected).</p>
            </div>
            <Switch checked={relay.enabled} onCheckedChange={(enabled) => patch.mutate({ enabled })} />
          </div>
          <Confirm
            trigger={
              <Button variant="outline" size="sm" className="text-destructive">
                <Trash2 /> Delete relay
              </Button>
            }
            title={`Delete “${relay.name}”?`}
            description="Its URL stops working, and its templates and webhook logs are deleted. This can't be undone."
            action="Delete relay"
            onConfirm={() => remove.mutate()}
          />
        </CardContent>
      </Card>
    </div>
  );
}

function TemplatesTab({ relay }: { relay: RelayDetail }) {
  const qc = useQueryClient();
  const templates = useQuery({
    queryKey: ['relay', relay.id, 'templates'],
    queryFn: async () => (await unwrap(api.GET('/api/relays/{id}/templates', { params: { path: { id: relay.id } } }))) as Template[],
  });
  const remove = useMutation({
    mutationFn: (templateId: string) =>
      unwrap(api.DELETE('/api/relays/{id}/templates/{templateId}', { params: { path: { id: relay.id, templateId } } })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['relay', relay.id] });
      void qc.invalidateQueries({ queryKey: ['relays'] });
      toast.success('Template deleted');
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground max-w-2xl text-sm">
          For each webhook, templates are tried from top to bottom; the first whose condition matches formats the message. A template with no
          condition matches everything, so keep it last. If none match, the webhook is logged as skipped.
        </p>
        <Button asChild>
          <Link to={`/relays/${relay.id}/templates/new`}>
            <Plus /> New template
          </Link>
        </Button>
      </div>
      {templates.isPending ? (
        <Skeleton className="h-24" />
      ) : !templates.data?.length ? (
        <EmptyState icon={<FileJson />} title="No templates yet">
          Without a template, webhooks are received but not sent to Discord.
        </EmptyState>
      ) : (
        templates.data.map((t, i) => (
          <Card key={t.id} className="py-4">
            <CardContent className="flex flex-wrap items-center gap-3">
              <span className="text-muted-foreground w-6 text-sm tabular-nums">{i + 1}.</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Link to={`/relays/${relay.id}/templates/${t.id}`} className="font-medium hover:underline">
                    {t.name}
                  </Link>
                  <Badge variant="outline">{t.mode === 'mapping' ? 'Visual' : 'Liquid'}</Badge>
                  <span className="text-muted-foreground text-xs">priority {t.priority}</span>
                </div>
                <code className="text-muted-foreground text-xs">{t.condition ? `when ${t.condition}` : 'always (fallback)'}</code>
              </div>
              <Button asChild variant="outline" size="sm">
                <Link to={`/relays/${relay.id}/templates/${t.id}`}>
                  <Pencil /> Edit
                </Link>
              </Button>
              <Confirm
                trigger={
                  <Button variant="ghost" size="sm" aria-label="Delete template">
                    <Trash2 />
                  </Button>
                }
                title={`Delete template “${t.name}”?`}
                description="Webhooks it would have formatted fall through to the next template."
                action="Delete"
                onConfirm={() => remove.mutate(t.id)}
              />
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}

function SampleTab({ relay }: { relay: RelayDetail }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Set the sample</CardTitle>
          <CardDescription>Used to list fields in the mapper and to preview messages.</CardDescription>
        </CardHeader>
        <CardContent>
          <SampleEditor relay={relay} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Current sample</CardTitle>
          <CardDescription>{relay.hasSample ? `From: ${relay.sampleSource}` : 'None yet'}</CardDescription>
        </CardHeader>
        <CardContent>
          {relay.hasSample ? (
            <JsonEditor value={prettyJson(relay.samplePayload)} readOnly maxHeight="520px" />
          ) : (
            <p className="text-muted-foreground text-sm">Paste one, generate it from a schema, or capture a live webhook.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export function RelayDetailPage() {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const relay = useQuery({
    queryKey: ['relay', id],
    queryFn: async () => (await unwrap(api.GET('/api/relays/{id}', { params: { path: { id } } }))) as RelayDetail,
  });
  const tab = params.get('tab') ?? 'setup';

  if (relay.isPending) return <Skeleton className="h-64" />;
  if (relay.isError) return <p className="text-destructive">{errorMessage(relay.error)}</p>;
  const r = relay.data;

  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            {r.name} {!r.enabled && <Badge variant="secondary">Disabled</Badge>}
          </span>
        }
        description={<code className="text-xs">{r.ingestUrl}</code>}
        actions={<CopyButton value={r.ingestUrl} label="Copy URL" />}
      />
      {params.get('created') && (
        <Alert className="mb-6 border-emerald-500/40">
          <CheckCircle2 className="text-emerald-600" />
          <AlertTitle>Your relay is ready</AlertTitle>
          <AlertDescription>
            Paste the URL above into the other service's webhook settings. Incoming webhooks show up under Logs.
          </AlertDescription>
        </Alert>
      )}
      {r.templateCount === 0 && (
        <Alert className="mb-6">
          <AlertTitle>No template yet</AlertTitle>
          <AlertDescription>
            Webhooks are received but not sent to Discord until you{' '}
            <Link to={`/relays/${r.id}/templates/new`} className="font-medium underline">
              create a template
            </Link>
            .
          </AlertDescription>
        </Alert>
      )}
      <Tabs
        value={tab}
        onValueChange={(t) =>
          setParams(
            (p) => {
              const next = new URLSearchParams();
              next.set('tab', t);
              if (t === 'logs') for (const k of ['status', 'q']) p.getAll(k).forEach((v) => next.append(k, v));
              return next;
            },
            { replace: true },
          )
        }
      >
        <TabsList>
          <TabsTrigger value="setup">Setup</TabsTrigger>
          <TabsTrigger value="sample">Sample</TabsTrigger>
          <TabsTrigger value="templates">Templates ({r.templateCount})</TabsTrigger>
          <TabsTrigger value="logs">Logs</TabsTrigger>
        </TabsList>
        <TabsContent value="setup" className="pt-2">
          <SetupTab relay={r} justCreated={!!params.get('created')} />
        </TabsContent>
        <TabsContent value="sample" className="pt-2">
          <SampleTab relay={r} />
        </TabsContent>
        <TabsContent value="templates" className="pt-2">
          <TemplatesTab relay={r} />
        </TabsContent>
        <TabsContent value="logs" className="pt-2">
          {tab === 'logs' && <LogsView fixedRelayId={r.id} />}
        </TabsContent>
      </Tabs>
    </>
  );
}

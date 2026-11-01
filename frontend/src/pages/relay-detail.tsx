import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, FileJson, KeyRound, Pencil, Plus, Send, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { api, errorMessage, unwrap } from '@/api/client';
import type { RelayDetail, Template, TestResult } from '@/api/types';
import { CopyButton, EmptyState, JsonEditor, PageHeader } from '@/components/common';
import { LogsView } from '@/components/logs/logs-view';
import { curlExample, SampleEditor } from '@/components/sample-editor';
import { WebhookPicker, webhookChoice, type PickerValue, type WebhookChoice } from '@/components/webhook-picker';
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

function SetupTab({ relay }: { relay: RelayDetail }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState(relay.name);
  const [picker, setPicker] = useState<PickerValue>({ savedId: relay.discordWebhook.id, url: '', name: '' });
  const choice = webhookChoice(picker);
  const changed = picker.savedId !== relay.discordWebhook.id;
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['relay', relay.id] });
    void qc.invalidateQueries({ queryKey: ['relays'] });
  };
  const patch = useMutation({
    mutationFn: (body: { name?: string; enabled?: boolean } | WebhookChoice) =>
      unwrap(api.PATCH('/api/relays/{id}', { params: { path: { id: relay.id } }, body })),
    onSuccess: (r) => {
      invalidate();
      void qc.invalidateQueries({ queryKey: ['discord-webhooks'] });
      setPicker({ savedId: r.discordWebhook.id, url: '', name: '' });
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
          <details className="text-sm">
            <summary className="text-muted-foreground cursor-pointer">Try it with curl</summary>
            <div className="mt-2 flex items-start gap-2">
              <pre className="bg-muted flex-1 overflow-x-auto rounded p-2 text-xs">{curlExample(relay.ingestUrl)}</pre>
              <CopyButton value={curlExample(relay.ingestUrl)} />
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

      <Card>
        <CardHeader>
          <CardTitle>Discord channel</CardTitle>
          <CardDescription>
            Sends to the saved webhook <span className="text-foreground font-medium">{relay.discordWebhook.name}</span>. Switch to another one,
            or paste a new URL. <Link to="/discord-webhooks" className="underline">Manage saved webhooks</Link>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <WebhookPicker id="relay-webhook" value={picker} onChange={setPicker} />
          <div className="flex flex-wrap gap-2">
            {(changed || picker.savedId === null) && (
              <Button disabled={!choice || patch.isPending} onClick={() => choice && patch.mutate(choice)}>
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
    queryFn: () => unwrap(api.GET('/api/relays/{id}', { params: { path: { id } } })),
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
          <SetupTab relay={r} />
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

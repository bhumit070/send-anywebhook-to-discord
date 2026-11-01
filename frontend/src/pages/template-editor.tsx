import {
  autoMap,
  compileMapping,
  createEngine,
  emptyMapping,
  extractPaths,
  flattenPaths,
  matchesCondition,
  renderMessage,
  type Mapping,
  type MessageTemplate,
  type RenderResult,
} from '@send-any-webhook/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, Code2, Moon, Send, Sparkles, Sun, Wand2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { api, errorMessage, unwrap } from '@/api/client';
import type { Template, TestResult } from '@/api/types';
import { JsonEditor, parseJson } from '@/components/common';
import { DiscordPreview, type DiscordTheme } from '@/components/discord/preview';
import { FieldTree } from '@/components/mapping/field-tree';
import { MappingEditor } from '@/components/mapping/mapping-editor';
import type { PickHandler } from '@/components/mapping/source-input';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { prettyJson, relativeTime } from '@/lib/format';

const engine = createEngine();

function useTemplates(relayId: string) {
  return useQuery({
    queryKey: ['relay', relayId, 'templates'],
    queryFn: async () => (await unwrap(api.GET('/api/relays/{id}/templates', { params: { path: { id: relayId } } }))) as Template[],
  });
}

export function TemplateEditorPage() {
  const { id: relayId = '', templateId } = useParams();
  const [params] = useSearchParams();
  const relay = useQuery({
    queryKey: ['relay', relayId],
    queryFn: () => unwrap(api.GET('/api/relays/{id}', { params: { path: { id: relayId } } })),
  });
  const templates = useTemplates(relayId);
  const existing = templateId ? templates.data?.find((t) => t.id === templateId) : undefined;

  if (relay.isPending || templates.isPending) return <Skeleton className="h-96" />;
  if (relay.isError) return <p className="text-destructive">{errorMessage(relay.error)}</p>;
  if (templateId && !existing) return <p className="text-destructive">Template not found.</p>;
  return (
    <Editor
      key={templateId ?? 'new'}
      relayId={relayId}
      relayName={relay.data.name}
      sample={relay.data.samplePayload}
      hasSample={relay.data.hasSample}
      template={existing}
      isFirst={(templates.data?.length ?? 0) === 0}
      wizard={params.get('wizard') === '1'}
    />
  );
}

function Editor({
  relayId,
  relayName,
  sample,
  hasSample,
  template,
  isFirst,
  wizard,
}: {
  relayId: string;
  relayName: string;
  sample: unknown;
  hasSample: boolean;
  template?: Template;
  isFirst: boolean;
  wizard: boolean;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const initialMapping = useMemo<Mapping>(
    () => template?.mapping ?? (hasSample ? autoMap(sample) : { ...emptyMapping(), content: { kind: 'static', value: 'New event' } }),
    [template, hasSample, sample],
  );
  const [name, setName] = useState(template?.name ?? (isFirst ? 'Default' : 'New template'));
  const [condition, setCondition] = useState(template?.condition ?? '');
  const [priority, setPriority] = useState(template?.priority ?? (isFirst ? 0 : 10));
  const [mode, setMode] = useState<'mapping' | 'liquid'>(template?.mode ?? 'mapping');
  const [mapping, setMapping] = useState<Mapping>(initialMapping);
  const [liquidText, setLiquidText] = useState(prettyJson(template?.message ?? compileMapping(initialMapping)));
  const [theme, setTheme] = useState<DiscordTheme>('dark');
  const [confirmBack, setConfirmBack] = useState(false);
  const [dirty, setDirty] = useState(!template);
  const pickRef = useRef<PickHandler | null>(null);

  // Preview data: sample, a recent webhook, or custom JSON
  const [source, setSource] = useState<string>(hasSample ? 'sample' : 'custom');
  const [customText, setCustomText] = useState(hasSample ? prettyJson(sample) : '{\n  "message": "Hello"\n}');
  const recent = useQuery({
    queryKey: ['queue', 'recent', relayId],
    queryFn: () =>
      unwrap(
        api.GET('/api/queue', {
          params: {
            query: {
              relayId: [relayId],
              status: ['pending', 'processing', 'delivered', 'failed', 'dead', 'skipped'],
              pageSize: 15,
            },
          },
        }),
      ),
  });
  const recentDetail = useQuery({
    queryKey: ['queue', source],
    queryFn: () => unwrap(api.GET('/api/queue/{id}', { params: { path: { id: source } } })),
    enabled: source !== 'sample' && source !== 'custom',
  });
  const custom = parseJson(customText);
  const payload: unknown =
    source === 'sample' ? sample : source === 'custom' ? (custom.error ? undefined : custom.value) : recentDetail.data?.payload;

  const fieldNodes = useMemo(() => extractPaths(payload ?? sample ?? {}), [payload, sample]);
  const flatFields = useMemo(() => flattenPaths(fieldNodes), [fieldNodes]);

  const liquid = useMemo(() => parseJson(liquidText), [liquidText]);
  const messageTemplate = useMemo<MessageTemplate | null>(
    () => (mode === 'mapping' ? compileMapping(mapping) : liquid.error ? null : (liquid.value as MessageTemplate)),
    [mode, mapping, liquid],
  );

  const result: RenderResult | null = useMemo(() => {
    if (!messageTemplate || payload === undefined) return null;
    try {
      return renderMessage(engine, messageTemplate, { payload, relay: { name: relayName } });
    } catch (err) {
      return { message: null, warnings: [], error: errorMessage(err) };
    }
  }, [messageTemplate, payload, relayName]);

  let conditionState: 'none' | 'match' | 'nomatch' | string = 'none';
  if (condition.trim() && payload !== undefined) {
    try {
      conditionState = matchesCondition(engine, condition, { payload, relay: { name: relayName } }) ? 'match' : 'nomatch';
    } catch (err) {
      conditionState = errorMessage(err);
    }
  }

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  const change = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setDirty(true);
  };

  const body = () => ({
    name: name.trim() || 'Template',
    priority,
    condition: condition.trim() || null,
    mode,
    ...(mode === 'mapping' ? { mapping } : { message: liquid.value as MessageTemplate, mapping }),
  });

  const save = useMutation({
    mutationFn: async () =>
      (template
        ? unwrap(
            api.PATCH('/api/relays/{id}/templates/{templateId}', {
              params: { path: { id: relayId, templateId: template.id } },
              body: body() as never,
            }),
          )
        : unwrap(api.POST('/api/relays/{id}/templates', { params: { path: { id: relayId } }, body: body() as never }))) as Promise<Template>,
    onSuccess: async (saved) => {
      setDirty(false);
      await qc.invalidateQueries({ queryKey: ['relay', relayId] });
      await qc.invalidateQueries({ queryKey: ['relays'] });
      toast.success('Template saved');
      if (wizard) void navigate(`/relays/${relayId}?created=1`);
      else if (!template) void navigate(`/relays/${relayId}/templates/${saved.id}`, { replace: true });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const test = useMutation({
    mutationFn: async () =>
      (await unwrap(
        api.POST('/api/relays/{id}/test', {
          params: { path: { id: relayId } },
          body: { payload, ...(mode === 'mapping' ? { mapping } : { message: messageTemplate }) } as never,
        }),
      )) as TestResult,
    onSuccess: (r) => (r.ok ? toast.success('Sent to Discord. Check your channel.') : toast.error(r.error ?? 'Discord refused the message')),
    onError: (err) => toast.error(errorMessage(err)),
  });

  const toAdvanced = () => {
    setLiquidText(prettyJson(compileMapping(mapping)));
    setMode('liquid');
    setDirty(true);
  };

  const canSave = !(mode === 'liquid' && liquid.error) && !save.isPending;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link to={`/relays/${relayId}?tab=templates`}>
            <ArrowLeft /> {relayName}
          </Link>
        </Button>
        <h1 className="text-xl font-semibold">{template ? 'Edit template' : wizard ? 'Step 3 of 3: map fields to Discord' : 'New template'}</h1>
        {dirty && <Badge variant="secondary">Unsaved</Badge>}
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" onClick={() => test.mutate()} disabled={test.isPending || !result?.message}>
            <Send /> Send test to Discord
          </Button>
          <Button onClick={() => save.mutate()} disabled={!canSave}>
            {wizard ? 'Save and finish' : 'Save'}
          </Button>
        </div>
      </div>

      <div className="grid gap-3 rounded-lg border p-3 sm:grid-cols-[1fr_2fr_6rem]">
        <div className="space-y-1">
          <Label htmlFor="tpl-name" className="text-xs">
            Name
          </Label>
          <Input id="tpl-name" value={name} onChange={(e) => change(setName)(e.target.value)} className="h-8" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="tpl-cond" className="text-xs">
            Use when (optional Liquid condition)
          </Label>
          <Input
            id="tpl-cond"
            value={condition}
            onChange={(e) => change(setCondition)(e.target.value)}
            placeholder='event_name == "task.created"   (empty = always / fallback)'
            className="h-8 font-mono text-xs"
          />
          {conditionState === 'match' && <p className="text-xs text-emerald-600 dark:text-emerald-400">✓ Matches the preview payload</p>}
          {conditionState === 'nomatch' && <p className="text-xs text-amber-600">Doesn't match the preview payload</p>}
          {conditionState !== 'none' && conditionState !== 'match' && conditionState !== 'nomatch' && (
            <p className="text-destructive text-xs">{conditionState}</p>
          )}
        </div>
        <div className="space-y-1">
          <Label htmlFor="tpl-prio" className="text-xs" title="Lower runs first">
            Priority
          </Label>
          <Input
            id="tpl-prio"
            type="number"
            min={0}
            value={priority}
            onChange={(e) => change(setPriority)(Math.max(0, Number(e.target.value)))}
            className="h-8"
          />
        </div>
      </div>

      {!hasSample && (
        <Alert>
          <AlertTriangle />
          <AlertTitle>No sample payload yet</AlertTitle>
          <AlertDescription>
            Field suggestions come from a sample.{' '}
            <Link to={`/relays/${relayId}?tab=sample`} className="font-medium underline">
              Add one
            </Link>{' '}
            or paste JSON under “Preview data” on the right.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-[15rem_minmax(0,1fr)] xl:grid-cols-[15rem_minmax(0,1fr)_26rem]">
        <aside className="space-y-2 rounded-lg border p-3 lg:sticky lg:top-20 lg:max-h-[calc(100svh-6rem)] lg:overflow-y-auto">
          <h2 className="text-sm font-semibold">Payload fields</h2>
          <p className="text-muted-foreground text-xs">Click a field to fill the slot you're editing, or drag it onto any slot.</p>
          <FieldTree nodes={fieldNodes} onPick={(path) => pickRef.current?.(path)} />
        </aside>

        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {mode === 'mapping' ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={payload === undefined}
                  onClick={() => {
                    change(setMapping)(autoMap(payload));
                    toast.success('Mapped fields from their names. Adjust anything that looks off.');
                  }}
                >
                  <Sparkles /> Auto-map
                </Button>
                <Button variant="ghost" size="sm" onClick={toAdvanced}>
                  <Code2 /> Advanced: edit Liquid
                </Button>
              </>
            ) : (
              <>
                <Badge variant="secondary">Advanced (Liquid) mode</Badge>
                <Button variant="ghost" size="sm" onClick={() => setConfirmBack(true)}>
                  <Wand2 /> Back to visual mapper
                </Button>
              </>
            )}
          </div>

          {mode === 'mapping' ? (
            <MappingEditor
              mapping={mapping}
              onChange={change(setMapping)}
              fields={flatFields}
              warnings={result?.warnings ?? []}
              onActivate={(pick) => (pickRef.current = pick)}
            />
          ) : (
            <div className="space-y-2">
              <p className="text-muted-foreground text-sm">
                The Discord message as JSON where every string is a{' '}
                <a href="https://liquidjs.com/tutorials/intro-to-liquid.html" target="_blank" rel="noreferrer" className="underline">
                  Liquid template
                </a>
                . Extra filters: <code>to_text</code>, <code>bool_emoji</code>, <code>number_format</code>,{' '}
                <code>discord_time: "R"</code>, <code>title_case</code>. <code>fields_each</code> makes one field per list item (
                <code>item</code> is in scope).
              </p>
              <JsonEditor value={liquidText} onChange={change(setLiquidText)} minHeight="420px" maxHeight="none" />
              {liquid.error && <p className="text-destructive text-xs">Not valid JSON: {liquid.error}</p>}
            </div>
          )}
        </div>

        <aside className="min-w-0 space-y-3 lg:col-span-2 xl:sticky xl:top-20 xl:col-span-1 xl:max-h-[calc(100svh-6rem)] xl:overflow-y-auto">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Preview</h2>
            <Button variant="ghost" size="sm" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} title="Discord theme">
              {theme === 'dark' ? <Moon /> : <Sun />} {theme === 'dark' ? 'Dark' : 'Light'}
            </Button>
          </div>
          <DiscordPreview
            message={result?.message ?? null}
            theme={theme}
            empty={result?.error ?? (payload === undefined ? 'Choose preview data below.' : 'Nothing to show.')}
          />
          {result?.error && (
            <Alert variant="destructive">
              <AlertDescription>{result.error}</AlertDescription>
            </Alert>
          )}
          {!!result?.warnings.length && (
            <div className="space-y-1 rounded-md border border-amber-500/30 bg-amber-500/5 p-2">
              {result.warnings.map((w, i) => (
                <p key={i} className="text-xs text-amber-800 dark:text-amber-300">
                  <code className="font-mono">{w.slot}</code>: {w.message}
                </p>
              ))}
            </div>
          )}

          <div className="space-y-2 rounded-lg border p-3">
            <Label className="text-xs">Preview data</Label>
            <Select value={source} onValueChange={setSource}>
              <SelectTrigger size="sm" className="w-full text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {hasSample && <SelectItem value="sample">Sample payload</SelectItem>}
                <SelectItem value="custom">Custom JSON</SelectItem>
                {!!recent.data?.items.length && (
                  <SelectGroup>
                    <SelectLabel>Received webhooks</SelectLabel>
                    {recent.data.items.map((i) => (
                      <SelectItem key={i.id} value={i.id}>
                        {relativeTime(i.receivedAt)} · {i.status}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                )}
              </SelectContent>
            </Select>
            {source === 'custom' && (
              <>
                <JsonEditor value={customText} onChange={setCustomText} minHeight="140px" maxHeight="300px" />
                {custom.error && <p className="text-destructive text-xs">Not valid JSON: {custom.error}</p>}
              </>
            )}
            {source !== 'sample' && source !== 'custom' && recentDetail.isPending && <Skeleton className="h-8" />}
          </div>
        </aside>
      </div>

      <AlertDialog open={confirmBack} onOpenChange={setConfirmBack}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Go back to the visual mapper?</AlertDialogTitle>
            <AlertDialogDescription>
              Edits made in Advanced mode can't be turned back into a mapping. The mapper reopens as it was before you switched.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Stay in Advanced</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setMode('mapping');
                setDirty(true);
              }}
            >
              Discard Liquid edits
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

import { curlCommand, looksLikeJsonSchema } from '@send-any-webhook/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Radio } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api, errorMessage, unwrap } from '@/api/client';
import type { RelayDetail } from '@/api/types';
import { CopyButton, JsonEditor, parseJson } from '@/components/common';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { prettyJson } from '@/lib/format';

const EXAMPLE = `{
  "event": "task.created",
  "task": { "title": "Fix login bug", "url": "https://example.com/tasks/42" }
}`;

const TEST_BODY = { event: 'test', message: 'Hello from curl' };

/** A copy-paste curl command for a relay, with its credentials, posting its sample (or a test body). */
export function relayCurl(relay: RelayDetail, payload?: unknown) {
  return curlCommand(relay.ingestUrl, payload ?? (relay.hasSample ? relay.samplePayload : TEST_BODY), relay.auth);
}

/** Lets the user set a relay's sample payload. Calls onSaved after the sample changes. */
export function SampleEditor({ relay, onSaved }: { relay: RelayDetail; onSaved?: (sample: unknown) => void }) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<'example' | 'schema' | 'capture'>('example');
  const [example, setExample] = useState(relay.hasSample && relay.sampleSource !== 'schema' ? prettyJson(relay.samplePayload) : EXAMPLE);
  const [schema, setSchema] = useState('');
  const [capturing, setCapturing] = useState(relay.captureMode);

  const save = useMutation({
    mutationFn: (body: { type: 'example' | 'schema'; data: unknown }) =>
      unwrap(api.PUT('/api/relays/{id}/sample', { params: { path: { id: relay.id } }, body })),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ['relay', relay.id] });
      toast.success('Sample saved');
      if (tab === 'schema') setExample(prettyJson(res.samplePayload));
      onSaved?.(res.samplePayload);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const capture = useMutation({
    mutationFn: (enabled: boolean) =>
      unwrap(api.POST('/api/relays/{id}/capture', { params: { path: { id: relay.id } }, body: { enabled } })),
    onSuccess: (r) => setCapturing(r.captureMode),
    onError: (err) => toast.error(errorMessage(err)),
  });

  // While capturing, poll until the backend has stored a captured sample
  const poll = useQuery({
    queryKey: ['relay', relay.id, 'capture-poll'],
    queryFn: async () => (await unwrap(api.GET('/api/relays/{id}', { params: { path: { id: relay.id } } }))) as RelayDetail,
    enabled: capturing,
    refetchInterval: 2000,
  });
  useEffect(() => {
    if (capturing && poll.data && !poll.data.captureMode && poll.data.sampleSource === 'captured') {
      setCapturing(false);
      setExample(prettyJson(poll.data.samplePayload));
      setTab('example');
      void qc.invalidateQueries({ queryKey: ['relay', relay.id] });
      toast.success('Captured a webhook as the sample');
      onSaved?.(poll.data.samplePayload);
    }
  }, [capturing, poll.data, qc, relay.id, onSaved]);

  const exampleParsed = parseJson(example);
  const schemaParsed = parseJson(schema);

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
      <TabsList>
        <TabsTrigger value="example">Paste JSON</TabsTrigger>
        <TabsTrigger value="schema">JSON Schema</TabsTrigger>
        <TabsTrigger value="capture">Capture live</TabsTrigger>
      </TabsList>

      <TabsContent value="example" className="space-y-3">
        <p className="text-muted-foreground text-sm">
          Paste an example payload from the service's docs, or one you've seen. It's only used to list fields and preview the message.
        </p>
        <JsonEditor value={example} onChange={setExample} minHeight="220px" />
        {exampleParsed.error && example.trim() && <p className="text-destructive text-xs">Not valid JSON: {exampleParsed.error}</p>}
        {!exampleParsed.error && looksLikeJsonSchema(exampleParsed.value) && (
          <Alert>
            <AlertDescription>
              This looks like a JSON Schema.{' '}
              <button
                type="button"
                className="font-medium underline"
                onClick={() => {
                  setSchema(example);
                  setTab('schema');
                }}
              >
                Use the JSON Schema tab
              </button>{' '}
              to turn it into an example.
            </AlertDescription>
          </Alert>
        )}
        <Button disabled={!!exampleParsed.error || save.isPending} onClick={() => save.mutate({ type: 'example', data: exampleParsed.value })}>
          Save sample
        </Button>
      </TabsContent>

      <TabsContent value="schema" className="space-y-3">
        <p className="text-muted-foreground text-sm">
          Paste the payload's JSON Schema; the app builds an example from it using <code>examples</code>, <code>default</code> and{' '}
          <code>enum</code> where present. Only local <code>$ref</code>s are followed.
        </p>
        <JsonEditor value={schema} onChange={setSchema} minHeight="220px" />
        {schemaParsed.error && schema.trim() && <p className="text-destructive text-xs">Not valid JSON: {schemaParsed.error}</p>}
        <Button disabled={!!schemaParsed.error || save.isPending} onClick={() => save.mutate({ type: 'schema', data: schemaParsed.value })}>
          Generate example from schema
        </Button>
      </TabsContent>

      <TabsContent value="capture" className="space-y-3">
        <p className="text-muted-foreground text-sm">
          Don't have an example? Point the service at this relay's URL and trigger an event. The first webhook that arrives becomes the
          sample (it's also queued for delivery as normal).
        </p>
        <div className="bg-muted/40 flex flex-wrap items-center gap-2 rounded-md border p-3">
          <code className="min-w-0 flex-1 truncate text-xs">{relay.ingestUrl}</code>
          <CopyButton value={relay.ingestUrl} label="Copy URL" />
        </div>
        {capturing ? (
          <div className="flex flex-wrap items-center gap-3 rounded-md border border-dashed p-4">
            <Loader2 className="text-primary size-5 animate-spin" />
            <div className="flex-1 text-sm">
              <div className="font-medium">Waiting for the first webhook…</div>
              <div className="text-muted-foreground">Test it yourself:</div>
              <pre className="bg-muted mt-2 overflow-x-auto rounded p-2 text-xs">{relayCurl(relay, TEST_BODY)}</pre>
            </div>
            <Button variant="outline" onClick={() => capture.mutate(false)} disabled={capture.isPending}>
              Stop
            </Button>
          </div>
        ) : (
          <Button onClick={() => capture.mutate(true)} disabled={capture.isPending}>
            <Radio /> Start capturing
          </Button>
        )}
      </TabsContent>
    </Tabs>
  );
}

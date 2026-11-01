import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { api, errorMessage, unwrap } from '@/api/client';
import type { RelayDetail, TestResult } from '@/api/types';
import { PageHeader } from '@/components/common';
import { SampleEditor } from '@/components/sample-editor';
import { AuthEditor, authDraft, authInput, type AuthDraft } from '@/components/auth-editor';
import { useSavedWebhooks, WebhookPicker } from '@/components/webhook-picker';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';

function Steps({ step }: { step: number }) {
  const steps = ['Name & Discord channel', 'Sample payload', 'Map fields'];
  return (
    <ol className="mb-6 flex flex-wrap gap-2 text-sm">
      {steps.map((s, i) => (
        <li
          key={s}
          className={`flex items-center gap-2 rounded-full border px-3 py-1 ${i + 1 === step ? 'border-primary bg-primary/5 font-medium' : 'text-muted-foreground'}`}
        >
          <span className="tabular-nums">{i + 1}</span> {s}
        </li>
      ))}
    </ol>
  );
}

function StepOne({ onCreated }: { onCreated: (id: string) => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const saved = useSavedWebhooks();
  // Until the user picks, default to their first saved webhook
  const [picked, setPicked] = useState<string | null>(null);
  const webhookId = picked ?? saved.data?.[0]?.id ?? null;
  const [auth, setAuth] = useState<AuthDraft>(authDraft());
  const create = useMutation({
    mutationFn: () => unwrap(api.POST('/api/relays', { body: { name, discordWebhookId: webhookId!, auth: authInput(auth) } })),
    onSuccess: async (r) => {
      void qc.invalidateQueries({ queryKey: ['relays'] });
      const test = (await unwrap(api.POST('/api/relays/{id}/test', { params: { path: { id: r.id } }, body: {} }))) as TestResult;
      if (test.ok) toast.success('Relay created. A test message was sent to your channel.');
      else toast.warning('Relay created, but the test message failed', { description: test.error ?? undefined });
      onCreated(r.id);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };
  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>Where should messages go?</CardTitle>
        <CardDescription>
          Pick one of your saved Discord webhooks, or add a new one.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input id="name" required maxLength={100} placeholder="Vikunja tasks" value={name} onChange={(e) => setName(e.target.value)} />
            <p className="text-muted-foreground text-xs">Also used in the relay's URL.</p>
          </div>
          <WebhookPicker value={webhookId} onChange={setPicked} />
          <div className="space-y-2">
            <Label>Security</Label>
            <p className="text-muted-foreground text-xs">How the sending service must prove it's allowed to post. You can change this later.</p>
            <AuthEditor value={auth} onChange={setAuth} />
          </div>
          <Button type="submit" disabled={!name.trim() || !webhookId || create.isPending}>
            Create and send a test message <ArrowRight />
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function StepTwo({ relayId, onNext }: { relayId: string; onNext: () => void }) {
  const relay = useQuery({
    queryKey: ['relay', relayId],
    queryFn: async () => (await unwrap(api.GET('/api/relays/{id}', { params: { path: { id: relayId } } }))) as RelayDetail,
  });
  if (!relay.data) return <Skeleton className="h-64" />;
  return (
    <Card className="max-w-3xl">
      <CardHeader>
        <CardTitle>What does the service send?</CardTitle>
        <CardDescription>Give an example so you can map its fields. You can change it later.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <SampleEditor relay={relay.data} onSaved={onNext} />
        <Button variant="ghost" onClick={onNext}>
          Skip for now <ArrowRight />
        </Button>
      </CardContent>
    </Card>
  );
}

export function NewRelayPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const relayId = params.get('relay');
  const step = relayId ? 2 : 1;
  return (
    <>
      <PageHeader title="New relay" />
      <Steps step={step} />
      {step === 1 ? (
        <StepOne onCreated={(id) => setParams({ relay: id }, { replace: true })} />
      ) : (
        <StepTwo relayId={relayId!} onNext={() => void navigate(`/relays/${relayId}/templates/new?wizard=1`)} />
      )}
    </>
  );
}

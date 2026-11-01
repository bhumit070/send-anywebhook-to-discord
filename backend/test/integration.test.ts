import { emptyEmbed, emptyMapping, type Mapping } from '@send-any-webhook/shared';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { relays, webhookQueue } from '../src/db/schema.js';
import { Delivery } from '../src/services/delivery.js';
import { login, setup, TEST_DB, WEBHOOK, type Ctx } from './helpers.js';

const titleMapping = (path = 'title'): Mapping => ({
  ...emptyMapping(),
  embeds: [{ ...emptyEmbed(), title: { kind: 'field', path } }],
});

describe.skipIf(!TEST_DB)('integration (Postgres)', () => {
  let ctx: Ctx;
  let cookie: string;

  beforeAll(async () => {
    ctx = await setup();
    ({ cookie } = await login(ctx.app, 'owner@example.com'));
  });
  afterAll(() => ctx?.close());
  beforeEach(() => {
    ctx.discord.calls.length = 0;
    ctx.discord.queue.length = 0;
  });

  const api = (method: string, url: string, payload?: unknown, as = cookie) =>
    ctx.app.inject({ method: method as 'GET', url, headers: { cookie: as }, ...(payload !== undefined && { payload: payload as object }) });

  async function relayWithTemplate(name = 'Test relay', mapping = titleMapping(), condition?: string) {
    const relay = (await api('POST', '/api/relays', { name, discordWebhookUrl: WEBHOOK })).json();
    const t = await api('POST', `/api/relays/${relay.id}/templates`, { name: 'Default', mode: 'mapping', mapping, condition });
    expect(t.statusCode).toBe(201);
    return relay as { id: string; ingestKey: string; ingestUrl: string };
  }

  const ingest = (key: string, body: string, contentType = 'application/json') =>
    ctx.app.inject({ method: 'POST', url: `/h/${key}`, payload: body, headers: { 'content-type': contentType, authorization: 'Bearer secret' } });

  const row = async (id: string) => (await ctx.db.select().from(webhookQueue).where(eq(webhookQueue.id, id)))[0]!;

  // ---------- auth ----------

  describe('auth', () => {
    it('protects the API and supports login/logout', async () => {
      expect((await ctx.app.inject({ method: 'GET', url: '/api/relays' })).statusCode).toBe(401);
      expect((await api('GET', '/api/auth/me')).json()).toMatchObject({ email: 'owner@example.com' });

      const dup = await ctx.app.inject({ method: 'POST', url: '/api/auth/register', payload: { email: 'OWNER@example.com', password: 'password123' } });
      expect(dup.statusCode).toBe(409);

      const bad = await ctx.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'owner@example.com', password: 'wrong-password' } });
      expect(bad.statusCode).toBe(401);
      const good = await ctx.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'Owner@Example.com', password: 'password123' } });
      expect(good.statusCode).toBe(200);
      expect(good.cookies.find((c) => c.name === 'send_any_webhook_session')?.httpOnly).toBe(true);
    });

    it('keeps users apart', async () => {
      const relay = await relayWithTemplate('Private');
      const other = await login(ctx.app);
      expect((await api('GET', `/api/relays/${relay.id}`, undefined, other.cookie)).statusCode).toBe(404);
      expect((await api('GET', '/api/relays', undefined, other.cookie)).json()).toEqual([]);
      expect((await api('GET', '/api/queue', undefined, other.cookie)).json().total).toBe(0);
    });
  });

  // ---------- relays ----------

  describe('relays', () => {
    it('validates the Discord URL and never returns its token', async () => {
      const bad = await api('POST', '/api/relays', { name: 'x', discordWebhookUrl: 'https://example.com/hook' });
      expect(bad.statusCode).toBe(400);
      const res = await api('POST', '/api/relays', { name: 'Vikunja Tasks!', discordWebhookUrl: WEBHOOK });
      expect(res.statusCode).toBe(201);
      const relay = res.json();
      expect(relay.ingestKey).toMatch(/^vikunja-tasks_[A-Za-z0-9]{24}$/);
      expect(relay.ingestUrl).toBe(`http://send-any-webhook.test/h/${relay.ingestKey}`);
      expect(relay.discordWebhookUrl).toBe('https://discord.com/api/webhooks/123456789/test…_ABC');
      expect(JSON.stringify(relay)).not.toContain('test-token');

      const rotated = (await api('POST', `/api/relays/${relay.id}/rotate-key`)).json();
      expect(rotated.ingestKey).not.toBe(relay.ingestKey);
      expect((await ingest(relay.ingestKey, '{}')).statusCode).toBe(404);
    });

    it('sets a sample from a JSON Schema', async () => {
      const relay = await relayWithTemplate();
      const res = await api('PUT', `/api/relays/${relay.id}/sample`, {
        type: 'schema',
        data: { type: 'object', properties: { title: { type: 'string', examples: ['Hello'] } } },
      });
      expect(res.json().samplePayload).toEqual({ title: 'Hello' });
    });

    it('sends a test message directly', async () => {
      const relay = await relayWithTemplate();
      await api('PUT', `/api/relays/${relay.id}/sample`, { type: 'example', data: { title: 'Sample title' } });
      const res = (await api('POST', `/api/relays/${relay.id}/test`, {})).json();
      expect(res).toMatchObject({ ok: true, status: 204 });
      expect(ctx.discord.calls[0]).toEqual({ url: WEBHOOK, message: { embeds: [{ title: 'Sample title' }] } });
    });
  });

  // ---------- ingest ----------

  describe('ingest', () => {
    it('queues JSON and logs everything it rejects', async () => {
      const relay = await relayWithTemplate();
      const ok = await ingest(relay.ingestKey, '{"title":"hi"}');
      expect(ok.statusCode).toBe(202);
      const queued = await row(ok.json().id);
      expect(queued).toMatchObject({ status: 'pending', payload: { title: 'hi' } });
      expect(queued.headers).toMatchObject({ authorization: '[redacted]' });

      expect((await ingest(relay.ingestKey, 'a=1', 'application/x-www-form-urlencoded')).statusCode).toBe(415);
      expect((await ingest(relay.ingestKey, '{bad', 'application/json')).statusCode).toBe(400);
      expect((await ingest(relay.ingestKey, '', 'application/json')).statusCode).toBe(400);
      expect((await ingest(relay.ingestKey, JSON.stringify({ x: 'y'.repeat(1_100_000) }))).statusCode).toBe(413);
      expect((await ingest('nope_123', '{}')).statusCode).toBe(404);

      await api('PATCH', `/api/relays/${relay.id}`, { enabled: false });
      expect((await ingest(relay.ingestKey, '{}')).statusCode).toBe(403);

      const rejected = (await api('GET', `/api/queue?relayId=${relay.id}&status=rejected&sort=receivedAt:asc`)).json();
      expect(rejected.items.map((i: { lastError: string }) => i.lastError)).toEqual([
        expect.stringContaining('Only JSON bodies are supported'),
        expect.stringContaining('Invalid JSON'),
        expect.stringContaining('Empty body'),
        expect.stringContaining('Body larger than'),
        'Relay is disabled',
      ]);
    });

    it('captures the next webhook as the sample', async () => {
      const relay = await relayWithTemplate();
      await api('POST', `/api/relays/${relay.id}/capture`, { enabled: true });
      await ingest(relay.ingestKey, '{"captured":true}');
      const detail = (await api('GET', `/api/relays/${relay.id}`)).json();
      expect(detail).toMatchObject({ captureMode: false, sampleSource: 'captured', samplePayload: { captured: true } });
    });
  });

  // ---------- worker / delivery ----------

  describe('delivery', () => {
    beforeEach(async () => {
      // isolate: nothing else due
      await ctx.db.update(webhookQueue).set({ status: 'dead' }).where(sql`${webhookQueue.status} in ('pending','failed')`);
    });

    it('delivers with the first matching template', async () => {
      const relay = await relayWithTemplate('Cond', titleMapping('title'), 'kind == "a"');
      await api('POST', `/api/relays/${relay.id}/templates`, {
        name: 'Fallback',
        priority: 10,
        mode: 'liquid',
        message: { content: 'other: {{ kind }}' },
      });
      const a = (await ingest(relay.ingestKey, '{"kind":"a","title":"A title"}')).json().id;
      const b = (await ingest(relay.ingestKey, '{"kind":"b"}')).json().id;
      expect(await ctx.worker.tick()).toBe(2);
      expect(ctx.discord.calls.map((c) => c.message)).toEqual([{ embeds: [{ title: 'A title' }] }, { content: 'other: b' }]);
      expect(await row(a)).toMatchObject({ status: 'delivered', attempts: 1, lastStatusCode: 204 });
      expect((await row(b)).deliveredAt).toBeInstanceOf(Date);

      const detail = (await api('GET', `/api/queue/${a}`)).json();
      expect(detail.attemptsLog).toEqual([expect.objectContaining({ attemptNo: 1, trigger: 'worker', stage: 'send', responseStatus: 204 })]);
      expect(detail.rendered).toEqual({ embeds: [{ title: 'A title' }] });
    });

    it('backs off on 5xx and gives up after max attempts', async () => {
      const relay = await relayWithTemplate();
      const id = (await ingest(relay.ingestKey, '{"title":"x"}')).json().id;
      await ctx.db.update(webhookQueue).set({ maxAttempts: 2 }).where(eq(webhookQueue.id, id));

      ctx.discord.queue.push({ status: 502, headers: {}, body: 'bad gateway' });
      await ctx.worker.tick();
      let r = await row(id);
      expect(r).toMatchObject({ status: 'failed', attempts: 1, lastStatusCode: 502 });
      expect(r.nextAttemptAt.getTime() - Date.now()).toBeGreaterThan(8000);

      await ctx.db.update(webhookQueue).set({ nextAttemptAt: new Date() }).where(eq(webhookQueue.id, id));
      ctx.discord.queue.push(() => {
        throw new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } });
      });
      await ctx.worker.tick();
      r = await row(id);
      expect(r).toMatchObject({ status: 'dead', attempts: 2 });
      expect(r.lastError).toMatch(/fetch failed \(ECONNRESET\).*gave up after 2 attempts/);
      const log = (await api('GET', `/api/queue/${id}`)).json().attemptsLog;
      expect(log).toHaveLength(2);
      expect(log[1].errorStack).toContain('TypeError');
    });

    it('waits on 429 without using a retry', async () => {
      const relay = await relayWithTemplate();
      const id = (await ingest(relay.ingestKey, '{"title":"x"}')).json().id;
      ctx.discord.queue.push({ status: 429, headers: {}, body: '{"message":"rate limited","retry_after":3}', retryAfterMs: 3000 });
      await ctx.worker.tick();
      const r = await row(id);
      expect(r).toMatchObject({ status: 'failed', attempts: 0, lastStatusCode: 429 });
      expect(r.nextAttemptAt.getTime() - Date.now()).toBeGreaterThan(2000);
    });

    it('disables the relay when Discord says the webhook is gone', async () => {
      const relay = await relayWithTemplate();
      const id = (await ingest(relay.ingestKey, '{"title":"x"}')).json().id;
      ctx.discord.queue.push({ status: 404, headers: {}, body: '{"message":"Unknown Webhook","code":10015}' });
      await ctx.worker.tick();
      expect(await row(id)).toMatchObject({ status: 'dead', lastStatusCode: 404 });
      expect((await row(id)).lastError).toContain('Unknown Webhook');
      const [r] = await ctx.db.select().from(relays).where(eq(relays.id, relay.id));
      expect(r!.enabled).toBe(false);
    });

    it('records render failures and skips when nothing matches', async () => {
      const relay = await relayWithTemplate('Render', titleMapping('title'), 'kind == "only-this"');
      const skipped = (await ingest(relay.ingestKey, '{"kind":"other"}')).json().id;
      const relay2 = await relayWithTemplate('Empty', titleMapping('missing'));
      const dead = (await ingest(relay2.ingestKey, '{"title":"x"}')).json().id;
      await ctx.worker.tick();
      expect(await row(skipped)).toMatchObject({ status: 'skipped', lastError: 'No template condition matched this payload' });
      expect(await row(dead)).toMatchObject({ status: 'dead', attempts: 1 });
      expect((await row(dead)).lastError).toMatch(/message is empty/);
      expect((await api('GET', `/api/queue/${dead}`)).json().attemptsLog[0]).toMatchObject({ stage: 'render' });
      expect(ctx.discord.calls).toHaveLength(0);
    });

    it('never gives the same row to two workers', async () => {
      const relay = await relayWithTemplate();
      for (let i = 0; i < 30; i++) await ingest(relay.ingestKey, `{"title":"${i}"}`);
      const config = { appSecret: 'test-secret-'.padEnd(40, 'x') } as never;
      const w1 = new Delivery(ctx.db, config, async () => ({ status: 204, headers: {}, body: '' }), ctx.app.log, 'w1');
      const w2 = new Delivery(ctx.db, config, async () => ({ status: 204, headers: {}, body: '' }), ctx.app.log, 'w2');
      const results = await Promise.all([w1.claimDue(20), w2.claimDue(20), w1.claimDue(20), w2.claimDue(20)]);
      const ids = results.flat().map((r) => r.id);
      expect(ids).toHaveLength(30);
      expect(new Set(ids).size).toBe(30);
    });

    it('puts rows stuck in processing back in the queue', async () => {
      const relay = await relayWithTemplate();
      const id = (await ingest(relay.ingestKey, '{"title":"x"}')).json().id;
      await ctx.db
        .update(webhookQueue)
        .set({ status: 'processing', lockedAt: new Date(Date.now() - 10 * 60_000), lockedBy: 'crashed' })
        .where(eq(webhookQueue.id, id));
      expect(await ctx.worker.recoverStuck()).toBe(1);
      expect(await row(id)).toMatchObject({ status: 'failed', lockedBy: null });
    });
  });

  // ---------- queue API ----------

  describe('queue API', () => {
    it('filters, sorts and pages the log', async () => {
      const relay = await relayWithTemplate('Logs');
      for (const [i, kind] of ['push', 'issue', 'push'].entries()) {
        await ingest(relay.ingestKey, JSON.stringify({ kind, n: i, repo: { name: `repo-${i}` } }));
      }
      const q = (qs: string) => api('GET', `/api/queue?relayId=${relay.id}&${qs}`).then((r) => r.json());

      expect((await q('')).total).toBe(3);
      expect((await q('path=kind&pathValue=push')).total).toBe(2);
      expect((await q('path=repo.name&pathValue=repo-1')).total).toBe(1);
      expect((await q('q=REPO-2')).total).toBe(1);
      expect((await q('q=100%25')).total).toBe(0);
      expect((await q('status=pending&status=failed')).total).toBe(3);
      expect((await q('status=delivered')).total).toBe(0);
      const page = await q('sort=receivedAt:asc&page=2&pageSize=2');
      expect(page.items).toHaveLength(1);
      expect(page.items[0].relayName).toBe('Logs');

      expect((await api('GET', '/api/queue?sort=bogus:asc')).statusCode).toBe(400);
      expect((await api('GET', `/api/queue?path=${encodeURIComponent('a[')}`)).statusCode).toBe(400);

      const stats = (await api('GET', `/api/queue/stats?relayId=${relay.id}`)).json();
      expect(stats.counts.pending).toBe(3);
      expect(stats.oldestWaitingAt).toEqual(expect.any(String));
    });

    it('sends now, cancels, retries and replays', async () => {
      const relay = await relayWithTemplate('Actions');
      const [a, b, c] = await Promise.all(
        ['a', 'b', 'c'].map(async (t) => (await ingest(relay.ingestKey, `{"title":"${t}"}`)).json().id as string),
      ) as [string, string, string];

      const sent = (await api('POST', `/api/queue/${a}/send`)).json();
      expect(sent).toMatchObject({ id: a, status: 'delivered' });
      expect((await api('GET', `/api/queue/${a}`)).json().attemptsLog[0].trigger).toBe('manual');
      expect((await api('POST', `/api/queue/${a}/send`)).statusCode).toBe(409);

      expect((await api('POST', '/api/queue/cancel', { ids: [b] })).json()).toEqual({ affected: 1 });
      expect(await row(b)).toMatchObject({ status: 'dead', lastError: 'Cancelled by user' });
      expect((await api('POST', '/api/queue/retry', { ids: [b] })).json()).toEqual({ affected: 1 });
      expect(await row(b)).toMatchObject({ status: 'pending', attempts: 0 });

      const oldest = (await api('POST', '/api/queue/send-oldest', { count: 5, relayId: [relay.id] })).json();
      expect(oldest.results.map((r: { id: string }) => r.id).sort()).toEqual([b, c].sort());

      const replay = (await api('POST', `/api/queue/${a}/replay`)).json();
      expect(replay.id).not.toBe(a);
      expect(replay.status).toBe('delivered');
      expect((await api('GET', `/api/queue/${replay.id}`)).json().attemptsLog[0].trigger).toBe('replay');

      const retryByFilter = (await api('POST', '/api/queue/retry', { filter: { relayId: [relay.id], status: ['delivered'] } })).json();
      expect(retryByFilter).toEqual({ affected: 0 }); // delivered rows are not retryable
    });
  });

  describe('preview', () => {
    it('renders and auto-maps', async () => {
      const payload = { title: 'Hello', description: 'World', url: 'https://example.com/x' };
      const auto = (await api('POST', '/api/mapping/auto', { payload })).json();
      expect(auto.embeds[0].title).toMatchObject({ kind: 'field', path: 'title' });
      const res = (await api('POST', '/api/preview', { payload, mapping: auto, relayName: 'Demo' })).json();
      expect(res.error).toBeNull();
      expect(res.message.embeds[0]).toMatchObject({ title: 'Hello', description: 'World', url: 'https://example.com/x', footer: { text: 'Demo' } });

      const bad = await api('POST', `/api/relays/${(await relayWithTemplate()).id}/templates`, {
        name: 'Broken',
        mode: 'liquid',
        message: { content: '{% if %}' },
      });
      expect(bad.statusCode).toBe(400);
      expect(bad.json().message).toMatch(/syntax error in content/);
    });
  });
});

describe.skipIf(!TEST_DB)('AUTH_DISABLED', () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await setup({ AUTH_DISABLED: 'true' });
  });
  afterAll(() => ctx?.close());

  it('serves the API without a session and hides auth routes', async () => {
    const create = await ctx.app.inject({ method: 'POST', url: '/api/relays', payload: { name: 'Open', discordWebhookUrl: WEBHOOK } });
    expect(create.statusCode).toBe(201);
    expect((await ctx.app.inject({ method: 'GET', url: '/api/relays' })).json()).toHaveLength(1);
    expect((await ctx.app.inject({ method: 'GET', url: '/api/auth/me' })).json().email).toBe('local@send-any-webhook.local');
    const reg = await ctx.app.inject({ method: 'POST', url: '/api/auth/register', payload: { email: 'a@b.co', password: 'password123' } });
    expect(reg.statusCode).toBe(404);
  });
});

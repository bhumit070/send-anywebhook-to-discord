import { createEngine, matchesCondition, renderMessage, type MessageTemplate } from '@send-any-webhook/shared';
import { and, asc, count, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { Config } from '../config.js';
import type { Db } from '../db/client.js';
import { discordWebhooks, relays, templates, webhookAttempts, webhookQueue } from '../db/schema.js';
import { decrypt, deriveKey } from '../lib/crypto.js';
import type { DiscordResponse, DiscordSender } from '../lib/discord.js';
import type { QueueStatusT } from '../schemas.js';

/** Wait before retry N (1-based) after a 5xx or network error. */
export const BACKOFF_MS = [10_000, 60_000, 5 * 60_000, 30 * 60_000, 2 * 3600_000];
/** Discord allows ~5 requests per 2s per webhook; space sends to stay under it. */
const PER_RELAY_SPACING_MS = 400;

export type Trigger = 'worker' | 'manual' | 'replay';

export interface DeliveryOutcome {
  id: string;
  status: QueueStatusT;
  lastError: string | null;
  lastStatusCode: number | null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function describeError(err: unknown): { message: string; stack: string | null } {
  if (!(err instanceof Error)) return { message: String(err), stack: null };
  const cause = err.cause as { code?: string; message?: string } | undefined;
  const detail = cause?.code ?? cause?.message;
  const message = err.name === 'TimeoutError' ? 'Discord did not respond within 10s' : err.message;
  return { message: detail ? `${message} (${detail})` : message, stack: err.stack ?? null };
}

function discordError(res: DiscordResponse): string {
  try {
    const body = JSON.parse(res.body) as { message?: string; errors?: unknown };
    const parts = [body.message, body.errors ? JSON.stringify(body.errors) : null].filter(Boolean);
    if (parts.length) return `Discord ${res.status}: ${parts.join(' ')}`.slice(0, 2000);
  } catch {
    // not JSON
  }
  return `Discord ${res.status}${res.body ? `: ${res.body.slice(0, 500)}` : ''}`;
}

export class Delivery {
  readonly engine = createEngine();
  private readonly webhookKey: Buffer;
  private readonly lastSend = new Map<string, number>();

  constructor(
    private readonly db: Db,
    config: Config,
    private readonly send: DiscordSender,
    private readonly log: FastifyBaseLogger,
    readonly workerId = `api-${process.pid}`,
  ) {
    this.webhookKey = deriveKey(config.appSecret, 'webhook-url');
  }

  decryptWebhookUrl(enc: string): string {
    return decrypt(this.webhookKey, enc);
  }

  /** Claims due rows for the worker; concurrent workers never get the same row. */
  async claimDue(limit: number): Promise<{ id: string; relayId: string | null }[]> {
    const res = await this.db.execute<{ id: string; relay_id: string | null; next_attempt_at: Date; received_at: Date }>(sql`
      UPDATE webhook_queue SET status = 'processing', locked_at = now(), locked_by = ${this.workerId}
      WHERE id IN (
        SELECT id FROM webhook_queue
        WHERE status IN ('pending', 'failed') AND next_attempt_at <= now()
        ORDER BY next_attempt_at, received_at
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id, relay_id, next_attempt_at, received_at`);
    // RETURNING has no guaranteed order; deliver oldest first
    return res.rows
      .sort((a, b) => +new Date(a.received_at) - +new Date(b.received_at))
      .map((r) => ({ id: r.id, relayId: r.relay_id }));
  }

  /** Claims one row for a manual send. Returns false if it is already being processed or not sendable. */
  async claimOne(id: string, allowed: QueueStatusT[]): Promise<boolean> {
    const rows = await this.db
      .update(webhookQueue)
      .set({ status: 'processing', lockedAt: new Date(), lockedBy: this.workerId })
      .where(and(eq(webhookQueue.id, id), inArray(webhookQueue.status, allowed)))
      .returning({ id: webhookQueue.id });
    return rows.length > 0;
  }

  /**
   * Writes the result of a delivery, but only while this worker still holds the row's lock.
   * If the row was recovered and claimed again meanwhile, the newer owner's result is kept.
   */
  private async finish(id: string, patch: Record<string, unknown>): Promise<DeliveryOutcome> {
    const outcome = {
      id: webhookQueue.id,
      status: webhookQueue.status,
      lastError: webhookQueue.lastError,
      lastStatusCode: webhookQueue.lastStatusCode,
    };
    const [row] = await this.db
      .update(webhookQueue)
      .set({ ...patch, lockedAt: null, lockedBy: null })
      .where(and(eq(webhookQueue.id, id), eq(webhookQueue.status, 'processing'), eq(webhookQueue.lockedBy, this.workerId)))
      .returning(outcome);
    if (row) return row;
    this.log.warn({ queueId: id }, 'lost the lock on a queue row before finishing; keeping the newer result');
    const [current] = await this.db.select(outcome).from(webhookQueue).where(eq(webhookQueue.id, id));
    return current ?? { id, status: 'dead', lastError: 'Queue item was deleted', lastStatusCode: null };
  }

  private async nextAttemptNo(queueId: string): Promise<number> {
    const [r] = await this.db.select({ n: count() }).from(webhookAttempts).where(eq(webhookAttempts.queueId, queueId));
    return (r?.n ?? 0) + 1;
  }

  /** Renders and sends one claimed row, records the attempt and schedules a retry when needed. */
  async process(id: string, trigger: Trigger): Promise<DeliveryOutcome> {
    const [row] = await this.db.select().from(webhookQueue).where(eq(webhookQueue.id, id));
    if (!row) throw new Error(`Queue item ${id} not found`);
    const [relay] = row.relayId ? await this.db.select().from(relays).where(eq(relays.id, row.relayId)) : [];
    if (!relay) return this.finish(id, { status: 'dead', lastError: 'Relay no longer exists' });
    if (!relay.enabled) return this.finish(id, { status: 'skipped', lastError: 'Relay is disabled' });

    const ctx = { payload: row.payload, relay: { name: relay.name } };
    const attemptNo = await this.nextAttemptNo(id);
    const started = Date.now();
    const recordAttempt = (a: Partial<typeof webhookAttempts.$inferInsert>) =>
      this.db.insert(webhookAttempts).values({
        queueId: id,
        attemptNo,
        trigger,
        stage: 'send',
        startedAt: new Date(started),
        durationMs: Date.now() - started,
        ...a,
      });

    // 1. pick the template
    const candidates = await this.db
      .select()
      .from(templates)
      .where(eq(templates.relayId, relay.id))
      .orderBy(asc(templates.priority), asc(templates.createdAt));
    if (candidates.length === 0) {
      return this.finish(id, { status: 'skipped', lastError: 'Relay has no templates yet' });
    }
    let chosen: (typeof candidates)[number] | undefined;
    for (const t of candidates) {
      try {
        if (matchesCondition(this.engine, t.condition, ctx)) {
          chosen = t;
          break;
        }
      } catch (err) {
        const { message, stack } = describeError(err);
        const lastError = `Condition of template "${t.name}" failed: ${message}`;
        await recordAttempt({ stage: 'render', errorMessage: lastError, errorStack: stack });
        return this.finish(id, { status: 'dead', templateId: t.id, attempts: row.attempts + 1, lastError });
      }
    }
    if (!chosen) return this.finish(id, { status: 'skipped', lastError: 'No template condition matched this payload' });

    // 2. render
    let rendered;
    try {
      rendered = renderMessage(this.engine, chosen.message as MessageTemplate, ctx);
    } catch (err) {
      const { message, stack } = describeError(err);
      rendered = { message: null, warnings: [], error: message, stack };
    }
    if (!rendered.message) {
      const lastError = `Template "${chosen.name}": ${rendered.error}`;
      await recordAttempt({ stage: 'render', errorMessage: lastError, errorStack: 'stack' in rendered ? rendered.stack : null });
      return this.finish(id, { status: 'dead', templateId: chosen.id, attempts: row.attempts + 1, lastError });
    }

    // 3. send
    const last = this.lastSend.get(relay.id) ?? 0;
    const wait = last + PER_RELAY_SPACING_MS - Date.now();
    if (wait > 0) await sleep(Math.min(wait, 2000));
    this.lastSend.set(relay.id, Date.now());

    const base = { templateId: chosen.id, rendered: rendered.message };
    const [webhook] = await this.db.select().from(discordWebhooks).where(eq(discordWebhooks.id, relay.discordWebhookId));
    let res: DiscordResponse;
    try {
      if (!webhook) throw new Error('The relay\'s saved Discord webhook no longer exists');
      res = await this.send(this.decryptWebhookUrl(webhook.urlEnc), rendered.message);
    } catch (err) {
      const { message, stack } = describeError(err);
      await recordAttempt({ requestBody: rendered.message, errorMessage: message, errorStack: stack });
      return this.retryOrDie(id, row, base, message, null);
    }

    await recordAttempt({
      requestBody: rendered.message,
      responseStatus: res.status,
      responseHeaders: res.headers,
      responseBody: res.body,
      errorMessage: res.status >= 300 ? discordError(res) : null,
    });

    if (res.status >= 200 && res.status < 300) {
      return this.finish(id, {
        ...base,
        status: 'delivered',
        attempts: row.attempts + 1,
        deliveredAt: new Date(),
        lastError: null,
        lastStatusCode: res.status,
      });
    }
    if (res.status === 429) {
      // Rate limits don't use up a retry
      return this.finish(id, {
        ...base,
        status: 'failed',
        lastError: discordError(res),
        lastStatusCode: 429,
        nextAttemptAt: new Date(Date.now() + (res.retryAfterMs ?? 5000)),
      });
    }
    if (res.status >= 500) return this.retryOrDie(id, row, base, discordError(res), res.status);
    if (res.status === 401 || res.status === 404) {
      // Every relay sending to this saved webhook would fail the same way
      await this.db.update(relays).set({ enabled: false }).where(eq(relays.discordWebhookId, relay.discordWebhookId));
      this.log.warn({ relayId: relay.id, webhookId: relay.discordWebhookId, status: res.status }, 'Discord webhook is gone; relays disabled');
      return this.finish(id, {
        ...base,
        status: 'dead',
        attempts: row.attempts + 1,
        lastError: `${discordError(res)} (the Discord webhook “${webhook!.name}” was deleted or its URL is wrong; relays using it were disabled)`,
        lastStatusCode: res.status,
      });
    }
    return this.finish(id, {
      ...base,
      status: 'dead',
      attempts: row.attempts + 1,
      lastError: discordError(res),
      lastStatusCode: res.status,
    });
  }

  private retryOrDie(
    id: string,
    row: typeof webhookQueue.$inferSelect,
    base: Partial<typeof webhookQueue.$inferInsert>,
    lastError: string,
    lastStatusCode: number | null,
  ): Promise<DeliveryOutcome> {
    const attempts = row.attempts + 1;
    if (attempts >= row.maxAttempts) {
      return this.finish(id, { ...base, status: 'dead', attempts, lastError: `${lastError} (gave up after ${attempts} attempts)`, lastStatusCode });
    }
    const delay = BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)]!;
    return this.finish(id, {
      ...base,
      status: 'failed',
      attempts,
      lastError,
      lastStatusCode,
      nextAttemptAt: new Date(Date.now() + delay),
    });
  }

  /** Claims and processes a row right now, ignoring queue order. */
  async sendNow(id: string, trigger: Trigger = 'manual'): Promise<DeliveryOutcome | null> {
    if (!(await this.claimOne(id, ['pending', 'failed']))) return null;
    try {
      return await this.process(id, trigger);
    } catch (err) {
      return this.failUnexpected(id, err);
    }
  }

  /**
   * Last-resort handler so a bug never leaves a row stuck in `processing`. It counts as an
   * attempt, so a webhook that keeps crashing delivery ends up `dead` instead of looping forever.
   */
  async failUnexpected(id: string, err: unknown): Promise<DeliveryOutcome> {
    this.log.error({ err, queueId: id }, 'delivery crashed');
    const { message } = describeError(err);
    return this.finish(id, {
      attempts: sql`${webhookQueue.attempts} + 1`,
      status: sql`(case when ${webhookQueue.attempts} + 1 >= ${webhookQueue.maxAttempts} then 'dead' else 'failed' end)::queue_status`,
      lastError: `Internal error: ${message}`,
      nextAttemptAt: new Date(Date.now() + BACKOFF_MS[0]!),
    });
  }
}

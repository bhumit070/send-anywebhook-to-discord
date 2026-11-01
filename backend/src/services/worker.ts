import { and, inArray, lt, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { Db } from '../db/client.js';
import { webhookQueue } from '../db/schema.js';
import type { Delivery } from './delivery.js';

const STUCK_AFTER_MS = 5 * 60_000;
const RECOVER_EVERY_MS = 30_000;
const CLEANUP_EVERY_MS = 3600_000;

/** Polls webhook_queue and delivers due rows. Safe to run in several processes at once. */
export class QueueWorker {
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;
  private stopped = true;
  private lastRecover = 0;
  private lastCleanup = 0;

  constructor(
    private readonly db: Db,
    private readonly delivery: Delivery,
    private readonly log: FastifyBaseLogger,
    private readonly opts: { retentionDays: number; batchSize?: number; idleMs?: number },
  ) {}

  start() {
    this.stopped = false;
    this.schedule(0);
    this.log.info({ workerId: this.delivery.workerId }, 'queue worker started');
  }

  async stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    await this.running;
  }

  private schedule(ms: number) {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.running = this.loop();
    }, ms);
  }

  private async loop() {
    let processed = 0;
    try {
      processed = await this.tick();
    } catch (err) {
      this.log.error({ err }, 'queue worker tick failed');
    }
    // Keep draining while there is a backlog
    this.schedule(processed >= (this.opts.batchSize ?? 10) ? 0 : (this.opts.idleMs ?? 1000));
  }

  /** One pass: housekeeping, then deliver up to one batch. Returns rows processed. */
  async tick(): Promise<number> {
    const now = Date.now();
    if (now - this.lastRecover > RECOVER_EVERY_MS) {
      this.lastRecover = now;
      await this.recoverStuck();
    }
    if (now - this.lastCleanup > CLEANUP_EVERY_MS) {
      this.lastCleanup = now;
      await this.cleanup();
    }

    const claimed = await this.delivery.claimDue(this.opts.batchSize ?? 10);
    if (!claimed.length) return 0;

    // Different relays in parallel; one relay's rows in order (keeps per-webhook spacing and ordering)
    const byRelay = new Map<string, string[]>();
    for (const c of claimed) {
      const key = c.relayId ?? 'none';
      byRelay.set(key, [...(byRelay.get(key) ?? []), c.id]);
    }
    await Promise.all(
      [...byRelay.values()].map(async (ids) => {
        for (const id of ids) {
          try {
            await this.delivery.process(id, 'worker');
          } catch (err) {
            await this.delivery.failUnexpected(id, err);
          }
        }
      }),
    );
    return claimed.length;
  }

  /** Rows left in `processing` by a crashed process go back to the queue. */
  async recoverStuck(): Promise<number> {
    const rows = await this.db
      .update(webhookQueue)
      .set({ status: 'failed', lockedAt: null, lockedBy: null, lastError: 'Worker stopped mid-delivery; retrying' })
      .where(and(sql`${webhookQueue.status} = 'processing'`, lt(webhookQueue.lockedAt, new Date(Date.now() - STUCK_AFTER_MS))))
      .returning({ id: webhookQueue.id });
    if (rows.length) this.log.warn({ count: rows.length }, 'recovered stuck queue rows');
    return rows.length;
  }

  /** Deletes old logs: delivered/skipped after N days, everything else finished after 2N. */
  async cleanup(): Promise<number> {
    const day = 24 * 3600_000;
    const days = this.opts.retentionDays;
    const short = await this.db
      .delete(webhookQueue)
      .where(and(inArray(webhookQueue.status, ['delivered', 'skipped']), lt(webhookQueue.receivedAt, new Date(Date.now() - days * day))))
      .returning({ id: webhookQueue.id });
    const long = await this.db
      .delete(webhookQueue)
      .where(and(inArray(webhookQueue.status, ['dead', 'rejected']), lt(webhookQueue.receivedAt, new Date(Date.now() - 2 * days * day))))
      .returning({ id: webhookQueue.id });
    const n = short.length + long.length;
    if (n) this.log.info({ deleted: n }, 'removed old webhook logs');
    return n;
  }
}

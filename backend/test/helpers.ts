import type { DiscordMessage } from '@send-any-webhook/shared';
import { sql } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createDb } from '../src/db/client.js';
import { runMigrations } from '../src/db/migrate.js';
import type { DiscordResponse } from '../src/lib/discord.js';
import { QueueWorker } from '../src/services/worker.js';

/** Integration tests run only when TEST_DATABASE_URL points at a disposable database. */
export const TEST_DB = process.env.TEST_DATABASE_URL;

export const WEBHOOK = 'https://discord.com/api/webhooks/123456789/test-token_ABC';

export interface FakeDiscord {
  calls: { url: string; message: DiscordMessage }[];
  /** Responses to return, in order; then 204. A function can throw to simulate network errors. */
  queue: (DiscordResponse | (() => never))[];
}

export async function setup(env: Record<string, string> = {}) {
  const config = loadConfig({
    DATABASE_URL: TEST_DB!,
    APP_SECRET: 'test-secret-'.padEnd(40, 'x'),
    PUBLIC_BASE_URL: 'http://send-any-webhook.test',
    ...env,
  });
  const { db, pool } = createDb(config.databaseUrl);
  await db.execute(sql`drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;`);
  await runMigrations(db);

  const discord: FakeDiscord = { calls: [], queue: [] };
  const app = await buildApp({
    config,
    db,
    pingDb: async () => void (await pool.query('select 1')),
    send: async (url, message) => {
      discord.calls.push({ url, message });
      const next = discord.queue.shift();
      if (typeof next === 'function') return next();
      return next ?? { status: 204, headers: {}, body: '' };
    },
  });
  const worker = new QueueWorker(db, app.delivery, app.log, { retentionDays: 14 });

  return {
    app,
    db,
    discord,
    worker,
    close: async () => {
      await app.close();
      await pool.end();
    },
  };
}

export type Ctx = Awaited<ReturnType<typeof setup>>;

/** Registers a user and returns a cookie header for their session. */
export async function login(app: Ctx['app'], email = `u${Math.random().toString(36).slice(2)}@example.com`) {
  const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { email, password: 'password123' } });
  if (res.statusCode !== 201) throw new Error(`register failed: ${res.body}`);
  const cookie = res.cookies.find((c) => c.name === 'send_any_webhook_session')!;
  return { cookie: `${cookie.name}=${cookie.value}`, user: res.json() as { id: string; email: string } };
}

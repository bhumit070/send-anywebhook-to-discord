import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import type { Db } from '../src/db/client.js';

const db = {} as Db;

const config = loadConfig({
  DATABASE_URL: 'postgres://unused',
  APP_SECRET: 'x'.repeat(32),
  AUTH_DISABLED: 'true',
});

describe('system routes', () => {
  it('reports healthy when the database answers', async () => {
    const app = await buildApp({ config, db, pingDb: async () => {} });
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', db: 'ok' });
  });

  it('returns 503 when the database is unreachable', async () => {
    const app = await buildApp({
      config,
      db,
      pingDb: async () => {
        throw new Error('connection refused');
      },
    });
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: 'error', db: 'unreachable' });
  });

  it('hides registration when auth is disabled', async () => {
    const app = await buildApp({ config, db, pingDb: async () => {} });
    const res = await app.inject({ method: 'GET', url: '/api/config' });
    expect(res.json()).toMatchObject({ authDisabled: true, registrationEnabled: false });
  });

  it('serves the OpenAPI document', async () => {
    const app = await buildApp({ config, db, pingDb: async () => {} });
    const res = await app.inject({ method: 'GET', url: '/docs/json' });
    expect(res.statusCode).toBe(200);
    expect(Object.keys(res.json().paths)).toEqual(expect.arrayContaining(['/healthz', '/api/config']));
  });
});

describe('loadConfig', () => {
  it('rejects a short APP_SECRET', () => {
    expect(() => loadConfig({ DATABASE_URL: 'postgres://x', APP_SECRET: 'short' })).toThrow(/APP_SECRET/);
  });
});

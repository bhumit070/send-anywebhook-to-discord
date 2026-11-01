// Writes the OpenAPI spec without a database: npm run openapi -w @send-any-webhook/backend
import { writeFile } from 'node:fs/promises';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import type { Db } from '../db/client.js';

const out = process.argv[2] ?? '../frontend/src/api/openapi.json';
const config = loadConfig({ DATABASE_URL: 'postgres://unused', APP_SECRET: 'x'.repeat(32) });
const app = await buildApp({ config, db: {} as Db, pingDb: async () => {} });
await app.ready();
await writeFile(out, `${JSON.stringify(app.swagger(), null, 2)}\n`);
await app.close();
console.log(`OpenAPI spec written to ${out}`);

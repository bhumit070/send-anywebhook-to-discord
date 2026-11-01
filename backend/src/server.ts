import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createDb } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { QueueWorker } from './services/worker.js';

const config = loadConfig();
const { db, pool } = createDb(config.databaseUrl);

const app = await buildApp(
  { config, db, pingDb: async () => void (await pool.query('select 1')) },
  {
    logger: {
      level: config.logLevel,
      ...(config.prettyLogs && { transport: { target: 'pino-pretty' } }),
    },
  },
);

if (config.authDisabled) {
  app.log.warn('AUTH_DISABLED=true: the dashboard and API are open to anyone who can reach them');
}

app.log.info('running database migrations');
await runMigrations(db);

const worker = config.runWorker
  ? new QueueWorker(db, app.delivery, app.log.child({ component: 'worker' }), { retentionDays: config.eventRetentionDays })
  : null;

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  await worker?.stop();
  await app.close();
  await pool.end();
  process.exit(0);
};
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ host: config.host, port: config.port });
worker?.start();

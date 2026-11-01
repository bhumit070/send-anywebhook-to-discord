import { createDb } from './client.js';
import { runMigrations } from './migrate.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('Missing required environment variable DATABASE_URL');

const { db, pool } = createDb(databaseUrl);
try {
  await runMigrations(db);
  console.log('Migrations applied');
} finally {
  await pool.end();
}

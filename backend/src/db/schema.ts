import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const timestamps = {
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const users = pgTable(
  'users',
  {
    id: uuid().primaryKey().defaultRandom(),
    email: text().notNull(),
    passwordHash: text(), // null for the built-in local user (AUTH_DISABLED)
    ...timestamps,
  },
  (t) => [uniqueIndex('users_email_lower_idx').on(sql`lower(${t.email})`)],
);

/** A user's saved Discord webhook URLs, reusable across relays. */
export const discordWebhooks = pgTable(
  'discord_webhooks',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    urlEnc: text().notNull(), // AES-256-GCM, keyed from APP_SECRET
    ...timestamps,
  },
  (t) => [index('discord_webhooks_user_id_idx').on(t.userId)],
);

export const ingestAuthType = pgEnum('ingest_auth_type', ['none', 'token', 'basic', 'hmac']);

export const sampleSource = pgEnum('sample_source', ['example', 'schema', 'captured']);

export const relays = pgTable(
  'relays',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    slug: text().notNull(),
    ingestKey: text().notNull(), // `${slug}_${random}`; the part after /h/
    // A saved webhook can't be deleted while relays use it
    discordWebhookId: uuid()
      .notNull()
      .references(() => discordWebhooks.id, { onDelete: 'restrict' }),
    // How senders must prove they're allowed to post to the ingest URL; secrets are AES-256-GCM encrypted JSON
    authType: ingestAuthType().notNull().default('none'),
    authConfigEnc: text(),
    /** Delivery attempts per webhook before it is marked dead (5xx/network errors). */
    maxAttempts: integer().notNull().default(5),
    samplePayload: jsonb(),
    sampleSource: sampleSource(),
    captureMode: boolean().notNull().default(false),
    enabled: boolean().notNull().default(true),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('relays_ingest_key_idx').on(t.ingestKey),
    index('relays_user_id_idx').on(t.userId),
    index('relays_discord_webhook_id_idx').on(t.discordWebhookId),
  ],
);

export const templateMode = pgEnum('template_mode', ['mapping', 'liquid']);

export const templates = pgTable(
  'templates',
  {
    id: uuid().primaryKey().defaultRandom(),
    relayId: uuid()
      .notNull()
      .references(() => relays.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    priority: integer().notNull().default(0),
    condition: text(), // Liquid expression; null = fallback template
    mode: templateMode().notNull().default('mapping'),
    mapping: jsonb(), // visual mapper state (mode = mapping)
    message: jsonb().notNull(), // compiled Liquid message template; what the worker renders
    ...timestamps,
  },
  (t) => [index('templates_relay_id_idx').on(t.relayId, t.priority)],
);

export const queueStatus = pgEnum('queue_status', [
  'pending',
  'processing',
  'delivered',
  'failed',
  'dead',
  'skipped',
  'rejected',
]);

export const webhookQueue = pgTable(
  'webhook_queue',
  {
    id: uuid().primaryKey().defaultRandom(),
    relayId: uuid().references(() => relays.id, { onDelete: 'cascade' }), // null when the ingest key was unknown
    status: queueStatus().notNull().default('pending'),
    receivedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    sourceIp: text(),
    headers: jsonb().notNull().default({}),
    payload: jsonb(), // null when the body was rejected (not JSON, too large)
    templateId: uuid().references(() => templates.id, { onDelete: 'set null' }),
    rendered: jsonb(),
    attempts: integer().notNull().default(0),
    maxAttempts: integer().notNull().default(5),
    nextAttemptAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    lockedAt: timestamp({ withTimezone: true }),
    lockedBy: text(),
    deliveredAt: timestamp({ withTimezone: true }),
    lastError: text(),
    lastStatusCode: integer(),
  },
  (t) => [
    index('webhook_queue_claim_idx').on(t.status, t.nextAttemptAt),
    index('webhook_queue_relay_received_idx').on(t.relayId, t.receivedAt.desc()),
    index('webhook_queue_received_idx').on(t.receivedAt.desc()),
    index('webhook_queue_payload_gin_idx').using('gin', t.payload.op('jsonb_path_ops')),
  ],
);

export const attemptTrigger = pgEnum('attempt_trigger', ['worker', 'manual', 'replay']);
export const attemptStage = pgEnum('attempt_stage', ['render', 'send']);

export const webhookAttempts = pgTable(
  'webhook_attempts',
  {
    id: uuid().primaryKey().defaultRandom(),
    queueId: uuid()
      .notNull()
      .references(() => webhookQueue.id, { onDelete: 'cascade' }),
    attemptNo: integer().notNull(),
    trigger: attemptTrigger().notNull(),
    stage: attemptStage().notNull(),
    startedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    durationMs: integer(),
    requestBody: jsonb(),
    responseStatus: integer(),
    responseHeaders: jsonb(),
    responseBody: text(),
    errorMessage: text(),
    errorStack: text(),
  },
  (t) => [index('webhook_attempts_queue_idx').on(t.queueId, t.attemptNo)],
);

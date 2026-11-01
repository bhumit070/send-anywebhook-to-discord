import {
  compileMapping,
  extractPaths,
  renderMessage,
  sampleFromSchema,
  type Mapping as MappingT,
  type MessageTemplate as MessageTemplateT,
} from '@send-any-webhook/shared';
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { and, asc, count, desc, eq, inArray, sql } from 'drizzle-orm';
import { Type } from 'typebox';
import type { Config } from '../config.js';
import type { Db } from '../db/client.js';
import { discordWebhooks, relays, templates, webhookQueue } from '../db/schema.js';
import { deriveKey, randomToken } from '../lib/crypto.js';
import { openIngestAuth, resolveIngestAuth, rotateIngestAuth, sealIngestAuth, type IngestAuthInput as AuthInput } from '../lib/ingest-auth.js';
import type { DiscordWebhookStore } from '../services/discord-webhooks.js';
import {
  ErrorResponse,
  IdParams,
  IngestAuthInput,
  Mapping,
  MessageTemplate,
  OkResponse,
  Relay,
  RelayDetail,
  RenderResult,
} from '../schemas.js';
import type { RouteDeps } from './types.js';

const tags = ['relays'];
const security = [{ session: [] }];
const notFound = { statusCode: 404, error: 'Not Found', message: 'Relay not found' };
const bad = (message: string) => ({ statusCode: 400, error: 'Bad Request', message });

const WebhookChoice = {
  discordWebhookId: Type.Optional(Type.String({ format: 'uuid', description: 'A saved Discord webhook' })),
  discordWebhookUrl: Type.Optional(
    Type.String({ maxLength: 500, description: 'Or a Discord webhook URL; it is saved for reuse (or matched to an existing saved one)' }),
  ),
  discordWebhookName: Type.Optional(Type.String({ maxLength: 100, description: 'Name for a newly saved URL (default: the relay name)' })),
};

export function slugify(name: string): string {
  const slug = name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
    .replace(/-+$/, '');
  return slug || 'relay';
}

export const newIngestKey = (name: string) => `${slugify(name)}_${randomToken(24)}`;

type RelayRow = typeof relays.$inferSelect;

/** Loads list/summary fields for relays, including their latest activity. */
export async function serializeRelays(db: Db, config: Config, rows: RelayRow[], webhooks: DiscordWebhookStore) {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const stats = await db
    .select({
      relayId: webhookQueue.relayId,
      lastReceivedAt: sql<Date | null>`max(${webhookQueue.receivedAt})`.mapWith((v) => (v ? new Date(v) : null)),
      backlog: sql<number>`count(*) filter (where ${webhookQueue.status} in ('pending','processing','failed'))`.mapWith(Number),
    })
    .from(webhookQueue)
    .where(inArray(webhookQueue.relayId, ids))
    .groupBy(webhookQueue.relayId);
  const last = await db
    .selectDistinctOn([webhookQueue.relayId], { relayId: webhookQueue.relayId, status: webhookQueue.status })
    .from(webhookQueue)
    .where(inArray(webhookQueue.relayId, ids))
    .orderBy(webhookQueue.relayId, desc(webhookQueue.receivedAt));
  const tplCounts = await db
    .select({ relayId: templates.relayId, n: count() })
    .from(templates)
    .where(inArray(templates.relayId, ids))
    .groupBy(templates.relayId);
  const saved = await db
    .select()
    .from(discordWebhooks)
    .where(inArray(discordWebhooks.id, [...new Set(rows.map((r) => r.discordWebhookId))]));

  return rows.map((r) => {
    const s = stats.find((x) => x.relayId === r.id);
    const webhook = saved.find((w) => w.id === r.discordWebhookId);
    return {
      id: r.id,
      name: r.name,
      ingestKey: r.ingestKey,
      ingestUrl: `${config.publicBaseUrl}/h/${r.ingestKey}`,
      discordWebhook: {
        id: r.discordWebhookId,
        name: webhook?.name ?? '',
        url: webhook ? webhooks.masked(webhook.urlEnc) : 'https://discord.com/api/webhooks/…',
      },
      enabled: r.enabled,
      maxAttempts: r.maxAttempts,
      authType: r.authType,
      captureMode: r.captureMode,
      sampleSource: r.sampleSource,
      hasSample: r.samplePayload !== null,
      templateCount: tplCounts.find((x) => x.relayId === r.id)?.n ?? 0,
      lastReceivedAt: s?.lastReceivedAt ?? null,
      lastStatus: last.find((x) => x.relayId === r.id)?.status ?? null,
      backlog: s?.backlog ?? 0,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  });
}

export const relayRoutes: FastifyPluginAsyncTypebox<RouteDeps> = async (app, { config, db, delivery, send, webhooks }) => {
  const authKey = deriveKey(config.appSecret, 'ingest-auth');
  const authColumns = (input: AuthInput | undefined, current: RelayRow | null) => {
    if (!input) return {};
    const resolved = resolveIngestAuth(input, current ? openIngestAuth(authKey, current.authType, current.authConfigEnc) : null);
    if ('error' in resolved) return { error: resolved.error };
    return { authType: resolved.type, authConfigEnc: sealIngestAuth(authKey, resolved) };
  };
  const owned = async (id: string, userId: string) => {
    const [row] = await db.select().from(relays).where(and(eq(relays.id, id), eq(relays.userId, userId)));
    return row;
  };
  const detail = async (row: RelayRow) => ({
    ...(await serializeRelays(db, config, [row], webhooks))[0]!,
    samplePayload: row.samplePayload,
    auth: openIngestAuth(authKey, row.authType, row.authConfigEnc),
  });

  app.get(
    '',
    { schema: { tags, security, summary: 'List relays', response: { 200: Type.Array(Relay) } } },
    async (req) => {
      const rows = await db.select().from(relays).where(eq(relays.userId, req.userId)).orderBy(asc(relays.name));
      return serializeRelays(db, config, rows, webhooks);
    },
  );

  app.post(
    '',
    {
      schema: {
        tags,
        security,
        summary: 'Create a relay',
        description: 'Send either `discordWebhookId` (a saved webhook) or `discordWebhookUrl`.',
        body: Type.Object({
          name: Type.String({ minLength: 1, maxLength: 100 }),
          ...WebhookChoice,
          enabled: Type.Optional(Type.Boolean()),
          maxAttempts: Type.Optional(Type.Integer({ minimum: 1, maximum: 20, description: 'Delivery attempts before giving up (default 5)' })),
          auth: Type.Optional(IngestAuthInput),
        }),
        response: { 201: RelayDetail, 400: ErrorResponse },
      },
    },
    async (req, reply) => {
      const { name, enabled } = req.body;
      const webhook = await webhooks.resolve(req.userId, req.body, name.trim());
      if ('error' in webhook) return reply.code(400).send(bad(webhook.error));
      const auth = authColumns(req.body.auth as AuthInput | undefined, null);
      if ('error' in auth) return reply.code(400).send(bad(auth.error!));
      const [row] = await db
        .insert(relays)
        .values({
          userId: req.userId,
          name: name.trim(),
          slug: slugify(name),
          ingestKey: newIngestKey(name),
          discordWebhookId: webhook.id,
          enabled: enabled ?? true,
          ...(req.body.maxAttempts !== undefined && { maxAttempts: req.body.maxAttempts }),
          ...auth,
        })
        .returning();
      return reply.code(201).send(await detail(row!));
    },
  );

  app.get(
    '/:id',
    { schema: { tags, security, summary: 'Get a relay', params: IdParams, response: { 200: RelayDetail, 404: ErrorResponse } } },
    async (req, reply) => {
      const row = await owned(req.params.id, req.userId);
      return row ? detail(row) : reply.code(404).send(notFound);
    },
  );

  app.patch(
    '/:id',
    {
      schema: {
        tags,
        security,
        summary: 'Update a relay',
        params: IdParams,
        body: Type.Object({
          name: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
          ...WebhookChoice,
          enabled: Type.Optional(Type.Boolean()),
          maxAttempts: Type.Optional(Type.Integer({ minimum: 1, maximum: 20, description: 'Delivery attempts before giving up (default 5)' })),
          auth: Type.Optional(IngestAuthInput),
        }),
        response: { 200: RelayDetail, 400: ErrorResponse, 404: ErrorResponse },
      },
    },
    async (req, reply) => {
      const current = await owned(req.params.id, req.userId);
      if (!current) return reply.code(404).send(notFound);
      const { name, enabled } = req.body;
      let discordWebhookId: string | undefined;
      if (req.body.discordWebhookId || req.body.discordWebhookUrl) {
        const webhook = await webhooks.resolve(req.userId, req.body, name?.trim() || current.name);
        if ('error' in webhook) return reply.code(400).send(bad(webhook.error));
        discordWebhookId = webhook.id;
      }
      const auth = authColumns(req.body.auth as AuthInput | undefined, current);
      if ('error' in auth) return reply.code(400).send(bad(auth.error!));
      const [row] = await db
        .update(relays)
        .set({
          ...(name !== undefined && { name: name.trim(), slug: slugify(name) }),
          ...(discordWebhookId && { discordWebhookId }),
          ...(req.body.maxAttempts !== undefined && { maxAttempts: req.body.maxAttempts }),
          ...auth,
          ...(enabled !== undefined && { enabled }),
        })
        .where(eq(relays.id, req.params.id))
        .returning();
      return detail(row!);
    },
  );

  app.delete(
    '/:id',
    {
      schema: {
        tags,
        security,
        summary: 'Delete a relay with its templates and logs',
        params: IdParams,
        response: { 200: OkResponse, 404: ErrorResponse },
      },
    },
    async (req, reply) => {
      const rows = await db
        .delete(relays)
        .where(and(eq(relays.id, req.params.id), eq(relays.userId, req.userId)))
        .returning({ id: relays.id });
      return rows.length ? { ok: true as const } : reply.code(404).send(notFound);
    },
  );

  app.post(
    '/:id/rotate-key',
    {
      schema: {
        tags,
        security,
        summary: 'Issue a new ingest URL; the old one stops working immediately',
        params: IdParams,
        response: { 200: RelayDetail, 404: ErrorResponse },
      },
    },
    async (req, reply) => {
      const current = await owned(req.params.id, req.userId);
      if (!current) return reply.code(404).send(notFound);
      const [row] = await db
        .update(relays)
        .set({ ingestKey: newIngestKey(current.name) })
        .where(eq(relays.id, current.id))
        .returning();
      return detail(row!);
    },
  );

  app.post(
    '/:id/auth/rotate',
    {
      schema: {
        tags,
        security,
        summary: 'Generate a new secret or password for the relay\'s credentials; the old one stops working immediately',
        params: IdParams,
        response: { 200: RelayDetail, 404: ErrorResponse },
      },
    },
    async (req, reply) => {
      const current = await owned(req.params.id, req.userId);
      if (!current) return reply.code(404).send(notFound);
      const rotated = rotateIngestAuth(openIngestAuth(authKey, current.authType, current.authConfigEnc));
      const [row] = await db
        .update(relays)
        .set({ authConfigEnc: sealIngestAuth(authKey, rotated) })
        .where(eq(relays.id, current.id))
        .returning();
      return detail(row!);
    },
  );

  app.put(
    '/:id/sample',
    {
      schema: {
        tags,
        security,
        summary: 'Set the sample payload from an example or a JSON Schema',
        params: IdParams,
        body: Type.Object({
          type: Type.Union([Type.Literal('example'), Type.Literal('schema')]),
          data: Type.Unknown({ description: 'Example JSON payload, or a JSON Schema' }),
        }),
        response: {
          200: Type.Object({ samplePayload: Type.Unknown(), fields: Type.Array(Type.Unknown()) }),
          400: ErrorResponse,
          404: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      if (!(await owned(req.params.id, req.userId))) return reply.code(404).send(notFound);
      let sample: unknown = req.body.data;
      if (sample === undefined || sample === null) {
        return reply.code(400).send({ statusCode: 400, error: 'Bad Request', message: 'Sample must be JSON' });
      }
      if (req.body.type === 'schema') {
        try {
          sample = sampleFromSchema(sample);
        } catch (err) {
          return reply.code(400).send({ statusCode: 400, error: 'Bad Request', message: (err as Error).message });
        }
      }
      await db
        .update(relays)
        .set({ samplePayload: sample, sampleSource: req.body.type, captureMode: false })
        .where(eq(relays.id, req.params.id));
      return { samplePayload: sample, fields: extractPaths(sample) };
    },
  );

  app.post(
    '/:id/capture',
    {
      schema: {
        tags,
        security,
        summary: 'Turn capture mode on or off: the next webhook received becomes the sample',
        params: IdParams,
        body: Type.Object({ enabled: Type.Boolean() }),
        response: { 200: RelayDetail, 404: ErrorResponse },
      },
    },
    async (req, reply) => {
      if (!(await owned(req.params.id, req.userId))) return reply.code(404).send(notFound);
      const [row] = await db
        .update(relays)
        .set({ captureMode: req.body.enabled })
        .where(eq(relays.id, req.params.id))
        .returning();
      return detail(row!);
    },
  );

  app.post(
    '/:id/test',
    {
      schema: {
        tags,
        security,
        summary: 'Render a message and send it to the Discord channel right away (not logged)',
        description:
          'Uses `message` or `mapping` when given, else the relay\'s first template. Uses `payload` when given, else the sample. With neither a template nor a sample, sends a plain ping.',
        params: IdParams,
        body: Type.Object({
          payload: Type.Optional(Type.Unknown()),
          message: Type.Optional(MessageTemplate),
          mapping: Type.Optional(Mapping),
        }),
        response: {
          200: Type.Object({
            ok: Type.Boolean(),
            status: Type.Union([Type.Null(), Type.Integer()]),
            error: Type.Union([Type.Null(), Type.String()]),
            render: RenderResult,
          }),
          404: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      const relay = await owned(req.params.id, req.userId);
      if (!relay) return reply.code(404).send(notFound);
      let tpl: MessageTemplateT | undefined = req.body.mapping
        ? compileMapping(req.body.mapping as MappingT)
        : (req.body.message as MessageTemplateT | undefined);
      if (!tpl) {
        const [first] = await db
          .select()
          .from(templates)
          .where(eq(templates.relayId, relay.id))
          .orderBy(asc(templates.priority), asc(templates.createdAt))
          .limit(1);
        tpl = first?.message as MessageTemplateT | undefined;
      }
      const payload = req.body.payload ?? relay.samplePayload;
      let render: ReturnType<typeof renderMessage>;
      try {
        render =
          tpl && payload !== null && payload !== undefined
            ? renderMessage(delivery.engine, tpl, { payload, relay: { name: relay.name } })
            : { message: { content: `✅ Test message from Send Any Webhook to Discord relay **${relay.name}**` }, warnings: [], error: null };
      } catch (err) {
        render = { message: null, warnings: [], error: (err as Error).message };
      }
      if (!render.message) return { ok: false, status: null, error: render.error, render };
      try {
        const saved = await webhooks.owned(req.userId, relay.discordWebhookId);
        if (!saved) return { ok: false, status: null, error: 'The relay\'s saved Discord webhook no longer exists', render };
        const res = await send(webhooks.decrypt(saved.urlEnc), render.message);
        const ok = res.status >= 200 && res.status < 300;
        return { ok, status: res.status, error: ok ? null : `Discord ${res.status}: ${res.body.slice(0, 500)}`, render };
      } catch (err) {
        return { ok: false, status: null, error: (err as Error).message, render };
      }
    },
  );
};

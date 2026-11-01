import {
  compileMapping,
  extractPaths,
  isDiscordWebhookUrl,
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
import { relays, templates, webhookQueue } from '../db/schema.js';
import { deriveKey, encrypt, randomToken } from '../lib/crypto.js';
import { maskWebhookUrl } from '../lib/discord.js';
import {
  ErrorResponse,
  IdParams,
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
const badWebhook = {
  statusCode: 400,
  error: 'Bad Request',
  message: 'Not a Discord webhook URL. Copy it from Channel settings → Integrations → Webhooks.',
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
export async function serializeRelays(db: Db, config: Config, rows: RelayRow[], decryptUrl: (enc: string) => string) {
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

  return rows.map((r) => {
    const s = stats.find((x) => x.relayId === r.id);
    let webhook = 'https://discord.com/api/webhooks/…';
    try {
      webhook = maskWebhookUrl(decryptUrl(r.discordWebhookUrlEnc));
    } catch {
      // APP_SECRET changed; the relay needs its webhook URL re-entered
    }
    return {
      id: r.id,
      name: r.name,
      ingestKey: r.ingestKey,
      ingestUrl: `${config.publicBaseUrl}/h/${r.ingestKey}`,
      discordWebhookUrl: webhook,
      enabled: r.enabled,
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

export const relayRoutes: FastifyPluginAsyncTypebox<RouteDeps> = async (app, { config, db, delivery, send }) => {
  const key = deriveKey(config.appSecret, 'webhook-url');
  const decryptUrl = (enc: string) => delivery.decryptWebhookUrl(enc);

  const owned = async (id: string, userId: string) => {
    const [row] = await db.select().from(relays).where(and(eq(relays.id, id), eq(relays.userId, userId)));
    return row;
  };
  const detail = async (row: RelayRow) => ({
    ...(await serializeRelays(db, config, [row], decryptUrl))[0]!,
    samplePayload: row.samplePayload,
  });

  app.get(
    '',
    { schema: { tags, security, summary: 'List relays', response: { 200: Type.Array(Relay) } } },
    async (req) => {
      const rows = await db.select().from(relays).where(eq(relays.userId, req.userId)).orderBy(asc(relays.name));
      return serializeRelays(db, config, rows, decryptUrl);
    },
  );

  app.post(
    '',
    {
      schema: {
        tags,
        security,
        summary: 'Create a relay',
        body: Type.Object({
          name: Type.String({ minLength: 1, maxLength: 100 }),
          discordWebhookUrl: Type.String({ maxLength: 500 }),
          enabled: Type.Optional(Type.Boolean()),
        }),
        response: { 201: RelayDetail, 400: ErrorResponse },
      },
    },
    async (req, reply) => {
      const { name, discordWebhookUrl, enabled } = req.body;
      if (!isDiscordWebhookUrl(discordWebhookUrl)) return reply.code(400).send(badWebhook);
      const [row] = await db
        .insert(relays)
        .values({
          userId: req.userId,
          name: name.trim(),
          slug: slugify(name),
          ingestKey: newIngestKey(name),
          discordWebhookUrlEnc: encrypt(key, discordWebhookUrl.trim()),
          enabled: enabled ?? true,
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
          discordWebhookUrl: Type.Optional(Type.String({ maxLength: 500 })),
          enabled: Type.Optional(Type.Boolean()),
        }),
        response: { 200: RelayDetail, 400: ErrorResponse, 404: ErrorResponse },
      },
    },
    async (req, reply) => {
      if (!(await owned(req.params.id, req.userId))) return reply.code(404).send(notFound);
      const { name, discordWebhookUrl, enabled } = req.body;
      if (discordWebhookUrl !== undefined && !isDiscordWebhookUrl(discordWebhookUrl)) return reply.code(400).send(badWebhook);
      const [row] = await db
        .update(relays)
        .set({
          ...(name !== undefined && { name: name.trim(), slug: slugify(name) }),
          ...(discordWebhookUrl !== undefined && { discordWebhookUrlEnc: encrypt(key, discordWebhookUrl.trim()) }),
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
      const render =
        tpl && payload !== null && payload !== undefined
          ? renderMessage(delivery.engine, tpl, { payload, relay: { name: relay.name } })
          : { message: { content: `✅ Test message from Send Any Webhook to Discord relay **${relay.name}**` }, warnings: [], error: null };
      if (!render.message) return { ok: false, status: null, error: render.error, render };
      try {
        const res = await send(decryptUrl(relay.discordWebhookUrlEnc), render.message);
        const ok = res.status >= 200 && res.status < 300;
        return { ok, status: res.status, error: ok ? null : `Discord ${res.status}: ${res.body.slice(0, 500)}`, render };
      } catch (err) {
        return { ok: false, status: null, error: (err as Error).message, render };
      }
    },
  );
};

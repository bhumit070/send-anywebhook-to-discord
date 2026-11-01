import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { isDiscordWebhookUrl } from '@send-any-webhook/shared';
import { and, asc, eq } from 'drizzle-orm';
import { Type } from 'typebox';
import { discordWebhooks, relays } from '../db/schema.js';
import { BAD_WEBHOOK_URL } from '../services/discord-webhooks.js';
import { DateTime, ErrorResponse, IdParams, OkResponse } from '../schemas.js';
import type { RouteDeps } from './types.js';

const tags = ['discord-webhooks'];
const security = [{ session: [] }];
const notFound = { statusCode: 404, error: 'Not Found', message: 'Saved Discord webhook not found' };
const bad = (message: string) => ({ statusCode: 400, error: 'Bad Request', message });

export const SavedWebhook = Type.Object({
  id: Type.String({ format: 'uuid' }),
  name: Type.String(),
  url: Type.String({ description: 'Masked; the token is never returned' }),
  relays: Type.Array(Type.Object({ id: Type.String({ format: 'uuid' }), name: Type.String() }), {
    description: 'Relays that send to this webhook',
  }),
  createdAt: DateTime,
  updatedAt: DateTime,
});

export const discordWebhookRoutes: FastifyPluginAsyncTypebox<RouteDeps> = async (app, { db, webhooks, send }) => {
  const list = async (userId: string, id?: string) => {
    const rows = await db
      .select()
      .from(discordWebhooks)
      .where(and(eq(discordWebhooks.userId, userId), id ? eq(discordWebhooks.id, id) : undefined))
      .orderBy(asc(discordWebhooks.name));
    const users = await db
      .select({ id: relays.id, name: relays.name, webhookId: relays.discordWebhookId })
      .from(relays)
      .where(eq(relays.userId, userId))
      .orderBy(asc(relays.name));
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      url: webhooks.masked(r.urlEnc),
      relays: users.filter((u) => u.webhookId === r.id).map(({ id, name }) => ({ id, name })),
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
  };

  app.get(
    '',
    { schema: { tags, security, summary: 'List saved Discord webhooks', response: { 200: Type.Array(SavedWebhook) } } },
    async (req) => list(req.userId),
  );

  app.post(
    '',
    {
      schema: {
        tags,
        security,
        summary: 'Save a Discord webhook URL to reuse in relays',
        body: Type.Object({ name: Type.String({ minLength: 1, maxLength: 100 }), url: Type.String({ maxLength: 500 }) }),
        response: { 201: SavedWebhook, 400: ErrorResponse, 409: ErrorResponse },
      },
    },
    async (req, reply) => {
      if (!isDiscordWebhookUrl(req.body.url)) return reply.code(400).send(bad(BAD_WEBHOOK_URL));
      const existing = await webhooks.findByUrl(req.userId, req.body.url);
      if (existing) {
        return reply.code(409).send({ statusCode: 409, error: 'Conflict', message: `This URL is already saved as “${existing.name}”` });
      }
      const [row] = await db
        .insert(discordWebhooks)
        .values({ userId: req.userId, name: req.body.name.trim(), urlEnc: webhooks.encrypt(req.body.url) })
        .returning();
      return reply.code(201).send((await list(req.userId, row!.id))[0]!);
    },
  );

  app.patch(
    '/:id',
    {
      schema: {
        tags,
        security,
        summary: 'Rename a saved webhook or replace its URL (every relay using it follows)',
        params: IdParams,
        body: Type.Object({
          name: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
          url: Type.Optional(Type.String({ maxLength: 500 })),
        }),
        response: { 200: SavedWebhook, 400: ErrorResponse, 404: ErrorResponse, 409: ErrorResponse },
      },
    },
    async (req, reply) => {
      if (!(await webhooks.owned(req.userId, req.params.id))) return reply.code(404).send(notFound);
      const { name, url } = req.body;
      if (url !== undefined) {
        if (!isDiscordWebhookUrl(url)) return reply.code(400).send(bad(BAD_WEBHOOK_URL));
        const existing = await webhooks.findByUrl(req.userId, url);
        if (existing && existing.id !== req.params.id) {
          return reply.code(409).send({ statusCode: 409, error: 'Conflict', message: `This URL is already saved as “${existing.name}”` });
        }
      }
      await db
        .update(discordWebhooks)
        .set({ ...(name !== undefined && { name: name.trim() }), ...(url !== undefined && { urlEnc: webhooks.encrypt(url) }) })
        .where(eq(discordWebhooks.id, req.params.id));
      return (await list(req.userId, req.params.id))[0]!;
    },
  );

  app.delete(
    '/:id',
    {
      schema: {
        tags,
        security,
        summary: 'Delete a saved webhook that no relay uses',
        params: IdParams,
        response: { 200: OkResponse, 404: ErrorResponse, 409: ErrorResponse },
      },
    },
    async (req, reply) => {
      const [saved] = await list(req.userId, req.params.id);
      if (!saved) return reply.code(404).send(notFound);
      if (saved.relays.length) {
        return reply.code(409).send({
          statusCode: 409,
          error: 'Conflict',
          message: `Used by ${saved.relays.map((r) => `“${r.name}”`).join(', ')}. Move those relays to another webhook first.`,
        });
      }
      await db.delete(discordWebhooks).where(eq(discordWebhooks.id, req.params.id));
      return { ok: true as const };
    },
  );

  app.post(
    '/:id/test',
    {
      schema: {
        tags,
        security,
        summary: 'Send a short test message to this Discord webhook',
        params: IdParams,
        response: {
          200: Type.Object({ ok: Type.Boolean(), status: Type.Union([Type.Null(), Type.Integer()]), error: Type.Union([Type.Null(), Type.String()]) }),
          404: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      const saved = await webhooks.owned(req.userId, req.params.id);
      if (!saved) return reply.code(404).send(notFound);
      try {
        const res = await send(webhooks.decrypt(saved.urlEnc), { content: `✅ Test message from Send Any Webhook to Discord (**${saved.name}**)` });
        const ok = res.status >= 200 && res.status < 300;
        return { ok, status: res.status, error: ok ? null : `Discord ${res.status}: ${res.body.slice(0, 500)}` };
      } catch (err) {
        return { ok: false, status: null, error: (err as Error).message };
      }
    },
  );
};

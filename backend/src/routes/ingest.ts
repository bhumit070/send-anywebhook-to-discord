import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { eq } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import { Type } from 'typebox';
import { relays, webhookQueue } from '../db/schema.js';
import { ErrorResponse } from '../schemas.js';
import type { RouteDeps } from './types.js';

export const INGEST_BODY_LIMIT = 1024 * 1024;

const SENSITIVE = /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key)$|token|secret|password/i;
const DROPPED = /^(x-forwarded-.*|x-real-ip|forwarded|connection|content-length)$/i;

export function storedHeaders(headers: FastifyRequest['headers']): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (v === undefined || DROPPED.test(k)) continue;
    out[k] = SENSITIVE.test(k) ? '[redacted]' : Array.isArray(v) ? v.join(', ') : v;
  }
  return out;
}

const Params = Type.Object({ key: Type.String({ maxLength: 100 }) });
const Accepted = Type.Object({ id: Type.String(), status: Type.Literal('queued') });

export const ingestRoutes: FastifyPluginAsyncTypebox<RouteDeps> = async (app, { db }) => {
  // Keep the raw body so non-JSON requests can be logged as rejected instead of failing in the parser
  app.removeAllContentTypeParsers();
  app.addContentTypeParser('*', { parseAs: 'buffer', bodyLimit: INGEST_BODY_LIMIT }, (_req, body, done) => done(null, body));

  const findRelay = async (key: string) => (await db.select().from(relays).where(eq(relays.ingestKey, key)))[0];

  const reject = async (relayId: string, req: FastifyRequest, reason: string) => {
    await db.insert(webhookQueue).values({
      relayId,
      status: 'rejected',
      sourceIp: req.ip,
      headers: storedHeaders(req.headers),
      payload: null,
      lastError: reason,
    });
  };

  // Bodies over the limit fail before the handler; log them against the relay too
  app.setErrorHandler(async (err: { statusCode?: number; message: string }, req, reply) => {
    const key = (req.params as { key?: string }).key;
    const relay = key ? await findRelay(key).catch(() => undefined) : undefined;
    if (relay && err.statusCode === 413) {
      await reject(relay.id, req, `Body larger than ${INGEST_BODY_LIMIT / 1024} KB`);
    }
    const statusCode = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
    if (statusCode >= 500) req.log.error({ err }, 'ingest failed');
    return reply.code(statusCode).send({ statusCode, error: 'Error', message: statusCode >= 500 ? 'Internal error' : err.message });
  });

  const handler = async (req: FastifyRequest<{ Params: { key: string } }>, reply: import('fastify').FastifyReply) => {
    const relay = await findRelay(req.params.key);
    if (!relay) return reply.code(404).send({ statusCode: 404, error: 'Not Found', message: 'Unknown webhook URL' });
    if (!relay.enabled) {
      await reject(relay.id, req, 'Relay is disabled');
      return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'This relay is disabled' });
    }

    const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
    if (!raw.trim()) {
      await reject(relay.id, req, 'Empty body; a JSON body is required');
      return reply.code(400).send({ statusCode: 400, error: 'Bad Request', message: 'A JSON body is required' });
    }
    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch (err) {
      const contentType = req.headers['content-type'] ?? 'none';
      const isJsonType = /json/i.test(contentType);
      const reason = isJsonType
        ? `Invalid JSON: ${(err as Error).message}`
        : `Only JSON bodies are supported (content-type: ${contentType}). Body starts with: ${raw.slice(0, 120)}`;
      await reject(relay.id, req, reason);
      return reply
        .code(isJsonType ? 400 : 415)
        .send({ statusCode: isJsonType ? 400 : 415, error: isJsonType ? 'Bad Request' : 'Unsupported Media Type', message: reason.split('. Body')[0]! });
    }

    if (relay.captureMode) {
      await db
        .update(relays)
        .set({ samplePayload: payload, sampleSource: 'captured', captureMode: false })
        .where(eq(relays.id, relay.id));
    }
    const [row] = await db
      .insert(webhookQueue)
      .values({ relayId: relay.id, status: 'pending', sourceIp: req.ip, headers: storedHeaders(req.headers), payload })
      .returning({ id: webhookQueue.id });
    return reply.code(202).send({ id: row!.id, status: 'queued' as const });
  };

  const schema = {
    tags: ['ingest'],
    summary: 'Receive a webhook (JSON body). Point the other service at this URL.',
    params: Params,
    response: { 202: Accepted, 400: ErrorResponse, 403: ErrorResponse, 404: ErrorResponse, 413: ErrorResponse, 415: ErrorResponse },
  };
  const config = { rateLimit: { max: 120, timeWindow: '1 minute', keyGenerator: (req: FastifyRequest) => (req.params as { key: string }).key } };
  app.post('/h/:key', { schema, config }, handler);
  app.put('/h/:key', { schema: { ...schema, summary: 'Same as POST, for services that send PUT' }, config }, handler);
};

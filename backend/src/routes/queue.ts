import { parsePath } from '@send-any-webhook/shared';
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { and, asc, count, desc, eq, gte, ilike, inArray, isNotNull, lte, or, sql, type SQL } from 'drizzle-orm';
import { Type, type Static } from 'typebox';
import type { Db } from '../db/client.js';
import { relays, webhookAttempts, webhookQueue } from '../db/schema.js';
import {
  BulkResult,
  DateTime,
  ErrorResponse,
  IdParams,
  QueueFilter,
  QueueItem,
  QueueItemDetail,
  SendResult,
  SORTABLE,
  type QueueFilterT,
  type QueueStatusT,
} from '../schemas.js';
import type { RouteDeps } from './types.js';

const tags = ['queue'];
const security = [{ session: [] }];
const notFound = { statusCode: 404, error: 'Not Found', message: 'Queue item not found' };

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
const pgTextArray = (items: string[]) => `{${items.map((s) => `"${s.replace(/["\\]/g, (c) => `\\${c}`)}"`).join(',')}}`;

/** WHERE clause for a user's rows matching a filter. Exported for tests. */
export function filterWhere(db: Db, userId: string, f: QueueFilterT): SQL {
  const conds: (SQL | undefined)[] = [
    inArray(webhookQueue.relayId, db.select({ id: relays.id }).from(relays).where(eq(relays.userId, userId))),
  ];
  if (f.relayId?.length) conds.push(inArray(webhookQueue.relayId, f.relayId));
  if (f.status?.length) conds.push(inArray(webhookQueue.status, f.status as QueueStatusT[]));
  if (f.from) conds.push(gte(webhookQueue.receivedAt, new Date(f.from)));
  if (f.to) conds.push(lte(webhookQueue.receivedAt, new Date(f.to)));
  if (f.statusCode !== undefined) conds.push(eq(webhookQueue.lastStatusCode, f.statusCode));
  if (f.hasError === true) conds.push(isNotNull(webhookQueue.lastError));
  if (f.hasError === false) conds.push(sql`${webhookQueue.lastError} is null`);
  if (f.q?.trim()) {
    const like = `%${escapeLike(f.q.trim())}%`;
    conds.push(or(sql`${webhookQueue.payload}::text ilike ${like}`, ilike(webhookQueue.lastError, like)));
  }
  if (f.path?.trim()) {
    let segments = parsePath(f.path.trim());
    if (!segments) throw Object.assign(new Error(`Can't read path "${f.path}"`), { statusCode: 400 });
    if (segments.length > 1 && segments[0] === 'payload') segments = segments.slice(1);
    const arr = pgTextArray(segments.map(String));
    conds.push(
      f.pathValue !== undefined
        ? sql`${webhookQueue.payload} #>> ${arr}::text[] = ${f.pathValue}`
        : sql`${webhookQueue.payload} #> ${arr}::text[] is not null`,
    );
  }
  return and(...conds)!;
}

const latestDuration = sql<number | null>`(
  select ${webhookAttempts.durationMs} from ${webhookAttempts}
  where ${webhookAttempts.queueId} = ${webhookQueue.id}
  order by ${webhookAttempts.attemptNo} desc limit 1)`.mapWith((v) => (v === null ? null : Number(v)));

const itemColumns = {
  id: webhookQueue.id,
  relayId: webhookQueue.relayId,
  relayName: relays.name,
  status: webhookQueue.status,
  receivedAt: webhookQueue.receivedAt,
  attempts: webhookQueue.attempts,
  maxAttempts: webhookQueue.maxAttempts,
  nextAttemptAt: webhookQueue.nextAttemptAt,
  deliveredAt: webhookQueue.deliveredAt,
  lastError: webhookQueue.lastError,
  lastStatusCode: webhookQueue.lastStatusCode,
  templateId: webhookQueue.templateId,
  durationMs: latestDuration,
};

const SORT_COLUMNS = {
  receivedAt: webhookQueue.receivedAt,
  attempts: webhookQueue.attempts,
  lastStatusCode: webhookQueue.lastStatusCode,
  nextAttemptAt: webhookQueue.nextAttemptAt,
  deliveredAt: webhookQueue.deliveredAt,
  status: webhookQueue.status,
  relayName: relays.name,
} as const;

const ListQuery = Type.Intersect([
  QueueFilter,
  Type.Object({
    sort: Type.Optional(
      Type.String({ pattern: `^(${SORTABLE.join('|')}):(asc|desc)$`, default: 'receivedAt:desc', description: 'column:direction' }),
    ),
    page: Type.Optional(Type.Integer({ minimum: 1, default: 1 })),
    pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 50 })),
  }),
]);

const Ids = Type.Object({ ids: Type.Array(Type.String({ format: 'uuid' }), { minItems: 1, maxItems: 200 }) });

export const queueRoutes: FastifyPluginAsyncTypebox<RouteDeps> = async (app, { db, delivery }) => {
  const ownedIds = async (userId: string, ids: string[]) =>
    (
      await db
        .select({ id: webhookQueue.id })
        .from(webhookQueue)
        .innerJoin(relays, eq(relays.id, webhookQueue.relayId))
        .where(and(inArray(webhookQueue.id, ids), eq(relays.userId, userId)))
    ).map((r) => r.id);

  app.get(
    '',
    {
      schema: {
        tags,
        security,
        summary: 'Webhook log: filter, sort and page through received webhooks',
        querystring: ListQuery,
        response: {
          200: Type.Object({ items: Type.Array(QueueItem), total: Type.Integer(), page: Type.Integer(), pageSize: Type.Integer() }),
          400: ErrorResponse,
        },
      },
    },
    async (req) => {
      const { sort = 'receivedAt:desc', page = 1, pageSize = 50, ...filter } = req.query;
      const [column, dir] = sort.split(':') as [keyof typeof SORT_COLUMNS, 'asc' | 'desc'];
      const where = filterWhere(db, req.userId, filter);
      const order = dir === 'asc' ? asc(SORT_COLUMNS[column]) : desc(SORT_COLUMNS[column]);
      const [items, [total]] = await Promise.all([
        db
          .select(itemColumns)
          .from(webhookQueue)
          .leftJoin(relays, eq(relays.id, webhookQueue.relayId))
          .where(where)
          .orderBy(sql`${order} nulls last`, desc(webhookQueue.receivedAt), desc(webhookQueue.id))
          .limit(pageSize)
          .offset((page - 1) * pageSize),
        db.select({ n: count() }).from(webhookQueue).where(where),
      ]);
      return { items, total: total?.n ?? 0, page, pageSize };
    },
  );

  app.get(
    '/stats',
    {
      schema: {
        tags,
        security,
        summary: 'Queue counts by status and the age of the oldest waiting webhook',
        querystring: Type.Object({ relayId: Type.Optional(Type.Array(Type.String({ format: 'uuid' }))) }),
        response: {
          200: Type.Object({
            counts: Type.Record(Type.String(), Type.Integer()),
            oldestWaitingAt: Type.Union([Type.Null(), DateTime]),
          }),
        },
      },
    },
    async (req) => {
      const where = filterWhere(db, req.userId, { relayId: req.query.relayId });
      const rows = await db
        .select({ status: webhookQueue.status, n: count() })
        .from(webhookQueue)
        .where(where)
        .groupBy(webhookQueue.status);
      const [oldest] = await db
        .select({ at: sql<Date | null>`min(${webhookQueue.receivedAt})`.mapWith((v) => (v ? new Date(v) : null)) })
        .from(webhookQueue)
        .where(and(where, inArray(webhookQueue.status, ['pending', 'failed', 'processing'])));
      const counts: Record<string, number> = { pending: 0, processing: 0, delivered: 0, failed: 0, dead: 0, skipped: 0, rejected: 0 };
      for (const r of rows) counts[r.status] = r.n;
      return { counts, oldestWaitingAt: oldest?.at ?? null };
    },
  );

  app.get(
    '/:id',
    {
      schema: {
        tags,
        security,
        summary: 'One webhook with its payload, rendered message and every delivery attempt',
        params: IdParams,
        response: { 200: QueueItemDetail, 404: ErrorResponse },
      },
    },
    async (req, reply) => {
      const [item] = await db
        .select({
          ...itemColumns,
          sourceIp: webhookQueue.sourceIp,
          headers: webhookQueue.headers,
          payload: webhookQueue.payload,
          rendered: webhookQueue.rendered,
        })
        .from(webhookQueue)
        .innerJoin(relays, eq(relays.id, webhookQueue.relayId))
        .where(and(eq(webhookQueue.id, req.params.id), eq(relays.userId, req.userId)));
      if (!item) return reply.code(404).send(notFound);
      const attemptsLog = await db
        .select()
        .from(webhookAttempts)
        .where(eq(webhookAttempts.queueId, item.id))
        .orderBy(asc(webhookAttempts.attemptNo), asc(webhookAttempts.startedAt));
      return { ...item, attemptsLog };
    },
  );

  // ---------- actions ----------

  const sendMany = async (ids: string[]) => {
    const results: Static<typeof SendResult>[] = [];
    for (const id of ids) {
      const r = await delivery.sendNow(id);
      if (r) results.push(r);
    }
    return results;
  };

  app.post(
    '/:id/send',
    {
      schema: {
        tags,
        security,
        summary: 'Send now, ignoring queue order (pending or failed rows)',
        params: IdParams,
        response: { 200: SendResult, 404: ErrorResponse, 409: ErrorResponse },
      },
    },
    async (req, reply) => {
      if (!(await ownedIds(req.userId, [req.params.id])).length) return reply.code(404).send(notFound);
      const result = await delivery.sendNow(req.params.id);
      if (!result) {
        return reply.code(409).send({
          statusCode: 409,
          error: 'Conflict',
          message: 'Only pending or failed webhooks can be sent now (it may already be sending). Use retry or replay.',
        });
      }
      return result;
    },
  );

  app.post(
    '/send',
    {
      schema: {
        tags,
        security,
        summary: 'Send several webhooks now, one after another (max 50)',
        body: Type.Object({ ids: Type.Array(Type.String({ format: 'uuid' }), { minItems: 1, maxItems: 50 }) }),
        response: { 200: Type.Object({ results: Type.Array(SendResult) }) },
      },
    },
    async (req) => ({ results: await sendMany(await ownedIds(req.userId, req.body.ids)) }),
  );

  app.post(
    '/send-oldest',
    {
      schema: {
        tags,
        security,
        summary: 'Send the oldest N waiting webhooks now (for when the backlog grows)',
        body: Type.Object({
          count: Type.Integer({ minimum: 1, maximum: 50 }),
          relayId: Type.Optional(Type.Array(Type.String({ format: 'uuid' }))),
        }),
        response: { 200: Type.Object({ results: Type.Array(SendResult) }) },
      },
    },
    async (req) => {
      const rows = await db
        .select({ id: webhookQueue.id })
        .from(webhookQueue)
        .where(and(filterWhere(db, req.userId, { relayId: req.body.relayId }), inArray(webhookQueue.status, ['pending', 'failed'])))
        .orderBy(asc(webhookQueue.receivedAt))
        .limit(req.body.count);
      return { results: await sendMany(rows.map((r) => r.id)) };
    },
  );

  const retrySet = { status: 'pending' as const, attempts: 0, nextAttemptAt: sql`now()` };
  const retryable: QueueStatusT[] = ['dead', 'failed', 'skipped'];

  app.post(
    '/:id/retry',
    {
      schema: {
        tags,
        security,
        summary: 'Queue again with a fresh retry budget, using the current template (dead, failed or skipped rows)',
        params: IdParams,
        response: { 200: BulkResult, 404: ErrorResponse },
      },
    },
    async (req, reply) => {
      if (!(await ownedIds(req.userId, [req.params.id])).length) return reply.code(404).send(notFound);
      const rows = await db
        .update(webhookQueue)
        .set(retrySet)
        .where(and(eq(webhookQueue.id, req.params.id), inArray(webhookQueue.status, retryable)))
        .returning({ id: webhookQueue.id });
      return { affected: rows.length };
    },
  );

  app.post(
    '/retry',
    {
      schema: {
        tags,
        security,
        summary: 'Retry many: by ids, or every dead/failed/skipped row matching a filter',
        body: Type.Union([Ids, Type.Object({ filter: QueueFilter })]),
        response: { 200: BulkResult, 400: ErrorResponse },
      },
    },
    async (req) => {
      const body = req.body as { ids?: string[]; filter?: QueueFilterT };
      const where = body.ids
        ? and(inArray(webhookQueue.id, await ownedIds(req.userId, body.ids)))
        : filterWhere(db, req.userId, body.filter ?? {});
      const rows = await db
        .update(webhookQueue)
        .set(retrySet)
        .where(and(where, inArray(webhookQueue.status, retryable)))
        .returning({ id: webhookQueue.id });
      return { affected: rows.length };
    },
  );

  const cancel = async (userId: string, ids: string[]) => {
    const owned = await ownedIds(userId, ids);
    if (!owned.length) return 0;
    const rows = await db
      .update(webhookQueue)
      .set({ status: 'dead', lastError: 'Cancelled by user', nextAttemptAt: sql`now()` })
      .where(and(inArray(webhookQueue.id, owned), inArray(webhookQueue.status, ['pending', 'failed'])))
      .returning({ id: webhookQueue.id });
    return rows.length;
  };

  app.post(
    '/:id/cancel',
    {
      schema: { tags, security, summary: 'Stop retrying a pending or failed webhook', params: IdParams, response: { 200: BulkResult } },
    },
    async (req) => ({ affected: await cancel(req.userId, [req.params.id]) }),
  );

  app.post(
    '/cancel',
    { schema: { tags, security, summary: 'Cancel many pending or failed webhooks', body: Ids, response: { 200: BulkResult } } },
    async (req) => ({ affected: await cancel(req.userId, req.body.ids) }),
  );

  app.post(
    '/:id/replay',
    {
      schema: {
        tags,
        security,
        summary: 'Copy a received webhook into a new queue row and send it now',
        params: IdParams,
        response: { 200: SendResult, 400: ErrorResponse, 404: ErrorResponse },
      },
    },
    async (req, reply) => {
      const [src] = await db
        .select({ relayId: webhookQueue.relayId, payload: webhookQueue.payload, headers: webhookQueue.headers, sourceIp: webhookQueue.sourceIp })
        .from(webhookQueue)
        .innerJoin(relays, eq(relays.id, webhookQueue.relayId))
        .where(and(eq(webhookQueue.id, req.params.id), eq(relays.userId, req.userId)));
      if (!src) return reply.code(404).send(notFound);
      if (src.payload === null) {
        return reply.code(400).send({ statusCode: 400, error: 'Bad Request', message: 'Rejected requests have no payload to replay' });
      }
      const [copy] = await db.insert(webhookQueue).values({ ...src, status: 'pending' }).returning({ id: webhookQueue.id });
      const result = await delivery.sendNow(copy!.id, 'replay');
      return result ?? { id: copy!.id, status: 'pending' as const, lastError: null, lastStatusCode: null };
    },
  );
};


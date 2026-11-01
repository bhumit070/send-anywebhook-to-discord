import {
  autoMap,
  compileMapping,
  conditionError,
  renderMessage,
  templateError,
  type Mapping as MappingT,
  type MessageTemplate as MessageTemplateT,
} from '@send-any-webhook/shared';
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { and, asc, eq } from 'drizzle-orm';
import { Type, type Static } from 'typebox';
import { relays, templates } from '../db/schema.js';
import { ErrorResponse, IdParams, Mapping, MessageTemplate, OkResponse, RenderResult, Template, TemplateBody, Uuid } from '../schemas.js';
import type { RouteDeps } from './types.js';

const tags = ['templates'];
const security = [{ session: [] }];
const TemplateParams = Type.Object({ id: Uuid, templateId: Uuid });
const bad = (message: string) => ({ statusCode: 400, error: 'Bad Request', message });
const notFound = (what: string) => ({ statusCode: 404, error: 'Not Found', message: `${what} not found` });

export const templateRoutes: FastifyPluginAsyncTypebox<RouteDeps> = async (app, { db, delivery }) => {
  const ownsRelay = async (relayId: string, userId: string) =>
    (await db.select({ id: relays.id }).from(relays).where(and(eq(relays.id, relayId), eq(relays.userId, userId)))).length > 0;

  /** Validates a body and produces the columns to store, or an error message. */
  const prepare = (body: Partial<Static<typeof TemplateBody>>) => {
    let message: MessageTemplateT | undefined;
    let mapping: MappingT | null | undefined;
    if (body.mode === 'mapping') {
      if (!body.mapping) return { error: 'mode "mapping" needs a mapping' };
      mapping = body.mapping as MappingT;
      message = compileMapping(mapping);
    } else if (body.mode === 'liquid') {
      if (!body.message) return { error: 'mode "liquid" needs a message template' };
      message = body.message as MessageTemplateT;
      mapping = body.mapping === undefined ? undefined : (body.mapping as MappingT | null);
    }
    if (message) {
      const err = templateError(delivery.engine, message);
      if (err) return { error: `Template syntax error in ${err}` };
    }
    const condition = body.condition?.trim() || null;
    if (condition) {
      const err = conditionError(delivery.engine, condition);
      if (err) return { error: `Condition syntax error: ${err}` };
    }
    return {
      values: {
        ...(body.name !== undefined && { name: body.name.trim() }),
        ...(body.priority !== undefined && { priority: body.priority }),
        ...(body.condition !== undefined && { condition }),
        ...(body.mode !== undefined && { mode: body.mode }),
        ...(message !== undefined && { message }),
        ...(mapping !== undefined && { mapping }),
      },
    };
  };

  app.get(
    '/:id/templates',
    {
      schema: {
        tags,
        security,
        summary: 'List a relay\'s templates in match order',
        params: IdParams,
        response: { 200: Type.Array(Template), 404: ErrorResponse },
      },
    },
    async (req, reply) => {
      if (!(await ownsRelay(req.params.id, req.userId))) return reply.code(404).send(notFound('Relay'));
      return db
        .select()
        .from(templates)
        .where(eq(templates.relayId, req.params.id))
        .orderBy(asc(templates.priority), asc(templates.createdAt)) as Promise<Static<typeof Template>[]>;
    },
  );

  app.post(
    '/:id/templates',
    {
      schema: {
        tags,
        security,
        summary: 'Create a template',
        description: 'Templates are tried by ascending `priority`; the first whose `condition` matches is used. No condition = fallback.',
        params: IdParams,
        body: TemplateBody,
        response: { 201: Template, 400: ErrorResponse, 404: ErrorResponse },
      },
    },
    async (req, reply) => {
      if (!(await ownsRelay(req.params.id, req.userId))) return reply.code(404).send(notFound('Relay'));
      const prepared = prepare(req.body);
      if ('error' in prepared) return reply.code(400).send(bad(prepared.error!));
      const [row] = await db
        .insert(templates)
        .values({
          relayId: req.params.id,
          name: req.body.name.trim(),
          priority: req.body.priority ?? 0,
          condition: prepared.values.condition ?? null,
          mode: req.body.mode,
          mapping: prepared.values.mapping ?? null,
          message: prepared.values.message!,
        })
        .returning();
      return reply.code(201).send(row as Static<typeof Template>);
    },
  );

  app.patch(
    '/:id/templates/:templateId',
    {
      schema: {
        tags,
        security,
        summary: 'Update a template',
        params: TemplateParams,
        body: Type.Partial(TemplateBody),
        response: { 200: Template, 400: ErrorResponse, 404: ErrorResponse },
      },
    },
    async (req, reply) => {
      if (!(await ownsRelay(req.params.id, req.userId))) return reply.code(404).send(notFound('Relay'));
      const prepared = prepare(req.body);
      if ('error' in prepared) return reply.code(400).send(bad(prepared.error!));
      const [row] = await db
        .update(templates)
        .set(prepared.values)
        .where(and(eq(templates.id, req.params.templateId), eq(templates.relayId, req.params.id)))
        .returning();
      return row ? (row as Static<typeof Template>) : reply.code(404).send(notFound('Template'));
    },
  );

  app.delete(
    '/:id/templates/:templateId',
    {
      schema: { tags, security, summary: 'Delete a template', params: TemplateParams, response: { 200: OkResponse, 404: ErrorResponse } },
    },
    async (req, reply) => {
      if (!(await ownsRelay(req.params.id, req.userId))) return reply.code(404).send(notFound('Relay'));
      const rows = await db
        .delete(templates)
        .where(and(eq(templates.id, req.params.templateId), eq(templates.relayId, req.params.id)))
        .returning({ id: templates.id });
      return rows.length ? { ok: true as const } : reply.code(404).send(notFound('Template'));
    },
  );
};

/** Stateless helpers for the editor: preview a template and auto-map a sample. */
export const previewRoutes: FastifyPluginAsyncTypebox<RouteDeps> = async (app, { delivery }) => {
  app.post(
    '/preview',
    {
      schema: {
        tags,
        security,
        summary: 'Render a template against a payload without sending it',
        body: Type.Object({
          payload: Type.Unknown(),
          message: Type.Optional(MessageTemplate),
          mapping: Type.Optional(Mapping),
          relayName: Type.Optional(Type.String({ maxLength: 100 })),
        }),
        response: { 200: RenderResult, 400: ErrorResponse },
      },
    },
    async (req, reply) => {
      const tpl = req.body.mapping ? compileMapping(req.body.mapping as MappingT) : (req.body.message as MessageTemplateT | undefined);
      if (!tpl) return reply.code(400).send(bad('Provide `message` or `mapping`'));
      return renderMessage(delivery.engine, tpl, {
        payload: req.body.payload,
        relay: { name: req.body.relayName ?? 'Relay' },
      }) as Static<typeof RenderResult>;
    },
  );

  app.post(
    '/mapping/auto',
    {
      schema: {
        tags,
        security,
        summary: 'Suggest a mapping for a sample payload from its field names',
        body: Type.Object({ payload: Type.Unknown() }),
        response: { 200: Mapping },
      },
    },
    async (req) => autoMap(req.body.payload) as Static<typeof Mapping>,
  );
};

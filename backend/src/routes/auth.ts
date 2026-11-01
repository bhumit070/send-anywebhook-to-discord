import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { eq, sql } from 'drizzle-orm';
import { Type } from 'typebox';
import { users } from '../db/schema.js';
import { hashPassword, verifyPassword } from '../lib/crypto.js';
import { SESSION_COOKIE } from '../plugins/auth.js';
import { ErrorResponse, OkResponse } from '../schemas.js';
import type { RouteDeps } from './types.js';

const Credentials = Type.Object({
  email: Type.String({ format: 'email', maxLength: 254 }),
  password: Type.String({ minLength: 8, maxLength: 200 }),
});
const User = Type.Object({ id: Type.String(), email: Type.String() });
const tags = ['auth'];

// Constant-time-ish login: hash something even when the user doesn't exist
const DUMMY_HASH = await hashPassword('not-a-real-password');

export const authRoutes: FastifyPluginAsyncTypebox<RouteDeps> = async (app, { config, db }) => {
  const disabled = { 404: ErrorResponse };
  const authOff = { statusCode: 404, error: 'Not Found', message: 'Authentication is disabled on this instance' };

  app.post(
    '/register',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        tags,
        summary: 'Create an account and log in',
        body: Credentials,
        response: { 201: User, 403: ErrorResponse, 409: ErrorResponse, ...disabled },
      },
    },
    async (req, reply) => {
      if (config.authDisabled) return reply.code(404).send(authOff);
      if (!config.allowRegistration) {
        return reply.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'Registration is closed on this instance' });
      }
      const email = req.body.email.trim().toLowerCase();
      const [user] = await db
        .insert(users)
        .values({ email, passwordHash: await hashPassword(req.body.password) })
        .onConflictDoNothing()
        .returning({ id: users.id, email: users.email });
      if (!user) return reply.code(409).send({ statusCode: 409, error: 'Conflict', message: 'An account with this email already exists' });
      await app.startSession(reply, user.id);
      return reply.code(201).send(user);
    },
  );

  app.post(
    '/login',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        tags,
        summary: 'Log in; sets the session cookie',
        body: Type.Object({ email: Type.String({ maxLength: 254 }), password: Type.String({ maxLength: 200 }) }),
        response: { 200: User, 401: ErrorResponse, ...disabled },
      },
    },
    async (req, reply) => {
      if (config.authDisabled) return reply.code(404).send(authOff);
      const [user] = await db
        .select()
        .from(users)
        .where(eq(sql`lower(${users.email})`, req.body.email.trim().toLowerCase()));
      const ok = await verifyPassword(req.body.password, user?.passwordHash ?? DUMMY_HASH);
      if (!user || !user.passwordHash || !ok) {
        return reply.code(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Wrong email or password' });
      }
      await app.startSession(reply, user.id);
      return { id: user.id, email: user.email };
    },
  );

  app.post(
    '/logout',
    { schema: { tags, summary: 'Clear the session cookie', response: { 200: OkResponse } } },
    async (_req, reply) => {
      reply.clearCookie(SESSION_COOKIE, { path: '/' });
      return { ok: true as const };
    },
  );

  app.get(
    '/me',
    {
      preHandler: app.requireUser,
      schema: { tags, summary: 'The logged-in user', security: [{ session: [] }], response: { 200: User, 401: ErrorResponse } },
    },
    async (req, reply) => {
      const [user] = await db.select({ id: users.id, email: users.email }).from(users).where(eq(users.id, req.userId));
      if (!user) return reply.code(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Please log in' });
      return user;
    },
  );
};

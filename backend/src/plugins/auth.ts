import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import { eq, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import type { Config } from '../config.js';
import type { Db } from '../db/client.js';
import { users } from '../db/schema.js';
import { deriveKey } from '../lib/crypto.js';

export const SESSION_COOKIE = 'send_any_webhook_session';
export const LOCAL_USER_EMAIL = 'local@send-any-webhook.local';
const SESSION_DAYS = 30;

declare module 'fastify' {
  interface FastifyRequest {
    userId: string;
  }
  interface FastifyInstance {
    requireUser: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    startSession: (reply: FastifyReply, userId: string) => Promise<void>;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string };
    user: { sub: string };
  }
}

async function ensureLocalUser(db: Db): Promise<string> {
  const [row] = await db
    .insert(users)
    .values({ email: LOCAL_USER_EMAIL, passwordHash: null })
    .onConflictDoNothing()
    .returning({ id: users.id });
  if (row) return row.id;
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(sql`lower(${users.email})`, LOCAL_USER_EMAIL));
  if (!existing) throw new Error('Could not create the local user');
  return existing.id;
}

export default fp(
  async (app: FastifyInstance, opts: { config: Config; db: Db }) => {
    const { config, db } = opts;
    const secure = config.publicBaseUrl.startsWith('https://');

    await app.register(cookie);
    await app.register(jwt, {
      secret: deriveKey(config.appSecret, 'session-jwt').toString('base64'),
      cookie: { cookieName: SESSION_COOKIE, signed: false },
      sign: { expiresIn: `${SESSION_DAYS}d` },
    });

    app.decorateRequest('userId', '');

    let localUser: Promise<string> | null = null;

    app.decorate('requireUser', async (req: FastifyRequest, reply: FastifyReply) => {
      if (config.authDisabled) {
        localUser ??= ensureLocalUser(db).catch((err: unknown) => {
          localUser = null;
          throw err;
        });
        req.userId = await localUser;
        return;
      }
      try {
        const payload = await req.jwtVerify<{ sub: string }>();
        req.userId = payload.sub;
      } catch {
        await reply.code(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Please log in' });
      }
    });

    app.decorate('startSession', async (reply: FastifyReply, userId: string) => {
      const token = await reply.jwtSign({ sub: userId });
      reply.setCookie(SESSION_COOKIE, token, {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure,
        maxAge: SESSION_DAYS * 24 * 3600,
      });
    });
  },
  { name: 'auth' },
);

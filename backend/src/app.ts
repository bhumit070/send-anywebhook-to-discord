import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import Fastify, { type FastifyServerOptions } from 'fastify';
import { Type } from 'typebox';
import type { Config } from './config.js';
import type { Db } from './db/client.js';
import { sendToDiscord, type DiscordSender } from './lib/discord.js';
import auth, { SESSION_COOKIE } from './plugins/auth.js';
import { authRoutes } from './routes/auth.js';
import { ingestRoutes, INGEST_BODY_LIMIT } from './routes/ingest.js';
import { queueRoutes } from './routes/queue.js';
import { relayRoutes } from './routes/relays.js';
import { previewRoutes, templateRoutes } from './routes/templates.js';
import { Delivery } from './services/delivery.js';

export interface AppDeps {
  config: Config;
  db: Db;
  /** Resolves when the database answers; rejects otherwise. */
  pingDb: () => Promise<void>;
  /** Defaults to the real Discord client; tests pass a fake. */
  send?: DiscordSender;
}

declare module 'fastify' {
  interface FastifyInstance {
    delivery: Delivery;
  }
}

export async function buildApp(deps: AppDeps, opts: FastifyServerOptions = {}) {
  const { config, db } = deps;
  const send = deps.send ?? sendToDiscord;
  const app = Fastify({
    bodyLimit: INGEST_BODY_LIMIT,
    // Trust only our own proxies; anything further left in X-Forwarded-For is client-supplied
    trustProxy: (_address: string, hop: number) => hop < config.trustProxyHops,
    ...opts,
  }).withTypeProvider<TypeBoxTypeProvider>();

  const delivery = new Delivery(db, config, send, app.log);
  app.decorate('delivery', delivery);

  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Send Any Webhook to Discord API',
        description:
          'Relay any webhook to a Discord channel. Dashboard endpoints use the session cookie set by `/api/auth/login` (or no auth when `AUTH_DISABLED=true`). Webhook ingest (`/h/{key}`) is authenticated by its secret key.',
        version: '0.1.0',
      },
      servers: [{ url: config.publicBaseUrl }],
      tags: [
        { name: 'ingest', description: 'Where other services send their webhooks' },
        { name: 'auth', description: 'Accounts and sessions' },
        { name: 'relays', description: 'Incoming URL → Discord channel' },
        { name: 'templates', description: 'How a payload becomes a Discord message' },
        { name: 'queue', description: 'Delivery queue and webhook logs' },
        { name: 'system', description: 'Health and instance configuration' },
      ],
      components: {
        securitySchemes: { session: { type: 'apiKey', in: 'cookie', name: SESSION_COOKIE } },
      },
    },
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });
  await app.register(rateLimit, { global: false });
  await app.register(auth, { config, db });

  app.get(
    '/healthz',
    {
      logLevel: 'warn', // polled every 10s by the Docker healthcheck
      schema: {
        tags: ['system'],
        summary: 'Liveness and database connectivity',
        response: {
          200: Type.Object({ status: Type.Literal('ok'), db: Type.Literal('ok') }),
          503: Type.Object({ status: Type.Literal('error'), db: Type.Literal('unreachable') }),
        },
      },
    },
    async (req, reply) => {
      try {
        await deps.pingDb();
        return { status: 'ok' as const, db: 'ok' as const };
      } catch (err) {
        req.log.error({ err }, 'database ping failed');
        return reply.code(503).send({ status: 'error' as const, db: 'unreachable' as const });
      }
    },
  );

  app.get(
    '/api/config',
    {
      schema: {
        tags: ['system'],
        summary: 'Public instance configuration used by the UI',
        response: {
          200: Type.Object({
            authDisabled: Type.Boolean(),
            registrationEnabled: Type.Boolean(),
            publicBaseUrl: Type.String(),
          }),
        },
      },
    },
    async () => ({
      authDisabled: config.authDisabled,
      registrationEnabled: !config.authDisabled && config.allowRegistration,
      publicBaseUrl: config.publicBaseUrl,
    }),
  );

  const routeDeps = { config, db, delivery, send };
  await app.register(ingestRoutes, routeDeps);
  await app.register(authRoutes, { ...routeDeps, prefix: '/api/auth' });
  await app.register(
    async (api) => {
      api.addHook('preHandler', api.requireUser);
      await api.register(relayRoutes, { ...routeDeps, prefix: '/relays' });
      await api.register(templateRoutes, { ...routeDeps, prefix: '/relays' });
      await api.register(previewRoutes, routeDeps);
      await api.register(queueRoutes, { ...routeDeps, prefix: '/queue' });
    },
    { prefix: '/api' },
  );

  return app;
}

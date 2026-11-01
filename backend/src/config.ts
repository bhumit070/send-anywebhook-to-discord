function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function int(name: string, value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${name} must be a non-negative integer, got "${value}"`);
  return n;
}

function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const appSecret = required('APP_SECRET', env.APP_SECRET);
  if (appSecret.length < 32) throw new Error('APP_SECRET must be at least 32 characters');

  return {
    host: env.HOST || '0.0.0.0',
    port: int('BACKEND_PORT', env.BACKEND_PORT, 5353),
    logLevel: env.LOG_LEVEL || 'info',
    prettyLogs: bool(env.PRETTY_LOGS, false),
    databaseUrl: required('DATABASE_URL', env.DATABASE_URL),
    appSecret,
    publicBaseUrl: (env.PUBLIC_BASE_URL || 'http://localhost:5252').replace(/\/+$/, ''),
    authDisabled: bool(env.AUTH_DISABLED, false),
    allowRegistration: bool(env.ALLOW_REGISTRATION, true),
    eventRetentionDays: int('EVENT_RETENTION_DAYS', env.EVENT_RETENTION_DAYS, 14),
    /** Run the delivery worker inside the API process. Set false when running workers separately. */
    runWorker: bool(env.RUN_WORKER, true),
    /** Reverse proxies in front of the backend whose X-Forwarded-For is trusted (the bundled nginx = 1). */
    trustProxyHops: int('TRUST_PROXY_HOPS', env.TRUST_PROXY_HOPS, 1),
  };
}

export type Config = ReturnType<typeof loadConfig>;

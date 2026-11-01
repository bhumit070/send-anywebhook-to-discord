import type { HmacAlgorithm, IngestAuth } from '@send-any-webhook/shared';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';
import { decrypt, encrypt, randomToken } from './crypto.js';

/** What the API accepts: secrets may be omitted (kept on update, generated on create). */
export interface IngestAuthInput {
  type: IngestAuth['type'];
  headerName?: string;
  secret?: string;
  username?: string;
  password?: string;
  algorithm?: HmacAlgorithm;
  encoding?: 'hex' | 'base64';
  prefix?: string;
}

const HEADER_NAME = /^[A-Za-z0-9-]{1,100}$/;

/** Fills defaults, keeps the current secret when none is given, generates one when needed. */
export function resolveIngestAuth(input: IngestAuthInput, current: IngestAuth | null): IngestAuth | { error: string } {
  const same = current?.type === input.type ? current : null;
  const header = (fallback: string) => {
    const name = input.headerName?.trim() || (same && 'headerName' in same ? same.headerName : fallback);
    return HEADER_NAME.test(name) ? name : null;
  };
  const secret = (given: string | undefined, kept: string | undefined) => {
    const s = given?.trim() || kept || randomToken(40);
    return s.length >= 8 ? s : null;
  };
  switch (input.type) {
    case 'none':
      return { type: 'none' };
    case 'token': {
      const headerName = header('Authorization');
      if (!headerName) return { error: 'Header name may only contain letters, digits and dashes' };
      const s = secret(input.secret, same?.type === 'token' ? same.secret : undefined);
      if (!s) return { error: 'The secret must be at least 8 characters' };
      return { type: 'token', headerName, secret: s };
    }
    case 'basic': {
      const username = input.username?.trim() || (same?.type === 'basic' ? same.username : 'webhook');
      if (username.includes(':')) return { error: 'The username cannot contain ":"' };
      const password = secret(input.password, same?.type === 'basic' ? same.password : undefined);
      if (!password) return { error: 'The password must be at least 8 characters' };
      return { type: 'basic', username, password };
    }
    case 'hmac': {
      const headerName = header('X-Signature');
      if (!headerName) return { error: 'Header name may only contain letters, digits and dashes' };
      const s = secret(input.secret, same?.type === 'hmac' ? same.secret : undefined);
      if (!s) return { error: 'The secret must be at least 8 characters' };
      const prev = same?.type === 'hmac' ? same : null;
      return {
        type: 'hmac',
        headerName,
        secret: s,
        algorithm: input.algorithm ?? prev?.algorithm ?? 'sha256',
        encoding: input.encoding ?? prev?.encoding ?? 'hex',
        prefix: input.prefix ?? prev?.prefix ?? '',
      };
    }
  }
}

/** A fresh secret (or password) for the same method. */
export function rotateIngestAuth(auth: IngestAuth): IngestAuth {
  if (auth.type === 'token' || auth.type === 'hmac') return { ...auth, secret: randomToken(40) };
  if (auth.type === 'basic') return { ...auth, password: randomToken(40) };
  return auth;
}

export function sealIngestAuth(key: Buffer, auth: IngestAuth): string | null {
  return auth.type === 'none' ? null : encrypt(key, JSON.stringify(auth));
}

export function openIngestAuth(key: Buffer, type: IngestAuth['type'], enc: string | null): IngestAuth {
  if (type === 'none' || !enc) return { type: 'none' };
  return JSON.parse(decrypt(key, enc)) as IngestAuth;
}

/** Constant-time comparison that also works for different lengths. */
function same(a: string, b: string): boolean {
  const h = (s: string) => createHash('sha256').update(s).digest();
  return timingSafeEqual(h(a), h(b));
}

function headerValue(headers: IncomingHttpHeaders, name: string): string | undefined {
  const v = headers[name.toLowerCase()];
  return Array.isArray(v) ? v[0] : v;
}

/** Checks a request against the relay's auth. Returns null when allowed, else the reason. */
export function verifyIngestAuth(auth: IngestAuth, headers: IncomingHttpHeaders, rawBody: Buffer): string | null {
  switch (auth.type) {
    case 'none':
      return null;
    case 'token': {
      const v = headerValue(headers, auth.headerName)?.trim();
      if (!v) return `Missing ${auth.headerName} header`;
      const bearer = /^bearer\s+(.+)$/i.exec(v)?.[1];
      return same(v, auth.secret) || (bearer !== undefined && same(bearer, auth.secret)) ? null : `Wrong token in ${auth.headerName}`;
    }
    case 'basic': {
      const v = headerValue(headers, 'authorization');
      const encoded = v && /^basic\s+(.+)$/i.exec(v.trim())?.[1];
      if (!encoded) return 'Missing username and password (Basic auth)';
      const decoded = Buffer.from(encoded, 'base64').toString('utf8');
      const i = decoded.indexOf(':');
      const ok = i >= 0 && same(decoded.slice(0, i), auth.username) && same(decoded.slice(i + 1), auth.password);
      return ok ? null : 'Wrong username or password';
    }
    case 'hmac': {
      let v = headerValue(headers, auth.headerName)?.trim();
      if (!v) return `Missing ${auth.headerName} signature header`;
      if (auth.prefix && v.toLowerCase().startsWith(auth.prefix.toLowerCase())) v = v.slice(auth.prefix.length);
      const expected = createHmac(auth.algorithm, auth.secret).update(rawBody).digest(auth.encoding);
      const ok = auth.encoding === 'hex' ? same(v.toLowerCase(), expected) : same(v, expected);
      return ok ? null : `Signature in ${auth.headerName} does not match the body`;
    }
  }
}

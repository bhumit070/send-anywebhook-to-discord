/** How a sender proves it may post to a relay's ingest URL (on top of the secret URL itself). */
export type IngestAuth =
  | { type: 'none' }
  /** A secret in a header: `Authorization: Bearer <secret>`, or the bare secret in any header. */
  | { type: 'token'; headerName: string; secret: string }
  /** HTTP Basic auth; also works as https://user:pass@host/h/… for services that only take a URL. */
  | { type: 'basic'; username: string; password: string }
  /** HMAC of the raw request body with a shared secret, sent in a header (GitHub/Vikunja style). */
  | { type: 'hmac'; headerName: string; secret: string; algorithm: HmacAlgorithm; encoding: 'hex' | 'base64'; prefix: string };

export type IngestAuthType = IngestAuth['type'];
export type HmacAlgorithm = 'sha256' | 'sha1' | 'sha512';

export const INGEST_AUTH_LABELS: Record<IngestAuthType, string> = {
  none: 'URL only',
  token: 'Secret header (Bearer token)',
  basic: 'Username + password (Basic auth)',
  hmac: 'Signature (HMAC)',
};

/** Signature formats of well-known senders. */
export const HMAC_PRESETS: Record<string, { label: string; headerName: string; algorithm: HmacAlgorithm; encoding: 'hex' | 'base64'; prefix: string }> = {
  github: { label: 'GitHub', headerName: 'X-Hub-Signature-256', algorithm: 'sha256', encoding: 'hex', prefix: 'sha256=' },
  vikunja: { label: 'Vikunja', headerName: 'X-Vikunja-Signature', algorithm: 'sha256', encoding: 'hex', prefix: '' },
  generic: { label: 'Generic (X-Signature, hex SHA-256)', headerName: 'X-Signature', algorithm: 'sha256', encoding: 'hex', prefix: '' },
};

const shellQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/**
 * A copy-paste shell command that posts `payload` to a relay with the right credentials.
 * For HMAC it computes the signature with openssl over the exact bytes it sends.
 */
export function curlCommand(url: string, payload: unknown, auth: IngestAuth): string {
  const body = JSON.stringify(payload, null, 2);
  const json = "-H 'Content-Type: application/json'";
  switch (auth.type) {
    case 'none':
      return `curl -X POST ${shellQuote(url)} \\\n  ${json} \\\n  --data-binary ${shellQuote(body)}`;
    case 'token': {
      const value = auth.headerName.toLowerCase() === 'authorization' ? `Bearer ${auth.secret}` : auth.secret;
      return `curl -X POST ${shellQuote(url)} \\\n  ${json} \\\n  -H ${shellQuote(`${auth.headerName}: ${value}`)} \\\n  --data-binary ${shellQuote(body)}`;
    }
    case 'basic':
      return `curl -X POST ${shellQuote(url)} \\\n  -u ${shellQuote(`${auth.username}:${auth.password}`)} \\\n  ${json} \\\n  --data-binary ${shellQuote(body)}`;
    case 'hmac': {
      const digest =
        auth.encoding === 'hex'
          ? `openssl dgst -${auth.algorithm} -hmac ${shellQuote(auth.secret)} -r | cut -d' ' -f1`
          : `openssl dgst -${auth.algorithm} -hmac ${shellQuote(auth.secret)} -binary | base64`;
      return [
        `BODY=${shellQuote(body)}`,
        `SIG=$(printf '%s' "$BODY" | ${digest})`,
        `curl -X POST ${shellQuote(url)} \\\n  ${json} \\\n  -H "${auth.headerName}: ${auth.prefix}$SIG" \\\n  --data-binary "$BODY"`,
      ].join('\n');
    }
  }
}

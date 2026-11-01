import type { DiscordMessage } from '@send-any-webhook/shared';

export interface DiscordResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  /** From a 429 response: how long Discord asks us to wait. */
  retryAfterMs?: number;
}

/** Throws on network errors and timeouts; returns any HTTP response. */
export type DiscordSender = (webhookUrl: string, message: DiscordMessage) => Promise<DiscordResponse>;

const KEPT_HEADERS = /^(content-type|retry-after|x-ratelimit-.*|via|cf-ray|date)$/i;

export const sendToDiscord: DiscordSender = async (webhookUrl, message) => {
  const url = new URL(webhookUrl);
  url.searchParams.set('wait', 'true');
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': 'SendAnyWebhook/0.1' },
    // Payload text must never ping @everyone/@here or roles
    body: JSON.stringify({ ...message, allowed_mentions: { parse: [] } }),
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await res.text()).slice(0, 10_000);
  const headers: Record<string, string> = {};
  res.headers.forEach((v, k) => {
    if (KEPT_HEADERS.test(k)) headers[k] = v;
  });
  let retryAfterMs: number | undefined;
  if (res.status === 429) {
    let seconds = Number(res.headers.get('retry-after'));
    try {
      const json = JSON.parse(body) as { retry_after?: number };
      if (typeof json.retry_after === 'number') seconds = json.retry_after;
    } catch {
      // keep header value
    }
    retryAfterMs = Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds * 1000) : 5000;
  }
  return { status: res.status, headers, body, ...(retryAfterMs !== undefined && { retryAfterMs }) };
};

/** `https://discord.com/api/webhooks/1234…/abcd…wxyz` for display; never return the token. */
export function maskWebhookUrl(url: string): string {
  const m = /^(https:\/\/[^/]+\/api(?:\/v\d+)?\/webhooks\/)(\d+)\/([\w-]+)$/.exec(url);
  if (!m) return 'https://discord.com/api/webhooks/…';
  const [, base, id, token] = m;
  return `${base}${id}/${token!.slice(0, 4)}…${token!.slice(-4)}`;
}

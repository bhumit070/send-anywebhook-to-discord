/** Hard limits enforced by the Discord webhook API. */
export const DISCORD_LIMITS = {
  content: 2000,
  username: 80,
  embeds: 10,
  embedTitle: 256,
  embedDescription: 4096,
  embedFields: 25,
  fieldName: 256,
  fieldValue: 1024,
  footerText: 2048,
  authorName: 256,
  embedsTotalChars: 6000,
} as const;

export interface DiscordEmbed {
  title?: string;
  url?: string;
  description?: string;
  color?: number;
  timestamp?: string;
  author?: { name: string; url?: string; icon_url?: string };
  thumbnail?: { url: string };
  image?: { url: string };
  footer?: { text: string; icon_url?: string };
  fields?: { name: string; value: string; inline?: boolean }[];
}

/** The JSON body POSTed to a Discord webhook. */
export interface DiscordMessage {
  content?: string;
  username?: string;
  avatar_url?: string;
  embeds?: DiscordEmbed[];
}

const WEBHOOK_URL = /^https:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/api(?:\/v\d+)?\/webhooks\/\d+\/[\w-]+$/;

/** Only real Discord webhook URLs are accepted, so the server can't be pointed at arbitrary hosts. */
export function isDiscordWebhookUrl(url: string): boolean {
  return WEBHOOK_URL.test(url.trim());
}

export const NAMED_COLORS: Record<string, number> = {
  blurple: 0x5865f2,
  red: 0xed4245,
  orange: 0xf0b232,
  yellow: 0xfee75c,
  green: 0x57f287,
  teal: 0x1abc9c,
  blue: 0x3498db,
  purple: 0x9b59b6,
  pink: 0xeb459e,
  grey: 0x95a5a6,
  gray: 0x95a5a6,
  black: 0x23272a,
  white: 0xffffff,
};

/** Accepts `#rgb`, `#rrggbb`, `0xrrggbb`, a decimal integer or a color name. */
export function parseColor(input: string): number | null {
  const s = input.trim().toLowerCase();
  if (!s) return null;
  if (s in NAMED_COLORS) return NAMED_COLORS[s]!;
  let m = /^#([0-9a-f]{3})$/.exec(s);
  if (m) return parseInt(m[1]!.replace(/./g, (c) => c + c), 16);
  m = /^(?:#|0x)([0-9a-f]{6})$/.exec(s);
  if (m) return parseInt(m[1]!, 16);
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    return n <= 0xffffff ? n : null;
  }
  return null;
}

/** Accepts ISO dates and unix timestamps (seconds or milliseconds). */
export function parseDate(input: unknown): Date | null {
  if (input instanceof Date) return Number.isNaN(input.getTime()) ? null : input;
  let value = input;
  if (typeof value === 'string' && /^\d+(\.\d+)?$/.test(value.trim())) value = Number(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    return new Date(value < 1e12 ? value * 1000 : value);
  }
  if (typeof value === 'string' && value.trim()) {
    const d = new Date(value.trim());
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

export function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

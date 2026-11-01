import { isHttpUrl, parseDate } from './discord.js';
import { extractPaths, flattenPaths, getAtPath } from './paths.js';
import type { EmbedTemplate, MessageTemplate } from './template.js';

export type DateStyle = 'relative' | 'short' | 'long' | 'date' | 'time';

export interface Format {
  /** For arrays of objects: take this key from each item. */
  pluck?: string;
  /** For arrays: join items with this separator. */
  join?: string;
  boolEmoji?: boolean;
  number?: boolean;
  /** Render as a Discord timestamp tag (shown in each viewer's timezone). */
  date?: DateStyle;
  case?: 'upper' | 'lower' | 'title';
  truncate?: number;
  /** Used when the value is missing or empty. */
  fallback?: string;
}

export type Source =
  | { kind: 'empty' }
  | { kind: 'static'; value: string }
  | { kind: 'field'; path: string; format?: Format }
  | { kind: 'template'; value: string }
  | { kind: 'valueMap'; path: string; cases: { when: string; then: string }[]; fallback?: string };

export interface MappingField {
  name: Source;
  value: Source;
  inline: boolean;
}

export interface MappingEmbed {
  title: Source;
  url: Source;
  description: Source;
  color: Source;
  authorName: Source;
  authorUrl: Source;
  authorIcon: Source;
  thumbnail: Source;
  image: Source;
  footerText: Source;
  footerIcon: Source;
  timestamp: Source;
  fields: MappingField[];
  /** One field per item of an array; `nameKey`/`valueKey` are keys of each item ('' = the item itself). */
  fieldsFromArray: { path: string; nameKey: string; valueKey: string; inline: boolean } | null;
}

export interface Mapping {
  version: 1;
  username: Source;
  avatarUrl: Source;
  content: Source;
  embeds: MappingEmbed[];
}

export const EMBED_SLOTS = [
  'title',
  'url',
  'description',
  'color',
  'authorName',
  'authorUrl',
  'authorIcon',
  'thumbnail',
  'image',
  'footerText',
  'footerIcon',
  'timestamp',
] as const;
export type EmbedSlot = (typeof EMBED_SLOTS)[number];

/** Render-warning slot name for each mapper slot (matches renderMessage's slot names). */
export const EMBED_SLOT_KEYS: Record<EmbedSlot, string> = {
  title: 'title',
  url: 'url',
  description: 'description',
  color: 'color',
  authorName: 'author.name',
  authorUrl: 'author.url',
  authorIcon: 'author.icon_url',
  thumbnail: 'thumbnail.url',
  image: 'image.url',
  footerText: 'footer.text',
  footerIcon: 'footer.icon_url',
  timestamp: 'timestamp',
};

const EMPTY: Source = { kind: 'empty' };

export function emptyEmbed(): MappingEmbed {
  return {
    title: EMPTY,
    url: EMPTY,
    description: EMPTY,
    color: EMPTY,
    authorName: EMPTY,
    authorUrl: EMPTY,
    authorIcon: EMPTY,
    thumbnail: EMPTY,
    image: EMPTY,
    footerText: EMPTY,
    footerIcon: EMPTY,
    timestamp: EMPTY,
    fields: [],
    fieldsFromArray: null,
  };
}

export function emptyMapping(): Mapping {
  return { version: 1, username: EMPTY, avatarUrl: EMPTY, content: EMPTY, embeds: [emptyEmbed()] };
}

// ---------- compile ----------

const literal = (s: string) => (/[{}]/.test(s) ? `{% raw %}${s}{% endraw %}` : s);
const quote = (s: string) => JSON.stringify(s);

const DATE_STYLE: Record<DateStyle, string> = { relative: 'R', short: 'f', long: 'F', date: 'D', time: 't' };

function compileFormat(path: string, f: Format = {}): string {
  const filters: string[] = [];
  if (f.pluck) filters.push(`map: ${quote(f.pluck)}`);
  if (f.join !== undefined) filters.push(`join: ${quote(f.join)}`);
  if (f.boolEmoji) filters.push('bool_emoji');
  if (f.number) filters.push('number_format');
  if (f.date) filters.push(`discord_time: ${quote(DATE_STYLE[f.date])}`);
  filters.push('to_text');
  if (f.case === 'upper') filters.push('upcase');
  if (f.case === 'lower') filters.push('downcase');
  if (f.case === 'title') filters.push('title_case');
  if (f.truncate && f.truncate > 0) filters.push(`truncate: ${Math.floor(f.truncate)}`);
  if (f.fallback) filters.push(`default: ${quote(f.fallback)}`);
  return `{{ ${path} | ${filters.join(' | ')} }}`;
}

export function compileSource(src: Source): string {
  switch (src.kind) {
    case 'empty':
      return '';
    case 'static':
      return literal(src.value);
    case 'template':
      return src.value;
    case 'field':
      return src.path ? compileFormat(src.path, src.format) : '';
    case 'valueMap': {
      if (!src.path) return src.fallback ? literal(src.fallback) : '';
      const whens = src.cases
        .filter((c) => c.when !== '')
        .map((c) => `{% when ${quote(c.when)} %}${literal(c.then)}`)
        .join('');
      const otherwise = src.fallback ? `{% else %}${literal(src.fallback)}` : '';
      return `{% assign hc_value = ${src.path} | to_text %}{% case hc_value %}${whens}${otherwise}{% endcase %}`;
    }
  }
}

function compact<T extends object>(obj: T): T | undefined {
  const out = Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && v !== ''));
  return Object.keys(out).length ? (out as T) : undefined;
}

function compileEmbed(e: MappingEmbed): EmbedTemplate {
  const s = (src: Source) => compileSource(src) || undefined;
  const itemExpr = (key: string) => (key ? `{{ item[${quote(key)}] | to_text }}` : '{{ item | to_text }}');
  return compact({
    title: s(e.title),
    url: s(e.url),
    description: s(e.description),
    color: s(e.color),
    timestamp: s(e.timestamp),
    author: compact({ name: s(e.authorName), url: s(e.authorUrl), icon_url: s(e.authorIcon) }),
    thumbnail: compact({ url: s(e.thumbnail) }),
    image: compact({ url: s(e.image) }),
    footer: compact({ text: s(e.footerText), icon_url: s(e.footerIcon) }),
    fields: e.fields.length
      ? e.fields.map((f) => ({ name: compileSource(f.name), value: compileSource(f.value), inline: f.inline }))
      : undefined,
    fields_each:
      e.fieldsFromArray && e.fieldsFromArray.path
        ? {
            path: e.fieldsFromArray.path,
            name: itemExpr(e.fieldsFromArray.nameKey),
            value: itemExpr(e.fieldsFromArray.valueKey),
            inline: e.fieldsFromArray.inline,
          }
        : undefined,
  }) ?? {};
}

/** Turns the visual mapping into the Liquid message template the worker renders. */
export function compileMapping(m: Mapping): MessageTemplate {
  return (
    compact({
      username: compileSource(m.username) || undefined,
      avatar_url: compileSource(m.avatarUrl) || undefined,
      content: compileSource(m.content) || undefined,
      embeds: m.embeds.length ? m.embeds.map(compileEmbed) : undefined,
    }) ?? {}
  );
}

// ---------- auto-map ----------

export function humanize(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_\-.]+/g, ' ')
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

interface Leaf {
  path: string;
  key: string;
  value: unknown;
  depth: number;
  parentKey: string;
}

function leaves(sample: unknown): Leaf[] {
  const out: Leaf[] = [];
  const nodes = flattenPaths(extractPaths(sample));
  for (const n of nodes) {
    if (n.type === 'object') continue;
    if (n.path.includes('[') && n.type !== 'array') continue; // inside arrays
    const parts = n.path.split('.');
    out.push({
      path: n.path,
      key: n.key.toLowerCase(),
      value: getAtPath(scopeFor(sample), n.path),
      depth: parts.length,
      parentKey: (parts.at(-2) ?? '').toLowerCase(),
    });
  }
  return out;
}

function scopeFor(sample: unknown): unknown {
  return Array.isArray(sample) ? { payload: sample } : sample;
}

const ACTOR_PARENTS = ['user', 'sender', 'author', 'doer', 'actor', 'owner', 'creator', 'created_by', 'committer', 'pusher'];
const ACTOR_KEYS = ['name', 'display_name', 'displayname', 'username', 'login', 'full_name'];

function pick(ls: Leaf[], used: Set<string>, keys: string[], test: (l: Leaf) => boolean = () => true): Leaf | undefined {
  for (const k of keys) {
    const found = ls
      .filter((l) => l.key === k && !used.has(l.path) && test(l))
      .sort((a, b) => a.depth - b.depth)[0];
    if (found) {
      used.add(found.path);
      return found;
    }
  }
  return undefined;
}

const isStr = (l: Leaf) => typeof l.value === 'string' && l.value !== '';
const isUrl = (l: Leaf) => typeof l.value === 'string' && isHttpUrl(l.value);
const isDateLike = (l: Leaf) =>
  (typeof l.value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(l.value) && parseDate(l.value) !== null) ||
  (typeof l.value === 'number' && l.value > 1e9);

/** A first-guess mapping from field names and value types. The user adjusts it in the editor. */
export function autoMap(sample: unknown): Mapping {
  const ls = leaves(sample);
  const used = new Set<string>();
  const field = (l: Leaf | undefined, format?: Format): Source =>
    l ? { kind: 'field', path: l.path, ...(format && { format }) } : EMPTY;

  const title =
    pick(ls, used, ['title', 'subject', 'summary', 'name', 'headline'], isStr) ??
    pick(ls, used, ['event_name', 'event', 'action', 'type', 'event_type'], isStr);
  const description = pick(ls, used, ['description', 'body', 'message', 'text', 'content', 'details', 'summary'], isStr);
  const url = pick(ls, used, ['html_url', 'url', 'web_url', 'link', 'href', 'permalink'], isUrl);
  const timestamp = pick(
    ls,
    used,
    ['timestamp', 'created_at', 'createdat', 'created', 'time', 'date', 'occurred_at', 'updated_at', 'updatedat'],
    isDateLike,
  );
  const authorName = pick(ls, used, ACTOR_KEYS, (l) => isStr(l) && ACTOR_PARENTS.includes(l.parentKey));
  const authorIcon = pick(
    ls,
    used,
    ['avatar_url', 'avatar', 'avatarurl', 'icon_url', 'image'],
    (l) => isUrl(l) && ACTOR_PARENTS.includes(l.parentKey),
  );

  const fields: MappingField[] = ls
    .filter((l) => !used.has(l.path) && l.depth <= 3)
    .filter((l) => {
      if (Array.isArray(l.value)) return l.value.length > 0 && l.value.every((v) => ['string', 'number'].includes(typeof v));
      if (typeof l.value === 'number' || typeof l.value === 'boolean') return !/(^|_)id$/.test(l.key);
      return typeof l.value === 'string' && l.value !== '' && l.value.length <= 80 && !isHttpUrl(l.value) && !/(^|_)id$/.test(l.key);
    })
    .slice(0, 6)
    .map((l) => ({
      name: { kind: 'static', value: humanize(l.key) },
      value: field(l, {
        ...(Array.isArray(l.value) && { join: ', ' }),
        ...(typeof l.value === 'boolean' && { boolEmoji: true }),
        ...(isDateLike(l) && { date: 'short' as const }),
        fallback: '—',
      }),
      inline: true,
    }));

  return {
    version: 1,
    username: EMPTY,
    avatarUrl: EMPTY,
    content: EMPTY,
    embeds: [
      {
        ...emptyEmbed(),
        title: title ? field(title, { truncate: 256 }) : { kind: 'static', value: 'New webhook event' },
        url: field(url),
        description: field(description, { truncate: 4096 }),
        color: { kind: 'static', value: '#5865F2' },
        authorName: field(authorName),
        authorIcon: field(authorIcon),
        timestamp: field(timestamp),
        footerText: { kind: 'template', value: '{{ relay.name }}' },
        fields,
      },
    ],
  };
}

/** Paths a mapping reads; used to warn about fields missing from a payload. */
export function mappingPaths(m: Mapping): string[] {
  const paths: string[] = [];
  const add = (s: Source) => {
    if (s.kind === 'field' || s.kind === 'valueMap') paths.push(s.path);
  };
  [m.username, m.avatarUrl, m.content].forEach(add);
  for (const e of m.embeds) {
    EMBED_SLOTS.forEach((slot) => add(e[slot]));
    e.fields.forEach((f) => (add(f.name), add(f.value)));
    if (e.fieldsFromArray) paths.push(e.fieldsFromArray.path);
  }
  return paths.filter(Boolean);
}


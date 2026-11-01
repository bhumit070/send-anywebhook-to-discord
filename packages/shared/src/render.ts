import { Liquid, type Template } from 'liquidjs';
import {
  DISCORD_LIMITS as L,
  isHttpUrl,
  parseColor,
  parseDate,
  type DiscordEmbed,
  type DiscordMessage,
} from './discord.js';
import { getAtPath, isPlainObject } from './paths.js';
import type { EmbedTemplate, MessageTemplate } from './template.js';

export interface RenderWarning {
  /** Where the problem is: `content`, `embeds[0].title`, `embeds[0].fields[2].value`… */
  slot: string;
  message: string;
}

export interface RenderResult {
  /** The Discord body to send; null when rendering failed. */
  message: DiscordMessage | null;
  warnings: RenderWarning[];
  /** A fatal problem (template syntax error, empty message). The worker marks the row dead. */
  error: string | null;
}

export interface RenderContext {
  payload: unknown;
  relay?: { name: string };
}

export function toText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map(toText).filter(Boolean).join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function createEngine(): Liquid {
  const engine = new Liquid({
    // An empty in-memory file system: {% render %}, {% include %} and {% layout %}
    // must never read files from the server.
    templates: {},
    ownPropertyOnly: true,
    strictFilters: true,
    // Templates are user-written and run on the server: cap the work one render may do.
    parseLimit: 100_000,
    renderLimit: 500,
    memoryLimit: 10_000_000,
  });
  engine.registerFilter('to_text', toText);
  engine.registerFilter('bool_emoji', (v: unknown) => {
    if (v === true || v === 'true') return '✅';
    if (v === false || v === 'false') return '❌';
    return v;
  });
  engine.registerFilter('number_format', (v: unknown) => {
    const n = typeof v === 'string' ? Number(v) : v;
    return typeof n === 'number' && Number.isFinite(n) ? new Intl.NumberFormat('en-US').format(n) : v;
  });
  engine.registerFilter('discord_time', (v: unknown, style: unknown = 'f') => {
    const d = parseDate(v);
    return d ? `<t:${Math.floor(d.getTime() / 1000)}:${String(style)}>` : v;
  });
  engine.registerFilter('title_case', (v: unknown) =>
    toText(v).replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()),
  );
  return engine;
}

const parsed = new WeakMap<Liquid, Map<string, Template[]>>();

function parse(engine: Liquid, source: string): Template[] {
  let cache = parsed.get(engine);
  if (!cache) parsed.set(engine, (cache = new Map()));
  let t = cache.get(source);
  if (!t) {
    t = engine.parse(source);
    if (cache.size > 1000) cache.clear();
    cache.set(source, t);
  }
  return t;
}

export function buildScope(ctx: RenderContext): Record<string, unknown> {
  const base = isPlainObject(ctx.payload) ? { ...ctx.payload } : {};
  // Payload keys win over `relay` and `payload` so paths taken from the sample always resolve.
  return { relay: ctx.relay ?? { name: 'Relay' }, payload: ctx.payload, ...base };
}

class FatalRender extends Error {}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message.split('\n')[0]! : String(err);
}

/** Renders one Liquid string; missing variables become warnings, syntax errors are fatal. */
function renderString(
  engine: Liquid,
  source: string | undefined,
  scope: Record<string, unknown>,
  slot: string,
  warnings: RenderWarning[],
): string {
  if (!source) return '';
  let templates: Template[];
  try {
    templates = parse(engine, source);
  } catch (err) {
    throw new FatalRender(`${slot}: ${errorMessage(err)}`);
  }
  try {
    return String(engine.renderSync(templates, scope, { strictVariables: true })).trim();
  } catch (err) {
    if (!(err instanceof Error) || !/undefined variable/i.test(err.message)) {
      throw new FatalRender(`${slot}: ${errorMessage(err)}`);
    }
    const variable = /undefined variable: ([^,\s]+)/i.exec(err.message)?.[1];
    warnings.push({ slot, message: `${variable ? `"${variable}"` : 'A field'} is missing in this payload` });
  }
  try {
    return String(engine.renderSync(templates, scope)).trim();
  } catch (err) {
    throw new FatalRender(`${slot}: ${errorMessage(err)}`);
  }
}

function limit(value: string, max: number, slot: string, warnings: RenderWarning[]): string {
  if (value.length <= max) return value;
  warnings.push({ slot, message: `Cut to Discord's limit of ${max} characters (was ${value.length})` });
  return `${value.slice(0, max - 1)}…`;
}

function url(value: string, slot: string, warnings: RenderWarning[]): string | undefined {
  if (!value) return undefined;
  if (isHttpUrl(value)) return value;
  warnings.push({ slot, message: `"${value.slice(0, 80)}" is not a valid http(s) URL; left out (Discord would reject it)` });
  return undefined;
}

function embedChars(e: DiscordEmbed): number {
  return (
    (e.title?.length ?? 0) +
    (e.description?.length ?? 0) +
    (e.author?.name.length ?? 0) +
    (e.footer?.text.length ?? 0) +
    (e.fields ?? []).reduce((n, f) => n + f.name.length + f.value.length, 0)
  );
}

function renderEmbed(
  engine: Liquid,
  t: EmbedTemplate,
  scope: Record<string, unknown>,
  p: string,
  w: RenderWarning[],
): DiscordEmbed | null {
  const r = (src: string | undefined, slot: string) => renderString(engine, src, scope, `${p}.${slot}`, w);
  const e: DiscordEmbed = {};

  const title = r(t.title, 'title');
  if (title) e.title = limit(title, L.embedTitle, `${p}.title`, w);
  const link = url(r(t.url, 'url'), `${p}.url`, w);
  if (link) e.url = link;
  const description = r(t.description, 'description');
  if (description) e.description = limit(description, L.embedDescription, `${p}.description`, w);

  const colorText = r(t.color, 'color');
  if (colorText) {
    const color = parseColor(colorText);
    if (color === null) w.push({ slot: `${p}.color`, message: `"${colorText}" is not a color; left out` });
    else e.color = color;
  }

  const tsText = r(t.timestamp, 'timestamp');
  if (tsText) {
    const d = parseDate(tsText);
    if (!d) w.push({ slot: `${p}.timestamp`, message: `"${tsText}" is not a date; left out` });
    else e.timestamp = d.toISOString();
  }

  const authorName = r(t.author?.name, 'author.name');
  const authorUrl = url(r(t.author?.url, 'author.url'), `${p}.author.url`, w);
  const authorIcon = url(r(t.author?.icon_url, 'author.icon_url'), `${p}.author.icon_url`, w);
  if (authorName) {
    e.author = { name: limit(authorName, L.authorName, `${p}.author.name`, w) };
    if (authorUrl) e.author.url = authorUrl;
    if (authorIcon) e.author.icon_url = authorIcon;
  } else if (authorUrl || authorIcon) {
    w.push({ slot: `${p}.author.name`, message: 'Author needs a name; author left out' });
  }

  const thumb = url(r(t.thumbnail?.url, 'thumbnail.url'), `${p}.thumbnail.url`, w);
  if (thumb) e.thumbnail = { url: thumb };
  const image = url(r(t.image?.url, 'image.url'), `${p}.image.url`, w);
  if (image) e.image = { url: image };

  const footerText = r(t.footer?.text, 'footer.text');
  const footerIcon = url(r(t.footer?.icon_url, 'footer.icon_url'), `${p}.footer.icon_url`, w);
  if (footerText) {
    e.footer = { text: limit(footerText, L.footerText, `${p}.footer.text`, w) };
    if (footerIcon) e.footer.icon_url = footerIcon;
  } else if (footerIcon) {
    w.push({ slot: `${p}.footer.text`, message: 'Footer icon needs footer text; footer left out' });
  }

  const fields: NonNullable<DiscordEmbed['fields']> = [];
  const addField = (name: string, value: string, inline: boolean | undefined, slot: string) => {
    if (!name && !value) return;
    fields.push({
      // Discord rejects empty names/values; a zero-width space renders as blank.
      name: limit(name || '​', L.fieldName, `${slot}.name`, w),
      value: limit(value || '​', L.fieldValue, `${slot}.value`, w),
      ...(inline && { inline: true }),
    });
  };
  (t.fields ?? []).forEach((f, i) => {
    const slot = `${p}.fields[${i}]`;
    addField(
      renderString(engine, f.name, scope, `${slot}.name`, w),
      renderString(engine, f.value, scope, `${slot}.value`, w),
      f.inline,
      slot,
    );
  });
  if (t.fields_each?.path) {
    const each = t.fields_each;
    const items = getAtPath(scope, each.path);
    if (!Array.isArray(items)) {
      w.push({ slot: `${p}.fields_each`, message: `"${each.path}" is not a list in this payload` });
    } else {
      // Render only what can be sent: a huge list must not block the process
      const room = Math.max(0, L.embedFields - fields.length);
      items.slice(0, room).forEach((item, i) => {
        const itemScope = { ...scope, item };
        const slot = `${p}.fields_each[${i}]`;
        addField(
          renderString(engine, each.name, itemScope, `${slot}.name`, w),
          renderString(engine, each.value, itemScope, `${slot}.value`, w),
          each.inline,
          slot,
        );
      });
      if (items.length > room) {
        w.push({ slot: `${p}.fields_each`, message: `Discord allows ${L.embedFields} fields; ${items.length - room} list item(s) left out` });
      }
    }
  }
  if (fields.length > L.embedFields) {
    w.push({ slot: `${p}.fields`, message: `Discord allows ${L.embedFields} fields; ${fields.length - L.embedFields} left out` });
    fields.length = L.embedFields;
  }
  if (fields.length) e.fields = fields;

  if (!e.title && !e.description && !e.fields && !e.author && !e.footer && !e.image && !e.thumbnail) {
    w.push({ slot: p, message: 'Embed is empty for this payload; left out' });
    return null;
  }
  return e;
}

function enforceTotal(embeds: DiscordEmbed[], w: RenderWarning[]) {
  let total = embeds.reduce((n, e) => n + embedChars(e), 0);
  if (total <= L.embedsTotalChars) return;
  w.push({ slot: 'embeds', message: `Embeds total ${total} characters; Discord allows ${L.embedsTotalChars}. Trimmed from the end.` });
  const over = () => total - L.embedsTotalChars;
  /** Shortens text by what is still over the limit (at least to `min` characters); returns the new text. */
  const shorten = (text: string, min: number) => {
    const keep = Math.max(min, text.length - over() - 1);
    if (keep >= text.length) return text;
    total -= text.length - (keep + 1);
    return `${text.slice(0, keep)}…`;
  };
  for (let i = embeds.length - 1; i >= 0 && over() > 0; i--) {
    const e = embeds[i]!;
    while (e.fields?.length && over() > 0) {
      const f = e.fields.pop()!;
      total -= f.name.length + f.value.length;
    }
    if (!e.fields?.length) delete e.fields;
    if (e.description && over() > 0) e.description = shorten(e.description, 0);
    if (e.footer && over() > 0) e.footer.text = shorten(e.footer.text, 1);
    if (e.title && over() > 0) e.title = shorten(e.title, 1);
    if (e.author && over() > 0) e.author.name = shorten(e.author.name, 1);
  }
  // Still over (many embeds of short parts): drop whole embeds from the end
  while (over() > 0 && embeds.length > 1) total -= embedChars(embeds.pop()!);
}

/** Renders a message template against a payload and applies every Discord limit. */
export function renderMessage(engine: Liquid, tpl: MessageTemplate, ctx: RenderContext): RenderResult {
  const warnings: RenderWarning[] = [];
  const scope = buildScope(ctx);
  try {
    const msg: DiscordMessage = {};
    const username = renderString(engine, tpl.username, scope, 'username', warnings);
    if (username) {
      if (/discord|clyde/i.test(username)) {
        warnings.push({ slot: 'username', message: 'Discord rejects names containing "discord" or "clyde"; left out' });
      } else msg.username = limit(username, L.username, 'username', warnings);
    }
    const avatar = url(renderString(engine, tpl.avatar_url, scope, 'avatar_url', warnings), 'avatar_url', warnings);
    if (avatar) msg.avatar_url = avatar;
    const content = renderString(engine, tpl.content, scope, 'content', warnings);
    if (content) msg.content = limit(content, L.content, 'content', warnings);

    const templates = tpl.embeds ?? [];
    if (templates.length > L.embeds) {
      warnings.push({ slot: 'embeds', message: `Discord allows ${L.embeds} embeds; extra ones left out` });
    }
    const embeds = templates
      .slice(0, L.embeds)
      .map((t, i) => renderEmbed(engine, t, scope, `embeds[${i}]`, warnings))
      .filter((e): e is DiscordEmbed => e !== null);
    enforceTotal(embeds, warnings);
    if (embeds.length) msg.embeds = embeds;

    if (!msg.content && !msg.embeds) {
      return { message: null, warnings, error: 'The message is empty for this payload (no content and no embeds). Discord rejects empty messages.' };
    }
    return { message: msg, warnings, error: null };
  } catch (err) {
    if (err instanceof FatalRender) return { message: null, warnings, error: err.message };
    throw err;
  }
}

/** True when a template's condition matches (no condition = always). Throws on a syntax error. */
export function matchesCondition(engine: Liquid, condition: string | null | undefined, ctx: RenderContext): boolean {
  if (!condition || !condition.trim()) return true;
  const out = engine.renderSync(parse(engine, `{% if ${condition} %}1{% endif %}`), buildScope(ctx));
  return String(out).trim() === '1';
}

/** Checks a condition compiles; returns the error message or null. */
export function conditionError(engine: Liquid, condition: string): string | null {
  try {
    parse(engine, `{% if ${condition} %}1{% endif %}`);
    return null;
  } catch (err) {
    return errorMessage(err);
  }
}

/** Checks every string in a message template parses; returns the first error or null. */
export function templateError(engine: Liquid, tpl: MessageTemplate): string | null {
  const check = (v: unknown, slot: string): string | null => {
    if (typeof v === 'string') {
      try {
        parse(engine, v);
        return null;
      } catch (err) {
        return `${slot}: ${errorMessage(err)}`;
      }
    }
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) {
        const e = check(v[i], `${slot}[${i}]`);
        if (e) return e;
      }
    } else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        if (k === 'path' || k === 'inline') continue;
        const e = check(x, slot ? `${slot}.${k}` : k);
        if (e) return e;
      }
    }
    return null;
  };
  return check(tpl, '');
}

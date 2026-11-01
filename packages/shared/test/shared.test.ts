import { describe, expect, it } from 'vitest';
import {
  autoMap,
  compileMapping,
  createEngine,
  emptyEmbed,
  emptyMapping,
  extractPaths,
  flattenPaths,
  getAtPath,
  isDiscordWebhookUrl,
  matchesCondition,
  parseColor,
  renderMessage,
  sampleFromSchema,
  type Mapping,
} from '../src/index.js';

// Synthetic Vikunja-style payload
const vikunja = {
  event_name: 'task.created',
  time: '2026-11-01T10:42:00Z',
  data: {
    task: {
      id: 42,
      title: 'Fix login bug',
      description: 'Users cannot log in after the password reset.',
      done: false,
      priority: 3,
      due_date: '2026-11-03T00:00:00Z',
      labels: [{ title: 'bug' }, { title: 'auth' }],
      url: 'https://tasks.example.com/tasks/42',
    },
    doer: { name: 'Jane Doe', username: 'jane', avatar_url: 'https://example.com/a.png' },
    'project-name': 'Backend',
  },
};

const engine = createEngine();
const render = (m: Mapping, payload: unknown = vikunja) =>
  renderMessage(engine, compileMapping(m), { payload, relay: { name: 'Vikunja' } });

describe('paths', () => {
  it('extracts nested, array and non-identifier paths', () => {
    const paths = flattenPaths(extractPaths(vikunja)).map((n) => n.path);
    expect(paths).toContain('data.task.title');
    expect(paths).toContain('data.task.labels[0].title');
    expect(paths).toContain('data["project-name"]');
  });

  it('reads values back by path', () => {
    expect(getAtPath(vikunja, 'data.task.labels[1].title')).toBe('auth');
    expect(getAtPath(vikunja, 'data["project-name"]')).toBe('Backend');
    expect(getAtPath(vikunja, 'data.nope.x')).toBeUndefined();
    expect(getAtPath(vikunja, 'constructor')).toBeUndefined();
  });
});

describe('compile + render', () => {
  it('renders fields, formats and value maps', () => {
    const m = emptyMapping();
    m.content = { kind: 'template', value: 'New task in **{{ data["project-name"] }}**' };
    m.embeds[0] = {
      ...emptyEmbed(),
      title: { kind: 'field', path: 'data.task.title', format: { case: 'upper' } },
      url: { kind: 'field', path: 'data.task.url' },
      color: {
        kind: 'valueMap',
        path: 'data.task.priority',
        cases: [
          { when: '1', then: 'grey' },
          { when: '3', then: 'orange' },
        ],
        fallback: 'blue',
      },
      timestamp: { kind: 'field', path: 'time' },
      authorName: { kind: 'field', path: 'data.doer.name' },
      fields: [
        { name: { kind: 'static', value: 'Labels' }, value: { kind: 'field', path: 'data.task.labels', format: { pluck: 'title', join: ', ' } }, inline: true },
        { name: { kind: 'static', value: 'Done' }, value: { kind: 'field', path: 'data.task.done', format: { boolEmoji: true } }, inline: true },
        { name: { kind: 'static', value: 'Due' }, value: { kind: 'field', path: 'data.task.due_date', format: { date: 'relative' } }, inline: true },
      ],
    };
    const r = render(m);
    expect(r.error).toBeNull();
    expect(r.warnings).toEqual([]);
    expect(r.message).toEqual({
      content: 'New task in **Backend**',
      embeds: [
        {
          title: 'FIX LOGIN BUG',
          url: 'https://tasks.example.com/tasks/42',
          color: 0xf0b232,
          timestamp: '2026-11-01T10:42:00.000Z',
          author: { name: 'Jane Doe' },
          fields: [
            { name: 'Labels', value: 'bug, auth', inline: true },
            { name: 'Done', value: '❌', inline: true },
            { name: 'Due', value: `<t:${Date.parse('2026-11-03T00:00:00Z') / 1000}:R>`, inline: true },
          ],
        },
      ],
    });
  });

  it('keeps static text literal even with braces', () => {
    const m = emptyMapping();
    m.content = { kind: 'static', value: 'literal {{ data.task.title }}' };
    expect(render(m).message?.content).toBe('literal {{ data.task.title }}');
  });

  it('warns about missing fields and uses the fallback', () => {
    const m = emptyMapping();
    m.embeds[0]!.title = { kind: 'field', path: 'data.task.missing', format: { fallback: 'n/a' } };
    const r = render(m);
    expect(r.message?.embeds?.[0]?.title).toBe('n/a');
    expect(r.warnings).toEqual([expect.objectContaining({ slot: 'embeds[0].title', message: expect.stringContaining('missing') })]);
  });

  it('enforces Discord limits with warnings', () => {
    const m = emptyMapping();
    m.content = { kind: 'static', value: 'x'.repeat(2500) };
    m.embeds[0]!.description = { kind: 'static', value: 'y'.repeat(5000) };
    m.embeds[0]!.url = { kind: 'static', value: 'not a url' };
    const r = render(m);
    expect(r.message?.content).toHaveLength(2000);
    expect(r.message?.embeds?.[0]?.description).toHaveLength(4096);
    expect(r.message?.embeds?.[0]?.url).toBeUndefined();
    expect(r.warnings.map((w) => w.slot)).toEqual(['content', 'embeds[0].url', 'embeds[0].description']);
  });

  it('builds one field per array item', () => {
    const m = emptyMapping();
    m.embeds[0]!.title = { kind: 'static', value: 'Labels' };
    m.embeds[0]!.fieldsFromArray = { path: 'data.task.labels', nameKey: 'title', valueKey: '', inline: false };
    expect(render(m).message?.embeds?.[0]?.fields).toEqual([
      { name: 'bug', value: '{"title":"bug"}' },
      { name: 'auth', value: '{"title":"auth"}' },
    ]);
  });

  it('fails on an empty message and on syntax errors', () => {
    expect(render(emptyMapping()).error).toMatch(/empty/);
    const r = renderMessage(engine, { content: '{{ unclosed' }, { payload: vikunja });
    expect(r.message).toBeNull();
    expect(r.error).toMatch(/^content:/);
  });

  it('cannot reach prototype properties', () => {
    const r = renderMessage(engine, { content: '{{ data.constructor }}x' }, { payload: vikunja });
    expect(r.message?.content).toBe('x');
  });
});

describe('sandbox and limits (review fixes)', () => {
  it('cannot read files with render, include or layout', () => {
    for (const tag of ["{% render 'package.json' %}", "{% include 'package.json' %}", "{% layout 'package.json' %}x"]) {
      const r = renderMessage(engine, { content: tag }, { payload: {} });
      expect(r.message?.content ?? '').not.toContain('vitest');
      expect(r.error).not.toBeNull();
    }
    expect(() => matchesCondition(engine, "true %}{% render 'package.json' %}{% if true", { payload: {} })).toThrow();
  });

  it('renders only as many list items as Discord allows', () => {
    const items = Array.from({ length: 200_000 }, (_, i) => i);
    const started = Date.now();
    const r = renderMessage(
      engine,
      { embeds: [{ title: 't', fields_each: { path: 'items', name: '{{ item }}', value: 'v' } }] },
      { payload: { items } },
    );
    expect(Date.now() - started).toBeLessThan(1000);
    expect(r.message?.embeds?.[0]?.fields).toHaveLength(25);
    expect(r.warnings.some((w) => w.message.includes('199975 list item(s) left out'))).toBe(true);
  });

  it('keeps all embeds together under 6000 characters', () => {
    const embed = { title: 't'.repeat(256), footer: { text: 'f'.repeat(2048) }, author: { name: 'a'.repeat(256) } };
    const r = renderMessage(engine, { embeds: Array.from({ length: 10 }, () => embed) }, { payload: {} });
    const total = (r.message?.embeds ?? []).reduce(
      (n, e) => n + (e.title?.length ?? 0) + (e.footer?.text.length ?? 0) + (e.author?.name.length ?? 0) + (e.description?.length ?? 0),
      0,
    );
    expect(total).toBeLessThanOrEqual(6000);
    expect(r.message?.embeds?.length).toBeGreaterThan(0);
  });

  it('resolves a top-level key named "payload" like the field tree shows it', () => {
    const body = { payload: { action: 'opened' } };
    const paths = flattenPaths(extractPaths(body)).map((n) => n.path);
    expect(paths).toContain('payload.action');
    expect(renderMessage(engine, { content: '{{ payload.action }}' }, { payload: body }).message?.content).toBe('opened');
  });
});

describe('conditions', () => {
  it('matches Liquid conditions against the payload', () => {
    expect(matchesCondition(engine, 'event_name == "task.created"', { payload: vikunja })).toBe(true);
    expect(matchesCondition(engine, 'event_name == "task.done"', { payload: vikunja })).toBe(false);
    expect(matchesCondition(engine, null, { payload: vikunja })).toBe(true);
  });
});

describe('autoMap', () => {
  it('guesses a sensible embed', () => {
    const m = autoMap(vikunja);
    const e = m.embeds[0]!;
    expect(e.title).toMatchObject({ kind: 'field', path: 'data.task.title' });
    expect(e.description).toMatchObject({ kind: 'field', path: 'data.task.description' });
    expect(e.url).toMatchObject({ kind: 'field', path: 'data.task.url' });
    expect(e.timestamp).toMatchObject({ kind: 'field', path: 'time' });
    expect(e.authorName).toMatchObject({ kind: 'field', path: 'data.doer.name' });
    expect(e.authorIcon).toMatchObject({ kind: 'field', path: 'data.doer.avatar_url' });
    expect(e.fields.length).toBeGreaterThan(0);
    expect(render(m).error).toBeNull();
  });

  it('handles an array root and an empty object', () => {
    expect(render(autoMap([{ title: 'a' }]), [{ title: 'a' }]).error).toBeNull();
    expect(render(autoMap({}), {}).message?.embeds?.[0]?.title).toBe('New webhook event');
  });
});

describe('sampleFromSchema', () => {
  it('generates an example from a schema with refs', () => {
    const sample = sampleFromSchema({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {
        event: { enum: ['created', 'deleted'] },
        at: { type: 'string', format: 'date-time' },
        user: { $ref: '#/$defs/user' },
        tags: { type: 'array', items: { type: 'string' } },
      },
      $defs: { user: { type: 'object', properties: { name: { type: 'string', examples: ['Ann'] }, self: { $ref: '#/$defs/user' } } } },
    });
    expect(sample).toEqual({
      event: 'created',
      at: '2026-01-15T10:30:00Z',
      user: { name: 'Ann', self: null },
      tags: ['example tags'],
    });
  });
});

describe('discord helpers', () => {
  it('accepts only Discord webhook URLs', () => {
    expect(isDiscordWebhookUrl('https://discord.com/api/webhooks/123/abc-DEF_1')).toBe(true);
    expect(isDiscordWebhookUrl('https://canary.discord.com/api/v10/webhooks/123/abc')).toBe(true);
    expect(isDiscordWebhookUrl('https://evil.com/api/webhooks/123/abc')).toBe(false);
    expect(isDiscordWebhookUrl('https://discord.com.evil.com/api/webhooks/1/a')).toBe(false);
  });

  it('parses colors', () => {
    expect(parseColor('#fff')).toBe(0xffffff);
    expect(parseColor('0x5865F2')).toBe(0x5865f2);
    expect(parseColor('red')).toBe(0xed4245);
    expect(parseColor('nope')).toBeNull();
  });
});

type Schema = Record<string, unknown>;

const isObj = (v: unknown): v is Schema => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Builds an example payload from a JSON Schema so it can be mapped like a pasted example.
 * Uses `examples`/`example`/`default`/`const`/`enum` when present, otherwise a placeholder per type.
 */
export function sampleFromSchema(root: unknown): unknown {
  if (!isObj(root)) throw new Error('JSON Schema must be an object');

  const resolve = (s: Schema): Schema => {
    const ref = s.$ref;
    if (typeof ref !== 'string') return s;
    if (!ref.startsWith('#/')) return {}; // remote refs are not fetched
    let cur: unknown = root;
    for (const part of ref.slice(2).split('/')) {
      if (!isObj(cur)) return {};
      cur = cur[part.replace(/~1/g, '/').replace(/~0/g, '~')];
    }
    return isObj(cur) ? cur : {};
  };

  const gen = (input: unknown, key: string, depth: number, seen: Set<string>): unknown => {
    if (!isObj(input) || depth > 10) return null;
    const ref = typeof input.$ref === 'string' ? input.$ref : null;
    if (ref && seen.has(ref)) return null; // recursive schema
    const s = resolve(input);
    const nextSeen = ref ? new Set(seen).add(ref) : seen;

    if (Array.isArray(s.examples) && s.examples.length) return s.examples[0];
    if ('example' in s) return s.example;
    if ('const' in s) return s.const;
    if ('default' in s) return s.default;
    if (Array.isArray(s.enum) && s.enum.length) return s.enum[0];

    for (const k of ['oneOf', 'anyOf'] as const) {
      const list = s[k];
      if (Array.isArray(list) && list.length) {
        const nonNull = list.find((x) => !(isObj(x) && x.type === 'null')) ?? list[0];
        return gen(nonNull, key, depth + 1, nextSeen);
      }
    }
    if (Array.isArray(s.allOf)) {
      const merged: Record<string, unknown> = {};
      for (const part of s.allOf) {
        const v = gen(part, key, depth + 1, nextSeen);
        if (isObj(v)) Object.assign(merged, v);
      }
      return merged;
    }

    let type = s.type;
    if (Array.isArray(type)) type = type.find((t) => t !== 'null') ?? type[0];
    if (!type) type = isObj(s.properties) ? 'object' : s.items ? 'array' : 'string';

    switch (type) {
      case 'object': {
        const out: Record<string, unknown> = {};
        if (isObj(s.properties)) {
          for (const [k, v] of Object.entries(s.properties)) out[k] = gen(v, k, depth + 1, nextSeen);
        }
        return out;
      }
      case 'array': {
        const items = Array.isArray(s.items) ? s.items[0] : s.items;
        return items ? [gen(items, key, depth + 1, nextSeen)] : [];
      }
      case 'integer':
        return typeof s.minimum === 'number' ? Math.ceil(s.minimum) : 1;
      case 'number':
        return typeof s.minimum === 'number' ? s.minimum : 1.5;
      case 'boolean':
        return true;
      case 'null':
        return null;
      default:
        switch (s.format) {
          case 'date-time':
            return '2026-01-15T10:30:00Z';
          case 'date':
            return '2026-01-15';
          case 'email':
            return 'user@example.com';
          case 'uri':
          case 'url':
            return 'https://example.com';
          case 'uuid':
            return '00000000-0000-4000-8000-000000000000';
          default:
            return `example ${key || 'text'}`.trim();
        }
    }
  };

  return gen(root, '', 0, new Set());
}

/** Rough check: does this JSON look like a JSON Schema rather than an example payload? */
export function looksLikeJsonSchema(value: unknown): boolean {
  if (!isObj(value)) return false;
  if (typeof value.$schema === 'string') return true;
  return (value.type === 'object' && isObj(value.properties)) || typeof value.$ref === 'string';
}

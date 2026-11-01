export type JsonType = 'string' | 'number' | 'boolean' | 'null' | 'object' | 'array';

export interface FieldNode {
  key: string;
  /** Liquid expression that reads this value, e.g. `data.task.title` or `labels[0].name`. */
  path: string;
  type: JsonType;
  /** Short display of a scalar value. */
  preview?: string;
  children?: FieldNode[];
}

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function jsonType(value: unknown): JsonType {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return 'array';
  const t = typeof value;
  if (t === 'string' || t === 'number' || t === 'boolean') return t;
  return 'object';
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return jsonType(value) === 'object';
}

export function joinPath(parent: string, key: string | number): string {
  if (typeof key === 'number') return `${parent || 'payload'}[${key}]`;
  if (IDENT.test(key)) return parent ? `${parent}.${key}` : key;
  return `${parent || 'payload'}[${JSON.stringify(key)}]`;
}

function preview(value: unknown): string {
  const s = typeof value === 'string' ? JSON.stringify(value) : String(value);
  return s.length > 60 ? `${s.slice(0, 59)}…` : s;
}

/** Builds the field tree shown in the mapping editor. Arrays are described by their first item. */
export function extractPaths(root: unknown, maxDepth = 8): FieldNode[] {
  const walk = (value: unknown, path: string, depth: number): FieldNode[] | undefined => {
    if (depth > maxDepth) return undefined;
    if (Array.isArray(value)) {
      if (value.length === 0) return undefined;
      return [node(String(0), joinPath(path, 0), value[0], depth)];
    }
    if (isPlainObject(value)) {
      return Object.entries(value).map(([k, v]) => node(k, joinPath(path, k), v, depth));
    }
    return undefined;
  };
  const node = (key: string, path: string, value: unknown, depth: number): FieldNode => {
    const type = jsonType(value);
    const n: FieldNode = { key, path, type };
    if (type === 'object' || type === 'array') {
      const children = walk(value, path, depth + 1);
      if (children) n.children = children;
      if (type === 'array') n.preview = `${(value as unknown[]).length} item(s)`;
    } else {
      n.preview = preview(value);
    }
    return n;
  };
  if (Array.isArray(root)) return [node('payload', 'payload', root, 0)];
  return walk(root, '', 0) ?? [];
}

/** Flattens a field tree into a list (depth-first). */
export function flattenPaths(nodes: FieldNode[]): FieldNode[] {
  return nodes.flatMap((n) => [n, ...flattenPaths(n.children ?? [])]);
}

type Segment = string | number;

/** Parses the subset of Liquid paths `joinPath` produces: `a.b`, `a[0]`, `a["x-y"]`. */
export function parsePath(path: string): Segment[] | null {
  const segments: Segment[] = [];
  let i = 0;
  const readIdent = () => {
    const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(path.slice(i));
    if (!m) return null;
    i += m[0].length;
    return m[0];
  };
  const first = readIdent();
  if (first === null) return null;
  segments.push(first);
  while (i < path.length) {
    if (path[i] === '.') {
      i++;
      const id = readIdent();
      if (id === null) return null;
      segments.push(id);
    } else if (path[i] === '[') {
      const close = path.indexOf(']', i);
      if (close < 0) return null;
      const inner = path.slice(i + 1, close).trim();
      i = close + 1;
      if (/^\d+$/.test(inner)) segments.push(Number(inner));
      else if (/^"(?:[^"\\]|\\.)*"$/.test(inner) || /^'[^']*'$/.test(inner)) {
        segments.push(inner.startsWith('"') ? (JSON.parse(inner) as string) : inner.slice(1, -1));
      } else return null;
    } else return null;
  }
  return segments;
}

/** Reads a value from the render scope by Liquid path. Returns undefined when missing. */
export function getAtPath(scope: unknown, path: string): unknown {
  const segments = parsePath(path);
  if (!segments) return undefined;
  let cur: unknown = scope;
  for (const seg of segments) {
    if (cur === null || typeof cur !== 'object') return undefined;
    if (!Object.hasOwn(cur, seg)) return undefined;
    cur = (cur as Record<string | number, unknown>)[seg];
  }
  return cur;
}

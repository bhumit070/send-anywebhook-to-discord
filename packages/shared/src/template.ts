/**
 * A message template: the shape of a Discord message where every string is a Liquid template.
 * The visual mapper compiles to this; "Advanced" mode edits it directly; the worker renders it.
 */
export interface EmbedTemplate {
  title?: string;
  url?: string;
  description?: string;
  /** Renders to a color: `#5865F2`, `0x5865F2`, a decimal integer or a color name. */
  color?: string;
  /** Renders to an ISO date or unix timestamp. */
  timestamp?: string;
  author?: { name?: string; url?: string; icon_url?: string };
  thumbnail?: { url?: string };
  image?: { url?: string };
  footer?: { text?: string; icon_url?: string };
  fields?: { name: string; value: string; inline?: boolean }[];
  /** One embed field per item of the array at `path`; `name`/`value` are Liquid with `item` in scope. */
  fields_each?: { path: string; name: string; value: string; inline?: boolean };
}

export interface MessageTemplate {
  username?: string;
  avatar_url?: string;
  content?: string;
  embeds?: EmbedTemplate[];
}

import type { DiscordMessage } from '@send-any-webhook/shared';
import { Type, type Static } from 'typebox';

export const Uuid = Type.String({ format: 'uuid' });
/** Serialized as an ISO string; handlers may return Date objects. */
export const DateTime = Type.Unsafe<Date | string>({ type: 'string', format: 'date-time' });
export const IdParams = Type.Object({ id: Uuid });
export const ErrorResponse = Type.Object({ statusCode: Type.Number(), error: Type.String(), message: Type.String() });
export const OkResponse = Type.Object({ ok: Type.Literal(true) });

// ---------- message template / mapping (mirrors @send-any-webhook/shared types) ----------

const Str = (max = 10_000) => Type.String({ maxLength: max });

const EmbedTemplate = Type.Object(
  {
    title: Type.Optional(Str()),
    url: Type.Optional(Str()),
    description: Type.Optional(Str()),
    color: Type.Optional(Str()),
    timestamp: Type.Optional(Str()),
    author: Type.Optional(Type.Object({ name: Type.Optional(Str()), url: Type.Optional(Str()), icon_url: Type.Optional(Str()) })),
    thumbnail: Type.Optional(Type.Object({ url: Type.Optional(Str()) })),
    image: Type.Optional(Type.Object({ url: Type.Optional(Str()) })),
    footer: Type.Optional(Type.Object({ text: Type.Optional(Str()), icon_url: Type.Optional(Str()) })),
    fields: Type.Optional(
      Type.Array(Type.Object({ name: Str(), value: Str(), inline: Type.Optional(Type.Boolean()) }), { maxItems: 50 }),
    ),
    fields_each: Type.Optional(
      Type.Object({ path: Str(500), name: Str(), value: Str(), inline: Type.Optional(Type.Boolean()) }),
    ),
  },
  { additionalProperties: false },
);

export const MessageTemplate = Type.Object(
  {
    username: Type.Optional(Str()),
    avatar_url: Type.Optional(Str()),
    content: Type.Optional(Str()),
    embeds: Type.Optional(Type.Array(EmbedTemplate, { maxItems: 10 })),
  },
  { additionalProperties: false, description: 'Discord message where every string is a Liquid template' },
);

const Format = Type.Object(
  {
    pluck: Type.Optional(Str(200)),
    join: Type.Optional(Str(20)),
    boolEmoji: Type.Optional(Type.Boolean()),
    number: Type.Optional(Type.Boolean()),
    date: Type.Optional(Type.Enum(['relative', 'short', 'long', 'date', 'time'])),
    case: Type.Optional(Type.Enum(['upper', 'lower', 'title'])),
    truncate: Type.Optional(Type.Integer({ minimum: 1, maximum: 6000 })),
    fallback: Type.Optional(Str(1000)),
  },
  { additionalProperties: false },
);

const Source = Type.Union([
  Type.Object({ kind: Type.Literal('empty') }),
  Type.Object({ kind: Type.Literal('static'), value: Str() }),
  Type.Object({ kind: Type.Literal('field'), path: Str(500), format: Type.Optional(Format) }),
  Type.Object({ kind: Type.Literal('template'), value: Str() }),
  Type.Object({
    kind: Type.Literal('valueMap'),
    path: Str(500),
    cases: Type.Array(Type.Object({ when: Str(500), then: Str(1000) }), { maxItems: 50 }),
    fallback: Type.Optional(Str(1000)),
  }),
]);

const MappingEmbed = Type.Object({
  title: Source,
  url: Source,
  description: Source,
  color: Source,
  authorName: Source,
  authorUrl: Source,
  authorIcon: Source,
  thumbnail: Source,
  image: Source,
  footerText: Source,
  footerIcon: Source,
  timestamp: Source,
  fields: Type.Array(Type.Object({ name: Source, value: Source, inline: Type.Boolean() }), { maxItems: 25 }),
  fieldsFromArray: Type.Union([
    Type.Null(),
    Type.Object({ path: Str(500), nameKey: Str(200), valueKey: Str(200), inline: Type.Boolean() }),
  ]),
});

export const Mapping = Type.Object(
  {
    version: Type.Literal(1),
    username: Source,
    avatarUrl: Source,
    content: Source,
    embeds: Type.Array(MappingEmbed, { maxItems: 10 }),
  },
  { description: 'Visual field mapping; compiled to a message template on save' },
);

export const RenderWarning = Type.Object({ slot: Type.String(), message: Type.String() });
export const RenderResult = Type.Object({
  message: Type.Unsafe<DiscordMessage | null>({ description: 'Discord message body, or null when rendering failed' }),
  warnings: Type.Array(RenderWarning),
  error: Type.Union([Type.Null(), Type.String()]),
});

// ---------- relays ----------

export const Relay = Type.Object({
  id: Uuid,
  name: Type.String(),
  ingestKey: Type.String(),
  ingestUrl: Type.String(),
  discordWebhook: Type.Object({
    id: Uuid,
    name: Type.String(),
    url: Type.String({ description: 'Masked; the token is never returned' }),
  }),
  enabled: Type.Boolean(),
  captureMode: Type.Boolean(),
  sampleSource: Type.Union([Type.Null(), Type.Literal('example'), Type.Literal('schema'), Type.Literal('captured')]),
  hasSample: Type.Boolean(),
  templateCount: Type.Integer(),
  lastReceivedAt: Type.Union([Type.Null(), DateTime]),
  lastStatus: Type.Union([Type.Null(), Type.String()]),
  backlog: Type.Integer({ description: 'pending + processing + failed' }),
  createdAt: DateTime,
  updatedAt: DateTime,
});

export const RelayDetail = Type.Intersect([Relay, Type.Object({ samplePayload: Type.Unknown() })]);

// ---------- templates ----------

export const TemplateBody = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 100 }),
  priority: Type.Optional(Type.Integer({ minimum: 0, maximum: 10_000 })),
  condition: Type.Optional(Type.Union([Type.Null(), Type.String({ maxLength: 2000 })])),
  mode: Type.Union([Type.Literal('mapping'), Type.Literal('liquid')]),
  mapping: Type.Optional(Type.Union([Type.Null(), Mapping])),
  message: Type.Optional(MessageTemplate),
});

export const Template = Type.Object({
  id: Uuid,
  relayId: Uuid,
  name: Type.String(),
  priority: Type.Integer(),
  condition: Type.Union([Type.Null(), Type.String()]),
  mode: Type.Union([Type.Literal('mapping'), Type.Literal('liquid')]),
  mapping: Type.Union([Type.Null(), Mapping]),
  message: MessageTemplate,
  createdAt: DateTime,
  updatedAt: DateTime,
});

// ---------- queue / logs ----------

export const QueueStatus = Type.Enum(['pending', 'processing', 'delivered', 'failed', 'dead', 'skipped', 'rejected']);
export type QueueStatusT = 'pending' | 'processing' | 'delivered' | 'failed' | 'dead' | 'skipped' | 'rejected';

export const QueueItem = Type.Object({
  id: Uuid,
  relayId: Type.Union([Type.Null(), Uuid]),
  relayName: Type.Union([Type.Null(), Type.String()]),
  status: QueueStatus,
  receivedAt: DateTime,
  attempts: Type.Integer(),
  maxAttempts: Type.Integer(),
  nextAttemptAt: DateTime,
  deliveredAt: Type.Union([Type.Null(), DateTime]),
  lastError: Type.Union([Type.Null(), Type.String()]),
  lastStatusCode: Type.Union([Type.Null(), Type.Integer()]),
  templateId: Type.Union([Type.Null(), Uuid]),
  durationMs: Type.Union([Type.Null(), Type.Integer()], { description: 'Duration of the latest attempt' }),
});

export const Attempt = Type.Object({
  id: Uuid,
  attemptNo: Type.Integer(),
  trigger: Type.Union([Type.Literal('worker'), Type.Literal('manual'), Type.Literal('replay')]),
  stage: Type.Union([Type.Literal('render'), Type.Literal('send')]),
  startedAt: DateTime,
  durationMs: Type.Union([Type.Null(), Type.Integer()]),
  requestBody: Type.Unknown(),
  responseStatus: Type.Union([Type.Null(), Type.Integer()]),
  responseHeaders: Type.Unknown(),
  responseBody: Type.Union([Type.Null(), Type.String()]),
  errorMessage: Type.Union([Type.Null(), Type.String()]),
  errorStack: Type.Union([Type.Null(), Type.String()]),
});

export const QueueItemDetail = Type.Intersect([
  QueueItem,
  Type.Object({
    sourceIp: Type.Union([Type.Null(), Type.String()]),
    headers: Type.Unknown(),
    payload: Type.Unknown(),
    rendered: Type.Unknown(),
    attemptsLog: Type.Array(Attempt),
  }),
]);

export const QueueFilter = Type.Object({
  relayId: Type.Optional(Type.Array(Uuid, { maxItems: 100 })),
  status: Type.Optional(Type.Array(QueueStatus)),
  from: Type.Optional(Type.String({ format: 'date-time' })),
  to: Type.Optional(Type.String({ format: 'date-time' })),
  statusCode: Type.Optional(Type.Integer()),
  hasError: Type.Optional(Type.Boolean()),
  q: Type.Optional(Type.String({ maxLength: 200, description: 'Search payload text and error messages' })),
  path: Type.Optional(Type.String({ maxLength: 500, description: 'Payload path, e.g. data.task.id' })),
  pathValue: Type.Optional(Type.String({ maxLength: 500, description: 'Exact value at `path`' })),
});
export type QueueFilterT = Static<typeof QueueFilter>;

export const SORTABLE = ['receivedAt', 'attempts', 'lastStatusCode', 'nextAttemptAt', 'deliveredAt', 'status', 'relayName'] as const;

export const BulkResult = Type.Object({ affected: Type.Integer() });
export const SendResult = Type.Object({
  id: Uuid,
  status: QueueStatus,
  lastError: Type.Union([Type.Null(), Type.String()]),
  lastStatusCode: Type.Union([Type.Null(), Type.Integer()]),
});

import type { DiscordEmbed, DiscordMessage } from '@send-any-webhook/shared';
import type { CSSProperties } from 'react';
import { DiscordMarkdown } from './markdown';

export type DiscordTheme = 'dark' | 'light';

const THEMES: Record<DiscordTheme, Record<string, string>> = {
  dark: {
    '--dc-bg': '#313338',
    '--dc-text': '#dbdee1',
    '--dc-heading': '#f2f3f5',
    '--dc-muted': '#949ba4',
    '--dc-embed-bg': '#2b2d31',
    '--dc-border': '#4e5058',
    '--dc-code-bg': '#1e1f22',
    '--dc-link': '#00a8fc',
    '--dc-mention': '#c9cdfb',
    '--dc-mention-bg': 'rgba(88,101,242,.3)',
  },
  light: {
    '--dc-bg': '#ffffff',
    '--dc-text': '#313338',
    '--dc-heading': '#060607',
    '--dc-muted': '#5c5e66',
    '--dc-embed-bg': '#f2f3f5',
    '--dc-border': '#d4d7dc',
    '--dc-code-bg': '#e3e5e8',
    '--dc-link': '#006ce7',
    '--dc-mention': '#505cdc',
    '--dc-mention-bg': 'rgba(88,101,242,.15)',
  },
};

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

function embedTimestamp(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return d.toDateString() === today.toDateString() ? `Today at ${time}` : `${d.toLocaleDateString()} ${time}`;
}

/** Groups fields into rows the way Discord does: up to 3 inline fields per row (2 next to a thumbnail). */
function fieldRows(fields: NonNullable<DiscordEmbed['fields']>, perRow: number) {
  const rows: (typeof fields)[] = [];
  for (const f of fields) {
    const last = rows.at(-1);
    if (f.inline && last && last.length < perRow && last.every((x) => x.inline)) last.push(f);
    else rows.push([f]);
  }
  return rows;
}

function Embed({ embed }: { embed: DiscordEmbed }) {
  const rows = fieldRows(embed.fields ?? [], embed.thumbnail ? 2 : 3);
  return (
    <div
      className="mt-1 grid max-w-[520px] rounded border-l-4 bg-[var(--dc-embed-bg)] py-2 pr-4 pl-3"
      style={{ borderLeftColor: embed.color !== undefined ? hex(embed.color) : 'var(--dc-border)' }}
    >
      <div className="flex gap-4">
        <div className="min-w-0 flex-1 space-y-1">
          {embed.author && (
            <div className="flex items-center gap-2 text-sm font-semibold text-[var(--dc-heading)]">
              {embed.author.icon_url && <img src={embed.author.icon_url} alt="" className="size-6 rounded-full" />}
              {embed.author.url ? (
                <a href={embed.author.url} target="_blank" rel="noreferrer" className="hover:underline">
                  {embed.author.name}
                </a>
              ) : (
                embed.author.name
              )}
            </div>
          )}
          {embed.title && (
            <div className="font-semibold text-[var(--dc-heading)]">
              {embed.url ? (
                <a href={embed.url} target="_blank" rel="noreferrer" className="text-[var(--dc-link)] hover:underline">
                  <DiscordMarkdown text={embed.title} block={false} />
                </a>
              ) : (
                <DiscordMarkdown text={embed.title} block={false} />
              )}
            </div>
          )}
          {embed.description && (
            <div className="text-sm leading-snug break-words">
              <DiscordMarkdown text={embed.description} />
            </div>
          )}
          {rows.length > 0 && (
            <div className="mt-2 space-y-2">
              {rows.map((row, i) => (
                <div key={i} className="grid gap-x-4 gap-y-2" style={{ gridTemplateColumns: `repeat(${row.length}, minmax(0, 1fr))` }}>
                  {row.map((f, j) => (
                    <div key={j} className="min-w-0 text-sm">
                      <div className="font-semibold text-[var(--dc-heading)]">
                        <DiscordMarkdown text={f.name} block={false} />
                      </div>
                      <div className="leading-snug break-words">
                        <DiscordMarkdown text={f.value} />
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
        {embed.thumbnail && <img src={embed.thumbnail.url} alt="" className="size-20 shrink-0 rounded object-cover" />}
      </div>
      {embed.image && <img src={embed.image.url} alt="" className="mt-3 max-h-80 max-w-full rounded object-contain" />}
      {(embed.footer || embed.timestamp) && (
        <div className="mt-2 flex items-center gap-2 text-xs text-[var(--dc-muted)]">
          {embed.footer?.icon_url && <img src={embed.footer.icon_url} alt="" className="size-5 rounded-full" />}
          <span>
            {embed.footer?.text}
            {embed.footer?.text && embed.timestamp && ' • '}
            {embed.timestamp && embedTimestamp(embed.timestamp)}
          </span>
        </div>
      )}
    </div>
  );
}

/** Looks like a webhook message in a Discord channel. */
export function DiscordPreview({
  message,
  theme = 'dark',
  defaultName = 'Your webhook',
  empty,
}: {
  message: DiscordMessage | null;
  theme?: DiscordTheme;
  /** Shown when the message sets no username (Discord uses the webhook's own name). */
  defaultName?: string;
  empty?: string;
}) {
  const style = THEMES[theme] as CSSProperties;
  const now = new Date().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return (
    <div style={style} className="rounded-lg bg-[var(--dc-bg)] p-4 font-sans text-[15px] text-[var(--dc-text)]">
      {!message ? (
        <p className="text-sm text-[var(--dc-muted)]">{empty ?? 'Nothing to show.'}</p>
      ) : (
        <div className="flex gap-4">
          {message.avatar_url ? (
            <img src={message.avatar_url} alt="" className="size-10 shrink-0 rounded-full object-cover" />
          ) : (
            <div className="grid size-10 shrink-0 place-items-center rounded-full bg-[#5865f2] text-lg font-semibold text-white">
              {(message.username ?? defaultName).charAt(0).toUpperCase()}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-medium text-[var(--dc-heading)]">{message.username ?? defaultName}</span>
              <span className="rounded bg-[#5865f2] px-1 text-[10px] leading-4 font-semibold text-white">APP</span>
              <span className="text-xs text-[var(--dc-muted)]">Today at {now}</span>
            </div>
            {message.content && (
              <div className="leading-snug break-words">
                <DiscordMarkdown text={message.content} />
              </div>
            )}
            {message.embeds?.map((e, i) => <Embed key={i} embed={e} />)}
          </div>
        </div>
      )}
    </div>
  );
}

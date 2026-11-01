import { Fragment, type ReactNode } from 'react';

// A small renderer for the Discord markdown subset that shows up in webhook messages.

const TIME_STYLES: Record<string, Intl.DateTimeFormatOptions> = {
  t: { timeStyle: 'short' },
  T: { timeStyle: 'medium' },
  d: { dateStyle: 'short' },
  D: { dateStyle: 'long' },
  f: { dateStyle: 'long', timeStyle: 'short' },
  F: { dateStyle: 'full', timeStyle: 'short' },
};
const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

export function discordTime(unix: number, style = 'f'): string {
  const date = new Date(unix * 1000);
  // Out-of-range timestamps would make Intl throw and crash the preview
  if (!Number.isFinite(date.getTime())) return `<t:${unix}:${style}>`;
  if (style === 'R') {
    const s = (date.getTime() - Date.now()) / 1000;
    const units: [Intl.RelativeTimeFormatUnit, number][] = [
      ['year', 31536000],
      ['month', 2592000],
      ['day', 86400],
      ['hour', 3600],
      ['minute', 60],
      ['second', 1],
    ];
    const [unit, size] = units.find(([, n]) => Math.abs(s) >= n) ?? ['second', 1];
    return rtf.format(Math.round(s / size), unit);
  }
  return date.toLocaleString(undefined, TIME_STYLES[style] ?? TIME_STYLES.f);
}

interface Rule {
  re: RegExp;
  render: (m: RegExpExecArray, key: number, inline: (s: string) => ReactNode[]) => ReactNode;
}

const pill = 'rounded px-0.5 font-medium bg-[var(--dc-mention-bg)] text-[var(--dc-mention)]';
const link = 'text-[var(--dc-link)] hover:underline';

const RULES: Rule[] = [
  { re: /^```(?:[\w+-]*\n)?([\s\S]*?)```/, render: (m, k) => <pre key={k} className="my-1 rounded border border-[var(--dc-border)] bg-[var(--dc-code-bg)] p-2 font-mono text-[0.85em] whitespace-pre-wrap">{m[1]!.replace(/\n$/, '')}</pre> },
  { re: /^`([^`]+)`/, render: (m, k) => <code key={k} className="rounded bg-[var(--dc-code-bg)] px-1 py-0.5 font-mono text-[0.85em]">{m[1]}</code> },
  { re: /^<t:(-?\d+)(?::([tTdDfFR]))?>/, render: (m, k) => <span key={k} className="rounded bg-[var(--dc-code-bg)] px-1">{discordTime(Number(m[1]), m[2])}</span> },
  { re: /^<@!?(\d+)>/, render: (_m, k) => <span key={k} className={pill}>@user</span> },
  { re: /^<@&(\d+)>/, render: (_m, k) => <span key={k} className={pill}>@role</span> },
  { re: /^<#(\d+)>/, render: (_m, k) => <span key={k} className={pill}>#channel</span> },
  { re: /^@(everyone|here)\b/, render: (m, k) => <span key={k} className={pill}>@{m[1]}</span> },
  { re: /^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/, render: (m, k, inline) => <a key={k} href={m[2]} target="_blank" rel="noreferrer" className={link}>{inline(m[1]!)}</a> },
  { re: /^<?(https?:\/\/[^\s<>]+[^\s<>.,:;"')\]])>?/, render: (m, k) => <a key={k} href={m[1]} target="_blank" rel="noreferrer" className={link}>{m[1]}</a> },
  { re: /^\*\*\*([\s\S]+?)\*\*\*/, render: (m, k, inline) => <strong key={k}><em>{inline(m[1]!)}</em></strong> },
  { re: /^\*\*([\s\S]+?)\*\*/, render: (m, k, inline) => <strong key={k}>{inline(m[1]!)}</strong> },
  { re: /^__([\s\S]+?)__/, render: (m, k, inline) => <u key={k}>{inline(m[1]!)}</u> },
  { re: /^\*([^*\s][\s\S]*?)\*/, render: (m, k, inline) => <em key={k}>{inline(m[1]!)}</em> },
  { re: /^_([^_\s][\s\S]*?)_(?!\w)/, render: (m, k, inline) => <em key={k}>{inline(m[1]!)}</em> },
  { re: /^~~([\s\S]+?)~~/, render: (m, k, inline) => <s key={k}>{inline(m[1]!)}</s> },
  { re: /^\|\|([\s\S]+?)\|\|/, render: (m, k, inline) => <span key={k} className="rounded bg-[var(--dc-code-bg)] px-0.5">{inline(m[1]!)}</span> },
  { re: /^\\([*_~`|\\<>[\]])/, render: (m, k) => <Fragment key={k}>{m[1]}</Fragment> },
];

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let plain = '';
  let i = 0;
  let key = 0;
  const flush = () => {
    if (plain) out.push(plain);
    plain = '';
  };
  while (i < text.length) {
    const rest = text.slice(i);
    let matched = false;
    // Only try rules where a token can start
    if (/^[`<@[h*_~|\\]/.test(rest)) {
      for (const rule of RULES) {
        const m = rule.re.exec(rest);
        if (m) {
          flush();
          out.push(rule.render(m, key++, inline));
          i += m[0].length;
          matched = true;
          break;
        }
      }
    }
    if (!matched) {
      plain += text[i];
      i++;
    }
  }
  flush();
  return out;
}

/** Renders Discord markdown. `block` enables headings, quotes and lists (content, descriptions, field values). */
export function DiscordMarkdown({ text, block = true }: { text: string; block?: boolean }) {
  if (!block) return <>{inline(text)}</>;
  // Keep code blocks intact; split the rest into lines for block syntax
  const parts = text.split(/(```[\s\S]*?```)/g);
  return (
    <>
      {parts.map((part, pi) =>
        part.startsWith('```') ? (
          <Fragment key={pi}>{inline(part)}</Fragment>
        ) : (
          part.split('\n').map((line, li, lines) => {
            const key = `${pi}-${li}`;
            const h = /^(#{1,3}) (.+)/.exec(line);
            if (h) {
              const size = ['text-[1.5em]', 'text-[1.25em]', 'text-[1em]'][h[1]!.length - 1];
              return <div key={key} className={`${size} my-1 font-bold`}>{inline(h[2]!)}</div>;
            }
            const q = /^> (.*)/.exec(line);
            if (q) return <div key={key} className="border-l-4 border-[var(--dc-border)] pl-2">{inline(q[1]!)}</div>;
            const li2 = /^\s*[-*] (.+)/.exec(line);
            if (li2) return <div key={key} className="pl-4 before:-ml-3 before:mr-1.5 before:content-['•']">{inline(li2[1]!)}</div>;
            return (
              <Fragment key={key}>
                {inline(line)}
                {li < lines.length - 1 && <br />}
              </Fragment>
            );
          })
        ),
      )}
    </>
  );
}

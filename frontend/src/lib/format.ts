const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 86400],
  ['month', 30 * 86400],
  ['day', 86400],
  ['hour', 3600],
  ['minute', 60],
  ['second', 1],
];

export function relativeTime(date: Date | string | null | undefined, now = Date.now()): string {
  if (!date) return '—';
  const seconds = (new Date(date).getTime() - now) / 1000;
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size || unit === 'second') {
      return Math.abs(seconds) < 5 ? 'just now' : rtf.format(Math.round(seconds / size), unit);
    }
  }
  return '—';
}

export function dateTime(date: Date | string | null | undefined): string {
  if (!date) return '—';
  return new Date(date).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' });
}

export function duration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—';
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

export const prettyJson = (v: unknown) => JSON.stringify(v, null, 2);

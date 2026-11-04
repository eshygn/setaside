// Date helpers for the UI. Dates are YYYY-MM-DD strings, read as UTC so the demo clock never
// shifts with the viewer's timezone.

export function formatDay(day: string, opts: { year?: boolean } = { year: true }) {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    ...(opts.year ? { year: 'numeric' } : {}),
    timeZone: 'UTC',
  });
}

export function addDays(day: string, n: number) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export const pct = (bps: number) => `${(bps / 100).toFixed(1)}%`;

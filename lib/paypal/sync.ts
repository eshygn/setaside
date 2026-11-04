// Pulls a date range out of Transaction Search, which allows at most 31 days per query: split
// the range into windows, page through each, and de-duplicate by transaction id.

import { TRANSACTION_SEARCH_MAX_DAYS, type PayPalAdapter, type PayPalTransactionDetail } from './types';

const DAY = 86_400_000;

/** Consecutive [start, end] windows covering the range, each at most `maxDays` long. */
export function searchWindows(start: Date, end: Date, maxDays = TRANSACTION_SEARCH_MAX_DAYS): { start: Date; end: Date }[] {
  if (end < start) return [];
  const windows: { start: Date; end: Date }[] = [];
  let cursor = start.getTime();
  // A window of N days ends one second before day N+1 starts, so it never exceeds N days.
  const span = maxDays * DAY - 1000;
  while (cursor <= end.getTime()) {
    const windowEnd = Math.min(cursor + span, end.getTime());
    windows.push({ start: new Date(cursor), end: new Date(windowEnd) });
    cursor = windowEnd + 1000;
  }
  return windows;
}

export async function fetchRange(
  adapter: PayPalAdapter,
  start: Date,
  end: Date,
  opts: { pageSize?: number; onWindow?: (w: { start: Date; end: Date; count: number }) => void } = {},
): Promise<{ transactions: PayPalTransactionDetail[]; calls: number; lastRefreshed?: string }> {
  const pageSize = opts.pageSize ?? 500;
  const seen = new Map<string, PayPalTransactionDetail>();
  let calls = 0;
  let lastRefreshed: string | undefined;
  for (const w of searchWindows(start, end)) {
    let count = 0;
    for (let page = 1; ; page++) {
      const res = await adapter.searchTransactions({ start: w.start, end: w.end, page, pageSize });
      calls++;
      lastRefreshed = res.last_refreshed_datetime ?? lastRefreshed;
      for (const t of res.transaction_details ?? []) {
        seen.set(t.transaction_info.transaction_id, t);
        count++;
      }
      if (page >= (res.total_pages ?? 1)) break;
    }
    opts.onWindow?.({ ...w, count });
  }
  return { transactions: [...seen.values()], calls, lastRefreshed };
}

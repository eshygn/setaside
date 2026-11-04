import { describe, expect, it } from 'vitest';
import { parseMinor } from '@/lib/money';
import { MockPayPal, loadFixture } from '@/lib/paypal/mock';
import { fetchRange, searchWindows } from '@/lib/paypal/sync';
import { generateScenario, scenarioFor } from '@/lib/seed/generate';

const DAY = 86_400_000;

describe('Transaction Search windows', () => {
  it('covers a range in windows of at most 31 days, with no gaps or overlaps', () => {
    const start = new Date('2026-04-06T00:00:00Z');
    const end = new Date('2026-11-04T23:59:59Z');
    const w = searchWindows(start, end);
    expect(w.length).toBe(7);
    for (const x of w) expect(x.end.getTime() - x.start.getTime()).toBeLessThanOrEqual(31 * DAY);
    for (let i = 1; i < w.length; i++) expect(w[i].start.getTime() - w[i - 1].end.getTime()).toBe(1000);
    expect(w[0].start).toEqual(start);
    expect(w.at(-1)!.end).toEqual(end);
  });
});

describe('mock PayPal adapter', () => {
  const now = new Date('2026-11-04T23:59:59Z');
  const paypal = new MockPayPal('GBP', () => now);

  it('rejects ranges over 31 days, like the real API', async () => {
    await expect(paypal.searchTransactions({ start: new Date('2026-01-01'), end: new Date('2026-03-01'), page: 1, pageSize: 100 })).rejects.toThrow(/31 days/);
  });
  it('pages, merges windows and hides the last three hours', async () => {
    const res = await fetchRange(paypal, new Date('2026-04-06T00:00:00Z'), now, { pageSize: 50 });
    const expected = loadFixture('GBP').transactions.filter((t) => Date.parse(t.transaction_info.transaction_initiation_date!.replace('+0000', 'Z')) <= now.getTime() - 3 * 3_600_000);
    expect(res.transactions.length).toBe(expected.length);
    expect(res.calls).toBeGreaterThan(7); // several pages in some windows
    expect(new Set(res.transactions.map((t) => t.transaction_info.transaction_id)).size).toBe(res.transactions.length);
  });
  it('reports the balance as of the demo clock', async () => {
    const b = await paypal.getBalances();
    expect(b.balances[0].currency).toBe('GBP');
    expect(parseMinor(b.balances[0].total_balance.value)).toBeGreaterThan(0);
  });
});

describe('seeded scenario', () => {
  it('is deterministic and about 400 transactions by the demo date', () => {
    const a = generateScenario(scenarioFor('GBP'));
    const b = generateScenario(scenarioFor('GBP'));
    expect(a.transactions.map((t) => t.transaction_info.transaction_id)).toEqual(b.transactions.map((t) => t.transaction_info.transaction_id));
    const byClock = a.transactions.filter((t) => t.transaction_info.transaction_initiation_date!.slice(0, 10) <= '2026-11-04');
    expect(byClock.length).toBeGreaterThan(380);
    expect(byClock.length).toBeLessThan(460);
  });
  it('keeps PayPal’s running balance consistent with the amounts', () => {
    const { transactions } = generateScenario(scenarioFor('GBP'));
    let balance = scenarioFor('GBP').openingBalance;
    for (const t of transactions) {
      balance += parseMinor(t.transaction_info.transaction_amount?.value) + parseMinor(t.transaction_info.fee_amount?.value);
      expect(parseMinor(t.transaction_info.ending_balance?.value)).toBe(balance);
    }
  });
  it('matches the committed fixtures', () => {
    const fresh = generateScenario(scenarioFor('GBP')).transactions;
    expect(loadFixture('GBP').transactions).toEqual(fresh);
  });
});

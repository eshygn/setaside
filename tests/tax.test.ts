import { describe, expect, it } from 'vitest';
import { bandedTax, estimateTax, profitBreakdown, profitContribution, quarterlyAccrual, summarise, type TaxableRow } from '@/lib/tax/engine';
import { UK_SELF_EMPLOYED, US_SELF_EMPLOYED } from '@/lib/tax/presets';

const gbp = (pounds: number) => Math.round(pounds * 100);

describe('bandedTax', () => {
  const bands = [
    { upTo: 1000, bps: 1000 },
    { upTo: 3000, bps: 2000 },
    { upTo: null, bps: 4000 },
  ];
  it('fills each band in turn', () => {
    expect(bandedTax(0, bands)).toBe(0);
    expect(bandedTax(1000, bands)).toBe(100);
    expect(bandedTax(2000, bands)).toBe(100 + 200);
    expect(bandedTax(5000, bands)).toBe(100 + 400 + 800);
  });
});

describe('profit', () => {
  const rows: TaxableRow[] = [
    { date: '2026-05-01', category: 'sale', amount: 10_000, fee: -320 },
    { date: '2026-05-02', category: 'client_payment', amount: 50_000, fee: -1480 },
    { date: '2026-05-03', category: 'refund', amount: -2_000, fee: 28 },
    { date: '2026-05-04', category: 'fee', amount: -500, fee: 0 },
    { date: '2026-05-05', category: 'personal_transfer', amount: 2_500, fee: -100 },
    { date: '2026-05-06', category: 'reimbursement', amount: 4_000, fee: 0 },
  ];
  it('counts business rows only, net of PayPal fees', () => {
    expect(profitContribution(rows[0])).toBe(9_680);
    expect(profitContribution(rows[4])).toBe(0);
    const b = profitBreakdown(rows);
    expect(b.turnover).toBe(60_000);
    expect(b.refunds).toBe(-1_972);
    expect(b.fees).toBe(-320 - 1480 - 500);
    expect(b.profit).toBe(60_000 - 1_972 - 2_300);
    expect(b.excluded).toBe(6_500);
  });
  it('scales sales, client income and their fees for a what-if price change', () => {
    const b = profitBreakdown(rows, 1000); // +10%
    expect(b.turnover).toBe(66_000);
    expect(b.fees).toBe(-352 - 1628 - 500);
  });
});

describe('UK preset', () => {
  it('uses the trading allowance when fees are under £1,000', () => {
    // Salary £28,000 already uses the personal allowance; £10,000 profit, no fees:
    // taxable £9,000 at 20% = £1,800; profits under £12,570 pay no Class 4.
    const e = estimateTax(UK_SELF_EMPLOYED, gbp(10_000), gbp(28_000), 0);
    expect(e.taxableProfit).toBe(gbp(9_000));
    expect(e.incomeTax).toBe(gbp(1_800));
    expect(e.contributions).toBe(0);
    expect(e.total).toBe(gbp(1_800));
  });
  it('uses real costs when they beat the allowance, and charges Class 4 above £12,570', () => {
    // £20,000 profit after £1,500 of fees: real costs win (taxable £20,000).
    const e = estimateTax(UK_SELF_EMPLOYED, gbp(20_000), gbp(28_000), gbp(-1_500));
    expect(e.taxableProfit).toBe(gbp(20_000));
    // Income: 28,000 + 20,000 = 48,000, all within the basic band → 20% of 20,000.
    expect(e.incomeTax).toBe(gbp(4_000));
    // Class 4: 6% of (20,000 − 12,570).
    expect(e.contributions).toBe(gbp(445.8));
  });
  it('moves into the higher rate on top of a salary', () => {
    const e = estimateTax(UK_SELF_EMPLOYED, gbp(30_000), gbp(40_000), gbp(-2_000));
    // 40,000 + 30,000 = 70,000: 10,270 of the profit at 20%, 19,730 at 40%.
    expect(e.incomeTax).toBe(gbp(10_270 * 0.2 + 19_730 * 0.4));
  });
  it('owes nothing on a loss', () => {
    expect(estimateTax(UK_SELF_EMPLOYED, gbp(-500), gbp(28_000), 0).total).toBe(0);
  });
});

describe('US preset', () => {
  it('adds SE tax on 92.35% of profit and federal tax at the marginal rate', () => {
    const e = estimateTax(US_SELF_EMPLOYED, 1_000_000, 4_800_000, 0); // $10,000 profit on $48,000 wages
    // 92.35% → $9,235.00; 12.4% SS = $1,145.14; 2.9% Medicare = $267.82.
    expect(e.contributions).toBe(114_514 + 26_782);
    // Federal: taxable 48,000 + 10,000 − 706.48 − 16,100 vs 48,000 − 16,100, both in the 12% band.
    expect(e.incomeTax).toBe(111_522);
    expect(e.total).toBe(141_296 + 111_522);
  });
  it('skips SE tax under $400 of net earnings', () => {
    expect(estimateTax(US_SELF_EMPLOYED, 40_000, 4_800_000, 0).contributions).toBe(0);
  });
});

describe('summarise and quarters', () => {
  const rows: TaxableRow[] = [
    { date: '2026-04-20', category: 'client_payment', amount: gbp(5_000), fee: gbp(-145) },
    { date: '2026-08-10', category: 'client_payment', amount: gbp(6_000), fee: gbp(-174) },
    { date: '2026-10-20', category: 'sale', amount: gbp(4_000), fee: gbp(-116) },
    { date: '2026-12-01', category: 'sale', amount: gbp(9_999), fee: 0 }, // after "today": ignored
  ];
  it('only counts the tax year up to today, and works out safe-to-spend', () => {
    const s = summarise({ preset: UK_SELF_EMPLOYED, rows, otherIncome: gbp(28_000), balance: gbp(9_000), today: '2026-11-04' });
    expect(s.breakdown.turnover).toBe(gbp(15_000));
    expect(s.safeToSpend).toBe(gbp(9_000) - s.setAside);
    expect(s.nextDeadline?.date).toBe('2027-01-31');
    expect(s.nextDeadline?.daysAway).toBe(88);
  });
  it('splits the set-aside across quarters without losing a penny', () => {
    const q = quarterlyAccrual(UK_SELF_EMPLOYED, rows, gbp(28_000), '2026-11-04');
    const s = summarise({ preset: UK_SELF_EMPLOYED, rows, otherIncome: gbp(28_000), balance: 0, today: '2026-11-04' });
    expect(q.reduce((t, x) => t + x.setAside, 0)).toBe(s.setAside);
    expect(q.map((x) => x.status)).toEqual(['closed', 'closed', 'current', 'upcoming']);
  });
});

// The set-aside maths. Pure functions over integer minor units: no I/O, no floats, so the
// review grid, the AG Studio widgets and the server all get the same answer.

import { CATEGORY_META, type Category } from '../categories';
import { applyBps, clampMin, mulDiv } from '../money';
import type { Band, TaxPreset } from './presets';

/** The parts of a classified transaction the tax maths reads. */
export type TaxableRow = {
  date: string; // YYYY-MM-DD
  category: Category;
  amount: number; // signed minor units, PayPal transaction_amount
  fee: number; // signed minor units, PayPal fee_amount (≤ 0)
};

/** What a row adds to (or takes from) business profit. Personal rows add nothing. */
export function profitContribution(row: Pick<TaxableRow, 'category' | 'amount' | 'fee'>): number {
  return CATEGORY_META[row.category].taxable ? row.amount + row.fee : 0;
}

export type ProfitBreakdown = {
  turnover: number; // sales + client payments, gross
  refunds: number; // ≤ 0
  fees: number; // ≤ 0, standalone fee rows + fees on business rows
  profit: number;
  excluded: number; // personal transfers + reimbursements, gross
};

export function profitBreakdown(rows: readonly TaxableRow[], upliftBps = 0): ProfitBreakdown {
  let turnover = 0;
  let refunds = 0;
  let fees = 0;
  let excluded = 0;
  for (const r of rows) {
    switch (r.category) {
      case 'sale':
      case 'client_payment': {
        // A what-if price change scales what customers paid, and PayPal's percentage fee with it.
        turnover += upliftBps ? r.amount + applyBps(r.amount, upliftBps) : r.amount;
        fees += upliftBps ? r.fee + applyBps(r.fee, upliftBps) : r.fee;
        break;
      }
      case 'refund':
        refunds += r.amount + r.fee;
        break;
      case 'fee':
        fees += r.amount + r.fee;
        break;
      default:
        excluded += r.amount;
    }
  }
  return { turnover, refunds, fees, profit: turnover + refunds + fees, excluded };
}

/** Tax on `income` across progressive bands (band limits are cumulative upper bounds). */
export function bandedTax(income: number, bands: readonly Band[]): number {
  let tax = 0;
  let lower = 0;
  for (const band of bands) {
    if (income <= lower) break;
    const upper = band.upTo === null ? income : Math.min(income, band.upTo);
    tax += applyBps(upper - lower, band.bps);
    if (band.upTo === null) break;
    lower = band.upTo;
  }
  return tax;
}

export type TaxEstimate = {
  profit: number;
  taxableProfit: number;
  incomeTax: number;
  contributions: number; // Class 4 NIC (UK) or SE tax (US)
  stateTax: number;
  total: number;
  /** Total as a share of profit, in basis points, for display. */
  effectiveBps: number;
  lines: { label: string; amount: number }[];
};

/**
 * Extra tax caused by `profit` of side income on top of `otherIncome` (salary), for one tax year.
 * Income tax is the difference between tax with and without the side profit, so the person's
 * marginal rate is what applies.
 */
export function estimateTax(preset: TaxPreset, profit: number, otherIncome: number, feesForAllowance = 0): TaxEstimate {
  const rules = preset.rules;
  if (rules.kind === 'uk') {
    // Trading allowance: deduct £1,000 instead of real costs when that is better. Fees are
    // already inside `profit`, so add them back before taking the allowance.
    const gross = profit - feesForAllowance; // feesForAllowance ≤ 0
    const withAllowance = clampMin(gross - rules.tradingAllowance);
    const taxableProfit = clampMin(Math.min(profit, withAllowance));
    const incomeTax = ukIncomeTax(otherIncome + taxableProfit, rules) - ukIncomeTax(otherIncome, rules);
    const c4 = rules.class4;
    const mainBand = clampMin(Math.min(taxableProfit, c4.upper) - c4.lower);
    const upperBand = clampMin(taxableProfit - c4.upper);
    const contributions = applyBps(mainBand, c4.mainBps) + applyBps(upperBand, c4.upperBps);
    const total = incomeTax + contributions;
    return {
      profit,
      taxableProfit,
      incomeTax,
      contributions,
      stateTax: 0,
      total,
      effectiveBps: profit > 0 ? mulDiv(10_000, total, profit) : 0,
      lines: [
        { label: 'Income tax', amount: incomeTax },
        { label: 'Class 4 NI', amount: contributions },
      ],
    };
  }

  // US: SE tax on 92.35% of profit, then federal income tax on profit less half the SE tax.
  const se = rules.seTax;
  const taxableProfit = clampMin(profit);
  const netEarnings = applyBps(taxableProfit, se.netEarningsBps);
  let contributions = 0;
  if (netEarnings >= se.minimumNetEarnings) {
    const ssRoom = clampMin(se.socialSecurityWageBase - otherIncome);
    contributions = applyBps(Math.min(netEarnings, ssRoom), se.socialSecurityBps) + applyBps(netEarnings, se.medicareBps);
  }
  const halfSe = mulDiv(contributions, 1, 2);
  const taxable = (income: number) => clampMin(income - rules.standardDeduction);
  const incomeTax =
    bandedTax(taxable(otherIncome + taxableProfit - halfSe), rules.federalBands) -
    bandedTax(taxable(otherIncome), rules.federalBands);
  const stateTax = applyBps(taxableProfit, rules.stateFlatBps);
  const total = clampMin(incomeTax) + contributions + stateTax;
  return {
    profit,
    taxableProfit,
    incomeTax: clampMin(incomeTax),
    contributions,
    stateTax,
    total,
    effectiveBps: profit > 0 ? mulDiv(10_000, total, profit) : 0,
    lines: [
      { label: 'Federal income tax', amount: clampMin(incomeTax) },
      { label: 'Self-employment tax', amount: contributions },
      ...(rules.stateFlatBps ? [{ label: 'State tax', amount: stateTax }] : []),
    ],
  };
}

function ukIncomeTax(income: number, rules: Extract<TaxPreset['rules'], { kind: 'uk' }>): number {
  return bandedTax(clampMin(income - rules.personalAllowance), rules.incomeTaxBands);
}

export type SetAsideSummary = {
  breakdown: ProfitBreakdown;
  estimate: TaxEstimate;
  /** Tax to have put aside for the year so far. */
  setAside: number;
  /** PayPal balance left after the set-aside; negative means short. */
  safeToSpend: number;
  balance: number;
  /** Full-year projection from the run rate so far. */
  projectedYearTax: number;
  nextDeadline?: { date: string; label: string; note: string; daysAway: number };
};

export function summarise(params: {
  preset: TaxPreset;
  rows: readonly TaxableRow[];
  otherIncome: number;
  balance: number;
  today: string;
  upliftBps?: number;
}): SetAsideSummary {
  const { preset, otherIncome, balance, today, upliftBps = 0 } = params;
  const rows = params.rows.filter((r) => r.date >= preset.taxYear.start && r.date <= preset.taxYear.end && r.date <= today);
  const breakdown = profitBreakdown(rows, upliftBps);
  const estimate = estimateTax(preset, breakdown.profit, otherIncome, breakdown.fees);
  const elapsed = daysBetween(preset.taxYear.start, minDate(today, preset.taxYear.end)) + 1;
  const yearDays = daysBetween(preset.taxYear.start, preset.taxYear.end) + 1;
  const projectedProfit = elapsed > 0 ? mulDiv(breakdown.profit, yearDays, elapsed) : 0;
  const projected = estimateTax(preset, projectedProfit, otherIncome, elapsed > 0 ? mulDiv(breakdown.fees, yearDays, elapsed) : 0);
  const next = preset.deadlines.find((d) => d.date >= today);
  return {
    breakdown,
    estimate,
    setAside: estimate.total,
    safeToSpend: balance - estimate.total,
    balance,
    projectedYearTax: projected.total,
    nextDeadline: next && { date: next.date, label: next.label, note: next.note, daysAway: daysBetween(today, next.date) },
  };
}

/** Set-aside accrued in each quarter: the year-to-date estimate at each quarter end, differenced. */
export function quarterlyAccrual(preset: TaxPreset, rows: readonly TaxableRow[], otherIncome: number, today: string, upliftBps = 0) {
  let previous = 0;
  return preset.quarters.map((q) => {
    const cutoff = minDate(q.end, today);
    const ytd = rows.filter((r) => r.date >= preset.taxYear.start && r.date <= cutoff);
    const b = profitBreakdown(ytd, upliftBps);
    const total = q.start > today ? previous : estimateTax(preset, b.profit, otherIncome, b.fees).total;
    const accrued = total - previous;
    previous = total;
    const inQuarter = rows.filter((r) => r.date >= q.start && r.date <= cutoff);
    return {
      ...q,
      status: (q.end < today ? 'closed' : q.start <= today ? 'current' : 'upcoming') as 'closed' | 'current' | 'upcoming',
      profit: profitBreakdown(inQuarter, upliftBps).profit,
      setAside: accrued,
      cumulative: total,
    };
  });
}

// --- Dates (YYYY-MM-DD strings, UTC) ------------------------------------------------

const DAY = 86_400_000;
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);
const minDate = (a: string, b: string) => (a < b ? a : b);

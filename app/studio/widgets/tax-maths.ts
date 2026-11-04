// The tax widgets' maths: the same engine as the server, fed with Studio's integer sums, so a
// widget and the header always agree (and a filtered widget answers for just that slice).

import { applyBps } from '@/lib/money';
import { estimateTax, type TaxEstimate } from '@/lib/tax/engine';
import type { TaxContext } from '../store';

export type MoneySums = { profit: number; fees: number; income: number; incomeFees: number };

export const toInt = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : 0);

/** Profit and allowable fees after a what-if price change of `upliftBps` on sales and client work. */
export function withUplift(s: MoneySums, upliftBps: number): MoneySums {
  if (!upliftBps) return s;
  const extraIncome = applyBps(s.income, upliftBps);
  const extraFees = applyBps(s.incomeFees, upliftBps);
  return { profit: s.profit + extraIncome + extraFees, fees: s.fees + extraFees, income: s.income + extraIncome, incomeFees: s.incomeFees + extraFees };
}

export function taxFor(ctx: TaxContext, s: MoneySums, upliftBps = 0): TaxEstimate {
  const u = withUplift(s, upliftBps);
  return estimateTax(ctx.preset, u.profit, ctx.otherIncome, u.fees);
}

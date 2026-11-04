// Money is always an integer number of minor units (pence, cents) plus a currency code.
// Nothing in SetAside stores or sums a float amount: PayPal's decimal strings are parsed
// digit by digit, rates are basis points, and rounding is explicit (half away from zero).

export type Currency = 'GBP' | 'USD';

export type Money = { minor: number; currency: Currency };

/** Parse a PayPal decimal string ("-12.5", "1,204.00", "3") into integer minor units. */
export function parseMinor(value: string | undefined | null): number {
  if (value === undefined || value === null || value.trim() === '') return 0;
  const clean = value.replace(/,/g, '').trim();
  const match = /^(-)?(\d*)(?:\.(\d*))?$/.exec(clean);
  if (!match) throw new Error(`Not a decimal amount: "${value}"`);
  const [, sign, whole = '', frac = ''] = match;
  // Two decimal places; a third digit rounds half away from zero.
  const padded = (frac + '000').slice(0, 3);
  let minor = Number(whole || '0') * 100 + Number(padded.slice(0, 2));
  if (Number(padded[2]) >= 5) minor += 1;
  return sign && minor !== 0 ? -minor : minor;
}

/** Integer minor units back to PayPal's decimal string ("12.50"). */
export function toDecimalString(minor: number): string {
  assertInteger(minor);
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(minor);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** minor × (bps / 10 000), rounded half away from zero. 1 bp = 0.01%. */
export function applyBps(minor: number, bps: number): number {
  assertInteger(minor);
  assertInteger(bps);
  const product = minor * bps;
  const sign = product < 0 ? -1 : 1;
  const abs = Math.abs(product);
  const q = Math.floor(abs / 10_000);
  const r = abs - q * 10_000;
  return sign * (r * 2 >= 10_000 ? q + 1 : q) || 0;
}

/** minor × numerator / denominator, rounded half away from zero (for pro-rating). */
export function mulDiv(minor: number, numerator: number, denominator: number): number {
  assertInteger(minor);
  if (denominator === 0) throw new Error('mulDiv by zero');
  const product = minor * numerator;
  const sign = (product < 0) !== (denominator < 0) ? -1 : 1;
  const absP = Math.abs(product);
  const absD = Math.abs(denominator);
  const q = Math.floor(absP / absD);
  const r = absP - q * absD;
  return sign * (r * 2 >= absD ? q + 1 : q) || 0;
}

export const sumMinor = (values: readonly number[]) =>
  values.reduce((total, v) => {
    assertInteger(v);
    return total + v;
  }, 0);

export const clampMin = (minor: number, min = 0) => (minor < min ? min : minor);

const SYMBOL: Record<Currency, string> = { GBP: '£', USD: '$' };

/** "£1,204.50" / "-$12.00". Always shows the currency symbol; `code` adds the ISO code. */
export function formatMoney(minor: number, currency: Currency, opts: { code?: boolean; whole?: boolean } = {}): string {
  assertInteger(minor);
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(minor);
  const whole = Math.floor(abs / 100);
  const pence = abs % 100;
  const grouped = String(opts.whole ? Math.round(abs / 100) : whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const body = opts.whole ? grouped : `${grouped}.${String(pence).padStart(2, '0')}`;
  return `${sign}${SYMBOL[currency]}${body}${opts.code ? ` ${currency}` : ''}`;
}

/** Minor units as a major-unit number, only for chart axes and AG Studio display. */
export const toMajorForDisplay = (minor: number) => minor / 100;

function assertInteger(n: number) {
  if (!Number.isSafeInteger(n)) throw new Error(`Money must be integer minor units, got ${n}`);
}

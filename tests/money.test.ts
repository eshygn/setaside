import { describe, expect, it } from 'vitest';
import { applyBps, formatMoney, mulDiv, parseMinor, sumMinor, toDecimalString } from '@/lib/money';

describe('parseMinor', () => {
  it('parses PayPal decimal strings into integer minor units', () => {
    expect(parseMinor('12.50')).toBe(1250);
    expect(parseMinor('-1.58')).toBe(-158);
    expect(parseMinor('3')).toBe(300);
    expect(parseMinor('0.07')).toBe(7);
    expect(parseMinor('1,204.00')).toBe(120400);
  });
  it('treats missing amounts as zero', () => {
    expect(parseMinor(undefined)).toBe(0);
    expect(parseMinor('')).toBe(0);
  });
  it('rounds a third decimal half away from zero without floats', () => {
    expect(parseMinor('0.005')).toBe(1);
    expect(parseMinor('0.004')).toBe(0);
    expect(parseMinor('-2.675')).toBe(-268);
  });
  it('rejects anything that is not a decimal amount', () => {
    expect(() => parseMinor('£12')).toThrow();
    expect(() => parseMinor('1e3')).toThrow();
  });
  it('avoids the classic float trap', () => {
    // 0.1 + 0.2 in floats is 0.30000000000000004; in minor units it is exact.
    expect(parseMinor('0.10') + parseMinor('0.20')).toBe(parseMinor('0.30'));
  });
});

describe('toDecimalString', () => {
  it('round-trips with parseMinor', () => {
    for (const v of ['0.00', '12.50', '-1.58', '1000000.01']) expect(toDecimalString(parseMinor(v))).toBe(v);
  });
  it('refuses non-integer input', () => {
    expect(() => toDecimalString(12.5)).toThrow();
  });
});

describe('applyBps / mulDiv', () => {
  it('applies basis points with half-away-from-zero rounding', () => {
    expect(applyBps(10_000, 2000)).toBe(2000); // 20% of £100.00
    expect(applyBps(1, 5000)).toBe(1); // 0.5p rounds up
    expect(applyBps(-1, 5000)).toBe(-1);
    expect(applyBps(333, 1000)).toBe(33);
  });
  it('pro-rates exactly', () => {
    expect(mulDiv(1000, 1, 3)).toBe(333);
    expect(mulDiv(1000, 2, 3)).toBe(667);
    expect(() => mulDiv(1, 1, 0)).toThrow();
  });
  it('sums only integers', () => {
    expect(sumMinor([1, 2, 3])).toBe(6);
    expect(() => sumMinor([1, 0.5])).toThrow();
  });
});

describe('formatMoney', () => {
  it('always shows the currency', () => {
    expect(formatMoney(123456, 'GBP')).toBe('£1,234.56');
    expect(formatMoney(-500, 'USD')).toBe('-$5.00');
    expect(formatMoney(123456, 'GBP', { code: true })).toBe('£1,234.56 GBP');
    expect(formatMoney(123456, 'GBP', { whole: true })).toBe('£1,235');
  });
});

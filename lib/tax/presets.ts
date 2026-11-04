// ─────────────────────────────────────────────────────────────────────────────
//  SetAside tax presets: every rate, threshold, date and simplification in one place.
//
//  NOT TAX ADVICE. These are rough set-aside estimates for side income, built from
//  published 2026 rates and the labelled assumptions below. Check them with HMRC / the
//  IRS or a qualified adviser before relying on them. All money is integer minor units
//  (pence / cents); all rates are basis points (100 bps = 1%).
// ─────────────────────────────────────────────────────────────────────────────

import type { Currency } from '../money';

export type PresetId = 'uk-self-employed' | 'us-self-employed';

export type Band = { /** upper bound of the band in minor units, null = no limit */ upTo: number | null; bps: number };

export type Deadline = {
  date: string; // YYYY-MM-DD
  label: string;
  kind: 'payment' | 'filing';
  /** Plain-English note shown under the deadline. */
  note: string;
};

export type Quarter = { id: string; label: string; start: string; end: string };

export type Assumption = { id: string; label: string; value: string; why: string };

export type TaxPreset = {
  id: PresetId;
  name: string;
  short: string;
  currency: Currency;
  taxYear: { label: string; start: string; end: string };
  /** The salary or other income the person already earns; side profit is taxed on top of it. */
  defaultOtherIncome: number;
  quarters: Quarter[];
  deadlines: Deadline[];
  assumptions: Assumption[];
  rules:
    | {
        kind: 'uk';
        personalAllowance: number;
        incomeTaxBands: Band[]; // applied to income above the personal allowance
        class4: { lower: number; upper: number; mainBps: number; upperBps: number };
        tradingAllowance: number;
      }
    | {
        kind: 'us';
        standardDeduction: number;
        federalBands: Band[]; // applied to taxable income (after the standard deduction)
        seTax: {
          netEarningsBps: number; // 92.35%
          socialSecurityBps: number;
          medicareBps: number;
          socialSecurityWageBase: number;
          minimumNetEarnings: number;
        };
        stateFlatBps: number;
      };
};

const gbp = (pounds: number) => pounds * 100;
const usd = (dollars: number) => dollars * 100;

export const UK_SELF_EMPLOYED: TaxPreset = {
  id: 'uk-self-employed',
  name: 'UK self-employment (2026/27)',
  short: 'UK',
  currency: 'GBP',
  taxYear: { label: '2026/27', start: '2026-04-06', end: '2027-04-05' },
  defaultOtherIncome: gbp(28_000),
  quarters: [
    { id: 'Q1', label: 'Q1 · Apr–Jul', start: '2026-04-06', end: '2026-07-05' },
    { id: 'Q2', label: 'Q2 · Jul–Oct', start: '2026-07-06', end: '2026-10-05' },
    { id: 'Q3', label: 'Q3 · Oct–Jan', start: '2026-10-06', end: '2027-01-05' },
    { id: 'Q4', label: 'Q4 · Jan–Apr', start: '2027-01-06', end: '2027-04-05' },
  ],
  deadlines: [
    {
      date: '2027-01-31',
      label: '1st payment on account',
      kind: 'payment',
      note: 'Half of last year’s bill, towards 2026/27 (assumes payments on account apply to you).',
    },
    {
      date: '2027-07-31',
      label: '2nd payment on account',
      kind: 'payment',
      note: 'The other half towards 2026/27.',
    },
    {
      date: '2028-01-31',
      label: 'Return + balancing payment',
      kind: 'filing',
      note: 'File the 2026/27 Self Assessment return and pay whatever is left.',
    },
  ],
  assumptions: [
    { id: 'pa', label: 'Personal allowance', value: '£12,570', why: 'Frozen to 2028. Tapering above £100k is not modelled.' },
    { id: 'bands', label: 'Income tax', value: '20% to £50,270 · 40% to £125,140 · 45% above', why: 'England, Wales & NI bands. Scottish rates are not modelled.' },
    { id: 'c4', label: 'Class 4 National Insurance', value: '6% £12,570–£50,270 · 2% above', why: 'Class 2 is no longer compulsory, so it is not added.' },
    { id: 'other', label: 'Other income', value: 'Your salary (editable)', why: 'Side profit is taxed on top of it, so the salary uses the personal allowance first.' },
    { id: 'ta', label: 'Trading allowance', value: '£1,000 or your real costs, whichever is better', why: 'Only PayPal fees count as costs here: other expenses aren’t visible to SetAside.' },
    { id: 'poa', label: 'Payments on account', value: 'Assumed to apply', why: 'They do if last year’s Self Assessment bill was over £1,000.' },
  ],
  rules: {
    kind: 'uk',
    personalAllowance: gbp(12_570),
    incomeTaxBands: [
      { upTo: gbp(50_270 - 12_570), bps: 2000 },
      { upTo: gbp(125_140 - 12_570), bps: 4000 },
      { upTo: null, bps: 4500 },
    ],
    class4: { lower: gbp(12_570), upper: gbp(50_270), mainBps: 600, upperBps: 200 },
    tradingAllowance: gbp(1_000),
  },
};

export const US_SELF_EMPLOYED: TaxPreset = {
  id: 'us-self-employed',
  name: 'US self-employment (2026, single filer)',
  short: 'US',
  currency: 'USD',
  taxYear: { label: '2026', start: '2026-01-01', end: '2026-12-31' },
  defaultOtherIncome: usd(48_000),
  quarters: [
    { id: 'Q1', label: 'Q1 · Jan–Mar', start: '2026-01-01', end: '2026-03-31' },
    { id: 'Q2', label: 'Q2 · Apr–May', start: '2026-04-01', end: '2026-05-31' },
    { id: 'Q3', label: 'Q3 · Jun–Aug', start: '2026-06-01', end: '2026-08-31' },
    { id: 'Q4', label: 'Q4 · Sep–Dec', start: '2026-09-01', end: '2026-12-31' },
  ],
  deadlines: [
    { date: '2026-04-15', label: 'Q1 estimated tax', kind: 'payment', note: 'Form 1040-ES, for Jan–Mar income.' },
    { date: '2026-06-15', label: 'Q2 estimated tax', kind: 'payment', note: 'For Apr–May income.' },
    { date: '2026-09-15', label: 'Q3 estimated tax', kind: 'payment', note: 'For Jun–Aug income.' },
    { date: '2027-01-15', label: 'Q4 estimated tax', kind: 'payment', note: 'For Sep–Dec income.' },
    { date: '2027-04-15', label: 'Return (Schedule C + SE)', kind: 'filing', note: 'File and settle the 2026 return.' },
  ],
  assumptions: [
    { id: 'se', label: 'Self-employment tax', value: '15.3% of 92.35% of profit', why: '12.4% Social Security up to the $184,500 wage base (less your wages) plus 2.9% Medicare. Additional Medicare is not modelled.' },
    { id: 'fed', label: 'Federal income tax', value: '2026 single-filer brackets', why: 'Standard deduction $16,100, used by your wages first. Half of SE tax is deducted.' },
    { id: 'qbi', label: 'QBI deduction', value: 'Not applied', why: 'Leaving out the 20% pass-through deduction keeps the set-aside on the safe side.' },
    { id: 'state', label: 'State income tax', value: '0% (edit in presets.ts)', why: 'States differ too much to guess; add your flat rate in stateFlatBps.' },
    { id: 'other', label: 'Other income', value: 'Your W-2 wages (editable)', why: 'Side profit is taxed at your marginal rate on top of them.' },
  ],
  rules: {
    kind: 'us',
    standardDeduction: usd(16_100),
    federalBands: [
      { upTo: usd(12_400), bps: 1000 },
      { upTo: usd(50_400), bps: 1200 },
      { upTo: usd(105_700), bps: 2200 },
      { upTo: usd(201_775), bps: 2400 },
      { upTo: usd(256_225), bps: 3200 },
      { upTo: usd(640_600), bps: 3500 },
      { upTo: null, bps: 3700 },
    ],
    seTax: {
      netEarningsBps: 9235,
      socialSecurityBps: 1240,
      medicareBps: 290,
      socialSecurityWageBase: usd(184_500),
      minimumNetEarnings: usd(400),
    },
    stateFlatBps: 0,
  },
};

export const PRESETS: Record<PresetId, TaxPreset> = {
  'uk-self-employed': UK_SELF_EMPLOYED,
  'us-self-employed': US_SELF_EMPLOYED,
};

export const DEFAULT_PRESET: PresetId = 'uk-self-employed';

export const isPresetId = (v: unknown): v is PresetId => v === 'uk-self-employed' || v === 'us-self-employed';

export const NOT_TAX_ADVICE =
  'SetAside gives rough estimates to help you put money aside. It is not tax advice: rates and assumptions are listed in full, and your real bill depends on things SetAside can’t see.';

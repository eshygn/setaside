// AG Studio data sources for SetAside: classified transactions (one row per PayPal transaction,
// with per-category amount columns so charts like "refunds against sales" need no expressions),
// invoices, and a shared calendar.
//
// Money: Studio formats and charts major units (pounds/dollars) for display. The tax widgets
// never sum those: they read the hidden integer `*Minor` fields and do the maths in minor units.

import { createFormats, type AgDataSourcesDefinition, type AgFieldDefinition, type AgFormat } from 'ag-studio';
import type { SetAsideRegistry } from './widgets/types';
import { CATEGORY_META } from '@/lib/categories';
import { profitContribution } from '@/lib/tax/engine';
import type { Snapshot } from '@/lib/service';
import { REVIEW_LABEL } from '@/lib/review';

type FieldSpec = [id: string, name: string, format: AgFormat, hide?: boolean, description?: string];
const fields = (specs: FieldSpec[]): AgFieldDefinition<SetAsideRegistry>[] =>
  specs.map(([id, name, format, hide, description]) => ({ id, name, format, ...(hide && { hide }), ...(description && { description }) }));

const major = (minor: number) => minor / 100;
const METHOD: Record<string, string> = { ai: 'Gemini', recorded: 'Gemini (recorded)', heuristic: 'Offline rules', rule: 'Your rule', manual: 'You' };

export function studioRows(snap: Snapshot) {
  return snap.rows
    .filter((r) => r.category)
    .map((r) => {
      const c = r.category!;
      const amt = (cat: string, signFlip = false) => (c === cat ? major(signFlip ? -r.amount : r.amount) : 0);
      const profitMinor = profitContribution({ category: c, amount: r.amount, fee: r.fee });
      // Matches profitBreakdown().fees: fee rows plus the fees on sales and client payments.
      const feeCostMinor = c === 'fee' ? r.amount + r.fee : c === 'sale' || c === 'client_payment' ? r.fee : 0;
      return {
        id: r.id,
        date: r.date,
        counterparty: r.counterparty,
        detail: [r.subject, r.note].filter(Boolean).join(' — '),
        category: CATEGORY_META[c].label,
        categoryGroup: CATEGORY_META[c].group,
        review: REVIEW_LABEL[r.state],
        method: METHOD[r.method ?? ''] ?? r.method ?? '',
        confidence: (r.confidence ?? 0) / 100,
        needsReview: r.state === 'needs_review',
        amount: major(r.amount),
        fee: major(-r.fee),
        net: major(r.net),
        taxableProfit: major(profitMinor),
        sales: amt('sale'),
        clientPayments: amt('client_payment'),
        refunds: amt('refund', true),
        paypalFees: major(-feeCostMinor),
        // Personal money received; withdrawals to your own bank are left out.
        personal: c === 'personal_transfer' && r.amount > 0 ? major(r.amount) : 0,
        reimbursements: amt('reimbursement'),
        taxQuarter: snap.preset.quarters.find((q) => r.date >= q.start && r.date <= q.end)?.label ?? 'Outside year',
        moneyIn: r.amount > 0 ? major(r.amount) : 0,
        moneyOut: r.amount < 0 ? major(-r.amount) : 0,
        profitMinor,
        feeCostMinor,
        incomeMinor: c === 'sale' || c === 'client_payment' ? r.amount : 0,
        incomeFeeMinor: c === 'sale' || c === 'client_payment' ? r.fee : 0,
        origin: r.origin === 'sandbox' ? 'PayPal sandbox (live)' : 'Demo history',
      };
    });
}

export function buildStudioData(snap: Snapshot): AgDataSourcesDefinition<SetAsideRegistry> {
  const cur = snap.preset.currency;
  const rows = studioRows(snap);
  const first = snap.preset.taxYear.start;
  const money = new Intl.NumberFormat(cur === 'GBP' ? 'en-GB' : 'en-US', { style: 'currency', currency: cur, maximumFractionDigits: 0 });

  return {
    description:
      `PayPal activity for ${snap.persona.name}, who sells art prints and does freelance web design on the side. ` +
      `Every transaction has been classified (sale, client payment, refund, fee, personal transfer, reimbursement). ` +
      `All money is ${cur}. Tax year ${snap.preset.taxYear.label} runs ${snap.preset.taxYear.start} to ${snap.preset.taxYear.end}; data is up to ${snap.settings.clock}.`,
    // Show money in the preset's currency, whole units on axes and tiles.
    formats: createFormats<SetAsideRegistry>({ overrides: { currencyFormat: { formatOptions: { format: money } } } }),
    sources: [
      {
        id: 'transactions',
        name: 'Transactions',
        description:
          'One row per PayPal transaction with its AI category. Category amount columns (sales, clientPayments, refunds, paypalFees, personal = personal money received, reimbursements) hold the amount only for rows of that category and 0 otherwise, so sum them per month to compare categories. refunds and paypalFees are positive numbers. taxableProfit is what the row adds to business profit.',
        data: rows,
        fields: fields([
          ['id', 'Transaction ID', 'textFormat', true],
          ['date', 'Date', 'dateFormat'],
          ['counterparty', 'Who', 'textFormat'],
          ['detail', 'PayPal note', 'textFormat'],
          ['category', 'Category', 'textFormat', false, 'Sale, Client payment, Refund, Fee, Personal transfer or Reimbursement'],
          ['categoryGroup', 'Category group', 'textFormat', false, 'Business income, Business cost or Not business'],
          ['review', 'Review state', 'textFormat'],
          ['method', 'Classified by', 'textFormat'],
          ['confidence', 'AI confidence', 'percentageFormat'],
          ['needsReview', 'Needs review', 'booleanFormat'],
          ['amount', 'Amount', 'currencyFormat'],
          ['fee', 'PayPal fee', 'currencyFormat'],
          ['net', 'Net', 'currencyFormat'],
          ['taxableProfit', 'Taxable profit', 'currencyFormat'],
          ['sales', 'Sales', 'currencyFormat'],
          ['clientPayments', 'Client payments', 'currencyFormat'],
          ['refunds', 'Refunds', 'currencyFormat'],
          ['paypalFees', 'PayPal fees', 'currencyFormat'],
          ['personal', 'Personal money in', 'currencyFormat', false, 'Personal transfers received (friends, family, flatmates). Excludes withdrawals.'],
          ['reimbursements', 'Reimbursements', 'currencyFormat'],
          ['taxQuarter', 'Tax quarter', 'textFormat'],
          ['origin', 'Source', 'textFormat'],
          ['moneyIn', 'Money in', 'currencyFormat', false, 'Positive amounts received; 0 for money sent.'],
          ['moneyOut', 'Money out', 'currencyFormat', false, 'Amounts sent or refunded, as positive numbers.'],
          ['profitMinor', 'Profit (minor units)', 'integerFormat', true, 'Integer pence/cents; used by the tax widgets.'],
          ['feeCostMinor', 'Fee cost (minor units)', 'integerFormat', true, 'Integer pence/cents, negative; used by the tax widgets.'],
          ['incomeMinor', 'Sales + client income (minor units)', 'integerFormat', true, 'Integer pence/cents; what a price change scales.'],
          ['incomeFeeMinor', 'Fees on income (minor units)', 'integerFormat', true, 'Integer pence/cents, negative.'],
        ]),
      },
      {
        id: 'invoices',
        name: 'Invoices',
        description: 'PayPal invoices on file, including ones SetAside raised for work paid without an invoice.',
        data: snap.invoices.map((i) => ({ id: i.id, number: i.number ?? '', recipient: i.recipient ?? '', status: i.status, amount: major(i.amount), date: i.invoiceDate ?? first, raisedBy: i.origin === 'seed' ? 'Already on file' : 'SetAside' })),
        fields: fields([
          ['id', 'Invoice ID', 'textFormat', true],
          ['number', 'Invoice', 'textFormat'],
          ['recipient', 'Client', 'textFormat'],
          ['status', 'Invoice status', 'textFormat'],
          ['amount', 'Invoice amount', 'currencyFormat'],
          ['date', 'Invoice date', 'dateFormat'],
          ['raisedBy', 'Raised by', 'textFormat'],
        ]),
      },
    ],
    relationships: [
      { id: 'tx-calendar', source: { tableId: 'transactions', fieldId: 'date' }, target: { calendarId: 'calendar' } },
      { id: 'invoice-calendar', source: { tableId: 'invoices', fieldId: 'date' }, target: { calendarId: 'calendar' } },
    ],
    calendars: [
      {
        id: 'calendar',
        label: 'Calendar',
        range: { from: { type: 'date', value: first }, to: { type: 'date', value: snap.settings.clock } },
        fragments: ['year', 'quarter', 'month', 'week', 'day', 'dayOfWeek'],
      },
    ],
  };
}

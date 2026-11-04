// The demo scenario: a deterministic, messy year of PayPal activity for one fictional person.
//
// Jo Mensah sells art prints through a small shop ("Fernleaf Prints") and does freelance web
// design for a few local businesses, all through one PayPal account that also gets used for
// pizza money, flat bills and birthday gifts. Every person, business and email here is invented.
//
// Output is shaped exactly like PayPal Transaction Search's `transaction_details` items (REST
// snake_case), so the mock adapter can serve it and the live adapter's responses merge with it.
// The same seed always produces the same transactions.

import type { Currency } from '../money';
import { toDecimalString } from '../money';
import type { PayPalInvoice, PayPalTransactionDetail } from '../paypal/types';

// --- Deterministic randomness ---------------------------------------------------------

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rng = ReturnType<typeof mulberry32>;
const pick = <T,>(rng: Rng, items: readonly T[]): T => items[Math.floor(rng() * items.length)];
const between = (rng: Rng, lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));

// --- Cast -------------------------------------------------------------------------------

export const PERSONA = {
  name: 'Jo Mensah',
  business: 'Fernleaf Prints',
  trade: 'Art prints + freelance web design',
  email: 'jo@fernleafprints.example',
};

type Party = { name: string; email: string };

const CUSTOMERS: Party[] = [
  'Hannah Whitlock', 'Oliver Tran', 'Priya Raman', 'Marcus Bell', 'Elena Sokolova', 'Tom Ashworth',
  'Grace Liu', 'Daniel Okoro', 'Sofia Marquez', 'Ben Carter', 'Aisha Patel', 'Liam Fraser',
  'Chloe Dubois', 'Noah Fischer', 'Isla McKenzie', 'Ravi Shah', 'Martha Quinn', 'Yusuf Demir',
  'Freya Lund', 'George Hart', 'Ines Costa', 'Owen Price', 'Mei Tanaka', 'Callum Reid',
  'Zara Hussain', 'Felix Wagner', 'Ruby Evans', 'Jonah Weiss', 'Amara Nwosu', 'Leo Moretti',
].map((name) => ({ name, email: `${name.toLowerCase().replace(/[^a-z]+/g, '.')}@mail.example` }));

const PRINTS = [
  { name: 'A4 risograph print — Harbour at Dusk', price: 1800 },
  { name: 'A3 giclée print — Fern Study No. 4', price: 3200 },
  { name: 'A3 giclée print — Allotment in June', price: 3200 },
  { name: 'A4 risograph print — Night Bus', price: 1800 },
  { name: 'A2 limited edition — The Long Meadow', price: 6500 },
  { name: 'Postcard set (6) — Seasons', price: 1200 },
  { name: 'A3 print + oak frame — Kestrel', price: 7400 },
  { name: 'A4 print bundle (3)', price: 4500 },
];

const CLIENTS = {
  brightwater: { name: 'Brightwater Dental', email: 'accounts@brightwaterdental.example' },
  hollis: { name: 'Hollis & Vane Architects', email: 'studio@hollisvane.example' },
  moorlane: { name: 'Moor Lane Bakery', email: 'hello@moorlanebakery.example' },
  pixelpine: { name: 'Pixel & Pine Agency', email: 'finance@pixelandpine.example' },
  tidewell: { name: 'Tidewell Yoga', email: 'nina@tidewellyoga.example' },
} satisfies Record<string, Party>;

const FRIENDS = {
  kofi: { name: 'Kofi Asante', email: 'kofi.asante@mail.example' },
  ruth: { name: 'Ruth Bell', email: 'ruthbell.flat@mail.example' },
  mum: { name: 'Ama Mensah', email: 'ama.mensah@mail.example' },
  dev: { name: 'Dev Kapoor', email: 'devkapoor@mail.example' },
  sasha: { name: 'Sasha Novak', email: 'sasha.novak@mail.example' },
} satisfies Record<string, Party>;

// --- Scenario -----------------------------------------------------------------------------

export type ScenarioConfig = {
  currency: Currency;
  /** First day of the tax year the scenario covers. */
  start: string;
  /** Last day generated (the scenario runs past the demo clock so jumping forward reveals more). */
  end: string;
  seed: number;
  openingBalance: number;
  /** Average shop orders per day before seasonal and weekend effects. */
  salesRate: number;
};

export type GeneratedScenario = {
  transactions: PayPalTransactionDetail[];
  invoices: PayPalInvoice[];
};

type Draft = {
  at: Date;
  code: string;
  amount: number;
  fee: number;
  party?: Party;
  subject?: string;
  note?: string;
  invoiceId?: string;
  refId?: string;
  status?: 'S' | 'P';
};

const DAY = 86_400_000;

export function generateScenario(cfg: ScenarioConfig): GeneratedScenario {
  const rng = mulberry32(cfg.seed);
  const start = Date.parse(`${cfg.start}T00:00:00Z`);
  const end = Date.parse(`${cfg.end}T23:59:59Z`);
  const days = Math.floor((end - start) / DAY) + 1;
  const drafts: Draft[] = [];
  const invoices: PayPalInvoice[] = [];
  const dayAt = (d: number, hourLo = 7, hourHi = 22) =>
    new Date(start + d * DAY + between(rng, hourLo, hourHi) * 3_600_000 + between(rng, 0, 59) * 60_000 + between(rng, 0, 59) * 1000);
  const fee = (gross: number) => -(Math.round((gross * 290) / 10_000) + 30); // 2.9% + 30 (minor units)
  let order = 1040;
  let invoiceNo = 11;

  for (let d = 0; d < days; d++) {
    const date = new Date(start + d * DAY);
    const weekday = date.getUTCDay();
    const month = date.getUTCMonth();
    const seasonal = month === 10 || month === 11 ? 1.9 : month === 6 || month === 7 ? 0.8 : 1;
    const weekend = weekday === 0 || weekday === 6 ? 1.35 : 1;

    // Shop sales: about one a day, busier at weekends and before Christmas.
    const salesToday = poisson(rng, cfg.salesRate * seasonal * weekend);
    for (let i = 0; i < salesToday; i++) {
      const item = pick(rng, PRINTS);
      const qty = rng() < 0.12 ? 2 : 1;
      const shipping = item.price >= 6500 ? 0 : 395;
      const gross = item.price * qty + shipping;
      const customer = pick(rng, CUSTOMERS);
      const id = `FP-${order++}`;
      const at = dayAt(d);
      drafts.push({
        at,
        code: 'T0006',
        amount: gross,
        fee: fee(gross),
        party: customer,
        subject: `${PERSONA.business} order #${id}`,
        note: rng() < 0.18 ? pick(rng, ['Gift wrap please!', 'It’s a birthday present', 'Love your work', 'Could you sign it?']) : undefined,
        invoiceId: id,
      });
      // About one order in twenty is refunded a few days later.
      if (rng() < 0.05) {
        const later = new Date(at.getTime() + between(rng, 3, 18) * DAY);
        if (later.getTime() <= end) {
          drafts.push({
            at: later,
            code: 'T1107',
            amount: -gross,
            // PayPal returns the percentage part of the fee but keeps the fixed part.
            fee: -fee(gross) - 30,
            party: customer,
            subject: `Refund for order #${id}`,
            note: pick(rng, ['Damaged in post — sorry!', 'Wrong size ordered', 'Customer changed their mind', 'Lost in transit']),
          });
        }
      }
    }

    // Brightwater Dental: monthly website retainer, invoiced, paid on the 2nd.
    if (date.getUTCDate() === 2) {
      const inv = invoice(cfg, invoiceNo++, CLIENTS.brightwater, 'Website care retainer', 45000, date);
      invoices.push(inv);
      drafts.push({ at: dayAt(d, 9, 17), code: 'T0007', amount: 45000, fee: fee(45000), party: CLIENTS.brightwater, subject: `Payment for invoice ${inv.detail.invoice_number}`, note: 'Website retainer', invoiceId: inv.detail.invoice_number });
    }

    // Hollis & Vane: project payments roughly every five weeks, plus print-cost reimbursements.
    if (d % 36 === 20) {
      const amount = pick(rng, [48000, 65000, 82000, 56000]);
      const invoiced = rng() < 0.55;
      const inv = invoiced ? invoice(cfg, invoiceNo++, CLIENTS.hollis, 'Website build — project stage', amount, date) : undefined;
      if (inv) invoices.push(inv);
      drafts.push({
        at: dayAt(d, 9, 18),
        code: 'T0000',
        amount,
        fee: fee(amount),
        party: CLIENTS.hollis,
        subject: inv ? `Payment for invoice ${inv.detail.invoice_number}` : undefined,
        note: inv ? 'Stage payment' : pick(rng, ['Stage 2 — thanks Jo', 'Site launch payment', 'Final payment for the portfolio pages']),
        invoiceId: inv?.detail.invoice_number,
      });
    }
    if (d % 31 === 9) {
      const amount = pick(rng, [3800, 6450, 4200, 11800, 5600]);
      drafts.push({
        at: dayAt(d, 9, 18),
        code: 'T0000',
        amount,
        fee: fee(amount),
        party: CLIENTS.hollis,
        note: pick(rng, ['expenses — printing site boards', 'Materials for the model photos', 'expenses (courier + prints)', 'Reimbursing the hosting you paid']),
      });
    }

    // Smaller clients, sporadic and usually paid without an invoice.
    if (d % 23 === 11) {
      const amount = pick(rng, [25000, 18000, 32000]);
      drafts.push({ at: dayAt(d, 8, 16), code: 'T0000', amount, fee: fee(amount), party: CLIENTS.moorlane, note: pick(rng, ['Menu page updates', 'for the website changes', 'Christmas order form']) });
    }
    if (d % 47 === 30) {
      const amount = pick(rng, [60000, 45000, 72000]);
      drafts.push({ at: dayAt(d, 10, 17), code: 'T0000', amount, fee: fee(amount), party: CLIENTS.pixelpine, note: pick(rng, ['Freelance dev — 3 days', 'Illustration pack for client campaign', 'Landing page sprint']) });
    }
    if (d % 58 === 40) {
      drafts.push({ at: dayAt(d, 10, 19), code: 'T0000', amount: 22000, fee: fee(22000), party: CLIENTS.tidewell, note: 'Class timetable illustrations' });
    }

    // Kofi: a friend who pays Jo back for pizza, tickets and taxis. Goods-and-services by
    // habit, so PayPal charges a fee and nothing in the note says "personal".
    if (rng() < 0.05) {
      const amount = pick(rng, [1250, 2400, 3500, 1800, 4200, 900]);
      drafts.push({
        at: dayAt(d, 18, 23),
        code: 'T0000',
        amount,
        fee: fee(amount),
        party: FRIENDS.kofi,
        note: pick(rng, ['thanks for sorting', 'cheers', 'for last night', 'my half', 'ta 👍', 'for the thing']),
      });
    }
    // Flatmate Ruth splits the bills Jo pays.
    if (date.getUTCDate() === 6) {
      drafts.push({ at: dayAt(d, 8, 21), code: 'T0000', amount: between(rng, 38, 61) * 100 + pick(rng, [0, 50, 25]), fee: 0, party: FRIENDS.ruth, note: pick(rng, ['bills', 'electric + wifi', 'my share of bills', 'gas/electric']) });
    }
    // Family and friends, plainly personal.
    if (rng() < 0.035) {
      const who = pick(rng, [FRIENDS.mum, FRIENDS.dev, FRIENDS.sasha]);
      const amount = who === FRIENDS.mum ? pick(rng, [5000, 2000, 10000]) : pick(rng, [1500, 2000, 3000]);
      drafts.push({ at: dayAt(d), code: 'T0000', amount, fee: 0, party: who, note: who === FRIENDS.mum ? pick(rng, ['Treat yourself love mum x', 'For the train fare home', 'Happy birthday! x']) : pick(rng, ['concert tickets', 'dinner', 'holiday deposit']) });
    }
    // Jo paying friends.
    if (rng() < 0.08) {
      const who = pick(rng, [FRIENDS.kofi, FRIENDS.dev, FRIENDS.sasha, FRIENDS.ruth]);
      drafts.push({ at: dayAt(d), code: 'T0000', amount: -pick(rng, [1200, 2000, 3500, 4500, 800]), fee: 0, party: who, note: pick(rng, ['🍕', 'tickets', 'birthday gift kitty', 'taxi', 'groceries']) });
    }
    // Moving money to the bank, about twice a month.
    if (date.getUTCDate() === 14 || date.getUTCDate() === 28) {
      drafts.push({ at: dayAt(d, 6, 9), code: 'T0400', amount: -pick(rng, [60000, 80000, 100000, 120000]), fee: 0, subject: 'Withdrawal to bank account ••4821' });
    }
    // Monthly PayPal fee for cross-border sales.
    if (date.getUTCDate() === 2) {
      drafts.push({ at: dayAt(d, 3, 5), code: 'T0100', amount: -between(rng, 120, 690), fee: 0, subject: 'PayPal fee — cross-border transactions' });
    }
  }

  // One chargeback, so refunds and fees have a less obvious case.
  const cb = Math.floor(days * 0.4);
  drafts.push({ at: dayAt(cb, 10, 12), code: 'T1201', amount: -3200, fee: 0, party: CUSTOMERS[7], subject: 'Chargeback — order #FP-1093', note: 'Buyer says item not received' });
  drafts.push({ at: dayAt(cb, 12, 13), code: 'T0106', amount: -1400, fee: 0, subject: 'Chargeback processing fee' });

  drafts.sort((a, b) => a.at.getTime() - b.at.getTime());

  // Ids, running balance, PayPal shape.
  let balance = cfg.openingBalance;
  const transactions = drafts.map((x, i): PayPalTransactionDetail => {
    balance += x.amount + x.fee;
    const id = paypalId(rng, i);
    return {
      transaction_info: {
        transaction_id: id,
        transaction_event_code: x.code,
        transaction_initiation_date: isoSeconds(x.at),
        transaction_updated_date: isoSeconds(x.at),
        transaction_amount: { currency_code: cfg.currency, value: toDecimalString(x.amount) },
        ...(x.fee ? { fee_amount: { currency_code: cfg.currency, value: toDecimalString(x.fee) } } : {}),
        transaction_status: x.status ?? 'S',
        ...(x.subject ? { transaction_subject: x.subject } : {}),
        ...(x.note ? { transaction_note: x.note } : {}),
        ...(x.invoiceId ? { invoice_id: x.invoiceId } : {}),
        ending_balance: { currency_code: cfg.currency, value: toDecimalString(balance) },
        available_balance: { currency_code: cfg.currency, value: toDecimalString(balance) },
        protection_eligibility: x.code === 'T0006' ? '01' : '02',
      },
      payer_info: x.party
        ? {
            account_id: accountId(x.party.email),
            email_address: x.party.email,
            address_status: 'Y',
            payer_status: 'Y',
            payer_name: { alternate_full_name: x.party.name },
            country_code: cfg.currency === 'GBP' ? 'GB' : 'US',
          }
        : { address_status: 'N', payer_name: {} },
      shipping_info: {},
      cart_info: x.code === 'T0006' && x.subject ? { item_details: [{ item_name: x.subject.replace(/^.*order /, 'Order '), item_quantity: '1' }] } : {},
      store_info: {},
      auction_info: {},
      incentive_info: {},
    };
  });

  return { transactions, invoices };
}

function invoice(cfg: ScenarioConfig, n: number, client: Party, item: string, amount: number, date: Date): PayPalInvoice {
  const number = `FERN-${String(n).padStart(4, '0')}`;
  const day = date.toISOString().slice(0, 10);
  const value = toDecimalString(amount);
  return {
    id: `INV2-${number.replace('-', '')}-SEED`,
    status: 'PAID',
    detail: { invoice_number: number, currency_code: cfg.currency, invoice_date: day, payment_term: { term_type: 'NET_10' } },
    invoicer: { name: { full_name: PERSONA.name }, email_address: PERSONA.email },
    primary_recipients: [{ billing_info: { business_name: client.name, email_address: client.email } }],
    items: [{ name: item, quantity: '1', unit_amount: { currency_code: cfg.currency, value } }],
    amount: { currency_code: cfg.currency, value },
    due_amount: { currency_code: cfg.currency, value: '0.00' },
    payments: { paid_amount: { currency_code: cfg.currency, value }, transactions: [{ payment_date: day, method: 'PAYPAL', amount: { currency_code: cfg.currency, value } }] },
  };
}

function poisson(rng: Rng, lambda: number) {
  const l = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rng();
  } while (p > l);
  return k - 1;
}

const isoSeconds = (d: Date) => `${d.toISOString().slice(0, 19)}+0000`;
const ALPHABET = '0123456789ABCDEFGHJKLMNPRSTUVWXY';
function paypalId(rng: Rng, i: number) {
  let s = '';
  for (let k = 0; k < 17; k++) s += ALPHABET[Math.floor(rng() * ALPHABET.length)];
  // Keep ids unique even if the generator ever repeats a sequence.
  return s.slice(0, 13) + String(i).padStart(4, '0').slice(-4);
}
function accountId(email: string) {
  let h = 0;
  for (const ch of email) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h.toString(36).toUpperCase().padStart(13, 'X').slice(0, 13);
}

/** The scenario each preset uses: its own tax year, its own currency. */
export function scenarioFor(currency: Currency): ScenarioConfig {
  return currency === 'GBP'
    ? { currency, start: '2026-04-06', end: '2027-04-05', seed: 20260406, openingBalance: 41250, salesRate: 1.32 }
    : { currency, start: '2026-01-01', end: '2026-12-31', seed: 20260101, openingBalance: 52500, salesRate: 0.82 };
}

// SetAside's server-side operations. API routes and server components call these; nothing here
// runs in the browser.

import crypto from 'node:crypto';
import { classifyBatch } from './ai/classify';
import type { ClassifyInput } from './ai/heuristic';
import { aiStatus, setAiStatus, type AiStatus } from './ai/model';
import { isCategory, type Category } from './categories';
import { getDb, kvGet, kvSet, wipe } from './db';
import { initialInvoiceState, invoiceTransition, type InvoiceFlowState } from './invoice-flow';
import { parseMinor, toDecimalString, type Currency } from './money';
import { describeError, liveAdapter, liveHealth, mockAdapter, withTimeout } from './paypal';
import { fetchRange } from './paypal/sync';
import type { PayPalInvoice, PayPalTransactionDetail } from './paypal/types';
import { transition, isAutomatable, type ReviewState } from './review';
import { bestRule, deriveRule, type Rule } from './rules';
import { PERSONA } from './seed/generate';
import { quarterlyAccrual, summarise, type SetAsideSummary } from './tax/engine';
import { DEFAULT_PRESET, PRESETS, isPresetId, type PresetId, type TaxPreset } from './tax/presets';

export const DEMO_START = '2026-11-04';

// --- Settings ------------------------------------------------------------------------------------

export type Settings = { presetId: PresetId; clock: string; otherIncome: number; upliftBps: number };

export function settings(): Settings {
  const presetId = kvGet('preset');
  const preset = PRESETS[isPresetId(presetId) ? presetId : DEFAULT_PRESET];
  return {
    presetId: preset.id,
    clock: kvGet('clock') ?? DEMO_START,
    otherIncome: Number(kvGet('other_income') ?? preset.defaultOtherIncome),
    upliftBps: Number(kvGet('uplift_bps') ?? 0),
  };
}

export const presetOf = (s: Settings): TaxPreset => PRESETS[s.presetId];

export function updateSettings(patch: Partial<Pick<Settings, 'otherIncome' | 'upliftBps'>>) {
  if (patch.otherIncome !== undefined && Number.isSafeInteger(patch.otherIncome) && patch.otherIncome >= 0) kvSet('other_income', String(patch.otherIncome));
  if (patch.upliftBps !== undefined && Number.isSafeInteger(patch.upliftBps) && Math.abs(patch.upliftBps) <= 10_000) kvSet('uplift_bps', String(patch.upliftBps));
}

// The demo clock's "now": end of the clock day, but never before the real time on the real day,
// so live sandbox payments made today are always in range.
export function clockNow(clock: string): Date {
  const endOfDay = Date.parse(`${clock}T23:59:59Z`);
  const real = Date.now();
  return new Date(clock === new Date(real).toISOString().slice(0, 10) ? Math.max(real, endOfDay) : endOfDay);
}

// --- Seeding & sync --------------------------------------------------------------------------------

let seeding: Promise<void> | undefined;

export async function ensureReady() {
  if (kvGet('seeded')) return;
  seeding ??= resetDemo(DEFAULT_PRESET).finally(() => (seeding = undefined));
  await seeding;
}

export async function resetDemo(presetId: PresetId = DEFAULT_PRESET) {
  const preset = PRESETS[presetId];
  wipe();
  kvSet('preset', preset.id);
  kvSet('clock', DEMO_START);
  kvSet('other_income', String(preset.defaultOtherIncome));
  kvSet('uplift_bps', '0');
  kvSet('ai_status', JSON.stringify({ ...aiStatus(), detail: 'Waiting to classify' }));
  const db = getDb();
  const insertInvoice = db.prepare('INSERT OR REPLACE INTO invoice (id, number, status, recipient, amount_minor, currency, tx_id, invoice_date, origin, raw) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const now = clockNow(DEMO_START);
  for (const inv of await mockAdapter(preset.currency, () => now).listInvoices()) storeInvoice(insertInvoice, inv, null, 'seed');
  kvSet('seeded', '1');
  await syncTransactions();
}

// From the shared sandbox, keep what a seller would recognise as their own trading: payments
// received (T00xx with a positive amount) and refunds/chargebacks. Holds, releases, currency
// conversions and test payouts are sandbox noise.
const keepLive = (t: PayPalTransactionDetail) => {
  const code = t.transaction_info.transaction_event_code ?? '';
  const amount = parseMinor(t.transaction_info.transaction_amount?.value);
  return (code.startsWith('T00') && amount > 0) || code === 'T1107' || code === 'T1201';
};

export type SyncReport = {
  seedRows: number;
  sandboxRows: number;
  calls: number;
  windows: number;
  paypal: { mode: 'live' | 'mock'; detail: string; lastRefreshed?: string; liveBalance?: { minor: number; currency: string } };
};

/** Pull the tax year to the demo clock: seeded history from the mock, real activity from the sandbox. */
export async function syncTransactions(): Promise<SyncReport> {
  const s = settings();
  const preset = presetOf(s);
  const now = clockNow(s.clock);
  const start = new Date(`${preset.taxYear.start}T00:00:00Z`);
  const seed = await fetchRange(mockAdapter(preset.currency, () => now), start, now);
  const db = getDb();
  const upsert = db.prepare(`INSERT INTO tx (id, datetime, date, event_code, status, amount_minor, fee_minor, currency, payer_name, payer_email, subject, note, invoice_id, balance_minor, origin, raw)
    VALUES (@id, @datetime, @date, @event_code, @status, @amount_minor, @fee_minor, @currency, @payer_name, @payer_email, @subject, @note, @invoice_id, @balance_minor, @origin, @raw)
    ON CONFLICT(id) DO UPDATE SET status = excluded.status, raw = excluded.raw`);
  const insertAll = db.transaction((rows: PayPalTransactionDetail[], origin: 'seed' | 'sandbox') => {
    for (const t of rows) upsert.run(toRow(t, origin));
  });
  insertAll(seed.transactions, 'seed');

  let sandboxRows = 0;
  let calls = seed.calls;
  let windows = Math.ceil((now.getTime() - start.getTime()) / (31 * 86_400_000));
  let paypal: SyncReport['paypal'] = { mode: 'mock', detail: 'Mock PayPal: seeded demo history' };
  const health = await liveHealth();
  const live = liveAdapter();
  if (health.ok && live) {
    try {
      // The sandbox only has recent, real-dated activity: search the last 90 days up to the real
      // now (PayPal rejects end dates in the future), in 31-day windows.
      const realNow = new Date(Date.now() - 60_000);
      const liveStart = new Date(Math.max(start.getTime(), realNow.getTime() - 90 * 86_400_000));
      const res = await withTimeout(fetchRange(live, liveStart, realNow), 25_000);
      calls += res.calls;
      windows += Math.ceil((realNow.getTime() - liveStart.getTime()) / (31 * 86_400_000));
      const keep = res.transactions.filter(
        (t) => keepLive(t) && t.transaction_info.transaction_amount?.currency_code === preset.currency,
      );
      insertAll(keep, 'sandbox');
      sandboxRows = keep.length;
      const notes = [`${keep.length} live transactions merged`];
      // Balances API: the sandbox account's own figure. Safe-to-spend uses the demo history's
      // balance (the sandbox can't hold a back-dated year), so this is shown beside it, not mixed in.
      let liveBalance: { minor: number; currency: string } | undefined;
      try {
        const b = (await withTimeout(live.getBalances(), 8000)).balances.find((x) => x.currency === preset.currency);
        if (b) liveBalance = { minor: parseMinor((b.available_balance ?? b.total_balance).value), currency: b.currency };
      } catch {
        notes.push('Balances call failed');
      }
      // Invoicing: list the sandbox account's invoices. This app may lack the Invoicing permission.
      try {
        const invoices = await withTimeout(live.listInvoices(), 15_000);
        const store = db.prepare('INSERT OR REPLACE INTO invoice (id, number, status, recipient, amount_minor, currency, tx_id, invoice_date, origin, raw) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
        for (const inv of invoices) if (inv.detail.currency_code === preset.currency) storeInvoice(store, inv, null, 'sandbox');
        notes.push(`${invoices.length} sandbox invoices listed`);
      } catch (error) {
        notes.push(`Invoicing unavailable (${describeError(error)})`);
      }
      paypal = { mode: 'live', detail: `Sandbox connected: ${notes.join('; ')}`, lastRefreshed: res.lastRefreshed, liveBalance };
    } catch (error) {
      paypal = { mode: 'mock', detail: `Sandbox keys work, but Transaction Search failed (${describeError(error)}), so this is demo history only. Checkout still uses the sandbox.` };
    }
  } else {
    paypal = { mode: 'mock', detail: health.detail };
  }
  kvSet('paypal_status', JSON.stringify(paypal));
  kvSet('last_sync', JSON.stringify({ seedRows: seed.transactions.length, sandboxRows, calls, windows }));
  return { seedRows: seed.transactions.length, sandboxRows, calls, windows, paypal };
}

function toRow(t: PayPalTransactionDetail, origin: 'seed' | 'sandbox') {
  const i = t.transaction_info;
  const datetime = (i.transaction_initiation_date ?? '').replace('+0000', 'Z');
  const name = t.payer_info?.payer_name;
  return {
    id: i.transaction_id,
    datetime,
    date: datetime.slice(0, 10),
    event_code: i.transaction_event_code ?? null,
    status: i.transaction_status ?? null,
    amount_minor: parseMinor(i.transaction_amount?.value),
    fee_minor: parseMinor(i.fee_amount?.value),
    currency: i.transaction_amount?.currency_code ?? 'GBP',
    payer_name: name?.alternate_full_name ?? ([name?.given_name, name?.surname].filter(Boolean).join(' ') || null),
    payer_email: t.payer_info?.email_address?.toLowerCase() ?? null,
    subject: i.transaction_subject ?? null,
    note: i.transaction_note ?? null,
    invoice_id: i.invoice_id ?? null,
    balance_minor: i.ending_balance ? parseMinor(i.ending_balance.value) : null,
    origin,
    raw: JSON.stringify(t),
  };
}

// --- Reading -----------------------------------------------------------------------------------------

export type TxRow = {
  id: string;
  datetime: string;
  date: string;
  eventCode: string | null;
  amount: number;
  fee: number;
  net: number;
  currency: Currency;
  counterparty: string;
  email: string | null;
  subject: string | null;
  note: string | null;
  invoiceId: string | null;
  origin: 'seed' | 'sandbox';
  category: Category | null;
  confidence: number | null;
  reason: string | null;
  method: string | null;
  state: ReviewState;
  ruleId: string | null;
  model: string | null;
  invoiceState: InvoiceFlowState;
};

type DbTx = {
  id: string; datetime: string; date: string; event_code: string | null; amount_minor: number; fee_minor: number; currency: string;
  payer_name: string | null; payer_email: string | null; subject: string | null; note: string | null; invoice_id: string | null; origin: 'seed' | 'sandbox';
  category: string | null; confidence: number | null; reason: string | null; method: string | null; state: ReviewState | null; rule_id: string | null; model: string | null; invoiced: number;
};

const SELECT_ROWS = `SELECT tx.*, c.category, c.confidence, c.reason, c.method, c.state, c.rule_id, c.model,
  EXISTS(SELECT 1 FROM invoice i WHERE i.tx_id = tx.id) AS invoiced
  FROM tx LEFT JOIN classification c ON c.tx_id = tx.id`;

function describeCounterparty(r: DbTx) {
  if (r.payer_name) return r.payer_name;
  if (r.payer_email) return r.payer_email;
  if (r.event_code?.startsWith('T04')) return 'Your bank';
  if (r.event_code?.startsWith('T01')) return 'PayPal';
  return r.subject ?? 'Unknown';
}

function toTxRow(r: DbTx): TxRow {
  const category = isCategory(r.category) ? r.category : null;
  return {
    id: r.id,
    datetime: r.datetime,
    date: r.date,
    eventCode: r.event_code,
    amount: r.amount_minor,
    fee: r.fee_minor,
    net: r.amount_minor + r.fee_minor,
    currency: r.currency as Currency,
    counterparty: describeCounterparty(r),
    email: r.payer_email,
    subject: r.subject,
    note: r.note,
    invoiceId: r.invoice_id,
    origin: r.origin,
    category,
    confidence: r.confidence,
    reason: r.reason,
    method: r.method,
    state: r.state ?? 'unclassified',
    ruleId: r.rule_id,
    model: r.model,
    invoiceState: initialInvoiceState({ category, invoice_id: r.invoice_id, amount_minor: r.amount_minor }, Boolean(r.invoiced)),
  };
}

export function listRows(): TxRow[] {
  const s = settings();
  const preset = presetOf(s);
  const rows = getDb()
    .prepare(`${SELECT_ROWS} WHERE tx.date >= ? AND tx.date <= ? AND tx.currency = ? ORDER BY tx.datetime DESC`)
    .all(preset.taxYear.start, s.clock, preset.currency) as DbTx[];
  return rows.map(toTxRow);
}

function getRow(id: string): TxRow | undefined {
  const r = getDb().prepare(`${SELECT_ROWS} WHERE tx.id = ?`).get(id) as DbTx | undefined;
  return r && toTxRow(r);
}

export function listRules(): Rule[] {
  return getDb().prepare('SELECT * FROM rule ORDER BY created_at').all() as Rule[];
}

export type InvoiceView = { id: string; number: string | null; status: string; recipient: string | null; amount: number; currency: string; txId: string | null; invoiceDate: string | null; origin: string; url?: string };

export function listInvoices(): InvoiceView[] {
  const s = settings();
  const rows = getDb().prepare('SELECT * FROM invoice WHERE currency = ? AND (invoice_date IS NULL OR invoice_date <= ?) ORDER BY invoice_date DESC').all(presetOf(s).currency, s.clock) as {
    id: string; number: string | null; status: string; recipient: string | null; amount_minor: number; currency: string; tx_id: string | null; invoice_date: string | null; origin: string; raw: string;
  }[];
  return rows.map((r) => ({
    id: r.id,
    number: r.number,
    status: r.status,
    recipient: r.recipient,
    amount: r.amount_minor,
    currency: r.currency,
    txId: r.tx_id,
    invoiceDate: r.invoice_date,
    origin: r.origin,
    url: (JSON.parse(r.raw) as PayPalInvoice).detail.metadata?.recipient_view_url,
  }));
}

export function balance(): number {
  const s = settings();
  const preset = presetOf(s);
  const db = getDb();
  // Seeded history carries PayPal's own ending_balance; live sandbox rows add their net on top.
  const seed = db.prepare("SELECT balance_minor FROM tx WHERE origin = 'seed' AND currency = ? AND date <= ? ORDER BY datetime DESC LIMIT 1").get(preset.currency, s.clock) as { balance_minor: number } | undefined;
  const live = db.prepare("SELECT COALESCE(SUM(amount_minor + fee_minor), 0) AS net FROM tx WHERE origin = 'sandbox' AND currency = ? AND date <= ?").get(preset.currency, s.clock) as { net: number };
  return (seed?.balance_minor ?? 0) + live.net;
}

export type Snapshot = {
  persona: typeof PERSONA;
  settings: Settings;
  preset: TaxPreset;
  rows: TxRow[];
  rules: Rule[];
  invoices: InvoiceView[];
  summary: SetAsideSummary;
  scenario?: SetAsideSummary;
  quarters: ReturnType<typeof quarterlyAccrual>;
  status: { paypal: SyncReport['paypal']; ai: AiStatus };
  counts: { total: number; unclassified: number; needsReview: number; corrected: number; ruleMatched: number };
};

export async function snapshot(): Promise<Snapshot> {
  await ensureReady();
  const s = settings();
  const preset = presetOf(s);
  const rows = listRows();
  const taxable = rows.filter((r) => r.category).map((r) => ({ date: r.date, category: r.category!, amount: r.amount, fee: r.fee }));
  const bal = balance();
  const summary = summarise({ preset, rows: taxable, otherIncome: s.otherIncome, balance: bal, today: s.clock });
  const scenario = s.upliftBps ? summarise({ preset, rows: taxable, otherIncome: s.otherIncome, balance: bal, today: s.clock, upliftBps: s.upliftBps }) : undefined;
  return {
    persona: PERSONA,
    settings: s,
    preset,
    rows,
    rules: listRules(),
    invoices: listInvoices(),
    summary,
    scenario,
    quarters: quarterlyAccrual(preset, taxable, s.otherIncome, s.clock),
    status: { paypal: JSON.parse(kvGet('paypal_status') ?? '{"mode":"mock","detail":"Not synced yet"}'), ai: aiStatus() },
    counts: {
      total: rows.length,
      unclassified: rows.filter((r) => r.state === 'unclassified').length,
      needsReview: rows.filter((r) => r.state === 'needs_review').length,
      corrected: rows.filter((r) => r.state === 'corrected').length,
      ruleMatched: rows.filter((r) => r.state === 'rule_matched').length,
    },
  };
}

// --- Classification ------------------------------------------------------------------------------------

const BATCH = 120;

export type ClassifyReport = { classified: number; byRule: number; remaining: number; method: string; model?: string; detail: string };

/** Classify the next unclassified rows: the person's rules first, then the AI for the rest. */
export async function classifyNext(limit = BATCH * 2): Promise<ClassifyReport> {
  await ensureReady();
  const s = settings();
  const preset = presetOf(s);
  const db = getDb();
  const pending = db
    .prepare(`SELECT tx.* FROM tx LEFT JOIN classification c ON c.tx_id = tx.id
      WHERE c.tx_id IS NULL AND tx.date >= ? AND tx.date <= ? AND tx.currency = ? ORDER BY tx.datetime LIMIT ?`)
    .all(preset.taxYear.start, s.clock, preset.currency, limit) as (ClassifyInput & { datetime: string })[];
  const rules = listRules();
  const write = db.prepare(`INSERT OR REPLACE INTO classification (tx_id, category, confidence, reason, method, state, rule_id, model, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const now = new Date().toISOString();

  let byRule = 0;
  const forAi: ClassifyInput[] = [];
  for (const row of pending) {
    const rule = bestRule(rules, row);
    if (rule) {
      write.run(row.id, rule.category, 99, `Your rule: ${rule.description}.`, 'rule', transition(transition('unclassified', { type: 'CLASSIFIED', confidence: 99 }), { type: 'RULE_MATCH' }), rule.id, null, now);
      byRule++;
    } else forAi.push({ ...row, date: row.date });
  }

  const batches: ClassifyInput[][] = [];
  for (let i = 0; i < forAi.length; i += BATCH) batches.push(forAi.slice(i, i + BATCH));
  const results = await Promise.all(batches.map((b) => classifyBatch(b, rules, preset.currency)));
  let method = byRule && !forAi.length ? 'rule' : 'ai';
  let model: string | undefined;
  let fallback: string | undefined;
  let cached = false;
  db.transaction(() => {
    for (const res of results) {
      method = res.method;
      model = res.model ?? model;
      fallback = res.fallbackReason ?? fallback;
      cached ||= res.cached;
      for (const item of res.items) {
        const confidence = Math.round(item.confidence * 100);
        write.run(item.id, item.category, confidence, item.reason, res.method, transition('unclassified', { type: 'CLASSIFIED', confidence }), null, res.model ?? null, now);
      }
    }
  })();

  if (results.length) {
    const ai: Omit<AiStatus, 'at'> =
      method === 'ai'
        ? { mode: cached ? 'cached' : 'live', model, detail: cached ? `Gemini (${model}), cached answer` : `Gemini (${model}) classified ${forAi.length} rows` }
        : method === 'recorded'
          ? { mode: 'recorded', model, detail: `Recorded Gemini answers: ${fallback}` }
          : { mode: 'offline', detail: `Offline rules: ${fallback}` };
    setAiStatus(ai);
  }
  const remaining = (db
    .prepare(`SELECT COUNT(*) AS n FROM tx LEFT JOIN classification c ON c.tx_id = tx.id WHERE c.tx_id IS NULL AND tx.date >= ? AND tx.date <= ? AND tx.currency = ?`)
    .get(preset.taxYear.start, s.clock, preset.currency) as { n: number }).n;
  return { classified: pending.length, byRule, remaining, method, model, detail: aiStatus().detail };
}

export type CorrectionReport = { rule?: Rule; updated: string[] };

/** The person changes a row's category. It becomes a rule, applied to every similar row they haven't decided. */
export function correct(txId: string, category: Category): CorrectionReport {
  const db = getDb();
  const row = db.prepare('SELECT tx.*, c.state FROM tx LEFT JOIN classification c ON c.tx_id = tx.id WHERE tx.id = ?').get(txId) as (DbTx & { state: ReviewState | null }) | undefined;
  if (!row) throw new Error(`No transaction ${txId}`);
  const now = new Date().toISOString();
  const state = transition(row.state === null || row.state === 'unclassified' ? 'needs_review' : row.state, { type: 'CORRECT' });
  db.prepare(`INSERT OR REPLACE INTO classification (tx_id, category, confidence, reason, method, state, rule_id, model, updated_at)
    VALUES (?, ?, 100, ?, 'manual', ?, NULL, NULL, ?)`).run(txId, category, 'You set this.', state, now);

  const rule = deriveRule(row, category, `rule-${crypto.randomUUID().slice(0, 8)}`);
  const same = listRules().find((r) => r.payer_email === rule.payer_email && r.note_contains === rule.note_contains && r.event_code === rule.event_code);
  if (same) db.prepare('DELETE FROM rule WHERE id = ?').run(same.id);
  db.prepare('INSERT INTO rule (id, payer_email, payer_name, note_contains, event_code, category, created_from, description, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    rule.id, rule.payer_email, rule.payer_name, rule.note_contains, rule.event_code, rule.category, rule.created_from, rule.description, now,
  );

  // Apply the rule set to every automatable row (any date, so future rows follow it as well).
  const rules = listRules();
  const candidates = db.prepare(`SELECT tx.*, c.state, c.category FROM tx JOIN classification c ON c.tx_id = tx.id WHERE tx.id != ?`).all(txId) as (DbTx & { state: ReviewState })[];
  const update = db.prepare("UPDATE classification SET category = ?, confidence = 99, reason = ?, method = 'rule', state = ?, rule_id = ?, updated_at = ? WHERE tx_id = ?");
  const updated: string[] = [];
  db.transaction(() => {
    for (const c of candidates) {
      if (!isAutomatable(c.state)) continue;
      const best = bestRule(rules, c);
      if (best?.id !== rule.id) continue;
      if (c.category === best.category && c.state === 'rule_matched') continue;
      update.run(best.category, `Your rule: ${best.description}.`, transition(c.state, { type: 'RULE_MATCH' }), best.id, now, c.id);
      updated.push(c.id);
    }
  })();
  return { rule: listRules().find((r) => r.id === rule.id), updated };
}

export function accept(txIds: string[]) {
  const db = getDb();
  const read = db.prepare('SELECT state FROM classification WHERE tx_id = ?');
  const write = db.prepare("UPDATE classification SET state = ?, updated_at = ? WHERE tx_id = ?");
  const now = new Date().toISOString();
  db.transaction(() => {
    for (const id of txIds) {
      const row = read.get(id) as { state: ReviewState } | undefined;
      if (row) write.run(transition(row.state, { type: 'ACCEPT' }), now, id);
    }
  })();
}

export function deleteRule(id: string) {
  getDb().prepare('DELETE FROM rule WHERE id = ?').run(id);
}

// --- Demo clock -------------------------------------------------------------------------------------------

export async function setClock(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Clock must be YYYY-MM-DD');
  const preset = presetOf(settings());
  const clamped = date > preset.taxYear.end ? preset.taxYear.end : date < DEMO_START ? DEMO_START : date;
  kvSet('clock', clamped);
  return syncTransactions();
}

// --- Invoicing ----------------------------------------------------------------------------------------------

export type RaiseInvoiceReport = { invoice: InvoiceView; steps: { call: string; ok: boolean; detail?: string }[]; mode: 'live' | 'mock'; state: InvoiceFlowState; note?: string };

/** Raise a PayPal invoice for a client payment that arrived without one, and record it as paid. */
export async function raiseInvoice(txId: string): Promise<RaiseInvoiceReport> {
  const row = getRow(txId);
  if (!row) throw new Error(`No transaction ${txId}`);
  let state = row.invoiceState;
  if (state !== 'missing' && state !== 'failed') throw new Error('This payment does not need an invoice');
  state = invoiceTransition(state, { type: 'START' });
  const s = settings();
  const draft = {
    currency: row.currency,
    recipientName: row.counterparty,
    recipientEmail: row.email ?? undefined,
    itemName: row.note ? `Work: ${row.note}` : 'Freelance work',
    amountMinor: row.amount,
    invoiceDate: row.date,
    paidByTransactionId: row.id,
    paymentDate: row.date,
  };
  const db = getDb();
  const insert = db.prepare('INSERT OR REPLACE INTO invoice (id, number, status, recipient, amount_minor, currency, tx_id, invoice_date, origin, raw) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const live = liveAdapter();
  const health = await liveHealth();
  let note: string | undefined;
  if (live && health.ok) {
    try {
      const res = await live.createPaidInvoice(draft);
      state = invoiceTransition(invoiceTransition(state, { type: 'CREATED' }), { type: 'RECORDED' });
      storeInvoice(insert, res.invoice, row.id, 'sandbox');
      return { invoice: listInvoices().find((i) => i.id === res.invoice.id)!, steps: res.steps, mode: 'live', state };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      note = /403/.test(msg)
        ? 'PayPal refused live Invoicing (403 NOT_AUTHORIZED: this sandbox app lacks the Invoicing permission), so the invoice was created by the mock adapter instead.'
        : `Live Invoicing failed (${msg.slice(0, 100)}), so the invoice was created by the mock adapter instead.`;
    }
  }
  const res = await mockAdapter(row.currency, () => clockNow(s.clock)).createPaidInvoice(draft);
  state = invoiceTransition(invoiceTransition(state, { type: 'CREATED' }), { type: 'RECORDED' });
  storeInvoice(insert, res.invoice, row.id, 'mock');
  return { invoice: listInvoices().find((i) => i.id === res.invoice.id)!, steps: res.steps, mode: 'mock', state, note };
}

function storeInvoice(stmt: { run: (...args: unknown[]) => unknown }, inv: PayPalInvoice, txId: string | null, origin: string) {
  const r = inv.primary_recipients?.[0]?.billing_info;
  stmt.run(
    inv.id,
    inv.detail.invoice_number,
    inv.status,
    r?.business_name ?? r?.name?.full_name ?? r?.email_address ?? null,
    parseMinor(inv.amount?.value),
    inv.detail.currency_code,
    txId,
    inv.detail.invoice_date ?? null,
    origin,
    JSON.stringify(inv),
  );
}

// --- PayPal Checkout (JS SDK buttons) -------------------------------------------------------------

export type CheckoutRecord = { txId: string; mode: 'live' | 'mock'; status: string; amount: number; currency: string; payer: string; note: string };

/**
 * Record a payment captured through the PayPal buttons straight away. Transaction Search only
 * shows new activity after up to three hours, so the row goes in now from the capture response,
 * shaped like a Transaction Search item, and the next sync replaces it with PayPal's own copy
 * (same id).
 */
export function recordCheckout(c: {
  captureId: string;
  amountMinor: number;
  feeMinor: number;
  currency: string;
  payerName: string;
  payerEmail?: string;
  description: string;
  createdAt: string;
  status: string;
  mode: 'live' | 'mock';
}): CheckoutRecord {
  const detail: PayPalTransactionDetail = {
    transaction_info: {
      transaction_id: c.captureId,
      transaction_event_code: 'T0006',
      transaction_initiation_date: `${c.createdAt.slice(0, 19)}+0000`,
      transaction_updated_date: `${c.createdAt.slice(0, 19)}+0000`,
      transaction_amount: { currency_code: c.currency, value: toDecimalString(c.amountMinor) },
      ...(c.feeMinor ? { fee_amount: { currency_code: c.currency, value: toDecimalString(-Math.abs(c.feeMinor)) } } : {}),
      transaction_status: c.status === 'COMPLETED' ? 'S' : 'P',
      transaction_subject: c.description,
      transaction_note: c.mode === 'live' ? 'Paid with PayPal Checkout (not yet in Transaction Search)' : 'Paid with PayPal Checkout (mock)',
    },
    payer_info: { email_address: c.payerEmail, payer_name: { alternate_full_name: c.payerName } },
  };
  const row = toRow(detail, 'sandbox');
  // The demo clock may be behind or ahead of real time; date the row on the clock so it shows.
  const clock = settings().clock;
  row.date = clock;
  row.datetime = `${clock}T${c.createdAt.slice(11, 19) || '12:00:00'}Z`;
  getDb()
    .prepare(`INSERT OR REPLACE INTO tx (id, datetime, date, event_code, status, amount_minor, fee_minor, currency, payer_name, payer_email, subject, note, invoice_id, balance_minor, origin, raw)
      VALUES (@id, @datetime, @date, @event_code, @status, @amount_minor, @fee_minor, @currency, @payer_name, @payer_email, @subject, @note, @invoice_id, @balance_minor, @origin, @raw)`)
    .run(row);
  return { txId: c.captureId, mode: c.mode, status: c.status, amount: c.amountMinor, currency: c.currency, payer: c.payerName, note: row.note ?? '' };
}

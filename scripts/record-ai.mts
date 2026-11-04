// Runs the real Gemini classifier over the whole seeded scenario and saves the answers to
// fixtures/ai/classifications-<CUR>.json. SetAside replays these when Gemini is rate-limited or
// no key is set, and labels them "recorded" in the status chip.
//   GOOGLE_GENERATIVE_AI_API_KEY=... npx tsx scripts/record-ai.mts GBP
import fs from 'node:fs';
import path from 'node:path';
import { classifyBatch } from '../lib/ai/classify';
import type { ClassifyInput } from '../lib/ai/heuristic';
import { parseMinor, type Currency } from '../lib/money';
import { loadFixture } from '../lib/paypal/mock';

const currency = (process.argv[2] ?? 'GBP') as Currency;
const file = path.join(process.cwd(), 'fixtures', 'ai', `classifications-${currency}.json`);
const existing = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { items: {} };
const rows: ClassifyInput[] = loadFixture(currency).transactions.map((t) => {
  const i = t.transaction_info;
  return {
    id: i.transaction_id,
    date: (i.transaction_initiation_date ?? '').slice(0, 10),
    event_code: i.transaction_event_code ?? null,
    amount_minor: parseMinor(i.transaction_amount?.value),
    fee_minor: parseMinor(i.fee_amount?.value),
    currency,
    payer_name: t.payer_info?.payer_name?.alternate_full_name ?? null,
    payer_email: t.payer_info?.email_address ?? null,
    subject: i.transaction_subject ?? null,
    note: i.transaction_note ?? null,
    invoice_id: i.invoice_id ?? null,
  };
}).filter((r) => !existing.items[r.id]);

const BATCH = 120;
let model = existing.model;
for (let i = 0; i < rows.length; i += BATCH) {
  const batch = rows.slice(i, i + BATCH);
  const res = await classifyBatch(batch, [], currency);
  if (res.method !== 'ai') {
    console.error(`stopped at ${i}: ${res.fallbackReason}`);
    break;
  }
  model = res.model;
  for (const item of res.items) existing.items[item.id] = { category: item.category, confidence: item.confidence, reason: item.reason };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ model, recordedAt: new Date().toISOString(), items: existing.items }, null, 1));
  console.log(`${i + batch.length}/${rows.length} via ${res.model}${res.cached ? ' (cached)' : ''}`);
}

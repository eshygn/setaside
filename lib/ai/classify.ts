// The classifier agent: Gemini reads a batch of PayPal transactions and must answer through one
// tool call, `record_classifications`, whose zod schema fixes the categories, a 0–1 confidence
// and a one-line reason. No free text is parsed. The person's rules ride along as examples.
//
// Fallbacks, in order: the SQLite cache (same batch, same rules) → Gemini live → responses
// recorded from a real Gemini run (fixtures/ai) → the deterministic heuristic.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { generateText, tool } from 'ai';
import { z } from 'zod';
import { CATEGORIES, CATEGORY_META } from '../categories';
import { getDb } from '../db';
import { toDecimalString } from '../money';
import type { Rule } from '../rules';
import { heuristicClassify, type Classification, type ClassifyInput } from './heuristic';
import { AiUnavailableError, withModel } from './model';

// --- Tool schema ------------------------------------------------------------------------------

export const ClassificationSchema = z.object({
  id: z.string().describe('The transaction id exactly as given.'),
  category: z.enum(CATEGORIES).describe('What this transaction is for tax purposes.'),
  confidence: z.number().min(0).max(1).describe('0–1. Below 0.8 means a person should check it.'),
  reason: z.string().min(3).max(160).describe('One short sentence a non-accountant understands.'),
});

export const RecordClassificationsInput = z.object({
  items: z.array(ClassificationSchema).describe('One entry per transaction in the batch.'),
});

export const recordClassificationsTool = tool({
  description: 'Record the category, confidence and reason for every transaction in the batch.',
  inputSchema: RecordClassificationsInput,
});

// --- Prompt -------------------------------------------------------------------------------------

export const SYSTEM_PROMPT = `You classify PayPal transactions for someone with a side business, so they know how much tax to put aside.
Categories:
${CATEGORIES.map((c) => `- ${c}: ${CATEGORY_META[c].hint}`).join('\n')}
Guidance:
- T-codes are PayPal event codes: T0006 checkout order, T0007 website/invoice payment, T0000 general payment, T01xx fee, T04xx withdrawal to bank, T1107 refund, T1201 chargeback.
- A withdrawal to the person's own bank is a personal_transfer (moving money, not income).
- A fee on a payment does not make it business: friends often pay with goods-and-services by habit.
- Money a client pays back for costs the person covered is a reimbursement, not income.
- Confidence must be calibrated, because rows under 0.8 go to a person for review:
  - 0.95+ only when the code and text leave no doubt: checkout orders (T0006), payments against an invoice, PayPal fee entries, withdrawals, refunds.
  - 0.80–0.94 for a business paying from a business address with a work-like note.
  - 0.40–0.75 when it could go either way: goods-and-services payments from a personal address with a vague note ("thanks", "cheers", "my half", "for the thing"), or a client's payment that mentions expenses, materials or hosting (reimbursement or income?), or a flatmate's bill money.
- The person's own rules are always right; follow them for matching rows.
Call record_classifications once with every id.`;

export function promptFor(rows: readonly ClassifyInput[], rules: readonly Rule[]): string {
  const ruleLines = rules.length
    ? `The person's rules (learned from their corrections):\n${rules.map((r) => `- ${r.description}`).join('\n')}\n\n`
    : '';
  const lines = rows.map((r) =>
    [
      r.id,
      r.date,
      r.event_code ?? '',
      `${toDecimalString(r.amount_minor)} ${r.currency}`,
      r.fee_minor ? `fee ${toDecimalString(r.fee_minor)}` : 'no fee',
      r.payer_name ? `${r.payer_name} <${r.payer_email ?? ''}>` : 'no counterparty',
      r.invoice_id ? `invoice ${r.invoice_id}` : '',
      JSON.stringify(`${r.subject ?? ''}${r.subject && r.note ? ' — ' : ''}${r.note ?? ''}`),
    ].join(' | '),
  );
  return `${ruleLines}Transactions (id | date | code | amount | fee | counterparty | invoice | subject — note):\n${lines.join('\n')}`;
}

// --- Recorded responses --------------------------------------------------------------------------

type Recorded = { model: string; recordedAt: string; items: Record<string, Omit<Classification, 'id'>> };
const recordedCache = new Map<string, Recorded | null>();

export function recordedFor(currency: string): Recorded | null {
  if (!recordedCache.has(currency)) {
    const file = path.join(process.cwd(), 'fixtures', 'ai', `classifications-${currency}.json`);
    recordedCache.set(currency, fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, 'utf8')) as Recorded) : null);
  }
  return recordedCache.get(currency) ?? null;
}

// --- Classify a batch -----------------------------------------------------------------------------

export type BatchResult = {
  items: Classification[];
  method: 'ai' | 'recorded' | 'heuristic';
  cached: boolean;
  model?: string;
  fallbackReason?: string;
};

export async function classifyBatch(rows: readonly ClassifyInput[], rules: readonly Rule[], currency: string): Promise<BatchResult> {
  if (rows.length === 0) return { items: [], method: 'ai', cached: false };
  const prompt = promptFor(rows, rules);
  const key = crypto.createHash('sha256').update(SYSTEM_PROMPT).update(prompt).digest('hex');
  const db = getDb();
  const hit = db.prepare('SELECT value FROM ai_cache WHERE key = ?').get(key) as { value: string } | undefined;
  if (hit) {
    const cached = JSON.parse(hit.value) as { model: string; items: Classification[] };
    return { items: complete(rows, cached.items), method: 'ai', cached: true, model: cached.model };
  }

  try {
    const { value, model } = await withModel(async (m) => {
      const result = await generateText({
        model: m,
        system: SYSTEM_PROMPT,
        prompt,
        tools: { record_classifications: recordClassificationsTool },
        toolChoice: { type: 'tool', toolName: 'record_classifications' },
        maxRetries: 0,
        abortSignal: AbortSignal.timeout(75_000),
        providerOptions: { google: { thinkingConfig: { thinkingLevel: 'low' } } },
      });
      const call = result.toolCalls.find((c) => c.toolName === 'record_classifications');
      if (!call) throw new Error('Model did not call record_classifications');
      return RecordClassificationsInput.parse(call.input).items;
    });
    db.prepare('INSERT OR REPLACE INTO ai_cache (key, value, created_at) VALUES (?, ?, ?)').run(key, JSON.stringify({ model, items: value }), new Date().toISOString());
    return { items: complete(rows, value), method: 'ai', cached: false, model };
  } catch (error) {
    const reason = error instanceof AiUnavailableError ? error.message : `Gemini error: ${error instanceof Error ? error.message.slice(0, 120) : String(error)}`;
    const recorded = recordedFor(currency);
    if (recorded && rows.every((r) => recorded.items[r.id])) {
      return { items: rows.map((r) => ({ id: r.id, ...recorded.items[r.id] })), method: 'recorded', cached: false, model: recorded.model, fallbackReason: reason };
    }
    if (recorded) {
      const items = rows.map((r) => (recorded.items[r.id] ? { id: r.id, ...recorded.items[r.id] } : heuristicClassify(r)));
      return { items, method: 'recorded', cached: false, model: recorded.model, fallbackReason: `${reason}; rows without a recording use the offline rules` };
    }
    return { items: rows.map(heuristicClassify), method: 'heuristic', cached: false, fallbackReason: reason };
  }
}

/** Keep only answers for ids we asked about, and fill any the model skipped. */
function complete(rows: readonly ClassifyInput[], items: readonly Classification[]): Classification[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  return rows.map((r) => {
    const answer = byId.get(r.id);
    return answer ? { ...answer, confidence: Math.max(0, Math.min(1, answer.confidence)) } : { ...heuristicClassify(r), reason: 'Not answered by the model; classified by offline rules.' };
  });
}

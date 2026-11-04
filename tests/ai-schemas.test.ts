import { describe, expect, it } from 'vitest';
import { geminiSchema, toModelMessages, turnKey, type AgentItem } from '@/lib/ai/agent';
import { ClassificationSchema, RecordClassificationsInput, promptFor } from '@/lib/ai/classify';
import { heuristicClassify, type ClassifyInput } from '@/lib/ai/heuristic';
import { bestRule, deriveRule, ruleMatches, type RuleTx } from '@/lib/rules';

const tx = (over: Partial<ClassifyInput>): ClassifyInput => ({
  id: 'TX1',
  date: '2026-06-01',
  event_code: 'T0000',
  amount_minor: 2400,
  fee_minor: -100,
  currency: 'GBP',
  payer_name: 'Kofi Asante',
  payer_email: 'kofi.asante@mail.example',
  subject: null,
  note: 'cheers',
  invoice_id: null,
  ...over,
});

describe('classification tool schema', () => {
  it('accepts a well-formed answer', () => {
    const ok = RecordClassificationsInput.safeParse({ items: [{ id: 'a', category: 'sale', confidence: 0.92, reason: 'Checkout order.' }] });
    expect(ok.success).toBe(true);
  });
  it('rejects unknown categories, out-of-range confidence and empty reasons', () => {
    expect(ClassificationSchema.safeParse({ id: 'a', category: 'income', confidence: 0.9, reason: 'x x x' }).success).toBe(false);
    expect(ClassificationSchema.safeParse({ id: 'a', category: 'sale', confidence: 1.4, reason: 'fine' }).success).toBe(false);
    expect(ClassificationSchema.safeParse({ id: 'a', category: 'sale', confidence: 0.9, reason: '' }).success).toBe(false);
  });
  it('puts the person’s rules and every id in the prompt', () => {
    const rule = deriveRule({ ...tx({}), id: 'TX1' }, 'personal_transfer', 'r1');
    const prompt = promptFor([tx({}), tx({ id: 'TX2' })], [{ ...rule }]);
    expect(prompt).toContain(rule.description);
    expect(prompt).toContain('TX1 |');
    expect(prompt).toContain('TX2 |');
  });
});

describe('heuristic fallback', () => {
  it('is sure about PayPal’s own codes and unsure about friends paying with a fee', () => {
    expect(heuristicClassify(tx({ event_code: 'T0006', payer_email: 'a@b.example' })).category).toBe('sale');
    expect(heuristicClassify(tx({ event_code: 'T0400', amount_minor: -60000 })).category).toBe('personal_transfer');
    const kofi = heuristicClassify(tx({}));
    expect(kofi.confidence).toBeLessThan(0.8);
  });
});

describe('rules from corrections', () => {
  const base: RuleTx = { id: 'H1', event_code: 'T0000', amount_minor: 4200, payer_name: 'Hollis & Vane Architects', payer_email: 'studio@hollisvane.example', subject: null, note: 'expenses — printing site boards' };
  it('remembers the payer and the telling words of the category', () => {
    const r = deriveRule(base, 'reimbursement', 'r1');
    expect(r.payer_email).toBe('studio@hollisvane.example');
    expect(ruleMatches(r, { ...base, id: 'H2', note: 'Materials for the model photos' })).toBe(true);
    // The same client's ordinary project payments are left alone.
    expect(ruleMatches(r, { ...base, id: 'H3', note: 'Stage 2 — thanks Jo' })).toBe(false);
  });
  it('prefers the most specific rule', () => {
    const broad = deriveRule({ ...base, note: 'Stage payment' }, 'client_payment', 'broad');
    const narrow = deriveRule(base, 'reimbursement', 'narrow');
    expect(bestRule([broad, narrow], { ...base, id: 'H4', note: 'expenses (courier + prints)' })?.id).toBe('narrow');
    expect(bestRule([broad, narrow], { ...base, id: 'H5', note: 'Final payment' })?.id).toBe('broad');
  });
  it('falls back to the PayPal event code when there is no counterparty', () => {
    const r = deriveRule({ ...base, payer_email: null, payer_name: null, event_code: 'T0400', note: null, subject: 'Withdrawal' }, 'personal_transfer', 'w');
    expect(r.event_code).toBe('T0400');
    expect(ruleMatches(r, { ...base, payer_email: null, event_code: 'T0400' })).toBe(true);
  });
});

describe('agent adapter helpers', () => {
  it('strips the `not` sentinel Gemini rejects', () => {
    const s = geminiSchema({ type: 'object', properties: { title: { anyOf: [{ type: 'string' }, { not: {} }] } } });
    expect(s).toEqual({ type: 'object', properties: { title: { type: 'string' } } });
  });
  it('turns Studio conversation items into AI SDK messages, pairing calls with results', () => {
    const items: AgentItem[] = [
      { kind: 'input', type: 'message', role: 'user', content: [{ type: 'text', text: 'Show refunds against sales by month.' }] },
      { kind: 'output', type: 'function_call', callId: 'c1', name: 'build_chart', arguments: '{"type":"line-chart"}' },
      { kind: 'input', type: 'function_call_output', callId: 'c1', output: '{"widgetId":"chart-1"}' },
    ];
    const { messages } = toModelMessages(items, () => 'sig');
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'tool']);
    const call = (messages[1].content as { type: string; toolName: string; input: unknown }[])[0];
    expect(call).toMatchObject({ type: 'tool-call', toolName: 'build_chart', input: { type: 'line-chart' } });
    const result = (messages[2].content as { toolName: string }[])[0];
    expect(result.toolName).toBe('build_chart');
  });
  it('keys recordings by question and round, ignoring punctuation and case', () => {
    const q = (text: string, rounds = 0): AgentItem[] => [
      { kind: 'input', type: 'message', role: 'user', content: [{ type: 'text', text }] },
      ...Array.from({ length: rounds }, (_, i) => ({ kind: 'input' as const, type: 'function_call_output' as const, callId: `c${i}`, output: '' })),
    ];
    expect(turnKey(q('What if I’d charged 10% more?')).key).toBe(turnKey(q('what if I’d charged 10% more')).key);
    expect(turnKey(q('x', 2)).round).toBe(2);
  });
});

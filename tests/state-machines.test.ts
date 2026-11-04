import { describe, expect, it } from 'vitest';
import { initialInvoiceState, invoiceTransition } from '@/lib/invoice-flow';
import { REVIEW_THRESHOLD, isAutomatable, transition, type ReviewState } from '@/lib/review';

describe('review state machine', () => {
  it('routes classifications by confidence', () => {
    expect(transition('unclassified', { type: 'CLASSIFIED', confidence: REVIEW_THRESHOLD })).toBe('auto_ok');
    expect(transition('unclassified', { type: 'CLASSIFIED', confidence: REVIEW_THRESHOLD - 1 })).toBe('needs_review');
  });
  it('lets rules take over anything automated', () => {
    for (const s of ['needs_review', 'auto_ok', 'rule_matched'] as ReviewState[]) expect(transition(s, { type: 'RULE_MATCH' })).toBe('rule_matched');
  });
  it('never lets automation overwrite a person', () => {
    for (const s of ['confirmed', 'corrected'] as ReviewState[]) {
      expect(transition(s, { type: 'RULE_MATCH' })).toBe(s);
      expect(transition(s, { type: 'CLASSIFIED', confidence: 99 })).toBe(s);
      expect(isAutomatable(s)).toBe(false);
    }
  });
  it('accepts and corrects only classified rows', () => {
    expect(transition('needs_review', { type: 'ACCEPT' })).toBe('confirmed');
    expect(transition('auto_ok', { type: 'CORRECT' })).toBe('corrected');
    expect(transition('confirmed', { type: 'CORRECT' })).toBe('corrected');
    expect(transition('corrected', { type: 'ACCEPT' })).toBe('corrected');
    expect(transition('unclassified', { type: 'ACCEPT' })).toBe('unclassified');
    expect(transition('unclassified', { type: 'CORRECT' })).toBe('unclassified');
  });
  it('resets from anywhere', () => {
    expect(transition('corrected', { type: 'RESET' })).toBe('unclassified');
  });
});

describe('invoice flow', () => {
  it('only client payments without an invoice need one', () => {
    expect(initialInvoiceState({ category: 'client_payment', invoice_id: null, amount_minor: 100 }, false)).toBe('missing');
    expect(initialInvoiceState({ category: 'client_payment', invoice_id: 'FERN-0012', amount_minor: 100 }, false)).toBe('not_needed');
    expect(initialInvoiceState({ category: 'sale', invoice_id: null, amount_minor: 100 }, false)).toBe('not_needed');
    expect(initialInvoiceState({ category: 'client_payment', invoice_id: null, amount_minor: -100 }, false)).toBe('not_needed');
    expect(initialInvoiceState({ category: 'client_payment', invoice_id: null, amount_minor: 100 }, true)).toBe('paid');
  });
  it('goes missing → creating → recording → paid', () => {
    let s = invoiceTransition('missing', { type: 'START' });
    expect(s).toBe('creating');
    s = invoiceTransition(s, { type: 'CREATED' });
    expect(s).toBe('recording');
    expect(invoiceTransition(s, { type: 'RECORDED' })).toBe('paid');
  });
  it('can fail and retry, but never un-pays', () => {
    expect(invoiceTransition('creating', { type: 'FAILED' })).toBe('failed');
    expect(invoiceTransition('failed', { type: 'START' })).toBe('creating');
    expect(invoiceTransition('paid', { type: 'START' })).toBe('paid');
    expect(invoiceTransition('missing', { type: 'RECORDED' })).toBe('missing');
  });
});

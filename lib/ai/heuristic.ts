// A deterministic classifier from PayPal event codes and note keywords. It is the last fallback
// (no key, quota gone, nothing recorded) and a sanity check in tests. It is deliberately
// cautious: anything it can't tell apart gets a low confidence so it lands in the review queue.

import type { Category } from '../categories';

export type ClassifyInput = {
  id: string;
  date: string;
  event_code: string | null;
  amount_minor: number;
  fee_minor: number;
  currency: string;
  payer_name: string | null;
  payer_email: string | null;
  subject: string | null;
  note: string | null;
  invoice_id: string | null;
};

export type Classification = { id: string; category: Category; confidence: number; reason: string };

const FREE_MAIL = /@(mail\.example|gmail\.com|outlook\.com|hotmail\.|yahoo\.|icloud\.com|proton)/i;

export function heuristicClassify(tx: ClassifyInput): Classification {
  const text = `${tx.note ?? ''} ${tx.subject ?? ''}`.toLowerCase();
  const out = (category: Category, confidence: number, reason: string): Classification => ({ id: tx.id, category, confidence, reason });
  const code = tx.event_code ?? '';

  if (code === 'T1107' || code === 'T1201' || text.includes('refund')) return out('refund', 0.96, `PayPal ${code === 'T1201' ? 'chargeback' : 'refund'} back to a customer.`);
  if (code.startsWith('T01')) return out('fee', 0.97, 'A PayPal fee entry, not a payment.');
  if (code.startsWith('T04')) return out('personal_transfer', 0.93, 'Withdrawal to your own bank account: moving money, not income.');
  if (code === 'T0006' && tx.amount_minor > 0) return out('sale', 0.97, 'A PayPal Checkout order from your shop.');
  if (tx.invoice_id && tx.amount_minor > 0) return out('client_payment', 0.95, `Paid against invoice ${tx.invoice_id}.`);
  if (tx.amount_minor < 0) return out('personal_transfer', 0.82, 'Money you sent to someone, with no business reference.');

  if (/(expense|material|reimburs|hosting|courier)/.test(text)) {
    return out('reimbursement', 0.6, 'Note mentions costs being paid back, but the payer is also a client.');
  }
  if (/(bill|electric|wifi|gas)/.test(text)) return out('reimbursement', 0.7, 'Looks like a household bill being split.');
  if (/(mum|love|birthday|x$|happy)/.test(text)) return out('personal_transfer', 0.9, 'Reads like a gift from family.');

  const personalAddress = tx.payer_email ? FREE_MAIL.test(tx.payer_email) : true;
  if (!personalAddress) return out('client_payment', 0.85, `Payment from a business (${tx.payer_name ?? tx.payer_email}).`);
  if (tx.fee_minor !== 0) {
    return out('client_payment', 0.52, 'A goods-and-services payment, so it could be work, but it comes from a personal address with a vague note.');
  }
  return out('personal_transfer', 0.74, 'Friends-and-family payment from a personal address.');
}

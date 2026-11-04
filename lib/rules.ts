// Corrections become rules. When the person changes a row's category, SetAside writes down what
// made that row recognisable (who paid, and a telling word in the note if there is one) and
// applies it to every similar row the person hasn't decided themselves. The classifier also gets
// the rules as examples, so new rows follow them too.

import { categoryLabel, type Category } from './categories';

export type RuleTx = {
  id: string;
  event_code: string | null;
  amount_minor: number;
  payer_name: string | null;
  payer_email: string | null;
  subject: string | null;
  note: string | null;
};

export type Rule = {
  id: string;
  payer_email: string | null;
  payer_name: string | null;
  note_contains: string | null;
  event_code: string | null;
  category: Category;
  created_from: string;
  description: string;
};

// Words that, in a note, tell this category apart from the payer's other payments.
const TELLING_WORDS: Partial<Record<Category, string[]>> = {
  reimbursement: ['expense', 'material', 'reimburs', 'hosting', 'courier', 'bills', 'electric', 'share'],
  refund: ['refund', 'chargeback'],
  fee: ['fee'],
};

export function deriveRule(tx: RuleTx, category: Category, id: string): Rule {
  const text = `${tx.note ?? ''} ${tx.subject ?? ''}`.toLowerCase();
  // If the note has a telling word, the rule matches any of that category's words, so "expenses"
  // and "materials" from the same client are treated alike.
  const vocab = TELLING_WORDS[category] ?? [];
  const found = vocab.find((w) => text.includes(w));
  const word = found ? vocab.join('|') : null;
  const who = tx.payer_name ?? tx.payer_email;
  const direction = tx.amount_minor < 0 ? 'to' : 'from';
  if (tx.payer_email) {
    return {
      id,
      payer_email: tx.payer_email.toLowerCase(),
      payer_name: tx.payer_name,
      note_contains: word,
      event_code: null,
      category,
      created_from: tx.id,
      description: word
        ? `Payments ${direction} ${who} that mention ${describeWords(found!)} are ${categoryLabel(category).toLowerCase()}s`
        : `Payments ${direction} ${who} are ${categoryLabel(category).toLowerCase()}s`,
    };
  }
  // No counterparty (withdrawals, PayPal's own fees): recognise the PayPal event code instead.
  return {
    id,
    payer_email: null,
    payer_name: null,
    note_contains: word,
    event_code: tx.event_code,
    category,
    created_from: tx.id,
    description: `PayPal ${tx.event_code ?? ''} entries${found ? ` that mention ${describeWords(found)}` : ''} are ${categoryLabel(category).toLowerCase()}s`.replace('  ', ' '),
  };
}

const describeWords = (word: string) => `“${word}” or similar`;

export function ruleMatches(rule: Rule, tx: RuleTx): boolean {
  if (rule.payer_email && rule.payer_email !== (tx.payer_email ?? '').toLowerCase()) return false;
  if (rule.event_code && rule.event_code !== tx.event_code) return false;
  if (rule.note_contains) {
    const text = `${tx.note ?? ''} ${tx.subject ?? ''}`.toLowerCase();
    if (!rule.note_contains.split('|').some((w) => text.includes(w))) return false;
  }
  return Boolean(rule.payer_email || rule.event_code || rule.note_contains);
}

/**
 * The rule that applies to a row: the most specific one (a note condition beats a payer-only
 * rule), newest first among equals.
 */
export function bestRule(rules: readonly Rule[], tx: RuleTx): Rule | undefined {
  let best: Rule | undefined;
  let bestScore = -1;
  for (let i = rules.length - 1; i >= 0; i--) {
    const r = rules[i];
    if (!ruleMatches(r, tx)) continue;
    const score = (r.payer_email ? 2 : 0) + (r.note_contains ? 1 : 0) + (r.event_code ? 1 : 0);
    if (score > bestScore) {
      best = r;
      bestScore = score;
    }
  }
  return best;
}

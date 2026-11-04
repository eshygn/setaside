// The review state machine for one transaction's classification.
//
//   unclassified ──CLASSIFIED(conf ≥ 80)──▶ auto_ok
//   unclassified ──CLASSIFIED(conf < 80)──▶ needs_review
//   auto_ok | needs_review | rule_matched ──RULE_MATCH──▶ rule_matched
//   auto_ok | needs_review | rule_matched ──ACCEPT──▶ confirmed
//   any classified state ──CORRECT──▶ corrected
//   confirmed | corrected  ── CLASSIFIED / RULE_MATCH ──▶ (unchanged: the person has the last word)
//   any ──RESET──▶ unclassified

export const REVIEW_THRESHOLD = 80;

export type ReviewState = 'unclassified' | 'needs_review' | 'auto_ok' | 'rule_matched' | 'confirmed' | 'corrected';

export type ReviewEvent =
  | { type: 'CLASSIFIED'; confidence: number }
  | { type: 'RULE_MATCH' }
  | { type: 'ACCEPT' }
  | { type: 'CORRECT' }
  | { type: 'RESET' };

const HUMAN: ReadonlySet<ReviewState> = new Set(['confirmed', 'corrected']);

export function transition(state: ReviewState, event: ReviewEvent): ReviewState {
  switch (event.type) {
    case 'RESET':
      return 'unclassified';
    case 'CLASSIFIED':
      if (HUMAN.has(state)) return state;
      return event.confidence >= REVIEW_THRESHOLD ? 'auto_ok' : 'needs_review';
    case 'RULE_MATCH':
      return HUMAN.has(state) || state === 'unclassified' ? state : 'rule_matched';
    case 'ACCEPT':
      return state === 'unclassified' || state === 'corrected' ? state : 'confirmed';
    case 'CORRECT':
      return state === 'unclassified' ? state : 'corrected';
  }
}

/** Whether automation (the AI or a rule) may overwrite this row. */
export const isAutomatable = (state: ReviewState) => !HUMAN.has(state);

export const REVIEW_LABEL: Record<ReviewState, string> = {
  unclassified: 'Not classified',
  needs_review: 'Needs review',
  auto_ok: 'Auto',
  rule_matched: 'Your rule',
  confirmed: 'Confirmed',
  corrected: 'Corrected',
};

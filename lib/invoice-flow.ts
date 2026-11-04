// State machine for "raise a PayPal invoice for work that was paid without one".
//
//   not_needed            (not a client payment, or it already references an invoice)
//   missing ──START──▶ creating ──CREATED──▶ recording ──RECORDED──▶ paid
//                         │                     │
//                         └──FAILED──▶ failed ◀─┘   failed ──START──▶ creating (retry)

export type InvoiceFlowState = 'not_needed' | 'missing' | 'creating' | 'recording' | 'paid' | 'failed';

export type InvoiceFlowEvent = { type: 'START' } | { type: 'CREATED' } | { type: 'RECORDED' } | { type: 'FAILED' };

export function invoiceTransition(state: InvoiceFlowState, event: InvoiceFlowEvent): InvoiceFlowState {
  switch (state) {
    case 'missing':
    case 'failed':
      return event.type === 'START' ? 'creating' : state;
    case 'creating':
      return event.type === 'CREATED' ? 'recording' : event.type === 'FAILED' ? 'failed' : state;
    case 'recording':
      return event.type === 'RECORDED' ? 'paid' : event.type === 'FAILED' ? 'failed' : state;
    default:
      return state;
  }
}

export function initialInvoiceState(row: { category: string | null; invoice_id: string | null; amount_minor: number }, alreadyInvoiced: boolean): InvoiceFlowState {
  if (alreadyInvoiced) return 'paid';
  if (row.category !== 'client_payment' || row.invoice_id || row.amount_minor <= 0) return 'not_needed';
  return 'missing';
}

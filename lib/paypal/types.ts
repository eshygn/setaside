// PayPal REST response shapes SetAside reads, in the API's own snake_case. Both the live adapter
// (raw JSON bodies from @paypal/paypal-server-sdk and the Invoicing REST API) and the mock adapter
// (fixtures in fixtures/paypal) return exactly these shapes.
// Docs: https://developer.paypal.com/docs/api/transaction-search/v1/
//       https://developer.paypal.com/docs/api/invoicing/v2/

export type PayPalMoney = { currency_code: string; value: string };

export type PayPalTransactionDetail = {
  transaction_info: {
    paypal_account_id?: string;
    transaction_id: string;
    paypal_reference_id?: string;
    paypal_reference_id_type?: string;
    transaction_event_code?: string;
    transaction_initiation_date?: string;
    transaction_updated_date?: string;
    transaction_amount?: PayPalMoney;
    fee_amount?: PayPalMoney;
    transaction_status?: string;
    transaction_subject?: string;
    transaction_note?: string;
    ending_balance?: PayPalMoney;
    available_balance?: PayPalMoney;
    invoice_id?: string;
    custom_field?: string;
    protection_eligibility?: string;
    instrument_type?: string;
    instrument_sub_type?: string;
  };
  payer_info?: {
    account_id?: string;
    email_address?: string;
    address_status?: string;
    payer_status?: string;
    payer_name?: { given_name?: string; surname?: string; alternate_full_name?: string };
    country_code?: string;
  };
  shipping_info?: Record<string, unknown>;
  cart_info?: { item_details?: { item_name?: string; item_quantity?: string }[] } & Record<string, unknown>;
  store_info?: Record<string, unknown>;
  auction_info?: Record<string, unknown>;
  incentive_info?: Record<string, unknown>;
};

export type PayPalSearchResponse = {
  transaction_details: PayPalTransactionDetail[];
  account_number?: string;
  start_date?: string;
  end_date?: string;
  last_refreshed_datetime?: string;
  page?: number;
  total_items?: number;
  total_pages?: number;
};

export type PayPalBalances = {
  balances: {
    currency: string;
    primary?: boolean;
    total_balance: PayPalMoney;
    available_balance?: PayPalMoney;
    withheld_balance?: PayPalMoney;
  }[];
  account_id?: string;
  as_of_time?: string;
  last_refresh_time?: string;
};

export type PayPalInvoiceStatus =
  | 'DRAFT'
  | 'SENT'
  | 'SCHEDULED'
  | 'UNPAID'
  | 'PAYMENT_PENDING'
  | 'PAID'
  | 'MARKED_AS_PAID'
  | 'PARTIALLY_PAID'
  | 'CANCELLED'
  | 'REFUNDED'
  | 'PARTIALLY_REFUNDED'
  | 'MARKED_AS_REFUNDED';

export type PayPalInvoice = {
  id: string;
  status: PayPalInvoiceStatus;
  detail: {
    invoice_number: string;
    currency_code: string;
    invoice_date?: string;
    note?: string;
    memo?: string;
    reference?: string;
    payment_term?: { term_type?: string; due_date?: string };
    metadata?: { recipient_view_url?: string; invoicer_view_url?: string; create_time?: string };
  };
  invoicer?: { name?: { given_name?: string; surname?: string; full_name?: string }; email_address?: string };
  primary_recipients?: {
    billing_info?: { name?: { given_name?: string; surname?: string; full_name?: string }; business_name?: string; email_address?: string };
  }[];
  items?: { name: string; description?: string; quantity: string; unit_amount: PayPalMoney }[];
  amount?: PayPalMoney;
  due_amount?: PayPalMoney;
  payments?: {
    paid_amount?: PayPalMoney;
    transactions?: { payment_id?: string; payment_date?: string; method?: string; note?: string; amount: PayPalMoney }[];
  };
  links?: { href: string; rel: string; method?: string }[];
};

/** What SetAside asks PayPal to invoice: work that was paid without an invoice. */
export type InvoiceDraft = {
  currency: string;
  recipientName: string;
  recipientEmail?: string;
  itemName: string;
  amountMinor: number;
  invoiceDate: string; // YYYY-MM-DD
  /** PayPal transaction id of the payment the invoice documents. */
  paidByTransactionId: string;
  paymentDate: string; // YYYY-MM-DD
  note?: string;
};

export type InvoiceResult = { invoice: PayPalInvoice; steps: { call: string; ok: boolean; detail?: string }[] };

/** Every PayPal call SetAside makes. Live and mock implement the same contract. */
export interface PayPalAdapter {
  readonly mode: 'live' | 'mock';
  /** One Transaction Search page. PayPal rejects ranges over 31 days. */
  searchTransactions(params: { start: Date; end: Date; page: number; pageSize: number }): Promise<PayPalSearchResponse>;
  getBalances(): Promise<PayPalBalances>;
  listInvoices(): Promise<PayPalInvoice[]>;
  /** Create a draft invoice, then record the PayPal payment against it so it reads as paid. */
  createPaidInvoice(draft: InvoiceDraft): Promise<InvoiceResult>;
}

export class PayPalError extends Error {
  constructor(
    readonly status: number,
    readonly call: string,
    body: string,
  ) {
    super(`PayPal ${status} on ${call}: ${body.slice(0, 240)}`);
    this.name = 'PayPalError';
  }
}

export const TRANSACTION_SEARCH_MAX_DAYS = 31;

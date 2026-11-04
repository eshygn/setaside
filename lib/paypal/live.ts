// Live PayPal sandbox adapter. Transaction Search and Balances go through the official
// @paypal/paypal-server-sdk (TransactionSearchController); the SDK has no Invoicing controller,
// so Invoicing v2 is plain REST with a client-credentials token, as in the AG Studio boilerplate.
// We read the SDK's raw JSON `body` rather than its camelCased `result`, so live and mock data
// share one shape: PayPal's documented snake_case.

import { CheckoutPaymentIntent, Client, Environment, OrdersController, PaymentsController, TransactionSearchController } from '@paypal/paypal-server-sdk';
import { toDecimalString } from '../money';
import {
  PayPalError,
  TRANSACTION_SEARCH_MAX_DAYS,
  type InvoiceDraft,
  type InvoiceResult,
  type PayPalAdapter,
  type PayPalBalances,
  type PayPalInvoice,
  type PayPalSearchResponse,
} from './types';

const BASE_URL = 'https://api-m.sandbox.paypal.com';

export function hasLiveCredentials() {
  return Boolean(process.env.PAYPAL_CLIENT_ID && (process.env.PAYPAL_CLIENT_SECRET || process.env.PAYPAL_SECRET));
}

const secret = () => process.env.PAYPAL_CLIENT_SECRET || process.env.PAYPAL_SECRET || '';

// Transaction Search rejects fractional seconds.
export const searchDate = (d: Date) => `${d.toISOString().slice(0, 19)}Z`;

export class LivePayPal implements PayPalAdapter {
  readonly mode = 'live' as const;
  private readonly search: TransactionSearchController;
  private readonly orders: OrdersController;
  private readonly payments: PaymentsController;
  private token?: { value: string; expiresAt: number };

  constructor() {
    const client = new Client({
      clientCredentialsAuthCredentials: { oAuthClientId: process.env.PAYPAL_CLIENT_ID ?? '', oAuthClientSecret: secret() },
      environment: Environment.Sandbox,
      timeout: 20_000,
    });
    this.search = new TransactionSearchController(client);
    this.orders = new OrdersController(client);
    this.payments = new PaymentsController(client);
  }

  // --- Orders: the PayPal JS SDK buttons create and capture through these ----------------

  async createOrder(params: { amountMinor: number; currency: string; description: string; invoiceId?: string }) {
    const res = await this.orders.createOrder({
      body: {
        intent: CheckoutPaymentIntent.Capture,
        purchaseUnits: [
          {
            amount: { currencyCode: params.currency, value: toDecimalString(params.amountMinor) },
            description: params.description,
            ...(params.invoiceId && { invoiceId: params.invoiceId }),
          },
        ],
      },
      prefer: 'return=minimal',
    });
    return JSON.parse(String(res.body)) as { id: string; status: string };
  }

  async captureOrder(orderId: string) {
    const res = await this.orders.captureOrder({ id: orderId, prefer: 'return=representation' });
    return JSON.parse(String(res.body)) as CapturedOrder;
  }

  /** Payments v2: one capture, by its id (the same id Transaction Search reports). */
  async getCapture(captureId: string) {
    const res = await this.payments.getCapturedPayment({ captureId });
    return JSON.parse(String(res.body)) as PayPalCapture;
  }

  async searchTransactions({ start, end, page, pageSize }: { start: Date; end: Date; page: number; pageSize: number }) {
    if (end.getTime() - start.getTime() > TRANSACTION_SEARCH_MAX_DAYS * 86_400_000) {
      throw new PayPalError(400, 'GET /v1/reporting/transactions', 'Date range exceeds 31 days');
    }
    const res = await this.search.searchTransactions({
      startDate: searchDate(start),
      endDate: searchDate(end),
      fields: 'all',
      pageSize,
      page,
    });
    return JSON.parse(String(res.body)) as PayPalSearchResponse;
  }

  async getBalances() {
    const res = await this.search.searchBalances({});
    return JSON.parse(String(res.body)) as PayPalBalances;
  }

  async listInvoices() {
    const list = await this.rest<{ items?: { id: string }[] }>('GET', '/v2/invoicing/invoices?page_size=100&total_required=true');
    return Promise.all((list.items ?? []).map((i) => this.rest<PayPalInvoice>('GET', `/v2/invoicing/invoices/${encodeURIComponent(i.id)}`)));
  }

  async createPaidInvoice(draft: InvoiceDraft): Promise<InvoiceResult> {
    const steps: InvoiceResult['steps'] = [];
    const value = toDecimalString(draft.amountMinor);
    const created = await this.rest<{ href?: string; id?: string } & Partial<PayPalInvoice>>('POST', '/v2/invoicing/invoices', {
      detail: {
        currency_code: draft.currency,
        invoice_date: draft.invoiceDate,
        note: draft.note ?? 'Thank you! This invoice documents a payment already received through PayPal.',
        reference: draft.paidByTransactionId,
        payment_term: { term_type: 'DUE_ON_RECEIPT' },
      },
      primary_recipients: [
        { billing_info: { business_name: draft.recipientName, ...(draft.recipientEmail && { email_address: draft.recipientEmail }) } },
      ],
      items: [{ name: draft.itemName, quantity: '1', unit_amount: { currency_code: draft.currency, value }, unit_of_measure: 'AMOUNT' }],
    });
    // Create returns either the invoice or a link to it, depending on the Prefer header.
    const id = created.id ?? created.href?.split('/').pop();
    if (!id) throw new PayPalError(500, 'POST /v2/invoicing/invoices', 'No invoice id in response');
    steps.push({ call: 'POST /v2/invoicing/invoices', ok: true, detail: id });
    await this.rest('POST', `/v2/invoicing/invoices/${id}/payments`, {
      method: 'PAYPAL',
      payment_date: draft.paymentDate,
      amount: { currency_code: draft.currency, value },
      note: `PayPal transaction ${draft.paidByTransactionId}`,
    });
    steps.push({ call: `POST /v2/invoicing/invoices/${id}/payments`, ok: true, detail: 'recorded as paid' });
    const invoice = await this.rest<PayPalInvoice>('GET', `/v2/invoicing/invoices/${id}`);
    steps.push({ call: `GET /v2/invoicing/invoices/${id}`, ok: true, detail: invoice.status });
    return { invoice, steps };
  }

  // --- REST for the endpoints the SDK doesn't cover -------------------------------------

  private async accessToken() {
    if (this.token && Date.now() < this.token.expiresAt) return this.token.value;
    const res = await fetch(`${BASE_URL}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${secret()}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
      cache: 'no-store',
    });
    if (!res.ok) throw new PayPalError(res.status, 'POST /v1/oauth2/token', await res.text());
    const { access_token, expires_in } = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: access_token, expiresAt: Date.now() + (expires_in - 60) * 1000 };
    return access_token;
  }

  private async rest<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      const res = await fetch(`${BASE_URL}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${await this.accessToken()}`,
          'Content-Type': 'application/json',
          Prefer: 'return=representation',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: 'no-store',
      });
      if (res.ok) return (res.status === 204 ? {} : await res.json()) as T;
      if (res.status === 401 && attempt === 1) {
        this.token = undefined;
        continue;
      }
      if ((res.status === 429 || res.status >= 500) && attempt < 3) {
        await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
        continue;
      }
      throw new PayPalError(res.status, `${method} ${path.split('?')[0]}`, await res.text());
    }
  }
}

export type PayPalCapture = {
  id: string;
  status: string;
  status_details?: { reason?: string };
  amount: { currency_code: string; value: string };
  seller_receivable_breakdown?: { gross_amount?: { value: string }; paypal_fee?: { value: string; currency_code: string }; net_amount?: { value: string } };
  invoice_id?: string;
  create_time?: string;
  payee?: { email_address?: string; merchant_id?: string };
};

export type CapturedOrder = {
  id: string;
  status: string;
  payer?: { email_address?: string; name?: { given_name?: string; surname?: string }; payer_id?: string };
  purchase_units?: { description?: string; payments?: { captures?: PayPalCapture[] } }[];
};

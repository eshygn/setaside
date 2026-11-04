import crypto from 'node:crypto';
import { parseMinor } from '@/lib/money';
import { liveAdapter } from '@/lib/paypal';
import { presetOf, recordCheckout, settings } from '@/lib/service';
import { body, failure, json } from '../../../../_util';

// PayPal JS SDK `onApprove`: capture the approved order server-side and record the payment in
// SetAside immediately (Transaction Search would take up to three hours to show it).
export async function POST(request: Request, ctx: RouteContext<'/api/paypal/orders/[id]/capture'>) {
  const { id } = await ctx.params;
  const { amountMinor, description } = await body<{ amountMinor: number; description: string }>(request);
  const currency = presetOf(settings()).currency;
  try {
    if (id.startsWith('MOCK-ORDER-')) {
      const amount = Number.isSafeInteger(amountMinor) ? amountMinor! : 4000;
      return json(
        recordCheckout({
          captureId: `MOCK${crypto.randomUUID().replace(/-/g, '').slice(0, 13).toUpperCase()}`,
          amountMinor: amount,
          feeMinor: Math.round((amount * 290) / 10_000) + 30,
          currency,
          payerName: 'Sandbox buyer (mock)',
          description: String(description ?? 'Freelance work'),
          createdAt: new Date().toISOString(),
          status: 'COMPLETED',
          mode: 'mock',
        }),
      );
    }
    const live = liveAdapter();
    if (!live) return json({ error: 'Live PayPal is not configured' }, 400);
    const order = await live.captureOrder(id);
    const capture = order.purchase_units?.[0]?.payments?.captures?.[0];
    if (!capture) return json({ error: `Order ${id} has no capture (status ${order.status})` }, 502);
    const name = [order.payer?.name?.given_name, order.payer?.name?.surname].filter(Boolean).join(' ') || 'Sandbox buyer';
    return json(
      recordCheckout({
        captureId: capture.id,
        amountMinor: parseMinor(capture.amount.value),
        feeMinor: parseMinor(capture.seller_receivable_breakdown?.paypal_fee?.value),
        currency: capture.amount.currency_code,
        payerName: name,
        payerEmail: order.payer?.email_address,
        description: order.purchase_units?.[0]?.description ?? String(description ?? 'Freelance work'),
        createdAt: capture.create_time ?? new Date().toISOString(),
        status: capture.status,
        mode: 'live',
      }),
    );
  } catch (error) {
    return failure(error, 502);
  }
}

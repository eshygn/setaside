import crypto from 'node:crypto';
import { liveAdapter, liveHealth } from '@/lib/paypal';
import { settings, presetOf } from '@/lib/service';
import { body, failure, json } from '../../_util';

// PayPal JS SDK `createOrder`: the browser asks us to create an Orders v2 order (server-side,
// through @paypal/paypal-server-sdk) and gets back its id. Without a reachable sandbox, a mock
// order id is returned and the mock button completes it.
export async function POST(request: Request) {
  const { amountMinor, description } = await body<{ amountMinor: number; description: string }>(request);
  if (!Number.isSafeInteger(amountMinor) || (amountMinor ?? 0) <= 0 || (amountMinor ?? 0) > 500_000) return json({ error: 'amountMinor must be a positive integer up to 5,000.00' }, 400);
  const currency = presetOf(settings()).currency;
  const live = liveAdapter();
  try {
    if (live && (await liveHealth()).ok) {
      const order = await live.createOrder({ amountMinor: amountMinor!, currency, description: String(description ?? 'Freelance work').slice(0, 120) });
      return json({ id: order.id, mode: 'live' });
    }
    return json({ id: `MOCK-ORDER-${crypto.randomUUID().slice(0, 8).toUpperCase()}`, mode: 'mock' });
  } catch (error) {
    return failure(error, 502);
  }
}

import { raiseInvoice } from '@/lib/service';
import { body, failure, json } from '../_util';

// Raises a PayPal invoice for a client payment that arrived without one (Invoicing v2: create,
// then record the PayPal payment against it). Falls back to the mock adapter if live Invoicing
// is refused, and says so in the response.
export async function POST(request: Request) {
  const { txId } = await body<{ txId: string }>(request);
  if (typeof txId !== 'string') return json({ error: 'txId is required' }, 400);
  try {
    return json(await raiseInvoice(txId));
  } catch (error) {
    return failure(error);
  }
}

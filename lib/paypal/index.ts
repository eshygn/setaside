// Picks the PayPal adapter. Demo history always comes from the mock (fixtures), because the
// sandbox can't hold a year of back-dated activity. When sandbox keys are set and PayPal
// answers, the live adapter is used as well and its real transactions merge in on top.

import type { Currency } from '../money';
import { LivePayPal, hasLiveCredentials } from './live';
import { MockPayPal } from './mock';
import type { PayPalAdapter } from './types';

let live: LivePayPal | undefined;
let health: { ok: boolean; detail: string; checkedAt: number } | undefined;

export function liveAdapter(): LivePayPal | undefined {
  if (!hasLiveCredentials()) return undefined;
  live ??= new LivePayPal();
  return live;
}

export const mockAdapter = (currency: Currency, now: () => Date): PayPalAdapter => new MockPayPal(currency, now);

/** Whether the live sandbox is usable right now. Checked with a Balances call, cached 10 minutes. */
export async function liveHealth(): Promise<{ ok: boolean; detail: string }> {
  const adapter = liveAdapter();
  if (!adapter) return { ok: false, detail: 'No PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET: mock PayPal' };
  if (health && Date.now() - health.checkedAt < 10 * 60_000) return health;
  try {
    await withTimeout(adapter.getBalances(), 8000);
    health = { ok: true, detail: 'PayPal sandbox connected', checkedAt: Date.now() };
  } catch (error) {
    health = { ok: false, detail: `Sandbox unreachable, using mock (${error instanceof Error ? error.message.slice(0, 80) : 'error'})`, checkedAt: Date.now() };
  }
  return health;
}

export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([promise, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms))]);
}

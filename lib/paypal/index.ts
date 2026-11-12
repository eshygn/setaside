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

/**
 * Whether the sandbox credentials work: an OAuth token request, cached 10 minutes. Each feature
 * (Transaction Search, Balances, Invoicing, Orders) then succeeds or falls back to mock on its
 * own, because a sandbox app can have some permissions and not others.
 */
export async function liveHealth(): Promise<{ ok: boolean; detail: string }> {
  const adapter = liveAdapter();
  if (!adapter) return { ok: false, detail: 'No PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET: mock PayPal' };
  if (health && Date.now() - health.checkedAt < 10 * 60_000) return health;
  try {
    await withTimeout(adapter.checkAuth(), 8000);
    health = { ok: true, detail: 'PayPal sandbox keys accepted', checkedAt: Date.now() };
  } catch (error) {
    health = { ok: false, detail: `Sandbox keys rejected or unreachable, using mock (${describeError(error)})`, checkedAt: Date.now() };
  }
  return health;
}

/** A short, readable reason for a PayPal failure (the SDK's errors can have an empty message). */
export function describeError(error: unknown): string {
  const e = error as { statusCode?: number; status?: number; message?: string; body?: unknown };
  const status = e?.statusCode ?? e?.status;
  if (status === 403) return '403: this sandbox app lacks the permission';
  if (status === 401) return '401: keys rejected';
  const msg = error instanceof Error ? error.message : String(error);
  if (/403/.test(msg)) return '403: this sandbox app lacks the permission';
  return (msg || (status ? `HTTP ${status}` : 'error')).slice(0, 80);
}

export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([promise, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms))]);
}

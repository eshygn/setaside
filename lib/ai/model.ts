// Which Gemini model to call, how often, and what happened last time.
//
// The Gemini free tier allows a handful of requests per minute and about 20 per model per day,
// so every AI call goes through `withModel`: a local rate limit, then the models in order, moving
// to the next on a quota (429) or overload (503) error. When all of them fail the caller falls
// back to recorded responses, and the status chip says so.

import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { APICallError, RetryError } from 'ai';
import type { LanguageModel } from 'ai';
import { kvGet, kvSet } from '../db';

/** Newest free-tier Flash models first (checked against this key's quota on 4 Nov 2026). */
export const DEFAULT_MODELS = ['gemini-3.6-flash', 'gemini-3-flash-preview', 'gemini-3.5-flash-lite', 'gemini-flash-lite-latest'];

export function modelIds(): string[] {
  const configured = (process.env.AI_MODEL ?? '').split(',').map((m) => m.trim()).filter(Boolean);
  return configured.length ? [...configured, ...DEFAULT_MODELS.filter((m) => !configured.includes(m))] : DEFAULT_MODELS;
}

export const hasAiKey = () => Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY);

export type AiMode = 'live' | 'cached' | 'recorded' | 'offline';

export type AiStatus = { mode: AiMode; model?: string; detail: string; at: string };

export function aiStatus(): AiStatus {
  const raw = kvGet('ai_status');
  if (raw) return JSON.parse(raw) as AiStatus;
  return hasAiKey()
    ? { mode: 'live', model: modelIds()[0], detail: 'Gemini ready', at: new Date().toISOString() }
    : { mode: 'recorded', detail: 'No GOOGLE_GENERATIVE_AI_API_KEY: using recorded responses', at: new Date().toISOString() };
}

export function setAiStatus(status: Omit<AiStatus, 'at'>) {
  kvSet('ai_status', JSON.stringify({ ...status, at: new Date().toISOString() }));
}

// --- Local rate limit: a sliding one-minute window ------------------------------------------

const MAX_PER_MINUTE = Number(process.env.AI_MAX_PER_MINUTE ?? 8);
const calls: number[] = [];

export function takeRateToken(now = Date.now()): boolean {
  while (calls.length && now - calls[0] > 60_000) calls.shift();
  if (calls.length >= MAX_PER_MINUTE) return false;
  calls.push(now);
  return true;
}

// Models that answered 429 are skipped until this time, so we stop hammering a spent quota.
const coolingUntil = new Map<string, number>();

export class AiUnavailableError extends Error {
  constructor(message: string, readonly reason: 'no_key' | 'rate_limited' | 'quota' | 'error') {
    super(message);
    this.name = 'AiUnavailableError';
  }
}

const provider = () => createGoogleGenerativeAI({ apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY });

function statusOf(error: unknown): number | undefined {
  if (APICallError.isInstance(error)) return error.statusCode;
  if (RetryError.isInstance(error)) return statusOf(error.lastError);
  return undefined;
}

/** Run `fn` against the first model that will answer. Throws AiUnavailableError when none will. */
export async function withModel<T>(fn: (model: LanguageModel, id: string) => Promise<T>): Promise<{ value: T; model: string }> {
  if (!hasAiKey()) throw new AiUnavailableError('No Gemini key configured', 'no_key');
  if (!takeRateToken()) throw new AiUnavailableError('Local rate limit reached (free tier protection)', 'rate_limited');
  let lastError: unknown;
  for (const id of modelIds()) {
    if ((coolingUntil.get(id) ?? 0) > Date.now()) continue;
    try {
      const value = await fn(provider()(id), id);
      return { value, model: id };
    } catch (error) {
      lastError = error;
      const status = statusOf(error);
      if (status === 429) coolingUntil.set(id, Date.now() + 10 * 60_000);
      if (status === 429 || status === 503 || status === 500 || status === 404) continue;
      throw new AiUnavailableError(error instanceof Error ? error.message : String(error), 'error');
    }
  }
  const status = statusOf(lastError);
  throw new AiUnavailableError(
    status === 429 ? 'Gemini free-tier quota used up' : `Gemini unavailable (${status ?? 'network'})`,
    status === 429 ? 'quota' : 'error',
  );
}

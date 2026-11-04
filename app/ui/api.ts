'use client';
// Thin client for SetAside's JSON routes.
import type { ClassifyReport, CorrectionReport, RaiseInvoiceReport, Snapshot, SyncReport } from '@/lib/service';

async function call<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(path, {
    method: init?.method ?? (init?.body ? 'POST' : 'GET'),
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    body: init?.body ? JSON.stringify(init.body) : undefined,
    cache: 'no-store',
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data as T;
}

export const api = {
  snapshot: () => call<Snapshot>('/api/snapshot'),
  classify: (limit?: number) => call<ClassifyReport>('/api/classify', { body: { limit } }),
  correct: (id: string, category: string) => call<CorrectionReport>('/api/correct', { body: { id, category } }),
  accept: (ids: string[]) => call<{ ok: true }>('/api/accept', { body: { ids } }),
  clock: (date: string) => call<SyncReport>('/api/clock', { body: { date } }),
  reset: (preset: string) => call<{ ok: true }>('/api/reset', { body: { preset } }),
  settings: (patch: { otherIncome?: number; upliftBps?: number }) => call<{ ok: true }>('/api/settings', { body: patch }),
  invoice: (txId: string) => call<RaiseInvoiceReport>('/api/invoice', { body: { txId } }),
  deleteRule: (id: string) => call<{ ok: true }>('/api/rules', { method: 'DELETE', body: { id } }),
};

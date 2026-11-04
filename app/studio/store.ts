'use client';

// Live tax context for the custom widgets. Studio's `context` property is read once at creation,
// so widgets subscribe here instead: when the preset, salary, demo clock, balance or what-if
// changes, every tax widget re-renders with the same numbers as the header.

import { useSyncExternalStore } from 'react';
import type { TaxPreset } from '@/lib/tax/presets';

export type TaxContext = {
  preset: TaxPreset;
  otherIncome: number;
  clock: string;
  balance: number;
  upliftBps: number;
};

let current: TaxContext | null = null;
const listeners = new Set<() => void>();

export function setTaxContext(next: TaxContext) {
  if (current && JSON.stringify(current) === JSON.stringify(next)) return;
  current = next;
  listeners.forEach((l) => l());
}

export const getTaxContext = () => current;

export function useTaxContext(): TaxContext | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
    () => null,
  );
}

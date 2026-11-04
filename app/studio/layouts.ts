'use client';

// Saved dashboard layouts, kept in this browser's localStorage (pattern from the AG Studio
// boilerplate's reports-store). Studio's state has no page names, so each layout carries its page
// titles beside the AG Studio state. The built-in layout comes from ./initial-report.ts until it
// is saved over; "Reset layouts" brings it back.

import type { AgReportState } from 'ag-studio';
import { builtInPageTitles, builtInReport } from './initial-report';

export type SavedLayout = { id: string; name: string; builtIn?: boolean; pageTitles: Record<string, string>; state: AgReportState; updatedAt: string };
export type StoredLayouts = { layouts: SavedLayout[]; activeId: string };

const KEY = 'setaside:layouts:v3';
export const BUILT_IN_ID = 'tax-pot';

export const builtInLayout = (): SavedLayout => ({ id: BUILT_IN_ID, name: 'Tax pot', builtIn: true, pageTitles: builtInPageTitles, state: builtInReport, updatedAt: new Date(0).toISOString() });

export const initialLayouts = (): StoredLayouts => ({ layouts: [builtInLayout()], activeId: BUILT_IN_ID });

export function loadLayouts(): StoredLayouts {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return initialLayouts();
    const stored = JSON.parse(raw) as StoredLayouts;
    const layouts = [stored.layouts.find((l) => l.id === BUILT_IN_ID) ?? builtInLayout(), ...stored.layouts.filter((l) => l.id !== BUILT_IN_ID)];
    return { layouts, activeId: layouts.some((l) => l.id === stored.activeId) ? stored.activeId : BUILT_IN_ID };
  } catch {
    return initialLayouts();
  }
}

export function saveLayouts(next: StoredLayouts) {
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage blocked or full: layouts still work for this session.
  }
}

export function upsertLayout(current: StoredLayouts, layout: SavedLayout): StoredLayouts {
  const exists = current.layouts.some((l) => l.id === layout.id);
  return { layouts: exists ? current.layouts.map((l) => (l.id === layout.id ? layout : l)) : [...current.layouts, layout], activeId: layout.id };
}

export const newId = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 10)}`;

/** Page titles for a state: known titles kept, new pages numbered. */
export function titlesFor(state: AgReportState, known: Record<string, string>) {
  return Object.fromEntries(state.pages.map((p, i) => [p.id, known[p.id] ?? `Page ${i + 1}`]));
}

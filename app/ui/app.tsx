'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Snapshot } from '@/lib/service';
import { NOT_TAX_ADVICE, type PresetId } from '@/lib/tax/presets';
import { api } from './api';
import { Assumptions } from './assumptions';
import { Hero } from './hero';
import { Invoices } from './invoices';
import { Logo, StatusChip } from './bits';
import { addDays, formatDay } from './format';

// Browser-only libraries (AG Grid, AG Studio, PayPal JS SDK) load on the client only.
const ReviewGrid = dynamic(() => import('./review-grid').then((m) => m.ReviewGrid), { ssr: false, loading: () => <Panel loading /> });
const Dashboard = dynamic(() => import('../studio/dashboard').then((m) => m.Dashboard), { ssr: false, loading: () => <Panel loading /> });

type Tab = 'review' | 'dashboard' | 'invoices' | 'assumptions';

export type Toast = { id: number; title: string; body?: string; tone?: 'ok' | 'rule' | 'warn' };

export function SetAsideApp(props: { initial: Snapshot; licenseKey?: string; aiKeyConfigured: boolean; paypalClientId?: string }) {
  const [snap, setSnap] = useState(props.initial);
  const [tab, setTab] = useState<Tab>('review');
  const [busy, setBusy] = useState<string | null>(null);
  const [classifying, setClassifying] = useState<{ done: number; total: number } | null>(null);
  const [flash, setFlash] = useState<{ ids: Set<string>; at: number }>({ ids: new Set(), at: 0 });
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);

  const toast = useCallback((t: Omit<Toast, 'id'>) => {
    const id = ++toastId.current;
    setToasts((all) => [...all.slice(-2), { ...t, id }]);
    setTimeout(() => setToasts((all) => all.filter((x) => x.id !== id)), 6500);
  }, []);

  const refresh = useCallback(async () => setSnap(await api.snapshot()), []);

  const classifyAll = useCallback(async () => {
    const total = (await api.snapshot()).counts.unclassified;
    if (!total) return;
    setClassifying({ done: 0, total });
    let done = 0;
    try {
      for (let guard = 0; guard < 20; guard++) {
        const res = await api.classify(160);
        done += res.classified;
        setClassifying({ done: Math.min(done, total), total });
        setSnap(await api.snapshot());
        if (res.remaining === 0 || res.classified === 0) {
          toast({
            title: `${done} transactions classified`,
            body: res.method === 'ai' ? res.detail : `${res.detail}`,
            tone: res.method === 'ai' || res.method === 'rule' ? 'ok' : 'warn',
          });
          break;
        }
      }
    } catch (error) {
      toast({ title: 'Classification stopped', body: String(error), tone: 'warn' });
    } finally {
      setClassifying(null);
    }
  }, [toast]);

  const moveClock = useCallback(
    async (date: string, label: string) => {
      setBusy('clock');
      try {
        const res = await api.clock(date);
        const before = snap.counts.total;
        const next = await api.snapshot();
        setSnap(next);
        const added = next.counts.total - before;
        toast({ title: `${label}: ${formatDay(next.settings.clock)}`, body: `${added} new PayPal transaction${added === 1 ? '' : 's'} pulled in ${res.windows} Transaction Search window${res.windows === 1 ? '' : 's'} (31-day max each).` });
        if (next.counts.unclassified) await classifyAll();
      } finally {
        setBusy(null);
      }
    },
    [snap.counts.total, toast, classifyAll],
  );

  const reset = useCallback(
    async (preset: PresetId) => {
      setBusy('reset');
      try {
        await api.reset(preset);
        setSnap(await api.snapshot());
        setTab('review');
        toast({ title: 'Demo reset', body: 'Fresh PayPal history, nothing classified yet.' });
      } finally {
        setBusy(null);
      }
    },
    [toast],
  );

  const onCorrected = useCallback(
    async (ids: string[], message: { title: string; body?: string }) => {
      setFlash({ ids: new Set(ids), at: Date.now() });
      setSnap(await api.snapshot());
      toast({ ...message, tone: 'rule' });
    },
    [toast],
  );

  // Keyboard shortcuts for recording: 1–4 switch tabs.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && (e.target.closest('input, textarea, [contenteditable], .ag-root-wrapper, .ag-studio'))) return;
      const tabs: Tab[] = ['review', 'dashboard', 'invoices', 'assumptions'];
      const n = Number(e.key);
      if (n >= 1 && n <= 4 && !e.metaKey && !e.ctrlKey) setTab(tabs[n - 1]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const { preset, settings, counts, status } = snap;
  const nextDeadline = snap.summary.nextDeadline;
  const missingInvoices = snap.rows.filter((r) => r.invoiceState === 'missing').length;

  return (
    <div className="flex min-h-screen flex-col">
      {/* ── Top bar ───────────────────────────────────────────── */}
      <header className="sticky top-0 z-30 border-b border-sa-line bg-sa-paper/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2.5 md:px-6">
          <Logo />
          <div className="hidden min-w-0 flex-col leading-tight lg:flex">
            <span className="text-[13px] font-semibold text-sa-ink">{snap.persona.name}</span>
            <span className="truncate text-[12px] text-sa-muted">{snap.persona.business} · {snap.persona.trade}</span>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <StatusChip
              label="PayPal"
              value={status.paypal.mode === 'live' ? 'Sandbox live' : 'Mock'}
              tone={status.paypal.mode === 'live' ? 'live' : 'mock'}
              title={status.paypal.detail}
            />
            <StatusChip
              label="AI"
              value={
                status.ai.mode === 'live' ? `Gemini ${shortModel(status.ai.model)}` : status.ai.mode === 'cached' ? 'Gemini · cached' : status.ai.mode === 'recorded' ? 'Recorded Gemini' : 'Offline rules'
              }
              tone={status.ai.mode === 'live' || status.ai.mode === 'cached' ? 'live' : status.ai.mode === 'recorded' ? 'recorded' : 'mock'}
              title={status.ai.detail}
            />
            <div className="flex items-center gap-1 rounded-full border border-sa-line bg-sa-surface py-1 pl-3 pr-1 text-[12px]" title="Demo clock: jump forward to see new PayPal activity arrive">
              <span className="text-sa-muted">Demo clock</span>
              <span className="num mx-1 font-semibold text-sa-ink">{formatDay(settings.clock)}</span>
              <ClockButton disabled={!!busy || !!classifying} onClick={() => moveClock(addDays(settings.clock, 7), '+1 week')}>
                +1w
              </ClockButton>
              <ClockButton disabled={!!busy || !!classifying} onClick={() => moveClock(addDays(settings.clock, 30), '+1 month')}>
                +1m
              </ClockButton>
              {nextDeadline && nextDeadline.daysAway > 14 && (
                <ClockButton disabled={!!busy || !!classifying} onClick={() => moveClock(addDays(nextDeadline.date, -14), 'Two weeks before the deadline')}>
                  ⇥ deadline
                </ClockButton>
              )}
            </div>
            <select
              aria-label="Tax preset"
              className="h-8 rounded-full border border-sa-line bg-sa-surface px-3 text-[12px] font-medium text-sa-ink"
              value={preset.id}
              disabled={!!busy}
              onChange={(e) => reset(e.target.value as PresetId)}
            >
              <option value="uk-self-employed">🇬🇧 UK self-employed</option>
              <option value="us-self-employed">🇺🇸 US self-employed</option>
            </select>
            <button
              className="h-8 rounded-full border border-sa-line bg-sa-surface px-3 text-[12px] font-medium text-sa-ink-2 hover:border-sa-clay hover:text-sa-clay disabled:opacity-50"
              disabled={!!busy}
              onClick={() => reset(preset.id)}
            >
              {busy === 'reset' ? 'Resetting…' : 'Reset demo'}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-[1440px] flex-1 flex-col gap-4 px-4 pb-6 pt-4 md:px-6">
        <Hero snap={snap} classifying={classifying} onClassify={classifyAll} onReview={() => setTab('review')} />

        {/* ── Tabs ─────────────────────────────────────────── */}
        <nav className="flex items-end gap-1 overflow-x-auto border-b border-sa-line" role="tablist">
          <TabButton active={tab === 'review'} onClick={() => setTab('review')} badge={counts.needsReview || undefined} n={1}>
            Review
          </TabButton>
          <TabButton active={tab === 'dashboard'} onClick={() => setTab('dashboard')} n={2}>
            Dashboard <span className="ml-1 rounded bg-sa-mint px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sa-forest">AG Studio + agent</span>
          </TabButton>
          <TabButton active={tab === 'invoices'} onClick={() => setTab('invoices')} badge={missingInvoices || undefined} n={3}>
            Invoices
          </TabButton>
          <TabButton active={tab === 'assumptions'} onClick={() => setTab('assumptions')} n={4}>
            Assumptions
          </TabButton>
          <span className="ml-auto hidden pb-2 text-[12px] text-sa-muted md:block">{preset.name} · tax year {preset.taxYear.label}</span>
        </nav>

        <section className="min-h-[560px] flex-1">
          {tab === 'review' && <ReviewGrid snap={snap} licenseKey={props.licenseKey} flash={flash} onCorrected={onCorrected} onChanged={refresh} classifying={!!classifying} />}
          {tab === 'dashboard' && <Dashboard snap={snap} licenseKey={props.licenseKey} aiKeyConfigured={props.aiKeyConfigured} onScenario={refresh} />}
          {tab === 'invoices' && <Invoices snap={snap} onChanged={refresh} toast={toast} paypalClientId={props.paypalClientId} />}
          {tab === 'assumptions' && <Assumptions snap={snap} onChanged={refresh} />}
        </section>

        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-sa-line pt-3 text-[12px] text-sa-muted">
          <span>
            <strong className="font-semibold text-sa-ink-2">Not tax advice.</strong> {NOT_TAX_ADVICE}
          </span>
          <span>Fictional demo data · PayPal sandbox only</span>
        </footer>
      </main>

      {/* ── Toasts ───────────────────────────────────────────── */}
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[min(420px,calc(100vw-2rem))] flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto rounded-xl border px-4 py-3 shadow-lg ${t.tone === 'rule' ? 'border-sa-marigold bg-sa-marigold-soft' : t.tone === 'warn' ? 'border-sa-clay bg-sa-clay-soft' : 'border-sa-line bg-sa-surface'}`}
          >
            <div className="text-[13px] font-semibold text-sa-ink">{t.title}</div>
            {t.body && <div className="mt-0.5 text-[12px] leading-snug text-sa-ink-2">{t.body}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

const shortModel = (m?: string) => (m ?? '').replace(/^gemini-/, '');

function ClockButton(props: { onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      onClick={props.onClick}
      disabled={props.disabled}
      className="h-6 rounded-full bg-sa-paper-2 px-2 text-[11px] font-semibold text-sa-ink-2 hover:bg-sa-marigold-soft disabled:opacity-40"
    >
      {props.children}
    </button>
  );
}

function TabButton(props: { active: boolean; onClick: () => void; badge?: number; n: number; children: React.ReactNode }) {
  return (
    <button
      role="tab"
      aria-selected={props.active}
      onClick={props.onClick}
      title={`Shortcut: ${props.n}`}
      className={`-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 pb-2 pt-1 text-[14px] font-medium transition-colors ${props.active ? 'border-sa-forest text-sa-ink' : 'border-transparent text-sa-muted hover:text-sa-ink'}`}
    >
      {props.children}
      {props.badge ? <span className="num rounded-full bg-sa-marigold px-1.5 text-[11px] font-bold text-sa-ink">{props.badge}</span> : null}
    </button>
  );
}

function Panel({ loading }: { loading?: boolean }) {
  return <div className={`h-[560px] rounded-2xl border border-sa-line bg-sa-surface ${loading ? 'sa-pulse' : ''}`} />;
}

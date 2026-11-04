'use client';

// Client payments that arrived without an invoice, and the invoices on file. "Raise invoice"
// creates a PayPal invoice for the work and records the PayPal payment against it.

import { useState } from 'react';
import type { RaiseInvoiceReport, Snapshot } from '@/lib/service';
import { api } from './api';
import type { Toast } from './app';
import { Money } from './bits';
import { formatDay } from './format';
import { PayPalCheckout } from './paypal-checkout';

export function Invoices({ snap, onChanged, onPaid, toast, paypalClientId }: { snap: Snapshot; onChanged: () => void; onPaid: () => void; toast: (t: Omit<Toast, 'id'>) => void; paypalClientId?: string }) {
  const cur = snap.preset.currency;
  const missing = snap.rows.filter((r) => r.invoiceState === 'missing');
  const [working, setWorking] = useState<string | null>(null);
  const [last, setLast] = useState<RaiseInvoiceReport | null>(null);

  const raise = async (txId: string) => {
    setWorking(txId);
    try {
      const res = await api.invoice(txId);
      setLast(res);
      toast({
        title: `Invoice ${res.invoice.number} raised${res.mode === 'live' ? ' in PayPal sandbox' : ' (mock)'}`,
        body: res.note ?? `${res.steps.map((s) => s.call).join(' → ')}`,
        tone: res.mode === 'live' ? 'ok' : 'warn',
      });
      onChanged();
    } catch (error) {
      toast({ title: 'Could not raise the invoice', body: String(error), tone: 'warn' });
    } finally {
      setWorking(null);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
      <div className="rounded-2xl border border-sa-line bg-sa-surface">
        <div className="border-b border-sa-line-soft px-5 py-4">
          <h2 className="display text-[22px] font-semibold text-sa-ink">Paid, but never invoiced</h2>
          <p className="mt-1 text-[13px] text-sa-muted">
            Client payments with no invoice behind them. An invoice is your record of the work if a tax office, or the client, ever asks. SetAside raises one through PayPal Invoicing and marks it paid with
            the PayPal transaction.
          </p>
        </div>
        {missing.length === 0 ? (
          <div className="px-5 py-8 text-[13px] text-sa-muted">{snap.counts.unclassified ? 'Classify your transactions first.' : 'Every client payment has an invoice. 🎉'}</div>
        ) : (
          <ul className="divide-y divide-sa-line-soft">
            {missing.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] font-medium text-sa-ink">
                    {r.counterparty}
                    {r.origin === 'sandbox' && <span className="ml-1.5 rounded bg-sa-sky/15 px-1 text-[10px] font-bold uppercase text-sa-sky">live</span>}
                  </div>
                  <div className="truncate text-[12px] text-sa-muted">
                    {formatDay(r.date)} · {r.note ?? r.subject ?? 'No note'} · <span className="font-mono">{r.id}</span>
                  </div>
                </div>
                <Money minor={r.amount} currency={cur} className="text-[15px] font-semibold text-sa-ink" />
                <button
                  onClick={() => raise(r.id)}
                  disabled={working !== null}
                  className="rounded-full bg-[#0070e0] px-4 py-2 text-[13px] font-semibold text-white shadow-sm hover:bg-[#005ec4] disabled:opacity-50"
                >
                  {working === r.id ? 'Raising…' : 'Raise PayPal invoice'}
                </button>
              </li>
            ))}
          </ul>
        )}
        {last && (
          <div className="m-4 rounded-xl border border-sa-line-soft bg-sa-paper px-4 py-3 font-mono text-[12px] text-sa-ink-2">
            <div className="mb-1 font-sans text-[12px] font-semibold text-sa-ink">
              PayPal Invoicing v2 · {last.mode === 'live' ? 'sandbox' : 'mock adapter'} · state: {last.state}
            </div>
            {last.steps.map((s) => (
              <div key={s.call}>
                {s.ok ? '✓' : '✗'} {s.call} {s.detail && <span className="text-sa-muted">→ {s.detail}</span>}
              </div>
            ))}
            {last.note && <div className="mt-1 font-sans text-sa-clay">{last.note}</div>}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-4">
        <PayPalCheckout clientId={paypalClientId} currency={cur} onPaid={onPaid} toast={toast} />
        <div className="rounded-2xl border border-sa-line bg-sa-surface">
          <div className="border-b border-sa-line-soft px-5 py-3">
            <h3 className="text-[15px] font-semibold text-sa-ink">Invoices on file</h3>
          </div>
          <ul className="max-h-[360px] divide-y divide-sa-line-soft overflow-auto">
            {snap.invoices.map((i) => (
              <li key={i.id} className="flex items-center gap-3 px-5 py-2.5 text-[13px]">
                <span className="font-mono text-[12px] text-sa-ink-2">{i.number}</span>
                <span className="min-w-0 flex-1 truncate text-sa-ink">{i.recipient}</span>
                <span className="rounded-full bg-sa-mint px-2 py-0.5 text-[11px] font-semibold text-sa-forest">{i.status.replace(/_/g, ' ').toLowerCase()}</span>
                {i.origin !== 'seed' && <span className="rounded bg-sa-sky/15 px-1 text-[10px] font-bold uppercase text-sa-sky">{i.origin}</span>}
                <Money minor={i.amount} currency={cur} className="font-medium" />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

'use client';

// "A client pays Jo": the PayPal JS SDK buttons, with the order created and captured on our
// server through @paypal/paypal-server-sdk (Orders v2). The captured payment lands in SetAside
// at once and is classified like any other. With no PayPal client id (or no sandbox), a clearly
// labelled mock button runs the same flow against the mock adapter.

import { useEffect, useRef, useState } from 'react';
import { formatMoney, parseMinor, type Currency } from '@/lib/money';
import type { CheckoutRecord } from '@/lib/service';
import type { Toast } from './app';

type PayPalButtons = { render: (el: HTMLElement) => Promise<void>; close?: () => void };
type PayPalNamespace = {
  Buttons: (opts: {
    style?: Record<string, unknown>;
    createOrder: () => Promise<string>;
    onApprove: (data: { orderID: string }) => Promise<void>;
    onError?: (err: unknown) => void;
  }) => PayPalButtons;
};
declare global {
  interface Window {
    paypal?: PayPalNamespace;
  }
}

let sdkPromise: Promise<PayPalNamespace> | null = null;
function loadSdk(clientId: string, currency: string): Promise<PayPalNamespace> {
  sdkPromise ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=${currency}&intent=capture&components=buttons&disable-funding=paylater,venmo`;
    script.async = true;
    script.onload = () => (window.paypal ? resolve(window.paypal) : reject(new Error('PayPal SDK loaded without window.paypal')));
    script.onerror = () => reject(new Error('Could not load the PayPal JS SDK'));
    document.head.appendChild(script);
  });
  return sdkPromise;
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data as T;
}

export function PayPalCheckout({ clientId, currency, onPaid, toast }: { clientId?: string; currency: Currency; onPaid: () => void; toast: (t: Omit<Toast, 'id'>) => void }) {
  const [amount, setAmount] = useState('40.00');
  const [description, setDescription] = useState('Logo refresh for Moor Lane Bakery');
  const [sdkState, setSdkState] = useState<'loading' | 'ready' | 'failed' | 'none'>(clientId ? 'loading' : 'none');
  const [last, setLast] = useState<CheckoutRecord | null>(null);
  const holder = useRef<HTMLDivElement>(null);
  // The buttons read the latest form values when clicked.
  const form = useRef({ amount, description });
  form.current = { amount, description };

  const finish = (rec: CheckoutRecord) => {
    setLast(rec);
    toast({ title: `Payment received: ${formatMoney(rec.amount, currency)}${rec.mode === 'mock' ? ' (mock)' : ''}`, body: `PayPal capture ${rec.txId} added to your transactions. Classifying it now.`, tone: 'ok' });
    onPaid();
  };

  useEffect(() => {
    if (!clientId || !holder.current) return;
    let buttons: PayPalButtons | undefined;
    let cancelled = false;
    loadSdk(clientId, currency)
      .then((paypal) => {
        if (cancelled || !holder.current) return;
        holder.current.innerHTML = '';
        buttons = paypal.Buttons({
          style: { layout: 'vertical', color: 'gold', shape: 'pill', label: 'pay', height: 44 },
          createOrder: async () => {
            const order = await post<{ id: string; mode: string }>('/api/paypal/orders', { amountMinor: parseMinor(form.current.amount), description: form.current.description });
            return order.id;
          },
          onApprove: async ({ orderID }) => finish(await post<CheckoutRecord>(`/api/paypal/orders/${orderID}/capture`, { amountMinor: parseMinor(form.current.amount), description: form.current.description })),
          onError: (err) => toast({ title: 'PayPal checkout failed', body: String(err), tone: 'warn' }),
        });
        return buttons.render(holder.current).then(() => setSdkState('ready'));
      })
      .catch(() => !cancelled && setSdkState('failed'));
    return () => {
      cancelled = true;
      buttons?.close?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, currency]);

  const mockPay = async () => {
    const order = await post<{ id: string }>('/api/paypal/orders', { amountMinor: parseMinor(amount), description });
    finish(await post<CheckoutRecord>(`/api/paypal/orders/${order.id.startsWith('MOCK-') ? order.id : `MOCK-ORDER-${order.id}`}/capture`, { amountMinor: parseMinor(amount), description }));
  };

  return (
    <div className="rounded-2xl border border-sa-line bg-sa-surface p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-[15px] font-semibold text-sa-ink">A client pays you</h3>
        <span className="rounded-full bg-sa-paper-2 px-2 py-0.5 text-[11px] font-semibold text-sa-ink-2">{sdkState === 'ready' ? 'PayPal JS SDK · sandbox' : 'Mock checkout'}</span>
      </div>
      <p className="mt-1 text-[12px] text-sa-muted">Play the client: pay Jo with the sandbox buyer account. The payment shows up in SetAside straight away and the AI classifies it.</p>
      <div className="mt-3 grid grid-cols-[1fr_110px] gap-2">
        <input value={description} onChange={(e) => setDescription(e.target.value)} className="h-9 rounded-lg border border-sa-line bg-sa-paper px-3 text-[13px] outline-none focus:border-sa-forest" aria-label="What the payment is for" />
        <span className="flex h-9 items-center rounded-lg border border-sa-line bg-sa-paper px-2 text-[13px]">
          <span className="text-sa-muted">{currency === 'GBP' ? '£' : '$'}</span>
          <input value={amount} onChange={(e) => setAmount(e.target.value)} className="num w-full bg-transparent px-1 outline-none" inputMode="decimal" aria-label="Amount" />
        </span>
      </div>
      <div className="mt-3">
        <div ref={holder} className={sdkState === 'ready' || sdkState === 'loading' ? '' : 'hidden'} />
        {sdkState === 'loading' && <div className="sa-pulse h-11 rounded-full bg-sa-paper-2" />}
        {(sdkState === 'none' || sdkState === 'failed') && (
          <button onClick={mockPay} className="h-11 w-full rounded-full bg-[#ffc439] text-[14px] font-bold text-[#111] hover:brightness-95">
            Pay with PayPal <span className="font-normal">(mock{sdkState === 'failed' ? ': SDK unreachable' : ''})</span>
          </button>
        )}
      </div>
      {last && (
        <div className="mt-3 rounded-lg bg-sa-mint px-3 py-2 text-[12px] text-sa-forest">
          ✓ Captured <span className="num font-semibold">{formatMoney(last.amount, currency)}</span> from {last.payer} · <span className="font-mono">{last.txId}</span> · {last.status.toLowerCase()}
        </div>
      )}
    </div>
  );
}

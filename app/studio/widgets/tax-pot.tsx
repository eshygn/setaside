'use client';

// Custom AG Studio widget: the tax pot. A jar filled to the share of the PayPal balance that
// belongs to the tax office, with the set-aside and safe-to-spend figures beside it. It queries
// Studio for integer profit sums, so page filters, date filters and cross-filters all apply.
// `format.style.upliftPercent` draws a what-if line (the agent sets it with set_price_what_if).

import { useEffect, useRef, useState } from 'react';
import type { AgWidgetParams } from 'ag-studio';
import { formatMoney } from '@/lib/money';
import { useTaxContext } from '../store';
import { taxFor, toInt, type MoneySums } from './tax-maths';
import type { TaxPotDef } from './types';

export function TaxPotWidget({ dataMapping, widgetApi, format }: AgWidgetParams<TaxPotDef>) {
  const ctx = useTaxContext();
  const [sums, setSums] = useState<MoneySums | null>(null);
  const loaded = useRef(false);
  const uplift = Math.round((format?.style?.upliftPercent ?? 0) * 100);
  const showBreakdown = format?.style?.showBreakdown ?? true;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const profit = dataMapping.profit?.at(0);
      if (!profit) {
        widgetApi.setDisplayState('incompleteDataMapping');
        return;
      }
      const extra = [dataMapping.fees?.at(0), dataMapping.income?.at(0), dataMapping.incomeFees?.at(0)];
      widgetApi.setDisplayState('loading', { prominent: !loaded.current });
      const res = await widgetApi.getData({ fields: [profit, ...extra.filter((f) => f !== undefined)] });
      if (cancelled) return;
      const row = res.results.rows.at(0) ?? {};
      loaded.current = true;
      setSums({
        profit: toInt(row[profit.key]),
        fees: extra[0] ? toInt(row[extra[0].key]) : 0,
        income: extra[1] ? toInt(row[extra[1].key]) : 0,
        incomeFees: extra[2] ? toInt(row[extra[2].key]) : 0,
      });
      widgetApi.setDisplayState('displayed');
    })();
    return () => {
      cancelled = true;
    };
  }, [dataMapping, widgetApi]);

  if (!ctx || !sums) return null;
  const cur = ctx.preset.currency;
  const est = taxFor(ctx, sums);
  const whatIf = uplift ? taxFor(ctx, sums, uplift) : null;
  const safe = ctx.balance - est.total;
  const ratio = ctx.balance > 0 ? Math.min(1, est.total / ctx.balance) : 1;
  const whatIfRatio = whatIf && ctx.balance > 0 ? Math.min(1, whatIf.total / ctx.balance) : null;
  const m = (v: number) => formatMoney(v, cur);

  return (
    <div className="@container flex h-full items-start gap-5 overflow-hidden px-3 pb-2 pt-1 @[360px]:items-center">
      <div className="hidden h-full items-center @[360px]:flex">
        <Jar ratio={ratio} whatIf={whatIfRatio} label={`${Math.round(ratio * 100)}%`} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-sa-muted">Put aside</div>
        <div className="display num text-[28px] font-semibold leading-tight text-sa-ink @[460px]:text-[40px]">{m(est.total)}</div>
        <div className="mt-1 text-[12px] text-sa-muted">
          of <span className="num font-medium text-sa-ink-2">{m(ctx.balance)}</span> in PayPal ·{' '}
          <span className={`num font-semibold ${safe < 0 ? 'text-sa-clay' : 'text-sa-forest'}`}>{m(safe)}</span> safe to spend
        </div>
        {showBreakdown && (
          <div className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[12px]">
            <span className="text-sa-muted">Profit</span>
            <span className="num text-right text-sa-ink-2">{m(sums.profit)}</span>
            {est.lines.map((l) => (
              <span key={l.label} className="contents">
                <span className="text-sa-muted">{l.label}</span>
                <span className="num text-right text-sa-ink-2">{m(l.amount)}</span>
              </span>
            ))}
          </div>
        )}
        {whatIf && (
          <div className="mt-3 rounded-lg border border-dashed border-sa-marigold bg-sa-marigold-soft px-3 py-2 text-[12px] text-sa-ink">
            <strong>What if prices were {uplift > 0 ? '+' : ''}{uplift / 100}%?</strong> Put aside <span className="num font-semibold">{m(whatIf.total)}</span>{' '}
            <span className="num text-sa-ink-2">({whatIf.total - est.total >= 0 ? '+' : ''}{m(whatIf.total - est.total)})</span>, profit{' '}
            <span className="num">{m(whatIf.profit)}</span>, and you keep <span className="num font-semibold">{m(whatIf.profit - whatIf.total - (sums.profit - est.total))}</span> more after tax.
          </div>
        )}
      </div>
    </div>
  );
}

function Jar({ ratio, whatIf, label }: { ratio: number; whatIf: number | null; label: string }) {
  // Jar interior runs from y=34 (top) to y=150 (bottom).
  const level = (r: number) => 150 - r * 116;
  return (
    <svg viewBox="0 0 110 160" className="h-full max-h-[190px] w-auto shrink-0" aria-label={`Tax pot ${label} full`}>
      <defs>
        <clipPath id="sa-jar">
          <path d="M28 30h54v8c10 6 16 16 16 28v72a14 14 0 0 1-14 14H26a14 14 0 0 1-14-14V66c0-12 6-22 16-28z" />
        </clipPath>
        <linearGradient id="sa-honey" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#f2b95c" />
          <stop offset="1" stopColor="#d98d26" />
        </linearGradient>
      </defs>
      <rect x="24" y="6" width="62" height="18" rx="6" fill="var(--sa-forest)" />
      <rect x="24" y="16" width="62" height="3" fill="var(--sa-forest-2)" />
      <g clipPath="url(#sa-jar)">
        <rect x="0" y="0" width="110" height="160" fill="var(--sa-paper)" />
        <rect x="0" y={level(ratio)} width="110" height={160 - level(ratio)} fill="url(#sa-honey)" style={{ transition: 'y 900ms cubic-bezier(.2,.8,.2,1), height 900ms cubic-bezier(.2,.8,.2,1)' }} />
        <path d={`M0 ${level(ratio)} q 14 -5 27 0 t 27 0 t 27 0 t 29 0`} fill="none" stroke="#f7cf86" strokeWidth="3" style={{ transition: 'd 900ms' }} />
        {whatIf !== null && <line x1="6" x2="104" y1={level(whatIf)} y2={level(whatIf)} stroke="var(--sa-ink)" strokeWidth="2" strokeDasharray="5 4" />}
      </g>
      <path d="M28 30h54v8c10 6 16 16 16 28v72a14 14 0 0 1-14 14H26a14 14 0 0 1-14-14V66c0-12 6-22 16-28z" fill="none" stroke="var(--sa-forest)" strokeWidth="3" />
      <path d="M24 60c0-8 4-14 10-17" stroke="white" strokeOpacity="0.7" strokeWidth="4" strokeLinecap="round" fill="none" />
      <text x="55" y="128" textAnchor="middle" fontFamily="var(--sa-display)" fontWeight="600" fontSize="20" fill="var(--sa-ink)">
        {label}
      </text>
    </svg>
  );
}

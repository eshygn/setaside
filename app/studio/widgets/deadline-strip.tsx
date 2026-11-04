'use client';

// Custom AG Studio widget: the tax year as a strip. Each quarter shows the profit made in it and
// the set-aside it added (the year-to-date estimate at its end, minus the one before), with the
// preset's payment and filing deadlines pinned on the timeline and a "today" marker on the demo
// clock. Data is grouped by the `quarter` field, so filters apply.

import { useEffect, useRef, useState } from 'react';
import type { AgWidgetParams } from 'ag-studio';
import { formatMoney } from '@/lib/money';
import { daysBetween } from '@/lib/tax/engine';
import { useTaxContext } from '../store';
import { taxFor, toInt, type MoneySums } from './tax-maths';
import type { DeadlineStripDef } from './types';

export function DeadlineStripWidget({ dataMapping, widgetApi, format }: AgWidgetParams<DeadlineStripDef>) {
  const ctx = useTaxContext();
  const [byQuarter, setByQuarter] = useState<Map<string, MoneySums> | null>(null);
  const loaded = useRef(false);
  const uplift = Math.round((format?.style?.upliftPercent ?? 0) * 100);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const quarter = dataMapping.quarter?.at(0);
      const profit = dataMapping.profit?.at(0);
      if (!quarter || !profit) {
        widgetApi.setDisplayState('incompleteDataMapping');
        return;
      }
      const extra = [dataMapping.fees?.at(0), dataMapping.income?.at(0), dataMapping.incomeFees?.at(0)];
      widgetApi.setDisplayState('loading', { prominent: !loaded.current });
      const res = await widgetApi.getData({ fields: [quarter, profit, ...extra.filter((f) => f !== undefined)] });
      if (cancelled) return;
      const map = new Map<string, MoneySums>();
      for (const row of res.results.rows) {
        map.set(String(row[quarter.key]), {
          profit: toInt(row[profit.key]),
          fees: extra[0] ? toInt(row[extra[0].key]) : 0,
          income: extra[1] ? toInt(row[extra[1].key]) : 0,
          incomeFees: extra[2] ? toInt(row[extra[2].key]) : 0,
        });
      }
      loaded.current = true;
      setByQuarter(map);
      widgetApi.setDisplayState('displayed');
    })();
    return () => {
      cancelled = true;
    };
  }, [dataMapping, widgetApi]);

  if (!ctx || !byQuarter) return null;
  const { preset, clock } = ctx;
  const cur = preset.currency;
  const start = preset.taxYear.start;
  const lastDeadline = preset.deadlines.at(-1)?.date ?? preset.taxYear.end;
  const end = lastDeadline > preset.taxYear.end ? lastDeadline : preset.taxYear.end;
  const span = daysBetween(start, end);
  const pos = (d: string) => `${Math.max(0, Math.min(100, (daysBetween(start, d) / span) * 100))}%`;

  // Cumulative set-aside at each quarter end, then the difference: what each quarter added.
  let running: MoneySums = { profit: 0, fees: 0, income: 0, incomeFees: 0 };
  let previousTax = 0;
  const quarters = preset.quarters.map((q) => {
    const s = byQuarter.get(q.label) ?? { profit: 0, fees: 0, income: 0, incomeFees: 0 };
    running = { profit: running.profit + s.profit, fees: running.fees + s.fees, income: running.income + s.income, incomeFees: running.incomeFees + s.incomeFees };
    const cumulative = q.start > clock ? previousTax : taxFor(ctx, running, uplift).total;
    const added = cumulative - previousTax;
    previousTax = cumulative;
    const status = q.end < clock ? 'closed' : q.start <= clock ? 'current' : 'upcoming';
    return { ...q, profit: s.profit, added, cumulative, status };
  });
  const next = preset.deadlines.find((d) => d.date >= clock);

  return (
    <div className="flex h-full flex-col gap-3 px-3 pb-2">
      {/* Timeline */}
      <div className="relative mt-5 h-9">
        <div className="absolute inset-x-0 top-4 h-1.5 rounded-full bg-sa-paper-2" />
        <div className="absolute left-0 top-4 h-1.5 rounded-full bg-sa-forest" style={{ width: pos(clock) }} />
        {preset.quarters.map((q) => (
          <div key={q.id} className="absolute top-3 h-3.5 w-px bg-sa-line" style={{ left: pos(q.start) }} />
        ))}
        {preset.deadlines.map((d) => {
          const isNext = d === next;
          return (
            <div key={d.date} className={`absolute ${d.date >= end ? '-translate-x-[85%]' : '-translate-x-1/2'}`} style={{ left: pos(d.date) }} title={`${d.label}: ${d.note}`}>
              <div className={`mx-auto h-4 w-4 rotate-45 rounded-[3px] border-2 ${d.date < clock ? 'border-sa-muted bg-sa-paper-2' : isNext ? 'border-sa-clay bg-sa-clay' : 'border-sa-ink bg-sa-surface'} mt-2.5`} />
              <div className={`mt-1 whitespace-nowrap text-center text-[10px] font-semibold ${isNext ? 'text-sa-clay' : 'text-sa-muted'}`}>{shortDate(d.date)}</div>
            </div>
          );
        })}
        <div className="absolute -top-5 -translate-x-1/2 whitespace-nowrap rounded-full bg-sa-ink px-2 py-0.5 text-[10px] font-semibold text-sa-paper" style={{ left: pos(clock) }}>
          Today · {shortDate(clock)}
        </div>
      </div>

      {/* Quarters */}
      <div className="mt-3 grid flex-1 grid-cols-4 gap-2">
        {quarters.map((q) => (
          <div
            key={q.id}
            className={`flex flex-col justify-between rounded-xl border px-3 py-2 ${q.status === 'current' ? 'border-sa-marigold bg-sa-marigold-soft' : q.status === 'closed' ? 'border-sa-line-soft bg-sa-paper' : 'border-dashed border-sa-line bg-sa-surface'}`}
          >
            <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-sa-muted">
              <span>{q.label}</span>
              <span>{q.status === 'current' ? 'now' : q.status === 'closed' ? '✓' : ''}</span>
            </div>
            <div className="display num text-[20px] font-semibold text-sa-ink">{q.status === 'upcoming' ? '—' : formatMoney(q.added, cur, { whole: true })}</div>
            <div className="num text-[11px] text-sa-muted">{q.status === 'upcoming' ? 'not started' : `to put aside · profit ${formatMoney(q.profit, cur, { whole: true })}`}</div>
          </div>
        ))}
      </div>

      {next && (
        <div className="flex flex-wrap items-baseline gap-x-2 text-[12px] text-sa-ink-2">
          <span className="font-semibold text-sa-clay">Next: {next.label}</span>
          <span className="num">
            {formatLong(next.date)} · {daysBetween(clock, next.date)} days
          </span>
          <span className="text-sa-muted">· pot so far {formatMoney(quarters.reduce((t, q) => t + (q.status === 'upcoming' ? 0 : q.added), 0), cur)}</span>
          {uplift !== 0 && <span className="rounded bg-sa-marigold-soft px-1.5 font-semibold text-sa-ink">what-if {uplift > 0 ? '+' : ''}{uplift / 100}%</span>}
        </div>
      )}
    </div>
  );
}

const shortDate = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const formatLong = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

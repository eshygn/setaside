'use client';

import { useState } from 'react';
import { parseMinor, formatMoney } from '@/lib/money';
import type { Snapshot } from '@/lib/service';
import { NOT_TAX_ADVICE } from '@/lib/tax/presets';
import { api } from './api';
import { Money } from './bits';
import { formatDay } from './format';

export function Assumptions({ snap, onChanged }: { snap: Snapshot; onChanged: () => void }) {
  const { preset, settings, summary, rules } = snap;
  const cur = preset.currency;
  const [income, setIncome] = useState((settings.otherIncome / 100).toFixed(0));

  const saveIncome = async () => {
    try {
      await api.settings({ otherIncome: parseMinor(income) });
      onChanged();
    } catch {
      /* invalid input: keep the old value */
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
      <div className="rounded-2xl border border-sa-line bg-sa-surface p-5">
        <h2 className="display text-[22px] font-semibold">{preset.name}</h2>
        <p className="mt-1 text-[13px] text-sa-muted">
          Every number SetAside uses lives in <code className="rounded bg-sa-paper-2 px-1">lib/tax/presets.ts</code>. {NOT_TAX_ADVICE}
        </p>
        <label className="mt-4 flex flex-wrap items-center gap-3 rounded-xl bg-sa-paper px-4 py-3 text-[13px]">
          <span className="font-medium text-sa-ink">Your other income this year (salary)</span>
          <span className="flex items-center rounded-lg border border-sa-line bg-sa-surface px-2">
            <span className="text-sa-muted">{cur === 'GBP' ? '£' : '$'}</span>
            <input value={income} onChange={(e) => setIncome(e.target.value)} onBlur={saveIncome} onKeyDown={(e) => e.key === 'Enter' && saveIncome()} className="num w-28 bg-transparent px-1 py-1.5 outline-none" inputMode="numeric" />
          </span>
          <span className="text-sa-muted">Side profit is taxed on top of it.</span>
        </label>
        <table className="mt-4 w-full text-[13px]">
          <tbody className="divide-y divide-sa-line-soft">
            {preset.assumptions.map((a) => (
              <tr key={a.id}>
                <td className="py-2.5 pr-3 align-top font-medium text-sa-ink">{a.label}</td>
                <td className="py-2.5 pr-3 align-top text-sa-ink-2">{a.value}</td>
                <td className="py-2.5 align-top text-sa-muted">{a.why}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <h3 className="mt-6 text-[14px] font-semibold">Deadlines</h3>
        <ul className="mt-2 grid gap-2 sm:grid-cols-2">
          {preset.deadlines.map((d) => (
            <li key={d.date} className={`rounded-xl border px-3 py-2 text-[13px] ${d.date < settings.clock ? 'border-sa-line-soft text-sa-muted' : 'border-sa-line'}`}>
              <div className="font-semibold text-sa-ink">
                {formatDay(d.date)} · {d.label}
              </div>
              <div className="text-[12px] text-sa-muted">{d.note}</div>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex flex-col gap-4">
        <div className="rounded-2xl border border-sa-line bg-sa-surface p-5">
          <h3 className="text-[15px] font-semibold">How the set-aside is worked out</h3>
          <dl className="num mt-3 grid grid-cols-[1fr_auto] gap-y-1.5 text-[13px]">
            <dt className="text-sa-ink-2">Sales and client payments</dt>
            <dd className="text-right">
              <Money minor={summary.breakdown.turnover} currency={cur} />
            </dd>
            <dt className="text-sa-ink-2">Refunds</dt>
            <dd className="text-right text-sa-clay">
              <Money minor={summary.breakdown.refunds} currency={cur} />
            </dd>
            <dt className="text-sa-ink-2">PayPal fees</dt>
            <dd className="text-right text-sa-clay">
              <Money minor={summary.breakdown.fees} currency={cur} />
            </dd>
            <dt className="border-t border-sa-line pt-1.5 font-semibold">Profit so far</dt>
            <dd className="border-t border-sa-line pt-1.5 text-right font-semibold">
              <Money minor={summary.breakdown.profit} currency={cur} />
            </dd>
            {summary.estimate.lines.map((l) => (
              <div key={l.label} className="contents">
                <dt className="text-sa-ink-2">{l.label}</dt>
                <dd className="text-right">
                  <Money minor={l.amount} currency={cur} />
                </dd>
              </div>
            ))}
            <dt className="border-t border-sa-line pt-1.5 font-semibold">Put aside</dt>
            <dd className="border-t border-sa-line pt-1.5 text-right font-semibold text-sa-forest">
              <Money minor={summary.setAside} currency={cur} />
            </dd>
            <dt className="text-sa-muted">Left out: personal transfers and reimbursements</dt>
            <dd className="text-right text-sa-muted">{formatMoney(summary.breakdown.excluded, cur)}</dd>
          </dl>
        </div>
        <div className="rounded-2xl border border-sa-line bg-sa-surface p-5">
          <h3 className="text-[15px] font-semibold">Rules you’ve taught it</h3>
          {rules.length === 0 ? (
            <p className="mt-2 text-[13px] text-sa-muted">None yet. Fix a category in Review and it becomes a rule.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {rules.map((r) => (
                <li key={r.id} className="flex items-start gap-2 rounded-xl bg-sa-marigold-soft px-3 py-2 text-[13px]">
                  <span className="flex-1 text-sa-ink">{r.description}</span>
                  <button
                    className="text-[12px] text-sa-muted hover:text-sa-clay"
                    onClick={async () => {
                      await api.deleteRule(r.id);
                      onChanged();
                    }}
                  >
                    Forget
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

'use client';

import type { Snapshot } from '@/lib/service';
import { Money, PotIcon } from './bits';
import { formatDay, pct } from './format';

export function Hero({ snap, classifying, onClassify, onReview }: { snap: Snapshot; classifying: { done: number; total: number } | null; onClassify: () => void; onReview: () => void }) {
  const { summary, scenario, counts, preset, settings } = snap;
  const cur = preset.currency;
  const classified = counts.total - counts.unclassified;
  const ready = classified > 0;
  const deadline = summary.nextDeadline;
  const potFill = summary.balance > 0 ? summary.setAside / summary.balance : 0;
  const short = summary.safeToSpend < 0;

  return (
    <div className="grid gap-3 md:grid-cols-[1.35fr_1fr_1fr_1.1fr]">
      {/* Put aside */}
      <div className="relative overflow-hidden rounded-2xl bg-sa-ink px-5 py-4 text-sa-paper">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[12px] font-medium uppercase tracking-[0.12em] text-sa-marigold">Put aside for tax</div>
            <div className="display mt-1 text-[44px] font-semibold leading-none">
              {ready ? <Money minor={summary.setAside} currency={cur} /> : <span className="text-sa-paper/40">{cur === 'GBP' ? '£' : '$'}—</span>}
            </div>
            <div className="mt-2 text-[12px] text-sa-paper/70">
              {ready ? (
                <>
                  {summary.estimate.lines.map((l, i) => (
                    <span key={l.label}>
                      {i > 0 && ' · '}
                      {l.label} <Money minor={l.amount} currency={cur} />
                    </span>
                  ))}
                  {' · '}
                  {pct(summary.estimate.effectiveBps)} of <Money minor={summary.breakdown.profit} currency={cur} /> profit so far
                </>
              ) : (
                'Classify your PayPal activity to estimate it.'
              )}
            </div>
            {scenario && (
              <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-sa-marigold/20 px-2.5 py-1 text-[12px] text-sa-marigold">
                What-if {settings.upliftBps > 0 ? '+' : ''}
                {settings.upliftBps / 100}% prices: <Money minor={scenario.setAside} currency={cur} className="font-semibold" />
              </div>
            )}
          </div>
          <PotIcon size={74} fill={ready ? Math.min(1, potFill * 1.6 + 0.08) : 0.05} />
        </div>
      </div>

      {/* Safe to spend */}
      <div className="rounded-2xl border border-sa-line bg-sa-surface px-5 py-4">
        <div className="text-[12px] font-medium uppercase tracking-[0.12em] text-sa-muted">Safe to spend</div>
        <div className={`display mt-1 text-[34px] font-semibold leading-none ${short ? 'text-sa-clay' : 'text-sa-forest'}`}>
          {ready ? <Money minor={summary.safeToSpend} currency={cur} /> : '—'}
        </div>
        <div className="mt-2 text-[12px] leading-snug text-sa-muted">
          PayPal balance <Money minor={summary.balance} currency={cur} className="font-medium text-sa-ink-2" /> minus the set-aside.
          {ready && (
            <>
              {' '}
              Full-year tax on this pace: <Money minor={summary.projectedYearTax} currency={cur} className="font-medium text-sa-ink-2" />.
            </>
          )}
        </div>
      </div>

      {/* Next deadline */}
      <div className="rounded-2xl border border-sa-line bg-sa-surface px-5 py-4">
        <div className="text-[12px] font-medium uppercase tracking-[0.12em] text-sa-muted">Next deadline</div>
        {deadline ? (
          <>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="display text-[34px] font-semibold leading-none text-sa-ink">{formatDay(deadline.date, { year: false })}</span>
              <span className={`num rounded-full px-2 py-0.5 text-[12px] font-semibold ${deadline.daysAway <= 21 ? 'bg-sa-clay-soft text-sa-clay' : 'bg-sa-paper-2 text-sa-ink-2'}`}>
                {deadline.daysAway} days
              </span>
            </div>
            <div className="mt-2 text-[12px] leading-snug text-sa-muted">
              <span className="font-medium text-sa-ink-2">{deadline.label}.</span> {deadline.note}
            </div>
          </>
        ) : (
          <div className="mt-2 text-[13px] text-sa-muted">No deadlines left this tax year.</div>
        )}
      </div>

      {/* Classification */}
      <div className="flex flex-col justify-between rounded-2xl border border-sa-line bg-sa-surface px-5 py-4">
        <div className="text-[12px] font-medium uppercase tracking-[0.12em] text-sa-muted">Your PayPal activity</div>
        {classifying ? (
          <div className="mt-2">
            <div className="text-[14px] font-semibold text-sa-ink">
              AI is classifying… <span className="num">{classifying.done}</span>/<span className="num">{classifying.total}</span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-sa-paper-2">
              <div className="h-full rounded-full bg-sa-marigold transition-all duration-700" style={{ width: `${Math.max(6, (classifying.done / classifying.total) * 100)}%` }} />
            </div>
          </div>
        ) : counts.unclassified > 0 ? (
          <button onClick={onClassify} className="mt-2 rounded-xl bg-sa-forest px-4 py-3 text-left text-sa-paper shadow-sm transition hover:bg-sa-forest-2">
            <div className="text-[15px] font-semibold">Classify {counts.unclassified} transactions with AI</div>
            <div className="text-[12px] text-sa-paper/75">Sale, client, refund, fee, personal or reimbursement, with a reason for each</div>
          </button>
        ) : (
          <div className="mt-1">
            <div className="num text-[14px] text-sa-ink">
              <strong>{counts.total}</strong> sorted · <strong>{counts.ruleMatched}</strong> by your rules
            </div>
            {counts.needsReview > 0 ? (
              <button onClick={onReview} className="mt-2 w-full rounded-xl bg-sa-marigold px-3 py-2 text-left text-[13px] font-semibold text-sa-ink hover:brightness-105">
                {counts.needsReview} need a quick look →
              </button>
            ) : (
              <div className="mt-2 rounded-xl bg-sa-mint px-3 py-2 text-[13px] font-medium text-sa-forest">All reviewed ✓</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

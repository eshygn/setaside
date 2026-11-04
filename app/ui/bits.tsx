'use client';

import { CATEGORY_META, type Category } from '@/lib/categories';
import { formatMoney, type Currency } from '@/lib/money';

export function Logo() {
  return (
    <div className="flex items-center gap-2">
      <PotIcon size={30} fill={0.62} />
      <span className="display text-[22px] font-semibold leading-none text-sa-ink">SetAside</span>
    </div>
  );
}

/** A jar: the brand mark, and the tax pot itself when `fill` is a live ratio. */
export function PotIcon({ size = 28, fill = 0.5, tone = 'var(--sa-marigold)' }: { size?: number; fill?: number; tone?: string }) {
  const f = Math.max(0, Math.min(1, fill));
  const top = 9 + (1 - f) * 18;
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <defs>
        <clipPath id={`jar-${size}`}>
          <path d="M9 8h14v2.5c2.4 1.4 4 4 4 7V25a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4v-7.5c0-3 1.6-5.6 4-7V8z" />
        </clipPath>
      </defs>
      <rect x="8" y="3" width="16" height="4" rx="1.6" fill="var(--sa-forest)" />
      <g clipPath={`url(#jar-${size})`}>
        <rect x="0" y="0" width="32" height="32" fill="var(--sa-surface)" />
        <rect x="0" y={top} width="32" height={32 - top} fill={tone} style={{ transition: 'y 0.8s ease, height 0.8s ease' }} />
      </g>
      <path d="M9 8h14v2.5c2.4 1.4 4 4 4 7V25a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4v-7.5c0-3 1.6-5.6 4-7V8z" fill="none" stroke="var(--sa-forest)" strokeWidth="1.8" />
    </svg>
  );
}

export function StatusChip({ label, value, tone, title }: { label: string; value: string; tone: 'live' | 'mock' | 'recorded'; title?: string }) {
  const dot = tone === 'live' ? 'bg-sa-forest-2' : tone === 'recorded' ? 'bg-sa-marigold' : 'bg-sa-muted';
  return (
    <span title={title} className="flex h-8 items-center gap-1.5 rounded-full border border-sa-line bg-sa-surface px-3 text-[12px]">
      <span className={`h-2 w-2 rounded-full ${dot} ${tone === 'live' ? 'shadow-[0_0_0_3px_var(--sa-mint)]' : ''}`} />
      <span className="text-sa-muted">{label}</span>
      <span className="font-semibold text-sa-ink">{value}</span>
    </span>
  );
}

export function CategoryChip({ category, dim }: { category: Category | null; dim?: boolean }) {
  if (!category) return <span className="text-[12px] text-sa-muted">—</span>;
  const meta = CATEGORY_META[category];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[12px] font-medium leading-5 ${dim ? 'opacity-60' : ''}`} style={{ background: `color-mix(in srgb, ${meta.color} 14%, transparent)`, color: meta.color }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: meta.color }} />
      {meta.label}
    </span>
  );
}

export function Money({ minor, currency, className = '', whole, signed }: { minor: number; currency: Currency; className?: string; whole?: boolean; signed?: boolean }) {
  const text = formatMoney(minor, currency, { whole });
  return <span className={`num ${className}`}>{signed && minor > 0 ? `+${text}` : text}</span>;
}

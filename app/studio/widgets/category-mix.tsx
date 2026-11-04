'use client';

// Custom AG Studio widget: where the money came from. One proportional bar split by category,
// then a row per category with its amount, share and the AI's average confidence. Click a row to
// cross-filter the rest of the page to that category (ctrl/cmd-click to add more).

import { useEffect, useRef, useState, type MouseEvent } from 'react';
import type { AgWidgetParams } from 'ag-studio';
import { CATEGORY_META, CATEGORIES } from '@/lib/categories';
import type { CategoryMixDef } from './types';

const META_BY_LABEL = new Map(CATEGORIES.map((c) => [CATEGORY_META[c].label, CATEGORY_META[c]]));

type Row = { category: string; value: number; display: string; confidence?: number };

export function CategoryMixWidget(params: AgWidgetParams<CategoryMixDef>) {
  const { dataMapping, widgetApi, format } = params;
  const [rows, setRows] = useState<Row[] | null>(null);
  const loaded = useRef(false);
  const selected = new Set<unknown>();
  widgetApi.getCrossFilterSelections()?.forEach((s) => {
    if (s.type === 'value') s.values.forEach((v) => selected.add(v));
  });
  const showConfidence = format?.style?.showConfidence ?? true;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const category = dataMapping.category?.at(0);
      const value = dataMapping.value?.at(0);
      const confidence = dataMapping.confidence?.at(0);
      if (!category || !value) {
        widgetApi.setDisplayState('incompleteDataMapping');
        return;
      }
      widgetApi.setDisplayState('loading', { prominent: !loaded.current });
      const res = await widgetApi.getData({ fields: [category, value, ...(confidence ? [confidence] : [])], sort: [{ field: value, direction: 'desc' }] });
      if (cancelled) return;
      const next = res.results.rows
        .map((r) => ({
          category: String(r[category.key]),
          value: Number(r[value.key] ?? 0),
          display: widgetApi.formatFieldValue(value, r[value.key]),
          confidence: confidence ? Number(r[confidence.key]) : undefined,
        }))
        .filter((r) => r.value > 0);
      loaded.current = true;
      setRows(next);
      widgetApi.setDisplayState(next.length ? 'displayed' : 'noData');
    })();
    return () => {
      cancelled = true;
    };
  }, [dataMapping, widgetApi]);

  if (!rows) return null;
  const total = rows.reduce((t, r) => t + r.value, 0) || 1;
  const taxable = rows.filter((r) => META_BY_LABEL.get(r.category)?.taxable).reduce((t, r) => t + r.value, 0);
  const toggle = (e: MouseEvent, value: string) => {
    e.stopPropagation();
    const field = dataMapping.category?.at(0);
    if (field) widgetApi.toggleCrossFilter({ type: 'value', value, field, group: 0, reset: !(e.metaKey || e.ctrlKey) });
  };

  return (
    <div className="flex h-full flex-col gap-3 px-3 pb-2" onClick={() => widgetApi.resetCrossFilter()}>
      <div className="flex h-7 overflow-hidden rounded-lg">
        {rows.map((r) => (
          <button
            key={r.category}
            title={`${r.category}: ${r.display}`}
            onClick={(e) => toggle(e, r.category)}
            className="h-full transition-opacity"
            style={{ width: `${(r.value / total) * 100}%`, background: META_BY_LABEL.get(r.category)?.color ?? 'var(--sa-muted)', opacity: selected.size && !selected.has(r.category) ? 0.3 : 1 }}
          />
        ))}
      </div>
      <div className="text-[12px] text-sa-muted">
        <span className="num font-semibold text-sa-ink">{Math.round((taxable / total) * 100)}%</span> of this is taxable business income; the rest is personal money or costs being paid back.
      </div>
      <div className="flex-1 space-y-1 overflow-auto">
        {rows.map((r) => {
          const meta = META_BY_LABEL.get(r.category);
          const active = selected.has(r.category);
          return (
            <button
              key={r.category}
              onClick={(e) => toggle(e, r.category)}
              className={`grid w-full grid-cols-[10px_1fr_auto_auto] items-center gap-3 rounded-lg px-2 py-1.5 text-left text-[13px] transition ${active ? 'bg-sa-marigold-soft' : 'hover:bg-sa-paper'}`}
            >
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: meta?.color }} />
              <span className="min-w-0">
                <span className="font-medium text-sa-ink">{r.category}</span>
                <span className="ml-2 text-[11px] text-sa-muted">{meta?.group}</span>
              </span>
              {showConfidence && r.confidence !== undefined ? <Confidence value={r.confidence} /> : <span />}
              <span className="num text-right font-semibold text-sa-ink">{r.display}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Confidence({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color = pct >= 80 ? 'var(--sa-forest-2)' : pct >= 60 ? 'var(--sa-marigold)' : 'var(--sa-clay)';
  return (
    <span className="flex items-center gap-1 text-[11px] text-sa-muted" title="Average AI confidence">
      <svg width="16" height="16" viewBox="0 0 20 20">
        <circle cx="10" cy="10" r="8" fill="none" stroke="var(--sa-paper-2)" strokeWidth="3" />
        <circle cx="10" cy="10" r="8" fill="none" stroke={color} strokeWidth="3" strokeDasharray={`${(pct / 100) * 50.3} 50.3`} transform="rotate(-90 10 10)" strokeLinecap="round" />
      </svg>
      <span className="num">{pct}%</span>
    </span>
  );
}

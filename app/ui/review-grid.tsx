'use client';

// The review queue: every PayPal transaction with the AI's category, confidence and reason.
// Change a category and SetAside turns the correction into a rule, applies it to similar rows
// and flashes them, so the person sees the AI learn.

import { useEffect, useMemo, useRef, useState } from 'react';
import { AllEnterpriseModule, LicenseManager } from 'ag-grid-enterprise';
import { ModuleRegistry, themeQuartz, type CellValueChangedEvent, type ColDef, type GetRowIdParams, type GridApi, type ICellRendererParams } from 'ag-grid-community';
import { AgGridReact } from 'ag-grid-react';
import { CATEGORIES, CATEGORY_META, type Category } from '@/lib/categories';
import { formatMoney } from '@/lib/money';
import { REVIEW_LABEL, type ReviewState } from '@/lib/review';
import type { Snapshot, TxRow } from '@/lib/service';
import { api } from './api';
import { CategoryChip } from './bits';
import { formatDay } from './format';

ModuleRegistry.registerModules([AllEnterpriseModule]);

let licensed = false;
export function applyLicense(key?: string) {
  if (key && !licensed) {
    LicenseManager.setLicenseKey(key);
    licensed = true;
  }
}

const gridTheme = themeQuartz.withParams({
  fontFamily: 'var(--sa-font)',
  fontSize: 13,
  backgroundColor: 'var(--sa-surface)',
  foregroundColor: 'var(--sa-ink)',
  headerBackgroundColor: 'var(--sa-surface)',
  headerTextColor: 'var(--sa-muted)',
  headerFontWeight: 600,
  borderColor: 'var(--sa-line)',
  rowBorder: { color: 'var(--sa-line-soft)' },
  accentColor: 'var(--sa-forest)',
  rowHoverColor: 'color-mix(in srgb, var(--sa-marigold) 9%, transparent)',
  selectedRowBackgroundColor: 'color-mix(in srgb, var(--sa-forest) 8%, transparent)',
  wrapperBorderRadius: 16,
  rowHeight: 46,
  headerHeight: 40,
  cellHorizontalPadding: 12,
});

type View = 'review' | 'all' | 'business' | 'personal' | 'rules';

const VIEWS: { id: View; label: string; test: (r: TxRow) => boolean }[] = [
  { id: 'review', label: 'Needs review', test: (r) => r.state === 'needs_review' },
  { id: 'all', label: 'All', test: () => true },
  { id: 'business', label: 'Business', test: (r) => r.category !== null && CATEGORY_META[r.category].group !== 'Not business' },
  { id: 'personal', label: 'Not business', test: (r) => r.category !== null && CATEGORY_META[r.category].group === 'Not business' },
  { id: 'rules', label: 'Changed by your rules', test: (r) => r.state === 'rule_matched' || r.state === 'corrected' },
];

export function ReviewGrid(props: {
  snap: Snapshot;
  licenseKey?: string;
  flash: { ids: Set<string>; at: number };
  classifying: boolean;
  onCorrected: (ids: string[], message: { title: string; body?: string }) => void;
  onChanged: () => void;
}) {
  applyLicense(props.licenseKey);
  const { snap } = props;
  const apiRef = useRef<GridApi<TxRow> | null>(null);
  const [view, setView] = useState<View>(() => (snap.counts.needsReview > 0 ? 'review' : 'all'));
  const [search, setSearch] = useState('');
  const cur = snap.preset.currency;

  // When classification finishes and there is something to check, go straight to the queue.
  const pending = snap.counts.unclassified;
  const [lastPending, setLastPending] = useState(pending);
  if (pending !== lastPending) {
    setLastPending(pending);
    if (pending === 0 && snap.counts.needsReview > 0) setView('review');
  }

  const counts = useMemo(() => Object.fromEntries(VIEWS.map((v) => [v.id, snap.rows.filter(v.test).length])) as Record<View, number>, [snap.rows]);
  // Stay on "Needs review" while it has rows; once it empties, show everything.
  const activeView: View = view === 'review' && counts.review === 0 && snap.counts.unclassified === 0 ? 'all' : view;
  const rows = useMemo(() => {
    const test = VIEWS.find((v) => v.id === activeView)!.test;
    // Rows a rule just changed stay visible in the review view so the person sees them flip.
    return snap.rows.filter((r) => test(r) || props.flash.ids.has(r.id) || (activeView === 'review' && r.state === 'unclassified'));
  }, [snap.rows, activeView, props.flash]);

  const columnDefs = useMemo<ColDef<TxRow>[]>(
    () => [
      { field: 'state', headerName: '', width: 112, cellRenderer: StateRenderer, sortable: true, filter: 'agSetColumnFilter', valueFormatter: (p) => REVIEW_LABEL[p.value as ReviewState] },
      { field: 'date', headerName: 'Date', width: 104, sort: 'desc', valueFormatter: (p) => formatDay(p.value, { year: false }), filter: 'agDateColumnFilter' },
      { field: 'counterparty', headerName: 'Who', width: 190, cellRenderer: WhoRenderer, filter: 'agSetColumnFilter' },
      {
        headerName: 'What PayPal says',
        colId: 'detail',
        flex: 1.2,
        minWidth: 200,
        valueGetter: (p) => [p.data?.subject, p.data?.note].filter(Boolean).join(' — ') || p.data?.eventCode,
        cellClass: 'text-sa-ink-2',
        tooltipValueGetter: (p) => `${p.data?.eventCode ?? ''} · ${p.value ?? ''}`,
      },
      {
        field: 'amount',
        headerName: 'Amount',
        width: 116,
        type: 'rightAligned',
        cellClass: (p) => `num font-medium ${p.value < 0 ? 'text-sa-clay' : 'text-sa-ink'}`,
        valueFormatter: (p) => formatMoney(p.value, cur),
        filter: 'agNumberColumnFilter',
      },
      {
        field: 'category',
        headerName: 'Category  ✎',
        width: 170,
        editable: (p) => p.data?.state !== 'unclassified',
        cellEditor: 'agRichSelectCellEditor',
        cellEditorParams: { values: [...CATEGORIES], cellRenderer: CategoryOption, valueListGap: 4 },
        cellEditorPopup: true,
        singleClickEdit: true,
        cellRenderer: (p: ICellRendererParams<TxRow>) => (
          <span className="flex h-full items-center">
            <CategoryChip category={p.value} />
          </span>
        ),
        filter: 'agSetColumnFilter',
        filterParams: { valueFormatter: (p: { value: Category }) => (p.value ? CATEGORY_META[p.value].label : '—') },
      },
      { field: 'confidence', headerName: 'Confidence', width: 128, cellRenderer: ConfidenceRenderer, filter: 'agNumberColumnFilter' },
      { field: 'reason', headerName: 'Why', flex: 1.6, minWidth: 240, cellClass: 'text-[12.5px] text-sa-ink-2', tooltipField: 'reason', wrapText: false },
      { field: 'method', headerName: 'By', width: 104, cellRenderer: MethodRenderer, filter: 'agSetColumnFilter' },
      { field: 'fee', headerName: 'Fee', width: 92, type: 'rightAligned', hide: false, cellClass: 'num text-sa-muted', valueFormatter: (p) => (p.value ? formatMoney(p.value, cur) : '') },
    ],
    [cur],
  );

  // Flash the rows a rule just changed.
  useEffect(() => {
    const grid = apiRef.current;
    if (!grid || !props.flash.ids.size) return;
    const t = setTimeout(() => {
      const nodes = [...props.flash.ids].map((id) => grid.getRowNode(id)).filter((n) => n !== undefined);
      grid.flashCells({ rowNodes: nodes, flashDuration: 1600, fadeDuration: 1400 });
      if (nodes[0]) grid.ensureNodeVisible(nodes[0], 'middle');
    }, 120);
    return () => clearTimeout(t);
  }, [props.flash]);

  const onCellValueChanged = async (e: CellValueChangedEvent<TxRow>) => {
    if (e.colDef.field !== 'category' || !e.data || e.newValue === e.oldValue) return;
    const res = await api.correct(e.data.id, e.newValue);
    const label = CATEGORY_META[e.newValue as Category].label;
    props.onCorrected([e.data.id, ...res.updated], {
      title: res.updated.length ? `Rule learned · ${res.updated.length} similar row${res.updated.length === 1 ? '' : 's'} updated` : `Marked as ${label}`,
      body: res.rule ? `“${res.rule.description}.” The classifier will follow it for new transactions too.` : undefined,
    });
  };

  const acceptVisible = async () => {
    const ids = rows.filter((r) => r.state === 'needs_review').map((r) => r.id);
    if (!ids.length) return;
    await api.accept(ids);
    props.onChanged();
  };

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1 rounded-full border border-sa-line bg-sa-surface p-1">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              onClick={() => setView(v.id)}
              className={`rounded-full px-3 py-1 text-[13px] font-medium transition ${activeView === v.id ? 'bg-sa-ink text-sa-paper' : 'text-sa-ink-2 hover:bg-sa-paper-2'}`}
            >
              {v.label} <span className="num opacity-70">{counts[v.id]}</span>
            </button>
          ))}
        </div>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search payer, note, amount…"
          className="h-9 w-[240px] rounded-full border border-sa-line bg-sa-surface px-4 text-[13px] outline-none focus:border-sa-forest"
        />
        {activeView === 'review' && counts.review > 0 && (
          <button onClick={acceptVisible} className="h-9 rounded-full border border-sa-forest px-4 text-[13px] font-medium text-sa-forest hover:bg-sa-mint">
            Accept the rest as suggested
          </button>
        )}
        <span className="ml-auto text-[12px] text-sa-muted">
          {activeView === 'review' ? 'Click a category to fix it. Your fix becomes a rule for similar rows.' : `${rows.length} rows · tax year ${snap.preset.taxYear.label} to ${formatDay(snap.settings.clock)}`}
        </span>
      </div>

      <div className="h-[600px] min-h-[420px]">
        <AgGridReact<TxRow>
          theme={gridTheme}
          rowData={rows}
          columnDefs={columnDefs}
          defaultColDef={{ sortable: true, resizable: true, suppressHeaderMenuButton: true }}
          getRowId={(p: GetRowIdParams<TxRow>) => p.data.id}
          quickFilterText={search}
          onGridReady={(e) => (apiRef.current = e.api)}
          onCellValueChanged={onCellValueChanged}
          animateRows
          tooltipShowDelay={400}
          stopEditingWhenCellsLoseFocus
          overlayNoRowsTemplate={props.classifying ? 'Classifying…' : 'Nothing here.'}
          statusBar={{ statusPanels: [{ statusPanel: 'agTotalAndFilteredRowCountComponent', align: 'left' }, { statusPanel: 'agAggregationComponent' }] }}
          cellSelection
        />
      </div>
    </div>
  );
}

// --- Cell renderers ------------------------------------------------------------------------------------

function StateRenderer(p: ICellRendererParams<TxRow>) {
  const s = p.value as ReviewState;
  const style: Record<ReviewState, string> = {
    unclassified: 'bg-sa-paper-2 text-sa-muted',
    needs_review: 'bg-sa-marigold-soft text-[#8a5a12]',
    auto_ok: 'bg-sa-paper-2 text-sa-ink-2',
    rule_matched: 'bg-sa-marigold text-sa-ink',
    confirmed: 'bg-sa-mint text-sa-forest',
    corrected: 'bg-sa-forest text-sa-paper',
  };
  return (
    <span className="flex h-full items-center">
      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold leading-4 ${style[s]}`}>{REVIEW_LABEL[s]}</span>
    </span>
  );
}

function WhoRenderer(p: ICellRendererParams<TxRow>) {
  return (
    <div className="flex h-full flex-col justify-center leading-tight">
      <span className="truncate font-medium text-sa-ink">
        {p.value}
        {p.data?.origin === 'sandbox' && <span className="ml-1.5 rounded bg-sa-sky/15 px-1 text-[10px] font-bold uppercase text-sa-sky">live</span>}
      </span>
      {p.data?.email && <span className="truncate text-[11px] text-sa-muted">{p.data.email}</span>}
    </div>
  );
}

function ConfidenceRenderer(p: ICellRendererParams<TxRow>) {
  if (p.value === null || p.value === undefined) return <span className="text-sa-muted">—</span>;
  const v = p.value as number;
  const color = v >= 80 ? 'var(--sa-forest-2)' : v >= 60 ? 'var(--sa-marigold)' : 'var(--sa-clay)';
  return (
    <div className="flex h-full items-center gap-2">
      <div className="h-1.5 w-14 overflow-hidden rounded-full bg-sa-paper-2">
        <div className="h-full rounded-full" style={{ width: `${v}%`, background: color }} />
      </div>
      <span className="num text-[12px] font-medium" style={{ color }}>
        {v}%
      </span>
    </div>
  );
}

function MethodRenderer(p: ICellRendererParams<TxRow>) {
  const label: Record<string, string> = { ai: 'Gemini', recorded: 'Gemini (rec.)', heuristic: 'Offline', rule: 'Your rule', manual: 'You' };
  return <span className="text-[12px] text-sa-muted">{p.value ? (label[p.value] ?? p.value) : ''}</span>;
}

function CategoryOption(p: { value: Category }) {
  return (
    <div className="flex items-center gap-2 py-1">
      <CategoryChip category={p.value} />
      <span className="truncate text-[11px] text-sa-muted">{CATEGORY_META[p.value].group}</span>
    </div>
  );
}

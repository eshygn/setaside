'use client';

// SetAside's custom agent in AG Studio's Agent Framework. One agent, "SetAside analyst", runs on
// Studio's Direct LLM Runner against Gemini (./gemini-adapter.ts). It gets a curated set of
// Studio's own tools (read the schema and page, query, add/move/remove widgets, filter, create
// calculated fields) plus three tools of ours:
//   - set_price_what_if: edits the tax widgets on the page live to show a price-change scenario
//   - get_tax_position: the exact set-aside figures, deadlines and assumptions from the tax engine
//   - add_setaside_widget: places one of our custom widgets with the right data mapping

import { createAiHarness, directLlmRunner, type AgAiHarnessSetup, type AgAiPromptStarter, type AgReportState, type AgStudioApi } from 'ag-studio';
import { CATEGORIES, CATEGORY_META } from '@/lib/categories';
import { formatMoney } from '@/lib/money';
import type { Snapshot } from '@/lib/service';
import { NOT_TAX_ADVICE } from '@/lib/tax/presets';
import { geminiAdapter, type AgentModeListener } from './gemini-adapter';
import { taxFor, type MoneySums } from './widgets/tax-maths';
import { TAX_MONEY_MAPPING, type SetAsideWidgetType } from './widgets/types';
import { getTaxContext } from './store';
import { studioRows } from './data';

export const PROMPT_STARTERS: AgAiPromptStarter[] = [
  { label: 'Refunds vs sales by month', prompt: 'Show refunds against sales by month.' },
  { label: 'What if I’d charged 10% more?', prompt: 'What if I’d charged 10% more?' },
  { label: 'Am I on track for the deadline?', prompt: 'How much should I have put aside by my next deadline, and am I on track?' },
  { label: 'Who are my best clients?', prompt: 'Which clients paid me the most this tax year?' },
];

type Deps = {
  snapshot: () => Snapshot;
  onMode: AgentModeListener;
  /** Persist the what-if on the server so the header and Review tab show it too. */
  onWhatIf: (upliftBps: number) => Promise<void>;
};

export function buildAgent(deps: Deps): AgAiHarnessSetup {
  const adapter = geminiAdapter({ endpoint: '/api/agent', onMode: deps.onMode });

  return ({ api }) =>
    createAiHarness(api, ({ tools: { studio } }) => {
      const whatIf = api.defineAiTool({
        name: 'set_price_what_if',
        description:
          'Show what the set-aside would be if prices (sales and client work) had been different by a percentage. Updates the tax pot and deadline widgets on the page live and returns before/after figures. Use 0 to clear.',
        params: (s) => s.object({ percent: s.number({ description: 'Price change in percent, e.g. 10 for 10% more, -5 for 5% less. Between -50 and 100.' }) }),
        execute: async (args: { percent: number }, ctx) => {
          const percent = Math.max(-50, Math.min(100, Math.round(args.percent * 10) / 10));
          setWidgetStyle(api, ['tax-pot', 'deadline-strip'], { upliftPercent: percent });
          await deps.onWhatIf(Math.round(percent * 100));
          const snap = deps.snapshot();
          const tc = getTaxContext();
          const sums = sumsFrom(snap);
          if (!tc) return ctx.success(`Applied a ${percent}% what-if.`);
          const before = taxFor(tc, sums);
          const after = taxFor(tc, sums, Math.round(percent * 100));
          const m = (v: number) => formatMoney(v, snap.preset.currency);
          return ctx.success(
            JSON.stringify({
              percent,
              profitBefore: m(before.profit),
              profitAfter: m(after.profit),
              setAsideBefore: m(before.total),
              setAsideAfter: m(after.total),
              extraTax: m(after.total - before.total),
              extraKeptAfterTax: m(after.profit - after.total - (before.profit - before.total)),
              widgetsUpdated: 'tax pot and deadline strip on this page now show the what-if line',
            }),
          );
        },
      });

      const position = api.defineAiTool({
        name: 'get_tax_position',
        description: 'The exact current set-aside, safe-to-spend, profit breakdown, next deadline and the assumptions behind them, from SetAside’s tax engine. Use this instead of computing tax yourself.',
        params: (s) => s.object({}),
        execute: async (_args, ctx) => {
          const snap = deps.snapshot();
          const m = (v: number) => formatMoney(v, snap.preset.currency);
          const { summary } = snap;
          return ctx.success(
            JSON.stringify({
              preset: snap.preset.name,
              today: snap.settings.clock,
              setAside: m(summary.setAside),
              safeToSpend: m(summary.safeToSpend),
              paypalBalance: m(summary.balance),
              profitSoFar: m(summary.breakdown.profit),
              turnover: m(summary.breakdown.turnover),
              refunds: m(summary.breakdown.refunds),
              fees: m(summary.breakdown.fees),
              taxLines: summary.estimate.lines.map((l) => `${l.label}: ${m(l.amount)}`),
              projectedFullYearTax: m(summary.projectedYearTax),
              nextDeadline: summary.nextDeadline,
              quarters: snap.quarters.map((q) => ({ quarter: q.label, status: q.status, profit: m(q.profit), setAsideAdded: m(q.setAside) })),
              assumptions: snap.preset.assumptions.map((a) => `${a.label}: ${a.value}`),
              disclaimer: NOT_TAX_ADVICE,
            }),
          );
        },
      });

      const addOurs = api.defineAiTool({
        name: 'add_setaside_widget',
        description: 'Add one of SetAside’s own widgets to the current page, already wired to the right fields: the tax pot gauge, the quarterly deadline strip, or income by category.',
        params: (s) =>
          s.object({
            kind: s.enum(['tax-pot', 'deadline-strip', 'category-mix'] as const, { description: 'Which widget.' }),
            title: s.string({ description: 'Widget title.' }).optional(),
          }),
        execute: async (args: { kind: SetAsideWidgetType; title?: string }, ctx) => {
          const id = addCustomWidget(api, args.kind, args.title);
          return ctx.success(`Added ${args.kind} as widget ${id} at the bottom of the page.`);
        },
      });

      const buildChart = api.defineAiTool({
        name: 'build_chart',
        description:
          'Build a chart (or table) from the transactions and put it at the top of the current page, fully configured. One call does it all: prefer this over add_widget. Returns the new widget id and the totals it shows.',
        params: (s) =>
          s.object({
            type: s.enum(CHART_TYPES, { description: 'column-chart-grouped compares series side by side; line-chart for trends; column-chart-stacked for parts of a whole; donut-chart for shares; bar-chart-grouped for ranked names; grid for a table.' }),
            title: s.string({ description: 'Clear widget title, e.g. "Refunds against sales by month".' }),
            groupBy: s.enum(GROUP_FIELDS, { description: 'The x axis / slices: calendar::month for months, calendar::quarter, transactions.category, transactions.counterparty, transactions.taxQuarter.' }),
            values: s.array(s.enum(VALUE_FIELDS), { description: 'One or more money fields to sum, one series each.' }),
          }),
        execute: async (args: ChartSpec, ctx) => {
          const id = addChartWidget(api, args);
          return ctx.success(JSON.stringify({ widgetId: id, placedAt: 'top of the page', totals: totalsFor(deps.snapshot(), args.values) }));
        },
      });

      const editChart = api.defineAiTool({
        name: 'edit_chart',
        description: 'Change a chart already on the page: its type, title, grouping or the series it shows. Use view_page to find widget ids.',
        params: (s) =>
          s.object({
            widgetId: s.widgetId(),
            type: s.enum(CHART_TYPES).optional(),
            title: s.string().optional(),
            groupBy: s.enum(GROUP_FIELDS).optional(),
            values: s.array(s.enum(VALUE_FIELDS)).optional(),
          }),
        execute: async (args: Partial<ChartSpec> & { widgetId: string }, ctx) => {
          const ok = editChartWidget(api, args);
          return ok ? ctx.success(`Updated ${args.widgetId}.`) : ctx.error(`No chart called ${args.widgetId} on this page.`);
        },
      });

      const queryTotals = api.defineAiTool({
        name: 'query_totals',
        description: 'Sum money fields over the classified transactions, grouped by one field, biggest first. Use it to answer questions with numbers.',
        params: (s) =>
          s.object({
            groupBy: s.enum(['month', 'category', 'counterparty', 'taxQuarter'] as const),
            value: s.enum(VALUE_FIELDS),
            top: s.number({ description: 'How many groups to return. Defaults to 8.' }).optional(),
          }),
        execute: async (args: { groupBy: 'month' | 'category' | 'counterparty' | 'taxQuarter'; value: (typeof VALUE_FIELDS)[number]; top?: number }, ctx) =>
          ctx.success(JSON.stringify(groupTotals(deps.snapshot(), args.groupBy, args.value, args.top ?? 8))),
      });

      return {
        agents: [
          directLlmRunner({
            id: 'setaside',
            name: 'SetAside analyst',
            description: 'Answers questions about PayPal income and tax set-asides by building and editing dashboard widgets.',
            adapter,
            maxTurns: 10,
            instructions: () => instructions(deps.snapshot()),
            // Studio's own tools for reading and arranging the page, plus ours. Studio's query and
            // filter tools are left out: their schemas are ~40 KB, which makes every free-tier
            // Gemini round slow, and build_chart / query_totals cover what the demo needs.
            tools: () => [studio.viewPage(), studio.positionWidget(), studio.removeWidget(), buildChart, editChart, queryTotals, whatIf, position, addOurs],
          }),
        ],
        primary: 'setaside',
        promptStarters: PROMPT_STARTERS,
      };
    });
}

function instructions(snap: Snapshot) {
  const cur = snap.preset.currency;
  return `You are SetAside's analyst inside an AG Studio dashboard. The user is ${snap.persona.name}, who sells art prints and does freelance web design on the side, paid through PayPal.
Their PayPal transactions are already classified into: ${CATEGORIES.map((c) => CATEGORY_META[c].label).join(', ')}.
Today (demo clock) is ${snap.settings.clock}. Tax preset: ${snap.preset.name}. All money is ${cur}.

How to work:
- Answer by building or editing widgets on the current page whenever a chart helps, then reply in 1–3 short sentences with the key numbers.
- The data source is "transactions". Useful fields: transactions.date (use calendar::month for months), transactions.category, transactions.counterparty, and per-category amount columns transactions.sales, transactions.clientPayments, transactions.refunds (positive), transactions.paypalFees (positive), transactions.personal, transactions.reimbursements, plus transactions.taxableProfit and transactions.moneyIn.
- To show something, call build_chart once (e.g. refunds against sales by month: type column-chart-grouped, groupBy calendar::month, values [transactions.sales, transactions.refunds]). To change a chart, call edit_chart. Don't call view_page first unless you need a widget id.
- For numbers, call query_totals. For tax questions call get_tax_position; never compute tax yourself. For price what-ifs call set_price_what_if (it updates the tax widgets live).
- For SetAside's own widgets (tax pot, deadline strip, income by category) use add_setaside_widget.
- Call tools straight away, then finish with a short answer quoting the numbers the tools returned.
- When you give a tax figure, add once, briefly, that it is an estimate and not tax advice. Don't add it to answers that aren't about tax.`;
}

// --- Helpers for our tools -------------------------------------------------------------------------

function sumsFrom(snap: Snapshot): MoneySums {
  const s: MoneySums = { profit: snap.summary.breakdown.profit, fees: snap.summary.breakdown.fees, income: 0, incomeFees: 0 };
  for (const r of snap.rows) {
    if (r.category === 'sale' || r.category === 'client_payment') {
      s.income += r.amount;
      s.incomeFees += r.fee;
    }
  }
  return s;
}

type MutableWidget = { type: string; format?: { style?: Record<string, unknown> } & Record<string, unknown> };

export function setWidgetStyle(api: AgStudioApi, types: string[], style: Record<string, unknown>) {
  const state = api.getState() as AgReportState;
  const pages = state.pages.map((page) => {
    if (page.id !== state.selectedPageId) return page;
    const widgets = Object.fromEntries(
      Object.entries((page.widgets ?? {}) as Record<string, MutableWidget>).map(([id, w]) =>
        types.includes(w.type) ? [id, { ...w, format: { ...w.format, style: { ...w.format?.style, ...style } } }] : [id, w],
      ),
    );
    return { ...page, widgets };
  });
  api.setState({ ...state, pages } as AgReportState);
}

export function addCustomWidget(api: AgStudioApi, kind: SetAsideWidgetType, title?: string) {
  const state = api.getState() as AgReportState;
  const id = `${kind}-${Math.random().toString(36).slice(2, 7)}`;
  const widget =
    kind === 'tax-pot'
      ? { type: 'tax-pot', dataMapping: TAX_MONEY_MAPPING, format: { title: { enabled: true, text: title ?? 'Tax pot' }, style: { showBreakdown: true } } }
      : kind === 'deadline-strip'
        ? { type: 'deadline-strip', dataMapping: { quarter: [{ id: 'transactions.taxQuarter' }], ...TAX_MONEY_MAPPING }, format: { title: { enabled: true, text: title ?? 'Quarters and deadlines' } } }
        : {
            type: 'category-mix',
            dataMapping: { category: [{ id: 'transactions.category' }], value: [{ id: 'transactions.moneyIn', aggregation: 'sum' }], confidence: [{ id: 'transactions.confidence', aggregation: 'avg' }] },
            format: { title: { enabled: true, text: title ?? 'Where the money came from' }, style: { showConfidence: true } },
          };
  const size = kind === 'deadline-strip' ? { xSpan: 24, ySpan: 15 } : { xSpan: 12, ySpan: 18 };
  const pages = state.pages.map((page) => {
    if (page.id !== state.selectedPageId) return page;
    const layout = (page.widgetLayout ?? {}) as Record<string, { yTrack: number; ySpan: number }>;
    const bottom = Object.values(layout).reduce((max, l) => Math.max(max, l.yTrack + l.ySpan), 0);
    return { ...page, widgets: { ...page.widgets, [id]: widget }, widgetLayout: { ...page.widgetLayout, [id]: { xTrack: 0, yTrack: bottom, ...size } } };
  });
  api.setState({ ...state, pages, selectedPageId: state.selectedPageId } as AgReportState);
  return id;
}

// --- Charts the agent builds ----------------------------------------------------------------------

const CHART_TYPES = ['column-chart-grouped', 'column-chart-stacked', 'line-chart', 'area-chart', 'bar-chart-grouped', 'donut-chart', 'grid'] as const;
const GROUP_FIELDS = ['calendar::month', 'calendar::quarter', 'transactions.category', 'transactions.counterparty', 'transactions.taxQuarter'] as const;
const VALUE_FIELDS = [
  'transactions.sales',
  'transactions.clientPayments',
  'transactions.refunds',
  'transactions.paypalFees',
  'transactions.personal',
  'transactions.reimbursements',
  'transactions.taxableProfit',
  'transactions.moneyIn',
  'transactions.amount',
] as const;

type ChartSpec = { type: (typeof CHART_TYPES)[number]; title: string; groupBy: (typeof GROUP_FIELDS)[number]; values: (typeof VALUE_FIELDS)[number][] };

function chartWidget(spec: ChartSpec) {
  const values = spec.values.map((id) => ({ id, aggregation: 'sum' as const }));
  const title = { title: { enabled: true, text: spec.title } };
  if (spec.type === 'grid') return { type: 'grid', dataMapping: { cols: [{ id: spec.groupBy }, ...values] }, format: title };
  return { type: spec.type, dataMapping: { categoryKey: [{ id: spec.groupBy }], valueKey: values }, format: { ...title, style: { theme: { common: { legend: { enabled: values.length > 1 || spec.type === 'donut-chart' } } } } } };
}

/** Insert a configured chart full-width at the top of the page and push the rest down. */
export function addChartWidget(api: AgStudioApi, spec: ChartSpec) {
  const state = api.getState() as AgReportState;
  const id = `chart-${Math.random().toString(36).slice(2, 7)}`;
  const height = 16;
  const pages = state.pages.map((page) => {
    if (page.id !== state.selectedPageId) return page;
    const layout = Object.fromEntries(Object.entries((page.widgetLayout ?? {}) as Record<string, { yTrack: number }>).map(([k, l]) => [k, { ...l, yTrack: l.yTrack + height }]));
    return { ...page, widgets: { [id]: chartWidget(spec), ...page.widgets }, widgetLayout: { [id]: { xTrack: 0, yTrack: 0, xSpan: 24, ySpan: height }, ...layout } };
  });
  api.setState({ ...state, pages } as AgReportState);
  return id;
}

function editChartWidget(api: AgStudioApi, edit: Partial<ChartSpec> & { widgetId: string }) {
  const state = api.getState() as AgReportState;
  let found = false;
  const pages = state.pages.map((page) => {
    if (page.id !== state.selectedPageId) return page;
    const widgets = page.widgets as Record<string, { type: string; dataMapping?: { categoryKey?: { id: string }[]; valueKey?: { id: string }[] }; format?: { title?: { text?: string } } }>;
    const w = widgets?.[edit.widgetId];
    if (!w) return page;
    found = true;
    const spec: ChartSpec = {
      type: (edit.type ?? w.type) as ChartSpec['type'],
      title: edit.title ?? w.format?.title?.text ?? 'Chart',
      groupBy: (edit.groupBy ?? w.dataMapping?.categoryKey?.[0]?.id ?? 'calendar::month') as ChartSpec['groupBy'],
      values: (edit.values ?? w.dataMapping?.valueKey?.map((v) => v.id) ?? ['transactions.moneyIn']) as ChartSpec['values'],
    };
    return { ...page, widgets: { ...page.widgets, [edit.widgetId]: chartWidget(spec) } };
  });
  if (found) api.setState({ ...state, pages } as AgReportState);
  return found;
}

const FIELD_OF: Record<(typeof VALUE_FIELDS)[number], (r: ReturnType<typeof studioRows>[number]) => number> = {
  'transactions.sales': (r) => r.sales,
  'transactions.clientPayments': (r) => r.clientPayments,
  'transactions.refunds': (r) => r.refunds,
  'transactions.paypalFees': (r) => r.paypalFees,
  'transactions.personal': (r) => r.personal,
  'transactions.reimbursements': (r) => r.reimbursements,
  'transactions.taxableProfit': (r) => r.taxableProfit,
  'transactions.moneyIn': (r) => r.moneyIn,
  'transactions.amount': (r) => r.amount,
};

// Totals in whole currency for the model to quote (display only; tax maths stays in minor units).
function totalsFor(snap: Snapshot, values: (typeof VALUE_FIELDS)[number][]) {
  const rows = studioRows(snap);
  return Object.fromEntries(values.map((v) => [v, formatMoney(Math.round(rows.reduce((t, r) => t + FIELD_OF[v](r), 0) * 100), snap.preset.currency)]));
}

function groupTotals(snap: Snapshot, groupBy: 'month' | 'category' | 'counterparty' | 'taxQuarter', value: (typeof VALUE_FIELDS)[number], top: number) {
  const totals = new Map<string, number>();
  for (const r of studioRows(snap)) {
    const key = groupBy === 'month' ? r.date.slice(0, 7) : String(r[groupBy]);
    totals.set(key, (totals.get(key) ?? 0) + Math.round(FIELD_OF[value](r) * 100));
  }
  const sorted = [...totals.entries()].filter(([, v]) => v !== 0);
  sorted.sort((a, b) => (groupBy === 'month' ? a[0].localeCompare(b[0]) : b[1] - a[1]));
  return sorted.slice(0, groupBy === 'month' ? 24 : top).map(([k, v]) => ({ [groupBy]: k, total: formatMoney(v, snap.preset.currency) }));
}

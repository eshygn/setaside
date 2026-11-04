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
    createAiHarness(api, ({ tools: { studio, renameThread } }) => {
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

      return {
        agents: [
          directLlmRunner({
            id: 'setaside',
            name: 'SetAside analyst',
            description: 'Answers questions about PayPal income and tax set-asides by building and editing dashboard widgets.',
            adapter,
            maxTurns: 10,
            instructions: () => instructions(deps.snapshot()),
            tools: () => [
              studio.viewSchema(),
              studio.viewPage(),
              studio.executeQuery(),
              studio.addWidget(),
              studio.positionWidget(),
              studio.removeWidget(),
              studio.addPageFilter(),
              studio.removePageFilter(),
              studio.createExpression(),
              whatIf,
              position,
              addOurs,
              renameThread(),
            ],
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
- To compare categories over time, add a column-chart-grouped (or line-chart) with categoryKey calendar::month and valueKey = the sums of the category columns you are comparing. Give every widget a clear title.
- For tax questions call get_tax_position; never compute tax yourself. For price what-ifs call set_price_what_if (it updates the tax widgets live).
- For SetAside's own widgets (tax pot, deadline strip, income by category) use add_setaside_widget rather than add_widget.
- Don't call view_schema if the fields above are enough.
- Say figures are estimates. ${NOT_TAX_ADVICE}`;
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

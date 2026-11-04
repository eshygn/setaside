// The built-in "Tax pot" report: AG Studio state for two pages. Field ids ('transactions.sales')
// refer to app/studio/data.ts. Positions are canvas tracks: 24 columns, rows of 18px.

import type { AgPageState, AgReportState, AgWidgetLayoutState } from 'ag-studio';
import { TAX_MONEY_MAPPING, type SetAsideRegistry } from './widgets/types';

const at = (xTrack: number, yTrack: number, xSpan: number, ySpan: number): AgWidgetLayoutState => ({ xTrack, yTrack, xSpan, ySpan });
const title = (text: string, subtitle?: string) => ({ title: { enabled: true, text }, ...(subtitle && { subtitle: { enabled: true, text: subtitle } }) });
const sum = (id: string) => ({ id, aggregation: 'sum' as const });
const legend = { style: { theme: { common: { legend: { enabled: true } } } } };

const typography = (fontSize: number, fontWeight: 'normal' | 'bold' = 'normal') => ({ fontFamily: 'Fraunces, Georgia, serif', fontSize, fontWeight, fontStyle: 'normal' as const });
const kpi = (text: string, id: string) => ({
  type: 'value' as const,
  dataMapping: { value: [sum(id)], sparklineX: [{ id: 'calendar::month' }] },
  format: {
    title: { enabled: true, text, typography: { ...typography(13, 'bold'), fontFamily: 'var(--sa-font)' } },
    caption: { enabled: true, text: '', typography: typography(0) },
    style: { typography: typography(24, 'bold') },
  },
});

const overview: AgPageState<SetAsideRegistry> = {
  id: 'overview',
  widgets: {
    pot: { type: 'tax-pot', dataMapping: TAX_MONEY_MAPPING, format: { ...title('Tax pot', 'Your share of the PayPal balance vs the tax office’s'), style: { upliftPercent: 0, showBreakdown: true } } },
    deadlines: {
      type: 'deadline-strip',
      dataMapping: { quarter: [{ id: 'transactions.taxQuarter' }], ...TAX_MONEY_MAPPING },
      format: { ...title('Quarters and deadlines', 'What each quarter added to the pot'), style: { upliftPercent: 0 } },
    },
    mix: {
      type: 'category-mix',
      dataMapping: { category: [{ id: 'transactions.category' }], value: [sum('transactions.moneyIn')], confidence: [{ id: 'transactions.confidence', aggregation: 'avg' }] },
      format: { ...title('Where the money came from', 'Money in, by AI category: click to filter'), style: { showConfidence: true } },
    },
    monthly: {
      type: 'column-chart-stacked',
      dataMapping: { categoryKey: [{ id: 'calendar::month' }], valueKey: [sum('transactions.sales'), sum('transactions.clientPayments'), sum('transactions.reimbursements'), sum('transactions.personal')] },
      format: { ...title('Money in by month', 'Business income stacked under money that isn’t'), ...legend },
    },
  },
  widgetLayout: {
    pot: at(0, 0, 9, 15),
    deadlines: at(9, 0, 15, 15),
    mix: at(0, 15, 9, 20),
    monthly: at(9, 15, 15, 20),
  },
};

const detail: AgPageState<SetAsideRegistry> = {
  id: 'detail',
  widgets: {
    'kpi-sales': kpi('Sales', 'transactions.sales'),
    'kpi-clients': kpi('Client payments', 'transactions.clientPayments'),
    'kpi-refunds': kpi('Refunds', 'transactions.refunds'),
    'kpi-personal': kpi('Not business (excluded)', 'transactions.personal'),
    clients: {
      type: 'donut-chart',
      dataMapping: { categoryKey: [{ id: 'transactions.counterparty' }], valueKey: [sum('transactions.clientPayments')] },
      format: { ...title('Clients by income'), ...legend },
    },
    pivot: {
      type: 'pivot-grid',
      dataMapping: { rows: [{ id: 'transactions.taxQuarter' }], columns: [{ id: 'transactions.category' }], values: [sum('transactions.amount')] },
      format: { ...title('Each quarter by category'), style: { totalColumns: true, totalColumnsPlacement: 'after', grandTotalRow: { enabled: true } } },
    },
    review: {
      type: 'grid',
      dataMapping: {
        cols: [{ id: 'transactions.date' }, { id: 'transactions.counterparty' }, { id: 'transactions.category' }, { id: 'transactions.confidence' }, { id: 'transactions.method' }, sum('transactions.amount')],
      },
      sort: [{ field: { id: 'transactions.confidence' }, direction: 'asc' }],
      format: title('Least certain classifications first'),
    },
  },
  widgetLayout: {
    'kpi-sales': at(0, 0, 6, 7),
    'kpi-clients': at(6, 0, 6, 7),
    'kpi-refunds': at(12, 0, 6, 7),
    'kpi-personal': at(18, 0, 6, 7),
    clients: at(0, 7, 10, 18),
    pivot: at(10, 7, 14, 18),
    review: at(0, 25, 24, 18),
  },
};

export const builtInReport = {
  selectedPageId: 'overview',
  pages: [overview, detail],
  panels: { filters: { collapsed: true }, ai: { collapsed: false, width: 400 } },
} as unknown as AgReportState;

export const builtInPageTitles: Record<string, string> = { overview: 'Tax pot', detail: 'Income detail' };

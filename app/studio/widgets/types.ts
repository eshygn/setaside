// Types for SetAside's custom AG Studio widgets, registered alongside the built-in ones.

import type { AgBaseRegistry, AgBaseWidgetDefinition, AgDefaultRegistry, AgWidgetDataFormat, AgWidgetFieldReference } from 'ag-studio';

type Ref = AgWidgetFieldReference[];

/** The money fields every tax widget reads, all integer minor units summed by Studio. */
export type TaxMoneyMapping = {
  profit: Ref; // transactions.profitMinor
  fees: Ref; // transactions.feeCostMinor
  income: Ref; // transactions.incomeMinor
  incomeFees: Ref; // transactions.incomeFeeMinor
};

export type TaxPotStyle = { upliftPercent?: number; showBreakdown?: boolean };
export interface TaxPotDef {
  type: 'tax-pot';
  dataMapping: TaxMoneyMapping;
  format?: AgWidgetDataFormat<TaxPotStyle>;
}

export type DeadlineStripStyle = { upliftPercent?: number };
export interface DeadlineStripDef {
  type: 'deadline-strip';
  dataMapping: TaxMoneyMapping & { quarter: Ref };
  format?: AgWidgetDataFormat<DeadlineStripStyle>;
}

export type CategoryMixStyle = { showConfidence?: boolean };
export interface CategoryMixDef {
  type: 'category-mix';
  dataMapping: { category: Ref; value: Ref; confidence: Ref };
  format?: AgWidgetDataFormat<CategoryMixStyle>;
}

export type SetAsideWidgetType = 'tax-pot' | 'deadline-strip' | 'category-mix';

export interface SetAsideRegistry extends AgBaseRegistry {
  formats: AgDefaultRegistry['formats'];
  widgets: readonly (
    | AgDefaultRegistry['widgets'][number]
    | AgBaseWidgetDefinition<'tax-pot', TaxPotDef>
    | AgBaseWidgetDefinition<'deadline-strip', DeadlineStripDef>
    | AgBaseWidgetDefinition<'category-mix', CategoryMixDef>
  )[];
}

export const TAX_MONEY_MAPPING = {
  profit: [{ id: 'transactions.profitMinor', aggregation: 'sum' as const }],
  fees: [{ id: 'transactions.feeCostMinor', aggregation: 'sum' as const }],
  income: [{ id: 'transactions.incomeMinor', aggregation: 'sum' as const }],
  incomeFees: [{ id: 'transactions.incomeFeeMinor', aggregation: 'sum' as const }],
};

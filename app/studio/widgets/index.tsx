'use client';

// SetAside's custom widget definitions, added to Studio's catalogue with createWidgets() so they
// sit in the widget menu, take part in filtering, and are described to the AI agent.

import type { AgDataMappingDefinition, AgDefaultRegistry, AgWidgetsConfig } from 'ag-studio';
import { createWidgets } from 'ag-studio-react';
import { CategoryMixWidget } from './category-mix';
import { DeadlineStripWidget } from './deadline-strip';
import { TaxPotWidget } from './tax-pot';
import type { SetAsideRegistry } from './types';

const ICON = (path: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;

const numeric = (aiDescription: string, required = false): AgDataMappingDefinition<string> => ({
  type: 'field',
  supportedRoles: ['numeric'],
  requires: { cardinality: 'one' },
  required,
  aiDescription,
});

const moneyMapping = {
  profit: numeric('Integer business profit in minor units: transactions.profitMinor, summed.', true),
  fees: numeric('Integer allowable fees in minor units: transactions.feeCostMinor, summed.'),
  income: numeric('Integer sales + client income in minor units: transactions.incomeMinor, summed.'),
  incomeFees: numeric('Integer fees on that income in minor units: transactions.incomeFeeMinor, summed.'),
};

export function setAsideWidgets(defaults: AgWidgetsConfig<AgDefaultRegistry>): AgWidgetsConfig<SetAsideRegistry> {
  return createWidgets<SetAsideRegistry>({
    additionalTypes: [
      {
        id: 'tax-pot',
        label: 'Tax pot',
        icon: ICON('<path d="M8 4h8v2.5c2 1.2 3 3 3 5V18a2.5 2.5 0 0 1-2.5 2.5h-9A2.5 2.5 0 0 1 5 18v-6.5c0-2 1-3.8 3-5z"/><path d="M5.5 13h13"/>'),
        dataMapping: moneyMapping,
        form: (p) => {
          const form = p.createDefaults({
            dataMappingItems: [
              { key: 'profit', label: 'Profit (minor units)' },
              { key: 'fees', label: 'Fees (minor units)' },
              { key: 'income', label: 'Income (minor units)' },
              { key: 'incomeFees', label: 'Fees on income (minor units)' },
            ],
          });
          form.items[1]?.items.push(
            { type: 'number', id: 'format.style.upliftPercent', label: 'What-if price change (%)', defaultValue: 0 },
            { type: 'checkbox', id: 'format.style.showBreakdown', label: 'Show tax breakdown', defaultValue: true },
          );
          return form;
        },
        comp: TaxPotWidget,
        defaultSize: { width: 520, height: 300 },
        minSize: { width: 320, height: 200 },
        ai: {
          label: 'Tax pot gauge',
          description: 'A jar filled to the share of the PayPal balance to put aside for tax, with the set-aside, safe-to-spend and tax breakdown. Respects page filters.',
          usage: 'Use for "how much should I put aside", "safe to spend", or what-if price questions. Prefer the set_price_what_if tool to change its what-if line.',
          configuration: 'Map the four integer *Minor fields of transactions, each with aggregation sum.',
        },
      },
      {
        id: 'deadline-strip',
        label: 'Deadline strip',
        icon: ICON('<path d="M3 12h18"/><path d="M7 8v8M12 8v8M17 8v8"/><path d="M19 5l2 2-2 2"/>'),
        dataMapping: {
          quarter: { type: 'field', supportedRoles: ['category'], requires: { cardinality: 'many' }, required: true, aiDescription: 'transactions.taxQuarter, the tax quarter label.' },
          ...moneyMapping,
        },
        form: (p) => {
          const form = p.createDefaults({
            dataMappingItems: [
              { key: 'quarter', label: 'Quarter' },
              { key: 'profit', label: 'Profit (minor units)' },
              { key: 'fees', label: 'Fees (minor units)' },
              { key: 'income', label: 'Income (minor units)' },
              { key: 'incomeFees', label: 'Fees on income (minor units)' },
            ],
          });
          form.items[1]?.items.push({ type: 'number', id: 'format.style.upliftPercent', label: 'What-if price change (%)', defaultValue: 0 });
          return form;
        },
        comp: DeadlineStripWidget,
        defaultSize: { width: 900, height: 260 },
        minSize: { width: 520, height: 220 },
        ai: {
          label: 'Quarterly deadline strip',
          description: 'The tax year as four quarters showing profit and set-aside added per quarter, with payment and filing deadlines on a timeline and a today marker.',
          usage: 'Use for questions about deadlines, quarters, or being on track.',
          configuration: 'quarter = transactions.taxQuarter; the four integer *Minor fields with aggregation sum.',
        },
      },
      {
        id: 'category-mix',
        label: 'Income by category',
        icon: ICON('<rect x="3" y="9" width="18" height="6" rx="2"/><path d="M9 9v6M14 9v6"/>'),
        dataMapping: {
          category: { type: 'field', supportedRoles: ['category'], requires: { cardinality: 'many' }, required: true, aiDescription: 'The category to split by, usually transactions.category.' },
          value: { type: 'field', supportedRoles: ['numeric'], requires: { per: 'dataMapping.category', cardinality: 'one' }, required: true, sort: true, aiDescription: 'Money per category, usually sum of transactions.moneyIn.' },
          confidence: { type: 'field', supportedRoles: ['numeric'], requires: { per: 'dataMapping.category', cardinality: 'one' }, aiDescription: 'Optional: average of transactions.confidence.' },
        },
        form: (p) => {
          const form = p.createDefaults({
            supportsCrossHighlight: true,
            dataMappingItems: [
              { key: 'category', label: 'Category' },
              { key: 'value', label: 'Value' },
              { key: 'confidence', label: 'Confidence' },
            ],
          });
          form.items[1]?.items.push({ type: 'checkbox', id: 'format.style.showConfidence', label: 'Show AI confidence', defaultValue: true });
          return form;
        },
        comp: CategoryMixWidget,
        defaultSize: { width: 520, height: 320 },
        minSize: { width: 300, height: 220 },
        featureConfig: { crossFilter: { supportsHighlight: true } },
        ai: {
          label: 'Income by category',
          description: 'A proportional bar and list of money by category with the AI’s average confidence. Clicking a category cross-filters the page.',
          usage: 'Use for "where does my money come from" or mix-of-income questions.',
        },
      },
    ],
    menu: [{ label: 'SetAside', widgetIds: ['tax-pot', 'deadline-strip', 'category-mix'] }, ...(defaults.menu as AgWidgetsConfig<SetAsideRegistry>['menu'])],
  });
}

// The six things a PayPal transaction can be, for tax purposes. The classifier, the review grid,
// the rules and the tax engine all read from this one list.

export const CATEGORIES = [
  'sale',
  'client_payment',
  'refund',
  'fee',
  'personal_transfer',
  'reimbursement',
] as const;

export type Category = (typeof CATEGORIES)[number];

export type CategoryGroup = 'Business income' | 'Business cost' | 'Not business';

export const CATEGORY_META: Record<Category, { label: string; group: CategoryGroup; color: string; taxable: -1 | 0 | 1; hint: string }> = {
  sale: {
    label: 'Sale',
    group: 'Business income',
    color: 'var(--sa-cat-sale)',
    taxable: 1,
    hint: 'A customer paid for a product (checkout, shop order).',
  },
  client_payment: {
    label: 'Client payment',
    group: 'Business income',
    color: 'var(--sa-cat-client)',
    taxable: 1,
    hint: 'A client paid for freelance work or a retainer.',
  },
  refund: {
    label: 'Refund',
    group: 'Business cost',
    color: 'var(--sa-cat-refund)',
    taxable: 1,
    hint: 'Money returned to a customer; reduces business income.',
  },
  fee: {
    label: 'Fee',
    group: 'Business cost',
    color: 'var(--sa-cat-fee)',
    taxable: 1,
    hint: 'A PayPal or processing fee; an allowable business cost.',
  },
  personal_transfer: {
    label: 'Personal transfer',
    group: 'Not business',
    color: 'var(--sa-cat-personal)',
    taxable: 0,
    hint: 'Friends, family, flatmates, or moving your own money. Not income.',
  },
  reimbursement: {
    label: 'Reimbursement',
    group: 'Not business',
    color: 'var(--sa-cat-reimb)',
    taxable: 0,
    hint: 'Someone paying you back for a cost you covered. Not income.',
  },
};

export const isCategory = (value: unknown): value is Category =>
  typeof value === 'string' && (CATEGORIES as readonly string[]).includes(value);

export const categoryLabel = (c: Category) => CATEGORY_META[c].label;

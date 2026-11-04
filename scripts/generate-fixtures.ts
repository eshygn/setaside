// Regenerates fixtures/paypal/*.json from the deterministic scenario in lib/seed/generate.ts.
// The output is shaped like PayPal's Transaction Search and Invoicing list responses.
//   npx tsx scripts/generate-fixtures.ts
import fs from 'node:fs';
import path from 'node:path';
import { generateScenario, scenarioFor } from '../lib/seed/generate';

const dir = path.join(process.cwd(), 'fixtures', 'paypal');
fs.mkdirSync(dir, { recursive: true });
for (const currency of ['GBP', 'USD'] as const) {
  const cfg = scenarioFor(currency);
  const { transactions, invoices } = generateScenario(cfg);
  fs.writeFileSync(
    path.join(dir, `transactions-${currency}.json`),
    JSON.stringify({ transaction_details: transactions, account_number: 'SETASIDEDEMO1', start_date: `${cfg.start}T00:00:00+0000`, end_date: `${cfg.end}T23:59:59+0000`, page: 1, total_items: transactions.length, total_pages: 1 }, null, 1),
  );
  fs.writeFileSync(path.join(dir, `invoices-${currency}.json`), JSON.stringify({ items: invoices, total_items: invoices.length, total_pages: 1 }, null, 1));
  console.log(currency, transactions.length, 'transactions,', invoices.length, 'invoices');
}

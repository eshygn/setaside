// Follows one real PayPal sandbox payment through everything SetAside does with it:
//   1. Payments v2      look up the capture (works with the buyer-side or seller-side id)
//   2. Transaction Search find it in the ledger, page by 31-day windows, allowing for the ~3 h lag
//   3. AI               classify it with the Gemini tool-call classifier (or its fallbacks)
//   4. Invoicing v2     raise an invoice for it and record the PayPal payment against it
//   5. Tax              show what it adds to the set-aside on top of the demo year
// It prints each step and writes docs/sandbox-lifecycle.md as a record of the run.
//
//   npx tsx scripts/sandbox-lifecycle.ts <transaction id>
// Needs PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET (sandbox). GOOGLE_GENERATIVE_AI_API_KEY is optional.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

async function main() {
  const txId = process.argv[2];
  if (!txId) throw new Error('Usage: npx tsx scripts/sandbox-lifecycle.ts <transaction id>');
  // Work in a throwaway database so the run never touches the app's demo data.
  process.env.SETASIDE_DB = path.join(os.tmpdir(), `setaside-lifecycle-${Date.now()}.db`);

  const { liveAdapter } = await import('../lib/paypal');
  const { fetchRange } = await import('../lib/paypal/sync');
  const { classifyBatch } = await import('../lib/ai/classify');
  const { parseMinor, formatMoney } = await import('../lib/money');
  const { estimateTax } = await import('../lib/tax/engine');
  const { PRESETS } = await import('../lib/tax/presets');
  const service = await import('../lib/service');

  const lines: string[] = [];
  const log = (s = '') => {
    console.log(s);
    lines.push(s);
  };
  const step = (n: number, title: string) => log(`\n## ${n}. ${title}\n`);

  const live = liveAdapter();
  if (!live) throw new Error('Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET for the sandbox');
  log(`# Sandbox lifecycle: ${txId}`);
  log(`\nRun ${new Date().toISOString()} against https://api-m.sandbox.paypal.com with scripts/sandbox-lifecycle.ts.`);

  // 1. Payments v2 -------------------------------------------------------------------------
  step(1, 'Payments v2: look up the capture');
  let capture: Awaited<ReturnType<typeof live.getCapture>> | undefined;
  try {
    capture = await live.getCapture(txId);
    log(`- \`GET /v2/payments/captures/${txId}\` → capture **${capture.id}**, ${capture.amount.value} ${capture.amount.currency_code}, status **${capture.status}**${capture.status_details?.reason ? ` (${capture.status_details.reason})` : ''}`);
    log(`- Created ${capture.create_time}; payee ${capture.payee?.email_address ?? 'n/a'} (merchant ${capture.payee?.merchant_id ?? 'n/a'})`);
    if (capture.id !== txId) log(`- The id given is the buyer's side of the payment; the seller-side capture id is ${capture.id}. Transaction Search lists the seller-side id.`);
    if (capture.status_details?.reason === 'UNILATERAL') log(`- UNILATERAL: PayPal is holding the money until the payee confirms the account, so it stays PENDING.`);
  } catch (error) {
    log(`- Capture lookup failed: ${error instanceof Error ? error.message.slice(0, 200) : error}`);
  }

  // 2. Transaction Search -------------------------------------------------------------------
  step(2, 'Transaction Search: find it in the ledger');
  const ids = new Set([txId, capture?.id].filter(Boolean) as string[]);
  const created = capture?.create_time ? Date.parse(capture.create_time) : Date.now();
  const start = new Date(created - 2 * 86_400_000);
  const end = new Date(Date.now() - 60_000);
  const found = await fetchRange(live, start, end);
  const match = found.transactions.find((t) => ids.has(t.transaction_info.transaction_id));
  log(`- Searched ${start.toISOString().slice(0, 19)}Z → ${end.toISOString().slice(0, 19)}Z in ${found.calls} call(s) (31-day windows), ${found.transactions.length} transactions returned.`);
  log(`- PayPal says the ledger was last refreshed at **${found.lastRefreshed ?? 'unknown'}**.`);
  if (match) {
    const i = match.transaction_info;
    log(`- Found **${i.transaction_id}**: ${i.transaction_event_code}, ${i.transaction_amount?.value} ${i.transaction_amount?.currency_code}, status ${i.transaction_status}.`);
  } else {
    const refreshed = found.lastRefreshed ? Date.parse(found.lastRefreshed) : undefined;
    if (refreshed !== undefined && refreshed < created) {
      log(`- Not in Transaction Search yet: the payment is ${((created - refreshed) / 3_600_000).toFixed(1)} h newer than PayPal's last refresh, and Search can lag up to 3 h. SetAside covers this by recording captures from the Orders response immediately.`);
    } else {
      log(`- **Not in this account's ledger**, even though PayPal refreshed it ${refreshed !== undefined ? (((refreshed - created) / 3_600_000).toFixed(1) + ' h') : ''} after the payment. It was paid to a different sandbox account (the payee above), so this app's Transaction Search will never list it.`);
    }
  }

  // 3. Classify ----------------------------------------------------------------------------------
  step(3, 'AI: classify it');
  if (!match) log(`- Not in Search, so the classifier gets a row built from the capture response (amount, date, a checkout event code). Treat this step as a check of the classifier, not of real ledger data.`);
  const amountMinor = parseMinor(match?.transaction_info.transaction_amount?.value ?? capture?.amount.value ?? '0');
  const currency = match?.transaction_info.transaction_amount?.currency_code ?? capture?.amount.currency_code ?? 'GBP';
  const input = {
    id: match?.transaction_info.transaction_id ?? capture?.id ?? txId,
    date: (capture?.create_time ?? new Date().toISOString()).slice(0, 10),
    event_code: match?.transaction_info.transaction_event_code ?? 'T0006',
    amount_minor: amountMinor,
    fee_minor: parseMinor(match?.transaction_info.fee_amount?.value ?? capture?.seller_receivable_breakdown?.paypal_fee?.value),
    currency,
    payer_name: match?.payer_info?.payer_name?.alternate_full_name ?? 'Sandbox buyer',
    payer_email: match?.payer_info?.email_address ?? process.env.PAYPAL_SANDBOX_BUYER_EMAIL ?? null,
    subject: match?.transaction_info.transaction_subject ?? 'PayPal Checkout payment',
    note: match?.transaction_info.transaction_note ?? null,
    invoice_id: match?.transaction_info.invoice_id ?? capture?.invoice_id ?? null,
  };
  const result = await classifyBatch([input], [], currency);
  const c = result.items[0];
  log(`- Method: **${result.method}**${result.model ? ` (${result.model})` : ''}${result.fallbackReason ? `; fallback because: ${result.fallbackReason}` : ''}`);
  log(`- → **${c.category}**, confidence ${Math.round(c.confidence * 100)}%: “${c.reason}”`);

  // 4. Invoicing -----------------------------------------------------------------------------------
  step(4, 'Invoicing v2: raise an invoice and record the payment');
  const draft = {
    currency,
    recipientName: input.payer_name ?? 'Sandbox buyer',
    recipientEmail: input.payer_email ?? undefined,
    itemName: 'Freelance work (paid via PayPal)',
    amountMinor,
    invoiceDate: input.date,
    paidByTransactionId: input.id,
    paymentDate: input.date,
  };
  try {
    const inv = await live.createPaidInvoice(draft);
    for (const s of inv.steps) log(`- ${s.ok ? '✓' : '✗'} \`${s.call}\` ${s.detail ?? ''}`);
    log(`- Invoice ${inv.invoice.detail.invoice_number} is **${inv.invoice.status}**.`);
  } catch (error) {
    log(`- Live Invoicing refused: ${error instanceof Error ? error.message.slice(0, 220) : error}`);
    log(`- This sandbox app doesn't have the Invoicing feature enabled, so SetAside falls back to its mock adapter for this step (and says so in the UI). Enable Invoicing on the app at developer.paypal.com to make it live.`);
  }

  // 5. Tax effect ------------------------------------------------------------------------------------
  step(5, match ? 'Tax: what it adds to the set-aside' : 'Tax: what it would add to the set-aside, if it were Jo’s');
  process.env.AI_OFFLINE = '1'; // the demo year uses the recorded Gemini answers, not more quota
  await service.resetDemo();
  await service.classifyNext(1000);
  const snap = await service.snapshot();
  const preset = PRESETS[snap.preset.id];
  if (currency === preset.currency && c.category && ['sale', 'client_payment'].includes(c.category)) {
    const before = estimateTax(preset, snap.summary.breakdown.profit, snap.settings.otherIncome, snap.summary.breakdown.fees);
    const after = estimateTax(preset, snap.summary.breakdown.profit + amountMinor + input.fee_minor, snap.settings.otherIncome, snap.summary.breakdown.fees + input.fee_minor);
    log(`- Demo year so far (${preset.name}): profit ${formatMoney(before.profit, preset.currency)}, set-aside ${formatMoney(before.total, preset.currency)}.`);
    log(`- With this payment: set-aside ${formatMoney(after.total, preset.currency)}, so put **${formatMoney(after.total - before.total, preset.currency)}** of the ${formatMoney(amountMinor, preset.currency)} aside.`);
  } else {
    log(`- Classified as ${c.category}: nothing to put aside for tax.`);
  }
  log(`\n_Estimates only, not tax advice._`);

  const out = path.join(process.cwd(), 'docs', 'sandbox-lifecycle.md');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, lines.join('\n') + '\n');
  console.log(`\nWrote ${path.relative(process.cwd(), out)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

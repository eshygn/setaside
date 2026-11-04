# Decisions

The choices made while building SetAside, and why. When something was ambiguous, the rule was to pick whatever made the demo strongest and was still honest.

## Starting point

- **The boilerplate didn't match the brief's description.** The brief describes `lib/paypal.ts` using `@paypal/paypal-server-sdk` with Subscriptions, and files at `app/data-table.tsx` and `app/transactions/page.tsx`. The actual repo (cloned 4 Nov 2026) uses plain `fetch`, lives under `app/(endpoints)/` and `app/dashboard/`, and covers products, plans, invoices, transactions and balances. I copied its real patterns (token caching, retries, `page`/`total_pages` paging, the AG Studio shell, theme-from-tokens, saved reports, the LLM adapter shape) and used the official SDK where it has the endpoint: Transaction Search, Balances, Orders and Payments. **Invoicing isn't in the SDK**, so it stays REST, in the boilerplate's style.
- **Versions are the boilerplate's pins:** `ag-studio` 3.0.0, `ag-grid` 36.2.0, Next.js 16.3.6 and React 19.2. `ag-studio` 3.1.0 was published on the day work started; a same-day release isn't worth the risk before a deadline. I read the 3.0.0 archive docs and the installed `.d.ts` files rather than relying on memory.
- **Subscriptions aren't used.** A side-income tax tool has no use for them, and the brief's PayPal list for SetAside is Transaction Search, Balances and Invoicing.

## Scenario and presets

- **UK is the default preset.** The sandbox account's balances and activity are in GBP, so a UK persona lets live sandbox payments merge into the same currency as the story. The US preset has its own USD scenario (calendar year 2026) and is one click away.
- **The tax year in view is 2026/27, and the demo clock starts at 4 November 2026**, the real date the project was built. Seeded history and live sandbox payments then share one timeline. The seed runs to the end of the tax year, so jumping the clock forward reveals new activity.
- **About 400 transactions:** 431 GBP rows by the start date, generated deterministically ([`lib/seed/generate.ts`](lib/seed/generate.ts)) and committed as fixtures in the exact Transaction Search shape. A test checks that the fixtures match the generator.
- **The mess is designed in.** A friend who pays by goods-and-services out of habit (so the payment carries a fee), a flatmate's bill money, and a client who pays both for work and for expenses. These are the cases where a person has to decide, so they make good review-queue material.
- **Tax simplifications are written down, not hidden.** The UK preset leaves out Scottish rates, allowance tapering above £100k and the MTD filing rules. The US preset leaves out the QBI deduction (keeping the estimate on the safe side) and Additional Medicare, and sets state tax to a flat 0% that you can edit. Side profit is taxed on top of an editable salary. For UK users, payments on account are assumed to apply. All of it is on the Assumptions tab and in `presets.ts`.
- **Set-aside means the tax on profit for the year so far.** Safe to spend is the PayPal balance minus that. A full-year projection on the current pace sits beside it. Both are labelled as estimates.

## Money

- Integer minor units everywhere. Rates are basis points, and rounding is explicit (half away from zero).
- AG Studio needs plain numbers to chart, so the dashboard's visible money fields are major units, used for display only. The tax widgets never sum those: they read hidden integer fields (`profitMinor`, `feeCostMinor`, `incomeMinor`, `incomeFeeMinor`) and run the same engine as the server, so a widget and the header always agree.

## AI

- **Model.** `AI_MODEL` was empty, so SetAside tries the newest free-tier Flash models in order: `gemini-3.6-flash`, `gemini-3-flash-preview`, `gemini-3.5-flash-lite`, then `gemini-flash-lite-latest`. `gemini-3.8-flash` is listed by the API but answered 429 on this key's free tier, so it isn't in the default chain; set `AI_MODEL` to put any model first.
- **The free tier allows about 20 requests per model per day,** and some models returned 503 "high demand" during development. Hence: a local rate limit (8 per minute), a SQLite cache keyed on the exact batch and rules, the model chain, **recorded responses** from real Gemini runs (`fixtures/ai/classifications-GBP.json` and `-USD.json`: every scenario row in both presets, recorded with `gemini-3-flash-preview` and `gemini-3.5-flash-lite`), and a deterministic classifier as the last resort. The status chip always says which one answered. `AI_OFFLINE=1` forces recorded mode, which is useful for recording a video without spending quota.
- **Calibrated confidence was prompted for explicitly.** Without guidance, the first live run rated almost every row 100% sure, and the review queue would have been empty. The prompt now says when to be unsure. That isn't gaming the model: rows under 80% go to a person, so honest doubt is the product.
- **Rules.** A correction records the payer, plus the category's telling words if the note has one. "Expenses" from Hollis & Vane should not turn their project payments into reimbursements, so a rule with a word is more specific than a payer-only rule, and the most specific match wins. Rules apply to every row the person hasn't decided, including future ones, and go to the model as examples. The review state machine makes "automation never overwrites a person" a tested property.

## AG Studio agent

- **A custom agent on the Direct LLM Runner, with a Gemini adapter written for this project** (modelled on the OpenAI adapter the boilerplate copies from the docs). The browser adapter posts each round to `/api/agent`, which calls Gemini through the AI SDK with Studio's tool schemas declared but not executed. Studio runs the tools in the browser.
- **Studio's `execute_query` and `add_page_filter` schemas are about 40 KB together.** With them, a free-tier round took 26–70 seconds. Studio's `add_widget` also only places an *empty* widget, and configuring it needs a per-widget `configure_widget` binding and more rounds. So the agent uses Studio's page tools (`view_page`, `position_widget`, `remove_widget`) plus compact custom tools made with `api.defineAiTool`: `build_chart`, `edit_chart`, `query_totals`, `set_price_what_if`, `get_tax_position` and `add_setaside_widget`. A typical question now takes two rounds.
- **AI-editable widgets.** Studio 3.0.0 has no public shape builder for a custom widget's `formatShape`, which its built-in `configure_widget` needs. Our `set_price_what_if` tool edits the widgets' `format.style.upliftPercent` through `api.setState` instead, which is still a live, undoable Studio state change.
- **Hallucination guard.** An early run invented client names because `build_chart` returned only a grand total. Tool results now include the real per-group breakdown, and the instructions forbid quoting anything a tool didn't return.
- **Thought signatures.** Gemini 3 expects each function call's thought signature to come back on the next round. Studio's conversation items have nowhere to carry it, so the server stores signatures by call id, and falls back to Google's documented skip value.
- **Recorded agent turns.** Live turns are stored by question and round, and `fixtures/ai/agent-turns.json` holds the four prompt starters. Replayed tool calls run against the live dashboard, so widgets always show current figures; the replayed *text* is labelled as recorded.
- **Studio shows its chat panel only in edit mode.** "✦ Ask SetAside" therefore switches to edit mode with the chat open and the Compose and Data panels collapsed, so the canvas keeps its width.

## PayPal

- **The sandbox app is shared with other experiments** (its ledger holds test payouts, holds and currency conversions). Live rows are filtered to what a seller would recognise as their own trading: payments received (`T00xx` with a positive amount), refunds (`T1107`) and chargebacks (`T1201`).
- **Invoicing permission.** The sandbox app answers `403 NOT_AUTHORIZED` on `/v2/invoicing/invoices`, so the Invoicing feature isn't enabled on it. Live invoicing is fully implemented and is tried first; on refusal SetAside creates the invoice through the mock adapter and says so in the toast and the step log. Enable Invoicing on the app to make it live.
- **Transaction Search lag.** Captures from the PayPal buttons are recorded at once from the Orders response, shaped like a Transaction Search item with the same id, and the next sync replaces them with PayPal's own copy.
- **The provided payment `3KV701938H745371C`** is the buyer's side of the payment. `GET /v2/payments/captures/3KV701938H745371C` resolves to seller-side capture `1F91026345099340S`: £40.00, `PENDING` with reason `UNILATERAL`, payee `sb-3j7yv53688109@personal.example.com`. At run time Transaction Search's last refresh was 5.2 h older than the payment, so it wasn't listed yet. [`docs/sandbox-lifecycle.md`](docs/sandbox-lifecycle.md) is the full run.
- **Live adapter checks.** A Balances call decides "live or mock" and is cached for 10 minutes. Transaction Search rejects future end dates, so live searches end at the real "now", whatever the demo clock says.

## Network and environment

- Every host the app needs answered from the build environment: `api-m.sandbox.paypal.com`, `www.paypal.com` (JS SDK), `generativelanguage.googleapis.com`, `registry.npmjs.org` and Google Fonts. Nothing had to be switched to a mock because of the allowlist.
- `AG_GRID_LICENSE_KEY` was present but empty, so AG Grid and AG Studio run with the trial watermark. The key is applied to both whenever it is set.
- Bryntum and Z3 are mentioned in the general brief, but SetAside doesn't need them, so they aren't used.

## Storage and deployment

- **SQLite (`better-sqlite3`)** holds transactions, classifications, rules, invoices, the AI cache and the demo clock, and is seeded on first request. On Render's free plan the disk is ephemeral, which suits demo mode: a cold start is a fresh demo.
- **Dashboard layouts** are saved in the browser's localStorage, as the boilerplate does it. They're a per-viewer preference, and that keeps the hosted demo from mixing up judges' layouts.

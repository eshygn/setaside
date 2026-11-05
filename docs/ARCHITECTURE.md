# Architecture

SetAside is one Next.js (App Router) service. The browser renders the shell, the AG Grid review queue and the AG Studio dashboard. Every PayPal call, every Gemini call and all state live on the server, in SQLite.

```
Browser                                   Server (Next.js route handlers)              Outside
───────                                   ───────────────────────────────              ───────
Review grid (AG Grid) ──/api/correct──▶   lib/service.ts ──▶ lib/rules.ts
Hero, tabs ─────────────/api/snapshot─▶        │   ├──▶ lib/tax/engine.ts
Classify button ────────/api/classify─▶        │   ├──▶ lib/ai/classify.ts ──────────▶ Gemini (AI SDK)
Demo clock ─────────────/api/clock────▶        │   └──▶ lib/paypal/{live,mock}.ts ───▶ PayPal sandbox
PayPal JS SDK buttons ──/api/paypal/orders▶    │                                        (SDK + REST)
AG Studio + agent ──────/api/agent────▶   lib/ai/agent.ts ─────────────────────────▶ Gemini
  (tools run in the browser)                   └── SQLite (better-sqlite3): tx, classification,
                                                   rule, invoice, ai_cache, kv (clock, preset)
```

## The five files that matter most

### 1. `lib/service.ts`: the orchestration layer
Every server operation the UI can trigger lives here: seeding and resetting the demo, syncing PayPal, classifying, correcting, accepting, moving the demo clock, raising invoices, and recording checkout captures. It's the only module that writes to SQLite.

**Key decisions:**
- **Rules before AI.** `classifyNext` applies the person's rules first and sends only the remainder to Gemini, so corrections cost no quota and always win.
- **Corrections apply at once and forward.** `correct` writes the person's answer, derives a rule, re-applies the whole rule set to every row automation may still touch, and returns the ids it changed, so the grid can flash them.
- **Every status change goes through a state machine** (`lib/review.ts` for review, `lib/invoice-flow.ts` for invoices). "Automation never overwrites a person" is a tested property, not a convention.
- **Two sources, one shape.** Seeded history and live sandbox rows are both stored as PayPal Transaction Search items (the raw JSON is kept), tagged by `origin`. Live rows are filtered to payments received, refunds and chargebacks, because the shared sandbox ledger is noisy.

### 2. `lib/ai/classify.ts`: the classifier agent
It sends batches of 120 transactions to Gemini through the Vercel AI SDK. Gemini must answer by calling one tool, `record_classifications`, whose zod schema fixes the six categories, a 0–1 confidence and a reason. The output is validated by zod and nothing is parsed from free text.

**Key decisions:**
- **Calibration is in the prompt, explicitly.** Rows under 80% confidence go to a person, so honest doubt is the product. Without the guidance, Gemini rated nearly everything 100%.
- **The person's rules are sent as plain-English examples,** so the model follows them for rows the rules don't cover exactly.
- **Fallbacks, in order:** the SQLite cache (keyed on the exact prompt), then live Gemini through `lib/ai/model.ts` (rate limit, plus a model chain that moves on after a 429 or 503), then recorded real Gemini answers (`fixtures/ai`), then a deterministic heuristic. The method used is stored on every row and shown in the status chip.

### 3. `lib/tax/engine.ts` (with `lib/tax/presets.ts`): the money
These are pure functions: profit from classified rows, tax under a preset, the set-aside, safe-to-spend, a full-year projection, and the set-aside added by each quarter. `presets.ts` holds every rate, band, threshold, deadline and simplification for the UK 2026/27 and US 2026 presets, each written as a labelled assumption.

**Key decisions:**
- **Integer minor units and basis points throughout** (`lib/money.ts`), with rounding made explicit (half away from zero). Floats only appear in AG Studio's display fields.
- **Tax is marginal.** Side profit is taxed on top of an editable salary, by computing tax with and without it. That's what the person actually owes extra.
- **The same engine runs everywhere.** The server summary, the AG Studio widgets (fed with integer sums from Studio queries, so filters apply) and the agent's `get_tax_position` tool all call it, so every figure agrees, and the model never does tax arithmetic.

### 4. `lib/paypal/live.ts` (with `mock.ts` and `sync.ts`): PayPal behind one contract
`PayPalAdapter` covers Transaction Search, Balances, Invoicing (create, then record the payment), plus Orders and Payments for checkout. The live adapter uses `@paypal/paypal-server-sdk`'s `TransactionSearchController`, `OrdersController` and `PaymentsController`, and REST for Invoicing, which the SDK lacks. The mock adapter serves `fixtures/paypal` and behaves like the API where it matters: it rejects ranges over 31 days, pages results, and hides the last three hours. `sync.ts` splits any range into 31-day windows and pages each one.

**Key decisions:**
- **Both adapters return PayPal's documented snake_case JSON.** The live adapter parses the SDK's raw `body`, not its camelCased models, so mock fixtures and live responses are interchangeable and the tests exercise the real shape.
- **One Balances call decides live or mock,** cached for 10 minutes, and a status chip shows the result.
- **Checkout captures are recorded straight from the Orders response,** with the same id Transaction Search will later use, to cover its up-to-three-hour lag.

### 5. `app/studio/agent.ts` (with `gemini-adapter.ts` and `lib/ai/agent.ts`): the AG Studio agent
This is a custom agent registered with `createAiHarness` and run by Studio's `directLlmRunner`. `gemini-adapter.ts` implements Studio's `AgLlmAdapter` interface. It posts each round (instructions, conversation, tool schemas) to `/api/agent`, which calls Gemini with the tools declared but not executed, and turns the reply into Studio's AG-UI events. Studio then runs the tool calls in the browser against live dashboard state.

**Key decisions:**
- **Compact custom tools instead of Studio's largest built-ins.** `execute_query` and `add_page_filter` add about 40 KB of schema to every round, and `add_widget` only places an empty widget. `build_chart`, `edit_chart`, `query_totals`, `set_price_what_if`, `get_tax_position` and `add_setaside_widget` (built with `api.defineAiTool`) make a typical question two rounds.
- **The tools return the real numbers,** including per-group breakdowns, and the instructions forbid quoting anything else. An early version invented client names.
- **Gemini 3 thought signatures** are kept server-side by call id, because Studio's conversation items can't carry them.
- **Live turns are recorded** by question and round. When Gemini is unavailable they replay: the tool calls run live and the text is labelled as recorded.

## What surrounds them

- `app/studio/widgets/*`: three custom widgets (`createWidgets`), each querying Studio's own data engine, so page filters and cross-filters apply.
- `app/ui/review-grid.tsx`: the AG Grid Enterprise review queue (rich-select editing, confidence bars, flashing on rule updates).
- `lib/seed/generate.ts`: the deterministic fictional scenario. A test checks the committed fixtures match it.
- `scripts/sandbox-lifecycle.ts`: follows one real sandbox payment through every PayPal touchpoint, and writes `docs/sandbox-lifecycle.md`.

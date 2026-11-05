# Devpost submission draft

**Project name:** SetAside
**Tagline:** Know what to put aside before the tax bill does. PayPal side income, sorted by AI, with tax estimates you can question.

## Inspiration

Everyone we know with a side income has the same January. The shop sales, client invoices, friends paying for pizza and the flatmate's share of the electric bill all landed in one PayPal account, and nobody kept track of which was which. Then a tax bill arrives that nobody planned for. Most of these people would happily put money aside, if anything could tell them how much. Accounting software assumes you already think like an accountant; banking apps don't know what's business. We wanted something that starts from the PayPal account they already have.

## What it does

SetAside connects to PayPal (Transaction Search, Balances and Invoicing) and reads the tax year, 31 days at a time. For the demo, a deterministic year of fictional activity is served in Transaction Search's exact response format, with live sandbox activity merged on top. An AI agent classifies every transaction as a sale, client payment, refund, fee, personal transfer or reimbursement, with a confidence score and a one-line reason. Anything it's unsure about goes into a short review queue in an editable AG Grid. When you fix a row, SetAside turns the fix into a rule and re-sorts every similar row in front of you; new transactions follow your rules too.

From the classified data it estimates the tax to put aside, what's **safe to spend** and when the **next deadline** is. It has presets for UK and US self-employment, kept in one config file of labelled assumptions and marked clearly as not tax advice. Everything lives in an AG Studio dashboard with three custom widgets: a tax pot gauge, a quarterly deadline strip, and an income-by-category view that cross-filters the page. Saved layouts and a custom theme come with it. You can also ask questions in plain English ("show refunds against sales by month", "what if I'd charged 10% more?"), and a custom Gemini agent in AG Studio's Agent Framework builds or edits the widgets live. When a client paid without an invoice, SetAside raises a PayPal invoice and records the payment against it (live when the sandbox app has the Invoicing permission; otherwise a labelled mock). When a client pays with the PayPal button, the capture is recorded straight away (Transaction Search lags by up to three hours) and classified.

## How we built it

- **Next.js 16 (App Router) + TypeScript**, one Node service, with SQLite through `better-sqlite3`, seeded on boot.
- **PayPal:** `@paypal/paypal-server-sdk` for Transaction Search, Balances, Orders and Payments. Invoicing v2 over REST (the SDK has no Invoicing controller). The **PayPal JS SDK** buttons for client payments. Every service sits behind a live adapter and a mock adapter, the mock backed by fixtures in the documented response shapes, and a status chip shows which one is in use.
- **AI:** Vercel AI SDK with `@ai-sdk/google` on the Gemini free tier. The classifier must answer through one zod-typed tool call, so no free text is parsed. The dashboard agent runs on AG Studio's Direct LLM Runner through a Gemini `AgLlmAdapter` we wrote, with Studio's page tools plus our own tools (`build_chart`, `set_price_what_if`, `get_tax_position` and others) defined with `api.defineAiTool`.
- **AG Grid / AG Studio:** an Enterprise grid for review; an AG Studio dashboard with three `createWidgets` custom widgets (forms, AI metadata, cross-filtering), a theme built from our design tokens, and saved layouts.
- **Money:** integer minor units for all stored values and tax maths (the dashboard charts major units for display only). Rates are basis points and rounding is explicit; a Vitest suite covers the money maths, tax engine, state machines and AI tool schemas.
- Started from PayPal's AG Studio hackathon boilerplate, whose REST patterns, Studio shell and adapter structure we built on.

## Challenges we ran into

- **The sandbox isn't a real business year.** You can't back-date sandbox payments, so the year is seeded fixtures in PayPal's own format, and live mode merges only the real recent activity. Our sandbox app also lacked the Invoicing permission (403), so invoices fall back to a clearly labelled mock. We'd rather show that honestly than fake it.

- **The Gemini free tier is about 20 requests per model per day**, and some models hit "high demand". We built a model chain, a rate limit, a cache and replay of recorded Gemini answers, so the demo never breaks and always says honestly which one answered.
- **Studio's built-in query tools carry big schemas,** which made each free-tier round slow. Compact custom tools cut a question down to two quick rounds.
- **The first live classifier run was 100% sure about everything,** which would have left the review queue empty. Prompting for calibrated doubt was the fix, and it's the core of the product: the person reviews only what's actually ambiguous.
- **One early agent answer invented client names.** The tool results now carry the real breakdown, and the agent is told to quote only what the tools return.
- **Transaction Search only covers 31 days per query and lags by up to three hours.** We page through windows, and record checkout captures immediately, reconciling them later.

## Accomplishments that we're proud of

- Fixing one row and watching 18 similar rows update on their own.
- Asking "what if I'd charged 10% more?" and watching the custom tax widgets redraw live inside AG Studio.
- A full keyless mock mode that tells the same story, so judges can run it with one command.
- Tax maths done entirely in integer pennies and cents (charts get major units only for display), with assumptions anyone can read.

## What we learned

- The value of an AI classifier is in the confidence, not the label. Calibrated doubt plus a fast correction loop beats a model that's "always right".
- AG Studio's agent framework is a real extension point: custom widgets, custom tools and a custom model adapter all slot into the same chat panel.
- PayPal's data is rich enough to answer "is this business?" if you read the event codes, fees, invoice ids and notes together.

## What's next for SetAside

- A real "pot": move the set-aside into a separate PayPal balance or savings account on payday.
- More presets (Scotland, Canada, Australia, the EU) and Making Tax Digital quarterly updates for UK users.
- Expenses beyond PayPal fees, from receipts or bank feeds.
- Multi-currency accounts, with conversion at PayPal's rates.

## Built with

`paypal-transaction-search` · `paypal-balances` · `paypal-invoicing` · `paypal-orders` · `paypal-js-sdk` · `@paypal/paypal-server-sdk` · `gemini` · `vercel-ai-sdk` · `@ai-sdk/google` · `zod` · `ag-grid` · `ag-studio` · `next.js` · `react` · `typescript` · `tailwindcss` · `sqlite` · `better-sqlite3` · `vitest` · `render`

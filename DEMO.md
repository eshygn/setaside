# SetAside: demo video script

**Target length 2:45** (hard limit 2:50). Record at **1440×900** in Chrome, browser zoom 100%, macOS/Windows UI hidden. About 390 spoken words at a calm pace (~140 wpm).

## Before recording

1. Start the app (`npm run dev`, or the hosted URL warmed up). For a take that can't be derailed by a spent Gemini quota, run with `AI_OFFLINE=1`: classifications and agent answers replay recorded Gemini responses, and the chip says "Recorded Gemini". With live keys, the chips read "Sandbox live" and "Gemini …". Either is honest; just don't say "live" over a recorded take.
2. Press **Reset demo** and close any toasts.
3. Keyboard shortcuts: **1–4** switch tabs (Review, Dashboard, Invoices, Assumptions).
4. On-screen callouts (lower-third text, added in the edit) are marked **[CALLOUT]**.

## Script and shot list

| Time | On screen | Voice-over (word for word) |
|---|---|---|
| **0:00–0:20** | Title card: SetAside logo on ink green, "Know what to put aside before the tax bill does." Cut to the app, freshly reset: 430 PayPal transactions, nothing classified, "Put aside £—". | "Millions of people get paid through PayPal on the side: selling prints, freelancing, creating. Their business income lands in the same account as pizza money and flat bills, so nobody knows how much is really theirs, and the tax deadline comes as a shock. This is SetAside." |
| **0:20–0:38** | Cursor on the PayPal chip, then click **Classify 430 transactions with AI**. The progress bar fills and the hero numbers appear. **[CALLOUT] PayPal Transaction Search: a year, in 31-day windows** **[CALLOUT] Gemini tool call: category + confidence + reason** | "SetAside pulls Jo's PayPal year through Transaction Search, thirty-one days at a time, merged with her Balances. Then an AI agent sorts every transaction: sale, client payment, refund, fee, personal transfer or reimbursement. Each one gets a confidence score and a one-line reason." |
| **0:38–1:05** | Review tab, **Needs review (22)**. Hover a "Why" cell. Search "Kofi sale", click the category, choose **Personal transfer**. 18 rows flash marigold and the toast reads "Rule learned · 18 similar rows updated". Then fix Ruth's *gas/electric* to **Reimbursement** (6 rows). | "It isn't sure about twenty-two of them, and it says so. Kofi is a friend who pays Jo back with goods-and-services out of habit, so his payments look like sales. I fix one. SetAside turns that into a rule, and eighteen similar rows update on their own. Ruth's bill money is a reimbursement, not income. Six more follow." |
| **1:05–1:25** | Press **2**: the AG Studio dashboard. Pan over the **tax pot** jar, the **deadline strip** and **where the money came from**. Click *Client payment* in the category widget and the page cross-filters; click again to clear. | "Everything lands in an AG Studio dashboard built from three custom widgets: a tax pot showing the tax office's share of her PayPal balance, the quarters and deadlines, and where the money came from, which filters the page." |
| **1:25–1:52** | Click **✦ Ask SetAside**, then **"Refunds vs sales by month"**. The chart builds at the top of the canvas. Type **"What if I'd charged 10% more?"**. The jar gets a dashed what-if line and the deadline strip redraws. **[CALLOUT] Custom agent in the AG Studio Agent Framework** | "And she can just ask. 'Show refunds against sales by month', and our custom agent, running inside AG Studio's agent framework, builds the widget live. 'What if I'd charged ten percent more?' It edits the tax widgets in place: about twelve hundred pounds more tax, but thirteen hundred more kept." |
| **1:52–2:15** | Press **3**: Invoices. Click **Raise PayPal invoice** on Moor Lane Bakery; the step log shows `POST /v2/invoicing/invoices → …/payments`. Then in "A client pays you", click the **PayPal** button and pay as the sandbox buyer. **[CALLOUT] PayPal Invoicing v2** **[CALLOUT] PayPal JS SDK + Orders v2** | "Some clients paid without an invoice, so SetAside raises one through PayPal Invoicing and records the payment against it. And when a client pays with the PayPal button, the money shows up straight away, already classified, without waiting for Transaction Search to catch up." |
| **2:15–2:35** | Demo clock: click **⇥ deadline**. The toast reads "248 new PayPal transactions…", they classify (rules first), and the hero updates: put aside about £11,300, 31 Jan, 14 days. | "Jump to two weeks before the January deadline. New PayPal activity arrives and sorts itself, following Jo's rules. She knows exactly what to put aside, and what's safe to spend." |
| **2:35–2:47** | Slow push-in on the hero card: **Put aside**, **Safe to spend**, **31 Jan · 14 days**. End card: "SetAside · PayPal + Gemini + AG Studio · not tax advice". | "No spreadsheet, no shock. SetAside turns a messy PayPal account into a number you can trust before the deadline." |

## Shot checklist

- [ ] Status chips visible at least once (PayPal, AI, demo clock)
- [ ] One "Why" reason readable on screen
- [ ] The rule toast and the flashing rows both in frame
- [ ] The agent's tool step (`build_chart`, `set_price_what_if`) visible in the chat panel
- [ ] The Invoicing step log readable for about a second
- [ ] The PayPal button and the capture confirmation
- [ ] End on the hero figures and the deadline

## If something goes wrong mid-take

- Gemini slow or rate-limited: stop, restart with `AI_OFFLINE=1`, press **Reset demo** and go again. The recorded answers follow the same story.
- PayPal button won't load (no client id): the yellow **Pay with PayPal (mock)** button runs the same flow; say "the mock checkout" rather than "sandbox".

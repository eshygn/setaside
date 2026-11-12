# Upload guide: Devpost + YouTube

Everything to copy and paste, in the order the forms ask for it. Do **YouTube first**, because Devpost needs the video link.

Files you'll need (sent with this guide):
- `setaside-demo-voiced.mp4`: the video (2:15)
- `youtube-thumbnail.png`: 1280×720, for YouTube
- `devpost-thumbnail.png`: 1200×800 (3:2), for Devpost
- `gallery-1-classified.png` … `gallery-5-invoices.png`: screenshots for the Devpost gallery

---

## Part 1: YouTube

1. Go to **youtube.com**, click your profile picture, then **YouTube Studio**.
2. Click **Create** (top right), then **Upload videos**, and choose `setaside-demo-voiced.mp4`.
3. Fill in the fields below while it uploads.

**Title** (copy exactly):
```
SetAside: AI sorts your PayPal side income and tells you what to put aside for tax
```

**Description:**
```
SetAside is for people who get paid through PayPal on the side: sellers, freelancers and creators. Their business income lands in the same account as pizza money and rent splits, so they never know what's theirs to spend, until the tax bill arrives.

SetAside reads PayPal activity (in PayPal Transaction Search's format, 31 days at a time), and a Gemini AI agent sorts every transaction into sale, client payment, refund, fee, personal transfer or reimbursement, with a confidence score and a reason. You fix the few it's unsure about, and each fix becomes a rule that updates similar transactions instantly. It then estimates the tax to put aside, what's safe to spend, and the next deadline, under UK or US self-employment rules.

Everything lives in an AG Studio dashboard with three custom widgets (tax pot, quarterly deadline strip, income by category), and a custom Gemini agent inside AG Studio's Agent Framework that builds and edits widgets when you ask questions like "show refunds against sales by month" or "what if I'd charged 10% more?".

Built for the PayPal AI Hackathon.

Chapters
0:00 The problem
0:15 AI sorts a year of PayPal activity
0:39 Corrections become rules
0:59 AG Studio dashboard and custom widgets
1:15 Asking the AI agent
1:34 PayPal Invoicing and PayPal checkout buttons
1:51 Jumping to the tax deadline
2:05 Wrap-up

Honest notes
• All people, businesses and transactions are fictional demo data.
• In this recording, AI answers are replayed from real Gemini runs (the app shows "Recorded Gemini").
• The invoicing step runs on a mock because the sandbox app lacks the Invoicing permission; the app says so.
• Estimates only, not tax advice.

Try it: https://setaside-px7v.onrender.com/ (free hosting: the first load can take about a minute)
Code: https://github.com/eshygn/setaside

Built with PayPal (Transaction Search, Balances, Invoicing, Orders, JS SDK), Google Gemini, Vercel AI SDK, AG Grid, AG Studio, Next.js and TypeScript.
```

**Thumbnail:** click **Upload thumbnail** and choose `youtube-thumbnail.png`. (YouTube may ask you to verify your phone number first. If you're short of time, skip it; YouTube picks a frame automatically.)

**Playlists:** leave empty.

**Audience:** choose **"No, it's not made for kids"**.

**Show more** → **Tags** (copy exactly):
```
PayPal, PayPal AI Hackathon, Devpost, Gemini, AI agent, AG Grid, AG Studio, side hustle, freelancer tax, self employed tax, tax set aside, Next.js, fintech
```

4. Click **Next** three times. (Video elements and Checks need nothing.)
5. On **Visibility**, choose **Unlisted** (anyone with the link can watch, and it's not public on your channel). **Public** also works if you prefer.
6. Click **Save**, then copy the video link (it looks like `https://youtu.be/...`).

---

## Part 2: Devpost

1. Go to **paypalaihackathon.devpost.com** and log in.
2. Click **Enter a submission** (or **Edit submission** if you've already started), then fill in each step.

### Step "Project overview"

**Project name:**
```
SetAside
```

**Elevator pitch** (Devpost allows 200 characters; this is 171):
```
SetAside reads your PayPal activity, uses Gemini to sort business from personal, and tells side earners how much tax to put aside, what's safe to spend, and when it's due.
```

**Thumbnail:** upload `devpost-thumbnail.png`.

### Step "Project details"

**About the project** (paste all of it; Devpost understands the headings):
```
## Inspiration
Everyone with a side income has the same January. Shop sales, client payments, friends paying for pizza and a flatmate's share of the electric bill all land in one PayPal account, and nobody keeps track of which is which. Then a tax bill arrives that nobody planned for. Most of these people would happily put money aside, if anything told them how much. Accounting software assumes you already think like an accountant; banking apps don't know what's business. I wanted something that starts from the PayPal account people already have.

## What it does
SetAside reads PayPal activity in PayPal Transaction Search's format, 31 days at a time. A Gemini AI agent classifies every transaction as a sale, client payment, refund, fee, personal transfer or reimbursement, with a confidence score and a one-line reason. Anything it's unsure about goes into a short review queue in an editable AG Grid. When you fix a row, SetAside turns the fix into a rule and re-sorts every similar row in front of you (one fix updated 18 rows in the demo), and new transactions follow your rules too.

From the classified data it estimates the tax to put aside, what's safe to spend and when the next deadline is, with presets for UK and US self-employment kept in one config file of labelled assumptions, and clearly marked as not tax advice.

It all lives in an AG Studio dashboard with three custom widgets: a tax pot gauge, a quarterly deadline strip, and an income-by-category view that cross-filters the page, plus a custom theme and saved layouts. You can ask questions in plain English ("show refunds against sales by month", "what if I'd charged 10% more?") and a custom Gemini agent in AG Studio's Agent Framework builds or edits the widgets live. For work paid without an invoice, SetAside raises a PayPal invoice and records the payment, and clients can pay through real PayPal buttons.

## How I built it
- Next.js 16 and TypeScript, one Node service, SQLite for storage.
- PayPal: the official server SDK for Transaction Search, Balances and Orders; the Invoicing v2 REST API; and the PayPal JS SDK buttons. Every PayPal call has a live version and a mock version that returns the same documented response shapes, and the screen shows which one is in use.
- AI: Gemini through the Vercel AI SDK. The classifier must answer through one typed tool call, so no free text is parsed. The dashboard agent runs in AG Studio's Agent Framework through a Gemini adapter I wrote, with custom tools such as build_chart, set_price_what_if and get_tax_position.
- AG Grid and AG Studio: an Enterprise grid for the review queue, and three custom AG Studio widgets with forms, AI descriptions and cross-filtering.
- Money is stored and calculated in whole pennies and cents, never floating-point, with 47 automated tests covering the money maths, tax engine and AI tool schemas.
- It started from PayPal's AG Studio hackathon boilerplate.

## Challenges I ran into
- A sandbox can't hold a real business year, so the year is fictional data in PayPal's own format, and live sandbox activity is merged on top. My sandbox app also lacks the Invoicing permission, so invoices fall back to a mock that is clearly labelled. I'd rather show that honestly than fake it.
- The Gemini free tier is small and models are sometimes overloaded. SetAside tries several models in order, caches answers, and replays recorded Gemini answers when none are available, always saying on screen which one answered.
- The first classifier run was 100% sure about everything, which would have left nothing to review. Prompting for honest doubt fixed it, and that turned out to be the core of the product.
- One early agent answer invented client names. Now the tools return the real figures and the agent may only quote those.
- Transaction Search covers at most 31 days per request and can lag by up to three hours, so SetAside pages through windows and records checkout payments straight away.

## Accomplishments that I'm proud of
- Fixing one transaction and watching 18 similar ones update on their own.
- Asking "what if I'd charged 10% more?" and watching the custom tax widgets redraw live inside AG Studio.
- A full offline demo mode, so judges can run the whole story with one command and no keys.
- Tax maths you can trust: whole pennies, every assumption written down.

## What I learned
- The value of an AI classifier is in its confidence, not its label. Honest doubt plus a fast correction loop beats a model that's "always right".
- AG Studio's agent framework is a real extension point: custom widgets, custom tools and a custom model adapter all fit the same chat panel.
- PayPal's data can answer "is this business?" if you read event codes, fees, invoice ids and notes together.

## What's next for SetAside
- A real pot: move the set-aside into a separate balance on payday.
- More tax presets (Scotland, Canada, Australia, the EU) and quarterly digital tax updates for UK users.
- Expenses beyond PayPal fees, from receipts or bank feeds.
- Multi-currency accounts.
```

**Built with** (type each one and press Enter, or paste the line if the box accepts commas):
```
paypal, paypal-transaction-search, paypal-invoicing, paypal-orders, paypal-js-sdk, gemini, vercel-ai-sdk, ag-grid, ag-studio, next.js, react, typescript, tailwindcss, sqlite, render
```

**"Try it out" links** (add each as a separate link):
```
https://setaside-px7v.onrender.com/
```
```
https://github.com/eshygn/setaside
```

**Video demo link:** paste your YouTube link.

**Image gallery:** upload these in order. If there's a caption box, use the caption shown:
1. `gallery-1-classified.png`: "430 PayPal transactions sorted by AI, each with a confidence and a reason"
2. `gallery-2-rule-learned.png`: "One correction became a rule: 18 similar rows updated"
3. `gallery-3-agent-chart.png`: "The custom agent builds a chart inside AG Studio"
4. `gallery-4-what-if.png`: "What if I'd charged 10% more? The tax widgets redraw live"
5. `gallery-5-invoices.png`: "Invoices for work paid without one, plus PayPal checkout"

### Step "Additional info" (the exact questions vary; here are answers to the usual ones)

**Which PayPal products or APIs did you use?**
```
PayPal Transaction Search and Balances (Reporting API, through the official @paypal/paypal-server-sdk), Orders v2 and the PayPal JS SDK buttons for client payments, Payments v2 for capture lookups, and Invoicing v2 (create an invoice and record a payment). All against the sandbox. My sandbox app currently lacks the Transaction Search and Invoicing permissions, so those parts fall back to a mock that returns PayPal's documented response shapes; the app shows on screen which mode each part is in.
```

**How does your project use AI?**
```
Two ways, both with Google Gemini. (1) A classifier agent sorts every PayPal transaction into six categories through a typed tool call, with a calibrated confidence and a one-line reason. Uncertain ones go to the person, and each correction becomes a rule applied to similar transactions. (2) A custom agent inside AG Studio's Agent Framework answers questions by building and editing dashboard widgets, using custom tools that return exact figures from the tax engine, so the AI never does the tax maths itself.
```

**Testing instructions for judges:**
```
No login or keys needed. Open https://setaside-px7v.onrender.com/ (free hosting: the first load can take about a minute). Click "Classify 430 transactions with AI". In Review, search "Kofi sale" and change that row to Personal transfer: 18 similar rows update. Open Dashboard, click "Ask SetAside" and try "Refunds vs sales by month" or "What if I'd charged 10% more?". Use "⇥ deadline" in the demo clock to jump ahead. "Reset demo" (top right) starts over. Note: the hosted demo is shared, so another judge's Reset also resets yours. To run it locally: npm install && npm run dev (Node 22.12+).
```

**Prize categories** (if asked to choose): **Best Use of AG Grid** and **Most Impactful**.

**Is the code public / open source?** Yes: MIT licence, https://github.com/eshygn/setaside

**Did you use third-party code or data?**
```
Started from PayPal's official AG Studio hackathon boilerplate (credited in the README). All people, businesses and transactions in the demo are fictional.
```

### Step "Submit"

1. Tick the boxes agreeing to the rules and terms.
2. Click **Submit for judging** (or **Save** if you're not finished). You can keep editing until the deadline.
3. Open your project page once it's submitted, and check that the video plays and the links work.

# Sandbox lifecycle: 3KV701938H745371C

Run 2026-11-05T05:21:09.979Z against https://api-m.sandbox.paypal.com with scripts/sandbox-lifecycle.ts.

## 1. Payments v2: look up the capture

- `GET /v2/payments/captures/3KV701938H745371C` → capture **1F91026345099340S**, 40.00 GBP, status **PENDING** (UNILATERAL)
- Created 2026-11-04T17:40:27Z; payee sb-3j7yv53688109@personal.example.com (merchant Q2WPLANASGYGN)
- The id given is the buyer's side of the payment; the seller-side capture id is 1F91026345099340S. Transaction Search lists the seller-side id.
- UNILATERAL: PayPal is holding the money until the payee confirms the account, so it stays PENDING.

## 2. Transaction Search: find it in the ledger

- Searched 2026-11-02T17:40:27Z → 2026-11-05T05:20:11Z in 1 call(s) (31-day windows), 197 transactions returned.
- PayPal says the ledger was last refreshed at **2026-11-05T00:29:59Z**.
- **Not in this account's ledger**, even though PayPal refreshed it 6.8 h after the payment. It was paid to a different sandbox account (the payee above), so this app's Transaction Search will never list it.

## 3. AI: classify it

- Not in Search, so the classifier gets a row built from the capture response (amount, date, a checkout event code). Treat this step as a check of the classifier, not of real ledger data.
- Method: **ai** (gemini-3.5-flash-lite)
- → **sale**, confidence 95%: “This is a PayPal Checkout payment (T0006) from a buyer for a product or service.”

## 4. Invoicing v2: raise an invoice and record the payment

- Live Invoicing refused: PayPal 403 on POST /v2/invoicing/invoices: {"name":"NOT_AUTHORIZED","debug_id":"f6502559bb076","message":"Authorization failed due to insufficient permissions.","details":[{"issue":"NOT_AUTHORIZED","description":"Authori
- This sandbox app doesn't have the Invoicing feature enabled, so SetAside falls back to its mock adapter for this step (and says so in the UI). Enable Invoicing on the app at developer.paypal.com to make it live.

## 5. Tax: what it would add to the set-aside, if it were Jo’s

- Demo year so far (UK self-employment (2026/27)): profit £24,813.40, set-aside £6,167.07.
- With this payment: set-aside £6,185.47, so put **£18.40** of the £40.00 aside.

_Estimates only, not tax advice._

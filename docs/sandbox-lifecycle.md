# Sandbox lifecycle: 3KV701938H745371C

Run 2026-11-04T18:55:57.790Z against https://api-m.sandbox.paypal.com with scripts/sandbox-lifecycle.ts.

## 1. Payments v2: look up the capture

- `GET /v2/payments/captures/3KV701938H745371C` → capture **1F91026345099340S**, 40.00 GBP, status **PENDING** (UNILATERAL)
- Created 2026-11-04T17:40:27Z; payee sb-3j7yv53688109@personal.example.com (merchant Q2WPLANASGYGN)
- The id given is the buyer's side of the payment; the seller-side capture id is 1F91026345099340S. Transaction Search lists the seller-side id.
- UNILATERAL: PayPal is holding the money until the payee confirms the account, so it stays PENDING.

## 2. Transaction Search: find it in the ledger

- Searched 2026-11-02T17:40:27Z → 2026-11-04T18:54:59Z in 1 call(s) (31-day windows), 44 transactions returned.
- PayPal says the ledger was last refreshed at **2026-11-04T12:29:59Z**.
- Not in Transaction Search yet. The payment is 5.2 h newer than PayPal's last refresh (Transaction Search can lag up to 3 h), or it was paid to another account (see the payee above). SetAside handles this by recording captures from the Orders/Payments response immediately and reconciling when Search catches up.

## 3. AI: classify it

- Method: **ai** (gemini-3.5-flash-lite)
- → **sale**, confidence 95%: “This is a PayPal Checkout payment (code T0006) from a customer for a product.”

## 4. Invoicing v2: raise an invoice and record the payment

- Live Invoicing refused: PayPal 403 on POST /v2/invoicing/invoices: {"name":"NOT_AUTHORIZED","debug_id":"ca555d69fdc79","message":"Authorization failed due to insufficient permissions.","details":[{"issue":"NOT_AUTHORIZED","description":"Authori
- This sandbox app doesn't have the Invoicing feature enabled, so SetAside falls back to its mock adapter for this step (and says so in the UI). Enable Invoicing on the app at developer.paypal.com to make it live.

## 5. Tax: what it adds to the set-aside

- Demo year so far (UK self-employment (2026/27)): profit £24,813.40, set-aside £6,167.07.
- With this payment: set-aside £6,185.47, so put **£18.40** of the £40.00 aside.

_Estimates only, not tax advice._

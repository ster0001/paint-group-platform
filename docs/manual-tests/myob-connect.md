# MYOB Business — connect walkthrough (Tom)

Phase 1 is the connection + account mapping. Pushing invoices/payments/bills
into MYOB is the next phase, once the mapping below is saved.

## 1. Register the developer app (10 minutes, one-off)

1. Go to **developer.myob.com** → sign in with the SAME MYOB account that
   owns the Paint Group MYOB Business file → **My apps** → **Create app**.
2. Fill in:
   - App name: `Paint Group Platform`
   - Redirect URL: `https://<your-live-domain>/api/myob/callback`
     (exactly this path on the live site — copy the domain from the browser)
3. It gives you a **Client ID (API key)** and **Client secret**.

## 2. Put the two keys into Vercel

Vercel → the project → Settings → Environment Variables (Production):
- `MYOB_CLIENT_ID` = the Client ID / API key
- `MYOB_CLIENT_SECRET` = the Client secret

Redeploy (or wait for the next deploy).

## 3. Connect

Settings → **Accounting — MYOB** → **Connect to MYOB** → sign in on MYOB's
own page and allow access. You land back on Settings showing
**Connected — <your business name>**. If your login can see more than one
business, a picker appears first.

## 4. Map the accounts (bookkeeper's codes)

Six dropdowns, each read live from your MYOB chart of accounts:
sales income · bank account · contractor payments · materials & supplier
bills · expense reimbursements · card surcharge / merchant fees.
Ask the bookkeeper which account each should be, pick, **Save mapping**.

## Notes

- Paint Group never sees your MYOB password — the connection is MYOB's own
  sign-in handing over a revocable permission (revoke any time in MYOB's
  settings, or Disconnect here).
- Nothing is pushed to MYOB yet — that's the next build phase and it will
  only start once the mapping is saved.

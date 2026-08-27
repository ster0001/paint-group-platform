# Portal 3a-6 — the embedded builder + multi-property

NO migration. What changed:

- **"Get a new estimate" in the portal** (Home) opens THE public wizard —
  the same route, the same component, provably (a contract test fails any
  commit that mounts a second wizard). For a signed-in customer it's
  prefilled from their property and **the email page simply doesn't
  exist** — their magic-link session is the identity, and the server
  trusts the session's email over anything typed.
- **Signed-in customers keep their builder even when the public wizard is
  gated off** (B4: a customer we already serve isn't who the launch gate
  protects).
- **AI/estimate gates by account type** (§3): trade accounts bypass the
  visitor limit entirely (decided); `flags.unlimited` on one account is
  the office unblock (⚑1) without making them trade. Residential keeps
  the standard limits (⚑12 account-wide default).
- **Add an address** — one screen (Places lookup via the shared field,
  manual entry works too). Both addresses are kept either way; "replaces
  my main one" only changes which leads. With 2+ addresses the Home
  switcher appears and filters the story per property; the same address
  typed messily can never duplicate (one dedupe rule).

## Your check (after deploy)

1. Portal Home → **Get a new estimate**. The wizard opens with your
   address already in it; run it through — no email question anywhere —
   and the new estimate appears on your Home.
2. Home → **Add an address**, add anywhere. The switcher chips appear.

## Proof in CI

- `e2e/portal-builder.spec.ts` 3/3 live: prefill + no-email full run
  landing on the SAME account and property; a stranger with the property
  URL gets no prefill; add-address with switcher + dedupe (messy
  re-entry = still 2 properties).
- `lib/portal/builder.contract.test.ts` — the no-fork proof.
- `lib/portal/limits.test.ts` — trade/unblock gate rules.
- Journey + shell suites re-run green (the anonymous public flow is
  untouched behaviourally). Unit 1003.

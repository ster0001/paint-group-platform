# Portal 3a-2 — magic-link sign-in + the portal shell

**What this ships:** the customer portal at `/account` — passwordless
sign-in (⚑3), the app shell from the approved mockup (call chip header,
bottom tabs on a phone / sidebar on desktop), and a state-aware Home that
leads with exactly one primary action. **No migration** — this session is
pure code.

## Your 2-minute walkthrough (the fun one — on your phone)

1. On your phone, open **paint-group-platform.vercel.app/account**.
2. You'll land on the sign-in page: no password, just your email. Enter
   **tjhroman@gmail.com** and tap **Email me a sign-in link**.
3. Open the email ("Sign in to your Paint Group account") and tap
   **Open my account**.
4. You should land in your own portal: greeting, a state-aware headline
   about your real jobs, your estimates listed, the office number in the
   header on every page, and the five tabs along the bottom.
5. Tap through the tabs — My project / My colours / Money / Messages each
   say honestly what will live there and how to reach us meanwhile
   (their content arrives in sessions 3a-3 → 3a-5).
6. The link in the email is single-use and lasts an hour — tapping it a
   second time should land you on a plain "that link has expired" page
   with a resend box, never an error screen.

## What proved it in CI

- `e2e/portal-shell.spec.ts` — 4/4 against the live stack, including the
  headline law: **anonymous wizard → save → magic link → portal without a
  registration form or password field anywhere**, and membership created
  only at the verified click (typing an email grants nothing).
- `lib/portal/home.test.ts` — the Home state machine precedence
  (walkthrough > underway > booked > estimate ready > saved > welcome),
  Day-N-of-M from booking dates, and the no-phone fallback.
- `lib/portal/auth.test.ts` — sign-in redirects can never leave our site.
- Unit suite 971/971 · lint + tsc clean.

## Notes

- Sign-in emails send through Resend (same as estimate emails) — Supabase's
  own SMTP is not involved, so there is nothing to configure there.
- The old `/dashboard` page now redirects to `/account` (same-day
  retirement rule); customer logins land on `/account`.
- Wizard saves now email "Your estimate is saved" with a sign-in button
  (real customers only — test/e2e addresses are never emailed).

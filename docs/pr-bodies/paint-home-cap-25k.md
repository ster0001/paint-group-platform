# Paint Home: the phone-close ceiling is $25,000, and the hand-off still lets the customer tighten

**Tom, 27 Oct 2026:** "in the wizard when building an estimate I keep getting 'this is too big to price' — increase this to $25,000 and allow all boxes to be ticked to allow to tighten".

## What changed
- **Ceiling $25,000**, as Paint Home's OWN policy number (`wizard_policy.paintHomeCapCents`, default 2,500,000; migration `20270307000000_paint_home_phone_close_cap_25k.sql` writes the key on the live row — one `update`, read-back, ledger row). The office desk-check's remote-confirmation cap ($12,000, interior only, ⚑7) is untouched; Paint Home had been borrowing it. The Paint Home project cards follow the new number.
- **The real reason it fired so often:** Paint Home's hand-off also triggered on the inside-only *self-serve* cap of $6,000 (the "fix it online with nobody looking" rule), so every inside job over $6,000 was "too big" whatever the ceiling said. That rule no longer counts for Paint Home — one call always confirms the price anyway. The hand-off still fires over the ceiling, for asbestos / lead / mixed inside-and-outside, and when the job needs a person on site.
- **Tighten from the hand-off:** the "bigger than we can price from your phone" screen now offers **Tighten my price** (or **Change a side** once the walk is checked) beside **Book a site visit**, so every room or side can be ticked and the range closed before anyone comes out.

## Proof
- Unit `lib/wizard/brand.test.ts` (the self-serve cap no longer sends a Paint Home job to the hand-off); full suite green; typecheck clean; lint 0 errors.
- e2e `e2e/marketing/painthome-wizard.spec.ts` test 2 asserts the Tighten door on the hand-off (the run lowers the ceiling to force it). Local C1 result in the PR conversation; otherwise the PR e2e job.
- Help `docs/help/paint-home/staff.md`, launch checklist; `docs/ARCHITECTURE.md`.

## For Tom — SQL to paste (Supabase SQL editor), then read the ledger
`supabase/migrations/20270307000000_paint_home_phone_close_cap_25k.sql` — adds `paintHomeCapCents` to the settings row; the read-back prints `cap = 2500000` and the unchanged remote cap beside it. If there is no `wizard_policy` row the update touches nothing and the code default ($25,000) already applies.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

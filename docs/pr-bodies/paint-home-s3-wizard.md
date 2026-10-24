# Paint Home — Session 3: the wizard brand branch (two doors shut, phone-only tier, brand on every lead)

**Brief:** `docs/briefs/paint-home.md` §5, §8.3. Follows #365 (brand plumbing) and #366 (the words), both live on painthome.com.au.

## What this is
The same `/estimate` wizard, served under painthome.com.au (⚑ P5), with a `brand` branch inside the existing pages — no forked pages, no copied components. Paint Group's wizard is unchanged: every option, door and title it had, it keeps.

## What changed
- **`lib/wizard/brand.ts`** (pure, tested) — `propertyKindsFor` / `jobTypesFor` (Paint Home: no commercial kind, no *Both*; ⚑ P6 two estimates), `allowedForBrand` (a shut door is refused however it arrives), `paintHomeTier` (the phone-close tier: `call` at or under `wizard_policy.remoteConfirmCapCents` — ⚑ P7 Paint Group's value — with no must-see guardrail and no `requires_site_check`; else `visit`), `paintHomeEstimatorIntro`, `PAINT_HOME_WORDS`. `brand.test.ts` is the route test: no commercial screen is reachable from any Paint Home answer.
- **Brand resolution** — `lib/wizard/brandServer.ts wizardBrand` (the Paint Home host, or `?brand=painthome`) → `WizardApp brand` prop → written once onto the wizard state (`state.brand`), so it autosaves, resumes and submits. `parseEstimateIntent` reads `brand` and refuses a business mode on a Paint Home hand-off.
- **Writes** — the draft route writes `wizard_drafts.brand`; the submit route writes `estimates.brand` and returns `paintHome: { tier, capCents }` decided from the same decision, policy and site-check the guardrails used.
- **Migration `20270300000000_paint_home_brand.sql`** — `brand` (default `paintgroup`) on `wizard_drafts`, `estimates`, `work_orders`, `invoices`; partial indexes; `brand_carry_from_estimate()` triggers so a work order and an invoice inherit their estimate's brand on insert; backfill; read-back; ledger row.
- **Screens on Paint Home** — `QuickLook` renders only Inside / Outside and house / townhouse / unit; the scope arrives pre-answered from the chip; the gate's opt-in names Paint Home; `Wordmark` draws the Paint Home mark; the header's call button is labelled for the brand; every `/estimate/*` title carries the brand's name. **`Reveal`**: on the `call` tier one hero door, **Confirm my price. Book a call** (the existing request-a-call sheet → a "Call … confirm price" item on Today), Tighten and Send a message beside it, no site-visit or Speak-with-us door, "Then one call." in the ladder. On the `visit` tier the doors become the hand-off — *This one's bigger than we can price from your phone.* … *You'll hear from the Paint Group team, who look after our larger jobs.* — with **Book a site visit** → `/estimate/visit`; every answer is kept on the estimate. That hand-off is the first and only place the wizard names Paint Group (§5).
- The sent page introduces the estimator as *Sarah, who'll be checking your price.* on Paint Home.
- Help `docs/help/paint-home/{staff,customer}.md`; `docs/ARCHITECTURE.md` paragraph.

## Proof
- Unit: `lib/wizard/brand.test.ts` (+ `prefill.test.ts`, the migration-paste test) — full suite 4060 green. Typecheck clean; lint 0 errors.
- e2e `e2e/marketing/painthome-wizard.spec.ts` (anonymous, phone): (1) Inside → See my price → the wizard on painthome.localhost with the Paint Home mark and no Paint Group in the header; Inside pre-answered, no Both, no Commercial; the quick look to the range; `door-call` *Confirm my price. Book a call*, no `door-book` / `door-speak`, "Then one call."; the call requested; `wizard_drafts.brand = painthome`, `estimates.brand = painthome`, `source = customer_intake`. (2) The ceiling lowered on the test project → the hand-off with the Paint Group team line and no call door → *Book a site visit* → `/estimate/visit?id=…` on the Paint Home host; the estimate carries the brand and a total. (3) The Paint Group wizard still offers Both and Commercial. **Run status in the PR's e2e job** (see the note below).

## For Tom
1. Paste `supabase/migrations/20270300000000_paint_home_brand.sql`; read the read-back row (4 brand columns, 2 triggers, 1 function); check the ledger.
2. Manual test (phone): painthome.com.au → Outside → an address → See my price → the wizard shows the Paint Home mark, Outside selected, no Both → tap through to the range → *Confirm my price. Book a call* → request the call → Estimates: the new row; CRM Today: the call item. Then the same on paintgroup.com.au: Both and Commercial are still there, and the range still offers *Book a site visit*.
3. Decide ⚑ P1 (self-sign with no call) and ⚑ P7 (a Paint Home-specific ceiling) when you have fifty jobs of evidence; both are one-line changes now.

## Not in this PR
Session 4 (comms and portal: brand tokens in templates, invoice legal line, portal header logo per job brand), 5 (brand pill and filters, dashboard split), 6 (launch).

🤖 Generated with [Claude Code](https://claude.com/claude-code)

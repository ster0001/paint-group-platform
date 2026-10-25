# Paint Home: the wizard is live on its own switch; exterior ranges reach 5% further under

**Tom, 25 Oct 2026:** "go live with the estimator wizard when typing an address (just for painthome) not for paint group yet — exclude all commercial projects and just price for interior or exterior projects" and "for exterior projects, broaden the pricing to 5% under". No migration.

## What changed
- **Paint Home live, Paint Group unchanged.** `settings.wizard_public` gains `enabledPaintHome` (default **true**, and a row from before the field existed reads as true). `app/estimate/page.tsx` asks `wizardOpenFor(online, brand)`: an address typed on painthome.com.au opens the wizard now; paintgroup.com.au stays on its holding page until its own switch (`enabled`) is turned on. Settings → Online estimates shows the second switch.
- **Interior and exterior homes only.** Paint Home has had no commercial kind and no "both" since Session 3 (`lib/wizard/brand.ts`); nothing new to build — restated in the help.
- **Exterior 5% under.** `WizardPolicySettings.exteriorUnderPct` (default 5, editable on the `wizard_policy` row). `rangeFromTotal(total, pct, underPct)` and `envelopeFor({ underPct })` stretch the **low** end only; `underPctFor(blocks, policy)` is the one exterior test, used by the submit route (a "both" job's exterior half only), the wizard-edit route, `customer-scope.ts`, the trade portal range and the assistant's `price_scope`. The top of the range, the central price, the phone-close tier, Speak with us and the caps do not move. Applies on both sites (an exterior price is an exterior price).

## Proof
- Unit: `lib/wizard/policy.test.ts` (lo drops by exactly the extra 5%, hi unchanged; `underPctFor`; settings parsing), `lib/wizard/envelope.test.ts` (envelope low end only, open questions unchanged), `lib/wizard/publicFlag.test.ts`; the S3 parity test now carries the under on both paths. Full suite 401 files green; typecheck clean; lint 0 errors.
- e2e `e2e/marketing/painthome-wizard-live.spec.ts`: Paint Group off + Paint Home on → painthome.localhost/estimate is the wizard and the platform host holds; Paint Home off → holds; an old row reads as live. Local C1 result in the PR conversation; the PR e2e job is the proof otherwise.
- Help: `docs/help/paint-home/staff.md`, `customer.md`; `docs/ARCHITECTURE.md` paragraph.

## For Tom
- Nothing to paste. After the deploy, type an address on painthome.com.au: the wizard opens. paintgroup.com.au still holds.
- To change the 5%: Settings row `wizard_policy` → `exteriorUnderPct` (no UI for that row yet).

🤖 Generated with [Claude Code](https://claude.com/claude-code)

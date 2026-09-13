# The `wizard_public` switch — checklist (C17)

**The switch is OFF in production and stays off until Tom flips it.** This
page is what has to be true first, what flipping it changes, and what comes
out afterwards. Nothing here is automated: every line is a person's check.

## 1 · What the switch does

`settings.wizard_public` (`lib/wizard/publicFlag.ts`, read by `/estimate`):
`{ enabled, holdingTitle, holdingBody }`. Off = the holding page ("Online
estimates are nearly here") with the call-me-back form; signed-in members and
staff still reach the wizard. On = every visitor reaches screen 1.

## 2 · Before flipping — the values to confirm in PRODUCTION Settings

Run this on the **production** project's SQL editor (read-only; it changes
nothing) and check each row against the column on the right:

```sql
select key, value
from public.settings
where key in (
  'wizard_public', 'wizard_policy', 'wizard_bands', 'wizard_limits',
  'confirmation_turnaround', 'wizard_hold_days', 'service_area',
  'scope_editor', 'commercial_pricing', 'measured_tree_max_age_days',
  'company_profile'
)
order by key;
```

| Key | Must be | Why |
|---|---|---|
| `wizard_public` | `enabled: false` until the flip; holding copy read once more | the switch itself |
| `wizard_policy` | the caps you want: `minJobCents`, the fix-online caps (interior / exterior), `fixOnlineEnabled` | an empty `{}` means every default in `lib/wizard/policy.ts` (`DEFAULT_POLICY`), including the $2,000 floor |
| `wizard_bands` | tight / mid / wide %s you are happy to show | the range widths; test has 4 / 8 / 15 |
| `wizard_limits` | `maxEstimatesPerVisitor` and the hold message | the anonymous cap |
| `confirmation_turnaround` | the hours and the words you can keep to | printed to the customer; the queue chases it |
| `wizard_hold_days` | present (test has none → default) | "held for N days" on the fixed price |
| `service_area` | the postcodes you serve | outside → hand-off, never a price |
| `scope_editor` | `visitSlots` if you offer online booking windows | the book-a-visit door |
| `commercial_pricing` | loadings and racking shares reviewed | C12–C14's numbers |
| `company_profile` | phone, logo, coordinator name | the human line on every screen |

Also confirm: an estimator has patch postcodes (`profiles.patch_postcodes`)
so "Send to <name>" names a real person; Google is connected on the Diary
for whoever takes visits; Twilio/Resend keys are set (Settings → Messaging)
so the sign-in link and the SMS actually send.

### As read on production, 14 Sep 2026 (Tom's paste)

| Key | Production value | Verdict |
|---|---|---|
| `wizard_public` | `{"enabled": false}` | OFF, as it should be. No holding copy of its own — the defaults in `lib/wizard/publicFlag.ts` show. |
| `wizard_policy` | `{}` | **Every default applies**: $2,000 floor, the fix-online caps, the remote-confirmation cap from `DEFAULT_POLICY`. Decide these before the flip, in Settings → Online estimates. |
| `wizard_bands` | tight 4 / mid 8 / wide 15 (min 90 / 70) | fine to start; narrow after fifty jobs |
| `wizard_limits` | 2 per visitor + the hold message | fine |
| `confirmation_turnaround` | 8 h · "usually by the next working day" | fine — the queue chases it |
| `wizard_hold_days` | absent | default applies; set it if the held-price wording should say a number you chose |
| `service_area` | `{"postcodes": []}` | **EMPTY = nobody is ever outside the area.** Fill it (the postcodes you serve) or every out-of-area visitor gets a range and a hand-off only at the desk. |
| `scope_editor` | absent | no online visit slots offered; "Book a visit" falls back to the callback path. Set `visitSlots` if the four-times booking screen should show windows. |
| `commercial_pricing` | loadings + racking + widen 5/5/3, EWP at 4 m | reviewed in C12–C14 |
| `measured_tree_max_age_days` | 365 | fine |
| `company_profile` | name, phone, logos, estimator Tom Roman | **no `coordinatorName`** — the app's fallback name ("Felipe Martinez", `lib/portal/data.ts` `getCompanyContact`) is what a customer with no patch estimator sees on "Send to <name>" and the sent page. Set it, or set patch postcodes on the estimators, before the flip. |

## 3 · The flip itself

1. Settings → Online estimates → **On**. That is the only switch.
2. `app/estimate/page.tsx:31` — `robots: { index: false, follow: false }` is
   the crawler block. Leave it as is for the first weeks: the wizard is
   reached from the homepage and campaigns, not from search. Flip to
   `index: true` only when the copy and the ranges have settled.
3. Watch Today → Waiting on you for the first hour. Every online quote lands
   there as a confirmation request; the turnaround clock starts at send.

## 4 · The v1 → v2 strangler window

- v1 is the office builder (`/quote`) and the phone; v2 is the customer
  wizard writing into the same estimates, the same tree, the same pricing.
  There is no second data model to migrate: a v2 estimate IS a `/quote`
  estimate with a wizard snapshot on `builder_state.wizard`.
- During the window the office keeps quoting as before; v2 quotes arrive
  beside them with a Pack tab. Nothing in v1 is switched off.
- Measure per plan §9 (pricing correlation): guide range → confirmed price →
  actual hours, per segment (`estimate_events` `price_fixed`, the work order's
  hours). The Proving page is the read.

## 5 · What deletes after fifty jobs

Plan of record §9 and ⚑7: the bands and the commercial widening start wide
because the evidence is thin. After fifty confirmed jobs per segment:

- narrow `wizard_bands` / `commercial_pricing.widen` from the correlation;
- widen the remote-confirmation cap (⚑7: interior ≤ $12k today);
- retire the "guide range" wording where the band has earned "detailed";
- delete the v1 holding copy from `wizard_public` and the call-me-back form's
  special case on `/estimate` (`HoldingCallback.tsx`) — the holding page has
  no reason to exist once the wizard is the front door;
- drop the `commercialKind` fallback in `lib/wizard/policy.ts` once no open
  session predates the segment question.

## 6 · Rollback

Settings → Online estimates → **Off**. The holding page returns on the next
request; open sessions keep their drafts (`wizard_drafts`) and a signed-in
member can still finish. No deploy, no migration.

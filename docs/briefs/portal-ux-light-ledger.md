# Portal UX + light mode — session ledger

Branch `portal-ux-light` (worktree `~/pgp-portal-ux-light`, based on `origin/main` e27f8d2f, 26 Oct 2026).
Brief: `claude-code-brief-customer-portal-ux-light-mode.md` · plan: `customer-portal-ux-light-overnight-plan.md` · mockup: `customer-portal-light-mockup.html`.
One entry per stage. ⚑ lines are Tom's to overturn in the morning.

## Stage 0 — reconnaissance (no code)

Reference files, as they really are (the portal is a route group, so every page sits under `app/account/(portal)/`):

| Brief says | Real path |
|---|---|
| `app/account/layout.tsx` (shell) | `app/account/(portal)/layout.tsx` — header, tab bar (bottom nav on phones, sidebar from 900px), the chat widget mount. `app/account/layout.tsx` only wraps `.acct` + the stylesheet. |
| `app/account/page.tsx` | `app/account/(portal)/page.tsx` (residential Home); trade Home is `TradePortfolioHome.tsx` |
| `app/account/project/page.tsx` | `app/account/(portal)/project/page.tsx` → shared `JobTimeline.tsx` + `project/PhotoGrid.tsx` |
| `app/account/colours/page.tsx` | `app/account/(portal)/colours/page.tsx` (+ `lib/portal/colours.ts`) |
| `app/account/money/page.tsx` | `app/account/(portal)/money/page.tsx` (+ `lib/portal/money.ts`) |
| messages | `app/account/(portal)/messages/page.tsx`, `messages/[estimateId]/page.tsx` (+ `lib/portal/messages.ts`) |
| profile | `app/account/(portal)/profile/page.tsx` |
| `app/globals.css` / `tailwind.config.ts` | **Neither exists for the portal.** The portal has no Tailwind and no `dark:` variants: its whole palette is the `.acct { --ink … }` block at the top of `app/account/account.css` (scoped tokens, dark by default). "Dark tokens" = that block. |
| status chip | `.chip` + `.chip.cyan|amber|emerald|clay|mut` in `account.css`; the class names are typed in `lib/portal/*` (`ChipCls`) and rendered by every page |
| floating "Chat with us" | `app/estimate/assist/AssistantWidget.tsx`, mounted in the portal shell layout (`{!financeOnly && <AssistantWidget />}`) and lifted 76px by `--chat-lift` |
| buttons | `.btn.btn-cyan` (primary) / `.btn.btn-ghost` (secondary) — the same two classes serve the Home CTA and the Messages Send button already. The names are shared with `/e`, marketing and the widget, so they stay; only their styling changes. |
| swatch | `.sw`, `.sw-row`, `.sw-nm`, `.sw-meta` (colours page) |
| photo grid | `project/PhotoGrid.tsx` (`.pgrid`, `.photo`, `.lightbox`) |

Findings that change the plan:
- **A4 logo — a real dark-on-light mark exists.** `settings.company_profile.logoUrlLight` is set on production (`estimate-media/logos/1790213183648-…png`, 2172×724: black PAINT, grey GROUP, cyan dot). `getCompanyContact()` already returns it as `logoUrlLight`; the portal context just never carried it. No CSS filter needed, no ⚑.
- **Dark-mode CSS to delete:** none beyond the token block — `grep -rn "data-theme\|prefers-color-scheme\|dark:" app/account` is already empty. `e2e/portal-theme.spec.ts` is the CONTRACTOR portal's switch (`app/portal`), out of scope.
- **E1 colour record:** the register row is `{surface, product, colourName, colourHex, code, coats}`; `product` is the full paint name ("Dulux Wash&Wear Low Sheen") so brand + line + finish are derivable from it; `code` is the painter's match code from `work_orders.colours[*].match.code`. There is no separate brand/finish field — brand comes off the product name, and a code that looks like a hex fragment is hidden (⚑ E1 below, once built).
- **G2 unread:** `estimate_messages` has no read marker, but the `messages` mirror does (`provider='portal', direction='out', read_at`), and `customer_thread_opened(estimate_ids)` is the customer-side "I read it" write. Unread = mirrored staff messages with `read_at is null`. No new field. Today the LIST page calls `customer_thread_opened` for every thread before rendering, which would zero the badge — the call moves to the thread page.
- **F4 unpaid state:** customer card payment is wired (`/i/[token]` carries `PayBox`), so "Pay now" links there — not a dead button.
- **C3 relative dates:** `estimates.updated_at` exists (not selected today) — it becomes the "Updated N days ago" source.
- **D1 project switcher:** `getPortalProject` picks one WO by stage order; `getPortalProjectByWorkOrder` already serves the trade route — the switcher lists issued WOs and `?project=<woId>` selects one through that function.
- **B3:** `e2e/tom-batch-17sep.spec.ts` test 11 asserts the widget sits above the tab bar on `/account` — it flips to asserting the widget is gone from the portal.
- e2e specs that pin copy this run changes: `portal-shell` ("Invoicing" tab, `.btn-cyan` count), `portal-aftercare` (`WALLS · LOW SHEEN · 2 COATS · CODE PN1E4`), `portal-money` (`View & pay`), `portal-timeline` (`Done ✓`, `CHECKED AND SENT BY THE OFFICE`), `portal-commercial` + `trade-money-team` ("Invoicing" tab), `portal-builder` ("Get a new estimate"). Each is updated with its stage.
- Help files to update after the run: `docs/help/work-orders/customer.md`, `docs/help/logins/customer.md`, plus new `docs/help/customer-portal/customer.md` for Home / Payments / Messages / Colours.

## Stage 1 — light tokens + logo (A1, A2, A4, B2, B3)

Shipped:
- `app/account/account.css` rewritten in place around the brief's token set (`--bg/--surface/--surface-2/--border/--ink/--ink-2/--ink-3/--accent/--accent-ink/--ok/--warn/--info/--danger` + `*-bg`, `--shadow`). The dark block is gone, not parked. Every inline `var(--text|--muted|--cyan|--line|--raised|--graphite|--amber|--emerald|--clay)` under `app/account/**` was renamed to the new token (30 files), and the three `rgba(…)` state borders became `var(--warn)` / `var(--ok)`.
- Primary button = accent fill + ink text; secondary = white, 1px border, ink text (A2). Chip classes keep their names (`cyan/amber/emerald/clay/mut` are typed in `lib/portal`) and now paint `info/warn/ok/danger/neutral` on their `*-bg` tints. Active tab = `--accent-ink` on `--surface-2`. Header white with a bottom border; desktop sidebar paper with a right border. Photos and swatches carry a 1px border.
- A4: the header wears `settings.company_profile.logoUrlLight` (the real dark-on-light mark) through `PortalContext.logoUrl`, 22px on phones / 26px on desktop, wrapped in a link to `/account`. No filter, no ⚑.
- B2: the phone pill collapses to the icon alone below 640px (`.call-num` hidden); the tap still calls.
- B3 (default): `AssistantWidget` is no longer mounted in the portal shell; `--chat-lift` is gone with it. It still mounts on `/estimate/scope`. `e2e/tom-batch-17sep.spec.ts` test 11 now asserts the launcher is absent on `/account`, `/account/messages` and `/account/money`.
- Lightbox backdrop stays dark on purpose: it frames the photo, it is not chrome.

Checked: `tsc` clean (the two `LayoutProps` errors are Next's generated types, absent until a build runs in this worktree); `eslint --max-warnings 4 app/account lib/portal` clean; Home, login and the tab bar viewed at 400px on the C1 stack (:3102).

⚑ None.

## Stage 2 — global sweep (B1, B4, B5)

Shipped:
- B1: `h2`, `.note`, `.tl-date`, `.mmeta`, `.msg-meta`, `.sw-meta`, `.refline`, `.colourcard .meta2`, `.raillabels`, `.notify-head` and the photo caption are the body font in sentence case. Mono now paints only `.money`, `.chip`, `.tile .num`, `.pulse .n`, the phone pill, the new `.meta-mono` (invoice / receipt numbers, stage 5) and the DRAFT watermark. "CHECKED AND SENT BY THE OFFICE" reads "Checked and sent by the office" (component, both timeline specs, the sample test and the customer help).
- B4: `.job.tap` + `.chev` — a card that is a link is the whole card, with a right chevron and a pressed state. Applied to Home's Documents card (replacing the mono OPEN pill — C5's ask, settled the mockup's way) and the Profile Notifications card (the "→" is gone from the heading). Estimate cards get it in stage 3 with the grouping; message rows in stage 6 with the list rewrite; invoice rows in stage 5.
- B5 / H3: Sign out already existed at the foot of Profile as well as Home — nothing to add.

Checked: lint clean; `vitest lib/portal lib/progress-preview` 148/148; Home and Profile viewed at 400px.

⚑ None.

## Stage 3 — Home (C1–C5)

Shipped:
- C1: `homeState` headlines follow the stage: walkthrough → "Your painting at X is ready for your look around"; in progress → "…is underway"; closed → "…is finished". Pinned in `lib/portal/home.test.ts`.
- C2: `lib/portal/homeList.ts addressChips()` — identical addresses (address + suburb + postcode, case and spacing ignored) collapse to one chip with an estimate count badge ("13 Leamington Cres · 4"); the four most recently active lead, the rest sit behind "More (n)" (`?all=1`, server-rendered, no script); a selected hidden chip is pulled into view; selecting a merged chip filters to every record behind it. Nothing merged or deleted (locked default).
- C3: `groupEstimates()` — Needs you (Ready for you · Keep shaping · Not yet submitted) / With us (Being checked, "We're checking the details — you'll hear from us within one business day") / Done (Accepted · Complete when the work order is closed · Declined · history records), each newest activity first by `estimates.updated_at` (now selected), with a relative date on every card ("Updated 2 days ago", Melbourne calendar days). Done is a native `<details>`, collapsed unless it is the only group. The estimate cards are whole-card links with a chevron (B4).
- C4 (locked default): one button, "Get an estimate for another property" → `/estimate` (address step first). "Add an address" had its own working destination (`/account/addresses/new`, registers a property with no estimate) so it stays as a text link, "Add a property (no estimate yet)".
- C5: Documents card settled in stage 2 (whole-card link + chevron, no OPEN pill).
- Specs: new `e2e/portal-home-groups.spec.ts` (groups, chips, dedupe, two-row cap, whole-card tap, one CTA, light background, phone + desktop screenshots into `docs/briefs/portal-ux-light-screens/`). `airtable-import` opens Done before looking for history records; `portal-builder` asserts the new CTA.

Checked: `tsc` clean, lint clean, `vitest lib/portal` 79/79. **e2e not yet run** — the test project lock was held by CI run 40261115241 at the first try (one wait, then report: the rule). Retried once with the stage 5–7 specs below.

⚑ C4: the Home button no longer aims the wizard at the selected property (`/estimate?property=…`); that door is unchanged inside the wizard and from the trade portfolio, only the Home shortcut is gone.

## Stage 4 — My project (D1–D5)

Shipped:
- D1: `getPortalProjects()` lists every issued work order the account owns (stage order, as before); `getPortalProject(accountIds, workOrderId)` picks by `?project=` and falls back to the first. With two or more jobs the page carries the Home chip strip (minus Everything) above the title; Home's Done cards with a job behind them deep-link to `/account/project?project=<woId>` (`work_orders.id` now rides the Home query).
- D2 (locked default): `approvedExtras()` + `areaRollups(surfaces, variations)` — once an extra is approved (`customer_approved` / `contractor_accepted`, a signed credit subtracts) the "Variations" area row is replaced by "Extra work · N approved · $X inc GST" with an Approved chip. Pinned in `timeline.test.ts`.
- D3: a signed-off job keeps its people, in the past tense — "Who painted your home" / "Who looked after your job"; the coordinator's Message / Reply button stays.
- D4: `PhotoGrid` — "4 photos · tap to view" on the entry; the lightbox shows the area label and "2 of 4", steps with arrows, ← → keys and a swipe, and stays a rendition. Thumbnails already lazy-load; `decoding="async"` added.
- D5: the completion-report button is the secondary button, labelled "Open report".
- Spec: `portal-timeline.spec.ts` now seeds a Variations area + an approved extra and a second, signed-off job; asserts the extras row, the present/past tense, the count line, the lightbox stepping and the switcher; saves `project-phone.png` to the screens folder.

Checked: `tsc` clean, lint clean, `vitest lib/portal lib/progress-preview` 157/157. e2e queued with the batch (lock held, see stage 3).

Lesson for the ledger: three edits in this stage went through perl with `$/`, `${…}` in the replacement — one NUL byte and two emptied placeholders. Every changed file is now NUL-scanned before a commit.

⚑ D2: variations and extras are one concept here (the brief's default). If "Variations" should stay a separate area row alongside the extras line, that is one filter in `areaRollups`.

## Stage 5 — Payments (F1–F5)

Shipped:
- F1 (locked default): the tab and the page say "Payments" — residential, trade and the finance seat alike, and the property page's Money tab. Route stays `/money`.
- F2: `buildMoneyView` gives every project `totalIncCents` (the accepted contract, else everything issued), `paidCents`, `remainingCents`, and a chip that answers "do I owe anything?": Nothing owing (ok) · Due {date} (warn, the earliest unpaid due date) · Overdue (danger). "On track" is gone. A `paid` invoice owes nothing whatever its payment rows say (a hand-marked bank transfer has none). Pinned in `money.test.ts`.
- F3: one row per invoice — `INV-0023 · Payment request · 25 Aug` in the one mono meta line, the amount, the state chip, "Includes GST of …", then two small secondary buttons: **Invoice PDF** (new owner-only route `app/account/invoice/[invoiceId]/route.ts`, the twin of the receipt route — issued invoices only, 404 otherwise, served through `ensureInvoicePdf`) and **Receipt PDF** (`/account/receipt/[paymentId]`). The separate receipt line and the full-width "View invoice & PDF" button are gone. The not-yet-invoiced remainder keeps its row ("Not yet invoiced · Not due yet").
- F4: customer card payment is wired on the invoice page (`PayBox`), so an unpaid row carries a primary **Pay now · due {date}** into `/i/<token>?portal=1`. An unpaid row with no token (should not exist) shows the due date and "Ring us … to pay" instead of a dead button.
- F5: the footer question is body copy and says "payment".
- Specs: `portal-money.spec.ts` asserts the three numbers, the Due chip, two Invoice PDF buttons, one Receipt PDF, Pay now, and saves `payments-phone.png`; `portal-shell`, `portal-commercial`, `trade-money-team` look for the Payments tab.

Checked: `tsc` clean, lint clean, `vitest lib/portal` 102/102; `/account/money` viewed at 400px on the seeded preview account (two projects, paid + due rows).

⚑ F1: the trade portal's money tab and title now also read "Payments" (the tab component is shared). If trade customers should keep "Invoicing", it is one label in `AccountTabs.tsx` and one `<h1>` in `TradeMoneyScreen.tsx`.

## Stage 6 — Messages (G1–G4)

Shipped:
- G1: only threads with a message list; the sent estimates with nothing in them sit behind one "Start a conversation about…" native select at the top (`messages/StartConversation.tsx`), which opens the empty thread.
- G2: the badge is UNREAD staff replies — counted from the `messages` mirror (`provider = portal, direction = out, read_at is null`), cyan, hidden at zero; an unread preview reads bold. `getPortalThreads` no longer stamps anything; `markPortalThreadOpened(estimateId)` runs on the thread page only, and only when there is something unread. No new field.
- G3: thread header = address + the estimate's status chip; "Open the estimate" and "Ask the assistant" are small secondary buttons under it (the assistant keeps its `ask-assistant` test id for `support.spec.ts`); sender · time on one body-font meta line; staff bubbles carry an initial (Robyn / Felipe tell apart); the composer is sticky above the tab bar on phones (16px from the bottom on desktop) and the thread scrolls behind it. Customer bubbles are ink-on-white inverted, staff bubbles white with a border (the mockup).
- G4: confirmed with B3 — the floating widget is gone from the portal, Messages is the one chat. Message rows are whole-card links with a chevron (B4, deferred from stage 2).
- Spec: new `e2e/portal-messages.spec.ts` — 21 messages seeded, one quiet estimate; asserts the single row, the picker, the badge = mirrored unread replies, bold preview, header chip + Open the estimate, initials R/F, composer and Send in the viewport at 400×860, a send, the badge cleared after opening, the picker opening the empty thread; saves `messages-phone.png` and `thread-phone.png`. `lib/portal/messages.test.ts` pins `groupThreads`.

Checked: `tsc` clean, lint clean, `vitest lib/portal` green; list + thread viewed at 400px on the preview account (badge 2, composer on screen).

⚑ G3: a chip for "Open the estimate" in the header (the brief's words) made the header three lines at 400px with a long address; it is a small secondary button on the row under the title instead.

## Stage 7 — My colours (E1–E6)

Shipped:
- E1 (locked default): the register row's `product` string is the only record of brand and finish, so `describeProduct()` reads brand · line · finish off it ("Dulux · Wash&Wear · low sheen"; an unknown brand is the first word, nothing invented). `displayCode()` shows a painter's match code only when it reads as a manufacturer code — a hex colour or an id fragment ("6c15e22d", the leak) is never rendered. No UUID reaches the page.
- E2 (locked default): `byColour()` — one card per colour: name, brand · line · finish · coats (a range when they differ) · Code, then "Walls — Hallway & stairs, Lounge · Ceiling — Lounge". "By area" is a server-rendered toggle (`?view=area`) with the per-area rows in the same words.
- E3: the swatch is the real hex when known, the colour's initial on surface-2 when not; TBC keeps its striped amber swatch.
- E4: Download PDF + "Need touch-up paint?" sit on a sticky action row under each property heading. The touch-up link rings the office today (a `tel:`), so it stays a call (locked default: leave it when it is not Messages).
- E5: with more than one property each collapses to its heading + colour count + applied date, the first open (native `<details>`).
- E6: "kept here for good" appears once, in the intro; "Applied by 17 Sep 2026" per property, formatted like every other date.
- `PrintButton` takes `small` for the action row; the statement, warranty and `/e` warranty pages keep the full-width button.
- Spec: `portal-aftercare.spec.ts` asserts the by-colour card (line, code, surfaces, the real swatch colour), the TBC card, the applied date, the sticky actions, "for good" once, and the By area view; saves `colours-phone.png`.

Checked: `tsc` clean, lint clean, `vitest lib/portal` green (colours 12/12). The preview account has no signed-off job, so this page's look is proven by the spec's screenshot, not the browser.

⚑ E1: brand comes off the product name. If the office wants a separate brand/finish field on the colour record, that is a schema change and out of this run.
⚑ E4: "Need touch-up paint?" still rings the office rather than opening Messages with a prefilled line.

## Stage 8 — Profile + accessibility (H1–H3, A3)

Shipped:
- H1–H3 landed in stage 2 (body-font helper text; the Notifications card is a whole-card link; Sign out already at the foot of Profile).
- A3 contrast: no axe or Lighthouse is installed in this repo, so every token text/background pair was measured directly (WCAG 2 relative luminance, `scratchpad/contrast.mjs`). Three of the brief's tokens missed AA for normal text and were darkened: `--ink-3` #8A939E → **#636D7B** (2.9:1 → 4.8:1 on paper), `--ok` #1B7F56 → **#17704C** (4.4 → 5.4 on its tint), `--warn` #9A6A0F → **#8C600D** (4.2 → 4.9). Everything else passes: ink 16:1, ink-2 5.6:1, accent-ink 4.9–5.4:1 (4.6 on surface-2), info 4.7:1, danger 5.1:1, ink on the accent button 10:1, white on accent-ink (badge) 5.4:1.
- Screenshots are taken by the specs into `docs/briefs/portal-ux-light-screens/` (home phone + desktop, project, payments, messages, thread, colours) — they land when the e2e batch runs.
- Help: new `docs/help/customer-portal/customer.md` (Home, Payments, Messages, My colours, Profile); `work-orders/customer.md` (switcher, extras row, past tense, lightbox), `invoicing/customer.md` (Payments / Pay now / Invoice PDF), `imported-history/customer.md` (Done group). `npm run help:index -- --check` passes. `docs/ARCHITECTURE.md` carries the paragraph.

⚑ A3: the three darkened tokens differ from the brief's table by one or two shades; the brief's values did not pass AA at the sizes they are used.

## Stage 9 — remove the old (ground rules)

Nothing of the dark portal remains to delete beyond what the stages already replaced in place: the token block was rewritten (stage 1), the widget mount and `--chat-lift` went with it, the OPEN pill / "View invoice & PDF" / separate receipt line / mono-caps headings were replaced by their light-mode counterparts in their stages. No `-v2`, `-old` or `legacy` file was created; no component was kept "just in case".

Grep checklist (run from the worktree root, 26 Oct 2026):
```
grep -rn "data-theme\|prefers-color-scheme\|dark:" app/account        → nothing
grep -rn "Invoicing" app/account                                         → nothing
grep -rn "v2\|-old\|legacy" app/account                                  → 4 pre-existing comments about "estimator journey v2" / "trade portal v2" (the brief names, not files)
grep -rn "--raised\|--graphite\|--muted\|--line\b\|--cyan\b" app/account → nothing (the old token names are gone)
```
`knip` is not installed (and is not added — no new dependency); instead every `.acct .class` in `account.css` was grepped for a consumer under `app/account`, `app/wizard`, `app/e` and `lib` — none is orphaned. `git diff --stat origin/main..HEAD -- app lib e2e`: 63 files, +1943 / −653 — a replace-in-place diff with real deletions, as the plan asked.

## ⚑ for the morning (all defaults built; overturn any)
| ⚑ | What was built | To overturn |
|---|---|---|
| A3 | `--ink-3`, `--ok`, `--warn` one–two shades darker than the brief's table (AA) | the three lines at the top of `account.css` |
| B3 / G4 | Chat with us hidden on every `/account/*` route | mount `AssistantWidget` in `(portal)/layout.tsx` and restore a `--chat-lift` |
| C2 | identical addresses one chip + count; nothing merged | `addressChips()` in `lib/portal/homeList.ts` |
| C4 | one "Get an estimate for another property" → `/estimate`; "Add a property (no estimate yet)" kept as a text link; the Home shortcut aimed at the selected property is gone | the CTA block in `(portal)/page.tsx` |
| D2 | "Extra work · N approved · $X inc GST" replaces the Variations area row | `areaRollups()` filter in `lib/portal/timeline.ts` |
| E1 | brand · line · finish parsed from the product name; hex / id "codes" hidden | `describeProduct` / `displayCode` in `lib/portal/colours.ts` |
| E2 | By colour default, By area toggle | `byArea` default in `colours/page.tsx` |
| E4 | "Need touch-up paint?" still rings the office | the action row in `colours/page.tsx` |
| F1 | "Payments" everywhere, trade and finance included | `AccountTabs.tsx`, `TradeMoneyScreen.tsx` |
| F4 | Pay now → the invoice page (card payment is wired there) | — |
| G3 | "Open the estimate" is a small secondary button under the title, not a header chip | the thread page header |

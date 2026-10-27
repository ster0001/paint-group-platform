# Customer portal: light mode + UX pass (brief 25 Oct 2026)

Branch `portal-ux-light` → `main`. One merge is the cutover: the live portal keeps its dark build until this lands, then the light one replaces it in the same deploy (tag `portal-dark-final` on main first for a 48-hour rollback point, as the plan says). No migration. No new dependency.

**What changed** (ledger: `docs/briefs/portal-ux-light-ledger.md`, one entry per stage, ⚑ table at the end):
- **A · Light only.** `app/account/account.css` rewritten in place around the brief's tokens; dark block deleted, no toggle, no `data-theme`. Real dark-on-light logo (`settings.company_profile.logoUrlLight`) in the header, 22/26px, links Home. Primary = accent fill + ink text; secondary = white + border. Three tokens darkened to pass AA (ink-3, ok, warn — measured, ⚑).
- **B · Global.** Mono only for money, numbers and chips; headings/helper/meta in the body font, sentence case. Phone pill → icon under 640px. "Chat with us" widget off every `/account/*` route (⚑ B3). Whole-card tap targets with chevrons. Sign out on Home and Profile.
- **C · Home.** Headline follows the stage (walkthrough = "ready for your look around"). Address chips deduped + capped (Everything + 4 + More (n)). Estimates grouped Needs you / With us / Done (collapsed), next-step line and "Updated 2 days ago" on every card. One "Get an estimate for another property" button (⚑ C4).
- **D · My project.** `?project=` switcher; "Extra work · N approved · $X" replaces "Variations · Not started" (⚑ D2); past-tense team after sign-off; swipeable lightbox with "2 of 4" and a photo count.
- **F · Payments.** Tab + title renamed (⚑ F1 incl. trade). Total / Paid / Remaining on every project, chip Nothing owing / Due {date} / Overdue. One row per invoice with **Invoice PDF** (new owner-only `app/account/invoice/[invoiceId]/route.ts`) + **Receipt PDF**; **Pay now** into `/i/<token>` (card payment is wired there).
- **G · Messages.** Live threads only + "Start a conversation about…" picker; badge = unread staff replies from the `messages` mirror, cleared when the thread opens; header chip + Open the estimate; staff initials; composer pinned above the tab bar.
- **E · My colours.** By colour (default) with By area toggle; brand · line · finish off the product name; a hex/id is never shown as a "code" (⚑ E1); letter swatches; sticky Download PDF / touch-up per property; properties collapse; "for good" once.
- **Help:** new `docs/help/customer-portal/customer.md`; work-orders, invoicing, imported-history customer pages updated. `docs/ARCHITECTURE.md` paragraph.

**Tests.** Unit: `vitest lib/portal lib/progress-preview` green (homeList, money, messages, colours, timeline). e2e (C1, this worktree's dev server): see the run note below. New specs `e2e/portal-home-groups.spec.ts`, `e2e/portal-messages.spec.ts`; extended `portal-timeline`, `portal-money`, `portal-aftercare`; label updates in `portal-shell`, `portal-commercial`, `trade-money-team`, `portal-builder`, `airtable-import`, `tom-batch-17sep` (test 11 now asserts the widget is absent).

**Morning review (phone):** Home headline vs hero card · chips row count · Payments three numbers · Messages badge · Colours brand/finish · the ⚑ table.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

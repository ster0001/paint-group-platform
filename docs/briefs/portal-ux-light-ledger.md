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

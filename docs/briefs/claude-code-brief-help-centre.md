# Claude Code brief — Help centre in the platform + first-login guided tour (Phase C)

**Status:** draft for Tom's read, 6 Sep 2026. Build starts on his go.
**Follows:** `claude-code-brief-help-content-foundation.md` (Phase A, shipped on `feat/help-content-foundation`). This is that brief's Phase C, widened by Tom's request for a guided tour on first login.
**Owner decisions:** flagged ⚑. Where a ⚑ blocks a session, stop and report.

---

## 0. Kickoff ritual (unchanged)

1. Read every file in §2 in order. Any missing → STOP and report.
2. Confirm the file list back before writing code.
3. Commit this brief to `docs/briefs/` first, on a new branch from `main` (Phase A must be merged first).

## 1. Purpose

Phase A produced six manuals as markdown in `docs/help/`, with screenshots and captioned films, and the rule that a feature is not done until its manual is. Nobody can use them yet: they live in the repository. Phase C puts them in front of the people they are for, inside the platform, and greets a new contractor with a short tour of the screens before they start.

**Principles carried over, not renegotiated.** One source of truth: the help centre renders the files in `docs/help/` and nothing else; there is no CMS, no copy in a database, no second draft. Role-scoped by construction: a contractor session can only ever load contractor files, enforced in the server render, never by hiding. Regenerable: the films and screenshots are whatever the capture rigs last produced.

## 2. Reference files (read in this order)

1. `CLAUDE.md` — including the help-file rule under Process.
2. `docs/briefs/claude-code-brief-help-content-foundation.md` — Phase A brief; §5 describes Phase C in one paragraph, §7 lists the ⚑ decisions this brief resolves.
3. `docs/help/README.md` — folder convention, front-matter spec, `_index.json`, the stamp/stale mechanism.
4. `docs/help/_index.json` and the six help files — the content this renders.
5. `scripts/help-index.ts` — the index the route reads; extend, never duplicate.
6. `lib/contractor/session.ts` (`requireContractor`) and `lib/auth` staff guards — the role source for filtering.
7. `app/portal/PortalTabs.tsx`, `app/(app)/AppSidebar.tsx`, `app/pc/PcNav.tsx` — where Help enters the navigation.
8. `lib/marketing/md.ts` — the existing markdown renderer; reuse it or extend it, do not add a second one.
9. `docs/ARCHITECTURE.md` entries "Help content — session A1…A4".

## 3. Rulings already made (do not re-ask)

- Contractors read help **inside the platform only**. No PDF, no print.
- Customers get help **through the assistant** (Phase B), not a route. No `customer` files exist yet; the route must not pretend otherwise.
- ⚑2 (Phase A): a painter sees Help **from first login**, before any offer — Tom, 6 Sep ("a guided tour when first logging in").
- ⚑3 (Phase A): **no notifications** when a guide changes, in v1.
- Money in help text is AUD inc GST; contractor copy is plain English, English idiom.

## 4. What to build

### C1 — the Help route, role-filtered (walking skeleton first)

- **Contractor portal:** a **Help** entry in the bottom tabs (`PortalTabs`) → `/portal/help`. Lists every `contractor.md` from `_index.json` (title + summary), grouped by feature. `/portal/help/<feature>` renders the file: markdown through the shared renderer, screenshots inline, the walkthrough film inline and playable, "Related" links resolved to routes of the **same role only**.
- **Office:** a **Help** entry in the staff sidebar → `/help`. Lists `staff.md` and `pc.md` files (office staff see both; `pc` is a specialisation of staff). `/help/<feature>/<role>` renders.
- **Role enforcement in the server render.** The loader takes the role from the session guard and reads only files whose front-matter `role` matches. The response body of any `/portal/help*` page must contain no text from a `staff.md` or `pc.md`; assert it against the raw HTML the way `e2e/crew-leak.spec.ts` does, not against the rendered screen.
- **Media.** `docs/help/**/media/*` is not under `public/`. Serve it through one route handler (`/help/media/<feature>/<file>`) that only serves paths listed in `_index.json` for a file the session's role may read; anything else is 404. Bundle `docs/help/**` for Vercel with `outputFileTracingIncludes` (the same fix the PDF chromium binary needed — see `next.config.ts`).
- **Design system.** Rendered in the portal's `.pt` theme and the app's theme; no new colours; captions and chips in help text keep the token names (amber/cyan/emerald/clay).
- **Acceptance:** the contractor test login sees every `contractor.md` in `_index.json` (three today) and can open each with its film; the staff login sees every `staff.md` and `pc.md` (three today). Counts are asserted from the index, never hard-coded. Raw-HTML leak test green on the C1 stack; Lighthouse ≥ 90 on `/portal/help/scheduling` mobile.

### C2 — search

- One search box on each Help index page, over `_index.json` title + summary + the file bodies, role-filtered before matching. Server-side (route param `?q=`), no client index to leak. Results show title, feature, and the matching sentence.
- **Acceptance:** searching "before photo" as a contractor finds the work-orders painter guide at the right step; the same query as staff finds the PC guide too; a contractor query can never return a pc/staff hit (e2e asserts the response body).

### C3 — first-login guided tour (Tom's request)

- On a contractor's **first sign-in** the portal opens a short overlay tour: one card per tab — Home, Requests, Jobs, Invoicing, Calendar, Help — each with two or three plain sentences and a **Next** / **Back** / **Skip** control, ending on "Start with Help when you're stuck". Six to eight cards, under a minute.
- **Tour content is help content**: it lives at `docs/help/_tours/contractor.md` (one `##` heading per card, body, and a `target:` line naming the tab it points at), validated by `scripts/help-index.ts` like everything else and stamped/stale-checked the same way. No tour copy in components.
- **Seen once, re-runnable.** Completion or skip is recorded server-side (`contractors.tour_seen_at`, one migration, RLS in the same file, ends with a read-back `select`; a contractor may only set their own). "Show me around again" sits at the top of `/portal/help`.
- **Never in the way of work.** The tour does not show if the contractor already has a live offer or booked job on first sign-in (they came to act, not to browse); Help still shows it on demand.
- ⚑ **Staff tour:** none in v1 (recommend). Say so if you disagree.
- **Acceptance:** e2e as a **fresh** contractor invite (through `/join`, not a seeded row): tour appears, Next through every card, lands on Help; second sign-in shows no tour; "Show me around again" replays it; a contractor with a live offer gets no tour.

### C4 — the help centre's own help

- `docs/help/help-centre/contractor.md` and `docs/help/help-centre/staff.md` — how to find a guide, search, replay the tour. Screenshots and films from the capture rig, per the Phase A rule. This is the definition-of-done rule applying to itself.

## 5. Sessions

| # | Scope | Gate |
|---|---|---|
| C1 | routes, loader, media handler, nav entries, leak test | e2e green on C1 stack, Lighthouse ≥ 90 |
| C2 | search | e2e green, role-leak test extended to search |
| C3 | tour + migration + `_tours` in the index script | e2e through a real `/join` invite; Tom pastes the migration on prod |
| C4 | help for the help + ARCHITECTURE + manual test | `npm run help:index -- --check` green, stamped |

One branch `feat/help-centre`, one PR per session or one for all four — Tom's call at C1.

## 6. Not in scope

Customer help route (⚑6 stays assistant-only); assistant retrieval (Phase B); voiced video (Phase D); editing help inside the platform (help is edited in the repo, on purpose); notifications on change (⚑3, ruled no).

## 7. Flagged decisions ⚑

| # | Decision | Recommendation | Blocks |
|---|---|---|---|
| C-1 | Staff get a guided tour too? | No in v1; office staff are onboarded in person | C3 |
| C-2 | Tour on every device, or once per account? | Once per account (server flag), replayable from Help | C3 |
| C-3 | Show Help to a **suspended** contractor? | Yes, read-only Help stays; everything else stays blocked | C1 |
| C-4 | Search matches across the full body, or titles and summaries only? | Full body, server-side | C2 |

## 8. Definition of done

- A painter on a fresh invite is toured, lands on Help, and can read and watch every painter guide inside the portal; the office reads theirs in the app.
- No contractor response ever carries office content — proven against raw HTML in e2e, on the test stack.
- Tour and help-centre copy live in `docs/help/`, validated, stamped, and warned-on-stale like every other help file.
- Nothing from Phase B or D built.

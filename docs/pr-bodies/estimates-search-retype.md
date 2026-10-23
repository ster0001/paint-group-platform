# Estimates search: filter as you type, no reload, no lost letters

**Tom, 23 Oct 2026:** "there is a bug with the search bar, so it crashes and retypes as you are typing in the estimates tab."

## What was wrong
The box debounced each pause into `router.push("/estimates?q=…")`. The App Router keys the page segment by its search params, so every pause swapped the whole page for the `(app)` loading skeleton (the "crash") and mounted a **new** box holding the needle from 350 ms earlier (the "retype"): focus gone, and any letters typed while the server was rendering gone with it. On production, where the list render takes a second or more, that was every few letters.

The needle never changed what the page **read** — the page fetched the tab's rows and narrowed them in memory — so the round trip bought nothing.

## What changed
- `lib/estimate/search.ts` — the one matcher: `filterEstimateRows` (title / customer / address / wizard name, address, suburb, or the estimate number as "42", "0042", "#42"), `filterWizardSessions`, `filterWaitingItems`. Unit-tested.
- The three tab tables (`EstimatesTable`, `WizardSessionsTable`, `WaitingTable`) read the needle with `useSearchNeedle()` (`useSearchParams().get("q")`) and filter on the client. The "No … matches" lines moved into them; `EstimatesTable` takes `empty` for the no-rows box.
- `SearchBox.tsx` keeps local text and writes `?q=` with `history.replaceState` on every keystroke — Next feeds that into `useSearchParams` with no request, no skeleton, no remount. Enter and Clear do the same. `data-ready` stays.
- `page.tsx` no longer reads `q` or filters; a deep link `/estimates?q=…` still paints filtered on the server because the same hook runs during SSR of this force-dynamic page.
- Help: `docs/help/estimator/staff.md` "Search as you type". `docs/ARCHITECTURE.md` paragraph.

## Proof
- `e2e/estimates-search-typing.spec.ts` plants an estimate, types the needle one letter every 450 ms (longer than the old pause), and asserts every letter, the focus, the URL, zero page fetches carrying `q=`, the single filtered row, the empty line and back, the deep link, and Clear.
- `lib/estimate/search.test.ts` 8/8.
- Existing: `e2e/tom-batch-29sep.spec.ts` test 7 (search runs as you type), `e2e/customer-journey/tom-batch-15sep-evening.spec.ts` test 4 (deep links, empty line, Clear).

No migration.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

# Overnight build plan — Customer portal UX + light mode

**Companion to:** `claude-code-brief-customer-portal-ux-light-mode.md` (the brief has the detail; this is the run order).
**Mockup:** `customer-portal-light-mockup.html` (real logo, light tokens).
**Answer to "is it too big for one run?":** No. It is roughly 6–8 hours of focused Claude Code work: front-end only, no migrations, no new tables, no new integrations. The two things that normally stall an overnight run — waiting on a decision and waiting on data — are removed: every ⚑ has a locked default in the brief, and the only data-dependent item (colour brand/finish) has a fallback. Run it as one session on a worktree and review in the morning.

---

## Before you start it (5 minutes, Tom)
1. Commit the brief, this plan and the mockup to the repo under `docs/briefs/` (same-day rule).
2. Make sure the test account you were logged in as tonight still has its ~20 addresses — that's the stress case for C2/C3.
3. Create the worktree so it can't collide with anything else running:
   `git worktree add ../pgp-portal-ux-light -b portal-ux-light`
4. Start Claude Code in that worktree with the kick-off prompt at the bottom.

---

## The run — eight stages, one commit each

Each stage ends with: `npm run lint && npm run typecheck && npm run build` green, a commit, and a one-paragraph note appended to `docs/briefs/portal-ux-light-ledger.md`. If a stage cannot be finished, the ledger says why and the run moves on — it never waits for Tom.

### Two rules that shape the whole run
1. **The live portal is untouched until cutover.** Everything happens on the branch; production keeps serving the dark portal in full. Customers never see a half-built mix.
2. **Replace in place, then remove the old.** No parallel copy of the portal, no `-v2` files, no feature flag. Each stage edits the existing page and deletes what it supersedes. Stage 9 sweeps for anything left and proves it with a grep.

| # | Stage | Brief parts | Est. | What "done" looks like |
|---|---|---|---|---|
| 0 | Reconnaissance | §0 reference files | 20 min | Confirms every reference file path; lists the real component names for chips, buttons, header, widget, swatch, photo grid; checks `estimate-media/logos` and `public/` for a dark-on-light logo. Writes findings to the ledger. No code changes. |
| 1 | Light tokens + logo | A1, A2, A4 | 45 min | Tokens swapped at the root; dark tokens parked under `[data-theme="dark"]`; real logo in the header, legible on white; primary/secondary button components updated. Every route renders light with no dark remnants. |
| 2 | Global sweep | B1–B5 | 60 min | Mono caps gone from sentences; phone pill collapses to icon below 640px; floating chat widget hidden on `/account/*`; whole-card tap targets with chevron and pressed state; Sign out on Profile. |
| 3 | Home | C1–C5 | 75 min | Headline driven by stage; chips capped at Everything + 4 + "More (n)", deduped with count; estimate list grouped Needs you / With us / Done with next-step line and relative date on every card; one "Get an estimate for another property" button; Documents card uses the secondary button. |
| 4 | My project | D1–D5 | 60 min | Project switcher chips + `?project=` deep link from Home; Extra work row from approved extras; past-tense team headings after sign-off; photo lightbox with swipe and count; lazy-loaded images. |
| 5 | Payments | F1–F5 | 60 min | Nav + title say Payments; every project card shows Total / Paid / Remaining with the Nothing owing / Due / Overdue chip; one row per invoice with Invoice PDF + Receipt PDF buttons; unpaid state built or "Ring us to pay" fallback. |
| 6 | Messages | G1–G4 | 45 min | Empty threads hidden behind a "Start a conversation about…" picker; badge is unread-only; composer pinned above the bottom nav; header carries address + status chip + "Open the estimate"; staff bubbles have avatar initials. |
| 7 | My colours | E1–E6 | 75 min | Grouped by colour with a By area toggle; brand/finish shown when the record has it, UUID never shown; real hex or initial swatch; sticky Download PDF / touch-up actions per property; properties collapsible; "on file for good" line once. |
| 8 | Profile + QA | H1–H3, A3 | 45 min | Profile tidy-ups; axe/Lighthouse accessibility pass on Home, Project, Money, Colours at 400px and desktop; screenshots of each page saved to `docs/briefs/portal-ux-light-screens/`. |
| 9 | Remove the old | ground rules | 45 min | Delete every remnant of the dark portal: dark tokens, dark-mode CSS and Tailwind `dark:` variants under `app/account/**`, theme-switch code, components no longer imported, old chip/button variants, unused icons and images, the floating chat widget mount on portal routes. Run the grep checklist below; all must return nothing. Ledger closed out with the ⚑ list for the morning. |

### Grep checklist for stage 9 (run from the repo root, all must be empty)
```
grep -rn "data-theme\|prefers-color-scheme\|dark:" app/account components/account
grep -rn "Invoicing" app/account components/account        # nav label and copy now say Payments
grep -rn "v2\|-old\|legacy" app/account components/account
npx knip --include files,exports 2>/dev/null | grep -i account   # unused files/exports under the portal
```
Also confirm `git diff --stat main..portal-ux-light` shows deletions, not just additions — a replace-in-place build removes roughly as much as it adds.

Colours runs late on purpose: it is the only stage that depends on what the data holds, so a surprise there can't derail the rest.

### Stop-and-report rule for this run
Stop only if a reference file genuinely does not exist and no equivalent can be found in stage 0, or if a change would need a schema/RLS edit. Everything else — missing data field, missing logo asset, a page that behaves differently from the brief — gets the documented fallback and a ⚑ line in the ledger. Taste questions are never a reason to stop; the mockup is the tiebreaker.

---

## Morning review (15 minutes, on your phone)
1. Open the four screenshots folders, then the live preview of the worktree branch.
2. Walk the five tabs on the test account. The things most worth checking:
   - Logo on the white header (A4) — if it's the CSS-filtered version, export a proper dark logo and drop it in.
   - Home headline vs hero card agree (C1).
   - Colours page: is brand/finish showing, or did it fall back to name-only (E1)?
   - Payments: did it find a payment route or fall back to "Ring us to pay" (F4)?
3. Read the ledger's ⚑ list and overturn any default you disagree with — each one is a small follow-up, not a rebuild.
4. **Cutover is one merge.** Merge `portal-ux-light` → `main` in a single merge commit; Vercel deploys it and the old portal is gone in the same deploy. No feature flag, no soft launch, no running both. Tag the commit before the merge (`portal-dark-final`) so there is a rollback point for 48 hours, then delete the tag and the worktree.
5. Open the live portal on your phone once more. If anything is wrong, revert the one merge commit — the old portal comes back whole.

---

## Kick-off prompt for Claude Code (paste as-is)

```
Read docs/briefs/claude-code-brief-customer-portal-ux-light-mode.md and docs/briefs/customer-portal-ux-light-overnight-plan.md in full, and open docs/briefs/customer-portal-light-mockup.html for the target look.

Work through the plan's nine stages in order, one commit per stage, on branch portal-ux-light in this worktree. Never touch main. Replace components in place — no v2 files, no flags, no parked dark-mode code — and finish with the stage 9 cleanup and its grep checklist, which must all come back empty. Every ⚑ in the brief has a locked default in its "locked defaults" table — build the default and never pause to ask. Keep docs/briefs/portal-ux-light-ledger.md updated after every stage with what shipped, what fell back to a default, and anything Tom must look at in the morning.

Customer-facing copy: English tone, sentence case, plain words. Money in AUD inc GST. The header must use the real Paint Group logo (brief A4), never styled text.

Stop only for the two conditions in the plan's stop-and-report rule. Finish by running the stage 8 accessibility pass and saving phone and desktop screenshots of every portal page.
```

---

## How this fits the end-to-end picture
Nothing in this run creates a new source of truth. Home re-presents wizard sessions, My project re-presents PC Command work orders and QA events, Payments re-presents the invoicing module, Messages re-presents the messaging adapter, My colours re-presents the colour register. The run surfaces two seams worth fixing at source afterwards so every portal (customer, contractor, PC Command) says the same thing: the colour register leaking a UUID as a "code" (E1), and "variations" vs "extras" being two words for one thing (D2). Both go on the next build list, not this one.

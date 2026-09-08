# Reward tiers — Bronze · Silver · Gold

*Tom's decision, 8 Sep 2026. Plan only; nothing built yet. Four PRs, one migration. Sits behind the flow in `customer-flow-plan.md` — the tiers are the reward for tightening, and tightening only makes sense once the range comes first.*

## 1 · The decision

| Tier | The customer gets | What it costs us |
|---|---|---|
| **Bronze** | A price range | — |
| **Silver** | **30-day price hold** · **first pick of start dates** | Nothing, if the range is honest |
| **Gold** | Everything in Silver · **paint upgrade (trade → premium)** · **free 1-hour Dulux colour consult** · **no site visit — book straight in** | The litre delta · ~$85 · a desk check instead of a visit (a saving) |

Rewards are *applied to the job when the customer goes ahead*, and every one expires with the 30-day hold. Reaching a tier is what unlocks them; accepting is what earns them. No cash off, ever.

**"Book straight in" means "sign now, we confirm within one business day."** A Gold acceptance goes to a desk check, not to auto-confirmation — the pending stage Tom asked for. Auto-confirm for proven B2B accounts is a later, per-account switch, not part of this plan.

**Two rails added 8 Sep (Tom: "I'm still a little worried about offering Gold as no site contact required").**
- The estimator has a **third desk-check outcome: Book a visit instead.** One tap turns the desk check into a site visit with times offered, and the customer keeps their Gold rewards. "No site visit" is the *default* outcome, never a promise we're locked into.
- **"Book straight in" ships behind a Settings switch that starts OFF** (`wizard_rewards.goldSkipVisit`). At launch Gold = Silver + the paint upgrade + the colour consult, and a Gold acceptance reads *"Sign now — your estimator confirms it within a business day, at a desk or with a quick look."* Every Gold desk check records whether the confirmed price stayed inside the range; when twenty have, Tom flips the switch and the wording becomes "no site visit". The build is identical either way — the switch only changes what we promise.

## 2 · What a tier is

A tier is the confidence band the estimate already carries. The thresholds are the existing `wizard_bands` setting — no second set of numbers:

- **Bronze** — below `midMin` (70): the range is ±15%.
- **Silver** — at or above `midMin`: ±8%.
- **Gold** — at or above `tightMin` (90) **and** self-serve eligible: ±4%, under the cap, no `requires_site_check`, no visit-only reason (custom items, peeling, rot, flagged photos).

So Gold is not a fourth threshold; it is "Silver, plus the evidence that lets us skip the visit". Today that evidence is a floorplan or listing (extraction gives real sizes), every room confirmed, and no open flags. **PR 1 must measure what a no-plan interior actually reaches after a full confirm walk** (memory says the low 70s; the 65% cap lifts once rooms are customer-settled). If Gold is unreachable without a plan, that is not a bug — it becomes the explicit Gold unlock: *"Upload your floorplan to unlock Gold."*

**Exterior stays out of Gold** until photos can grade condition (separate plan). Tom's 21 Aug rule stands: an estimator signs off every exterior job. Exterior can reach Silver.

## 3 · Each mechanic — what exists, what's built, what goes

### 3.1 One ladder (the clean-up that everything sits on)

**Exists, badly.** Self-serve is decided in three places with the same formula copied out — `lib/wizard/customer-scope.ts`, `app/api/estimates/[id]/wizard-edit/route.ts`, `lib/agent/scope-tools.ts` — each reading `scope_editor.selfServeInteriorCapCents / selfServeExteriorCapCents / selfServeMinAccuracy` with hard-coded fallbacks, **while** `lib/wizard/policy.ts` has its own `wizard_policy` caps that `evaluateGuardrails` uses. Two sources of truth for one decision. Neither has a Settings screen (`wizard_policy` is SQL-only). Both editors declare their own `Ladder` type.

**Built.** `lib/wizard/ladder.ts` — one pure function:

```
ladderFor({ accuracyPct, midCents, hasExterior, requiresSiteCheck, deferred, sidesMeta, bands, policy })
  → { tier: "bronze" | "silver" | "gold", selfServe: boolean, reason: VisitReason | null,
      nextUnlock: { tier, needs: string[] } | null }
```

Reads `wizard_bands` + `wizard_policy` only. The three call sites call it. `customerPayload` / the wizard-edit response carry `ladder.tier` and `ladder.nextUnlock`; `visitSlots` and the rewards list ride alongside.

**Deleted.** The three inline formulas; the `scope_editor.selfServe*` keys (a one-line SQL to strip them from the live row — `liveRange` and `visitSlots` stay); the duplicate `Ladder` types in `ScopeEditor.tsx` / `SidesEditor.tsx` (import the one type).

**Settings.** Online estimates gains a **Tiers** block: the two thresholds, the two caps, and the **Rewards** table (tier → label, kind, note) as one `wizard_rewards` setting. Rewards are data; nothing about them is a constant.

### 3.2 Silver · the 30-day price hold

**Exists.** `estimates.valid_until` (set at send), the customer copy reads it, the `estimate_lapsed` work item chases it.

**Built.** Reaching Silver stamps `valid_until = today + 30` on the draft the first time (never shortened by later edits; extended on acceptance if it would otherwise expire inside the desk-check window). The range card says *"Price held until 8 Oct"*. Nothing new is stored.

### 3.3 Silver · first pick of start dates

**Exists.** Site-visit slots (`wizardVisitSlots`, `bookWizardSlot` → `crm_visits`) and the contractor booking spine (offers → work orders). There is no customer-facing "hold a start week" concept, and we are **not** adding a tentative state to bookings — that spine carries money and offers, and a soft hold that nobody honours is worse than none.

**Built.** A **Preferred start** picker (week-of, next 8 weeks, from the same availability read the visit slots use) appears at Silver. Stored as `builder_state.preferredStart { weekOf, chosenAt }`. It shows on the desk-check item, the capture prep pack, the work-order creation screen and as a chip on the schedule board's unscheduled card. "First pick" is a promise staff keep — we ask them first and book them first — surfaced everywhere the booking is made, not a lock.

### 3.4 Gold · no site visit — book straight in

**Exists.** `accept_intent` writes `prepPack.kind = "desk_check"`, a deferral and an `estimate_events` row. CaptureApp shows "Customer accepted online — desk check". **Nothing raises it on Today** — `WORK_ITEM_KINDS` has no desk-check kind, so an online acceptance waits for someone to notice.

**Built.**
- `desk_check` work item kind: derived from `estimate_events.customer_accept_intent` on a draft, due next business morning, priority high, subject the estimate, killed by the outcome.
- The desk-check outcome, in the builder: **Confirmed** (inside the range → status accepted, booking confirmation + the preferred start go to scheduling), **Needs re-confirm** (moved outside the range → the customer gets the new figure and confirms again), or **Book a visit instead** (the estimator wants eyes on it → visit times offered, rewards kept). Messages ride the existing automation registry (`desk_check_confirmed`, `desk_check_reconfirm`, `desk_check_visit`, email + SMS templates). The item records `heldInRange: boolean` for the switch decision.
- Gold acceptance carries the preferred-start pick with it; the confirmed job is created with that week as its target.

### 3.5 Gold · the paint upgrade

**Exists.** Products carry `brand, finish, category, type, properties, image_url` — no grade and no upgrade mapping. Materials resolve per surface (`productNameFor`: surface → materials map → rate item default). The work order's materials (`aggregateMaterials`, `WOMaterial`) are computed from the same map.

**Built.**
- Migration: `products.upgrade_product_id uuid null references products(id)` — "the premium this trade product upgrades to". Edited in Settings → Products (one dropdown per row). No grade column: the mapping *is* the grade.
- At acceptance with Gold, `builder_state.rewards.paintUpgrade = { at, map: { [tradeProduct]: premiumProduct } }` is stamped from the mapping **as it stood that day**, so a later product change never rewrites an accepted job.
- The **work order** and the Materials card resolve through the stamped map (the painter buys the premium); the **price** does not change — the accepted snapshot is frozen. The material-cost delta shows on the job as a reward cost line (feeds Phase 6 P&L).
- The customer copy lists it under inclusions: *"Paint upgrade included: Dulux Wash&Wear → Dulux Wash&Wear+ (Gold)"*.

### 3.6 Gold · the Dulux colour consult

**Exists.** `crm_visits.kind` already allows `colour_consult`; the Diary books visits; automations send `.ics` invites.

**Built.** On Gold acceptance: `builder_state.rewards.colourConsult = { at }`, an inclusion line, and a `visit_rebook`-style item on Today ("book the Gold colour consult") that the coordinator resolves by booking a `colour_consult` visit in the Diary. Nothing new in the schema.

### 3.7 Stamping rewards so they can't drift

Rewards are earned at **acceptance**, stamped into `builder_state.rewards` and into the accepted snapshot's `inclusions`, and expire with `valid_until`. A tier reached and then lost (the customer adds a custom item after Silver) earns nothing; the range card says which reward just went and why.

### 3.8 The unlock UX

The range card (both editors) shows the tier chip and one line: *"Silver — 2 questions from Gold: confirm the ceiling height (narrows by ~$380), upload your floorplan."* The questions come from `assumptionSwings` (exists), the plan prompt from `nextUnlock`. Reaching a tier animates the chip and lists what's unlocked. This is the "gamification": every answer moves the number and unlocks something real.

## 4 · Clean-build ledger

| Goes | Replaced by |
|---|---|
| Three copies of the self-serve formula (`customer-scope.ts`, wizard-edit route, `scope-tools.ts`) | `ladderFor()` in `lib/wizard/ladder.ts` |
| `scope_editor.selfServeInteriorCapCents / selfServeExteriorCapCents / selfServeMinAccuracy` | `wizard_policy` (already there) + a Settings screen |
| Two `Ladder` types in the editors | One exported type |
| `ContactCard.tsx` ("Finalise my price" picker) | `ReachStrip` — the CTA opens the same three doors; two components collecting the same request is one too many (found 8 Sep) |
| Hard-coded `1_200_000 / 600_000 / 85 / 90` fallbacks | `DEFAULT_POLICY` / `DEFAULT_BANDS` only |

Nothing is written on top of these; each PR deletes as it replaces, and the e2e that covered the old path is rewritten to the new one in the same PR.

## 5 · The PRs — one each, e2e-first

*Sequence across both briefs: ladder (PR 1 here) → the flow (three PRs in `customer-flow-plan.md`) → the unlock UX (PR 4 here, moved up) → Silver (PR 2) → Gold (PR 3). Rewards ship after the flow, or we'd be rewarding people for slogging through the long form.*

**PR 1 · One ladder + Settings.** `lib/wizard/ladder.ts` + tests (bronze/silver/gold, every visit reason, the caps); the three call sites; delete the duplicates; Online estimates → Tiers + Rewards settings; the tier chip on the range card (no rewards behaviour yet). *Gate:* the existing ladder / sides-editor / interior-loop specs unchanged in behaviour; a new unit test pins what a no-plan interior reaches after a full walk (the Gold-reachability fact).

**PR 2 · Silver.** Price hold on `valid_until`; the Preferred start picker and its surfaces (desk check, prep pack, WO creation, board chip); ContactCard folded into ReachStrip and deleted. *e2e:* reach Silver → hold date on the card and on `/e/[token]` → pick a start week → visible on the board's unscheduled card.

**PR 3 · Gold.** `desk_check` work item + the two outcomes + messages; `products.upgrade_product_id` migration + Settings → Products dropdown; rewards stamped at acceptance (inclusions + `builder_state.rewards`); WO/Materials resolve the upgrade with the price frozen; colour-consult item → Diary booking. *e2e (as customer with the C1 plan fixture, then as staff):* Gold → accept with a start week → Today shows the desk check next morning → Confirm → estimate accepted, customer copy lists both rewards, work order materials show the premium, a `colour_consult` visit can be booked from the item.

**PR 4 · The unlock UX.** `nextUnlock` line with $ swings, the floorplan-as-Gold-unlock prompt for no-plan jobs, tier animation, "reward lost" explanation. *e2e:* a no-plan interior at Silver shows the plan prompt; uploading the plan lifts it.

Gates on every PR: `tsc` clean, eslint 0 errors, unit green, the named C1 specs green, ARCHITECTURE.md section, a manual walk in `docs/manual-tests/`.

## 6 · Migrations

One: `products.upgrade_product_id`. Plus one data statement stripping the dead `selfServe*` keys from the live `scope_editor` row (read-back in the migration file). No new tables — rewards live in `builder_state` and the accepted snapshot, exactly as inclusions do today.

## 7 · Decisions for Tom (⚑)

1. **The upgrade map** — which premium each trade product becomes (filled in Settings → Products once PR 3 lands; the reward can't stamp until it's set).
2. **Hold starts automatically at Silver** (my recommendation — it costs nothing) or only when the customer taps *Hold this price*?
3. **Silver on exterior** — allowed (yes, in this plan) or Gold-only?
4. **The desk-check promise wording** — "within one business day" is what the customer is told; confirm.

## 8 · Deliberately out of scope

- Auto-confirm for proven B2B accounts (per-account cap) — after twenty desk checks per slice show the change rate.
- Exterior Gold — waits on photo condition grading.
- Interval (low/high) pricing — separate brief; the tiers sit on the same bands, so it slots in without touching this.
- Range-before-contact and the shortened question set — `customer-flow-plan.md`, which this plan now sits behind.

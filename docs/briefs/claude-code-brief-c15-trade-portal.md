# Chunk C15 — The trade portal

**Slots into:** `docs/briefs/estimator-v2-runsheet.md` §5. Replaces the one-paragraph C15 block in `estimator-v2-delta-and-plan.md` §3 — that block predates the design gate.
**Size:** M, and honestly closer to two sessions. If it runs long, stop at the end of a walk and take the next in a fresh session — walks A, B and C are separable.
**Migration:** `trade_specs`, `building_profiles`, `properties.measured_tree`, `tenant_photo_links`.
**Approved design:** `design/reference/trade-portal-v2.html` — the gate deliverable, approved 12 September. Open every screen, toggle Desktop and Phone, and **read the Notes ⚑ drawer on each one before building it**. Nine decisions (⚑53–61) are recorded there. Where this brief and the prototype disagree on behaviour, this brief wins; on look, copy and question order, the prototype wins; report either way.

> **⚑55 is blocking for walk B.** The list of things that can change on a strata building between years is Tom's domain knowledge, not mine — the prototype's list is a proposal. Build walks A and C, build B's structure, and **flag ⚑55 rather than treating the proposed list as final**.

---

## Why this chunk exists

Trade is not a second product. It is the same scope tree, the same pricing engine and the same components, composed for someone at a desk who does this forty times a year instead of once. Plan of record §8.1 is the rule: one component library, three compositions, a `mode: public | portal | trade` prop switching density, defaults, gates and copy. **Nothing is forked.**

The reason it matters more than its size suggests is §8.3 — *measured once, ranged forever*. The hard segments (strata, hospitals, shop fronts) can't be ranged for a stranger because nobody can give us the metres. But the estimator's first visit produces a measured tree, and every later quote on that building starts from it. That turns "we visit" into a one-time cost per building, and it is the clearest form of the moat: the competitor quoting the same corridors next year still has to send someone.

---

## Step 1 — Report before building (no code)

    Report with file:line, and wait:
    1. What exists for trade today — the /estimate?spec= seed at
       app/estimate/page.tsx, lib/portal/portfolio.ts, and the flags JSON that
       trade_specs replaces. What reads each.
    2. Whether properties.measured_tree is written by C6's fix_price. If not,
       that is this chunk's first task — walk B is impossible without it.
    3. Whether the colour-collapse bug at QuoteBuilder.tsx:1128 is closed, and
       what the per-property colour register looks like in the schema today.
    4. account_type handling: where trade is detected, and every gate that
       currently branches on it.
    5. Which components from the public wizard can take a `mode` prop without
       being rewritten — the room card, the range bar, the assume list, the
       save-and-book sheet, the brief and book screens — and which would need
       real work. Name them.
    6. Which of the three walks the repo can already partly serve.
    Then propose the smallest implementation, walk by walk, and wait.

---

## Step 2 — Data

    trade_specs          account_id, name, spec jsonb (scope preset, systems
                         overrides, condition band, colour policy:
                         register|choose|brand, hours, segment defaults),
                         created_by, used_count. Replaces the flags JSON —
                         report what reads that JSON before removing it.
    building_profiles    property_id, account_id, segment, levels, units,
                         access_notes, compliance jsonb (induction, hours,
                         COC required), assigned_estimator_id, contacts jsonb,
                         documents[], measured_at, measured_by
    properties           + measured_tree jsonb (versioned), measured_at
                         Written by fix_price (C6). Read by rebook and by every
                         later quick look on that property.
    tenant_photo_links   property_id, token, expires_at, requested_by,
                         asked_for text[], uploaded_photo_ids[], status
    settings             + measured_tree_max_age_days (⚑56, default 365)

All RLS'd with the explicit `view=` contract: trade sees its own account's rows only; staff see all; contractors see none of this.

---

## Step 3 — Walk A · the agent

Screens A1–A4 in the prototype.

- **Account home.** "Waiting on us" first (quotes with the estimator, quotes ready to accept), then properties, then saved specs. The waiting list derives from `confirmation_requests` through the same evaluator C7b used — **no second list**.
- **New quote.** Address picker; a known property shows its file (last painted, areas measured, colours, access) and the line *"everything here carries into the quote — you'll only be asked what's changed"*. Spec tiles below. **Because the property is measured and the spec is saved, a range renders before the sheet is opened.**
- **The spec sheet.** The same tree as a grid: areas down, surfaces across, coat cells cycling 1c → 2c → not painted, each tap calling the **same reprice action the room card calls**. Colours default from the property's register.
- **Tenant photo link.** Token page, phone-first, no account. Photos pin to the property and become condition flags the estimator sees. The message text explaining who we are and that it has nothing to do with their bond is **customer-facing copy — propose it, tag it `copy:new`, and let Tom read it before it sends**.

**The parity test is the point of this walk:** the sheet and the guided room-by-room flow must produce identical trees for identical input. Assert it.

---

## Step 4 — Walk B · the OC manager, year two

Screens B1–B4. This is the walk with no prior design and the most value.

- **The building on file.** Areas from `measured_tree`, each showing size, surfaces and counts, with a green measured marker. **The facade row renders as *not measured · visit needed*** — outside is never ranged, even on a measured building (⚑53). Beside it: colours, access and compliance, contacts, documents, history.
- **Pick the areas.** Tick from the file; sizes, surfaces and door counts come with them. The sub-line says when each was last painted (⚑54).
- **What's changed since we measured.** *Nothing's changed* is the prominent default. The tick list is the proposal in the prototype — **⚑55, flag it, do not treat it as final.** What each answer does to routing is the part that must be built exactly:
  - nothing changed → priced from the file, `±5%`, remote confirmation eligible
  - damage, new work, or something added or removed → same measurements, band widened, photos requested, estimator decides
  - **water damage → always a visit**, no range shown for the affected areas
  - colours changing → the colour question, register no longer the default
  - access or contacts changed → building profile flagged for update, `site_checklist_items` raised
- **The range.** Same sheet, same engine, with a provenance block: *measured Sep 2025 · nothing reported changed · last year's rate +3.1%* (⚑58). "Draft a scope of works" is a **stub** — ⚑28 keeps the document itself deferred.
- **Staleness.** If `measured_at` is older than `measured_tree_max_age_days`, the file still seeds the tree but the band widens and the screen says why (⚑56).

---

## Step 5 — Walk C · the franchise

Screens C1–C3.

- **Brand specs.** A spec carries colours from a brand register, a kitchen system, hours and a condition band. The spec detail card shows what a new site inherits.
- **A new site.** Three questions only — front-of-house size bracket, ceiling type, back-of-house extent — with everything else shown as *inherited from the spec · not asked again*. **No glass question** (the 10 Sep ruling; grep the diff).
- Exposed ceilings price as a flagged, unpriced line and widen the band (⚑60), and the screen says so.
- "Compare with your last fit-out" lists the account's recent comparable jobs.

---

## Step 6 — Gates that apply to all three

- Range shows immediately; there is **no reveal ceremony** in trade mode.
- **Trade never sees fix-online** (⚑11). Every trade quote goes to confirmation. Assert it.
- Commercial trade quotes still obey the segment routing from C12–C14: outside and both go to a brief and a booking, not a range.
- Every screen reaches the assigned estimator by name, from the staff record.

---

## Acceptance

- The spec sheet and the guided flow produce identical trees for identical input (parity test).
- A rebook from a measured property re-types nothing: the tree, colours and access all seed from the file.
- `properties.measured_tree` is written by `fix_price` and read by rebook — proved end to end: confirm a quote as staff, then start a new quote on that property and see the tree.
- Walk B end to end: pick areas → nothing changed → a range at ±5% → send. Then again with *water damage* ticked and assert **no range renders** for the affected areas and the outcome is a visit.
- The facade never renders a price on any measured building (test).
- No trade path reaches fix-online (test).
- `glass` appears nowhere in the diff.
- Colours default from the register on every walk; the collapse bug stays closed.
- A stale measured tree widens the band by the Settings value and says why.
- Unit count before and after; both compositions checked against the prototype, desktop at 1280px and phone at 430px.

**Tom's check:** on the phone — open Elm Grove, pick the level 1–3 corridors and the lift lobbies, say nothing's changed, and a range appears in under two minutes with nothing re-measured. Then tick water damage and confirm it stops offering a number.

---

## ⚑ Decisions

Carried from the prototype's Notes drawers. 53–61 are new.

| # | Decision | Default |
|---|---|---|
| 11 | Trade self-acceptance | Never. Every trade quote goes to confirmation |
| 12 | Trade default view | Spec sheet for a known property; guided for a new address |
| 34 | Measured tree stored at confirmation | Yes — it's the moat |
| 35 | Building profiles for trade accounts | Yes |
| 36 | Trade desktop: two panes, same components | Yes, proved in the prototype |
| 53 | Facade on a measured building | Never ranged. Visit, always |
| 54 | Show when each area was last painted | Yes — it's how a year-two conversation goes |
| 55 | **What can change on a strata building between years** | **Tom's ruling needed.** The prototype's list is a proposal |
| 56 | Measured-tree staleness | 365 days, Settings. Older still seeds, band widens, screen says why |
| 57 | Can the building manager answer "what's changed" instead of the OC manager? | Not in v1 — but design the answer so it can be delegated later |
| 58 | Show the rate movement since last year | Yes |
| 59 | Spec sheet on a phone | Grid scrolls horizontally; no stacked fallback in v1 |
| 60 | Franchise fit-out with a sprayed ceiling | Still ranged, wider band, ceiling flagged and unpriced |
| 61 | Who the tenant photo link goes to | The tenant directly; the agent sees what was sent |

---

## Reference files

    design/reference/trade-portal-v2.html            THE design — every screen, every ? drawer
    docs/briefs/estimator-journey-v2-plan.md         §8 (the three compositions, §8.3 measured trees), §9 (pricing correlation)
    docs/briefs/estimator-v2-delta-and-plan.md       §2.6 the qualified lead; C15's superseded block
    docs/briefs/customer-portal-experience-map.md    W2–W4, the trade workspace
    docs/briefs/claude-code-brief-c7b-estimates-home.md   the one-evaluator rule the home screen obeys
    CLAUDE.md

Ledger row on completion, naming which walks shipped and whether ⚑55 was still open.

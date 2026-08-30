# Colour register diagnostic — Session 0 of trade portal v2

**Date:** 30 Aug 2026 · **Brief:** `docs/briefs/claude-code-brief-trade-portal-v2.md` §3 · **Mode:** read-only, no code changed.
**Question:** why the portal's colour register doesn't show the colours actually used, why every property's colours land in one list, and why trade clients have no timeline.

---

## 1. The write path — where does a colour become "the colour used on this surface"?

There is **no table that records a colour against a surface at a property**. Colour identity lives in four places, none of which is a register:

### 1a. The estimate builder (staff) — the only place a colour NAME is authored pre-acceptance
- `app/quote/QuoteBuilder.tsx:328-335` — colours cascade like products: a global colour per surface type (`materialColours`), with a per-surface name override (`Surface.color`, `QuoteBuilder.tsx:92`). `colourFor(type, s)` resolves override → global.
- Persisted into `estimates.builder_state` (`materialColours`, per-surface `color`, `colourMatches`) on every save, together with a client-computed work-order document `builder_state.woDoc` (`QuoteBuilder.tsx:767`).
- **The lossy step:** `computeWorkOrderDoc()` builds the doc's `materials[]` with **one colour per product, first-resolved-wins** — `QuoteBuilder.tsx:1109` (`colourByProduct`), `1128-1129` (`if (col.name && !colourByProduct.get(pname)?.name)`), `1155-1163` (`colourName: col.name` onto the material row). Two rooms painted in different colours with the same product (e.g. Wash & Wear in Natural White *and* in a feature grey) collapse to the first colour encountered, keyed by **product name**.

### 1b. Acceptance / issue — the freeze
- Acceptance auto-creates the WO with `wo_snapshot = builder_state->'woDoc'` (`supabase/migrations/20260901000000_accept_creates_bookable_wo.sql:43,62`); `issue_work_order` re-freezes from the same source (`20260904000000_work_order_rpcs.sql:32`). After this, the snapshot's `materials[].colourName/colourHex/colourStatus` (`lib/workorder/snapshot.ts:13-15`) is what the portal will read forever. **Keyed by:** `work_orders.estimate_id` → `estimates.account_id`. No `property_id` is stamped anywhere on this chain, though `estimates.property_id` exists and is indexed (`20261128000000_customer_accounts.sql:150`).

### 1c. Post-acceptance colour changes — written, but never read by the register
- Staff set/confirm colours on the job sheet: `patchWorkOrder({ colours })` writes `work_orders.colours` = `{ [productName]: { name, hex, status } }` — a **direct client-side update under RLS**, `QuoteBuilder.tsx:1196-1203` (write) and `20260818000000_work_orders.sql:30` (column). This is where a colour-consult outcome actually lands.
- Painter/office supply match codes: `wo_set_colour_match` RPC → `work_orders.colours[product].match = {code, brand, canSize, by}` (`app/components/wo/colourMatchActions.ts:24-27`, card at `app/portal/jobs/[id]/page.tsx:357-367`).

### 1d. The pre-start tick and the painter's DONE tick — booleans only
- "Colour schedule finalised" is a `wo_checklist_items` row, `phase='pre_start'`, `item_key='colours'` (`20261013000000_wo_seed_checklists_fix.sql:23`). Since `20261101000000_wo_colours_manual_tick.sql` it is a person's plain tick. **It writes no colour data** — it's a gate.
- The painter's DONE tick flips `wo_surfaces.state` (`todo|prepped|done`) and stamps `state_changed_at` (`20260927000000_wo_loop_tables.sql:57-74`). **`wo_surfaces` has no product or colour columns** — the brief's "if the painter records a different product at tick time (check)" is answered: that mechanism does not exist. `state_changed_at` does give us applied-from/applied-to dates per surface group.

**Summary:** nothing ever writes "colour X went on surface Y at property Z". The register is *derived at read time* from a product-keyed aggregation frozen at acceptance.

## 2. The read path — what the portal Colours view queries

`app/account/(portal)/colours/page.tsx:14-21` → `getPortalAftercare(ctx.accounts.map(a => a.id))` (`lib/portal/data.ts:328-398`):

1. `estimates.select("id, title").in("account_id", accountIds).limit(100)` — **scoped by account, never property** (`data.ts:334-336`).
2. `work_orders.select("id, estimate_id, stage, wo_snapshot, colours").in("estimate_id", …).not("issued_at","is",null)` (`data.ts:341-344`).
3. `wo_checklist_items` pre-start ticks → `coloursFinalised` boolean per WO (`data.ts:370-377`).
4. `buildRegister(areas, materials, liveColours, coloursFinalised)` (`lib/portal/colours.ts:47-87`) — walks `wo_snapshot.areas[].surfaces[]`, joins each surface **to the snapshot material by product name** (`colours.ts:53,58`), shows `material.colourName` when confirmed, and takes only `match.code` from live `work_orders.colours` — **the type itself omits `name`** (`RegisterLiveColours`, `colours.ts:31-34`), so a colour renamed on the job sheet after acceptance can never surface here.

**Labelling:** rows are labelled by snapshot `area.title` + `surface.label` (real room/elevation labels exist), grouped **per job, per account** — one flat page, job title as the only grouping (`colours/page.tsx:44-46`). The trade nav doesn't even link it: `TRADE_TABS` = Home / Properties / New estimate / Money (`app/account/(portal)/AccountTabs.tsx:46-67`), and the trade portfolio view-model has no `property_id` anywhere (`lib/portal/portfolio.ts`).

That's also the timeline symptom's root: `TRADE_TABS` drops "My project", and `getPortalProject` picks **one** WO by stage precedence — single-job residential assumption.

## 3. Hypotheses

| # | Verdict | Evidence |
|---|---|---|
| H1 — portal reads estimate *preferences*, not the finalised schedule | **HELD (modified)** | There is no finalised-schedule entity to read. The register's colour names come from `wo_snapshot.materials` — the estimate's colours frozen at acceptance (`20260901…sql:62`). The pre-start tick only *unlocks display* of those frozen names (`colours.ts:63-66`); a colour actually decided at the consult and entered on the job sheet writes `work_orders.colours[product].name`, which the register never reads (`colours.ts:31-34,70-71`). |
| H2 — rows keyed to `account_id`, no `property_id` | **HELD** | `getPortalAftercare(accountIds)` → `estimates.in("account_id",…)` → WOs by `estimate_id` (`data.ts:334-344`). `estimates.property_id` exists (`20261128…sql:150`) but nothing in the colours chain touches it. All accounts' jobs render on one page grouped by job title (`colours/page.tsx:18-21,44`). |
| H3 — area/surface names dropped | **NOT HELD structurally, HELD for attribution** | Snapshot areas keep real titles and surface labels, and the register renders them (`colours.ts:55-74`). But the **colour** is resolved per product with first-wins (`QuoteBuilder.tsx:1128-1129`), so a per-room colour override is misattributed to every surface using that product — the room knew its colour; the register lost it. |
| H4 — TBC stored as placeholder string, shown as real | **NOT HELD** | TBC is honest: `colourName: null` renders "Colour to be confirmed" + amber chip (`colours.ts:39,62-66`; `colours/page.tsx:67-68`). It renders as register *rows*, though — the brief's amber consult *card* (§4.1) doesn't exist yet. |
| H5 — product and colour conflated; sheen missing | **HELD (modified)** | Fields are separate (`product` vs `colourName`, `snapshot.ts:13`), but colour identity is *keyed by product* (one colour per product per job) and **sheen is not a field at all** — it's regex-scraped from the product name for display (`sheenOf`, `colours.ts:90-93`). Coats are real (per surface). |
| H6 — materials aggregation used as the register | **HELD** | `buildRegister` joins surfaces to `wo_snapshot.materials` (the litres/ordering aggregation) as the colour source (`colours.ts:53,58,63`). What-was-ordered *is* the colour authority; what-went-on-which-wall is inferred through the product join. |

## 4. Root causes (three, not six)

1. **No colour fact table.** Colours are derived at read time from a frozen product-keyed aggregation; the moments that establish truth (colour consult → job-sheet edit, painter DONE tick) write to places the register can't or doesn't read.
2. **Colour keyed by product, not by surface group.** First-colour-wins at `QuoteBuilder.tsx:1128` destroys per-room colour before anything downstream can see it.
3. **Account-scoped reads.** The whole chain runs `account → estimates → WOs`; `properties` is never traversed, so multi-property clients get one merged list — and the trade shell has no per-property colours or timeline surface at all.

## 5. Proposed minimal migration for Session 1

One migration, `colour_records` exactly per brief §4.1, plus the org layer per §4.2:

```sql
create type public.colour_record_status as enum ('planned','applied','superseded');
create type public.colour_record_source as enum ('colour_schedule','wo_tick','staff_edit','historical_import');

create table public.colour_records (
  id            uuid primary key default gen_random_uuid(),
  property_id   uuid not null references public.properties(id) on delete restrict,
  account_id    uuid not null references public.accounts(id) on delete restrict, -- denormalised for RLS
  area_label    text not null,           -- from the WO doc grouping (elevation / room–surface-group)
  surface_type  text not null,           -- wall/ceiling/trim/door/… derived from surface codes
  brand         text not null default '',
  product       text not null,
  colour_name   text not null,           -- TBC is never a row (§4.1)
  colour_code   text not null default '',-- manufacturer code; painter match codes land here too
  sheen         text not null default '',
  coats         integer not null default 0 check (coats >= 0),
  swatch_hex    text,                    -- nullable; from colours catalogue / builder hex
  status        public.colour_record_status not null default 'planned',
  applied_from  date,
  applied_to    date,
  source_job_id uuid references public.work_orders(id) on delete restrict,
  source        public.colour_record_source not null,
  superseded_by uuid references public.colour_records(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index on public.colour_records (property_id, status);
create index on public.colour_records (account_id);
create index on public.colour_records (source_job_id);
alter table public.colour_records enable row level security;
-- policies: staff ALL; member SELECT via SECURITY DEFINER property-scope helper
-- (per CLAUDE.md: ownership tests in secdef helpers, never subqueries on RLS'd tables)
```

Org layer (same session): `accounts.org_kind` enum, `account_users.role/property_scope/approval_limit_cents`, `property_references`, `external_approvals`, `notification_prefs` — shapes as in brief §4.2.

**Write-path design consequence for Session 2** (from the traces above):
- `planned` rows are created when the pre-start `colours` checklist item ticks, reading **`work_orders.colours` (the job-sheet truth) merged over `wo_snapshot.materials`**, grouped by area — this is the "finalised schedule" the brief assumes, assembled at the only moment a human vouches for it. That ends the first-colour-wins loss for new jobs (per-surface estimate overrides should be threaded into the WO doc materials as part of Session 2; today they die at `QuoteBuilder.tsx:1128`).
- `applied` flips from `wo_surfaces` DONE ticks matched by area heading, dates from `state_changed_at`. There is no record-different-product-at-tick mechanism to honour (it doesn't exist); painter match codes via `wo_set_colour_match` update `colour_code` and log to `wo_events`.
- **Backfill attribution risk:** rows need `property_id`; `estimates.property_id` is only populated where linking ran (self-linking since `de75a34`, 27 Aug). Older closed jobs must attribute via `properties.address_norm` ↔ estimate address (`lib/accounts/identity.ts` `addressKey`); jobs whose estimate has neither will be reported as unattributable, per the Session 1 acceptance rule.

## 6. Corrections to the brief while we're here

- §2 cites `lib/invoicing/attention.ts` — **does not exist**. The attention-queue shape to reuse is `AttentionItem` in `lib/portal/portfolio.ts:30-36` (one primary CTA per card), plus the PC console's ranking rules in `lib/workorder/console.ts`.
- §2 cites work-order "brief v4" — no v4 exists; the newest WO spec is the **v3 addendum** (§4b in `claude-code-brief-wo-loop-pc-command.md`). The stage enum has **seven** values (`offered → pre_start → in_progress → qa → completion_prep → walkthrough → closed`); the customer-facing rail shows six because `completion_prep` folds into "On site".
- The residential timeline component to reuse (§5.3) is `/account/project` + `lib/portal/timeline.ts` (pure view-model over `wo_events`/`wo_updates`/`wo_photos`) — it is coupled to a single-property, one-current-job assumption via `getPortalProject`'s stage-precedence pick, so Session 4's "extract to a shared location" clause applies.

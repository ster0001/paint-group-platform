# Build brief — room-loop capture mode (on-site estimating)

**Target repo** `github.com/ster0001/paint-group-platform` · Next.js 16 App Router · TypeScript · Tailwind · Supabase
**What it is** A capture mode layered over the existing estimate builder: pick a room, measure it once, one-tap every surface in it, save and move to the next room. Designed from Tom's workflow spec, 17 Aug 2026.
**Target** A 12-room interior in **~80 taps / under 15 min on site**, against ~220–250 interactions in PaintScout for job #3108.

---

## 0. The two rules

**1. The area/surface tree is unchanged.** Capture mode is a different *way in* to the same data. A room built in capture mode is byte-identical to one built in the existing builder: an area with surfaces beneath it. The work order derives exactly as it does today.

**2. Capture mode must not change any price.** Same room, same surfaces, same measurements → identical total to building it the old way. This is a test, not an aspiration (§11).

| Component | Change |
|---|---|
| `areas` / `surfaces` shape | **none** |
| Work order derivation | **none** |
| Pricing engine | **none** — capture calls it, doesn't reimplement it |
| Customer estimate view | **none** |
| Rate card | **none** — tiles are a *view* over `rate_items` |
| Existing builder | unchanged, still the desk tool |

---

## 1. Screens and the loop

Four states. Capture mode owns the first three; the fourth is the builder you already have.

```
                    ┌──────────────────────────────────────────┐
                    │                                          │
              pick  ▼                                          │
  ┌──────────────────────────┐   done    ┌──────────────────┐  │
  │      1. AreaPicker       │──────────▶│   2. Capture     │  │
  │  room / area name grid   │           │  measure + tiles │  │
  └──────────────────────────┘           └──────────────────┘  │
       │           ▲                        │          │       │
       │           │  next room             │ done     │ next  │
       │           └────────────────────────┼──────────┘ room  │
       │                                    ▼                  │
       │  finish                 ┌──────────────────┐          │
       │                         │  3. RoomReview   │──────────┘
       │                         │  prep time, edit │
       │                         └──────────────────┘
       ▼
  ┌──────────────────────────┐
  │  4. Estimate document    │  ← the existing builder, untouched
  └──────────────────────────┘
```

**Transitions**

| From | Action | To | Side effect |
|---|---|---|---|
| AreaPicker | pick a new name | Capture | new `RoomDraft` in local state |
| AreaPicker | tap an already-captured room | Capture | loads that room's draft, selections intact |
| AreaPicker | Finish | Estimate document | flush all pending writes |
| Capture | **Done** | RoomReview | commit room |
| Capture | **Next room** | AreaPicker | commit room |
| RoomReview | **Next room** | AreaPicker | commit room |
| RoomReview | Back | Capture | same room, selections intact |
| any | Exit | Estimate document | flush |

The **AreaPicker is the hub**, and it must show progress: each already-captured room appears with its surface count and dollar value, tappable to re-enter. That single detail is what makes the loop feel safe — you can always see what you've done and get back into it.

---

## 2. AreaPicker

A grid of name tiles, plus a search field and `+ Custom name`.

- The name list is **driven by estimate type** — interior gives Kitchen, Lounge, Bed 1–4, Bath, Ensuite, Hallway, Stairwell, Laundry, WC, Garage, Study; exterior gives Front, Left Side, Right Side, Rear, Whole House, Fence, Deck, Garage. Same loop, different vocabulary. This is why Tom's spec saying "room **or area** name" matters — exteriors fall out for free.
- Names already used in this estimate show as **captured tiles** at the top: `Kitchen · 6 surfaces · $1,103`.
- Auto-increment repeats: tapping "Bedroom" a second time offers `Bedroom 2`.
- Source the list from a versioned Settings table (`area_name_presets`), so Tom edits it without a deploy.

---

## 3. Capture screen

Two blocks, no modals, no navigation away.

### 3.1 Measurements block (top, sticky)

```
┌─────────────────────────────────────────────┐
│  Kitchen                                    │
│  L [ 4.20 ] m   W [ 3.60 ] m   H [ 2.40 ]  │  ← H inherited, greyed until touched
│                                             │
│  perimeter  15.60 m  ✎     ceiling  15.1 m² │  ← derived, editable
│  + wall segment                             │
└─────────────────────────────────────────────┘
```

- `L` and `W` are the only required entries. Numeric keypad, `inputMode="decimal"`.
- **`H` is inherited from the storey, not typed per room.** Set once per storey on entering capture mode (default 2.40 m). Shown greyed as inherited; touching it overrides for this room only and marks it. On a 12-room house this saves 11 number entries and removes the most common typo.
- **Perimeter is derived and shown, not hidden.** Default `2(L+W)`, displayed as an editable value. This is the fix for the silent-inheritance problem: the number that drives your largest surface is visible.
- `+ wall segment` appends a length for L-shaped rooms, nibs, bays and chimney breasts. Perimeter becomes `2(L+W) + Σ segments`, and the room is marked `irregular` so the plausibility check (§9) doesn't fire spuriously.

### 3.2 Tile grid (below)

Same visual box treatment as the AreaPicker tiles — Tom's spec calls for this and it's right, because it makes the loop read as one continuous gesture.

```
┌────────────────┐ ┌────────────────┐ ┌────────────────┐
│ Walls        ✓ │ │ Ceiling      ✓ │ │ Cornice      ✓ │   ← pre-selected (core)
│ 15.6 m²        │ │ 15.1 m²        │ │ 15.6 m         │
└────────────────┘ └────────────────┘ └────────────────┘
┌────────────────┐ ┌────────────────┐ ┌────────────────┐
│ Skirting     ✓ │ │ 4 Panel Door   │ │ Cupboard Door  │
│ 14.8 m         │ │ + Frame     ②  │ │             ④  │   ← badge = quantity
└────────────────┘ └────────────────┘ └────────────────┘
┌────────────────┐ ┌────────────────┐ ┌────────────────┐
│ Sash Window ①  │ │ Splashback   ⊘ │ │ + more surfaces│
└────────────────┘ └────────────────┘ └────────────────┘

                     [ Done ]   [ Next room → ]
```

Each tile shows: label · state · the **live derived quantity** for measured surfaces, so the estimator sees `15.6 m²` appear the moment they enter L and W. That immediate feedback is what makes the measurement entry feel verified rather than hopeful.

---

## 4. Tile semantics — the quantity model

**This is the most important detail in the build.** Tom's spec taps a tile once per item ("4 panel door and frame, 4 panel door and frame"). Implement that as **increment, not duplicate.**

| Tile kind | Tap | Second tap | Decrement |
|---|---|---|---|
| **Measured** (walls, ceiling, cornice, skirting) | toggle on, quantity derived | toggle off | — |
| **Countable** (doors, windows, cupboard doors, posts) | count 1, badge `①` | count 2, badge `②` | long-press, or `−` on the badge |
| **Exclusion** (splashback, feature wall) | mark excluded `⊘` | clear | — |
| **Manual** (odd items) | opens a small inline quantity field, no page change | — | — |

**Why increment matters:** four taps on Cupboard Door must produce **one** surface row at qty 4 — `Cupboard Door ×4` — not four identical rows. You already have the failure mode in production to point at: estimate #3059 reads *"Picket Fence, Picket Fence"*, and my PaintScout test area came out as *"…Fascias, Gutters, Windows (12), Doors (3), Pressure wash / Fascias"* with a duplicate. Duplicated rows make the customer document look careless and make the work order harder to read on site.

Long-press also opens a **per-tile detail sheet** (not a new page) for the occasional case needing coats, a manual override or a note during capture. Keep it rare — the second pass (§6) is where that work belongs.

---

## 5. Room-type presets — the biggest tap saving

When a room opens, its **core surfaces are already selected**. The estimator only taps what varies.

Reuse the same Settings table the AI plan reader uses — one table, two features:

```sql
-- room_type_scope_rules, already specced in the AI reader brief
version · room_type · rate_item_id · default_on · countable · tile_group · sort_order
```

Seed:

| Room type | Pre-selected | Offered, not selected |
|---|---|---|
| bedroom, living, dining, study | walls · ceiling · cornice · skirting | doors · windows · robe doors · mantle |
| kitchen | walls · ceiling · cornice · skirting | cupboard doors · pantry door · splashback *(exclusion)* |
| bathroom, ensuite, wc, laundry | walls (wet-area product) · ceiling · cornice · skirting | door · window · vanity |
| hallway | walls · ceiling · cornice · skirting | doors ×n · architraves |
| stairwell | walls · ceiling · cornice | skirting · balustrade · handrail — **height confirm required** |
| garage | — *(nothing pre-selected)* | walls · ceiling *(if lined)* · garage door |
| exterior elevation | cladding · eaves · fascia · gutter | downpipes · windows · doors · barge · pressure wash |

**Effect on the tap count.** A bedroom under Tom's original spec: name (1) + L, W, H (3) + walls, ceiling, cornice, skirting, door, window (6) + done (1) = **11**. With presets and storey height: name (1) + L, W (2) + door, window (2) + next room (1) = **6**. Across twelve rooms that is 60 taps saved.

Tile ordering matters as much as pre-selection. Without room-type ordering you'd show 30+ tiles in every room and reintroduce the searching this design exists to remove. Group order: `core → openings → joinery → extras → + more surfaces`.

---

## 6. RoomReview — the second pass

`Done` opens the description view **scoped to the room just captured**, showing its surface rows with hours and price.

Per row, one tap to add:

- **Extra prep time** — a stepper in 0.25 hr increments, plus the defect chips from the AI reader brief (`peeling · water damage · plaster cracks · holes/dents · previous poor finish`) if you want the reason recorded on the work order. Each becomes its own named prep line carrying hours, so margin stays honest.
- **Coats** — default 2, changeable here (real jobs need it; #3108 has walls at 1 coat).
- **Note to crew** — free text, flows to the work order.
- **Hide from customer** — you already have this.

Then `Next room →` or `Back to tiles`.

**Deliberately absent from capture, handled elsewhere:**

| Thing | Where it lives |
|---|---|
| Product / paint brand | your Materials section — change once, cascades to that surface type across all areas |
| Colour selection | estimate level, or deferred |
| Level of finish | estimate level, one tap |
| Exclusions text | estimate level chips |

Keep these off the capture screen. Every field added there costs a tap in every room.

---

## 7. Persistence — continuous locally, batched to the server

A naive implementation writes on every tap: 80 taps becomes 80 round trips on suburban 4G. Wrong. But saving only on "next room" (Tom's step 7) loses the current room in a crash — which is the exact PaintScout failure worth eliminating.

Do both:

1. **Every state change writes to IndexedDB immediately**, keyed by `estimateId`. Crash-safe to the last tap, works with no signal.
2. **Server sync is debounced** — 3 s idle, plus a forced flush on `Done`, `Next room` and `Exit`.
3. **One batched upsert per room**, not per surface. A room commit is a single call carrying the area and all its surfaces.
4. **Sync state is always visible** in the header: `saved · synced` / `saving…` / `offline · 3 rooms queued`.
5. **On reopening capture mode**, if IndexedDB holds newer state than the server, offer to restore it. Never silently discard.

Bad reception is the normal case on site. Treat offline as the default path, not the error path.

---

## 8. Data model

**No changes to `areas` or `surfaces`.** Additions are metadata only:

```sql
alter table areas
  add column captured_via text default 'builder',   -- builder | room_loop
  add column room_type text,                        -- drives preset + review-queue rules
  add column perimeter_m numeric,                   -- the derived-or-overridden value, made explicit
  add column perimeter_overridden boolean default false,
  add column irregular boolean default false,
  add column storey text default 'ground';

alter table estimates
  add column storey_heights jsonb default '{"ground":2.40}'::jsonb;

create table area_name_presets (
  id uuid primary key default gen_random_uuid(),
  version int not null,
  estimate_type text not null,     -- interior | exterior | commercial
  name text not null,
  room_type text not null,
  sort_order int not null default 0
);
```

`room_type_scope_rules` is already in the AI plan reader brief — build it once, both features consume it. Load its rows over the API, not by pasting SQL.

**Client types:**

```ts
type SurfaceTile = {
  id: string
  rateItemId: string
  label: string                    // client-facing, e.g. "4 Panel Door + Frame"
  tileLabel: string                // short, for the box
  measureBasis: 'wall_area' | 'ceiling_area' | 'perimeter' | 'perimeter_less_doors'
               | 'per_item' | 'manual_m2' | 'manual_lin'
  group: 'core' | 'openings' | 'joinery' | 'extras'
  defaultOn: boolean
  countable: boolean
  sortOrder: number
}

type RoomDraft = {
  localId: string
  areaId?: string                  // populated after first sync
  name: string
  roomType: string
  storey: string
  lengthM: number
  widthM: number
  heightM: number
  heightInherited: boolean
  extraWallSegments: number[]
  perimeterM: number
  perimeterOverridden: boolean
  irregular: boolean
  selections: Record<string, number>       // tileId → count (0 = not added)
  exclusions: string[]                     // tileIds marked ⊘
  prepHours: Record<string, number>        // tileId → extra hours
  coats: Record<string, number>            // tileId → coats, absent = default 2
  crewNotes: Record<string, string>
  status: 'capturing' | 'complete'
}
```

**Quantity resolution** — one pure function, exhaustively tested:

| `measureBasis` | Quantity |
|---|---|
| `wall_area` | `perimeter × height − openings_deduction` |
| `ceiling_area` | `L × W` |
| `perimeter` | `perimeter` |
| `perimeter_less_doors` | `perimeter − Σ(door_width × door_count)` |
| `per_item` | `count` |
| `manual_*` | as entered |

**`openings_deduction` defaults to 0.** Your current quotes don't deduct, so leaving it at 0 keeps prices identical. Put it behind a Settings toggle with per-opening defaults (door 1.70 m², window medium 1.50 m²) and leave it **off** until you decide to change pricing deliberately.

---

## 9. Validation — visible, never silent

Run on `Done` / `Next room`. Warn, never block.

| Check | Rule |
|---|---|
| Missing measurements | `L` and `W` present and > 0 |
| Perimeter plausibility | `P²/A` between 14 and 30 — skipped when `irregular` |
| Size sanity | 1.2 m² ≤ ceiling area ≤ 80 m² residential |
| Empty room | at least one surface selected |
| Suspicious count | any countable > 12 in one room → confirm |
| Height override | flag rooms where `H` differs from the storey |
| Duplicate name | two areas with the same name |

Surface these as a small warning strip on the room tile in the AreaPicker, so you can see at a glance which rooms want a second look.

---

## 10. Files

```
app/estimates/[id]/capture/
  page.tsx                     # shell, storey height prompt, sync indicator
  _components/
    AreaPicker.tsx
    CaptureScreen.tsx
    MeasurementBlock.tsx
    TileGrid.tsx
    SurfaceTileBox.tsx          # badge, toggle, long-press sheet
    TileDetailSheet.tsx
    RoomReview.tsx
    LiveTotalBar.tsx            # total · hours · GP, persistent
    SyncIndicator.tsx
lib/capture/
  quantities.ts                # measureBasis → quantity. pure. heavily tested.
  presets.ts                    # room_type_scope_rules → tile list, ordered
  draft-store.ts                # IndexedDB, debounce, flush, restore
  commit.ts                     # RoomDraft → area + surfaces payload
app/api/estimates/[id]/rooms/
  route.ts                      # POST batched room upsert, zod, server-side repricing
lib/pricing/                    # extracted from QuoteBuilder — prerequisite
```

**Prerequisite:** `lib/pricing/` must come out of `QuoteBuilder` first (audit finding S7). Capture mode needs to price a room without mounting the builder, and the batched room route must reprice server-side rather than trust client amounts. Do that extraction as step 1 — it's the same prerequisite the AI plan reader has, so it pays for itself twice.

---

## 11. Tests that must exist

1. **Parity.** Build a room in the existing builder; build the same room in capture mode. Assert identical surface rows, hours and total. This is the guard on rule 2.
2. **Reprice #3108 and #3140** to their current values after the pricing extraction — before capture mode is wired at all.
3. **Quantity resolution** — table-driven across every `measureBasis`, including `irregular` and extra wall segments.
4. **Badge → single row.** Four taps on a countable tile produce one surface at qty 4, never four rows.
5. **Crash recovery.** Kill the tab mid-room; reopen; the room restores from IndexedDB with selections intact.
6. **Offline queue.** Capture three rooms with the network down; restore it; assert all three sync exactly once with no duplicate areas.
7. **Storey height inheritance,** including per-room override not leaking to siblings.

---

## 12. Phases

| Phase | Build | Gate |
|---|---|---|
| **C0** | Extract `lib/pricing/` · batched room API route with zod · server-side repricing | #3108 and #3140 reprice identically |
| **C1** | AreaPicker + Capture screen + tile grid + quantity resolution. Local state only, no persistence. | parity test passes on 3 room types |
| **C2** | Room-type presets from `room_type_scope_rules` · tile ordering · `+ more surfaces` | a bedroom completes in ≤ 6 interactions |
| **C3** | Badge/quantity model · exclusion tiles · long-press detail sheet · undo | badge → single row test passes |
| **C4** | IndexedDB draft store · debounced sync · offline queue · restore prompt | crash and offline tests pass |
| **C5** | RoomReview: prep steppers · defect chips · coats · crew notes | prep lines carry hours into the work order |
| **C6** | Live total bar · validation strip · AreaPicker progress values | — |
| **C7** | Exterior vocabulary via `area_name_presets` | a weatherboard exterior completes in ≤ 40 interactions |

C1–C3 is the substance. C4 is the one you cannot skip — it is the difference between a tool you trust on site and one you don't.

---

## 13. Instrument it from day one

Log per estimate: `taps`, `time_in_capture_ms`, `rooms_captured`, `rooms_reopened`, `validation_warnings`, `offline_ms`, `captured_via`.

Targets to hold:

| Job | PaintScout today | Target |
|---|---|---|
| Interior, 12 rooms (#3108) | ~220–250 | **~80 taps / < 15 min** |
| Bedroom, single | ~15 | **6 interactions** |
| Exterior weatherboard | ~150 | **< 40 taps / < 8 min** |

`rooms_reopened` is the quality signal worth watching most closely — a high rate means the tile set or the presets are wrong for that room type, and it tells you which one to fix.

---

## 14. Edge cases

| Case | Handling |
|---|---|
| Raked / cathedral ceiling | per-room height override, flagged; ceiling area needs manual m² |
| Stairwell | height override mandatory, access allowance offered |
| Two-storey | storey selector in the header; `storey_heights` holds one height per level |
| L-shaped room | `+ wall segment`; `irregular` exempts the plausibility check |
| Same room name twice | auto-suffix `Bedroom 2`, warn on exact duplicates |
| Room with nothing to paint | allow an empty area with a note, or don't create it — prompt, don't guess |
| Mid-room interruption (client talks) | state is already persisted; no timeout, no auto-advance, ever |
| Estimate spanning interior **and** exterior | one estimate, both vocabularies available; charge-out is already per-line from the rate item's category |
| Re-entering a completed room | loads the draft with selections intact; never resets |
| Rate item retired after capture | area keeps its snapshot; flag on reopen |

---

## 15. First commit

1. `lib/pricing/` extracted from `QuoteBuilder`, with the #3108 / #3140 reprice test green.
2. `lib/capture/quantities.ts` — the pure resolver, plus its table-driven test.
3. `POST /api/estimates/[id]/rooms` — zod-validated batched upsert that reprices server-side and refuses client-supplied amounts.
4. `AreaPicker` and `CaptureScreen` rendering from a hardcoded tile list, local state only.

That gets the maths and the boundary right before any of the interaction polish, and the parity test in step 1 is what lets you trust the whole thing afterwards.

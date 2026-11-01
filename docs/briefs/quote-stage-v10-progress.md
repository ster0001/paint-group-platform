# Quote stage v10 — progress ledger

**Read this first in every session. Update it last.** One row per session from `claude-code-brief-quote-stage-v10.md` §9. The prototype `design/reference/wizard-quote-stage-v10-prototype.html` wins over the brief's text. Prices in it are placeholder maths; `lib/pricing/**` is untouched throughout.

Gates: `npx tsc --noEmit`, `npx eslint --max-warnings 4 .`, `npm test`, the named Playwright specs through `./scripts/c1/run-e2e.sh` (one worktree at a time; if the lock is held, wait once and report), a 1470px desktop diff where the desktop is meant to stay still, help + ARCHITECTURE + this ledger, a PR for Tom with reused / extended / removed (R0). Every session's PR lists what it reused, what it extended, and what it removed.

## Sessions

| Session | What | Status | Date | Branch / PR | Reused / extended / removed | ⚑ touched | Next session should know |
|---|---|---|---|---|---|---|---|
| S0 | Orientation: the scope page's questions mapped to the §3 cards, the picture components, the floorplan read (D-Q1), the photo storage adapter | DONE — report below | 2 Nov 2026 | `feat/quote-stage-v10` off main 74f27408 (brief + prototype committed; no code) | — | **D-Q1 answered: NO coordinates** → the list fallback | Read "S0 — the map" below before writing a card. The old scope page is `app/estimate/scope/` (4,481 lines across 22 files); the v10 stage is a NEW route `/estimate/quote` on the v5 phone shell, reusing the editor's server actions one for one. |

## S0 — the map (2 Nov 2026)

**Where the answers go today.** Both editors (`app/estimate/scope/ScopeEditor.tsx`, `SidesEditor.tsx`) POST `{...action, view: "customer"}` (or a batch of 1–24) to `app/api/estimates/[id]/wizard-edit/route.ts` (the zod `actionSchema` union at :187); the server rebuilds the lines and re-prices, and the client computes nothing. The v10 cards keep that contract — every card writes an EXISTING action (R0, R3):

| §3 card | The scope page today | Action(s) it writes |
|---|---|---|
| A1 Do you have cornices? | `detailSteps` "Do you have cornices?" + "Standard or decorative?" (ScopeEditor :749/:760) | `set_cornices none / standard / decorative` (two taps today → one card with No / Standard / Decorative) |
| A2 Ceiling height | "Ceiling height — approximate is fine" (:805, only when `heightUnconfirmed`) | `confirm_height` (sets every room; a room's own `room_dims heightM` overrides) |
| A3 Doors panelled / flat | `DoorTiles` (:771, `StyleTiles.tsx`) | `set_door_style` |
| A4 Window type | `WindowTiles` + `WINDOW_DRAWINGS` (:776) | `set_window_style casement / sash / colonial / winder` |
| A5 Water / oil on the trims | (:781) | `set_paint_system field: paintBase` water / oil / unsure |
| — "What was the woodwork last painted in?" | (:793) — **in the live inventory, not in §3** | `set_paint_system field: glossTrims` yes / no / unsure — KEPT (R3), as A5's second half |
| A6 Living there | site access (:917) | `set_site_access` |
| A7 Rooms cleared | site access (:917) Yes / Mostly / Furniture stays | `set_site_access` |
| A8 Stairwell or void | site access (:917) | `set_site_access` |
| — Parking (Driveway / Street / Tricky), lift | site access (:917) — **live, not in §3** | `set_site_access` — KEPT (R3), one card after A8 |
| — Garage on the plan: painting it? | `lastSteps` (:819) when the plan shows one | `set_garage` — KEPT, asked with the room list |
| B1 How big is {room} | "Is this room about {size}?" L / W / ceiling inputs, Looks right | `room_dims {lengthM, widthM, heightM}` on blur; `room_size_ok` = "Not sure — use the typical" |
| B2 What we're painting in here | surface tiles, steppers, door scope, wall share, window groups, catalogue, custom | `toggle_surface` / `room_remove_line`, `set_count` / `room_line_count`, `room_door_scope`, `walls_share 100/75/50/25`, `room_win_size S/M/L`, `room_add_window_group`, `room_add_catalogue`, `room_custom` |
| B3 Robes / cupboards | `loop.cupboard.question` (REQUIRED), interior, door inside (:1366–1440) | `room_cupboard {on, count}`, `room_cupboard_interior`, `room_cupboard_door_inside` |
| B4 Anything needing attention | `RoomSpots` (tag, extent, severity, photo, note) + `RoomExtras` (feature wall / wallpaper / other) | `add_spot {tag, extent, severity, sourceId, note}` / `remove_spot`; `room_extra kind` |
| C per side | `SidesEditor`: dims, counts, condition, note + photos | `side_dims` / `side_size_ok`, `side_count`, `loop_cond`, `side_note`, `confirm_side` |
| D Doors & trims | the same room lines, counts only | `set_count` / `room_line_count` |
| E1 Every room? | "Please check all rooms have been listed" + add-room form, hallway nudge | `iloop_check_done item: sweep`, `add_room {roomType, name, lengthM, widthM}`, `remove_room`, `rename_room` |
| E2 Anything we haven't listed | `JobExtras` grouped toggles, colours, free text; `iloop_sweep` chips | `toggle_job_extra code, on, count`, `set_colour_help`, `extra_note`, `iloop_sweep add` |
| — "N doors and M windows across the house — right?" | `lastSteps` (:819) | `iloop_check_done item: dw` / `iloop_dw ok:false` — KEPT, on E1 |
| F Done | `complete` → `useAutoSend` sends the estimate; `FinalisePrompt`, `AllDoneBanner` | the same `useAutoSend`; the door = Contact's Book a visit |

**The line model (reused as is).** The draft's `state.blocks` (`lib/wizard/customer-scope.ts:125`, `LooseBlock[]` in `rooms-loop.ts:29`): one block per room, its `surfaces[]` the lines. Views: `CustomerScopeRoom` / `CustomerTile` (`lib/wizard/scope-editor.ts:63 / :25`), `RoomLoopView` (`rooms-loop.ts:422`: `lengthM, widthM, heightM, size, confirmed, cupboard*, windows[], customs`), `InteriorLoopMeta`; exterior `SidesView` (`lib/wizard/sides.ts:881`). `CustomerPayload` (`lib/wizard/view.ts:82`). `loadCustomerScope` (`customer-scope.ts:122`) returns `holding | sides | rooms` — the v10 route loads the same bundle.

**The range (D-Q3).** `BandSettings` / `DEFAULT_BANDS` (`lib/wizard/policy.ts:80/:94`: tight 90 % → ±4, mid 70 % → ±8, wide ±15, guide spread cap 40 %), `rangeBandPct`, `rangeFromTotal` (:139, rounded outward to $10). Tiers `lib/wizard/ladder.ts:44`. The envelope (`lib/wizard/envelope.ts:71`: `loCents, hiCents, bandPct, open[], confirmedShare, closesCents`). **There is no per-line uncertainty anywhere** — the nearest is per-room `roomConfidencePct` (`lib/wizard/accuracy.ts:82`, surfaced as `confidencePct`) and per-question `openClosesCents`. So the quote document's per-line amounts and the band's "settled %" read `confidencePct` / `confirmedShare` and the engine's range; the prototype's 22 / 12 / 4 % are NOT built into the UI (D-Q3 is the engine team's).

**D-Q1 — the floorplan read returns NO positions.** `lib/extract/schema.ts:69` `roomSchema`: `name_on_plan, normalised_type, storey, length_m, width_m, dimension_source, dimension_confidence, area_m2_printed, irregular, cornice, doors[], windows[], openings_no_door, wet_area, notes_read_from_plan` — no coordinates, polygons or boxes; `PlanMap.tsx` lays rooms out synthetically by typical m². **Ruling by the brief's default: the plan tile shows the plan IMAGE (`planPreviewUrl`) with the ticked room list beside it; no overlay; tap-to-jump from the list.**

**Photos (D-Q5).** The adapter is three calls: `POST /api/extract/upload-url {files}` (1–5 files, ≤ 25 MB, signed URLs on bucket `estimate-sources`), `supabase.storage.uploadToSignedUrl`, `POST /api/extract/photos {uploads, estimateId}` (≤ 12, sniffed, re-stored as `condition/<ts>-<id>.<ext>`, an `estimate_sources` row `kind: defect_photo` + label). `PhotoDrop.tsx` is the input wrapper; `PeelingPhotos`, `RoomSpots`, `SideNote` do the calls. The brief's 3-per-room / 5 MB is a UI limit over this adapter.

**Pictures (R5).** `RoomPicture` (`app/wizard/pictures/RoomPicture.tsx:28`: `painted[], bold, today, condition, occupied, swatch, highlight`; surfaces walls / ceilings / cornices / skirting / architraves / doors / windows; base + clipped painted layers, `useRollerSweep`) — **no doors / windows counts, no robe, no wall share, no prep marks yet**: S4 extends it. `MobilePicture` (200 × 120 room or house). `Elevation` (sweep mode, `onPart`) for the sides. `rollerSweep.ts useRollerSweep(keys, on, full, height, query?)` is the one sweep.

**Events (§7).** `lib/crm/events.ts` `CRM_EVENT_SCHEMAS` (:34) + a label in `lib/crm/timeline.ts`; browser events also need `WIZARD_EVENT_SCHEMAS` + `wizardEventBodySchema` (`lib/wizard/wizardEvents.ts:27/:40`) and a `keyFor` case in `app/api/wizard/event/route.ts:27`; no migration.

**Not rendered by the scope page** (candidates for removal in S7): `ReachStrip` (used by `/estimate/book`), `ContactCard` (used by `/estimate/finish`), `SiteAccess.tsx` (its questions are inline in ScopeEditor :917).

**Conflicts to rule** (⚑, taken by default here): (a) the live inventory has four questions §3 does not list (woodwork last painted in, parking, lift, the garage) — kept (R3), one card each where they fit; (b) §3 A1 is two questions today — one card with three options; (c) **the exterior walk-around built on the phone on 30 Oct (exterior mobile v5 S6) is superseded by §3 C's side cards on `/estimate/quote`** — the phone's "Get my exact price" on an outside job will route to the quote stage once the flag is on, and `MobileWalk` goes with the old scope page in S7; (d) R1 renames the gate button "Get my detailed price" on both widths and the stage "your detailed price" — the "exact" words in `MobileGate` / `MobileWalk` / `Reveal` change when the flag is on.

## Rulings log
| Date | Ruling |
|---|---|
| 2 Nov | D-Q1: no coordinates in the plan read → plan image + ticked room list, tap-to-jump from the list (the brief's default). |

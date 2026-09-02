# Claude Code brief — AI plan reader (v2-REGEN)

**Status:** REGENERATED 1 Sep 2026 from recorded rulings — the original v2 brief was produced in chat but never committed. Sections marked RECORDED are Tom's standing rulings and must not be re-asked. Sections marked RECONSTRUCTED are best-effort gap-fills — confirm with Tom before relying on them in S5+. **If the original file is ever found, the original wins.**
**Commit to:** `docs/briefs/claude-code-brief-ai-plan-reader.md` · **Module:** plan-reader (wizard + portal + assistant all consume it)

---

## 1. Purpose

Read an uploaded floorplan and pre-fill the interior estimate tree — rooms, sizes, doors, windows — so the customer confirms instead of measures. The reader proposes; it never prices, never confirms itself, and never fails silently.

## 2. Standing rulings — RECORDED, do not re-ask

1. **Interior only. Exactly one floorplan per estimate.** Exterior uses facade photos, not plans.
2. **Provenance vocabulary** (used platform-wide — cost capture and the assistant already reuse it):
   `ai_extracted` (the model read it) · `derived` (computed from an extracted value, e.g. wall area from L×W×height) · `assumed` (typical-default fill-in) · `human_confirmed` (a person said or confirmed it). Only humans set `human_confirmed`. The confirm-loop editors and the assistant's sweep are what upgrade provenance.
3. **Review queue ordered by $ impact, with a $150 gate.** Extracted values whose plausible error moves the price by ≥ $150 must be confirmed by a human (customer in the confirm-loop, or staff) before the estimate can be accepted; below $150 they may ride as `ai_extracted` into the range.
4. **Fail loudly, never to $0.** An unreadable plan, an unparseable room, or a low-confidence extraction renders as an uncertain/blocked state in the flow — it never becomes a silent zero or a silently guessed number. (Same law as cost capture.)
5. **Escalation stops apply** — anything on the plan suggesting heritage, structural work, or non-paint trades is out of scope: noted, excluded explicitly, routed to the visit tier.
6. **Residential limit: 2 plan-reader sessions per account**, then the friendly office-unblock path (phone + "request unlock" button → PC task). Trade/commercial: unlimited, full reader. This is the AI cost gate as well as the funnel rule (portal brief §3).
7. **Uploads go through the remediated upload path** (validation server-side; originals stored once; the model reads from storage, the browser never posts a file to the model).
8. **Extraction is model-read, not template-read** — per-field confidence, no layout templates to train or break.

## 3. Pipeline — RECONSTRUCTED ⚑R1 (states and names to confirm)

`uploaded → processing → extracted → needs_review → applied | failed`

- **Extract:** rooms (name/type), dimensions where printed, door and window openings per room, storeys if shown. Per-field confidence.
- **Map:** room types → `room_type_scope_rules` presets; unprinted sizes → typical-room defaults as `assumed`; extracted sizes as `ai_extracted`; wall areas as `derived`.
- **Review:** queue entries sorted by $ swing; ≥ $150 items block acceptance until confirmed; the confirm-loop presents them as pre-filled questions ("The plan shows the lounge at 5.2 × 4.1 — right?").
- **Apply:** writes through the same editor RPCs as everything else. No direct tree writes.
- Pipeline state is visible wherever the plan was attached (wizard step, portal, assistant chat — the assistant's `attach_document` tool returns this state and never reads the file itself).

## 4. Acceptance criteria

1. A legible 3-bed plan produces a tree whose rooms and sizes match the plan, every row carrying correct provenance.
2. No value ever appears without provenance; no `assumed` or `ai_extracted` value ≥ $150 swing can reach acceptance unconfirmed.
3. An unreadable upload lands in `failed` with a plain-English next step ("we couldn't read this — type the rooms in, or book a visit"), never a $0 or empty tree.
4. Residential third upload attempt hits the unblock path, not an error.
5. Golden test: the same job built from the plan and built by hand prices identically once both are fully `human_confirmed`.

## 5. ⚑ Open (reconstructed — Tom to confirm)

| # | Item |
|---|---|
| R1 | Pipeline state names + where "needs_review" surfaces first (wizard vs portal) |
| R2 | Whether ceiling heights are ever read from plans or always from `storey_heights` |
| R3 | Accepted file types (PDF/JPG/PNG assumed) and max size |
| R4 | The exact $150 gate figure — recorded as $150; confirm it is Settings-editable |

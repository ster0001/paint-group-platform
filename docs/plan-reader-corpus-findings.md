# What nine real listing floorplans tell us

**2026-08-17.** Tom supplied nine marketing floorplans (Caulfield North, Malvern
East and similar). They were pushed through the P0 pipeline and read by eye.
This is what they change about the build brief.

They are **not** the same properties as the 11 PaintScout jobs, so nothing here
can be scored against that pricing — these are inputs to develop against, not a
regression set. Section 8 still needs plans *and* pricing for the same address.

---

## 1. They found a bug immediately

All nine were classified `photo` at **0.95 confidence**. They are floorplans
that happen to be JPGs, and `page_class` is what routes a page — so every one
of them would have been sent down the exterior/photo path instead of the room
pipeline.

The cause was a shortcut: "uploaded as an image, therefore a photograph". An
image tells you nothing until something looks at it. It now takes the
uploader's declared kind as a **weak prior** and scores it 0.4, with the reason
recorded, so the model settles it in P1 rather than a filename convention
deciding.

Nine real files caught in one run what the synthetic fixture could not.

## 2. None of them has a text layer

Every one is a JPG or PNG off a listing site. The exact-dimension-text advantage
that vector PDFs give — `3.60 x 4.20` as characters — **does not apply to this
corpus at all**. For plans like these the model reads pixels, which is the
harder and less accurate path.

That does not make the text-layer work wasted: a plan supplied by a builder or
architect usually *is* a vector PDF, and those are the jobs where the reader
will be most accurate. But the accuracy expectation for listing plans should be
set from pixel reading, not from the text layer.

## 3. The biggest gap: wet areas and kitchens carry no dimensions

Across the nine, bedrooms and living areas are dimensioned and **bathrooms,
ensuites, kitchens, laundries, WCs, entries and halls are labelled but not
dimensioned**. That is near-universal on marketing plans — those rooms are
small and the agent's plan sells bedrooms.

This matters because the PaintScout data shows those rooms *are* painted: every
bathroom and kitchen in the 11 jobs was quoted walls, ceiling and doors. So the
reader will have geometry for the rooms it can read and none for a third of the
rooms it must price.

The brief's section 2 schema assumes `dimensions` comes back per room. It needs
a documented answer for "labelled, not dimensioned". The options, in order of
how much they can be trusted:

1. **Pixel-measure against a dimensioned room on the same plan.** Any room with
   a printed L x W establishes a scale for the whole image. This is the strong
   option and it is what a human estimator does by eye.
2. **Scale bar** — one of the nine has one (0-6 m).
3. **Stated internal area** — one states 237 m² across four levels.
4. Estimator types it.

Option 1 is worth building because it also fixes option 3's problem. Note the
exception below.

## 4. "NOT TO SCALE"

One plan (33 Pental Road) prints exactly that. Pixel-measuring anything on it is
unsafe, no matter how good the maths — only the printed numbers can be trusted.
Whatever reads dimensions must look for that disclaimer and refuse to
pixel-measure when it is present.

## 5. One in nine has no dimensions at all

26 Cromwell Street is fully labelled and carries no room dimensions, no scale
bar and no stated area. Under section 10 that is a reject — "need a scale bar or
stated total area; if neither, reject with a clear message rather than
guessing". The rule is right, and roughly one plan in nine will hit it.

## 6. Multi-storey plans arrive as ONE image

Three of the nine put ground and first floor side by side on a single page, and
one has four levels. The section 2 schema is one page = one storey
(`"storey": "ground"`). It needs to be one page = **many** storeys, or the
pipeline must split the image before extraction. Storey continuity checks
(first floor <= ground floor area) depend on getting this right.

## 7. Site plans share the page too

Several put the site/block plan beside the floor plan. Useful for section 5's
footprint — but again, same image, so page-level classification cannot describe
it. A page is a *set* of drawings, not one drawing.

---

## What to change in the brief

| Section | Change |
|---|---|
| 2, stage 2 | One page can hold several storeys AND a site plan. Schema needs a list, not a single `storey`. |
| 2, stage 2 | Add a `dimension_source` per room, including "not dimensioned". Expect it on every wet area. |
| 2, stage 3 | Add a check for a "not to scale" disclaimer; disable pixel measurement when present. |
| 2, stage 3 | Reject cleanly when a plan has no dimensions, no scale bar and no stated area (about 1 in 9). |
| 8 | Set listing-plan accuracy expectations from pixel reading, not the text layer. |

## What is still needed for the section 8 gate

Plans **and** PaintScout pricing for the same address. These nine have no
pricing; the eleven priced jobs have no plans. Five of the eleven are interiors
(28 Pyingerra, 10 Scotland, 120 Murrumbeena, 1 Hawthorn, 4 Mclauchlin) — those
five plans, if they can be found on the listing sites, would make the first real
accuracy measurement possible.


---

# The first live read — nine plans, 2026-08-17

Every one of the nine was read by the model through the real pipeline.
**77c for all nine**, about 8.5c a plan.

| Plan | Storeys | Rooms | Dimensioned | Areas drafted | Usable |
|---|---|---|---|---|---|
| floorplan1.jpg | 1 | 10 | 4 | 8 | yes |
| Floorplan 2.png | 1 | 12 | 5 | 10 | yes |
| Floorplan 4.jpg | 2 | 31 | **0** | 29 | **no — refused** |
| Floorplan 5.png | 2 | 29 | 9 | 24 | yes |
| Floorplan 6.png | 1 | 16 | 3 | 9 | yes |
| Floorplan 7.png | 2 | 30 | 12 | 25 | yes |
| Floorplan 8.jpg | 1 | 11 | 5 | 10 | yes |
| Fllorplan 9.jpg | 2 | 14 | 5 | 11 | yes |
| Floorplan 10.jpg | 4 | 24 | 4 | 18 | yes |

## Dimensions: 15 of 15 exact

Every printed dimension checked by hand against the plan came back exactly
right, including on the four-storey townhouse where the dimensions are wall runs
rather than room labels. Not one was invented, and not one was misread.

## The refusal worked on a real plan

26 Cromwell Street (Floorplan 4) read 31 rooms and **zero** dimensions, which is
correct — that plan carries no dimensions, no scale bar and no stated area. The
pipeline marked it unusable and refused to draft from it, exactly as section 10
requires. That is the behaviour that keeps a guessed estimate out of a quote.

## Multi-storey and the disclaimer both work

Four levels off one image on the townhouse; two storeys on four other plans.
Seven of nine correctly reported the "not to scale" disclaimer.

## Two bugs the live run found

1. **Every JPEG failed.** The API call hardcoded `image/png` while the uploaded
   plans were JPEGs, and the API rejects a mismatched media type outright. Five
   of the nine died on it. The media type now comes from the file's bytes.

2. **One plan was thrown away over a single door.** A door wider than 6 m failed
   the schema, and because the schema is all-or-nothing the entire read was
   lost. Stackers, bifolds and double garage doors genuinely exceed 6 m. Bounds
   are now for nonsense only (12 m), and merely surprising values are flagged by
   the validator instead of being fatal.

## Still to improve

- **Site-plan labels leak in as rooms** ("Residence"). They are skipped as
  exterior, so nothing is priced, but they are noise in the review queue.
- **Alias gaps**: "Multi-Purpose Room" resolved to bedroom, "Gym" to living,
  "Butler\'s Pantry" to storage on one plan and kitchen on another. All
  arguable; all cheap to fix in `room_name_aliases`.
- **Half-dimensioned rooms**: wall-run plans give a length and no width. They
  are treated as undimensioned, which is safe but discards a real number.

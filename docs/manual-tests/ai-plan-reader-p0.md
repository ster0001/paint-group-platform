# Manual test — AI plan reader, P0 (the first commit)

**What this is:** the file pipeline and the boundary for the plan reader. Upload
a PDF plan; it gets checked, rasterised, its text read, each page classified,
and everything stored — **with no AI involved yet**. The model call goes in next
(P1), into the run row this creates.

That order is deliberate: the model call is the easy part, and the accuracy
lives in the geometry and the plumbing around it.

## Run this first, in the Supabase SQL editor

`20260910000000_ai_extraction.sql`

It creates eight tables, a private `estimate-sources` bucket, and RLS on all of
them. Until it runs, uploading a plan will fail at the storage step — the checks
before that (staff only, real-file validation) already work.

## 1. What it refuses

Nothing here needs a screen — it's all API. The automated tests already cover
these, but if you want to see it yourself, the important one is:

1. Take any text file, rename it `floorplan.pdf`, and upload it.
   ✅ Refused: *"That doesn't look like a plan or a photo. Upload a PDF, JPG,
   PNG or HEIC."* It reads the file's actual bytes, so renaming doesn't fool it.
2. A contractor login cannot reach the route at all (403), and a signed-out
   request gets 401.

## 2. What it does with a real plan

3. Upload a dimensioned floorplan PDF:

```bash
curl -X POST http://localhost:3000/api/extract/floorplan -F "file=@/path/to/plan.pdf" -b "your-session-cookie"
```

Easier: once there's an upload button (P1), use that. For now the automated test
does it.

✅ You get back one **run id per page** — never one call for a whole document —
plus each page's classification.

4. Open `/dev/extract/<runId>` in the browser (staff only).

✅ You see: the page rendered at 200 DPI · what it was classified as and **why**
· the text lifted out of the PDF · and a placeholder where the model's output
will go.

## 3. The thing worth understanding

On a **vector** plan (one exported from CAD, which most builder plans are), the
text layer comes out **exactly** — `3.60 x 4.20` as characters, not as pixels
for something to squint at. The brief calls small dimension text the single
biggest source of read errors. For digital plans, that problem is mostly gone
before the model is even asked.

On a **scan or a photo** of a plan there is no text layer. The debug page says
so plainly, in amber, and that page's confidence is low — those are the plans
where the model has to do the reading and where accuracy will be worse.

## 4. Page routing

Each page is sorted into `floorplan_interior` · `elevation` · `site_plan` ·
`photo` · `other` before anything expensive happens, so an elevation never gets
fed to a reader looking for rooms.

One catch worth knowing about, found while testing: a **Section 32** vendor's
statement is routinely bound into the same PDF as the plan, and "section" is
also a drawing term. It now only reads as a drawing when it looks like one
(`SECTION A-A`, `SECTION 1:100`), so your vendor's statement pages fall through
to `other` and get skipped.

---

## Verified before handing this over (2026-08-17)

| Check | Result |
|---|---|
| `npm test` | 132/132 (22 new — normalisation, classification, real PDF) |
| Anonymous upload | 401 |
| Contractor upload | 403 |
| Text file renamed `.pdf` | 400, refused on its bytes |
| Two-page PDF → pages, text, classes | page 1 `floorplan_interior`, page 2 `elevation` |
| 200 DPI render of A4 | 1653 × 2339 px |
| `npm run build` | passes — mupdf (WASM) bundles into the route fine |

**Not verified, because it needs the SQL:** storage of the pages, the
`estimate_sources` / `extraction_runs` rows, and the debug page end to end.
That's the fourth API test — it un-skips with `E2E_EXTRACT_READY=1` once you've
run the migration:

```bash
E2E_EXTRACT_READY=1 E2E_STAFF_EMAIL=pg.sam.staff@gmail.com E2E_STAFF_PASSWORD=painttest123 npm run test:e2e -- extract-api.spec.ts
```

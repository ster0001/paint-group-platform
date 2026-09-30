# Manual test — the painter's job in four steps, photos per job (30 Sep 2026)

Branch `feat/wo-steps-per-job-photos-30sep` (stacked on `fix/upload-timeouts-progress-30sep`).
Automated: `e2e/wo-steps.spec.ts` plus the updated `wo-ticks`, `wo-photo-rules`, `wo-full-loop`,
`employee-portal` and the finish specs.

## Migration to paste

`supabase/migrations/20270207000000_wo_photos_per_job.sql` — expect ONE row: `tick_per_job true`,
`finish_gated true`, `tick_granted true`, `finish_granted true`, `helper_not_granted false`.
The last line writes the `_prod_migrations` row. Paste it with the deploy: after the paste and
before the deploy a painter on the OLD screen still ticks (the gate only got looser); after the
deploy and before the paste a painter would meet the old per-area error on the new screen, so
do them together.

## The stuck-upload cause, fixed on the way

The ingest step read the staged photo's first bytes through the framework's own fetch and never came back, so uploads hung at 100% with the button on "Uploading…". It now reads through Node's own client. Expect every upload to finish within a few seconds of the bar reaching 100%; a slow one is logged on the server as `[wo.photos.ingest] slow`.

## Walk, as a painter on a phone (a job at In progress)

1. Open the job. A strip across the top reads **1 Before photos · 2 Tick the work · 3 After photos · 4 Finish**, with 1 lit. The scope list below is greyed with **🔒 Locked until Step 1**. Tap a row: "Step 1 first — upload the before photos, then every row unlocks."
2. On **Step 1 · Upload the before photos**, tap **Take photos or choose from your phone**. The phone offers camera or library and lets you pick several. Each pick lists on the card as "ready". Tap **Done — upload the before photos (N)**: the button counts "Uploading 2 of 5 · 43%". When the last lands the card says "5 uploaded. The scope below is unlocked — tick away." and the strip moves to 2.
3. Turn the phone to aeroplane mode mid-batch: the current file stalls and after 45 seconds is marked failed with a plain message; the rest wait. Turn signal back on, tap **Retry**; it finishes. Nothing is uploaded twice.
4. Tick every row Prepped then Done. No photo prompt appears on any side.
5. With the last row done, **Step 3 · Upload the after photos** appears: "Take photos of all rooms or all sides now the work is finished…". The **Step 4 · Finish the job** card below is greyed with **🔒 Step 3 first**. Upload one or more; the lock clears and the strip moves to 4. Press **All done — next step** as before.
6. **Got a question, or found something?** sits under the steps and says photos here are for questions only. It has no Finished option any more.
7. Office: Projects → the job → Scope & ticks shows the same lock line until the painter's before photos are in; the gallery copy says before photos arrive as Step 1.
8. An employed crew member (not the lead) can tick rows on an assigned job again. Before this change they got "That job isn't yours."
9. Dashboard: finishing the last row writes the "finished on site" fact again (it had stopped on 24 Sep).

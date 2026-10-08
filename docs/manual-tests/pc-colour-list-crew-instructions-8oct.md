# Manual test — PC Command: colours from our list + further instructions for the crew (8 Oct 2026)

Branch `feat/pc-colour-list-crew-instructions`. Automated: `e2e/pc-colour-list-crew-instructions.spec.ts`
and `lib/workorder/crewNotes.test.ts`.

## Migration to paste

`supabase/migrations/20270244000000_wo_crew_notes_follow.sql` — it prints ONE row. Compare each value
with the `_expect_` column beside it: `fn_present 1`, `security_definer true`,
`authenticated_may_execute true`, `anon_may_execute false`, `trigger_present 1`,
`trigger_fn_callable false`. `sheets_disagreeing_with_column` is a count for information: jobs whose
note was edited in the builder after the job went out, which the painter never got. The last line
writes the `_prod_migrations` row; no row means the paste did not finish. The colour list needs no
migration.

## 1. A colour from our list

1. **Projects → any open job → Materials → Adjust colour / litres** on a row.
2. Press **Choose a saved colour**. The colour list opens — search "Vivid", or tap **Dulux**.
3. Pick **Vivid White**. Expect the colour name box to read "Vivid White" and the swatch and hex to
   change to match.
4. Press **Save to job sheet**. Expect "Saved — the job sheet carries the new colour." and the row to
   read Vivid White.
5. Open **Painter's view** (or the job-sheet link in a private window). Expect Vivid White under
   Materials & colours.
6. Do it again, but type a colour by hand ("Customer's own mix") instead of using the list. Expect it
   to save exactly as before.

## 2. Further instructions for the crew

1. On the same job, find the **Further instructions for the crew** card (under Next step).
2. Type "Key under the mat — start with the eaves" and press **Save to the work order**. Expect
   "Saved — the work order carries the new instructions."
3. Reload the page: the text is still there.
4. Open the job-sheet link in a private window (no login). Expect **Further instructions for the
   crew** near the top, with your text.
5. Open the estimate in the builder → **Work order** tab. Expect the same text in its box. Change it
   there, reload the painter's link: it shows the builder's change too.
6. Clear the box on the PC card and save. The painter's link no longer shows the section.
7. On a **closed** job, the card shows the note read-only, with no Save button.

## 3. A job where the sheet and the note disagree (only if the read-back count was above 0)

Open one of those jobs. The card shows an amber line, "The painter's sheet currently says: …".
Check the text in the box, then **Save to the work order**. The amber line goes, and the painter's
link shows the box's text.

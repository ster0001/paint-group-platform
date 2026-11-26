## Paint Home go-live finish

Brief: `docs/briefs/claude-code-brief-painthome-go-live-finish.md`. Do not merge until Tom has walked the preview (`docs/manual-tests/painthome-go-live-finish-26nov.md`).

### Reviewed (Part A)
The 25 Nov session's uncommitted changes matched the brief's file list. One fix: `app/(marketing)/privacy/page.tsx` hardcoded `+11:00` (failed `lib/workorder/boundary.test.ts`).

### Changed beyond Part A
- **Chat says Paint Home on Paint Home (Part B):** site bubble (`SiteChat`), first automatic message (`websiteGreeting`), staff-reply text and email (`chatReply.ts`), `/e` chat label, account Messages and assistant screens.
- **"Describe the job" box removed** from the chat (Tom, 26 Nov). `assistant-describe.spec.ts` deleted with it.
- **"Send a message" dropping out:** the sheet closed when a drag out of a field ended on the backdrop. `lib/ui/useBackdropClose.ts`, used by `TalkSheet` and `SaveAndBookSheet`. Reproduced first by `e2e/customer-journey/talk-sheet-stays.spec.ts`.
- `gate.spec.ts` updated to the new details-step messages.

### Tests
- `npx tsc --noEmit`: clean. `npx eslint --max-warnings 4 .`: 0 errors, 4 warnings (pre-existing). `npm test`: 456 files, 4,474 passed.
- e2e on the test stack (26 Nov): `talk-sheet-stays` laptop + phone pass (failed before the fix); `gate.spec.ts` details-step messages pass; `painthome.spec.ts` 1, 1b (chat), 2, 3 pass; `visit-requests`, `wizard-mobile-v5-contact` pass.
- Red, in code this PR does not touch (main's e2e job is already red at 337bd02): `painthome.spec.ts` 4 (showcase cards) and 5 (Settings copy preview `src`), `gate.spec.ts` gate report export (503), `reach-and-chat` footer visit door (texted code expired).
- Not run: the full customer-journey suite.

### Flagged
- `painthome-go-live-check-25nov.md` was not on the Mac; Tom said go ahead without it.
- Staff Customer chats panel does not show the brand: `agent_conversations` has no brand column (not one line of work).
- The seven ⚑ items in the brief are Tom's.

### SQL for Tom (Part C wording; not applied)
`supabase/migrations/20270318000000_paint_home_go_live_wording.sql`

```sql
-- =============================================================================
-- Paint Home go-live wording (go-live finish brief, Part C — Tom approved, 25 Nov 2026)
--   Six rows of the painthome copy set, changed to the words now in
--   lib/marketing/copy/painthome.ts. The seed (20270299000000) is not edited.
--   Each update is GUARDED on the seeded wording: a row the office has already
--   reworded in Settings → Paint Home website is left exactly as it is.
-- Converging: a re-run finds the new words and changes nothing.
-- Read-back at the end: `done` is the rows now carrying the new words (6 when
-- none had been edited by hand); `left_seeded` must be 0.
-- =============================================================================
set lock_timeout = '15s';

update public.site_content set value = 'Apartments, units and smaller homes, inside and out. Enter your address, tell us what needs painting, and see your price today. We confirm it on one short call. Most jobs need no site visit.', updated_at = now()
  where audience = 'painthome' and section = 'hero' and key = 'lead'
    and value = 'Apartments, units and smaller homes, inside and out. Enter your address, tell us what needs painting, and see your price today. We confirm it on one short call. No site visit, no waiting.';

update public.site_content set value = 'Your address, the rooms, roughly how big. Add photos if you have them. A guide range appears in a couple of minutes; the full price takes about ten.', updated_at = now()
  where audience = 'painthome' and section = 'how_it_works' and key = 'step_1_body'
    and value = 'Your address, the rooms, roughly how big. Add photos if you have them. Your price appears on screen in about ten minutes.';

update public.site_content set value = 'One short call. Your price is then confirmed in writing.', updated_at = now()
  where audience = 'painthome' and section = 'promise' and key = 'row_2_sub'
    and value = 'One short call. After that, the number doesn''t change.';

update public.site_content set value = 'Our trusted network of painters. Quality-checked, insured, and used to working in occupied homes. You''ll know who''s coming before the date is confirmed.', updated_at = now()
  where audience = 'painthome' and section = 'painters' and key = 'lead'
    and value = 'Our own painters. Qualified, insured, and used to working in occupied homes. You''ll know who''s coming before the date is confirmed.';

update public.site_content set value = 'Painters from our trusted network, who are quality-checked, fully insured and used to working in people''s homes. You''ll see who''s coming in your account before the start date is confirmed.', updated_at = now()
  where audience = 'painthome' and section = 'faq' and key = 'a_4'
    and value = 'Our own painters, who are quality-checked, fully insured and used to working in people''s homes. You''ll see who''s coming in your account before the start date is confirmed.';

update public.site_content set value = 'Apartments, units and smaller homes across Melbourne, priced online in about ten minutes and confirmed on one short call. Most jobs need no site visit.', updated_at = now()
  where audience = 'painthome' and section = 'meta' and key = 'meta_description'
    and value = 'Apartments, units and smaller homes across Melbourne, priced online in about ten minutes and confirmed on one short call. No site visit, no waiting.';

-- ---- read-back ---------------------------------------------------------------
select
  (select count(*) from public.site_content where audience = 'painthome' and ((section = 'hero' and key = 'lead' and value = 'Apartments, units and smaller homes, inside and out. Enter your address, tell us what needs painting, and see your price today. We confirm it on one short call. Most jobs need no site visit.') or (section = 'how_it_works' and key = 'step_1_body' and value = 'Your address, the rooms, roughly how big. Add photos if you have them. A guide range appears in a couple of minutes; the full price takes about ten.') or (section = 'promise' and key = 'row_2_sub' and value = 'One short call. Your price is then confirmed in writing.') or (section = 'painters' and key = 'lead' and value = 'Our trusted network of painters. Quality-checked, insured, and used to working in occupied homes. You''ll know who''s coming before the date is confirmed.') or (section = 'faq' and key = 'a_4' and value = 'Painters from our trusted network, who are quality-checked, fully insured and used to working in people''s homes. You''ll see who''s coming in your account before the start date is confirmed.') or (section = 'meta' and key = 'meta_description' and value = 'Apartments, units and smaller homes across Melbourne, priced online in about ten minutes and confirmed on one short call. Most jobs need no site visit.'))) as done, 6 as _expect_done,
  (select count(*) from public.site_content where audience = 'painthome' and ((section = 'hero' and key = 'lead' and value = 'Apartments, units and smaller homes, inside and out. Enter your address, tell us what needs painting, and see your price today. We confirm it on one short call. No site visit, no waiting.') or (section = 'how_it_works' and key = 'step_1_body' and value = 'Your address, the rooms, roughly how big. Add photos if you have them. Your price appears on screen in about ten minutes.') or (section = 'promise' and key = 'row_2_sub' and value = 'One short call. After that, the number doesn''t change.') or (section = 'painters' and key = 'lead' and value = 'Our own painters. Qualified, insured, and used to working in occupied homes. You''ll know who''s coming before the date is confirmed.') or (section = 'faq' and key = 'a_4' and value = 'Our own painters, who are quality-checked, fully insured and used to working in people''s homes. You''ll see who''s coming in your account before the start date is confirmed.') or (section = 'meta' and key = 'meta_description' and value = 'Apartments, units and smaller homes across Melbourne, priced online in about ten minutes and confirmed on one short call. No site visit, no waiting.'))) as left_seeded, 0 as _expect_left_seeded;

insert into public._prod_migrations(name) values ('20270318000000_paint_home_go_live_wording.sql') on conflict (name) do nothing;
```

🤖 Generated with [Claude Code](https://claude.com/claude-code)

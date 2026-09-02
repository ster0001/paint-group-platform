# Manual test — Assistant support mode + Brain (S6, 2 Sep 2026)

## Migration + import (once)
1. Run `supabase/migrations/20261229000000_brain_slug_needs_content.sql` — the final select lists `needs_content` and `slug`.
2. `npx tsx scripts/import-brain.ts` — imports `docs/brain/brain-v1.md` as drafts. It prints which entries are still "to write" (caulking, prep standard, finish levels, paint brands, colour match, occupied, timing, who comes).

## Settings → Brain
- Every entry is a draft. **Approve** the [PLATFORM] ones you're happy with (deposit, price range, validity, variations, warranty, colour register, service area, insurance, coats). Entries marked *to write* can't be approved until you write them and untick the flag.
- Tokens like `{{deposit_pct}}` render the live Settings value when answered.

## As a customer (portal)
1. Open an estimate's message thread → **Ask the assistant**.
2. "What's included in my estimate?" → rooms and the range, from the estimate itself.
3. "Can you add the laundry ceiling as well?" → "Logged for the team…" — the CRM Today queue shows **Change requested on …** with a Reprice action; a staff reply in the thread clears it.
4. "When do I pay the deposit?" → the approved Brain entry with the live deposit %.
5. "How do you handle caulking?" → "I don't have an entry for that yet… want a person?" until you write and approve it.
6. "Can someone come out?" → the visit-policy answer (self-serve link, or "we'll call you").
7. "Talk to a person" → acknowledged (the console card lands in S7).

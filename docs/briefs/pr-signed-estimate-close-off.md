## Signed estimate downloads signed · every PC Command reminder closes off (Tom, 11 Nov 2026)

> 1. When a customer signs an estimate, and I download the estimate from the estimates tab, I am unable to see their signature
> 2. Please update the dashboard in PC Command so all reminders can be closed off

### 1 · The signed estimate
The drawn signature **was** being stored on acceptance (`estimates.accepted_signature`, since `20260816`), but nothing ever read it back, so the PDF (`PrintQuote`) always printed three blank lines.

- `20270311000000_estimate_signature_read.sql`
  - `estimate_signature_by_token(token)`: a definer RPC (anon) that returns signature, name and date for an **accepted** estimate, and null for anything else.
  - `save_estimate_signature` now writes only to an accepted estimate, and only a PNG data URL under 1 MB. It used to take any text against any token.
- `lib/estimate/signature.ts` (`toEstimateSignature`) checks the value once before it reaches an `<img src>`. Unit-tested.
- `/e/[token]` reads the RPC. The staff builder (`/quote`, its ESTIMATE tab, which the Estimates tab opens) reads `accepted_signature` / `accepted_name` from its own row.
- The PDF's signature row now holds the signature, the name and the signing date (Melbourne day), and the header reads *Status · Accepted · name · date*. Straight after signing, the download prints the signature just drawn.

### 2 · Close off on PC Command
Every work-item card on `/pc` that had only **Remind me…** now also has **Close off**. That means call backs, painter Red, bonus due, payment hold, site check-in, quality check due / final cancelled, colour match, materials, no work today, painter message, and the quality-check strip. It uses the existing `QueueDismiss` → `crm_dismiss_work_item` with no end date and the reason *Closed off from PC Command*, so it adds no new queue and no new table. Cards with their own outcome button keep that button (Rang them, Reviewed, Confirmed, ✕).

### Migration — paste for Tom
Paste `supabase/migrations/20270311000000_estimate_signature_read.sql` whole. Then compare the read-back row with the `_expect_` values: read_anon, read_definer, save_anon and save_guarded should all be true. The last two columns count accepted estimates and how many of them hold a signature. **The code depends on this migration.** Without it, the token page just prints blank lines and reports the read failure, so nothing breaks, but no signature shows.

### Proof
E2E_RESULT_LINE

### Manual test (Tom)
1. Send yourself a test estimate. Open the link on your phone, sign, and accept. Then press **⤓ Download estimate (PDF)**: the bottom of the PDF shows your signature, your name and today's date.
2. Estimates tab → that estimate → **ESTIMATE** tab → **⤓ Download estimate (PDF)**: you get the same signed sheet.
3. An estimate a customer accepted before today prints signed too, as long as its signature saved. The read-back count says how many have one.
4. PC Command: on any reminder (for example a call back or a painter message), press **Close off**. It reads **Noted** and stays gone after a reload.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

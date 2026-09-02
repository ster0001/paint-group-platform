# Manual test — Assistant agent S3 (2 Sep 2026)

Still no screen (S4 brings the chat). What to check:

1. `npm test` — the parity suite `lib/agent/scope-tools.test.ts` is green: six jobs built the wizard way and the assistant way price identically.
2. The reference fixture `lib/agent/__fixtures__/scope-refs.json` is a capture of the live rules/aliases/defect rates/typical sizes and the active rate card. Re-capture after a rate-card change so parity tests price against the real card:
   - run the node one-liner in the S3 session log (or ask Claude Code to "recapture scope-refs").
3. Nothing to run in Supabase for S3 — no migration.

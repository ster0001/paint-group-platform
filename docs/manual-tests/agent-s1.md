# Manual test — Assistant agent S1 + D19 (2 Sep 2026)

Nothing in this batch has a screen yet (S1 is "no UI"). These checks are for the two migrations and the code gate.

## 1. Run the two migrations (Supabase SQL editor, in this order)

1. `supabase/migrations/20261227000000_cupboard_interiors.sql`
   - The final `select` must list **four** rows: Kitchen Cupboard Interior (~50), Linen / Broom Cupboard Interior (~95), Robe Interior (~143), Vanity Interior (~57).
   - If it raises "expected 4 cupboard-interior rows", the template front rows are missing on the active card — tell Claude Code.
2. `supabase/migrations/20261228000000_agent_schema.sql`
   - The final `select` must list the policies — expect **9** rows across the seven `agent_*`/`brain_entries`/`callback_requests` tables. Read them; do not assume.
   - `select * from agent_settings;` → one row, `tenant_key = 'paint-group'`, `model_default = 'claude-haiku-4-5'`, `model_heavy = 'claude-sonnet-5'`.

## 2. Cupboard interiors show up in the wizard's room loop (after migration 1)

1. Open any interior estimate's scope editor as staff, or run the wizard as a customer, to the room loop.
2. Kitchen: under "Are we painting the kitchen cupboards?" the API now also returns a second question, **"Paint inside the kitchen cupboards too?"** (the screen that renders it is A2 — until then verify via the network response of `wizard-edit`: each room carries `cupboardInterior`).
3. A room confirms without answering it (it is a tightening question, not a gate).

## 3. Hard stop scripts

`select hard_stop_scripts from agent_settings;` — ten scripts (lead_paint, asbestos, heritage, injury, complaint, refund, legal, discount, margin, out_of_area). **Tom to review the wording**; edit the row, not code.

## 4. Env for the gateway (before S4 lands a screen)

Vercel needs `ANTHROPIC_API_KEY` set (it is already used by the plan reader). No new keys.

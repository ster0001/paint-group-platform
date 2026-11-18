# Site allowances — before/after over every estimate (2026-11-18)

Go-live brief §3.3. Database host: `aws-0-ap-southeast-2.pooler.supabase.com`. Read-only. Before = the previous engine over the stored state; after = this engine over the state migration 20270317 leaves (mirrored in `scripts/pricing/allowances-before-after.ts`). Same live rate card, products, modifiers and settings for both.

| Estimates with a builder state | Compared | Already explicit (skipped by the migration) | Failed to price | **Differences (any field)** |
|---|---|---|---|---|
| 1751 | 1751 | 0 | 0 | **0** |

Fields compared per estimate: subtotal, total, contractor offer, sundries line, preparation hours line (cents) and contractor hours.

Working scopes (wo_working_scopes, accepted + working states of accepted jobs): 170 states, 170 compared the same way; their differences are counted above.

By source: airtable 1478 · paintscout 45 · manual 167 · wizard 5 · customer_intake 56.
Flat sundries read from Settings for the migration mirror: interior $275, exterior $175.

## Result

**Zero cents of difference on every estimate.** The engine change can ship once the migration is live.

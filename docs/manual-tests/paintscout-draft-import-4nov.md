# Manual test · PaintScout quote → an editable draft priced by this system (4 Nov 2026)

Branch `feat/paintscout-draft-import`. No migration.

1. Read-only, production: `zsh /tmp/wo/draft.sh check`. Read: the contact, the job address, the exclusions, the decisions (hourly lines, large windows, products not in the catalogue), and the line `platform price … vs PaintScout …`. Nothing is written.
2. `zsh /tmp/wo/draft.sh run` → `ok: draft estimate NNNN · 52 William St, Balaclava · open /quote?id=…`. A second run answers `exists:` and writes nothing.
3. Open the estimate: status Draft; the sides (Front Side, Right Side, Left Side, Back) list their eaves, fascias, windows and doors with quantities and coats; Scaffolding is an hourly line; Exclusions are Balustrades, Downpipes, Gutters; Admin notes name the PaintScout quote and its total. Pick the lead source, change any count, Save — the total moves with it.

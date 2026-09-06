# Help content — session A4 (walkthrough GIFs + stale warning) — Tom's review

No migration. Ten minutes.

## 1. Watch the six films (6 min)
Open each help file on GitHub; the GIF sits under the front-matter link. Watch:
`docs/help/scheduling/{contractor,staff}.md`, `docs/help/self-invoicing/{contractor,staff}.md`,
`docs/help/work-orders/{contractor,pc}.md` (the painter's has a second film under *Finishing up*).
Each should be silent, captioned step by step, under a minute, and show only invented test data.

## 2. The stale-help warning (2 min)
```bash
cd ~/Documents/paint-group-platform && export PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH" && echo "// touch" >> app/pc/schedule/schedule.css && npm run help:index -- --check; git checkout -- app/pc/schedule/schedule.css
```
Expect a line beginning `::warning file=docs/help/scheduling/staff.md::help for scheduling/staff may be stale — 1 uncommitted change touched app/pc/schedule…`, and the command still exits 0. The last part of the command puts the file back.

## 3. Re-stamping after a change (1 min)
When a screen changes: re-run the capture and GIF specs for that feature, re-read the file, then
`npm run help:index -- --stamp <feature>` and commit. The warning clears.

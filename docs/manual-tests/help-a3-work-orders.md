# Help content — session A3 (work order loop) — Tom's review

No migration. Reading test, like A2.

## 1. Read the painter's file cold (10 min)
`docs/help/work-orders/contractor.md`. Read it as a painter on their first job: from "Ready to start?" to "Job complete". Note anywhere you would have to ring the office to know what to do.

## 2. Read the PC file (10 min)
`docs/help/work-orders/pc.md`. Check the six lane names match the console rail word for word, and that the colour meanings match what you see on `/pc`.

## 3. Two things the files say that you should know are true of the app today
- After a **failed** quality check, the painter fixes and finishes again, but the failed check cannot be re-logged and blocks the walkthrough. The PC file says so and points at an administrator; a fix is proposed as a separate task.
- No `staff.md` for work orders: the loop lives entirely in the PC console.

## 4. The index (30 s)
```bash
cd ~/Documents/paint-group-platform && export PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH" && npm run help:index -- --check
```
Expect `help:index — 6 help files indexed, _index.json is current.`

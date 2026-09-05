# Help content foundation — session A1 (the convention) — manual test

No migration, no UI. Two minutes at the terminal, all on the branch `feat/help-content-foundation`.

## 1. The rule is in CLAUDE.md
Open `CLAUDE.md` → Process. Under the Testing law bullet there is a **Help is part of definition of done** bullet
naming `docs/help/<feature>/<role>.md`, `docs/help/_template.md` and the CI check.

## 2. Template and README
`docs/help/_template.md` matches the brief's §6 word for word. `docs/help/README.md` lists the four roles
(staff · pc · contractor · customer) and the same-PR rule.

## 3. The index on an empty folder
```bash
cd ~/Documents/paint-group-platform && export PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH" && npm run help:index
```
Expect `help:index — wrote docs/help/_index.json (0 help files).` and the file to contain `"files": []`.

## 4. A malformed file fails readably
```bash
mkdir -p docs/help/zz-test && cp docs/help/_template.md docs/help/zz-test/staff.md && npm run help:index; rm -rf docs/help/zz-test
```
Expect nine one-line problems, each `docs/help/zz-test/staff.md: …` (placeholder title, role not in the set,
feature not matching the folder, missing screenshot, and so on), then
`help:index — 9 problems in docs/help/.` and a non-zero exit. The folder is removed by the same command.

## 5. CI
On GitHub → Actions, the `typecheck · lint · unit` job shows a new step **Help content index (front-matter +
role check)** and it is green.

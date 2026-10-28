# Tighten editor: the Paint Home mark on a Paint Home estimate

**Tom, 28 Oct 2026** ("yes, fix it" — spotted while checking the editor). No migration.

## What changed
- `/estimate/scope` reads the estimate's `brand` with the row it already loads and hands it to both editors (`ScopeEditor`, `SidesEditor` → `Wordmark brand`), so a Paint Home estimate's tighten editor wears the Paint Home mark in its frozen header instead of the Paint Group wordmark, on either host. Paint Group estimates are unchanged.

## Proof
- e2e `e2e/marketing/painthome-wizard.spec.ts` test 1 now opens the editor for the Paint Home estimate and asserts the Paint Home mark, no wordmark, and no "Paint Group" on the page. Local C1 result in the PR conversation if the lock was free; otherwise the PR e2e job.
- Typecheck clean; lint 0 errors.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

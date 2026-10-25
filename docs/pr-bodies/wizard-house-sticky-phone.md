# Estimator wizard on a phone: the house stays pinned at the top on every step, and is drawn larger

**Tom, 25 Oct 2026:** "in mobile view the house needs to stay fixed at the top of the page on all steps" and "the house shows up small in the middle of a landscape image — slightly larger, but not so large it takes up the full screen and you can't scroll". Both shopfronts, inside and outside jobs. No migration.

## What changed (`app/wizard/wizard.css`, the ≤900px block only)
- The picture card is `position: sticky` under the step bar (99px, with its progress line), so it stays put while the questions scroll beneath it, on every quick-look step. Laptop layout untouched.
- The band is 150px (was 112px) and the 400×300 house drawing is scaled ×1.75 around the house itself, so sky and ground are cropped and the house fills the band. The card with its one-line note is about 190px tall; a 375×812 phone keeps roughly 440px of scrolling room above the fixed Continue bar.
- The elevation drawing's 172px rule is unchanged.

## Proof
- Checked in the browser at 375×812: outside job step 1 → step 2 (card stays at 99px while scrolled), inside job (single and two storeys). Lint 0 errors.
- The desktop 4:3 spec (`ui-refresh-steps.spec.ts`) is unaffected (laptop width only).

🤖 Generated with [Claude Code](https://claude.com/claude-code)

# Wizard on a phone: every kind of property draws its whole building inside the picture band

**Tom, 25 Oct 2026 (evening):** "in mobile view, when clicking apartment or unit, the picture of the apartment doesn't show in full on the page". CSS only; no migration.

## What changed (`app/wizard/wizard.css`, the ≤900px block)
- The 400 × 300 house drawing is zoomed to fill the 170px band. A zoom ×k about a point shows 300/k units of the drawing from `origin × (1 − 1/k)`, so ×1.75 at 64% shows y 82–253 — right for the single-storey house, the townhouse and the shopfront (roof peak 88, door's foot 250), unchanged.
- **Unit or apartment** is a block 210 of the 300 tall (y 40–250): it now gets ×1.12 about the ground line, so the roof slab and the door are both in.
- **Two storeys**: the roof lifts 70 units to y 18, so the house gets ×1.25 about 23% (shows 14–254) instead of ×1.4 at 52%, which cut the lifted roof.

## Spec
`e2e/customer-journey/wizard-phone-pictures.spec.ts` (new): at 390 × 844 on the place step, House, Townhouse, Unit or apartment, Commercial and House with two storeys — the building's parts all lie inside the picture band.

## Proof
RESULTS_PLACEHOLDER

## Manual test (phone)
/estimate → address → Continue → tap each kind of property, then Two storeys on House: the whole building is in the picture every time, nothing cut at the top or bottom.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

# Paint Home on a phone: the hero photo sits behind the form

**Tom, 25 Oct 2026:** "show the image in mobile view in the header behind the form on the home page". Paint Home only; CSS only; no migration.

## What changed (`marketing.css`, Paint Home ≤959px)
- The hero photo is full-bleed behind the whole hero on phones (it was a short band above the form), darkened top to bottom so the headline and the address box read over it, with the glass block lightened (56% slate, 3px blur) so the picture shows through.
- The photo is whichever Settings → Paint Home website → Hero photo holds, falling back to the homes site's hero photo.

## Proof
- Checked in the browser at 375×812 with a photo in place (screenshot in the PR conversation); lint 0 errors. The homes and business sites keep their band-above layout.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

# Paint Home: the card rank writes through the service client; the hero form sits above the fold

**Tom, 25 Oct 2026:** "when I try and order the jobs as 1, 2 or 3 it just crashes" and "make the form slightly smaller so it sits more above the fold; in mobile view the form doesn't sit above the fold". No migration.

## What changed
- **Card rank** (`lib/showcase/actions.ts setPaintHomeRankAction`): the write now goes through the service client after the staff check, as every other showcase write does — `showcase_jobs` has no client write policy, so the first version's session-client update could never land. Set on the test stack: rank 1 saves and reads back.
- **Hero above the fold** (`marketing.css`, Paint Home only): the block starts at the top of the hero instead of centring in it; tighter headline (64px max, was 88), lead, padding and gaps. Phone: a short photo band (38vw, max 200px) instead of the homes site's tall one, the block directly under the nav, headline 40px max. Measured on the test stack: laptop 1280×800 the address box bottom moved from 609px to 493px; phone 375×812 the box bottom is at 357px with the Inside/Outside chips at 504px.

## Proof
- Typecheck clean; lint 0 errors; unit suite unchanged.
- Browser check at 1280×800 and 375×812 (screenshots in the PR conversation). The rank select saved on the test stack with the fix.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

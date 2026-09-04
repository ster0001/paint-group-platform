# Homepage v2 — session 4 (/work and the project pages) · manual test for Tom

The public side of what you publish in Settings → Showcase.

## What to open (production, on your phone)

1. Publish a job from Settings → Showcase (session 3 notes) if you haven't.
2. Open **/work**. Every published job is a card: photo, type, days on site,
   `SUBURB · COMPLETED MON YYYY`, the price range, the one-line scope,
   "View this job →". Newest completed first. The chips narrow by job type and
   by Homes / Businesses.
3. Tap a card. The page is always the same nine blocks in the same order:
   hero photo with the title, meta line and price; summary; what we did;
   before/during/after gallery (tap a photo — swipe with ← → on a keyboard,
   Esc closes); colours (a swatch when the name is a known Dulux/Haymes/
   Colorbond colour, a neutral chip otherwise); condition; what the customer
   said; "A job like this in your home or business?" with the address field;
   more jobs. Blocks with nothing in them simply don't appear.
4. Type an address in "A job like this…" and tap See my price. The wizard
   opens on that job's type (Exterior/Interior already chosen). If the job is
   linked to an estimate in the editor, the wizard also starts from that
   estimate's rooms and answers — never its customer's name, email, phone,
   address, suburb or photos.
5. Unpublish the job in Settings and reload its page within a minute: 404,
   with a link back to /work. It is gone from /work too.

## Things that are deliberate

- The whole new site is still `noindex` (the test-subdomain rule, §8) —
  Google will not see these pages until the flip.
- Page titles read `Title in Suburb — $8,400 – $9,600 | Paint Group`; the
  share preview (Facebook/WhatsApp) uses the hero photo.
- Edits made in Settings show on the public pages within about a minute.

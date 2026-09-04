# Homepage v2 — session 1 (walking skeleton) · manual test for Tom

Brief: `docs/briefs/homepage-v2-build-brief.md` §6b session 1. Prototype:
`design/reference/paint-group-homepage-v2-prototype.html`.

What exists after this session: the new `/` (nav, hero with the address
field and the home/business chips, footer, mobile call bar). Sections 3–12
are NOT built yet — the page is short on purpose.

## On your phone (test stack)

```bash
./scripts/c1/serve.sh
```

then open `http://<this-mac's-IP>:3101/` on your phone.

1. **Nav.** "PAINT GROUP", the phone number and a cyan "See my price" pill.
   Scroll — the nav stays stuck to the top and is see-through.
2. **Call bar.** "Call us" / "See my price" pinned to the bottom of the
   screen. It never covers the footer text (the page has room under it).
3. **Hero.** Big headline "Transforming spaces. Redefining painting." in
   Switzer, the kicker line above it in monospace, the lead paragraph, the
   cyan-bordered address field, the two chips ("My home" is lit), and the
   "Rather talk to a person? Call 1300 000 000" line.
4. **Type an address.** Tap the field, type `12 Elm`. Three suggestions
   should drop down (only if the Google key is set on the stack you are
   using — the test stack has none, so on :3101 you will see no
   suggestions and typing just works). Pick one.
5. **See my price.** Tap it. You land on `/estimate` and the address is
   already in the wizard's field. The URL ends in `?address=…&mode=home`.
6. **Business.** Go back, tap "A business or property I manage", type any
   address, tap See my price. In the wizard, "What kind of property?" has
   **Commercial** already selected and the URL says `mode=business`.
7. **Phone links.** Every phone number is a real `tel:` link (nav, hero,
   call bar). They all show `1300 000 000` — that is the ⚑9.10 placeholder.
8. **Desktop (≥960px wide).** Four nav links appear; the call bar is gone;
   the phone number is in the nav.

## What is deliberately missing (later sessions)

- The field does not type by itself yet (session 6).
- Nav links "How it works", "For business", "Reviews" go nowhere until
  session 5 builds those sections; "Real jobs, real prices" → `/work`
  (session 4).
- No analytics provider yet (session 7) — events are visible in the
  browser console as `[track] …` lines on a dev build.

# Manual test — A1: address autofill on wizard page 1

What changed: the first field on "Let's look at the place" autocompletes
Australian addresses (biased to Melbourne). Picking one names the estimate
("30 Rodda Street, Murrumbeena"), stores the structured address on the
estimate (builder's Job Address card), and — for customers — answers the
service-area question immediately. Plain typing still works exactly as
before, and the whole thing silently degrades to a plain input if the
lookup is unavailable.

## One-time setup (you)

1. In Google Cloud Console create an API key with **Places API (New)**
   enabled. Restrict it to the Places API. It is only ever used
   server-side, so no website restriction is needed (an IP restriction to
   Vercel is optional hardening).
2. Add to `.env.local` AND Vercel env:

```bash
echo 'GOOGLE_MAPS_API_KEY=YOUR_KEY_HERE' >> ~/Documents/paint-group-platform/.env.local
```

Until the key is set, the field behaves exactly like the old plain input —
nothing breaks.

## Steps (5 minutes)

1. Open **/wizard**, type `30 Rod` in the first field.
   - ✅ Suggestions appear (e.g. "30 Rodda Street, Murrumbeena VIC").
2. Pick it.
   - ✅ The field becomes "30 Rodda Street, Murrumbeena".
3. Finish a quick no-plan run. Open the estimate in the builder.
   - ✅ The **Job Address** card is filled: street, suburb, VIC, postcode.
4. Type freehand ("Smith reno job") instead — everything works as before.
5. Customer preview (**/estimate** as staff): type an address in the
   address field, pick a suggestion.
   - ✅ Suburb + postcode fill themselves.
   - ✅ If the postcode is outside the configured service area, the polite
     out-of-area message appears immediately — before any other answers.
6. Rename `GOOGLE_MAPS_API_KEY` in .env.local temporarily and reload —
   the field is a plain input again, no errors anywhere.

Note: the key never reaches the browser — the network tab shows only
`/api/places/*` calls to our own server.

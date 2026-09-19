# Manual test — dark or light in the contractor portal (19 Sep 2026)

Ten minutes, on a phone if you can. Nothing here writes anything you have to undo:
the choice lives in the browser, not in the database.

## Sign in
1. Open the portal as a painter (a contractor login, then repeat as an employed
   painter if you want both). You land on **Home**.

## The switch
2. Top of the screen, between the logo and the company name, there is a **cyan
   circle with a sun (☀) in it** — same cyan as the tab you are on. Press it.
   - The whole screen goes light straight away — header, cards, the tab bar along
     the bottom.
   - The button now shows a **moon (☾)**. The icon is always what you will GET,
     not where you are.
3. Pull down to refresh, or close the tab and open the portal again.
   - It comes back LIGHT, with no flash of dark first. That is the bit worth
     watching: the server is being told the choice, not just the browser.
4. Walk the tabs: **Requests · Jobs · Invoicing · Calendar · Help**. All light.
5. Open a job (**Jobs → any job**). Scroll the whole way down.
   - The work order — the part with the reference number, the materials and the
     scope — is light too, not a black slab in the middle of a light screen.
   - Press **PG-3 … what this means**: the sheet that slides up is readable.
6. Press the moon. Everything goes back to dark, and stays dark on a refresh.

## What to look for — and what to tell me
7. In LIGHT, on each screen: is anything faint, washed out, or invisible?
   Particularly worth a look:
   - the amber "waiting on something" notices (the expense pre-approval card on
     **Invoicing**, the before-photo prompt on a job),
   - the red error and green success strips (try saving your profile),
   - the **Calendar**: today's ring, booked days, days blocked by you (grey
     stripes) and by the office (red stripes), and the legend under it.
8. In DARK: it should look exactly as it did yesterday. If anything changed,
   that is a bug, not a feature.

## The logo
9. If **Settings → Company** has both logos set — the white-lettering one and the
   dark-lettering one — the portal shows the dark-lettering one in light mode and
   the white one in dark. If only one is set, that one is used in both (which may
   look wrong in one of them: the fix is to upload the second logo, not a code
   change).

## What is deliberately NOT included
10. The job link we text a painter (`/w/<code>`, the one that opens without
    signing in), the crew share link, and the office's "view as contractor"
    preview all stay dark. They have no switch of their own and are not part of
    the portal. Say the word and they can follow the same choice.

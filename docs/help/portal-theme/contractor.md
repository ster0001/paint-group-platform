---
feature: portal-theme
role: contractor
title: Switching the portal between dark and light
summary: The round button at the top of every portal screen swaps the whole portal between the dark look and a light one — useful in bright sun or on a site where the dark screen is hard to read. Your choice sticks on that phone until you change it back.
sources: app/portal/layout.tsx, app/portal/portal.css, app/components/ThemeToggle.tsx, lib/theme/cookie.ts
---

## What this is for
The portal arrives dark. That reads well indoors and at night, but on a bright day outside it can be hard to see. The round button at the top of the screen — between the Paint Group logo and your company name — swaps the whole portal to a light look, and back again. It changes nothing about your jobs, your prices or what the office sees; it is only how the screen looks on your phone.

## Before you start
Nothing. It is available the moment you sign in, on every screen, and you can change it as often as you like.

## Steps
1. Look at the top of any portal screen, between the logo and your company name: a cyan circle with a **sun** (☀) in it. The picture shows what you will GET if you press it — a sun while you are in the dark look, a **moon** (☾) while you are in the light one.
2. Press it. The screen changes straight away — the header, the tab bar along the bottom, your job sheets, the calendar, everything.
3. Press it again to go back. There is no Save, and nothing to confirm.

## What the colours and labels mean
- **☀ sun** — you are in the dark look now; pressing it gives you the light one.
- **☾ moon** — you are in the light look now; pressing it gives you the dark one.
- The button is always cyan, the same colour as the tab you are on and the buttons you can press.
- Everything else keeps the meaning it always had. Amber is still waiting on something, cyan still means in progress, green still means done, and the clay/red stripes on your calendar are still days the office has blocked. Only the background changes, not the colour language.

## If something goes wrong
- **It went back to dark on its own.** The choice is remembered by the browser on that phone. A phone set to clear website data when you close the browser, or a "private" tab, forgets it. Signing in on a different phone or a different browser starts dark again — set it there too.
- **Some text looks faint.** Tell the office which screen, and roughly where on it. Both looks are meant to be readable in full sun; a faint patch is a fault worth fixing, not something you have to live with.
- **You cannot find the button.** It is only in the portal — the top of the screen, left of your company name. Job links the office texts you (the ones that open without signing in) do not have it and stay dark.

## Related
- `help-centre/contractor.md` — finding your way around the guides
- `work-orders/contractor.md` — the job sheet the switch also re-colours

# Manual test — R4 uploads, bank alerts, join links

**What changed:** files now have a size and type limit that the *server*
enforces; a change to a contractor's bank details raises an alert on the
Contractors page; and an invite link that never existed returns a proper 404.

Nothing should look different in normal use. About 10 minutes.

## Run these first, in the Supabase SQL editor, in this order

1. `20260905000000_upload_limits.sql`
2. `20260906000000_bank_change_alert.sql`
3. `20260907000000_work_order_contractor_index.sql`

You can paste all three in one go. Nothing breaks if you don't run them — the
alert simply never appears and uploads keep their old (unlimited) behaviour —
but the whole point of this batch is in the SQL.

---

## 1. Uploads still work

1. **Settings → Products** → upload a product photo. ✅ Still uploads.
2. **Settings → Company** → replace the logo. ✅ Still uploads.
3. **Estimate builder** → add a photo to an area. ✅ Still uploads.
4. **Portal as Josef** (`pg.josef.contractor@gmail.com` / `painttest123`) →
   **My profile** → upload an insurance certificate (PDF or a photo).
   ✅ Still uploads, and still shows "Being checked".

## 2. Uploads that should now be refused

5. Find any file over 10 MB that isn't a photo — a big video, say — and try it
   as a **product photo**.
   ✅ You get a plain message ("That file is 240 MB. The limit is 10 MB…") and
   nothing uploads.
6. Rename a text file to `certificate.pdf` and try uploading it as insurance in
   the portal.
   ✅ Refused. This is the one worth doing: the file picker will happily offer
   it, because the name says PDF — the refusal is coming from the check, not
   from the picker.

## 3. The bank alert (the important one)

7. In the portal as **Josef**, go to **My profile → Where you get paid** and
   save a **different** account number to the one on file.
8. As staff, open **Contractors**.
   ✅ A red panel at the top: *"Bank details changed — check before you pay"*,
   showing Josef, the time, and **old account → new account**.
9. Press **I've checked this**. ✅ The alert goes; the page reloads without it.
10. Back in the portal, save the **same** numbers again (no change).
    ✅ No new alert. Only an actual change raises one.
11. Save a different number one more time, and leave the alert sitting there —
    that's what it should look like when you come in on a Monday.

**What the alert is for:** someone who gets into a contractor's login can point
your payments at their own account. Ring the painter on a number you already
had — not one from whatever told you about the change — and confirm it before
the next payment run.

## 4. Join links

12. Open `yoursite/join/somethingmadeup`.
    ✅ A plain **404 Not Found**, not the friendly "this link isn't valid" page.
13. Invite a contractor, copy the link, then **Revoke** the invite, then open the
    link.
    ✅ The friendly *"This link has been cancelled"* page — unchanged. A painter
    holding a real-but-dead link still gets told what happened; only a made-up
    one 404s.

## 5. Nothing else broke

14. Portal → **Requests** and **Jobs** still load for Josef, and **Calendar**
    still blocks out days.
15. Contractors page: verifying a document, setting a tier, and suspending /
    restoring access all still work.

---

## Verified before handing this over (2026-08-17)

| Check | Result |
|---|---|
| `npm test` | 51/51 pass (9 new, on the upload rules) |
| Typecheck | clean |
| Lint | 0 errors (2 pre-existing warnings) |
| `npm run build` | passes |
| `/join/<made-up token>` | **404** (was 200) |
| `/join/<short garbage>` | **404** |
| `/e/<unknown>` unchanged | 404 |

**Not verified by me, because it needs the SQL to be run:** the bucket limits,
the bank alert, and the index. Those are steps 2, 3 and 5 above — the reason the
test script exists.

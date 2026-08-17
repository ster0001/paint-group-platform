# Manual test — R4 uploads, bank alerts, join links

**What changed:** files now have a size and type limit that the *server*
enforces; a change to a contractor's bank details raises an alert on the
Contractors page; and an invite link that never existed returns a proper 404.

Nothing should look different in normal use. About 10 minutes.

## The SQL — run 2026-08-17 ✅

`20260905000000_upload_limits.sql`, `20260906000000_bank_change_alert.sql`,
`20260907000000_work_order_contractor_index.sql` are applied to the live
database, and the results below were tested against it afterwards.

**There are two bank alerts waiting for you on the Contractors page** — I made
them while testing, by changing Josef's account number and then changing it
back. His details are exactly as they were. Clearing those two is step 9.

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

## Verified against the live database (2026-08-17, after the SQL was run)

Signed in as Josef with the anon key — exactly what a browser gets, no
special access.

| Check | Result |
|---|---|
| Re-saving identical bank details | no alert raised |
| Changing the account number | exactly one alert |
| The alert records the previous account | `prev_last4` = the old number ✓ |
| `first_time` on a change to an existing account | false |
| Contractor acknowledging their own alert directly | permission denied |
| Contractor forging an event row | permission denied |
| `acknowledge_contractor_event` called by a contractor | `error:not_staff` |
| HTML uploaded as a `.pdf` certificate | refused — *mime type text/html is not supported* |
| A 20 MB certificate (limit 15 MB) | refused — *object exceeded the maximum allowed size* |
| A genuine small PDF | still uploads ✓ |

11/11. Josef's original bank details were put back afterwards and the test file
deleted from storage.

Also checked before the SQL: `npm test` 51/51 (9 new, on the upload rules),
typecheck clean, lint 0 errors, `npm run build` passes, and `/join/<made-up>`
returns **404** where it used to return 200.

**Still worth your eyes**, because they need a staff login or the SQL editor:
the alert panel itself (steps 8–9), and the index —
`explain analyze select * from work_orders where contractor_id = '<a real id>';`

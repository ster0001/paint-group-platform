# Manual test — the estimate is a snapshot, editing is deliberate

About 5 minutes. Sign in as staff (`pg.sam.staff@gmail.com`).

## 1. A saved estimate opens as the customer's copy

1. Go to **Estimates** and open any saved estimate.
2. ✅ It opens on the **ESTIMATE** tab, not the builder.
3. ✅ You see the dark customer document — the same page they'd open at their link.
4. ✅ The blue bar above it reads **"The customer's copy · exactly what they see
   at their link."**

If the estimate has never been sent, the bar instead reads **"Not published
yet · a preview"** — nothing has been published, so there's nothing to match.

## 2. Editing has to be asked for

5. Click **Edit estimate** (top right of the blue bar).
6. ✅ You land on the **BUILDER** tab.
7. ✅ An amber bar warns: **"Editing a published estimate · the customer can
   already see this quote. Saving republishes it to their link."**
8. ✅ The **Save** button is now visible (it isn't on the ESTIMATE tab).
9. Click **Back to the estimate** — ✅ you return to the customer's copy.

## 3. Saving republishes, and both views agree

10. Go back to **Edit estimate**, change something visible — e.g. an area name.
11. Press **Save**, then switch to the **ESTIMATE** tab.
12. ✅ Your change appears — no page reload needed.
13. Open the customer's own link in a private window:
    the estimate's share link is `/e/<share token>` (use **Send / copy link** if
    you don't have it).
14. ✅ The customer sees the same change.

**The point of the test:** staff and customer are looking at one published
document. If step 12 and step 14 ever disagree, something is wrong.

## 4. An accepted estimate is locked

15. Open an estimate whose status is **accepted**.
16. ✅ The header shows **"Accepted · locked"**.
17. ✅ There is **no** Edit estimate button — a signed quote can't be changed.
18. ✅ The **WORK ORDER** tab still works, and **Issue to contractor** still
    functions. That's intentional: the lock protects the customer's quote, not
    the crew's paperwork.

## What to report if it fails

Note which numbered step, what you saw instead, and whether the estimate was
draft / sent / accepted — the behaviour differs by status.

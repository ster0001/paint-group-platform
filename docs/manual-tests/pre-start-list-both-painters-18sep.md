# Manual test — the pre-start list on an employee's job and a contractor's (18 Sep 2026)

**What you asked for:** "In PC command the pre-start checklist has been removed from employees. This still needs to happen for both employees and contractors."

**Before you start:** migration `20270173000000_pre_start_list_always_exists.sql` must be pasted into production (it is in the PR body). Until it is, only the screen-side heal is live.

---

## 1 · An employee's job has the list

1. **Projects → Schedule.** Drag a job out of the tray onto an **employee's** lane. Confirm **Assign job**.
2. Open that job (**Projects → the job**, or the lane block → the job link).
3. The stage rail reads **02 Pre-start**, and the **Pre-start** card is on the page with:
   - Colour schedule finalised (Yes / No)
   - Materials ordered
   - Equipment movements booked
   - Access details recorded
   - Pre-start checklist (optional)
   - SWMS / induction attached (commercial and body corporate only)
4. The counter reads **N TO GO**. Tick through it as normal — this is the same card, word for word, as a contractor's job.

## 2 · A contractor's job is identical

1. Drag another job onto a **contractor's** lane and send the offer; accept it as the contractor (or move the job to Pre-start from the job page).
2. Open the job. The **Pre-start** card carries exactly the same items.

## 3 · A second painter on a job already under way

1. On the employee job from step 1, drag the same job onto a **second employee's** lane and assign.
2. Open the job: the Pre-start card is still there, unchanged, and nothing was wiped.

## 4 · The job can no longer start without a list

You cannot easily create a listless job by hand — that is the point. What you can check is the wording if one ever appears:

- A job at Pre-start whose list is missing shows a **Pre-start · list not built** card instead of silence, and **Next step** refuses with *"the pre-start list has not been built for this job yet"*.
- The painter's **Ready to start?** card says the office has not set the list up yet, and **Start the job** stays locked. It used to say "everything on the pre-start list is ticked" and start the job.

## 5 · Opening a job repairs it

If any job in production is sitting at Pre-start with no list today, simply **opening it in Projects builds the list as the page loads** — no button. The migration also builds one for every job currently sitting at stage 1 or 2 without one, and tells you how many it made.

---

**What I could not reproduce:** on the test project an employee assignment has always produced the same six pre-start rows a contractor's acceptance does — I assigned a real employee through the real `assign_job` and got the full list. So I could not see the screen you saw. What I found instead is the hole that would produce it, and closed it from three directions: the list is now built at issue, at assignment, and on view, and a job without one is refused instead of started. If you can tell me the job (the WO ref, or the address), I can say exactly which of those it hit.

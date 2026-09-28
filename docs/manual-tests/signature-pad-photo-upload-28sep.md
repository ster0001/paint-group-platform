# 28 Sep 2026 — drawn sign-off, remote sign-off explained, one uploader for site media

**SQL first:** `20270202000000_wo_sign_drawn_signature.sql` on production and the test project.
Read-back one row: `signature_col` true, `drawn_fn` 1, `remote_gate_softened` true, `anon_can_sign` true.
Until it runs, the customer's Sign off button says "Signing isn't switched on yet — please give us a call".

## 1 · The customer signs in a box
1. A job at Walkthrough; open the customer link (or the painter's Start the walkthrough).
2. Approve every area. The typed-name box is gone: a signature pad with **Clear**, and **Sign off the job**
   disabled until something is drawn. Draw → sign. Expect "Signed off — thank you, <accepted name>" (or
   "thank you." when the job has no name on record) with the drawing shown under it; `wo_signoff.signed_name`
   = the estimate's accepted name, `wo_signoff.signature` = a PNG data URL.
3. The staff **Record sign-off manually** on the PC page still takes a typed name (that is the office's record).

## 2 · Remote sign-off from the customer's own link
1. A job at Walkthrough with NO final walkthrough booked (or one booked for a past day): the customer's
   link signs. Before: refused with a blank "We couldn't record your sign-off".
2. A final walkthrough booked for today or later: the page says "Your final walkthrough with the painter is
   still booked — sign-off happens there. If you can't make it, give us a call…". **Customer can't attend**
   on the PC page opens it.

## 3 · Photos and videos upload with a reason when they don't
1. Painter: before / finished photo on a tick, a Photos & notes photo or video, a variation photo — all go
   through one path. A refused file now says why ("The photo store won't take a … file", "too big",
   "refused this job's folder") instead of "check your signal".
2. A phone photo whose type the browser leaves blank (some Android HEIC) now uploads: the type is filled
   from the file name.

## Gates
- Unit: `lib/workorder/uploadMedia.test.ts`.
- e2e: `wo-signoff`, `wo-sign-return`, `wo-flag-then-approve`, `wo-full-loop` step 10, `employee-loop`
  (all now draw), `wo-photos`.

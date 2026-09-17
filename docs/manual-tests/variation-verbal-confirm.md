# Manual test — variation link reaches the customer; verbal approval recorded by the office

**Branch:** `fix/variation-send-and-verbal-confirm` · 2026-09-17

## Before you start — one bit of SQL

Paste `supabase/migrations/20270158000000_variation_verbal_confirm.sql` into the
Supabase SQL editor and run it. **Read the output**: it should print SEVEN rows —
four `function` rows (`wo_variation_apply_approval`, `wo_customer_sign_variation`,
`wo_staff_confirm_variation`, `wo_variation_by_token`), all `security_definer = true`,
and three `column` rows (`verbal_confirmed_at`, `verbal_confirmed_by`, `verbal_note`).
Fewer rows means the tail did not apply — say so rather than carrying on.

Then check `select name, applied_at from public._prod_migrations where name like '20270158%'`
returns one row.

Without the SQL, the console's "confirm on their behalf" button answers
"Could not find the function" and the customer page cannot tell a phone approval
from a signature. Everything in section 1 works without it.

---

## 1 · The signing link finds the customer (1/41 Devoy Street)

1. Sign in as staff. Open **Projects**, then the 1/41 Devoy Street job.
2. Find the variation card at **PRICED** ("… with the customer. Waiting on their answer").
3. Press **Email the link**.
   - The line above the buttons now says exactly what happened. Expected: **"Signing link emailed."**
   - If it says **"Email suppressed: Customer switched off email for job updates in their account."** the customer turned job alerts off in their portal — that is why nothing arrived. Text it instead, or ring them.
   - If it says **"No email on the estimate's contact — add one on the estimate, or text it instead."** the job has no email anywhere (builder contact, sent snapshot, or linked account). Open the estimate, add the email, come back.
   - It must never say "Nothing went out — check the contact's details" any more.
4. Press **Text the link**. Expected: **"Signing link texted."** or a reason in words.
5. Open **CRM → the customer's record → Messages**. The signing link email/text is listed with today's time.

## 2 · Pricing tells the truth about the auto-email

6. On a job with a **RAISED** variation, press **Quick price — hours only**, enter hours, press **Price through the engine**.
   - With an email on the job: **"Priced — the signing link has been emailed. Text it too below if you like."**
   - With no email on the job: **"Priced. No email on the estimate's contact — …"** (the old text claimed it had been emailed regardless).
   - With no photo on a non-credit variation: **"Priced. Attach a photo of the change first — the customer signs what they can see."**

## 3 · Confirm on the customer's behalf (verbal approval)

7. On a **PRICED** variation card there is a new button: **Customer approved by phone — confirm on their behalf**. Press it.
8. First prompt: **Who gave the approval? (their name)** — type the customer's name. Cancel here = nothing happens. Blank = "Say who gave the approval — their name goes on the record."
9. Second prompt: a note for the record (optional) — e.g. "Phoned 17 Sep, happy to go ahead".
10. Expected line on the card:
    **"Recorded as approved by phone by [name] — released to the painter. Confirmation: email sent, text sent."**
    - "released to the painter" appears only when Settings → Automations "Approved variations go straight to the painter" is on (the default). Off: the **Release** button appears instead, as after a signature.
    - "Confirmation: …" lists what went to the customer. Email only if there is no mobile; text only if there is no email.
11. Reload the page. The card now reads **"✓ Approved by phone — [name], recorded by the office on 17 Sep 2026 · “your note”"** — never "Signed by".
12. The painter's portal shows the variation as approved, exactly as after a signature (and receives the "variation waiting on you" text when released).

## 4 · What the customer receives

13. Check the customer's inbox: **"Confirmed: the change you approved on [address] — Paint Group"**. It names who approved it, the date, the amount, the change in the painter's words, and says to reply or call if that isn't right. The button **See the change** opens their variation page.
14. Check their phone: **"Paint Group: confirming extra work adding $X to your job total on [address], approved by phone on [date]. Details: [link]"**.
15. Open the link (or the button). The page reads **Approved — thank you** and under it **"Approved by phone by [name] on [date], recorded by our office. If that isn't right, reply to the confirmation email or give us a call."** No signature box.

## 5 · Refusals

16. Press the confirm button on an already-answered variation (press it twice quickly, or on one the customer signed): **"This one has already been answered."**
17. There is no confirm button on a **RAISED** (unpriced) card — the customer can only approve a figure. Price it first.
18. A signature on the customer's link still works exactly as before (the shared approval step is the same function underneath): sign one on a test job and check the painter release and any credit strike behave as they did.

## 6 · Automations page

19. **Settings → Automations → Customer** lists **"Variation — your phone approval, in writing"** as a manual send with its trigger and wording described. It has no switch: it goes out whenever the office confirms on the customer's behalf.

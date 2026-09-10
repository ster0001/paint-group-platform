# Tom's 10 Sep batch — handover

**Written:** 10 September 2026, on `fix/tom-batch-10sep`.
**Why:** Tom is switching models for the last three items. This is what I know
that would otherwise cost an hour each to rediscover.

---

## Done and pushed (5 of 8)

| # | Item | Where |
|---|---|---|
| 1 | Login: no self-signup, Name box gone | `app/login/page.tsx`, `app/auth/actions.ts` |
| 2 | Estimates page fits the screen | `app/(app)/estimates/EstimatesTable.tsx`, `WizardPill.tsx` |
| 3 | Capture button works on a NEW estimate | `app/quote/QuoteBuilder.tsx` |
| 4 | Adding a substrate no longer opens its folder / raises the iPad keyboard | `app/quote/QuoteBuilder.tsx` |
| 5 | Capture: every substrate in every area; per-item tiles are countable | `lib/capture/presets.ts` |

Two of those were one cause each — see the commit messages, which carry the
reasoning rather than the diff.

---

## Left (3 of 8)

### A · "Speed up photo upload without reducing the quality"

**What I found before stopping.** Uploads already go STRAIGHT to storage on a
signed URL (`app/api/extract/upload-url` → `supabase.storage.uploadToSignedUrl`),
so there is no server hop to remove. `MAX_UPLOAD_BYTES` is **25 MB**
(`lib/extract/normalise.ts:35`). **There is NO client-side downscaling anywhere
in the app** — I grepped for `createImageBitmap` / `canvas` / `toBlob` and found
none. A modern phone photo is 3–6 MB at ~4032×3024, and that is what goes over
the wire today.

**Measure before changing anything.** The honest first step is a timing on a
real phone photo over a real connection, not a guess about where the seconds go.

**Then, in the order I would try them:**

1. **Upload in PARALLEL.** Several call sites upload files in a `for` loop and
   await each one. Concurrency is free speed and changes no pixels.
2. **Start on CHOICE, not on submit.** `RoomSpots` already does this
   (`app/estimate/scope/RoomSpots.tsx` — the upload begins when the photo is
   chosen, so the slow part happens while the customer reads the next question).
   Other call sites do not.
3. **Downscale — but only where the pixels are never consumed.** ⚑ This is the
   big win and it needs Tom's ruling, because he said "without reducing the
   quality". The honest argument is narrow: photos that exist to be READ by the
   plan reader or the defect reader are downsampled by the model anyway, so
   uploading 4032 px is quality that never reaches anything. Photos that exist
   as EVIDENCE — site photos on a work order, before/after, anything that could
   end up in a dispute — must keep their original. **Do not blanket-compress.
   Ask which is which.**

### B · Staff notifications

**⚑ Do not build a second system.** There is already an automations registry
with exactly this shape:

- `lib/automations/registry.ts` — every automated message, keyed, with
  `audience: "customer" | "painter" | "office"` (**"office" already exists**),
  `channels: ("email" | "sms" | "ics" | "pdf")[]` and
  `kind: "automatic" | "manual" | "planned"`.
- `app/(app)/settings/AutomationsSettings.tsx` — the per-send on/off switches.
- `lib/messaging/send.ts` — `sendEmail` / `sendSms`. **Every send goes through
  here and is recorded in `messages`**, with the customer's alert settings
  honoured and suppression recorded. New code must go THROUGH it, not around it.

So Tom's ask is: add the office/staff events he listed (contract accepted, job
approved, job declined, invoice paid, variation requested, contractor invoice
made), and make each one routable **per staff member**.

**The two things that do not exist yet:**

1. **A staff phone number.** `profiles` has `id, name, role, is_owner,
   staff_access, contact` — `contact` is a single TEXT column holding an email.
   There is no phone, so the SMS option needs a migration. Consider whether
   `contact` should become jsonb (`{email, phone}`) or a new `phone` column —
   the second is smaller and safer.
2. **A per-event → staff map.** Follow the existing shape rather than inventing
   one: `staff_access` on `profiles` is already a jsonb map of what a login can
   see (`lib/staff/access.ts`). A sibling `staff_notify` jsonb —
   `{ invoice_paid: ["email","sms"], job_declined: ["email"] }` — keeps it on
   the person, which is where "which staff member sees each of these" belongs,
   and needs no join table.

**Watch for:** the events Tom named fire in several places already (accept →
work order, invoice paid, variation approved). Find the existing emitters
before adding new ones — `lib/crm/events.ts` and the work-order loop already log
most of these, and a notification should hang off the event that is already
recorded rather than a second trigger that can disagree with it.

### C · "The full software doesn't work in mobile view — scrolling goes to a black screen"

**I have no lead on this one and did not want to guess.** What I know:

- `app/(app)/layout.tsx` is the staff shell: `flex min-h-screen`, sidebar as a
  fixed off-canvas drawer under `md`, content `min-w-0 flex-1 pt-[52px] md:pt-0`.
- A black screen on scroll usually means a fixed/absolute layer with a dark
  background is being scrolled OVER the content, or a `100vh` element plus the
  mobile URL bar. The wizard shell (`.wz`) paints a dark ground; the staff app is
  `bg-gray-50`. A dark full-bleed layer appearing on a staff page would be worth
  looking at first.
- **Start by asking Tom WHICH page** — "the full software" could be the staff
  app, the PC console or the portal, and they have different shells.

---

## ⚑ Traps that will cost you an hour each

1. **Never free port 3101 while an e2e run holds it.** `scripts/c1/run-e2e.sh`
   now refuses to start if the port is held — that guard exists because a stale
   server made every spec assert against the PREVIOUS build, twice. I also
   invalidated a 71-spec run by killing the port for another run: it reported 59
   failures that were all the same missing server.
2. **C1's `wizard_public` flag gets left OFF.** `holding-and-honest-defaults`
   toggles it to test the holding page and restores it in `afterAll`; kill that
   run and every wizard spec then hits "Opening on 28 September". Check
   `settings.wizard_public` before believing a mass wizard failure.
3. **Long C1 runs fail LATE for environmental reasons** — the anon-session
   limit, plus ~800 accumulated leads. A spec that fails in a 45-minute suite and
   passes alone in 6 seconds is telling you about the stack, not the code.
4. **Do not `npm run build` before `run-e2e.sh`** — a production-env build can
   leave the client bundle pointed at PRODUCTION Supabase.
5. **`AGENT_MODEL_STUB=1`** is what CI sets; the assistant specs need it and
   there is no `ANTHROPIC_API_KEY` in `.env.test.local`.
6. **eslint is ratcheted at 4 warnings** in `.github/workflows/ci.yml`. Lower it
   when you clear some; never raise it.

---

## Where things are

Branch `fix/tom-batch-10sep`, off `main` at `ba191a2`. 2,059 unit tests green,
tsc and eslint clean, production build green. Nothing is uncommitted.

Everything from estimator journey v2 phase 2 is already merged (PRs #53, #54,
#56, #57) — see `docs/briefs/estimator-journey-v2-phase2.md`.

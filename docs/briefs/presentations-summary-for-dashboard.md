# Presentations — summary for the home dashboard build

The full presentations brief (`claude-code-brief-presentations.md`, Aug 2026) is not in this repo. If it is not found on Tom's machine, treat it as one of the lost briefs and proceed on this summary, which is all the dashboard build needs.

**What presentations are.** Settings → Presentations holds multiple presentations. Exactly one is ticked per job type (commercial, residential interior, residential exterior, and any others Tom adds). A presentation injects content blocks into the customer-facing estimate view: video, before/after pairs, three review slots, and attachments (public liability certificate, SWMS). The commercial presentation shipped pre-written from the approved mockup copy.

**What the dashboard needs from them (brief v2, Part B1).**
- `estimates.presentation_id` — set on the send action from the presentation ticked for the estimate's job type.
- `presentations.category_label` (text, default = the presentation's name, editable) — Sales, P&L and Marketing group by this label, never by id, so a rewritten presentation does not split history and two presentations may share a label.
- `accounts.category` — set from the first presentation sent to that account when the account has no category (Tom's ruling 19 Sep: online enquiries that arrive without a category are categorised from the presentation sent). Never overwritten afterwards.
- Adding a presentation in Settings must make its label appear in every category breakdown with no code change; estimates with no presentation report as "Uncategorised".

If the presentations table or the job-type tick does not exist as described, stop and report — do not invent the model.

---

**As built (session 0a, 19 Sep 2026).** The presentations table exists as described, with `is_default`; the tick is **per estimate** in the builder (Job settings → Presentation), not per job type — that per-job-type tick was never built, and the dashboard does not need it. `category_label` and `accounts.category` are live (`20270175`). `estimates.presentation_id` is whatever the builder ticked at the time of sending; no tick reports as "Uncategorised". A per-job-type default remains a ⚑ for the presentations module, not this one.

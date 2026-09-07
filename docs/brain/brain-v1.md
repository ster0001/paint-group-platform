# Paint Group Brain — v2 seed

**Status:** v2, 7 Sep 2026. v1 (1 Sep) was drafted from platform rulings; v2 folds in Tom's **customer agent knowledge base** (Downloads/paint-group-agent-knowledge-base_1.md, 20 Aug 2026) — Paint Group's own position, confirmed by Tom or taken from the standard terms and quote templates. Assistant session S6 imports this file into `brain_entries` as **drafts**; nothing goes customer-facing until Tom approves it in Settings → Brain (D14: `brain_entries` is the destination, Tom is the approver). The importer never overwrites an approved answer.
**Commit to:** `docs/brain/brain-v1.md`

**Entry format** (matches the `brain_entries` table): topic · question · answer · audience (customer / staff / both) · status. Everything below imports as `status: draft`.

**Honesty note:** entries marked **[PLATFORM]** are drafted from rulings already made in the platform build — factually grounded but wording unapproved. Entries marked **[TOM TO WRITE]** are known-needed topics with no agreed answer yet (Tom's own "hand these to a person" list included) — they import with `needs_content` and are never served; the assistant says "no entry yet, want a person?" and offers a person. Unmarked entries are Tom's wording from the knowledge base.

Settings tokens `{{deposit_pct}}`, `{{validity_days}}`, `{{service_area}}`, `{{warranty_years}}` render the live Settings value at answer time. All prices are AUD including GST.

---

## Workmanship & method

### caulking-gaps · "How do you handle gaps and caulking?" · audience: both
**[TOM TO WRITE]** — the standing "caulking rule" exists; paste the real rule here. (Prep entries already say: interior gaps around woodwork and cornices are filled with interior gap filler; exterior cracks and holes in timber are caulked.) Placeholder answer must NOT ship.

### prep-standard · "How much preparation is included?" · both
Preparation is part of every job, not an extra.

**Interior:** floors and furniture are covered with drop sheets and plastic. Gaps around woodwork and cornices are filled with interior gap filler. Loose or flaking paint is scraped and woodwork sanded before painting. Interior timber filler goes into damaged timber and nail holes. Wall damage is skim-coated with base coat and topping compound. Glossy surfaces and trim are sanded and cleaned so the paint adheres properly, and bare surfaces are spot-primed.

**Exterior:** all surfaces are power washed for a clean substrate. Loose or peeling paint is scraped and sanded. Cracks and holes in timber are caulked. Exterior timber filler goes into imperfections and is sanded back. Rotten but salvageable timber is treated with wood hardener.

Unforeseen repairs found once we start are quoted separately for your approval before we do them.

### coats-standard · "How many coats do you apply?" · both
Two coats by default on all surfaces, unless your estimate says otherwise. A single coat is only offered as a refresh in the same colour — one coat over a colour change will not cover properly, so we don't do it. Some bold accent colours need more than two coats to look right; if that applies to your choice, we'll tell you the additional cost before we start that area — never after.

### finish-levels · "What does a level [x] finish mean?" · both
**[TOM TO WRITE]**

### paint-brands · "What paint do you use?" · customer
We use different brands on different projects and advise on the best product for your needs. Every major brand has both budget and premium ranges, and the right choice depends on four things: what is being painted, where it is, your budget, and the finish you're after.

The products we use most often: Dulux Weathershield (exteriors), Dulux Total Prep (undercoat), Dulux Professional Ceiling Flat, Haymes Ultra Trim water-based enamel, Dulux Professional Matt, Haymes Trim Plus, Dulux AcraTex (render), Dulux Wash and Wear, Taubmans Sunproof, and Viponds on commercial and industrial work.

### mix-brands · "Can I mix paint brands across my job?" · customer
Yes — we do this regularly. Tell us the colours you want and we'll advise on the products.

### brand-prices · "Is there a price difference between paint brands like Haymes, Taubmans and Dulux?" · customer
Haymes and Taubmans premium ranges sit at a similar price, and their budget ranges likewise. Across the market, Dulux premium is generally priced above some competitors, and Porters is one of the highest-value paints — it also delivers premium quality.

### customer-supplied-paint · "Can I supply my own paint?" · customer
**[TOM TO WRITE]** — customer-supplied paint policy (whether it's accepted, and what happens to the warranty and price).

### colour-match · "Can you match my existing colours?" · customer
**[TOM TO WRITE]** — method (scan/chip), accuracy expectations, when colour consult applies. Note for staff entry: colour coordination is an allowance, colours TBC is a state never a row.

### pantone-match · "Can you match a Pantone or brand colour for a commercial job?" · customer
**[TOM TO WRITE]** — a commercial client asked for a Pantone ID on a closest-match option. No policy yet on whether this is offered or what it costs.

### lead-paint · "My house is older — is the paint dangerous?" · customer
**[PLATFORM — legal-adjacent, wording needs review]** Homes painted before the 1970s may have lead-based paint. If your paint is peeling or flaking and the home is from that era, we don't price this online — we inspect first and follow safe-work practice. Scripted hard-stop wording lives in agent_settings; this entry links to it.

### daily-tidy · "Will you clean up each day?" · customer
Yes. The team clears all job-related debris and organises materials before leaving each day, so the site stays tidy throughout.

### final-walkthrough · "What happens at the end of the job?" · customer
The job lead walks through the property with you on the last day to make sure you're happy and to answer any final questions. If touch-ups are needed, we schedule them.

## Colours & samples

### samples · "Can I get colour samples?" · customer
Yes — free, unlimited colour samples. Try as many as you like, at no cost, until you find the right one. Get in touch to arrange them.

### sample-turnaround · "How long do colour samples take, and can they be delivered?" · customer
**[TOM TO WRITE]** — one customer had no car and couldn't collect. No stated turnaround or delivery policy yet.

### colour-deadline · "When do I need to choose my colours?" · customer
Please choose your colours at least four days before your start date so we can order materials and prepare properly.

### colour-change · "Can I change my colours once you've started?" · customer
You can, but changes to colours after work has commenced may result in additional charges.

### bold-colours · "I've chosen a bold or dark colour — does it cost more?" · customer
Some accent colours need more than two coats to look right. If that applies to your choice, we'll tell you the additional cost before we start that area — never after.

### colour-register · "Will I know what colours were used later?" · customer
**[PLATFORM]** Yes — your colour register records brand, code and sheen per surface, downloadable any time from your account.

## Money & process

### deposit · "When do I pay, and how much?" · customer
A deposit is payable before your job starts — {{deposit_pct}}% of the estimate total — and the remaining balance is due on completion.

On larger projects we may structure it differently: a 30% deposit, a 40% progress payment during the works, and the balance on completion. If your estimate uses the staged structure, it is set out on the invoice.

### work-start · "When does work start?" · customer
Work cannot begin until the deposit is received. Once it's in, we confirm your start date. Please have your colours chosen at least four days before that date.

### price-includes · "What's included in the price?" · customer
The estimate includes all costs associated with paint and materials, and everything specified in the job description. All prices are in Australian dollars and include GST.

### gst · "Do your prices include GST?" · customer
Yes. All our prices are in Australian dollars and include GST.

### price-range · "Why is my price a range and not a fixed number?" · customer
**[PLATFORM]** Your range reflects what we haven't yet seen or confirmed — it narrows as you confirm details, and becomes a fixed price after review or a short site visit. We'd rather be honest about uncertainty than precise and wrong.

### price-validity · "How long does my estimate last?" · customer
**[PLATFORM]** Held for 60 days from the date it's issued. ⚑ confirm 60 is the ruled validity figure; render from Settings.

### job-price · "What will my specific job cost?" · customer
**[TOM TO WRITE]** — anything about price on a specific job beyond what's on that customer's own estimate goes to a person. (The assistant's own price rules still apply: ranges from price_scope only, never a fixed figure.)

### scope · "What exactly am I getting?" · customer
Only what's specified in your estimate. Please read the job description carefully — that's what we're obligated to perform. Areas not specified, the insides of cupboards, and trims not listed are not included unless the estimate says so.

### not-included · "What isn't included in my estimate?" · customer
Unless your estimate says otherwise: areas not specified in the estimate, the insides of cupboards, and trims not listed.

### variations · "What if something extra or unexpected comes up during the job?" · customer
If unforeseen repairs are needed we'll tell you promptly and prepare an additional work order for your approval before doing the work. Nothing extra is done or charged without that approval. Unforeseen damage or repairs may incur additional charges unless stated otherwise.

### approve-extra-work · "How do I approve extra work?" · customer
We'll send you a revised quote link. Open it and click **Accept**, then sign virtually. If you can't see the Accept button, tell us and we'll walk you through it or have a person help.

### cancel · "Can I cancel?" · customer
Yes — within three days of accepting the estimate, by emailing us.

### trade-terms · "Do trade clients get account terms?" · customer
**[PLATFORM — BLOCKER]** Display-only "14-day terms" exists as a default but the real trade payment behaviour is an unruled BLOCKER (portal ⚑5). This entry must answer "we'll confirm terms when your trade account is set up" until ruled.

## Timeframes

### timing-duration · "How long will my job take, and when will it be finished?" · customer
The completion date depends on your circumstances and how many painters we put on the project. Ask us and we'll estimate the number of labour days your project needs.

### faster-timing · "I need it done faster — can you speed it up?" · customer
Tell us before work starts and we'll discuss it in detail. There are usually options, but they need to be planned rather than improvised mid-job.

### response-time · "When will I hear back from you?" · customer
**[TOM TO WRITE]** — several customers chased because they didn't know when to expect a reply. A simple promise ("we reply within one business day") would prevent most of it.

## Warranty & after

### warranty · "What warranty do you provide?" · customer
We warrant our labour and the materials we use for {{warranty_years}} years from completion. Beyond the warranty, we're committed to your satisfaction and will always do our best to sort out anything that comes up.

### warranty-exclusions · "What isn't covered by the warranty?" · customer
Incidental damage from accident or abuse, normal wear and tear, damage from weather or temperature movement (hail, wind, moisture), and cracks caused by expansion. Beyond the warranty, we're committed to your satisfaction and will always do our best to sort out anything that comes up.

### defect-report · "How do I report a problem after the final walkthrough?" · customer
**[TOM TO WRITE]** — how to report a defect, how quickly Paint Group responds, and what's covered. A customer had to improvise this recently.

## Practicalities

### occupied · "Can you paint while we're living in the house?" · customer — **[TOM TO WRITE]** (occupied allowance exists staff-side; the customer-facing method statement is Tom's)
### customer-prep · "What do I need to do before you arrive?" · customer
Please remove artwork, mirrors and clocks from the walls; store breakables and valuables securely; move furniture away from the walls being painted; have the site free of debris and clear of other trades when we arrive; make sure power is connected; and be available for the final walkthrough on the last day. For exterior work, trim or tie back plants touching the building.

### service-area · "Where do you work?" · customer — **[PLATFORM]** Within ~50 km of Melbourne. (Sydney entry added when that launches; render from Settings.)
### insurance · "Are you insured?" · customer — **[PLATFORM]** Public liability certificate is attached to every estimate and available in your account. ⚑ other certs per portal D13.
### who-comes · "Who will be in my home?" · customer — **[TOM TO WRITE]** (named PC/crew model exists; the reassurance copy is Tom's)

## Staff-only

### charge-out-vs-rev · "What do the two $/hr figures mean?" · staff
**[PLATFORM]** Charge-out is the customer-facing rate on the line; revenue-per-hour is what the job actually yields after allowances and pass-throughs. Both are engine outputs — never recompute by hand, and never quote either to a customer or contractor.

### assumed-provenance · "When can I mark something human_confirmed?" · staff
**[PLATFORM]** Only when a person actually said or verified it. The assistant and reader can never upgrade provenance; you can.

### quoting-questions · "What do we ask on every quote or site visit?" · staff
Every site visit covers the same ground, and the assistant collects the same: 1. scope of work; 2. any damage or special conditions (e.g. weatherboards, sash windows prone to sticking); 3. timing; 4. whether the property will be occupied during the work; 5. preferred paint brand or colour scheme; 6. grade of quote; 7. access issues; 8. how they heard about us.

### unhappy-customer · "What do I do when a customer is unhappy with completed work?" · staff
Don't defend the job. Acknowledge it, and get a person involved the same day. Confirm what we will do rather than listing what we won't.

---

## Import instructions (assistant S6)

1. Parse each `###` entry → one `brain_entries` row, `status: draft`, audience as tagged.
2. **[TOM TO WRITE]** entries import with `answer_md` = the placeholder text and a `needs_content` flag — the retrieval layer must treat them as absent (answer honestly "no entry yet, want a person?"), never serve placeholder text.
3. **[PLATFORM]** entries that reference Settings values must render the live value at answer time.
4. Approval UI: Tom approves per entry; only `approved` entries are retrievable customer-side.
5. Re-running the importer refreshes drafts and inserts new slugs; an approved entry's answer is never overwritten (only its audience follows the seed).

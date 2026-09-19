# Decisions and rulings — Paint Group platform

Locked rulings and engineering principles. Read before revisiting any settled decision. Claude Code sessions must not re-litigate anything here; raise a ⚑ instead.

## Engineering and process principles
- One source of truth for everything: one event log, one segment evaluator, one work-queue evaluator, one identity model, one storage adapter, one messaging adapter. No module builds its own list, badge or attention surface.
- Calibration before customers: the pricing engine must be validated against real worked hours (not just PaintScout estimates) before real customer quotes are sent.
- Briefs are committed to the repo the day they are produced. Briefs that exist only in chat are at risk of loss — this has happened.
- Briefs record design rulings explicitly so later sessions cannot revisit settled decisions.
- Session ledgers are updated at the end of every session.
- Migrations run between gate runs, never during one.
- Stop-and-report rule: halt rather than proceed on a missing reference.
- Test hygiene: anonymous auth accumulation is a real operational risk; teardown, sweep and row-count tripwires are required in CI.
- Concurrent sessions use isolated git worktrees with separate ports and full installs.
- Rate card units are critical; golden regression tests for per-item charge-out lines are required.
- Design must feel distinctive, not generic SaaS; it should reflect the practical reality of running a trade business.
- Warranty liability stays with Paint Group; back-charge mechanisms need contractor agreements and legal review before use.
- Money is integer cents end to end; role views are served explicitly by RLS and a `view=` parameter, never inferred.

## Ways of working
- Visual-first: mockups reviewed on Tom's phone before technical briefs; mobile rendering is a primary design consideration.
- Tom has direct design authority; rulings are recorded and binding.
- Claude designs and plans; Claude Code implements. Kickoff ritual: commit the reference files, confirm the list back, then code.
- Walking-skeleton-first builds; acceptance criteria include adversarial API-level gate tests.
- Open decisions are flagged with ⚑; only blocking decisions halt progress.
- Every time a module is completed, the plan is revisited so all moving parts still fit together toward one end-to-end platform.

## Home dashboard rulings (19 Sep 2026)
- The dashboard is the home page for every staff member and the long-term source of truth; one page, different sections per staff role.
- Eight sections: Sales, Sales activity, PC Command activity (every tile clickable to the records), Invoicing, Contractor, P&L, Where estimates go, Marketing.
- Average order value is categorised by the presentation on the estimate, grouped by a category label on the presentation (not its id); adding a presentation creates a new category automatically; an account whose online enquiry carries no category is auto-categorised from the first presentation sent.
- Monthly sales target set in Settings; dashboard shows $ and % hit month by month.
- P&L runs off the existing Settings overhead values until the MYOB integration; "revenue received" = the payment-received status change in invoicing.
- All data date-filterable; list data exportable to CSV; built to grow from.
- Light mode is the build target (`home-dashboard-light-mockup.html`).
- All Part B data-capture changes in brief v2 are accepted.
- Worked hours are captured per contractor by an opt-in flag (Tom chooses who is asked days and hours at the final DONE tick). The dashboard blends entered hours with schedule-derived figures for everyone else, always showing the source; the calibration table uses entered rows only.

## Estimator, homepage and trade portal rulings (selected)
- A price is never fixed by the wizard alone; a person signs it off with the customer.
- Customers must be present for the sign-off walkthrough; remote sign-off is never advertised.
- Painter cards show no ratings and no job counts.
- Retail includes hospitality; every school exterior is a site visit; hospital jobs route to a brief.
- Airtable → CRM import: agency customers get one account per agent email with a shared company name; unknown finish level defaults to Level 3; cold quotes older than 90 days import as lapsed; future booked jobs import as accepted estimates plus work orders at exact PaintScout pricing into the Unscheduled folder.

# What goes into the new CRM from Airtable — plain-English inventory

**Date:** 16 September 2026 · **Pack:** `docs/imports/airtable-crm-import/` · **Validation:** `validation.json` (no blocking violations)

## Part A — customer history (every customer since May 2025)

| What | How many | Where it lands | Notes |
|---|---|---|---|
| Customer accounts | 1,048 | `accounts` | One per email (or phone when there is no email). 42 belong to an agency and carry a `company_name` (Kay & Burton = 30 agent accounts) so the company view lists them together. All residential; real-estate work is tagged `real-estate`, agencies tagged `agency`. |
| Extra contact names | 56 | `account_contacts` | Other names seen under the same email (landlords, tenants, colleagues). |
| Properties | 1,306 | `properties` | Address, suburb, state (VIC), postcode where Airtable had it, plus a normalised address key so the same house is never created twice. |
| Estimates | 1,482 | `estimates` | 622 accepted · 210 open (sent) · 375 declined · 44 lapsed (cold, older than 90 days) · 231 unfinished drafts. Money in cents inc GST with the ex-GST subtotal; level of finish from the project where known, otherwise Level 3 (marked assumed). Every estimate keeps its PaintScout quote and work-order links. |
| Jobs | 549 | CRM job record (brief §4.6) | Status, start and end dates, invoice total, contractor offer, estimated vs actual hours, materials, painter count, and the PaintScout quote link on every job (23 have none in Airtable — listed for you). |
| Timeline events | 6,014 | `crm_events` | account created, estimate sent / accepted / declined / lapsed, job started / completed, and 1,749 follow-up notes pulled out of the Notes fields with their real dates and who wrote them (TR = Tom, R = Robyn). |
| Accepted value carried across | $3,907,519 inc GST | — | Reconciles to the accepted estimates. |
| Lost accounts | 300 | `accounts.relationship_state = lost`, `temperature = cold` | Every quote lost or gone cold, so the rules stop chasing them. Nobody is marked do-not-contact. |
| Open follow-ups | 8 | follow-up tasks | Future Follow Up Dates in Airtable become tasks at cutover so nothing promised is dropped. |

Quote types across the estimates: Interior 563, Painting Quote 352, Exterior 273, (blank) 254, Interior Residential 19, Real Estate 7, Exterior Residential 7, Interior Commercial 3, Cabinets 3, Exterior Commercial 1.

### Will it go in successfully?

Every row was checked against the rules the database enforces (`validate.py`, results in `validation.json`):

- Emails are unique and valid; every account has an email or a phone (the one exception, Chelsi Ross, has neither and is flagged for you).
- Phones are in +61 form; 18 unreadable numbers were dropped and are listed in the exceptions.
- Every estimate has a legal status, integer cents, a GST-consistent subtotal, a level of finish when it is not a draft, and a sent date; accepted ones have an acceptance date on or after the sent date.
- Every event has a known kind, a valid date in the past, valid JSON, a unique dedupe key, and points at an account that exists.
- Every job points at an estimate that exists and has parseable dates.

What remains is business, not technical: 23 jobs with no PaintScout quote link in Airtable, one account with no contact details, and the 25 half-filled Airtable rows that cannot be identified at all (no name, email or phone) and are left out.

What will NOT come across: customers before May 2025 (PaintScout only), timesheets, materials purchases, contractor payments, colour choices (linked Airtable tables), and marketing permissions (nobody opted in or out in Airtable, so `permit_*` stay unknown).

## Part B — the 35 future jobs, ready to re-schedule

From the Airtable views **Future Booked Jobs** (21) and **Needs booking** (14), each job carries its PaintScout quote and work order read line by line:

| What | How many | Where it lands |
|---|---|---|
| Accepted estimates with exact totals | 35 · $341,578.52 inc GST | `estimates` (status accepted) |
| Priced areas | 342 | `estimate_areas` + `estimate_lines` (one production line per area, price ex GST) |
| Work-order lines with hours | 827 lines · 2,785.8 hours | `work_orders.wo_snapshot` areas → surfaces (item, quantity, unit, coats, hours) |
| Schedule | start and end dates, painter count, assigned painter and whether they accepted, contractor offer ($166,698 in total) | `work_orders.start_date`, `booking_offers` (accepted) where a painter is already assigned |

All 35 reconcile: work-order hours match Airtable to the quarter hour on 34 jobs (the 35th, 65 Hotham Street, is the invoice version with a 7.5-hour variation), and quote totals match Airtable on 32; the three differences are Airtable typos or ex-GST figures, and the PaintScout figure is used (detail in `booked/summary.json`).

# Airtable → CRM import pack

Generated 16 Sep 2026. See `docs/briefs/claude-code-brief-airtable-crm-import.md` (Parts A, B, C) and `docs/imports/airtable-import-inventory.md`.

Part A (history): accounts.csv, account_contacts.csv, properties.csv, estimates.csv, jobs.csv, crm_events.csv, exceptions.csv, summary.json, validation.json.
Part B (future jobs): booked/booked_jobs.json (authoritative), booked_estimates.csv, booked_estimate_areas.csv, booked_work_order_lines.csv, booked_schedule.csv, summary.json, paintscout_workorders_raw.json.

Re-run Part A from a fresh Airtable export:  python3 transform.py --estimates Estimates.csv --projects Projects.csv --out out/  then  python3 validate.py out/
Part B was read from the PaintScout share pages in a browser (see brief §C1 for how to repeat it).
Money is AUD in integer cents (inc GST unless the column says ex_gst). Dates are UTC ISO-8601. Keys (acc_/prop_/est_/job_/bk_) are stable across re-runs.

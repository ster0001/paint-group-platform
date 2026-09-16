# Kick-off message for Claude Code — Airtable → CRM import

Paste this as the first message of the Claude Code session, from the repo root.

---

We are moving Paint Group off Airtable and PaintScout onto the platform. This session builds the import. Read these first, in this order, and stop to report before writing any code:

1. `docs/briefs/claude-code-brief-airtable-crm-import.md` — the brief. It has three parts: **A** customer history since May 2025, **B** the 35 already-signed future jobs, **C** the Zapier handover feed. Section 7 holds Tom's rulings and section B0 holds five more for Part B — none of them are open for discussion.
2. `docs/imports/airtable-import-inventory.md` — plain-English list of what goes in and the validation that says it will.
3. `docs/imports/airtable-crm-import/` — the data pack: CSV per target table, `validation.json`, `transform.py`/`validate.py` (re-runnable), and `booked/` for Part B (`booked_jobs.json` is authoritative; `booked_substrate_map.csv` links every work-order line to a rate code or marks it custom).
4. `CLAUDE.md`, `docs/ARCHITECTURE.md`, and the migrations named in brief §2.

Non-negotiables for this work:

- **Part B prices match PaintScout to the cent** — every area and every total. Nothing is re-priced by the engine; every figure is an override in the working scope.
- **The 35 jobs are already signed.** Mark them accepted by hand. **No customer email or SMS, and no office acceptance email** — prove it with a test that the outbox is empty.
- **All 35 land in the Unscheduled tray** of the PC schedule view, ready to send to a painter. No booking offers; the Airtable dates and painter go in the tray note.
- **Hours and substrate names come across cleanly** — every line keeps its PaintScout name, quantity, unit, coats and hours.
- **The imported scope is editable in Revision → Working scope** so variations and invoices work like a native job.
- Lifecycle triggers must not stamp today's date on history — see brief §5.
- Idempotent: running the loader twice changes nothing.

Order of work: Part A migration + loader → Part B loader (reuse Part A's account/property code) → Part C endpoint. Testing law applies: failing e2e spec first. Flag anything marked ⚑ back to Tom rather than deciding it yourself.

When you have read everything, reply with: the migration you intend to write, the three loader entry points, the tests you will write first, and any ⚑ items you need answered before starting.

# Paint Group — Scheduling & Contractor Portal — Workflow design document v2
(Source of truth. Committed from Tom's approved spec. See the build plan for sequencing.)

Full spec pasted into the session on commencing Phase A. Key anchors:
- Booking offer lifecycle: unscheduled → offered → accepted → in_progress → completed; proposed/declined/expired(24h)/withdrawn branches.
- One live offer per job (v1). expires_at = offered_at + 24h; reminders 4h/20h; expiry auto-releases + flags.
- Customer gate: NO customer booking comms until state = accepted.
- Colours: unscheduled graphite · offered amber hatched+countdown · proposed amber+swap · accepted emerald · in_progress cyan · completed emerald60% · declined/expired clay · unavailable dark hatched grey.
- Money: direct portal invoicing (contractor company profile → tax invoice with their branding → submit/approve/paid, reconciliation guardrails). Payment terms: 30/70, or 30/40/30 on request for large jobs.
- Finish levels: PG-2 Utility · PG-3 Premium (default) · PG-4 Showcase — chip on WO header + per area, deep-linking to standards.
- Quality: standards library, onboarding academy (gate), probation (first 3 jobs), QA loop, quality score.
- Privacy: suburb-only on open offers; full address/surname on acceptance; customer pricing/margin HTML-absent from all contractor surfaces. TZ Australia/Melbourne.
- Build order: 1 identity/profile/shell → 2 WO+finish chips → 3 scheduling core → 4 responses+notifications+customer gate (first release) → 5 calendar → 6 invoicing → 7 expenses → 8 academy/probation/QA.

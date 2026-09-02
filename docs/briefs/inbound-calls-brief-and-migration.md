# Inbound calls — experience brief + landline migration (REGEN)

**Status:** REGENERATED 1 Sep 2026 from the rulings recorded 30 Aug — the original plain-English brief (which carried 12 ⚑s) was produced in chat, never committed. RECORDED items are ruled — do not re-ask. The original's full ⚑ list is partially reconstructed below. **A found original wins.**
**Commit to:** `docs/briefs/inbound-calls-brief-and-migration.md` · **Module:** phone

---

## 1. Purpose

Work calls linked into the platform: recorded, AI-transcribed, AI-summarised into the estimate/CRM, ringing real phones — with the existing landline number kept.

## 2. Rulings — RECORDED 30 Aug, do not re-ask

1. **Option A: a programmable number (Twilio primary, Telnyx fallback) that rings real phones over the mobile network. No softphone app.** (Current Aussie Broadband Snap Mobile rejected — audio drops when the app is backgrounded.)
2. **Ring roster:** office admin works **Mon / Tue / Thu**. On her days, **three phones ring simultaneously** — office mobile, landline handset, Tom's mobile. On her off days (Wed/Fri + weekends), only 1–2 numbers ring. (Original ⚑: Tom simultaneous vs delayed 10s on admin days — treat as still open, ⚑P1.)
3. **Keep the existing Aussie Broadband landline number.** Migration is **divert-first, port-later**: Day 1 the landline diverts to the new programmable number (everything works, reversible in minutes); once proven over ⚑P2 weeks, port the number into the provider and retire the AB service.
4. **Pipeline:** call → recording → AI transcription → AI summary → pre-fill into the estimate / CRM record, linked to the caller's account when the number matches. Recordings and transcripts stored via the remediated upload path; a call from an unknown number creates a lead.
5. Recording disclosure is required — a brief announcement on answer (exact wording ⚑P3, legal-adjacent: Victorian consent rules, confirm before live).

## 3. Experience sketch — RECONSTRUCTED ⚑

- Missed everywhere → voicemail-to-text → attention card in the PC console (severity by caller: active job > warm lead > unknown) with one-tap call-back.
- Every call logs a `crm_events` entry; the summary lands on the estimate/job timeline, staff-visible only.
- Outbound calls from the console show the business number, not personal mobiles.
- The assistant module's "Call us" button and callback requests dial/reference this number (parent assistant brief §5).

## 4. Migration plan — RECORDED shape

1. Provision the programmable number; build ring group + roster schedule (Settings-editable days/phones).
2. Prove with the new number published nowhere (test calls, all roster states).
3. Divert the AB landline to it. Monitor ⚑P2 weeks.
4. Port the landline number in; retire AB. (Porting takes weeks and is irreversible-ish — hence divert-first.)
5. Desk-phone future (original ⚑): a SIP desk handset for the office later — schema/roster must not preclude it. ⚑P4.

## 5. Acceptance criteria

1. A call to the number rings the correct phones for the current roster day; answer on any leg cancels the others.
2. Unanswered → voicemail → transcript + attention card within 2 minutes.
3. Every completed call produces a recording, transcript, summary, and `crm_events` row linked to the right account (or a new lead).
4. Roster and disclosure text live in Settings; changing the roster needs no deploy.
5. The divert can be reversed to direct-AB answering in under 5 minutes at any point before porting.

## 6. ⚑ Open (the original carried 12 — recorded/reconstructed here; renumber against the original if found)

| # | Item | Status |
|---|---|---|
| P1 | Tom's phone: simultaneous vs 10s-delayed on admin days | RECORDED as open |
| P2 | Divert proving window before porting (default 4 weeks) | Reconstructed |
| P3 | Recording disclosure wording + consent posture (legal check) | Reconstructed, flagged legal |
| P4 | Desk phone timing/model | RECORDED as open (future) |
| P5 | After-hours behaviour: voicemail only vs assistant-offered callback | Reconstructed — ties to assistant D8 |
| P6 | Weekend roster | Reconstructed |
| P7 | Number shown on outbound SMS (same number vs messaging provider's) | Reconstructed — ties to C17/5.1 messaging decision |

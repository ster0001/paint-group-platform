# Claude Code brief — Site Capture (REGEN)

**Status:** REGENERATED 1 Sep 2026 from recorded rulings — original produced in chat, never committed. RECORDED = ruled. RECONSTRUCTED ⚑ = confirm with Tom. **A found original wins.**
**Commit to:** `docs/briefs/claude-code-brief-site-capture.md` · **Module:** site-capture (Phase 1 of the build order; WO loop, warranty attribution, and assistant co-work all consume it)

---

## 1. Purpose

A phone-first PWA that **replaces Google Photos** as the way site evidence is captured: photos and voice notes, taken on site, landing on the right job automatically — so evidence exists for warranty attribution, customers see progress the same day, and the assistant's co-work mode can build estimates from what was seen and said on site.

## 2. Standing rulings — RECORDED, do not re-ask

1. **Replaces Google Photos.** Capture goes straight to the platform, keyed to a job/property — no more shared albums to sort later.
2. **Attribution requires photo documentation** — the standing warranty rule: back-charging a contractor for defective work requires robust **before / progress / after** evidence, because contractor public liability typically does not cover their own defective work. Site Capture is where that evidence is created; the WO loop's gated stages and two-sided variation flow consume it (photos required on variations).
3. **Voice notes are first-class:** recorded on site, transcribed by AI, transcript attached to the job — and available to the assistant's co-work mode as build-from input (assistant brief §3.2).
4. **Photos are the real load** (volume law): originals stored once via the remediated upload path; every view serves CDN thumbnails/renditions via signed URLs; a phone timeline never downloads an original.
5. Captures emit events into the append-only log (timeline renders from events, state never stored twice).
6. Customer-visible photos are **PC-approved surfaces only** — raw capture is staff/contractor-side; what the customer portal shows follows the WO loop's approval rules, not this module's.

## 3. Experience sketch — RECONSTRUCTED ⚑

- Open PWA → today's scheduled jobs first → tap job → camera. Tag chips: **before / progress / done / defect / variation** ⚑S1 (+ room/side tag from the job's own tree ⚑S2).
- Offline-tolerant: capture queues on-device and syncs when signal returns (painters work in dead zones); upload state visible; nothing lost on app close.
- Voice note button on the same screen: hold-to-record or tap ⚑S3; transcription async; transcript editable by staff.
- Works logged-in per role: contractors capture on their own WOs only (RLS + explicit view param); staff capture anywhere.
- EXIF timestamp + capture time recorded (evidence value); location capture ⚑S4 (privacy/consent question — flagged, not assumed).

## 4. Acceptance criteria

1. A contractor can photograph a defect and record a voice note against the right job in ≤ 3 taps from opening the app, on a phone, one-handed.
2. Airplane-mode capture of 10 photos + 1 voice note syncs completely and in order when connectivity returns; zero loss, no duplicates (idempotent upload keys).
3. Every capture: original in storage once, thumbnail served via CDN signed URL, event row emitted, correct job/role attribution provable under RLS tests.
4. A voice note's transcript is attached and readable within minutes and retrievable by the assistant's co-work tools for that job.
5. Before/after pairs for a surface are retrievable in one query — the warranty-attribution requirement, tested.
6. Nothing captured is customer-visible except through the WO loop's approved surfaces.

## 5. ⚑ Open (reconstructed)

| # | Item |
|---|---|
| S1 | Final tag set (before/progress/done/defect/variation assumed) |
| S2 | Room/side tagging: required or optional per photo |
| S3 | Voice note UX (hold vs tap) and max length |
| S4 | Location capture on/off + consent wording (ties to the photo-consent legal review already flagged) |
| S5 | Retention policy for raw voice audio after transcription |
| S6 | Whether customers can ever upload into Site Capture (e.g. defect photos) or only via their portal flows |

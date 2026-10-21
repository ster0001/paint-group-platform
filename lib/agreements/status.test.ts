import { describe, expect, it } from "vitest";
import { agreementGateOf, daysUntilExpiry, mergeAgreementRules, painterAgreementLine, parseAgreementStatus, parseAgreementStatusRow, renewalDue, staffAgreementLine, type AgreementGateInput } from "./status";

const today = "2026-10-21";
const now = new Date("2026-10-21T03:00:00Z");
const base: AgreementGateInput = { kind: "new", offerGate: true, versionPublished: true, signedExpiresOn: undefined, graceUntil: null };

describe("agreement gate — mirrors agreement_gate_of (20270285)", () => {
  it("a new contractor: unsigned → signed ok → expired", () => {
    expect(agreementGateOf(base, today, now)).toBe("agreement_unsigned");
    expect(agreementGateOf({ ...base, signedExpiresOn: "2027-10-21" }, today, now)).toBe("ok");
    expect(agreementGateOf({ ...base, signedExpiresOn: today }, today, now)).toBe("ok");
    expect(agreementGateOf({ ...base, signedExpiresOn: "2026-10-20" }, today, now)).toBe("agreement_expired");
    expect(agreementGateOf({ ...base, signedExpiresOn: null }, today, now)).toBe("ok");
  });

  it("an existing contractor: offers flow until asked and the grace has run out (ruling 14)", () => {
    const e: AgreementGateInput = { ...base, kind: "existing" };
    expect(agreementGateOf(e, today, now)).toBe("ok");
    expect(agreementGateOf({ ...e, graceUntil: "2026-11-04T03:00:00Z" }, today, now)).toBe("ok");
    expect(agreementGateOf({ ...e, graceUntil: "2026-10-20T03:00:00Z" }, today, now)).toBe("agreement_unsigned");
    expect(agreementGateOf({ ...e, graceUntil: "2026-10-20T03:00:00Z", signedExpiresOn: "2027-03-03" }, today, now)).toBe("ok");
  });

  it("the gate switch off, or no version seeded, means ok for everyone", () => {
    expect(agreementGateOf({ ...base, offerGate: false }, today, now)).toBe("ok");
    expect(agreementGateOf({ ...base, versionPublished: false }, today, now)).toBe("ok");
  });

  it("a grace window never relaxes a new contractor", () => {
    expect(agreementGateOf({ ...base, graceUntil: "2026-11-04T03:00:00Z" }, today, now)).toBe("agreement_unsigned");
  });

  it("mergeAgreementRules tolerates junk", () => {
    expect(mergeAgreementRules(null)).toEqual({ offerGate: true, graceDays: 14, renewalWarnDays: 30, termMonths: 12, signatoryName: "Tom Roman", signatoryTitle: "Director" });
    expect(mergeAgreementRules({ offerGate: false, graceDays: 0, termMonths: "x", signatoryName: " " })).toMatchObject({ offerGate: false, graceDays: 14, termMonths: 12, signatoryName: "Tom Roman" });
  });
});

describe("status parsing and words", () => {
  const signed = {
    kind: "new", gate: "ok", current_version: 1, requested_at: null, grace_until: null, commencement_on: "2026-10-01", renewal_warn_days: 30,
    signed: { id: "a1", version: 1, source: "portal", signed_at: "2026-10-21T02:00:00Z", signed_name: "Sam Painter", commencement_on: "2026-10-01", expires_on: "2027-10-01", pdf_path: null, countersigned_at: "2026-10-21T02:00:00Z" },
    history: [{ id: "a1", version: 1, source: "portal", status: "signed", signed_at: "2026-10-21T02:00:00Z", expires_on: "2027-10-01", pdf_path: null }],
  };

  it("parseAgreementStatus shapes the RPC jsonb", () => {
    const s = parseAgreementStatus(signed)!;
    expect(s.signed?.signedName).toBe("Sam Painter");
    expect(s.signed?.expiresOn).toBe("2027-10-01");
    expect(s.history).toHaveLength(1);
    expect(parseAgreementStatus(null)).toBeNull();
    expect(parseAgreementStatus({ kind: "existing", gate: "junk", signed: null, history: "no" })).toMatchObject({ kind: "existing", gate: "ok", signed: null, history: [] });
  });

  it("the painter's Documents line", () => {
    expect(painterAgreementLine(parseAgreementStatus(signed)!, today)).toBe("Signed 21 Oct 2026 · v1");
    expect(painterAgreementLine(parseAgreementStatus({ ...signed, signed: { ...signed.signed, expires_on: "2026-11-10" } })!, today)).toBe("Signed 21 Oct 2026 · v1 · due for renewal 10 Nov 2026");
    expect(painterAgreementLine(parseAgreementStatus({ ...signed, signed: { ...signed.signed, expires_on: "2026-10-01" } })!, today)).toBe("Signed 21 Oct 2026 · v1 · expired 1 Oct 2026");
    expect(painterAgreementLine(parseAgreementStatus({ ...signed, signed: { ...signed.signed, version: null, source: "uploaded", signed_at: "2026-03-03T01:00:00Z" } })!, today)).toBe("Signed 3 Mar 2026 · signed on paper");
    expect(painterAgreementLine({ signed: null, gate: "agreement_unsigned", renewalWarnDays: 30 }, today)).toBe("Not signed · job offers wait until it is");
    expect(painterAgreementLine({ signed: null, gate: "ok", renewalWarnDays: 30 }, today)).toBe("Not signed");
  });

  it("the office's Contractors cell", () => {
    const row = parseAgreementStatusRow({ contractor_id: "c1", kind: "new", gate: "ok", agreement_id: "a1", version: 1, source: "portal", signed_at: "2026-10-21T02:00:00Z", expires_on: "2027-10-01", pdf_path: null, requested_at: null, grace_until: null })!;
    expect(staffAgreementLine(row, today, now, 30)).toBe("Signed v1 · 21 Oct 2026");
    expect(staffAgreementLine({ ...row, source: "uploaded", version: null, signedAt: "2026-03-03T01:00:00Z", expiresOn: "2027-03-03" }, today, now, 30)).toBe("Uploaded · 3 Mar 2026");
    expect(staffAgreementLine({ ...row, expiresOn: "2026-11-10" }, today, now, 30)).toBe("Signed v1 · expires 10 Nov 2026");
    expect(staffAgreementLine({ ...row, expiresOn: "2026-10-01" }, today, now, 30)).toBe("Signed v1 · expired 1 Oct 2026 · no offers");
    const unsigned = { ...row, signedAt: null, expiresOn: null, version: null, source: null };
    expect(staffAgreementLine(unsigned, today, now, 30)).toBe("Not signed · no offers");
    expect(staffAgreementLine({ ...unsigned, kind: "existing" }, today, now, 30)).toBe("Not signed · not asked yet");
    expect(staffAgreementLine({ ...unsigned, kind: "existing", requestedAt: "2026-10-20T01:00:00Z", graceUntil: "2026-11-03T01:00:00Z" }, today, now, 30)).toBe("Not signed · asked 20 Oct 2026, offers stop 3 Nov 2026");
    expect(staffAgreementLine({ ...unsigned, kind: "existing", requestedAt: "2026-09-20T01:00:00Z", graceUntil: "2026-10-04T01:00:00Z" }, today, now, 30)).toBe("Not signed · asked 20 Sept 2026 · no offers");
  });

  it("expiry arithmetic is by calendar day", () => {
    expect(daysUntilExpiry("2026-10-22", today)).toBe(1);
    expect(daysUntilExpiry("2026-10-21", today)).toBe(0);
    expect(daysUntilExpiry("2026-10-01", today)).toBe(-20);
    expect(daysUntilExpiry(null, today)).toBeNull();
    expect(renewalDue("2026-11-20", today, 30)).toBe(true);
    expect(renewalDue("2026-11-21", today, 30)).toBe(false);
  });
});

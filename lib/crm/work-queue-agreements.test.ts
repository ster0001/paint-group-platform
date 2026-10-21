import { describe, expect, it } from "vitest";
import { buildAgreementItems, homeOf, isCustomerVisible, type AgreementQueueRow } from "./work-queue";

/**
 * Agreement brief §7 / §10: unsigned agreements and agreements expiring within
 * the renewal window are work items from the one queue, derived from
 * agreement_statuses() — never a list of their own.
 */
const now = new Date("2026-10-21T03:00:00Z");   // 2 pm Melbourne
const today = "2026-10-21";
const row = (over: Partial<AgreementQueueRow> = {}): AgreementQueueRow => ({
  contractorId: "c1", name: "Sam Painter", employmentType: "contractor", active: true,
  kind: "new", gate: "agreement_unsigned", signed: false, source: null, expiresOn: null,
  requestedAt: null, graceUntil: null, createdAt: "2026-10-20T01:00:00Z",
  ...over,
});

describe("agreement work items", () => {
  it("a new contractor who has not signed: one item, offers wait, action is their record", () => {
    const [item, ...rest] = buildAgreementItems([row()], 30, today, now);
    expect(rest).toHaveLength(0);
    expect(item.kind).toBe("agreement_unsigned");
    expect(item.title).toBe("Sam Painter — subcontractor agreement not signed");
    expect(item.detail).toMatch(/new contractor: no job offers/);
    expect(item.dueAt).toBeNull();
    expect(item.bucket).toBe("today");   // no deadline: actionable now (bucketFor)
    expect(item.action).toEqual({ label: "Request signature", href: "/contractors/c1" });
    expect(item.key).toBe("agreement_unsigned:contractor:c1:unsigned");
    expect(homeOf(item.kind)).toBe("pc");
    expect(isCustomerVisible(item.kind)).toBe(false);
  });

  it("an existing contractor not asked yet is listed (ruling 14) so the first morning is not a phone-call storm", () => {
    const [item] = buildAgreementItems([row({ kind: "existing", gate: "ok" })], 30, today, now);
    expect(item.detail).toMatch(/not asked to sign yet/);
    expect(item.action.label).toBe("Request signature");
  });

  it("an existing contractor asked: due when the grace ends, overdue after", () => {
    const asked = row({ kind: "existing", gate: "ok", requestedAt: "2026-10-20T01:00:00Z", graceUntil: "2026-11-03T01:00:00Z" });
    const [open] = buildAgreementItems([asked], 30, today, now);
    expect(open.detail).toMatch(/Asked 20 Oct; job offers stop 3 Nov/);
    expect(open.dueAt).toBe("2026-11-03T01:00:00Z");
    expect(open.bucket).toBe("waiting");
    expect(open.key).toBe("agreement_unsigned:contractor:c1:asked");
    const [over] = buildAgreementItems([{ ...asked, gate: "agreement_unsigned", graceUntil: "2026-10-10T01:00:00Z" }], 30, today, now);
    expect(over.bucket).toBe("overdue");
    expect(over.detail).toMatch(/grace window has ended/);
  });

  it("a signed agreement inside the renewal window, then expired", () => {
    const signed = row({ gate: "ok", signed: true, source: "portal", expiresOn: "2026-11-10" });
    const [soon] = buildAgreementItems([signed], 30, today, now);
    expect(soon.kind).toBe("agreement_expiring");
    expect(soon.title).toBe("Sam Painter — agreement expires 10 Nov");
    expect(soon.detail).toMatch(/^20 days left/);
    expect(soon.bucket).toBe("waiting");
    expect(buildAgreementItems([{ ...signed, expiresOn: "2026-12-01" }], 30, today, now)).toHaveLength(0);
    const [gone] = buildAgreementItems([{ ...signed, gate: "agreement_expired", expiresOn: "2026-10-01" }], 30, today, now);
    expect(gone.kind).toBe("agreement_unsigned");
    expect(gone.key).toBe("agreement_unsigned:contractor:c1:expired");
    expect(gone.detail).toMatch(/expired 1 Oct/);
    expect(gone.bucket).toBe("overdue");
  });

  it("signed and current, an employee, or suspended: nothing", () => {
    expect(buildAgreementItems([row({ gate: "ok", signed: true, source: "uploaded", expiresOn: "2027-03-03" })], 30, today, now)).toHaveLength(0);
    expect(buildAgreementItems([row({ employmentType: "employee" })], 30, today, now)).toHaveLength(0);
    expect(buildAgreementItems([row({ active: false })], 30, today, now)).toHaveLength(0);
  });
});

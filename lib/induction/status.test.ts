import { describe, expect, it } from "vitest";
import { inductionGateOf, mergeInductionRules, parseInductionStatus, nextModule, staffInductionLine, type GateInput } from "./status";

const now = new Date("2026-10-15T00:00:00Z");
const base: GateInput = { kind: "full", offerGate: true, versionPublished: true, completedAt: null, checkPassed: false, graceUntil: null, reTickMonths: 12, expiryBlocks: false };

describe("induction gate — mirrors induction_gate_of (20270270)", () => {
  it("a new painter (full): incomplete → check → ok", () => {
    expect(inductionGateOf(base, now)).toBe("induction_incomplete");
    expect(inductionGateOf({ ...base, completedAt: "2026-10-14T00:00:00Z" }, now)).toBe("check_not_passed");
    expect(inductionGateOf({ ...base, completedAt: "2026-10-14T00:00:00Z", checkPassed: true }, now)).toBe("ok");
  });

  it("a refresher: offers flow until invited and the grace has run out; never needs the check", () => {
    const r: GateInput = { ...base, kind: "refresher" };
    expect(inductionGateOf(r, now)).toBe("ok");
    expect(inductionGateOf({ ...r, graceUntil: "2026-10-20T00:00:00Z" }, now)).toBe("ok");
    expect(inductionGateOf({ ...r, graceUntil: "2026-10-10T00:00:00Z" }, now)).toBe("induction_incomplete");
    expect(inductionGateOf({ ...r, graceUntil: "2026-10-10T00:00:00Z", completedAt: "2026-10-12T00:00:00Z", checkPassed: false }, now)).toBe("ok");
  });

  it("the gate switch off, or no published version, means ok for everyone", () => {
    expect(inductionGateOf({ ...base, offerGate: false }, now)).toBe("ok");
    expect(inductionGateOf({ ...base, versionPublished: false }, now)).toBe("ok");
  });

  it("a worker login is never offered work: ok (the share gate is inducted_at)", () => {
    expect(inductionGateOf({ ...base, kind: "worker" }, now)).toBe("ok");
  });

  it("re-tick after reTickMonths bites only with expiryBlocks on (⚑9)", () => {
    const old = { ...base, completedAt: "2025-01-01T00:00:00Z", checkPassed: true };
    expect(inductionGateOf(old, now)).toBe("ok");
    expect(inductionGateOf({ ...old, expiryBlocks: true }, now)).toBe("induction_incomplete");
    expect(inductionGateOf({ ...old, expiryBlocks: true, reTickMonths: 36 }, now)).toBe("ok");
  });

  it("mergeInductionRules tolerates junk", () => {
    expect(mergeInductionRules(null)).toEqual({ offerGate: true, reTickMonths: 12, expiryBlocks: false });
    expect(mergeInductionRules({ offerGate: false, reTickMonths: 0, expiryBlocks: "yes" })).toEqual({ offerGate: false, reTickMonths: 12, expiryBlocks: false });
  });
});

describe("induction status — shaping and words", () => {
  const raw = {
    kind: "full", version_no: 1, language: "es",
    modules: [{ key: "m01", ticked: true, sections: [], change_note: "" }, { key: "m02", ticked: false, sections: [], change_note: "x" }],
    ticked: 1, total: 2, complete: false, completed_at: null,
    tasks: [{ task: "accept_job", result: "pass", note: "", checked_at: "2026-10-14T00:00:00Z" }, { task: "invoice", result: null, note: "", checked_at: null }],
    check_passed: false, gate: "induction_incomplete", invited_at: null, grace_until: null, inducted_at: null,
  };
  it("parses the RPC jsonb and finds the next module", () => {
    const s = parseInductionStatus(raw)!;
    expect(s.kind).toBe("full");
    expect(s.modules[1].changeNote).toBe("x");
    expect(s.tasks[0].result).toBe("pass");
    expect(s.tasks[1].result).toBeNull();
    expect(nextModule(s)).toBe("m02");
    expect(parseInductionStatus(null)).toBeNull();
  });
  it("the office line says where they are", () => {
    const s = parseInductionStatus(raw)!;
    expect(staffInductionLine(s, now)).toBe("Induction 1 of 2 · no job offers until complete");
    expect(staffInductionLine({ ...s, kind: "refresher", invitedAt: "2026-10-13T00:00:00Z", graceUntil: "2026-10-20T00:00:00Z" }, now)).toContain("invited 2d ago, offers stop");
    expect(staffInductionLine({ ...s, complete: true, completedAt: "2026-10-14T00:00:00Z", checkPassed: true, gate: "ok" }, now)).toBe("Induction complete · 14 Oct 2026 · check passed");
  });
});

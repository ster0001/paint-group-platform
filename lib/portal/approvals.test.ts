import { test, expect } from "vitest";
import { approvalStrip, effectiveCanApproveForOwner, effectivePoRequiredToInvoice, type ApprovalAccount } from "./approvals";

const re: ApprovalAccount = { orgKind: "real_estate", canApproveForOwner: null, ownerReferralThresholdCents: null, paymentTermsDays: null };
const strip = (over: Partial<Parameters<typeof approvalStrip>[0]>) =>
  approvalStrip({ role: "admin", account: re, approvalLimitCents: null, totalCents: 484000, settingsTermsDays: 14, ...over });

test("⚑1: real_estate approves on behalf of the owner by default; explicit false wins", () => {
  expect(effectiveCanApproveForOwner(re)).toBe(true);
  expect(effectiveCanApproveForOwner({ ...re, canApproveForOwner: false })).toBe(false);
  expect(effectiveCanApproveForOwner({ ...re, orgKind: "facilities", canApproveForOwner: null })).toBe(false);

  const s = strip({});
  expect(s.canApprove).toBe(true);
  expect(s.approveLabel).toBe("Approve on behalf of the owner");
  expect(s.sendLabel).toBe("Send to the owner to approve");

  const denied = strip({ account: { ...re, canApproveForOwner: false } });
  expect(denied.canApprove).toBe(false);
  expect(denied.referredToOwner).toBe(true);
});

test("⚑1: above the owner-referral threshold, send-to-owner is the only path", () => {
  const under = strip({ account: { ...re, ownerReferralThresholdCents: 500000 } });
  expect(under.canApprove).toBe(true);
  const over = strip({ account: { ...re, ownerReferralThresholdCents: 400000 } });
  expect(over.canApprove).toBe(false);
  expect(over.referredToOwner).toBe(true);
});

test("⚑2: limits are advisory — over-limit is flagged, not blocked; viewer and finance never approve", () => {
  const over = strip({ approvalLimitCents: 300000 });
  expect(over.canApprove).toBe(true);
  expect(over.overLimit).toEqual({ limitCents: 300000, totalCents: 484000 });
  expect(strip({ approvalLimitCents: 500000 }).overLimit).toBeNull();

  for (const role of ["viewer", "finance"] as const) {
    const s = strip({ role });
    expect(s.canApprove).toBe(false);
    expect(s.overLimit).toBeNull();
  }
});

test("⚑3: terms — the account override beats the Settings default", () => {
  expect(strip({}).termsDays).toBe(14);
  expect(strip({ account: { ...re, paymentTermsDays: 30 } }).termsDays).toBe(30);
});

test("⚑5: facilities are prompted for a PO; po-required-to-invoice derives per org kind", () => {
  const fm = strip({ account: { ...re, orgKind: "facilities" } });
  expect(fm.showPoPrompt).toBe(true);
  expect(fm.approveLabel).toBe("Approve with PO number");
  expect(fm.sendLabel).toBe("Send to a colleague to approve");
  expect(strip({}).showPoPrompt).toBe(false);

  expect(effectivePoRequiredToInvoice("facilities", null)).toBe(true);
  expect(effectivePoRequiredToInvoice("real_estate", null)).toBe(false);
  expect(effectivePoRequiredToInvoice("facilities", false)).toBe(false);
});

test("⚑6: insurance offers in-portal approval (approver seats) AND the assessor link", () => {
  const ins = strip({ role: "approver", account: { ...re, orgKind: "insurance" } });
  expect(ins.canApprove).toBe(true);
  expect(ins.approveLabel).toBe("Approve against the claim");
  expect(ins.sendLabel).toBe("Send to the assessor to approve");
  expect(ins.externalParty).toBe("assessor");
});

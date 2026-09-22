import { describe, expect, it } from "vitest";
import { contractorInvoiceTone } from "./contractorInvoiceTone";

const today = "2026-09-20";

describe("contractorInvoiceTone — one colour per state", () => {
  it("submitted is amber: waiting on the office", () => {
    expect(contractorInvoiceTone({ status: "submitted", dueOn: null }, today)).toMatchObject({ tone: "amber", className: "ci-amber", outstanding: true, overdueLabel: null });
  });
  it("approved and unpaid is clay: outstanding for payment — with or without a due date, up to and including the due day", () => {
    expect(contractorInvoiceTone({ status: "approved", dueOn: null }, today)).toMatchObject({ tone: "clay", className: "ci-clay", outstanding: true, overdueDays: 0 });
    expect(contractorInvoiceTone({ status: "approved", dueOn: "2026-09-27" }, today).tone).toBe("clay");
    expect(contractorInvoiceTone({ status: "approved", dueOn: today }, today).tone).toBe("clay");
  });
  it("approved past its due date is the stronger clay and says how long", () => {
    const r = contractorInvoiceTone({ status: "approved", dueOn: "2026-09-17" }, today);
    expect(r).toMatchObject({ tone: "clay-strong", className: "ci-clay-strong", outstanding: true, overdueDays: 3, overdueLabel: "overdue 3 d" });
  });
  it("paid is emerald and nothing is outstanding", () => {
    expect(contractorInvoiceTone({ status: "paid", dueOn: "2026-09-01" }, today)).toMatchObject({ tone: "emerald", outstanding: false, overdueLabel: null });
  });
  it("a draft, or any state the enum does not know, is grey", () => {
    expect(contractorInvoiceTone({ status: "draft", dueOn: "2026-09-01" }, today)).toMatchObject({ tone: "grey", className: "ci-grey", outstanding: false });
    expect(contractorInvoiceTone({ status: "void", dueOn: null }, today).tone).toBe("grey");
  });
});

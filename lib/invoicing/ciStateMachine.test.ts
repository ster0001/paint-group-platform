import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CI_STATUSES, ciCanTransition, ciCanDelete, ciDocumentHeading } from "./ciStateMachine";

const MIG = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20261119000000_contractor_invoicing.sql"),
  "utf8",
);

describe("the mirror cannot drift from the SQL guard", () => {
  it("every status exists in the enum seed (20261112) order", () => {
    // The enum was created in 20261112: ('draft','submitted','approved','paid').
    expect(CI_STATUSES).toEqual(["draft", "submitted", "approved", "paid"]);
  });

  it("the guard admits exactly the mirrored transitions", () => {
    expect(MIG).toContain("(old.status = 'draft'     and new.status = 'submitted')");
    expect(MIG).toContain("(old.status = 'submitted' and new.status = 'approved')");
    expect(MIG).toContain("(old.status = 'approved'  and new.status = 'paid')");
    expect(MIG).toContain("(old.status = 'draft'     and new.status = 'approved' and old.rcti)");
  });

  it("submitted invoices are immutable and only drafts delete, in SQL", () => {
    expect(MIG).toContain("a submitted contractor invoice is immutable");
    expect(MIG).toContain("only draft contractor invoices can be deleted");
  });
});

describe("transitions", () => {
  it("the linear chain, one direction", () => {
    expect(ciCanTransition("draft", "submitted")).toBe(true);
    expect(ciCanTransition("submitted", "approved")).toBe(true);
    expect(ciCanTransition("approved", "paid")).toBe(true);
    expect(ciCanTransition("submitted", "draft")).toBe(false);
    expect(ciCanTransition("paid", "approved")).toBe(false);
    expect(ciCanTransition("draft", "paid")).toBe(false);
  });

  it("draft → approved only under RCTI", () => {
    expect(ciCanTransition("draft", "approved")).toBe(false);
    expect(ciCanTransition("draft", "approved", true)).toBe(true);
  });

  it("only drafts delete", () => {
    expect(ciCanDelete("draft")).toBe(true);
    expect(ciCanDelete("submitted")).toBe(false);
    expect(ciCanDelete("paid")).toBe(false);
  });
});

describe("the document heading is a legal statement (brief §6.3 accept)", () => {
  it("unregistered can never produce 'Tax Invoice'", () => {
    expect(ciDocumentHeading(false)).toBe("INVOICE");
    expect(ciDocumentHeading(null)).toBe("INVOICE");
    expect(ciDocumentHeading(true)).toBe("TAX INVOICE");
  });

  it("GST is anchored inc — registration changes the document, never the cost", () => {
    // The SQL computes gst FROM the inc total, or zero — never adds on top.
    expect(MIG).toMatch(/case when v_c\.gst_registered\s+then public\.gst_from_inc_cents/);
    expect(MIG).not.toMatch(/total_inc_cents\s*\*\s*1\.1/);
  });
});

describe("the amounts twin (lib/workorder/contractorPay.ts) — same deduction rule", () => {
  it("manual deductions use ONLY the PC's figure; clean credits fall back to the engine's", () => {
    expect(MIG).toMatch(
      /case when v\.needs_manual_deduction\s+then coalesce\(v\.deduction_cents, 0\)\s+else coalesce\(v\.deduction_cents, v\.contractor_delta_cents, 0\) end/,
    );
    // Only contractor_accepted rows count, both sides of the sign.
    expect(MIG).toContain("v.status = 'contractor_accepted' and not v.credit");
    expect(MIG).toContain("v.status = 'contractor_accepted' and v.credit");
  });

  it("submit refuses while a manual deduction is unset (⚑10, pre-submit visibility)", () => {
    expect(MIG).toContain("error:deduction_pending");
  });
});

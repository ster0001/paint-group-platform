import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CI_STATUSES, ciCanTransition, ciCanDelete, ciDocumentHeading } from "./ciStateMachine";

const MIG = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20261119000000_contractor_invoicing.sql"),
  "utf8",
);
// The live GST rule (Tom, 7 Oct 2026): the offered amount is EX GST — added
// on top when registered, the net amount only when not.
const GST_MIG = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20270218000000_contractor_gst_on_top.sql"),
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

  it("GST goes ON TOP of the offered amount when registered, never backed out (Tom, 7 Oct)", () => {
    // Every writer: gst_on_ex_cents of the ex figure, or zero — and the
    // backed-out derivation is gone from all four.
    const writers = GST_MIG.split(/create or replace function public\./).slice(1)
      .filter((f) => /^contractor_invoice_(draft|request|submit|approve)\(/.test(f))
      .map((f) => f.slice(0, f.indexOf("end $$;"))); // the body only — the backfill after approve legitimately re-reads the old rule
    expect(writers).toHaveLength(4);
    for (const f of writers) {
      expect(f).toMatch(/case when v_c\.gst_registered\s+then public\.gst_on_ex_cents/);
      expect(f).not.toContain("gst_from_inc_cents");
      expect(f).toContain("claimed_ex_cents");
    }
    // What remains to invoice is the Σ of ex-GST claims, so registration
    // can never eat into the agreed amount.
    expect(GST_MIG).toMatch(/contractor_invoice_invoiced_cents[\s\S]{0,300}sum\(claimed_ex_cents\)/);
    // The guard freezes the new column with the rest of the money.
    expect(GST_MIG).toMatch(/new\.claimed_ex_cents\s+is distinct from old\.claimed_ex_cents/);
    // Every migration registers itself.
    expect(GST_MIG).toContain("values ('20270218000000_contractor_gst_on_top.sql')");
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

import { describe, expect, it } from "vitest";
import { isReadable, mergeExtractions, orderRefsIn, parseAuDate, ruleExtract } from "./rules";

const HAYMES_EMAIL = `Tax Invoice

Haymes Paint Trade Centre Oakleigh
ABN: 33 004 201 638
Invoice No: HP-88214
Date: 22/08/2026
Order ref: PG-0087

10L Ultra Premium Low Sheen   $375.27
GST                            $37.53
Total inc GST                 $412.80

Deliver to: 12 Ellerslie Grove, Elsternwick VIC 3185`;

describe("ruleExtract — the deterministic reader", () => {
  const e = ruleExtract(HAYMES_EMAIL, "accounts@haymespaint.com.au", "Invoice HP-88214");

  it("reads the labelled fields", () => {
    expect(e.invoice_no).toBe("HP-88214");
    expect(e.abn).toBe("33004201638");
    expect(e.total_cents).toBe(41280);
    expect(e.gst_cents).toBe(3753);
    expect(e.subtotal_ex_cents).toBe(41280 - 3753);
    expect(e.invoice_date).toBe("2026-08-22");
  });

  it("finds the order reference with near-certain confidence", () => {
    expect(e.order_ref).toBe("PG-87");
    expect(e.confidence?.order_ref).toBe(0.95);
  });

  it("labels the supplier from the sender domain, low confidence", () => {
    expect(e.supplier).toBe("Haymespaint");
    expect(e.confidence?.supplier).toBeLessThan(0.5);
  });

  it("never invents: an empty document extracts nothing", () => {
    const empty = ruleExtract("g'day, see attached", "", "");
    expect(empty.total_cents).toBeUndefined();
    expect(empty.invoice_no).toBeUndefined();
    expect(isReadable(empty)).toBe(false);
  });
});

describe("parseAuDate — day first, always", () => {
  it("numeric forms", () => {
    expect(parseAuDate("22/08/2026")).toBe("2026-08-22");
    expect(parseAuDate("3-9-26")).toBe("2026-09-03");
  });
  it("worded forms", () => {
    expect(parseAuDate("22 Aug 2026")).toBe("2026-08-22");
    expect(parseAuDate("1 December 2026")).toBe("2026-12-01");
  });
  it("refuses nonsense", () => {
    expect(parseAuDate("32/13/2026")).toBeUndefined();
    expect(parseAuDate("no date here")).toBeUndefined();
  });
});

describe("orderRefsIn", () => {
  it("finds PG refs in any spelling and WO refs", () => {
    expect(orderRefsIn("ref PG-0087 / see WO-AB12CD34")).toEqual(["PG-87", "WO-AB12CD34"]);
    expect(orderRefsIn("pg 12")).toEqual(["PG-12"]);
  });
  it("does not misread finish codes as jobs beyond their digits", () => {
    // PG-3 IS a possible job number — the ladder only matches it against real
    // job_no values, so a finish-standard mention can never mis-match a job
    // that doesn't exist. Here we only pin that extraction is verbatim.
    expect(orderRefsIn("finish standard PG-3")).toEqual(["PG-3"]);
  });
});

describe("mergeExtractions — AI proposes on top of the rules", () => {
  it("AI fields win except the deterministic order ref", () => {
    const rules = ruleExtract(HAYMES_EMAIL, "accounts@haymespaint.com.au", "");
    const merged = mergeExtractions(rules, {
      supplier: "Haymes Paint",
      total_cents: 41280,
      order_ref: "PG-99",
      confidence: { supplier: 0.95, total_cents: 0.9 },
    });
    expect(merged.supplier).toBe("Haymes Paint");
    expect(merged.order_ref).toBe("PG-87"); // rules win
    expect(merged.confidence?.supplier).toBe(0.95);
    expect(merged.invoice_no).toBe("HP-88214"); // rule field survives
  });

  it("without AI the rules stand alone", () => {
    const rules = ruleExtract(HAYMES_EMAIL, "a@b.com", "");
    expect(mergeExtractions(rules, null)).toBe(rules);
  });
});

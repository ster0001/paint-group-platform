import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseAgreement, type MergeValues } from "./source";
import { SIGNING_FIELDS, displayValue, renderAgreementFragment, renderAgreementPdfHtml, visibleText } from "./render";

const file = parseAgreement(readFileSync(resolve(__dirname, "../../docs/agreements/subcontractor-agreement-v1.md"), "utf8"));
const file2 = parseAgreement(readFileSync(resolve(__dirname, "../../docs/agreements/subcontractor-agreement-v2.md"), "utf8"));

const profile: MergeValues = {
  "contractor.company_name": "Sam Painter Pty Ltd",
  "contractor.abn": "51 824 753 556",
  "contractor.address": "4 Brush Lane, Oakleigh VIC 3166",
  "company.signatory_name": "Tom Roman, Director",
  "agreement.commencement_on": "2026-10-01",
  "agreement.expires_on": "2027-10-01",
};
const signed: MergeValues = {
  ...profile,
  "contractor.signed_name": "Sam Painter",
  "contractor.signed_on": "2026-10-21",
  "contractor.signature": "data:image/png;base64,iVBORw0KGgo=",
  "company.signed_on": "2026-10-21",
  "company.signature": "data:image/png;base64,iVBORw0KGgo=",
  "agreement.signed_on": "2026-10-21",
};
const audit = { version: 1, signedAtMelbourne: "21 Oct 2026, 2:15 pm", ip: "203.0.113.9", userAgent: "Safari on iPhone", bodySha256: "ab".repeat(32), countersignLine: "Countersigned for ENLVN Pty Ltd by Tom Roman, Director, 21 Oct 2026" };

describe("the one renderer", () => {
  it("the preview marks the signing-time fields as slots and prints the profile in place", () => {
    const html = renderAgreementFragment(file, profile, SIGNING_FIELDS);
    expect(html).toContain('<span class="ag-merge" data-field="contractor.abn">51 824 753 556</span>');
    expect(html).toContain("Sam Painter Pty Ltd");
    expect(html).toContain('<span class="ag-pending" data-field="contractor.signature">your signature</span>');
    expect(html).toContain("1 October 2026");       // Schedule D, as a day
    expect(html).toContain("1 October 2027");       // Schedule M
    expect(html).not.toContain("{{");
  });

  it("refuses a blank where a value should be", () => {
    expect(() => renderAgreementFragment(file, { ...profile, "contractor.abn": "" }, SIGNING_FIELDS)).toThrow(/unresolved contractor.abn/);
    expect(() => renderAgreementFragment(file, profile, [])).toThrow(/unresolved/);
    expect(() => renderAgreementPdfHtml(file, profile, audit)).toThrow(/unresolved/);
  });

  it("the signed document carries the signatures as images and the audit footer", () => {
    const html = renderAgreementPdfHtml(file, signed, audit);
    expect(html.match(/<img class="ag-sig"/g)).toHaveLength(2);
    expect(html).toContain("Sam Painter");
    expect(html).toContain("Document hash (SHA-256 of the wording as read): " + "ab".repeat(32));
    expect(html).toContain("IP 203.0.113.9");
    expect(html).toContain("<!doctype html>");
  });

  it("what the contractor reads is what the PDF locks: same wording, only the signing slots differ", () => {
    const preview = visibleText(renderAgreementFragment(file, profile, SIGNING_FIELDS));
    const pdf = visibleText(renderAgreementPdfHtml(file, signed, audit));
    // Replace each pending slot word with what the signed render prints there.
    const expected = preview
      .replace(/your name, on signing/g, "Sam Painter")
      .replace(/date of signing/g, "21 October 2026")
      .replace(/ your signature /g, " ")
      .replace(/ signed on your signing /g, " ")
      .replace(/\s+/g, " ").trim();
    const pdfWithoutTitle = pdf.replace(/^Independent Contractor Agreement — Version 1 /, "");
    expect(pdfWithoutTitle).toBe(expected);
  });

  it("version 2 signs Attachment A too: three signature images, the name and date under it", () => {
    const html = renderAgreementPdfHtml(file2, signed, { ...audit, version: 2 });
    expect(html.match(/<img class="ag-sig"/g)).toHaveLength(3);
    const attachment = html.slice(html.indexOf("Attachment A"));
    expect(attachment).toContain("Sam Painter");
    expect(attachment).toContain("21 October 2026");
  });

  it("escapes what a contractor typed", () => {
    const html = renderAgreementFragment(file, { ...profile, "contractor.company_name": "<b>Evil</b> & Co" }, SIGNING_FIELDS);
    expect(html).toContain("&lt;b&gt;Evil&lt;/b&gt; &amp; Co");
    expect(html).not.toContain("<b>Evil");
  });

  it("every clause heading and every schedule reaches the page in order", () => {
    const text = visibleText(renderAgreementFragment(file, profile, SIGNING_FIELDS));
    const at = (s: string) => { const i = text.indexOf(s); expect(i, s).toBeGreaterThan(-1); return i; };
    expect(at("1. Definitions")).toBeLessThan(at("2. Commencement, duration and option to renew"));
    expect(at("13. Post agreement obligations")).toBeLessThan(at("14. Survival of obligations"));
    expect(at("Signed as an agreement")).toBeLessThan(at("Schedules"));
    expect(at("SCHEDULE".toLowerCase() === "schedule" ? "Schedules" : "Schedules")).toBeLessThan(at("Attachment A"));
    expect(text).toContain("K Minimum level of public liability insurance required $10,000,000");
  });

  it("displayValue prints dates as Melbourne days and leaves text alone", () => {
    expect(displayValue("agreement.signed_on", "2026-10-21")).toBe("21 October 2026");
    expect(displayValue("contractor.abn", "51 824 753 556")).toBe("51 824 753 556");
  });
});

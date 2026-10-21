import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { MERGE_FIELDS, SCHEDULE_KEYS, fieldsIn, formatAbn, isValidAbn, parseAgreement, splitTokens, unresolvedFields, type MergeField } from "./source";
import { agreementBodyHash } from "./hash";

const FILE = "docs/agreements/subcontractor-agreement-v1.md";
const md = readFileSync(resolve(__dirname, "../..", FILE), "utf8");

/**
 * The wording pin (brief §10). Version 1 is what contractors have signed; a
 * changed word is a NEW version: copy the file to subcontractor-agreement-v2.md,
 * bump `Version:`, seed it, and pin its hash here beside this one. Never
 * re-pin v1.
 */
const V1_SHA256 = "389e3ee0dbc4d211283cf0ea2ab7514c63c021393e4afe04568c00a99f656bea";
/** Version 2 (21 Oct 2026, Tom): v1 plus the contractor signature, name and date on Attachment A. */
const V2_SHA256 = "4dbec8ceafdf8fb10af2a4344582dfb5c3610cbb8c927105bf1b94655cd4dade";
const md2 = readFileSync(resolve(__dirname, "../..", "docs/agreements/subcontractor-agreement-v2.md"), "utf8");

describe("subcontractor agreement v1 — the committed file parses and is pinned", () => {
  const file = parseAgreement(md);

  it("is Version 1, approved 21 Oct 2026, converted from the corrected docx", () => {
    expect(file.version).toBe(1);
    expect(file.approvedOn).toBe("2026-10-21");
    expect(file.sourceFile).toBe("docs/agreements/source/Independent_Subcontractor_Agreement_Pty_Ltd_v1.docx");
    expect(file.title).toBe("Independent Contractor Agreement");
  });

  it("wording is pinned: a changed word without a version bump fails here", () => {
    expect(agreementBodyHash(md)).toBe(V1_SHA256);
  });

  it("carries the seventeen operative clauses in order, with the cross-referenced numbers", () => {
    const clauses = file.blocks.flatMap((b) => (b.kind === "heading" && b.level === 3 ? [b.text] : []));
    expect(clauses.slice(0, 17).map((t) => t.split(". ")[0])).toEqual(Array.from({ length: 17 }, (_, i) => String(i + 1)));
    expect(clauses[0]).toBe("1. Definitions");
    expect(clauses[16]).toBe("17. Australian Consumer Law Compliance Statement");
    const subs = file.blocks.flatMap((b) => (b.kind === "heading" && b.level === 4 ? [b.text] : []));
    for (const ref of ["3.5 Responsibility for Representative(s)", "8.2 Termination on Expiry Date", "13.3", "13.4", "13.5"]) expect(subs).toContain(ref);
    const items = file.blocks.filter((b) => b.kind === "item");
    const d35 = items.find((b) => b.kind === "item" && b.marker === "(d)" && b.text.startsWith("The Contractor is responsible for any claims"));
    expect(d35).toBeTruthy();
  });

  it("every schedule A to O is data, with the fixed values the docx carries", () => {
    expect(file.schedules.map((s) => s.key)).toEqual(SCHEDULE_KEYS);
    const by = Object.fromEntries(file.schedules.map((s) => [s.key, s.value]));
    expect(by.C).toBe("VIC");
    expect(by.E).toBe("As set out on each work order the Contractor accepts in the Paint Group portal (exclusive of GST)");
    expect(by.K).toBe("$10,000,000");
    expect(by.J).toBe("NA");
    expect(by.A).toBe("{{agreement.signed_on}}");
    expect(by.D).toBe("{{agreement.commencement_on}}");
    expect(fieldsIn(by.B)).toEqual(["contractor.company_name", "contractor.abn", "contractor.address"]);
    expect(fieldsIn(by.M)).toEqual(["agreement.expires_on"]);
  });

  it("uses every merge field and no other token", () => {
    expect([...file.fields].sort()).toEqual([...MERGE_FIELDS].sort());
    expect(file.fields.slice(0, 2)).toEqual(["contractor.company_name", "contractor.abn"]);
  });

  it("the signing section carries both signature blocks as tables", () => {
    const at = file.blocks.findIndex((b) => b.kind === "heading" && b.text === "Signed as an agreement");
    const tables = file.blocks.slice(at).filter((b) => b.kind === "table").slice(0, 2);
    expect(tables).toHaveLength(2);
    expect(tables[0].kind === "table" && tables[0].rows[1]).toEqual(["{{company.signature}}", "{{company.signatory_name}}", "{{company.signed_on}}"]);
    expect(tables[1].kind === "table" && tables[1].rows[1]).toEqual(["{{contractor.signature}}", "{{contractor.signed_name}}", "{{contractor.signed_on}}"]);
  });

  it("list levels follow the markers", () => {
    const levels = new Map(file.blocks.flatMap((b) => (b.kind === "item" ? [[b.marker, b.level] as const] : [])));
    expect(levels.get("1.")).toBe(0);
    expect(levels.get("(a)")).toBe(1);
    expect(levels.get("(iv)")).toBe(2);
    expect(levels.get("(A)")).toBe(3);
  });
});

describe("subcontractor agreement v2 — Attachment A signed with the agreement", () => {
  const file = parseAgreement(md2);
  it("is Version 2, pinned, and differs from v1 only in the Attachment A signing row", () => {
    expect(file.version).toBe(2);
    expect(agreementBodyHash(md2)).toBe(V2_SHA256);
    const strip = (m: string) => m.slice(m.indexOf("\n## ")).replace(/\| \{\{contractor\.signature\}\} \| \{\{contractor\.signed_name\}\} \| \{\{contractor\.signed_on\}\} \|\n$/, "| | | |\n");
    expect(strip(md2)).toBe(md.slice(md.indexOf("\n## ")));
    const at = file.blocks.findIndex((b) => b.kind === "heading" && b.text === "Attachment A");
    const table = file.blocks.slice(at).find((b) => b.kind === "table");
    expect(table && table.kind === "table" && table.rows[1]).toEqual(["{{contractor.signature}}", "{{contractor.signed_name}}", "{{contractor.signed_on}}"]);
  });
});

describe("tokens", () => {
  it("split a text into runs and refuse an unknown field", () => {
    expect(splitTokens("ABN: {{contractor.abn}} of {{ contractor.address }}.")).toEqual([
      { kind: "text", text: "ABN: " }, { kind: "token", field: "contractor.abn" }, { kind: "text", text: " of " }, { kind: "token", field: "contractor.address" }, { kind: "text", text: "." },
    ]);
    expect(() => splitTokens("{{contractor.acn}}")).toThrow(/unknown merge field/);
  });

  it("unresolvedFields names what is blank, so a render can refuse", () => {
    const file = { fields: ["contractor.abn", "contractor.address"] as MergeField[] };
    expect(unresolvedFields(file, { "contractor.abn": "41 639 780 108", "contractor.address": " " })).toEqual(["contractor.address"]);
    expect(unresolvedFields(file, { "contractor.abn": "41 639 780 108", "contractor.address": "1 Demo St" })).toEqual([]);
  });
});

describe("parse refuses a malformed file", () => {
  const base = md;
  it("no version", () => expect(() => parseAgreement(base.replace(/^Version: 1$/m, ""))).toThrow(/Version/));
  it("a schedule out of order", () => expect(() => parseAgreement(base.replace("| C | Applicable", "| X | Applicable"))).toThrow(/Schedule X/));
  it("an unknown token", () => expect(() => parseAgreement(base.replace(/\{\{contractor\.abn\}\}/g, "{{contractor.acn}}"))).toThrow(/unknown merge field/));
  it("a field the document never uses", () => expect(() => parseAgreement(base.replace(/\{\{agreement\.expires_on\}\}/g, ""))).toThrow(/never uses: agreement.expires_on/));
  it("no signing section", () => expect(() => parseAgreement(base.replace("## Signed as an agreement", "## Signatures"))).toThrow(/Signed as an agreement/));
});

describe("ABN", () => {
  it("validates by the ATO weighting and formats 2-3-3-3", () => {
    expect(isValidAbn("41 639 780 108")).toBe(true);     // the Company, from the cover
    expect(isValidAbn("51824753556")).toBe(true);        // the ATO example
    expect(isValidAbn("51824753557")).toBe(false);
    expect(isValidAbn("1234")).toBe(false);
    expect(formatAbn("41639780108")).toBe("41 639 780 108");
  });
});

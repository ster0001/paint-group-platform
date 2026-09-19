import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ACL_LINE,
  WARRANTY_YEARS,
  warrantyAttachmentLine,
  warrantyClauses,
  warrantyPromise,
} from "./terms";

/**
 * The no-fork proof for the workmanship warranty.
 *
 * The words a customer reads on their estimate and the words in their portal
 * must be the same words. They are, because both render `warrantyClauses()` —
 * and this file fails if a component ever starts retyping a clause.
 */
const root = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

const PARTY = {
  companyName: "Paint Group Pty Ltd",
  abn: "11 222 333 444",
  address: "1 Example St, Melbourne",
  phone: "(03) 9000 0000",
  email: "warranty@paintgroup.com.au",
};

describe("the warranty terms module", () => {
  it("is two years, everywhere", () => {
    expect(WARRANTY_YEARS).toBe(2);
    expect(warrantyPromise()).toMatch(/two full years/);
    expect(warrantyAttachmentLine()).toMatch(/two years/);
  });

  it("carries the nine clauses a warranty against defects needs", () => {
    const c = warrantyClauses(PARTY);
    expect(c.map((x) => x.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    // reg 90's mandatory content, by the clause that carries it.
    expect(c[0].body).toContain(PARTY.companyName); // who gives it
    expect(c[0].body).toContain(PARTY.abn);
    expect(c[0].body).toContain(PARTY.address);
    expect(c[0].body).toContain(PARTY.phone); // how to reach us
    expect(c[2].heading).toMatch(/What we will do/);
    expect(c[4].heading).toMatch(/How to make a claim/);
    expect(c[5].body).toMatch(/costs you nothing/); // who bears the expense
    expect(c[6].body).toMatch(/two years/); // the period
    expect(c[8].body).toMatch(/cannot be excluded under the Australian Consumer Law/);
  });

  /** Tom, 19 Sep 2026: "Remove the ability to transfer a warranty." */
  it("does not transfer to a new owner, and clause 8 is settled", () => {
    const eight = warrantyClauses(PARTY).find((c) => c.n === 8)!;
    expect(eight.body).toMatch(/does not transfer/);
    expect(eight.body).toMatch(/cannot be assigned/);
    expect(eight.body).not.toMatch(/being finalised/i);
    expect(eight.body).not.toMatch(/transfers automatically|attaches to the property/i);
    // …and never quietly at the customer's expense: the ACL still stands.
    expect(eight.body).toMatch(/Australian Consumer Law/);
    expect(warrantyAttachmentLine()).toMatch(/does not transfer/);
  });

  it("states the consumer-law line wherever the warranty is promised", () => {
    expect(ACL_LINE).toMatch(/in addition to your rights under the Australian Consumer Law/);
    expect(warrantyAttachmentLine()).toContain(ACL_LINE);
  });

  /**
   * Tom, 19 Sep 2026: the terms are an ATTACHMENT. The line the quote carries
   * points at it and states the fact — it must never grow into the terms.
   */
  it("the quote's line points at the attachment instead of reciting it", () => {
    const line = warrantyAttachmentLine();
    expect(line).toMatch(/attached to your online estimate/);
    expect(line).not.toMatch(/quality of our preparation and application/);
    expect(line.length).toBeLessThan(600);
  });

  it("degrades honestly when the company details are not filled in", () => {
    const bare = warrantyClauses({ companyName: "Paint Group" });
    expect(bare[0].body).toBe("This warranty is given by Paint Group.");
    expect(bare[4].body).not.toMatch(/undefined|null/);
  });
});

describe("one source — no component retypes a clause", () => {
  const SURFACES = [
    "app/account/(portal)/documents/WarrantyTerms.tsx",
    "app/e/[token]/warranty/page.tsx",
  ];

  it("every surface that shows the warranty imports it", () => {
    for (const f of SURFACES) {
      expect(read(f), f).toMatch(/from "@\/lib\/warranty\/terms"/);
    }
  });

  it("no surface has its own copy of a clause", () => {
    // A sentence unique to the terms. If it appears in a component, someone
    // pasted the words instead of rendering them.
    const tell = /quality of our preparation and application/;
    for (const f of [...SURFACES, "app/e/[token]/CustomerEstimate.tsx"]) {
      expect(read(f), `${f} has its own copy of the terms`).not.toMatch(tell);
    }
  });

  /** The estimate links to the attachment; it does not render the clauses. */
  it("the estimate carries a link to the attachment, not the terms", () => {
    const est = read("app/e/[token]/CustomerEstimate.tsx");
    expect(est).toMatch(/\/e\/\$\{token\}\/warranty/);
    expect(est).not.toMatch(/warrantyClauses/);
  });
});

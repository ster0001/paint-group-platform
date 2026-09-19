import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Tom, 19 Sep 2026: the company address is 25/25-**27** Bunney Road.
 *
 * It had been "25/25-35" since the invoicing migration seeded it from the
 * PaintScout header in November, and it reached every invoice and the RCTI
 * agreement template before anyone noticed. The live value is a settings row
 * (corrected by 20270177000000); these are the copies that live in the repo,
 * and the point of this test is that they cannot drift apart again — or from
 * the address, quietly, one file at a time.
 *
 * `supabase/migrations/20261112000000_invoicing_core.sql` and the August audit
 * are deliberately NOT checked: they are records of what ran and what was true
 * then, and rewriting either would make the history a lie.
 */
const root = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

/** SQL comments explain the correction and name the old value — check the
 *  statements, not the prose. */
const values = (p: string) =>
  p.endsWith(".sql")
    ? read(p).split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n")
    : read(p);

const STREET = "25/25-27 Bunney Road";
const SUBURB = "Oakleigh South VIC 3167";
const ABN = "41 639 780 108";

const LIVE_COPIES = [
  "app/(app)/settings/InvoicingSettings.tsx",
  "docs/legal/rcti-agreement-template.md",
  "supabase/migrations/20270177000000_company_address_correction.sql",
];

describe("the company address, in the files that still state it", () => {
  it("is 25-27 everywhere, and 25-35 nowhere", () => {
    for (const f of LIVE_COPIES) {
      const text = values(f);
      expect(text, `${f} should carry the address`).toContain(STREET);
      expect(text, `${f} still has the old street number`).not.toContain("25-35");
    }
  });

  it("agrees on the suburb line and the ABN", () => {
    for (const f of LIVE_COPIES) {
      const text = values(f);
      expect(text, `${f} suburb line`).toContain(SUBURB);
      expect(text, `${f} ABN`).toContain(ABN);
    }
  });

  it("corrects the seeded row rather than rewriting the migration that seeded it", () => {
    // The November file stays as the record of what actually ran.
    expect(read("supabase/migrations/20261112000000_invoicing_core.sql")).toContain("25/25-35 Bunney Road");
    // And the correction registers itself, like every migration here.
    expect(read("supabase/migrations/20270177000000_company_address_correction.sql"))
      .toContain("insert into public._prod_migrations(name) values ('20270177000000_company_address_correction.sql')");
  });
});

/**
 * Addendum A2 as a contract: revision drafts are one-per-change, the
 * contractor's money is computed in SQL, zero-delta changes retire their
 * draft, and zero-site-work variations never wait on a contractor.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const A2 = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20261117000000_revision_variations.sql"),
  "utf8",
);

describe("revision drafting", () => {
  it("one live draft per change is a database constraint", () => {
    expect(A2).toMatch(
      /create unique index if not exists wo_variations_revision_draft_uidx[\s\S]{0,200}where status = 'priced' and revision_block_ref is not null/,
    );
  });

  it("drafting is staff-only and the contractor delta is SQL-computed", () => {
    expect(A2).toMatch(/wo_draft_revision_variation[\s\S]{0,600}not_staff/);
    expect(A2).toContain("v_rate  := public.wo_contractor_rate_cents();");
    expect(A2).toContain("v_delta := round(p_hours * v_rate)::integer;");
  });

  it("a change that nets to zero cancels its standing draft", () => {
    expect(A2).toMatch(
      /if p_price_cents = 0 and p_hours = 0 then[\s\S]{0,300}status = 'cancelled'/,
    );
  });

  it("re-drafting updates the same row — token and all — instead of littering", () => {
    expect(A2).toMatch(/if found then\s+update public\.wo_variations[\s\S]{0,1500}return 'ok:' \|\| v_v\.customer_token/);
  });

  it("zero-site-work variations skip the contractor at signing (ruling 3)", () => {
    expect(A2).toMatch(
      /coalesce\(v_v\.est_hours, 0\) = 0[\s\S]{0,600}variation_no_site_work/,
    );
    // …but never while a manual deduction is unresolved.
    expect(A2).toMatch(/if not coalesce\(v_manual, false\) then/);
  });
});

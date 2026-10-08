import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { variationApprovedEmail } from "./variationApprovedEmail";
import { notifyTypeOfKind } from "@/lib/notifications/prefs";

const base = {
  firstName: "Vera", signedName: "Vera Customer", signedAt: "2026-10-07T22:30:00Z",
  jobLabel: "12 Test St", link: "https://example.test/v/tok", company: "Paint Group", companyPhone: "03 9000 0000",
};

describe("the customer's variation-approved email (Tom, 8 Oct 2026)", () => {
  it("one addition: what it was, what it adds, who signed and when (Melbourne date)", () => {
    const m = variationApprovedEmail({ ...base, changes: [{ comment: "Paint the side gate", priceCents: 33000, credit: false }] });
    expect(m.subject).toBe("Your change is approved — Paint Group");
    expect(m.intro).toContain("• Paint the side gate — adds $330.00");
    expect(m.intro).toContain("Your job total goes up by $330.00 (inc GST).");
    // 22:30Z on 7 Oct is 8 Oct in Melbourne (AEDT, +11) — never the UTC date.
    expect(m.intro).toContain("Approved by Vera Customer on 8 Oct 2026.");
    expect(m.intro).toContain("03 9000 0000");
    expect(m.html).toContain("View the approved change");
  });

  it("an offer of several changes is one email with the net", () => {
    const m = variationApprovedEmail({
      ...base,
      changes: [
        { comment: "Add the garage", priceCents: 50000, credit: false },
        { comment: "Drop the shed", priceCents: 20000, credit: true },
      ],
    });
    expect(m.subject).toBe("Your changes are approved — Paint Group");
    expect(m.intro).toContain("2 changes");
    expect(m.intro).toContain("• Drop the shed — takes $200.00 off");
    expect(m.intro).toContain("goes up by $300.00");
  });

  it("a net credit reads as coming down; a blank name still says hello", () => {
    const m = variationApprovedEmail({ ...base, firstName: "", changes: [{ comment: "", priceCents: 12345, credit: true }] });
    expect(m.intro.startsWith("Hello,")).toBe(true);
    expect(m.intro).toContain("comes down by $123.45");
    expect(m.intro).toContain("A change to the scope");
  });

  it("is a 'job' notification, so the customer's own switch applies", () => {
    expect(notifyTypeOfKind("variation_approved")).toBe("job");
  });
});

describe("the office's reject (20270240)", () => {
  const sql = readFileSync(resolve(__dirname, "../../supabase/migrations/20270240000000_variation_office_reject.sql"), "utf8");
  it("is staff-only, moves only a 'raised' row, and is granted to signed-in users only", () => {
    expect(sql).toMatch(/if not public\.is_staff\(\) then return 'error:not_staff'/);
    expect(sql).toMatch(/if v_v\.status <> 'raised' then return 'error:not_raised'/);
    expect(sql).toMatch(/grant execute on function public\.wo_office_reject_variation\(uuid, text\) to authenticated;/);
    expect(sql).not.toMatch(/to anon/);
  });
  it("ends by registering itself", () => {
    expect(sql.trim().split("\n").pop()).toBe(
      "insert into public._prod_migrations(name) values ('20270240000000_variation_office_reject.sql') on conflict (name) do nothing;",
    );
  });
});

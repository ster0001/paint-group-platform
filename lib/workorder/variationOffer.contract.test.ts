/**
 * 20270192 as a contract: the customer's OFFER (Tom, 23 Sep 2026). Every
 * pending revision draft on a job shares one signing token; one signature or
 * one "no thanks" answers them all; a change signed with nobody on the job
 * folds straight in, and the offer that later goes to a painter carries it.
 * These pins fail the suite on every commit if the SQL guarantees are undone,
 * rather than only when someone remembers to run Playwright against live.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { contractorVariationCents } from "./contractorPay";
import { offerRowCents, pendingOffers, scopeChangesFrom } from "./scopeChanges";

const SQL = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20270192000000_variation_offer_bundle.sql"),
  "utf8",
);
const fn = (name: string) => {
  const start = SQL.indexOf(`function public.${name}(`);
  expect(start, `${name} is defined in 20270192`).toBeGreaterThan(-1);
  const end = SQL.indexOf("$$;", start);
  return SQL.slice(start, end);
};

describe("the token is an offer, not a row", () => {
  it("the unique constraint on customer_token goes, a plain index comes", () => {
    expect(SQL).toMatch(/drop constraint %I/);
    expect(SQL).toContain("create index if not exists wo_variations_customer_token_idx");
  });

  it("a new draft joins the open offer's token; a fresh one only when nothing is pending", () => {
    const draft = fn("wo_draft_revision_variation");
    expect(draft).toMatch(/select customer_token into v_token[\s\S]{0,300}status = 'priced'[\s\S]{0,200}revision_block_ref is not null/);
    expect(draft).toMatch(/if v_token is null then[\s\S]{0,120}gen_random_uuid/);
  });

  it("the token read lists every row, in order, with no limit", () => {
    const read = fn("wo_variation_by_token");
    expect(read).toContain("order by v.created_at");
    expect(read).not.toContain("limit 1");
  });
});

describe("one signature answers the offer", () => {
  const sign = fn("wo_customer_sign_variation");

  it("still demands the drawn signature and a name, before touching any row", () => {
    expect(sign).toContain("error:name_required");
    expect(sign).toContain("data:image/png;base64,%");
    expect(sign).toMatch(/length\(p_signature\) < 100/);
    expect(sign.indexOf("error:signature_required")).toBeLessThan(sign.indexOf("for v_v in"));
  });

  it("loops over every pending row behind the token, locking them", () => {
    expect(sign).toMatch(/for v_v in\s+select \* from public\.wo_variations\s+where customer_token = p_token and status = 'priced'[\s\S]{0,80}for update/);
    expect(sign).toMatch(/signed_name = trim\(p_name\), signature = p_signature, signed_at = now\(\)/);
  });

  it("keeps the strike, the started-work route and the no-site-work skip per row", () => {
    expect(sign).toMatch(/update public\.wo_surfaces\s+set removed_from_scope = true[\s\S]{0,300}state = 'todo'/);
    expect(sign).toMatch(/if v_started > 0 then[\s\S]{0,200}needs_manual_deduction = true/);
    expect(sign).toContain("variation_no_site_work");
  });

  it("with nobody on the job the change folds in — contractor_accepted on signature", () => {
    expect(sign).toMatch(/if not v_painter then[\s\S]{0,600}status = 'contractor_accepted'[\s\S]{0,400}variation_folded_into_offer/);
    // …but never over a removal that still needs the PC's deduction.
    expect(sign).toMatch(/if v_status = 'customer_approved' and not coalesce\(v_manual, false\) then/);
  });

  it("an answered offer says so; an unknown token is not found", () => {
    expect(sign).toMatch(/if v_answered = 0 then[\s\S]{0,300}error:not_found[\s\S]{0,100}error:already_/);
  });

  it("declining declines every pending row and never approves", () => {
    const respond = fn("wo_customer_respond_variation");
    expect(respond).toMatch(/if p_approve then[\s\S]{0,200}error:signature_required/);
    expect(respond).not.toContain("'customer_approved'");
    expect(respond).toMatch(/for v_v in[\s\S]{0,200}status = 'priced'[\s\S]{0,400}status = 'declined'/);
  });
});

describe("the painter sees it", () => {
  it("a painter is a named contractor, a live/accepted offer, or an employee assignment", () => {
    const has = fn("wo_has_painter");
    expect(has).toContain("w.contractor_id is not null");
    expect(has).toContain("o.state in ('offered', 'proposed', 'accepted')");
    expect(has).toContain("a.status <> 'released'");
  });

  it("send_offer prices the offer as base pay + accepted variations, server-side", () => {
    const offer = fn("send_offer");
    expect(offer).toMatch(/v_wo\.contractor_payment_cents\s*\+ public\.wo_contractor_variations_cents\(v_wo\.id\)/);
    expect(offer).toMatch(/payment_cents, staff_note, expires_at[\s\S]{0,200}v_pay,/);
  });

  it("the job sheet's token read carries scope and hours, never a price column", () => {
    const read = fn("get_work_order_scope_changes_by_token");
    expect(read).toMatch(/returns table \(id uuid, category text, comment text, est_hours numeric, credit boolean,\s+status text, approved_at timestamptz\)/);
    expect(read).not.toContain("price_cents");
    expect(read).not.toContain("contractor_delta_cents");
    expect(read).toContain("v.status in ('customer_approved', 'contractor_accepted')");
  });
});

describe("the SQL money twin agrees with lib/workorder/contractorPay.ts", () => {
  it("wo_contractor_variations_cents mirrors contractorVariationCents case by case", () => {
    const sql = fn("wo_contractor_variations_cents");
    expect(sql).toContain("when not v.credit then coalesce(v.contractor_delta_cents, 0)");
    expect(sql).toContain("when v.needs_manual_deduction then -coalesce(v.deduction_cents, 0)");
    expect(sql).toContain("else -coalesce(v.deduction_cents, v.contractor_delta_cents, 0)");
    expect(sql).toContain("v.status = 'contractor_accepted'");
    // The TS side, on the same three shapes.
    const base = { status: "contractor_accepted", deduction_cents: null, needs_manual_deduction: false };
    expect(contractorVariationCents({ ...base, credit: false, contractor_delta_cents: 18000 })).toBe(18000);
    expect(contractorVariationCents({ ...base, credit: true, contractor_delta_cents: 6000, needs_manual_deduction: true, deduction_cents: 2500 })).toBe(-2500);
    expect(contractorVariationCents({ ...base, credit: true, contractor_delta_cents: 6000 })).toBe(-6000);
    expect(contractorVariationCents({ ...base, status: "customer_approved", credit: false, contractor_delta_cents: 18000 })).toBe(0);
  });
});

describe("the portal groups by offer", () => {
  const rows = [
    { id: "a", status: "priced", price_cents: 30000, credit: false, customer_token: "T1", customer_responded_at: null },
    { id: "b", status: "priced", price_cents: 12000, credit: true, customer_token: "T1", customer_responded_at: null },
    { id: "c", status: "priced", price_cents: 5000, credit: false, customer_token: "T2", customer_responded_at: null },
    { id: "d", status: "customer_approved", price_cents: 9000, credit: false, customer_token: "T3", customer_responded_at: "2026-09-23" },
    { id: "e", status: "priced", price_cents: 9000, credit: false, customer_token: null, customer_responded_at: null },
  ];

  it("one offer per token, pending rows only, net = additions − credits", () => {
    const offers = pendingOffers(rows);
    expect(offers.map((o) => [o.token, o.count, o.netCents])).toEqual([["T1", 2, 18000], ["T2", 1, 5000]]);
    expect(offerRowCents({ price_cents: 12000, credit: true })).toBe(-12000);
  });

  it("the sheet lists only approved rows, oldest first, hours as numbers", () => {
    const changes = scopeChangesFrom([
      { id: "x", category: "extra_scope", comment: "Garage", est_hours: "6.50", credit: false, status: "contractor_accepted", customer_responded_at: "2026-09-23T02:00:00Z" },
      { id: "y", category: "scope_removed", comment: "Pergola", est_hours: 3, credit: true, status: "customer_approved", customer_responded_at: "2026-09-23T01:00:00Z" },
      { id: "z", category: "extra_scope", comment: "Pending", est_hours: 1, credit: false, status: "priced" },
      { id: "w", category: "extra_scope", comment: "No", est_hours: 1, credit: false, status: "declined" },
    ]);
    expect(changes.map((c) => c.id)).toEqual(["y", "x"]);
    expect(changes[1].estHours).toBe(6.5);
    expect(changes[0].credit).toBe(true);
  });
});

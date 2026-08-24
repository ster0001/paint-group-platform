/**
 * Addendum A1 as a contract: variation approval requires the DRAWN signature,
 * a signed credit strikes only untouched surfaces, started work routes the
 * deduction to the PC, and the accepted estimate is frozen at the database.
 * These pins fail the suite on every commit if the SQL guarantees are undone,
 * rather than only when someone remembers to run Playwright against live.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const A1 = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20261116000000_variation_signature_working_scope.sql",
  ),
  "utf8",
);

describe("ruling 1 — the drawn signature", () => {
  it("the one-tap approve path refuses without a signature", () => {
    // wo_customer_respond_variation's approve arm returns the refusal…
    expect(A1).toMatch(/if p_approve then[\s\S]{0,200}error:signature_required/);
    // …and never writes customer_approved any more.
    const respond = A1.slice(
      A1.indexOf("create or replace function public.wo_customer_respond_variation"),
      A1.indexOf("drop function if exists public.wo_variation_by_token"),
    );
    expect(respond).not.toContain("'customer_approved'");
  });

  it("the signing RPC demands a name and a plausible PNG data URL", () => {
    expect(A1).toContain("error:name_required");
    expect(A1).toContain("data:image/png;base64,%");
    expect(A1).toMatch(/length\(p_signature\) < 100/);
    expect(A1).toContain("error:signature_too_big");
  });

  it("signature, name and timestamp are stored on the variation", () => {
    expect(A1).toMatch(
      /signed_name = trim\(p_name\), signature = p_signature, signed_at = now\(\)/,
    );
  });
});

describe("rulings 2–3 — the strike and the started-work guard", () => {
  it("only untouched surfaces are struck; struck means marked, never deleted", () => {
    // The strike is an UPDATE (never a DELETE) and is fenced to state='todo'.
    expect(A1).toMatch(
      /update public\.wo_surfaces\s+set removed_from_scope = true[\s\S]{0,300}state = 'todo'/,
    );
  });

  it("started work flips needs_manual_deduction and routes to the PC", () => {
    expect(A1).toMatch(
      /if v_started > 0 then[\s\S]{0,200}needs_manual_deduction = true/,
    );
    expect(A1).toContain("variation_needs_manual_deduction");
  });

  it("acknowledge waits for the PC's figure when the deduction is manual", () => {
    expect(A1).toContain("error:awaiting_pc_deduction");
  });

  it("the deduction is a staff act with an audit event, never negative", () => {
    expect(A1).toMatch(
      /wo_set_variation_deduction[\s\S]{0,400}error:not_staff/,
    );
    expect(A1).toMatch(/p_cents is null or p_cents < 0/);
    expect(A1).toContain("variation_deduction_set");
  });

  it("a struck surface can never be ticked and never blocks the stage gate", () => {
    expect(A1).toContain("error:removed_from_scope");
    expect(A1).toMatch(
      /from public\.wo_surfaces\s+where work_order_id = p_wo_id and not removed_from_scope/,
    );
  });

  it("a reseed keeps struck rows as evidence", () => {
    expect(A1).toMatch(/and s\.removed_from_scope = false[\s\S]{0,120}and s\.state = 'todo'/);
  });
});

describe("the working scope and the frozen estimate", () => {
  it("the accepted estimate refuses changes to scope and money at the DB", () => {
    expect(A1).toMatch(
      /old\.status = 'accepted'[\s\S]{0,600}new\.builder_state is distinct from old\.builder_state/,
    );
    expect(A1).toContain("create trigger estimates_frozen");
    // service_role stays exempt for e2e teardown, matching the invoice rule.
    expect(A1).toMatch(/current_user <> 'service_role'/);
  });

  it("the diff baseline (accepted_state) is itself immutable", () => {
    expect(A1).toMatch(
      /new\.accepted_state is distinct from old\.accepted_state/,
    );
    expect(A1).toContain("wo_working_scopes_baseline");
  });

  it("working-scope writes are staff-only RPCs; the table grants SELECT only", () => {
    expect(A1).toMatch(/wo_open_working_scope[\s\S]{0,300}not_staff/);
    expect(A1).toMatch(/wo_save_working_scope[\s\S]{0,300}not_staff/);
    expect(A1).toContain("grant select on public.wo_working_scopes to authenticated");
    expect(A1).not.toMatch(/grant (insert|update|delete).*wo_working_scopes/);
  });

  it("wo_working_scopes has RLS enabled with a staff policy in the same file", () => {
    expect(A1).toContain("alter table public.wo_working_scopes enable row level security");
    expect(A1).toContain("wo_working_scopes_staff_read");
  });
});

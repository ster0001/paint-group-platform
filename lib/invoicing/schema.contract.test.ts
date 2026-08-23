/**
 * Contract tests over the Step 1 invoicing migrations — the same
 * migration-text pinning as contract.test.ts (A2): these run in `npm test`
 * with no database, so undoing a DB-level guarantee fails on every commit,
 * not only when someone remembers to run Playwright against live.
 *
 * The live proof happens after Tom pastes the SQL:
 * docs/manual-tests/invoicing-step1.md.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const MIG = resolve(process.cwd(), "supabase/migrations");
const read = (f: string) => readFileSync(resolve(MIG, f), "utf8");
const ENUM = read("20261111000000_invoice_status_enum.sql");
const CORE = read("20261112000000_invoicing_core.sql");

describe("the enum widening stands alone (the 20261109 lesson)", () => {
  it("only ALTER TYPE and a readback — no use of the new values", () => {
    expect(ENUM).not.toMatch(/create table|create or replace function|insert into public\./i);
  });
  it("the core file sorts after it", () => {
    expect("20261111000000" < "20261112000000").toBe(true);
  });
});

describe("issued invoices are immutable AT THE DATABASE", () => {
  it("a BEFORE UPDATE trigger refuses money edits after issue", () => {
    expect(CORE).toContain("raise exception 'invoice_immutable_after_issue'");
    expect(CORE).toMatch(/create trigger t_invoice_guard_update\s*\n\s*before update on public\.invoices/);
  });
  it("every status move is checked against the matrix — for every writer", () => {
    expect(CORE).toContain("raise exception 'invoice_illegal_transition");
    expect(CORE).toMatch(/from public\.invoice_transitions t\s*\n\s*where t\.from_status = old\.status and t\.to_status = new\.status/);
  });
  it("only drafts can be deleted", () => {
    expect(CORE).toContain("raise exception 'invoice_undeletable");
    expect(CORE).toMatch(/create trigger t_invoice_guard_delete\s*\n\s*before delete on public\.invoices/);
  });
  it("lines lock with their invoice", () => {
    expect(CORE).toContain("raise exception 'invoice_lines_locked");
  });
  it("the PDF, once written, is never regenerated", () => {
    expect(CORE).toContain("raise exception 'invoice_pdf_immutable'");
  });
  it("drafts are unnumbered; issued numbers are permanent (burnt on void)", () => {
    expect(CORE).toMatch(/invoices_draft_unnumbered\s*\n\s*check \(\(status = 'draft'\) = \(number is null\)\)/);
  });
});

describe("double-billing a variation is a constraint violation", () => {
  it("the partial unique index exists, scoped to non-void parents", () => {
    expect(CORE).toMatch(
      /create unique index if not exists invoice_lines_variation_once\s*\n\s*on public\.invoice_lines \(source_ref\)\s*\n\s*where source = 'variation' and not parent_void/,
    );
  });
  it("void frees the billed variations through the mirror trigger", () => {
    expect(CORE).toMatch(/update public\.invoice_lines set parent_void = true/);
  });
});

describe("the stub contract: sign-off now drafts the FINAL invoice", () => {
  it("wo_sign no longer inserts the $0 stub", () => {
    const body = CORE.slice(CORE.indexOf("10b. wo_sign"), CORE.indexOf("10c. wo_close"));
    expect(body).toContain("perform public.invoice_draft_final(v_wo.estimate_id)");
    expect(body).not.toMatch(/'draft', 0, v_start/);
  });
  it("wo_close_without_walkthrough no longer inserts the $0 stub", () => {
    const body = CORE.slice(CORE.indexOf("10c. wo_close"), CORE.indexOf("10d. wo_reopen"));
    expect(body).toContain("perform public.invoice_draft_final(v_wo.estimate_id)");
    expect(body).not.toMatch(/'draft', 0, v_start/);
  });
  it("reopen drops the draft final (issued finals are guard-protected)", () => {
    const body = CORE.slice(CORE.indexOf("10d. wo_reopen"));
    expect(body).toMatch(/delete from public\.invoices\s*\n\s*where estimate_id = v_wo\.estimate_id and status = 'draft'\s*\n\s*and kind = 'final'/);
  });
  it("the final is the ledger's remaining balance, floored at zero", () => {
    expect(CORE).toContain("greatest(v_led.adjusted_contract_cents - v_led.invoiced_cents, 0)");
  });
});

describe("the deposit auto-drafts inside accept_estimate's transaction", () => {
  const body = CORE.slice(CORE.indexOf("10a. accept_estimate"), CORE.indexOf("10b. wo_sign"));
  it("kind 'deposit', with token, totals and a seeded line", () => {
    expect(body).toContain("v_wo_id, 'deposit', 'draft'");
    expect(body).toContain("public.invoice_new_token()");
    expect(body).toContain("insert into public.invoice_lines");
  });
  it("writes the immutable ledger anchor", () => {
    expect(body).toContain("accepted_total_cents = v_total");
  });
  it("the snapshot's own depositPct wins; the ⚑1 setting is the fallback", () => {
    expect(body).toMatch(/coalesce\(\(v_snapshot->>'depositPct'\)::numeric,\s*\n\s*public\.invoice_setting_num\('\{depositPct\}', 10\)\)/);
  });
  it("A2 preserved: the insert still names customer_id", () => {
    expect(body).toMatch(/insert into public\.invoices \(estimate_id, customer_id/);
  });
});

describe("one ledger, one GST rule — SQL twins pinned to the lib", () => {
  it("the SQL ledger uses the same approved-variation set as ledger.ts", () => {
    expect(CORE).toContain("v.status in ('customer_approved', 'contractor_accepted')");
    expect(CORE).toMatch(/case when v\.credit then -v\.price_cents else v\.price_cents end/);
  });
  it("invoiced excludes draft + void; paid counts succeeded only", () => {
    expect(CORE).toContain("i.status not in ('draft', 'void')");
    expect(CORE).toContain("p.status = 'succeeded'");
  });
  it("the GST twins carry the two derivations of gst.ts", () => {
    expect(CORE).toMatch(/gst_on_ex_cents[\s\S]{0,200}round\(p_ex \* p_rate \/ 100\)/);
    expect(CORE).toMatch(/gst_from_inc_cents[\s\S]{0,200}round\(p_inc \* p_rate \/ \(100 \+ p_rate\)\)/);
  });
  it("the internal ledger is not callable from any browser session", () => {
    expect(CORE).toContain(
      "revoke execute on function public.invoice_ledger(uuid) from public, anon, authenticated",
    );
  });
});

describe("§4.1 — no client writes to any money table", () => {
  it("invoices and payments lose their direct write grants", () => {
    expect(CORE).toContain("revoke insert, update, delete on public.invoices from authenticated, anon");
    expect(CORE).toContain("revoke insert, update, delete on public.payments from authenticated, anon");
  });
  it("every new table gets RLS and a staff policy in the same file", () => {
    for (const t of [
      "invoice_lines", "invoice_events", "credit_notes", "stripe_events",
      "vendors", "job_costs", "material_costs", "invoice_transitions",
      "contractor_invoices",
    ]) {
      expect(CORE).toContain(`'${t}'`);
    }
    expect(CORE).toMatch(/enable row level security/);
    expect(CORE).toMatch(/revoke insert, update, delete on public\.%I from authenticated, anon/);
  });
  it("the operator-entered amount is bounded (§4.2: balance × 1.05)", () => {
    expect(CORE).toContain("if p_amount_cents > round(v_balance * 1.05) then return 'error:exceeds_balance'");
  });
  it("card payments are refused at the manual-payment door", () => {
    expect(CORE).toContain("return 'error:stripe_via_webhook'");
  });
  it("request-payment takes intent, never cents-from-the-browser for percents", () => {
    expect(CORE).toContain("round(v_led.adjusted_contract_cents * p_value / 100)");
  });
});

describe("numbering (⚑13)", () => {
  it("allocated at issue from the sequence, 4-digit, prefix from Settings", () => {
    expect(CORE).toMatch(/number = public\.invoice_allocate_number\(\)/);
    expect(CORE).toContain("lpad(nextval('public.invoice_no_seq')::text, 4, '0')");
  });
  it("receipts have their own RCT- sequence", () => {
    expect(CORE).toContain("lpad(nextval('public.receipt_no_seq')::text, 4, '0')");
  });
});

describe("readback discipline", () => {
  it("both files end by selecting what they just made", () => {
    expect(ENUM).toContain("order by enumsortorder");
    expect(CORE).toContain("invoices_missing_backfill");
    expect(CORE).toContain("relrowsecurity");
  });
});

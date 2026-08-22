/**
 * Contract tests over the §4b migration (20261028) — the same discipline as
 * signoff.test.ts: pin the load-bearing SQL so a later "create or replace"
 * cannot quietly drop a rule Tom ruled on.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SQL = readFileSync(
  resolve(process.cwd(), "supabase/migrations", "20261028000000_wo_walkthroughs_signoff_v3.sql"),
  "utf8",
);

describe("Mode B is a fallback, not a door", () => {
  it("refuses a remote sign until unavailable-marked or walkthrough missed", () => {
    expect(SQL).toContain("error:walkthrough_first");
    expect(SQL).toMatch(/client_unavailable_at is null and not exists/);
    expect(SQL).toMatch(/kind = 'final' and status = 'missed'/);
  });

  it("never trusts the caller's kind — it derives from the token", () => {
    expect(SQL).toMatch(/v_via = 'session'[\s\S]{0,80}v_kind := 'on_device'/);
    expect(SQL).toMatch(/v_kind := 'remote'/);
  });

  it("refuses an early deemed claim at the server", () => {
    expect(SQL).toContain("error:deemed_too_early");
    expect(SQL).toMatch(/now\(\) < v_s\.deadline_at/);
  });
});

describe("Mode A is scoped and time-boxed", () => {
  it("only the assigned contractor or staff can mint a session", () => {
    expect(SQL).toMatch(/wo_start_walkthrough_mode[\s\S]{0,900}v_cid = v_w\.contractor_id/);
  });

  it("expires in two hours and dies on signing", () => {
    expect(SQL).toMatch(/interval '2 hours'/);
    expect(SQL).toMatch(/walkthrough_session_token = null/);
  });

  it("needs a booked final walkthrough, not a doorstep improvisation", () => {
    expect(SQL).toContain("error:no_walkthrough_booked");
  });

  it("records whose device captured the signature", () => {
    expect(SQL).toContain("'contractor_device'");
    expect(SQL).toContain("'customer_device'");
  });
});

describe("nothing shipped regresses", () => {
  it("the invoicing insert keeps naming customer_id (A2)", () => {
    expect(SQL).toContain("insert into public.invoices (estimate_id, customer_id");
  });

  it("the area flag still writes heading_meta and returns the job to in_progress", () => {
    expect(SQL).toContain("'flagged at walkthrough'");
    expect(SQL).toMatch(/wo_set_stage\(v_s\.work_order_id, 'in_progress'/);
  });

  it("the sweep's deemed path still goes through wo_sign with the customer token", () => {
    // The sweep (20261006) calls wo_sign(customer_token, …, 'deemed'); the new
    // body must accept that exact shape.
    expect(SQL).toMatch(/if v_via <> 'customer' then return 'error:deemed_needs_customer_token'/);
  });

  it("the final walkthrough defaults to the last day on site", () => {
    expect(SQL).toMatch(/select bo\.end_date into v_date/);
  });
});

describe("the ⚑10–12 settings land with the ruled defaults", () => {
  it("email-on-sign on, office books, pre optional", () => {
    expect(SQL).toMatch(/'signEmailImmediate', true/);
    expect(SQL).toMatch(/'bookedBy', 'office'/);
    expect(SQL).toMatch(/'preRequired', false/);
  });

  it("never clobbers a later ruling", () => {
    expect(SQL).toMatch(/\(value -> 'walkthrough'\) is null/);
  });
});

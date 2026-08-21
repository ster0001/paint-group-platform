/**
 * Contract tests over step 5's migrations.
 *
 * The one that matters most is the nudge copy. While deemed execution is off,
 * a reminder must not say a job will sign itself or that payment falls due
 * automatically — that is the wording waiting on legal review. Asserting it
 * here means flipping the switch cannot quietly change what a customer reads.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (f: string) => readFileSync(resolve(process.cwd(), "supabase/migrations", f), "utf8");
const QA = read("20261005000000_wo_qa_and_prep.sql");
const SIGN = read("20261006000000_wo_signoff.sql");
const SETTINGS = read("20260928000000_wo_loop_settings.sql");

describe("QA failures come back to the same tick list", () => {
  it("appends rectification rows rather than starting a parallel flow", () => {
    expect(QA).toMatch(/insert into public\.wo_surfaces[\s\S]*?rectification/);
    expect(QA).toContain("'via', 'qa_fail'");
    expect(QA).toMatch(/wo_set_stage\(v_c\.work_order_id, 'in_progress'/);
  });

  it("does not block a pass on a thin photo record — it flags it", () => {
    expect(QA).toContain("v_thin := v_photos < v_min");
    expect(QA).toContain("'thin_record', v_thin");
    // The thin record must not appear as a refusal.
    expect(QA).not.toMatch(/return 'error:thin/);
  });

  it("only schedules checks for contractors inside their first N jobs", () => {
    expect(QA).toContain("wo_contractor_is_new");
    expect(QA).toMatch(/qaCadence','newContractorJobs/);
  });

  it("gates QA on every check answered and passed", () => {
    expect(QA).toMatch(/result is null or result = 'fail'/);
    expect(QA).toContain("QA check");
  });

  it("gates the walkthrough on the prep checklist", () => {
    expect(QA).toContain("completion item");
    expect(QA).toMatch(/required = true and done_at is null/);
  });
});

describe("a walkthrough flag is work, not a complaint", () => {
  it("becomes a rectification row and sends the job back", () => {
    expect(SIGN).toMatch(/insert into public\.wo_surfaces[\s\S]*?'flagged at walkthrough'/);
    expect(SIGN).toContain("'via', 'walkthrough_flag'");
  });

  it("will not sign while an area is unapproved", () => {
    expect(SIGN).toContain("return 'error:areas_outstanding:'");
  });
});

describe("sign-off fires everything, in one transaction", () => {
  it("writes the warranty, the review task, the report and the invoice stub", () => {
    expect(SIGN).toContain("insert into public.warranties");
    expect(SIGN).toContain("insert into public.follow_ups");
    expect(SIGN).toContain("update public.wo_signoff set report = v_report");
    expect(SIGN).toContain("insert into public.invoices");
  });

  it("starts the warranty on the sign-off date, deemed included", () => {
    expect(SIGN).toMatch(/v_start := \(now\(\) at time zone 'Australia\/Melbourne'\)::date/);
    expect(SIGN).toContain("make_interval(years => v_years)");
  });

  it("puts declined variations in the report, since that is why they are kept", () => {
    expect(SIGN).toMatch(/'variations',[\s\S]*?from public\.wo_variations where work_order_id/);
    expect(SIGN).not.toMatch(/wo_variations where[^)]*status <> 'declined'/);
  });

  it("marks a deemed sign-off as deemed in the same events a person's writes", () => {
    expect(SIGN).toContain("'deemed', p_kind = 'deemed'");
    expect(SIGN).toMatch(/wo_set_stage\(v_s\.work_order_id, 'closed'/);
  });
});

describe("the nudge ladder, with deemed execution OFF", () => {
  it("ships with the switch off", () => {
    expect(SETTINGS).toContain("'deemedEnabled', false");
    expect(SETTINGS).toContain("'clockEnabled', true");
  });

  // Pull the two copy strings the sweep uses while deemed is off and check what
  // they promise. This is the wording that is waiting on legal review.
  const offCopy = [...SIGN.matchAll(/when p_rung = (\d+) and not p_deemed_enabled then\s*\n\s*'([^']+)'/g)]
    .map((m) => ({ rung: Number(m[1]), text: m[2] }));

  it("has copy for the 24h and 48h rungs", () => {
    expect(offCopy.map((c) => c.rung).sort()).toEqual([24, 48]);
  });

  it("never mentions signing happening by itself", () => {
    for (const { text } of offCopy) {
      const lower = text.toLowerCase();
      for (const banned of ["deemed", "signed off", "automatically", "treated as signed"]) {
        expect(lower).not.toContain(banned);
      }
    }
  });

  it("never mentions payment falling due", () => {
    for (const { text } of offCopy) {
      const lower = text.toLowerCase();
      for (const banned of ["invoice", "payment", "due", "charged"]) {
        expect(lower).not.toContain(banned);
      }
    }
  });

  it("does say the deemed wording once the switch is on, so the two are distinct", () => {
    expect(SIGN).toContain("treated as signed off on the date shown in your quote terms");
  });

  it("fires each rung at most once, and does not backdate a late one", () => {
    expect(SIGN).toMatch(/v_row\.nudges ->> v_rung::text\) is null/);
    expect(SIGN).toContain("'late', v_elapsed > v_rung + 1");
  });

  it("does not execute a deemed sign-off while the switch is off", () => {
    expect(SIGN).toMatch(/if v_deemed_on and v_row\.deadline_at is not null/);
  });

  it("pauses the clock while an extension is unanswered", () => {
    expect(SIGN).toMatch(/extension_requested_at is null or s\.extension_approved_at is not null/);
  });
});

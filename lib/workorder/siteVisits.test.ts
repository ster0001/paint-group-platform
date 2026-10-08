import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { leadPainterId, noteShareLine, siteVisitPhotoPrefix } from "./siteVisits";

/**
 * Tom, 9 Oct 2026: a site check-in is Felipe's own visit — notes, photos, an
 * optional send to the painter, never pass/fail, never a hold (20270248).
 */
const at = () => "Fri 9 Oct, 2:15 pm";

describe("a note's share state, in the office's words", () => {
  it("office-only until sent", () => {
    expect(noteShareLine({ sendToPainter: false, sentOutcome: null, sentDetail: "", sentAt: null }, at))
      .toBe("Office only — the painter has not been sent this.");
  });
  it("sent says it is in the painter's messages, when, and how they were told", () => {
    expect(noteShareLine({ sendToPainter: true, sentOutcome: "sent", sentDetail: "Texted and emailed to Marco.", sentAt: "2026-10-09T03:15:00Z" }, at))
      .toBe("In the painter's messages since Fri 9 Oct, 2:15 pm. Texted and emailed to Marco.");
  });
  it("skipped says why", () => {
    expect(noteShareLine({ sendToPainter: true, sentOutcome: "skipped", sentDetail: "There is no painter on this job yet.", sentAt: null }, at))
      .toBe("Not delivered: There is no painter on this job yet.");
  });
});

describe("who hears about a note", () => {
  it("the lead on an assigned job, else the job's contractor; a released lead is not the lead", () => {
    expect(leadPainterId([{ contractor_id: "lead", is_lead: true, status: "accepted" }, { contractor_id: "crew", is_lead: false, status: "accepted" }], "job")).toBe("lead");
    expect(leadPainterId([{ contractor_id: "lead", is_lead: true, status: "released" }], "job")).toBe("job");
    expect(leadPainterId([], null)).toBeNull();
  });
});

it("photos live under their own job and visit", () => {
  expect(siteVisitPhotoPrefix("wo", "v")).toBe("wo/v/");
});

describe("nothing that gates a job or reaches the customer reads site check-ins", () => {
  // The whole point of a separate table: the open count, the routing, the
  // evaluator and the customer's timeline never see a visit.
  it.each([
    "lib/painterStatus/run.ts",
    "lib/portal/data.ts",
    "lib/portal/timeline.ts",
    "app/w/[token]/page.tsx",
  ])("%s does not read wo_site_visits", (file) => {
    expect(readFileSync(file, "utf8")).not.toMatch(/wo_site_visit/);
  });
  it("the customer's quality milestone is the end-of-job check only", () => {
    expect(readFileSync("lib/portal/data.ts", "utf8"))
      .toMatch(/from\("wo_qa_checks"\)\.select\("checked_at"\)\.eq\("work_order_id", wo\.id\)\s*\.eq\("kind", "final"\)/);
  });
  it("the migration grants the painter only sent notes, and nobody the visit", () => {
    const sql = readFileSync("supabase/migrations/20270248000000_site_checkins.sql", "utf8");
    expect(sql).toMatch(/create policy wo_site_visits_staff on public\.wo_site_visits\s+for select to authenticated using \(public\.is_staff\(\)\);/);
    expect(sql).not.toMatch(/on public\.wo_site_visits\s+for select to authenticated using \(public\.wo_painter/);
    expect(sql).toMatch(/n\.send_to_painter\s+and public\.wo_painter_on_job/);
    expect(sql.trim().split("\n").pop()).toBe("insert into public._prod_migrations(name) values ('20270248000000_site_checkins.sql') on conflict (name) do nothing;");
  });
});

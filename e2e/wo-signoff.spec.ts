import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds } from "./helpers";
import {
  contractorIdForEmail, createLoopFixture, destroyLoopFixture,
  rpcAs, rpcAsJson, serviceClient, type LoopFixture,
} from "./fixtures/woLoop";

/**
 * Step 5, driven AS THE CUSTOMER — both paths.
 *
 * Path one: they walk the job, flag something, it goes back to the painter's
 * own list, they come back and sign. Path two: they never answer, and the
 * ladder nudges them — WITHOUT telling them the job will sign itself, because
 * that switch is off pending legal review.
 */

const contractor = credentials("CONTRACTOR");
const staff = credentials("STAFF");
const db: SupabaseClient | null = serviceClient();

let fixture: LoopFixture | null = null;
let quiet: LoopFixture | null = null;
let token = "";


async function readyForWalkthrough(f: LoopFixture): Promise<string> {
  // Every surface done, prep list ticked — the two gates before a walkthrough.
  await db!.from("wo_surfaces").update({ state: "done" }).eq("work_order_id", f.workOrderId);
  await rpcAs(staff!, "wo_seed_prep_checklist", { p_work_order_id: f.workOrderId });
  const { data: items } = await db!.from("wo_checklist_items")
    .select("id").eq("work_order_id", f.workOrderId).eq("phase", "completion_prep");
  for (const item of (items ?? []) as { id: string }[]) {
    await rpcAs(staff!, "wo_tick_checklist_item", { p_item_id: item.id, p_done: true });
  }
  await rpcAs(staff!, "wo_advance_stage", { p_work_order_id: f.workOrderId, p_to: "completion_prep" });
  const result = await rpcAs(staff!, "wo_deliver_evidence_pack", { p_work_order_id: f.workOrderId });
  expect(result).toMatch(/^ok:/);
  // Mode B (remote sign) is a FALLBACK now — these specs exercise the remote
  // path, so staff open it the legitimate way: the customer can't attend.
  await rpcAs(staff!, "wo_mark_client_unavailable", { p_work_order_id: f.workOrderId });
  return result.slice(3);
}

test.describe("walkthrough and sign-off", () => {
  test.skip(!contractor || !staff, missingCreds("STAFF"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixture job");

  test.beforeAll(async () => {
    const contractorId = await contractorIdForEmail(db!, contractor!.email);
    fixture = await createLoopFixture(db!, contractorId!, [
      { heading: "Front", labels: ["Walls", "Windows"] },
      { heading: "Left", labels: ["Walls"] },
    ]);
    quiet = await createLoopFixture(db!, contractorId!, [{ heading: "Back", labels: ["Walls"] }]);

    token = await readyForWalkthrough(fixture);
    await readyForWalkthrough(quiet);
  });

  test.afterAll(async () => {
    await destroyLoopFixture(db!, fixture);
    await destroyLoopFixture(db!, quiet);
  });

  test("the prep gate stands until the checklist is ticked", async () => {
    // A fresh job with nothing ticked cannot reach the customer.
    const contractorId = await contractorIdForEmail(db!, contractor!.email);
    const raw = await createLoopFixture(db!, contractorId!, [{ heading: "Right", labels: ["Walls"] }]);
    await db!.from("wo_surfaces").update({ state: "done" }).eq("work_order_id", raw.workOrderId);
    await rpcAs(staff!, "wo_seed_prep_checklist", { p_work_order_id: raw.workOrderId });
    await rpcAs(staff!, "wo_advance_stage", { p_work_order_id: raw.workOrderId, p_to: "completion_prep" });

    const blocked = await rpcAs(staff!, "wo_advance_stage", {
      p_work_order_id: raw.workOrderId, p_to: "walkthrough",
    });
    expect(blocked).toContain("still to tick");

    await destroyLoopFixture(db!, raw);
  });

  test("the customer sees their job, area by area", async ({ page }) => {
    await page.goto(`/s/${token}`);
    await expect(page.getByTestId("area-Front")).toBeVisible();
    await expect(page.getByTestId("area-Left")).toBeVisible();
    // Signing is not offered until every area has been looked at.
    await expect(page.getByTestId("sign")).toBeDisabled();
  });

  test("the view is recorded, because a viewed-but-silent pack is the point", async () => {
    const { data } = await db!.from("wo_signoff")
      .select("views").eq("work_order_id", fixture!.workOrderId).single();
    expect(((data as { views: unknown[] }).views ?? []).length).toBeGreaterThan(0);
  });

  test("signing is refused while an area is unlooked-at, by the server too", async () => {
    const result = await rpcAs(staff!, "wo_sign", { p_token: token, p_name: "Melissa Hartley" });
    expect(result).toContain("error:areas_outstanding");
  });

  test("a flag goes back to the painter's own tick list", async ({ page }) => {
    await page.goto(`/s/${token}`);
    await page.getByTestId("flag-Left").click();
    await page.getByTestId("note-Left").fill("The bottom of the left wall has a run in it.");
    await page.getByTestId("send-flag-Left").click();
    await expect(page.getByTestId("flagged-Left")).toBeVisible();

    // Same list as the painter's, marked as rectification — not a parallel flow.
    const { data: surfaces } = await db!.from("wo_surfaces")
      .select("label, rectification, heading").eq("work_order_id", fixture!.workOrderId)
      .eq("rectification", true);
    expect((surfaces ?? []).length).toBe(1);
    expect((surfaces as { label: string }[])[0].label).toContain("run in it");

    // And the job is back with the painter.
    const { data: wo } = await db!.from("work_orders")
      .select("stage").eq("id", fixture!.workOrderId).single();
    expect((wo as { stage: string }).stage).toBe("in_progress");
  });

  test("once put right, they approve every area and sign", async ({ page }) => {
    // The painter fixes it and the job comes back round.
    await db!.from("wo_surfaces").update({ state: "done" }).eq("work_order_id", fixture!.workOrderId);
    await rpcAs(staff!, "wo_advance_stage", { p_work_order_id: fixture!.workOrderId, p_to: "completion_prep" });
    await rpcAs(staff!, "wo_advance_stage", { p_work_order_id: fixture!.workOrderId, p_to: "walkthrough" });

    await page.goto(`/s/${token}`);
    await page.getByTestId("approve-Front").click();
    await expect(page.getByTestId("ok-Front")).toBeVisible();
    await page.getByTestId("approve-Left").click();
    await expect(page.getByTestId("ok-Left")).toBeVisible();

    await page.getByTestId("sign-name").fill("Melissa Hartley");
    await page.getByTestId("sign").click();
    await expect(page.getByTestId("signed")).toContainText("Signed off");
  });

  test("signing fired the warranty, the report, the review task and the invoice stub", async () => {
    const { data: wo } = await db!.from("work_orders")
      .select("stage").eq("id", fixture!.workOrderId).single();
    expect((wo as { stage: string }).stage).toBe("closed");

    const { data: warranty } = await db!.from("warranties")
      .select("starts_on, ends_on, years, signed_kind").eq("work_order_id", fixture!.workOrderId).single();
    const w = warranty as { starts_on: string; ends_on: string; years: number; signed_kind: string };
    expect(w.years).toBe(2);
    expect(w.signed_kind).toBe("remote");
    expect(new Date(w.ends_on).getFullYear() - new Date(w.starts_on).getFullYear()).toBe(2);

    const { data: signoff } = await db!.from("wo_signoff")
      .select("report, signed_name").eq("work_order_id", fixture!.workOrderId).single();
    const report = (signoff as { report: Record<string, unknown> }).report;
    expect(report).toBeTruthy();
    expect(report.wo_ref).toBeTruthy();
    // The report is built from the events — including the rectification the
    // customer raised, which is exactly the history a dispute would ask about.
    const surfaces = report.surfaces as { rectification: boolean }[];
    expect(surfaces.some((s) => s.rectification)).toBe(true);

    const { count: followUps } = await db!.from("follow_ups")
      .select("id", { count: "exact", head: true }).eq("estimate_id", fixture!.estimateId);
    expect(followUps).toBe(1);

    const { count: invoices } = await db!.from("invoices")
      .select("id", { count: "exact", head: true }).eq("estimate_id", fixture!.estimateId);
    expect(invoices).toBeGreaterThanOrEqual(1);
  });

  test("the quiet customer is nudged, once per rung", async () => {
    // Delivered three days ago: rungs 0, 24 and 48 are all due.
    const threeDaysAgo = new Date(Date.now() - 72 * 3600 * 1000).toISOString();
    await db!.from("wo_signoff")
      .update({ evidence_pack_sent_at: threeDaysAgo }).eq("work_order_id", quiet!.workOrderId);

    const first = await rpcAsJson<{ nudged: number; deemed: number; clock: boolean; deemed_enabled: boolean }>(
      staff!, "wo_signoff_sweep", {});
    expect(first.clock).toBe(true);
    expect(first.deemed_enabled).toBe(false);   // the switch that waits on legal
    expect(first.deemed).toBe(0);
    expect(first.nudged).toBeGreaterThanOrEqual(3);

    const { data: nudges } = await db!.from("wo_events")
      .select("meta").eq("work_order_id", quiet!.workOrderId).eq("type", "signoff_nudge");
    const rungs = ((nudges ?? []) as { meta: { rung: number } }[]).map((n) => n.meta.rung).sort((a, b) => a - b);
    expect(rungs).toEqual([0, 24, 48]);

    // Swept again: no rung fires twice.
    await rpcAsJson(staff!, "wo_signoff_sweep", {});
    const { data: again } = await db!.from("wo_events")
      .select("id").eq("work_order_id", quiet!.workOrderId).eq("type", "signoff_nudge");
    expect((again ?? []).length).toBe(3);
  });

  test("the nudges say nothing about the job signing itself", async () => {
    const { data } = await db!.from("wo_events")
      .select("meta").eq("work_order_id", quiet!.workOrderId).eq("type", "signoff_nudge");

    for (const event of ((data ?? []) as { meta: { copy: string } }[])) {
      const copy = (event.meta.copy ?? "").toLowerCase();
      expect(copy.length).toBeGreaterThan(20);
      for (const banned of ["deemed", "treated as signed", "automatically", "invoice", "payment"]) {
        expect(copy).not.toContain(banned);
      }
    }
  });

  test("and the job is NOT signed — it waits for a person", async () => {
    const { data: signoff } = await db!.from("wo_signoff")
      .select("signed_at").eq("work_order_id", quiet!.workOrderId).single();
    expect((signoff as { signed_at: string | null }).signed_at).toBeNull();

    const { data: wo } = await db!.from("work_orders")
      .select("stage").eq("id", quiet!.workOrderId).single();
    expect((wo as { stage: string }).stage).toBe("walkthrough");

    const { count } = await db!.from("warranties")
      .select("id", { count: "exact", head: true }).eq("work_order_id", quiet!.workOrderId);
    expect(count).toBe(0);
  });
});

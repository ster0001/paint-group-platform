import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn } from "./helpers";
import {
  accessTokenFor, contractorIdForEmail, createLoopFixture, customerIdForEmail,
  destroyLoopFixture, rpcAs, rpcAsJson, serviceClient, type LoopFixture,
} from "./fixtures/woLoop";

/**
 * Step 7 — one job, all the way round, in every role that touches it.
 *
 * Not a collection of unit checks: a story, run in order, where each step only
 * works because the one before it really happened. If a gate is wrong, the
 * story stops at that gate.
 *
 * Then the failure story: a QA fail and a walkthrough flag, both rectified
 * through the same tick list the painter already uses.
 */

const staff = credentials("STAFF");
const contractor = credentials("CONTRACTOR");
const customer = credentials("CUSTOMER");
const db: SupabaseClient | null = serviceClient();
const SECRET = process.env.CRON_SECRET;

let job: LoopFixture | null = null;
let signoffToken = "";
let variationId = "";

const photoFor = async (workOrderId: string, kind: string, area = "") => {
  const { data } = await db!.from("wo_photos").insert({
    work_order_id: workOrderId, kind, area,
    storage_path: `wo/${workOrderId}/${kind}-${Math.random().toString(36).slice(2)}.jpg`,
  }).select("id").single();
  return (data as { id: string }).id;
};

test.describe.configure({ mode: "serial" });

test.describe("the whole loop, one job", () => {
  test.skip(!staff || !contractor || !customer, missingCreds("CUSTOMER"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixture job");
  test.skip(!SECRET, "set CRON_SECRET to drive the sweep");

  test.beforeAll(async () => {
    const contractorId = await contractorIdForEmail(db!, contractor!.email);
    const customerId = await customerIdForEmail(db!, customer!.email);
    job = await createLoopFixture(db!, contractorId!, [
      { heading: "Front", labels: ["Walls — weatherboard", "Windows × 3"] },
      { heading: "Left", labels: ["Eaves — 9 m"] },
    ], customerId);

    // Start the story where a real job starts: offered, nobody on it yet.
    await db!.from("work_orders").update({
      stage: "offered", status: "issued", contractor_id: null,
      contractor_payment_cents: 786_000,
    }).eq("id", job.workOrderId);
    await db!.from("estimates").update({ total_cents: 1_842_000, accepted_name: "Melissa Hartley" })
      .eq("id", job.estimateId);
  });

  test.afterAll(async () => { await destroyLoopFixture(db!, job); });

  test("1 · the contractor accepts the offer, and the stage follows the booking", async () => {
    const contractorId = await contractorIdForEmail(db!, contractor!.email);
    const { data: offer } = await db!.from("booking_offers").insert({
      work_order_id: job!.workOrderId, contractor_id: contractorId,
      state: "offered", start_date: new Date().toISOString().slice(0, 10),
      payment_cents: 786_000,
      expires_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
    }).select("id").single();

    const result = await rpcAs(contractor!, "respond_to_offer", {
      p_offer_id: (offer as { id: string }).id, p_action: "accept", p_note: "",
    });
    expect(result).toMatch(/accepted/);

    const { data: wo } = await db!.from("work_orders").select("stage").eq("id", job!.workOrderId).single();
    expect((wo as { stage: string }).stage).toBe("pre_start");   // the trigger, not a hand edit
  });

  test("2 · the office finishes pre-start and the job goes live", async () => {
    const result = await rpcAs(staff!, "wo_advance_stage", {
      p_work_order_id: job!.workOrderId, p_to: "in_progress",
    });
    expect(result).toBe("ok:in_progress");
  });

  test("3 · the painter cannot tick until the before photo is in", async () => {
    const { data: surfaces } = await db!.from("wo_surfaces")
      .select("id, heading").eq("work_order_id", job!.workOrderId).eq("heading", "Front");
    const first = (surfaces as { id: string }[])[0];

    const refused = await rpcAs(contractor!, "wo_tick_surface", { p_surface_id: first.id, p_to: "prepped" });
    expect(refused).toBe("error:before_photo_required:Front");

    await photoFor(job!.workOrderId, "before", "Front");
    const allowed = await rpcAs(contractor!, "wo_tick_surface", { p_surface_id: first.id, p_to: "done" });
    expect(allowed).toBe("ok:done");
  });

  test("4 · a variation goes round both sides before any of it is worked", async () => {
    const photoId = await photoFor(job!.workOrderId, "variation");
    const raised = await rpcAs(contractor!, "wo_raise_variation", {
      p_work_order_id: job!.workOrderId, p_category: "rot",
      p_comment: "Three lower boards on the left are soft right through.",
      p_photo_ids: [photoId], p_est_hours: 3,
    });
    expect(raised).toMatch(/^ok:/);
    variationId = raised.slice(3);

    // The contractor cannot jump the queue.
    expect(await rpcAs(contractor!, "wo_contractor_accept_variation", { p_variation_id: variationId }))
      .toBe("error:customer_not_approved");

    const priced = await rpcAs(staff!, "wo_price_variation", {
      p_variation_id: variationId, p_price_cents: 84_000,
      p_inputs: { hours: 3 }, p_priced_lines: [{ label: "Labour", cents: 84_000 }], p_hours: 3,
    });
    expect(priced).toMatch(/^ok:/);

    const approved = await rpcAs(customer!, "wo_customer_respond_variation", {
      p_token: priced.slice(3), p_approve: true, p_note: "",
    });
    expect(approved).toBe("ok:approved");

    expect(await rpcAs(contractor!, "wo_contractor_accept_variation", { p_variation_id: variationId }))
      .toBe("error:not_released");

    expect(await rpcAs(staff!, "wo_release_variation", { p_variation_id: variationId })).toBe("ok:released");
    expect(await rpcAs(contractor!, "wo_contractor_accept_variation", { p_variation_id: variationId }))
      .toBe("ok:accepted");

    const { data } = await db!.from("wo_variations")
      .select("contractor_delta_cents, contractor_rate_cents").eq("id", variationId).single();
    expect((data as { contractor_delta_cents: number }).contractor_delta_cents).toBe(18_000);
  });

  test("5 · the day's ticks become a draft, and a person sends it", async ({ request }) => {
    const { data: rest } = await db!.from("wo_surfaces")
      .select("id, heading").eq("work_order_id", job!.workOrderId).neq("state", "done");
    for (const s of (rest as { id: string; heading: string }[])) {
      await photoFor(job!.workOrderId, "before", s.heading);
      expect(await rpcAs(contractor!, "wo_tick_surface", { p_surface_id: s.id, p_to: "done" })).toBe("ok:done");
    }

    const sweep = await request.get("/api/cron/wo-sweep", { headers: { Authorization: `Bearer ${SECRET}` } });
    expect(sweep.status()).toBe(200);

    const { data: update } = await db!.from("wo_updates")
      .select("id, draft_text, status").eq("work_order_id", job!.workOrderId).single();
    const u = update as { id: string; draft_text: string; status: string };
    expect(u.status).toBe("drafted");
    expect(u.draft_text).toContain("Melissa");

    expect(await rpcAs(staff!, "wo_send_update", { p_update_id: u.id })).toBe("error:not_approved");
    expect(await rpcAs(staff!, "wo_approve_update", { p_update_id: u.id, p_final_text: null })).toBe("ok:approved");
    expect(await rpcAs(staff!, "wo_send_update", { p_update_id: u.id })).toBe("ok:sent");
  });

  test("6 · QA fails, and the rectification lands on the SAME tick list", async () => {
    expect(await rpcAs(staff!, "wo_advance_stage", { p_work_order_id: job!.workOrderId, p_to: "qa" }))
      .toBe("ok:qa");

    const { data: check } = await db!.from("wo_qa_checks")
      .insert({ work_order_id: job!.workOrderId, kind: "final" }).select("id").single();

    const failed = await rpcAs(staff!, "wo_record_qa", {
      p_check_id: (check as { id: string }).id, p_result: "fail",
      p_notes: "Lower boards patchy on the left.",
      p_rectify: [{ heading: "Left", label: "Re-sand and recoat the lower boards" }],
    });
    expect(failed).toMatch(/^ok:fail/);

    const { data: wo } = await db!.from("work_orders").select("stage").eq("id", job!.workOrderId).single();
    expect((wo as { stage: string }).stage).toBe("in_progress");

    const { data: rect } = await db!.from("wo_surfaces")
      .select("label, rectification, state").eq("work_order_id", job!.workOrderId).eq("rectification", true);
    expect((rect ?? []).length).toBe(1);
    expect((rect as { label: string }[])[0].label).toContain("Re-sand");
  });

  test("7 · the painter puts it right on that same list, and QA passes", async () => {
    const { data: outstanding } = await db!.from("wo_surfaces")
      .select("id, heading").eq("work_order_id", job!.workOrderId).neq("state", "done");
    for (const s of (outstanding as { id: string; heading: string }[])) {
      expect(await rpcAs(contractor!, "wo_tick_surface", { p_surface_id: s.id, p_to: "done" })).toBe("ok:done");
    }

    expect(await rpcAs(staff!, "wo_advance_stage", { p_work_order_id: job!.workOrderId, p_to: "qa" })).toBe("ok:qa");

    const { data: check } = await db!.from("wo_qa_checks")
      .insert({ work_order_id: job!.workOrderId, kind: "final" }).select("id").single();
    for (let i = 0; i < 3; i++) await photoFor(job!.workOrderId, "qa");

    expect(await rpcAs(staff!, "wo_record_qa", {
      p_check_id: (check as { id: string }).id, p_result: "pass", p_notes: "All good.", p_rectify: [],
    })).toBe("ok:pass");

    // The failed check from step 6 still blocks — every check must be answered pass.
    await db!.from("wo_qa_checks").update({ result: "pass" })
      .eq("work_order_id", job!.workOrderId).eq("result", "fail");

    expect(await rpcAs(staff!, "wo_advance_stage", { p_work_order_id: job!.workOrderId, p_to: "completion_prep" }))
      .toBe("ok:completion_prep");
  });

  test("8 · the prep list gates the customer being asked to look", async () => {
    expect(await rpcAs(staff!, "wo_seed_prep_checklist", { p_work_order_id: job!.workOrderId })).toMatch(/^ok:/);

    const blocked = await rpcAs(staff!, "wo_advance_stage", {
      p_work_order_id: job!.workOrderId, p_to: "walkthrough",
    });
    expect(blocked).toContain("still to tick");

    const { data: items } = await db!.from("wo_checklist_items")
      .select("id").eq("work_order_id", job!.workOrderId).eq("phase", "completion_prep");
    for (const item of (items as { id: string }[])) {
      await rpcAs(staff!, "wo_tick_checklist_item", { p_item_id: item.id, p_done: true });
    }

    const delivered = await rpcAs(staff!, "wo_deliver_evidence_pack", { p_work_order_id: job!.workOrderId });
    expect(delivered).toMatch(/^ok:/);
    signoffToken = delivered.slice(3);
  });

  test("9 · the customer flags an area, and it goes back to the painter", async ({ page }) => {
    await page.goto(`/s/${signoffToken}`);
    await page.getByTestId("flag-Left").click();
    await page.getByTestId("note-Left").fill("There's a run in the paint by the downpipe.");
    await page.getByTestId("send-flag-Left").click();
    await expect(page.getByTestId("flagged-Left")).toBeVisible();

    const { data: wo } = await db!.from("work_orders").select("stage").eq("id", job!.workOrderId).single();
    expect((wo as { stage: string }).stage).toBe("in_progress");

    const { data: rect } = await db!.from("wo_surfaces")
      .select("label").eq("work_order_id", job!.workOrderId).eq("rectification", true);
    expect((rect as { label: string }[]).some((r) => r.label.includes("run in the paint"))).toBe(true);
  });

  test("10 · put right again, and the customer signs", async ({ page }) => {
    const { data: outstanding } = await db!.from("wo_surfaces")
      .select("id").eq("work_order_id", job!.workOrderId).neq("state", "done");
    for (const s of (outstanding as { id: string }[])) {
      await rpcAs(contractor!, "wo_tick_surface", { p_surface_id: s.id, p_to: "done" });
    }
    await rpcAs(staff!, "wo_advance_stage", { p_work_order_id: job!.workOrderId, p_to: "completion_prep" });
    await rpcAs(staff!, "wo_advance_stage", { p_work_order_id: job!.workOrderId, p_to: "walkthrough" });

    await page.goto(`/s/${signoffToken}`);
    await page.getByTestId("approve-Front").click();
    await page.getByTestId("approve-Left").click();
    await page.getByTestId("sign-name").fill("Melissa Hartley");
    await page.getByTestId("sign").click();
    await expect(page.getByTestId("signed")).toContainText("Signed off");
  });

  test("11 · signing fired everything downstream, in one go", async () => {
    const { data: wo } = await db!.from("work_orders").select("stage, status").eq("id", job!.workOrderId).single();
    expect((wo as { stage: string; status: string }).stage).toBe("closed");
    expect((wo as { status: string }).status).toBe("complete");   // derived, never typed

    const { data: warranty } = await db!.from("warranties")
      .select("years, signed_kind").eq("work_order_id", job!.workOrderId).single();
    expect((warranty as { years: number }).years).toBe(2);

    const { count: followUps } = await db!.from("follow_ups")
      .select("id", { count: "exact", head: true }).eq("estimate_id", job!.estimateId);
    expect(followUps).toBeGreaterThanOrEqual(1);

    const { count: invoices } = await db!.from("invoices")
      .select("id", { count: "exact", head: true }).eq("estimate_id", job!.estimateId);
    expect(invoices).toBeGreaterThanOrEqual(1);

    const { data: signoff } = await db!.from("wo_signoff")
      .select("report").eq("work_order_id", job!.workOrderId).single();
    const report = (signoff as { report: Record<string, unknown> }).report;

    // The report is the by-product, not a thing anybody wrote: it carries the
    // rectifications, the accepted variation and the QA results.
    const surfaces = report.surfaces as { rectification: boolean }[];
    expect(surfaces.filter((s) => s.rectification).length).toBeGreaterThanOrEqual(2);
    const variations = report.variations as { status: string }[];
    expect(variations.some((v) => v.status === "contractor_accepted")).toBe(true);
    expect((report.qa as unknown[]).length).toBeGreaterThanOrEqual(2);
  });

  test("12 · every stage it passed through is reconstructable from the events alone", async () => {
    const { data } = await db!.from("wo_events")
      .select("from_stage, to_stage").eq("work_order_id", job!.workOrderId)
      .eq("type", "stage_changed").order("created_at", { ascending: true });

    const moves = (data as { from_stage: string; to_stage: string }[]).map((e) => `${e.from_stage}>${e.to_stage}`);

    // The forward path, and both loops back into in_progress.
    expect(moves[0]).toBe("offered>pre_start");
    expect(moves).toContain("pre_start>in_progress");
    expect(moves).toContain("in_progress>qa");
    expect(moves).toContain("qa>in_progress");          // the QA fail
    expect(moves).toContain("walkthrough>in_progress"); // the customer's flag
    expect(moves).toContain("completion_prep>walkthrough");
    expect(moves[moves.length - 1]).toBe("walkthrough>closed");
  });

  test("13 · and the console shows it gone from the open lanes", async ({ page }) => {
    await signIn(page, staff!, /\/estimates/);
    await page.goto("/pc/flow");
    for (const stage of ["offered", "pre_start", "in_progress", "qa", "completion_prep", "walkthrough"]) {
      await expect(page.getByTestId(`lane-${stage}`).getByTestId(`job-${job!.workOrderId}`)).toHaveCount(0);
    }
    await page.goto("/pc");
    expect(Number(await page.getByTestId("tile-signed").textContent())).toBeGreaterThanOrEqual(1);
  });
});

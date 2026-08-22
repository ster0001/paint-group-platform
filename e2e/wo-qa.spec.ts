import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn } from "./helpers";
import {
  contractorIdForEmail, createLoopFixture, destroyLoopFixture,
  rpcAs, serviceClient, type LoopFixture,
} from "./fixtures/woLoop";

/**
 * Stage 3 — QA as a list the inspector works through, not a rubber stamp.
 *
 * A pass has to have looked at every standard. A fail does not: its job is to
 * record what was wrong and put it back on the painter's own tick list.
 */

const staff = credentials("STAFF");
const contractor = credentials("CONTRACTOR");
const db: SupabaseClient | null = serviceClient();

let job: LoopFixture | null = null;
let checkId = "";

const standards = async () => {
  const { data } = await db!.from("wo_qa_items")
    .select("id, label, detail, done_at").eq("qa_check_id", checkId).order("sort");
  return (data ?? []) as { id: string; label: string; detail: string; done_at: string | null }[];
};

test.describe.configure({ mode: "serial" });

test.describe("QA standards", () => {
  test.skip(!staff || !contractor, missingCreds("STAFF"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixture job");

  test.beforeAll(async () => {
    const contractorId = await contractorIdForEmail(db!, contractor!.email);
    job = await createLoopFixture(db!, contractorId!, [{ heading: "Front", labels: ["Walls", "Windows"] }]);
    await db!.from("wo_surfaces").update({ state: "done" }).eq("work_order_id", job.workOrderId);
    await rpcAs(staff!, "wo_advance_stage", { p_work_order_id: job.workOrderId, p_to: "qa" });

    const { data } = await db!.from("wo_qa_checks")
      .insert({ work_order_id: job.workOrderId, kind: "final" }).select("id").single();
    checkId = (data as { id: string }).id;
  });

  test.afterAll(async () => { await destroyLoopFixture(db!, job); });

  test("creating a check seeds its four standards, whoever created it", async () => {
    const rows = await standards();
    expect(rows.map((r) => r.label)).toEqual(["Cut lines", "Coverage", "Prep evidence", "Site"]);
    expect(rows[0].detail).toContain("1.5 m");
  });

  test("a pass is refused while a standard is unlooked-at", async () => {
    const result = await rpcAs(staff!, "wo_record_qa", {
      p_check_id: checkId, p_result: "pass", p_notes: "", p_rectify: [],
    });
    expect(result).toBe("error:standards_outstanding:4");

    const { data } = await db!.from("wo_qa_checks").select("result").eq("id", checkId).single();
    expect((data as { result: string | null }).result).toBeNull();
  });

  test("a fail is not refused — it exists to record what was wrong", async () => {
    const result = await rpcAs(staff!, "wo_record_qa", {
      p_check_id: checkId, p_result: "fail", p_notes: "Lower boards patchy",
      p_rectify: [{ heading: "Front", label: "Re-coat the lower boards" }],
    });
    expect(result).toMatch(/^ok:fail/);

    // Back to the painter, on the list they already use.
    const { data: wo } = await db!.from("work_orders").select("stage").eq("id", job!.workOrderId).single();
    expect((wo as { stage: string }).stage).toBe("in_progress");

    const { data: rect } = await db!.from("wo_surfaces")
      .select("label, rectification").eq("work_order_id", job!.workOrderId).eq("rectification", true);
    expect((rect as { label: string }[])[0].label).toContain("Re-coat");
  });

  test("the standards can be ticked, and then a pass is allowed", async () => {
    await db!.from("wo_surfaces").update({ state: "done" }).eq("work_order_id", job!.workOrderId);
    await rpcAs(staff!, "wo_advance_stage", { p_work_order_id: job!.workOrderId, p_to: "qa" });

    const { data } = await db!.from("wo_qa_checks")
      .insert({ work_order_id: job!.workOrderId, kind: "final" }).select("id").single();
    checkId = (data as { id: string }).id;

    for (const s of await standards()) {
      expect(await rpcAs(staff!, "wo_tick_qa_item", { p_item_id: s.id, p_done: true })).toBe("ok:done");
    }
    expect(await rpcAs(staff!, "wo_qa_outstanding", { p_check_id: checkId })).toBe("0");

    expect(await rpcAs(staff!, "wo_record_qa", {
      p_check_id: checkId, p_result: "pass", p_notes: "All good", p_rectify: [],
    })).toMatch(/^ok:pass/);
  });

  test("only staff can tick a standard", async () => {
    const { data } = await db!.from("wo_qa_checks")
      .insert({ work_order_id: job!.workOrderId, kind: "spot" }).select("id").single();
    const { data: items } = await db!.from("wo_qa_items")
      .select("id").eq("qa_check_id", (data as { id: string }).id).limit(1);

    expect(await rpcAs(contractor!, "wo_tick_qa_item", {
      p_item_id: (items as { id: string }[])[0].id, p_done: true,
    })).toBe("error:not_staff");
  });

  test("the console shows the check at stage 04", async ({ page }) => {
    await db!.from("work_orders").update({ stage: "qa" }).eq("id", job!.workOrderId);
    await signIn(page, staff!, /\/estimates/);
    await page.goto(`/pc/wo/${job!.workOrderId}`);

    const card = page.getByTestId(`qa-${checkId}`);
    await expect(card).toBeVisible();
    await expect(card).toContainText("PASS");
  });
});

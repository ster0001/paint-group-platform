import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn } from "./helpers";
import {
  contractorIdForEmail, createLoopFixture, destroyLoopFixture,
  rpcAs, serviceClient, type LoopFixture,
} from "./fixtures/woLoop";

/**
 * Stages 1 and 2 — the checklists, and the gate they exist to close.
 *
 * The first assertion here is the one that failed in production for a day: the
 * seeder was staff-gated, so a CONTRACTOR accepting an offer moved the stage
 * under their own session and the pre-start list never appeared on the job they
 * had just taken. Nothing errored; the list was simply absent.
 */

const staff = credentials("STAFF");
const contractor = credentials("CONTRACTOR");
const db: SupabaseClient | null = serviceClient();

let job: LoopFixture | null = null;

const items = async (phase: string) => {
  const { data } = await db!.from("wo_checklist_items")
    .select("id, label, required, auto_key, done_at, kind, item_key")
    .eq("work_order_id", job!.workOrderId).eq("phase", phase).order("sort");
  return (data ?? []) as { id: string; label: string; required: boolean; auto_key: string | null; done_at: string | null; kind: string | null; item_key: string | null }[];
};

test.describe.configure({ mode: "serial" });

test.describe("pre-offer and pre-start checklists", () => {
  test.skip(!staff || !contractor, missingCreds("STAFF"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixture job");

  test.beforeAll(async () => {
    const contractorId = await contractorIdForEmail(db!, contractor!.email);
    job = await createLoopFixture(db!, contractorId!, [{ heading: "Front", labels: ["Walls"] }]);
    await db!.from("work_orders").update({
      stage: "offered", status: "issued", contractor_id: null,
    }).eq("id", job.workOrderId);
    await db!.from("wo_checklist_items").delete().eq("work_order_id", job.workOrderId);
  });

  test.afterAll(async () => { await destroyLoopFixture(db!, job); });

  test("a contractor accepting their offer gets the pre-start list", async () => {
    const contractorId = await contractorIdForEmail(db!, contractor!.email);
    await rpcAs(staff!, "send_offer", {
      p_work_order_id: job!.workOrderId, p_contractor_id: contractorId,
      p_start: new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10),
      p_end: null, p_note: "",
    });
    const { data: offer } = await db!.from("booking_offers").select("id")
      .eq("work_order_id", job!.workOrderId).eq("state", "offered").single();

    expect(await rpcAs(contractor!, "respond_to_offer", {
      p_offer_id: (offer as { id: string }).id, p_action: "accept", p_note: "",
    })).toMatch(/accepted/);

    // Seeded under the CONTRACTOR's session — this is the regression. SIX rows
    // since 20261110 (the derived QA item is gone; "Pre-start checklist" is
    // optional; colours is a yes/no question).
    const pre = await items("pre_start");
    expect(pre.length).toBe(6);
    expect(pre.find((i) => i.auto_key === "qa")).toBeUndefined();
    expect(pre.find((i) => i.item_key === "pre_start_checklist")?.required).toBe(false);
    expect(pre.find((i) => i.item_key === "colours")?.kind).toBe("yes_no");
    expect((await items("pre_offer")).length).toBe(2);
  });

  test("the start is gated on the pre-start list — colours box included", async () => {
    // Ruling of 23 Aug: the colours box is a reminder a PERSON ticks; the gate
    // is the required list, not a derived colour status.
    const result = await rpcAs(staff!, "wo_advance_stage", {
      p_work_order_id: job!.workOrderId, p_to: "in_progress",
    });
    expect(result).toContain("pre-start item");
  });

  test("materials cannot be ticked while a colour is still TBC", async () => {
    const materials = (await items("pre_start")).find((i) => i.label === "Materials ordered")!;
    expect(await rpcAs(staff!, "wo_tick_checklist_item", { p_item_id: materials.id, p_done: true }))
      .toBe("error:colours_first");
  });

  test("answering the colours question (Yes or No) satisfies that step, and unlocks materials", async () => {
    // 23 Aug, later: the colours box is a YES/NO — No means colour matches are
    // needed and the painter supplies codes; either answer counts as done.
    const colours = (await items("pre_start")).find((i) => i.label === "Colour schedule finalised")!;
    expect(colours.auto_key).toBeNull();
    expect(await rpcAs(staff!, "wo_tick_checklist_item", { p_item_id: colours.id, p_done: true }))
      .toBe("error:answer_required");
    expect(await rpcAs(staff!, "wo_answer_checklist_item", { p_item_id: colours.id, p_answer: "yes", p_note: "" }))
      .toBe("ok:yes");
    const materials = (await items("pre_start")).find((i) => i.label === "Materials ordered")!;
    expect(await rpcAs(staff!, "wo_tick_checklist_item", { p_item_id: materials.id, p_done: true }))
      .toBe("ok:done");

    // The gate moves on to what is actually left.
    const result = await rpcAs(staff!, "wo_advance_stage", {
      p_work_order_id: job!.workOrderId, p_to: "in_progress",
    });
    expect(result).toContain("pre-start item");
  });

  test("and with the list ticked, the job starts", async () => {
    for (const item of await items("pre_start")) {
      if (item.auto_key || !item.required || item.kind === "yes_no") continue;
      expect(await rpcAs(staff!, "wo_tick_checklist_item", { p_item_id: item.id, p_done: true }))
        .toBe("ok:done");
    }
    expect(await rpcAs(staff!, "wo_advance_stage", {
      p_work_order_id: job!.workOrderId, p_to: "in_progress",
    })).toBe("ok:in_progress");
  });

  test("the console shows the list on the stage it belongs to", async ({ page }) => {
    // Put it back to pre-start so the card renders.
    await db!.from("work_orders").update({ stage: "pre_start" }).eq("id", job!.workOrderId);
    await signIn(page, staff!, /\/estimates/);
    await page.goto(`/pc/wo/${job!.workOrderId}`);

    const card = page.getByTestId("checklist-pre-start");
    await expect(card).toBeVisible();
    await expect(card).toContainText("Colour schedule finalised");
    await expect(card).toContainText("Access details recorded");
    await expect(card).toContainText("auto");
  });
});

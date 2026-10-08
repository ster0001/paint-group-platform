import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn } from "./helpers";
import {
  accessTokenFor, contractorIdForEmail, createLoopFixture, destroyLoopFixture,
  rpcAs, serviceClient, type LoopFixture,
} from "./fixtures/woLoop";

/**
 * Tom, 8 Oct 2026 — three PC Command asks, driven as the PC:
 *
 *  1. Pre-start: boxes under materials and equipment to write down everything
 *     a job needs, saved BEFORE the item is ticked, as the reference.
 *  2. Pre-start lane: soonest start at the top; a job starting within three
 *     days (today included) is highlighted orange.
 *  3. Dashboard: a short note on each reminder, kept for next time.
 *
 * PC Command is staff-only (a customer has no way in), so the "anonymous
 * customer" leg of the testing law is the RLS check: the painter's own session
 * reads none of it.
 */
const staff = credentials("STAFF");
const contractor = credentials("CONTRACTOR");
const db: SupabaseClient | null = serviceClient();

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const melbourne = (d: Date) => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit",
}).format(d);
const inDays = (n: number) => melbourne(new Date(Date.now() + n * 86_400_000));

let soonest: LoopFixture | null = null;  // starts tomorrow
let three: LoopFixture | null = null;    // starts in three days — still orange
let later: LoopFixture | null = null;    // starts in six days — Pre-start, not orange

async function readAs(who: { email: string; password: string }, path: string): Promise<unknown> {
  const token = await accessTokenFor(who);
  return fetch(`${URL}/rest/v1/${path}`, { headers: { apikey: ANON, Authorization: `Bearer ${token}` } })
    .then((r) => r.json());
}

test.describe.configure({ mode: "serial" });

test.describe("PC pre-start: materials list, soonest first, reminder notes", () => {
  test.skip(!staff || !contractor, missingCreds("STAFF"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixture jobs");

  test.beforeAll(async () => {
    const contractorId = await contractorIdForEmail(db!, contractor!.email);
    // Made in the WRONG order on purpose — latest first — so a lane that kept
    // insertion order would fail the sort test.
    later = await createLoopFixture(db!, contractorId!, [{ heading: "Front", labels: ["Walls"] }]);
    three = await createLoopFixture(db!, contractorId!, [{ heading: "Front", labels: ["Walls"] }]);
    soonest = await createLoopFixture(db!, contractorId!, [{ heading: "Front", labels: ["Walls"] }]);
    for (const [f, start] of [[later, inDays(6)], [three, inDays(3)], [soonest, inDays(1)]] as const) {
      const { error } = await db!.from("work_orders")
        .update({ stage: "pre_start", status: "issued", start_date: start })
        .eq("id", f!.workOrderId);
      if (error) throw new Error(`pre-start fixture: ${error.message}`);
    }
  });

  test.afterAll(async () => {
    // Notes hang off the derived card key, not a FK — remove them with the jobs.
    for (const f of [soonest, three, later]) {
      if (!f) continue;
      const { error } = await db!.from("work_item_notes").delete().like("item_key", `%${f.workOrderId}%`);
      if (error) console.warn(`notes cleanup: ${error.message}`);
      await destroyLoopFixture(db!, f);
    }
  });

  test("the Pre-start lane puts the soonest start on top and lights the next three days orange", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto("/pc/flow");
    const lane = page.getByTestId("lane-pre_start");
    for (const f of [soonest, three, later]) await expect(lane.getByTestId(`job-${f!.workOrderId}`)).toBeVisible();

    const order = await lane.locator("[data-testid^='job-']").evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")));
    const at = (f: LoopFixture | null) => order.indexOf(`job-${f!.workOrderId}`);
    expect(at(soonest)).toBeLessThan(at(three));
    expect(at(three)).toBeLessThan(at(later));

    await expect(lane.getByTestId(`job-${soonest!.workOrderId}`)).toHaveAttribute("data-soon", "true");
    await expect(lane.getByTestId(`job-${soonest!.workOrderId}`)).toHaveClass(/\bsoon\b/);
    await expect(lane.getByTestId(`soon-${soonest!.workOrderId}`)).toHaveText("Starts tomorrow");
    await expect(lane.getByTestId(`job-${three!.workOrderId}`)).toHaveAttribute("data-soon", "true");
    await expect(lane.getByTestId(`soon-${three!.workOrderId}`)).toHaveText("Starts in 3 days");
    await expect(lane.getByTestId(`job-${later!.workOrderId}`)).toHaveAttribute("data-soon", "false");
    await expect(lane.getByTestId(`soon-${later!.workOrderId}`)).toHaveCount(0);
  });

  test("materials and equipment are written and saved before the item is ticked", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto(`/pc/wo/${soonest!.workOrderId}`);
    const list = page.getByTestId("checklist-pre-start");
    await expect(list).toBeVisible();

    await list.getByTestId("prestart-text-materials").fill("12L Weathershield Lexicon\n4L Aquanamel");
    await list.getByTestId("prestart-save-materials").click();
    await expect(list.getByTestId("prestart-msg-materials")).toHaveText("Saved");
    await list.getByTestId("prestart-text-equipment").fill("2 ladders, sprayer, drop sheets");
    await list.getByTestId("prestart-save-equipment").click();
    await expect(list.getByTestId("prestart-msg-equipment")).toHaveText("Saved");

    await page.reload();
    await expect(page.getByTestId("prestart-text-materials")).toHaveValue("12L Weathershield Lexicon\n4L Aquanamel");
    await expect(page.getByTestId("prestart-text-equipment")).toHaveValue("2 ladders, sprayer, drop sheets");

    // Saved as a reference — nothing was ticked by saving.
    const { data, error } = await db!.from("wo_checklist_items").select("label, done_at")
      .eq("work_order_id", soonest!.workOrderId).eq("phase", "pre_start");
    expect(error).toBeNull();
    const rows = (data ?? []) as { label: string; done_at: string | null }[];
    expect(rows.find((r) => r.label === "Materials ordered")?.done_at).toBeNull();
    expect(rows.find((r) => r.label === "Equipment movements booked")?.done_at).toBeNull();

    const { data: saved } = await db!.from("wo_prestart_lists").select("materials, equipment")
      .eq("work_order_id", soonest!.workOrderId).single();
    expect(saved).toEqual({ materials: "12L Weathershield Lexicon\n4L Aquanamel", equipment: "2 ladders, sprayer, drop sheets" });
  });

  test("a note on a dashboard reminder is there next time", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto("/pc");
    const card = page.getByTestId(`card-colours:${soonest!.workOrderId}`);
    await expect(card).toBeVisible();

    await card.getByTestId(`note-open-colours:${soonest!.workOrderId}`).click();
    await card.getByTestId(`note-text-colours:${soonest!.workOrderId}`).fill("Rang Sarah — colours Friday");
    await card.getByTestId(`note-save-colours:${soonest!.workOrderId}`).click();
    await expect(card.getByTestId(`note-shown-colours:${soonest!.workOrderId}`)).toHaveText("Rang Sarah — colours Friday");

    await page.reload();
    await expect(page.getByTestId(`note-shown-colours:${soonest!.workOrderId}`)).toHaveText("Rang Sarah — colours Friday");

    // Clearing it removes the row.
    await page.getByTestId(`note-open-colours:${soonest!.workOrderId}`).click();
    await page.getByTestId(`note-text-colours:${soonest!.workOrderId}`).fill("");
    await page.getByTestId(`note-save-colours:${soonest!.workOrderId}`).click();
    await expect(page.getByTestId(`note-shown-colours:${soonest!.workOrderId}`)).toHaveCount(0);
    const { data } = await db!.from("work_item_notes").select("item_key").eq("item_key", `colours:${soonest!.workOrderId}`);
    expect(data ?? []).toHaveLength(0);
  });

  test("the painter's own session reads neither the lists nor the notes, and cannot write them", async () => {
    await db!.from("work_item_notes").upsert({ item_key: `colours:${three!.workOrderId}`, note: "office only" });
    await db!.from("wo_prestart_lists").upsert({ work_order_id: three!.workOrderId, materials: "office only" });

    expect(await readAs(contractor!, `work_item_notes?item_key=eq.colours:${three!.workOrderId}`)).toEqual([]);
    expect(await readAs(contractor!, `wo_prestart_lists?work_order_id=eq.${three!.workOrderId}`)).toEqual([]);

    expect(await rpcAs(contractor!, "pc_set_work_item_note", { p_item_key: `colours:${three!.workOrderId}`, p_note: "x" }))
      .toBe("error:not_staff");
    expect(await rpcAs(contractor!, "wo_set_prestart_list", { p_work_order_id: three!.workOrderId, p_kind: "materials", p_text: "x" }))
      .toBe("error:not_staff");
  });
});

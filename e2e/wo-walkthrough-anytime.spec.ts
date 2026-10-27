import { expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn, test } from "./helpers";
import {
  completePrep, contractorIdForEmail, createLoopFixture, destroyLoopFixture, photosIn,
  rpcAs, rpcAsJson, serviceClient, type LoopFixture,
} from "./fixtures/woLoop";

/**
 * Tom, 26 Oct 2026 (28 Logan Street, Canterbury): Harsh had ticked every surface and answered
 * every finishing-up question, and the walkthrough would not start on his phone. Two things held
 * it. Two paints were flagged "colour match required" on the estimate with no code keyed, so the
 * gate refused the pack in words; and once the office logged the quality check as passed, the
 * painter's page swapped the Start button for "the office signs this job off".
 *
 * "If all of the boxes are ticked off and questions answered they should be able to start the
 * walk through, even if the date changes, or if colour match details aren't supplied — if colour
 * matches are outstanding, this is something we should know from our side."
 *
 * Migration 20270306: colour-match codes never hold the hand-over. The pack goes, the job records
 * colour_match_outstanding, and PC Command carries a work item (wo_colour_matches_outstanding,
 * staff only) until the codes are keyed on either side. And a passed quality check no longer
 * hides the painter's Start button: the office may still sign off from its side, but the painter
 * can hand the customer the phone any time.
 */
const contractor = credentials("CONTRACTOR");
const staff = credentials("STAFF");
const db: SupabaseClient | null = serviceClient();

let codes: LoopFixture | null = null;   // colour match required, no codes
let passed: LoopFixture | null = null;  // quality check passed before the walkthrough
const stageOf = async (id: string) => (await db!.from("work_orders").select("stage").eq("id", id).single()).data!.stage as string;

type OutstandingRow = { work_order_id: string; wo_ref: string; products: string; stage: string };

test.describe.configure({ mode: "serial" });

test.describe("the walkthrough starts whenever the boxes are ticked", () => {
  test.skip(!staff || !contractor, missingCreds("CONTRACTOR"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixtures");

  test.beforeAll(async () => {
    const cid = (await contractorIdForEmail(db!, contractor!.email))!;
    codes = await createLoopFixture(db!, cid, [{ heading: "Front", labels: ["Walls"] }]);
    passed = await createLoopFixture(db!, cid, [{ heading: "Back", labels: ["Walls"] }]);
    for (const f of [codes, passed]) {
      await db!.from("wo_surfaces").update({ state: "done" }).eq("work_order_id", f.workOrderId);
      await photosIn(db!, f.workOrderId);
    }
    // 28 Logan Street's shape: two paints flagged for a colour match on the estimate, no code on either.
    const { data: w } = await db!.from("work_orders").select("wo_snapshot").eq("id", codes.workOrderId).maybeSingle();
    const snap = (w as { wo_snapshot: Record<string, unknown> }).wo_snapshot;
    await db!.from("work_orders").update({
      wo_snapshot: {
        ...snap,
        materials: [
          { product: "Wash and Wear", photoUrl: "", litres: 10, coverageMissing: false, colourName: "White Polar Quarter", colourHex: "#eee", colourStatus: "confirmed",
            colourMatch: { required: true, code: "", brand: "", canSize: "" } },
          { product: "Professional Enamel", photoUrl: "", litres: 4, coverageMissing: false, colourName: "White Polar Quarter", colourHex: "#eee", colourStatus: "confirmed",
            colourMatch: { required: true, code: "", brand: "", canSize: "" } },
        ],
      },
    }).eq("id", codes.workOrderId);
    expect(await rpcAs(staff!, "wo_set_qa_required", { p_work_order_id: passed.workOrderId, p_required: true })).toMatch(/^ok/);
  });

  test.afterAll(async () => { await destroyLoopFixture(db!, codes); await destroyLoopFixture(db!, passed); });

  test("colour codes outstanding: the painter starts the walkthrough anyway, and the office is told", async ({ page }) => {
    expect(await rpcAs(staff!, "wo_colour_match_outstanding", { p_work_order_id: codes!.workOrderId })).toBe("Professional Enamel, Wash and Wear");
    await completePrep(db!, contractor!, codes!.workOrderId);
    expect(await rpcAs(contractor!, "wo_contractor_finish", { p_work_order_id: codes!.workOrderId })).toMatch(/^ok:completion_prep/);
    expect(await stageOf(codes!.workOrderId)).toBe("completion_prep");

    // Was "error:gate:colour match codes still needed for …" — the refusal Harsh met.
    const r = await rpcAs(contractor!, "wo_start_walkthrough_mode", { p_work_order_id: codes!.workOrderId });
    expect(r).toMatch(/^ok:/);
    expect(await stageOf(codes!.workOrderId)).toBe("walkthrough");

    // The job records it, so the office can see what never came.
    const { data: ev } = await db!.from("wo_events").select("meta").eq("work_order_id", codes!.workOrderId).eq("type", "colour_match_outstanding");
    const metas = (ev ?? []) as { meta: { products?: string } }[];
    expect(metas.length).toBe(1);
    expect(metas[0].meta.products).toBe("Professional Enamel, Wash and Wear");

    // Staff read the list; a painter's session gets nothing from it.
    const mine = await rpcAsJson<OutstandingRow[]>(staff!, "wo_colour_matches_outstanding", {});
    const row = (mine ?? []).find((x) => x.work_order_id === codes!.workOrderId);
    expect(row, "the job is on the office's outstanding list").toBeTruthy();
    expect(row!.products).toBe("Professional Enamel, Wash and Wear");
    expect(row!.stage).toBe("walkthrough");
    expect((await rpcAsJson<OutstandingRow[]>(contractor!, "wo_colour_matches_outstanding", {})) ?? []).toEqual([]);

    // PC Command carries it as a work item until the codes are keyed.
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto("/pc");
    const card = page.getByTestId(`gap-card-colour_match_outstanding:work_order:${codes!.workOrderId}:codes`);
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card).toContainText("Professional Enamel");
    await expect(card.getByTestId(`gap-card-open-colour_match_outstanding:work_order:${codes!.workOrderId}:codes`))
      .toHaveAttribute("href", new RegExp(`^/pc/wo/${codes!.workOrderId}`));

    // The office keys the codes — the item clears, because it was derived from the facts.
    expect(await rpcAs(staff!, "wo_set_colour_match", { p_work_order_id: codes!.workOrderId, p_product: "Wash and Wear", p_code: "555", p_brand: "Dulux", p_can_size: "15 L" })).toBe("ok");
    expect(await rpcAs(staff!, "wo_set_colour_match", { p_work_order_id: codes!.workOrderId, p_product: "Professional Enamel", p_code: "555", p_brand: "Dulux", p_can_size: "4 L" })).toBe("ok");
    expect(await rpcAs(staff!, "wo_colour_match_outstanding", { p_work_order_id: codes!.workOrderId })).toBe("");
    const after = await rpcAsJson<OutstandingRow[]>(staff!, "wo_colour_matches_outstanding", {});
    expect((after ?? []).some((x) => x.work_order_id === codes!.workOrderId)).toBe(false);
    await page.goto("/pc");
    await expect(page.getByTestId("tile-critical")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId(`gap-card-colour_match_outstanding:work_order:${codes!.workOrderId}:codes`)).toHaveCount(0);
  });

  test("quality check passed: the painter's page still offers Start the walkthrough, and it opens", async ({ page }) => {
    await completePrep(db!, contractor!, passed!.workOrderId);
    expect(await rpcAs(contractor!, "wo_contractor_finish", { p_work_order_id: passed!.workOrderId })).toBe("ok:completion_prep:qa_pending");
    expect(await rpcAs(contractor!, "wo_contractor_confirm_prep", { p_work_order_id: passed!.workOrderId })).toBe("ok:qa");
    // Logged as a pass the way 28 Logan Street was, with the job parked at qa.
    await db!.from("wo_qa_checks").update({ result: "pass" }).eq("work_order_id", passed!.workOrderId);

    await signIn(page, contractor!, /\/portal/);
    await page.goto(`/portal/jobs/${passed!.workOrderId}`);
    // The pass routes the job on view, and the Start button is there — no "office signs off" wall.
    await expect(page.getByTestId("walkthrough-start")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("walkthrough-start-office")).toBeVisible();
    await expect(page.getByTestId("staff-signoff-notice")).toHaveCount(0);
    await expect(page.getByTestId("walkthrough-bar")).toHaveAttribute("data-phase", "walkthrough");
    expect(await stageOf(passed!.workOrderId)).toBe("walkthrough");

    await page.getByTestId("start-walkthrough").click();
    await expect(page).toHaveURL(/\/s\//, { timeout: 30_000 });
    const { data: so } = await db!.from("wo_signoff").select("walkthrough_session_token").eq("work_order_id", passed!.workOrderId).single();
    expect((so as { walkthrough_session_token: string | null }).walkthrough_session_token).toBeTruthy();
  });
});

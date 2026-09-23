import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn } from "./helpers";
import {
  contractorIdForEmail, createLoopFixture, destroyLoopFixture,
  serviceClient, type LoopFixture,
} from "./fixtures/woLoop";

/**
 * Correcting the level of finish on a job that is already out (Tom, 23 Sep 2026).
 *
 * The job at 1 McNamara was sold at Level 2 and priced at Level 3. Changing it
 * in the revision builder moved the money and left the painter's sheet saying
 * PG-3 — full prep, filled, sanded, sealed and caulked — because wo_snapshot is
 * written ONLY from the accepted estimate's builder_state (20260901 on accept,
 * 20260904 on issue), that estimate is frozen by estimate_frozen_guard, and no
 * variation RPC has ever written wo_snapshot. There was no path at all from
 * "we agreed Level 2" to what the contractor is held to.
 *
 * So the test that matters is the CONTRACTOR'S OWN ANONYMOUS SHEET, read
 * through the token with no session: before, it says PG-3; after the office
 * corrects it, it says PG-2, and the areas that never carried an override of
 * their own follow the job down. A staff-preview assertion runs alongside,
 * because staff-as-tester is how the response-contract bug hid.
 */

const staff = credentials("STAFF");
const contractor = credentials("CONTRACTOR");
const db: SupabaseClient | null = serviceClient();

let fixture: LoopFixture | null = null;
let shareToken = "";

/** The snapshot as the contractor's token RPC returns it — no session, no RLS. */
async function snapshot(): Promise<{
  levelOfFinish: string; finishCode: string;
  areas: { id: string; finishCode: string; finishOverridden: boolean }[];
}> {
  const { data, error } = await db!.from("work_orders")
    .select("wo_snapshot").eq("id", fixture!.workOrderId).single();
  if (error) throw new Error(`read snapshot: ${error.message}`);
  return (data as { wo_snapshot: never }).wo_snapshot;
}

test.describe("level of finish on an issued job sheet", () => {
  test.skip(!staff || !contractor, missingCreds("STAFF"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixture job");

  test.beforeAll(async () => {
    const contractorId = await contractorIdForEmail(db!, contractor!.email);
    fixture = await createLoopFixture(db!, contractorId!, [
      { heading: "Front", labels: ["Walls", "Windows"] },
      { heading: "Hallway", labels: ["Ceiling"] },
    ]);

    const { data, error } = await db!.from("work_orders")
      .select("share_token").eq("id", fixture.workOrderId).single();
    if (error) throw new Error(`fixture token: ${error.message}`);
    shareToken = (data as { share_token: string }).share_token;

    // The Hallway carries a deliberate override — the office already decided
    // that one area is Showcase. A job-level correction must not touch it.
    const snap = await snapshot();
    const areas = snap.areas.map((a) =>
      a.id === "a1" ? { ...a, finishCode: "PG-4", finishOverridden: true } : a);
    const { error: upErr } = await db!.from("work_orders")
      .update({ wo_snapshot: { ...snap, areas } }).eq("id", fixture.workOrderId);
    if (upErr) throw new Error(`fixture override: ${upErr.message}`);
  });

  test.afterAll(async () => {
    await destroyLoopFixture(db!, fixture);
  });

  test("the office corrects the level and the painter's sheet follows", async ({ page }) => {
    // ---- before: the sheet the contractor actually holds -------------------
    await page.goto(`/w/${shareToken}`);
    await expect(page.getByText("PG-3").first()).toBeVisible();

    // ---- the office corrects it on the job page ----------------------------
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto(`/pc/wo/${fixture!.workOrderId}`);

    const card = page.getByTestId("finish-level-card");
    await expect(card).toBeVisible();
    await expect(card.getByTestId("finish-level-current")).toContainText("PG-3");

    await card.getByTestId("finish-level-select").selectOption("FIN-2");
    await card.getByTestId("finish-level-save").click();
    await expect(card.getByTestId("finish-level-msg")).toContainText(/job sheet/i);
    await expect(card.getByTestId("finish-level-current")).toContainText("PG-2");

    // ---- after: the same anonymous sheet, no session -----------------------
    await page.context().clearCookies();
    await page.goto(`/w/${shareToken}`);
    await expect(page.getByText("PG-2").first()).toBeVisible();
    await expect(page.getByText("PG-3")).toHaveCount(0);
    // The overridden area kept its own standard.
    await expect(page.getByText("PG-4").first()).toBeVisible();

    // ---- and the document itself agrees ------------------------------------
    const after = await snapshot();
    expect(after.finishCode).toBe("PG-2");
    expect(after.levelOfFinish).toMatch(/^Level 2\b/);
    const front = after.areas.find((a) => a.id === "a0")!;
    const hallway = after.areas.find((a) => a.id === "a1")!;
    expect(front.finishCode).toBe("PG-2");       // followed the job
    expect(front.finishOverridden).toBe(false);
    expect(hallway.finishCode).toBe("PG-4");     // kept its override
    expect(hallway.finishOverridden).toBe(true);
  });

  test("a level with no contractor standard is refused, not guessed", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto(`/pc/wo/${fixture!.workOrderId}`);

    // FIN-1 has no PG equivalent on purpose (lib/workorder/finish.ts, note 2):
    // telling a contractor "PG-2" on a job priced at FIN-1 would hold them to
    // more prep than the customer paid for. It must not be offerable.
    const options = await page.getByTestId("finish-level-select")
      .locator("option").evaluateAll((els) => els.map((e) => (e as HTMLOptionElement).value));
    expect(options).not.toContain("FIN-1");
    expect(options).toEqual(expect.arrayContaining(["FIN-2", "FIN-3", "FIN-4"]));
  });
});

import { expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn, test } from "./helpers";
import {
  completePrep, contractorIdForEmail, createLoopFixture, destroyLoopFixture,
  photosIn, serviceClient, type LoopFixture,
} from "./fixtures/woLoop";

/**
 * Tom, 19 Oct 2026 (migration 20270277): "currently, if there are pending
 * variations, they are unable to start the walk through on their phone,
 * please can this be updated to they can still start the walk through if all
 * of the areas are ticked off."
 *
 * The gate (wo_gate_blocked) used to refuse every forward move while a
 * variation sat at raised / priced / customer_approved. Now an undecided
 * variation holds the job only while a surface in scope is still to tick:
 *
 *   1. the gate, asked directly — every surface done + a raised variation →
 *      nothing holds the finish; one surface back to do → the surfaces are
 *      named first; on the prep → walkthrough move with work still to do the
 *      variation is still the refusal;
 *   2. AS THE PAINTER: the pinned bar's press finishes the job with the
 *      variation still open — the server routes it on (this contractor's jobs
 *      are quality checked) and never says "waiting on a decision".
 *
 * The variation is left open on purpose: it stays on PC Command's
 * "Variations for approval" for the office to decide.
 */
const contractor = credentials("CONTRACTOR");
const staff = credentials("STAFF");
const db: SupabaseClient | null = serviceClient();

let f: LoopFixture | null = null;

const gate = async (from: string, to: string) => {
  const { data, error } = await db!.rpc("wo_gate_blocked", { p_wo_id: f!.workOrderId, p_from: from, p_to: to });
  if (error) throw error;
  return data as string | null;
};

test.describe("the walkthrough goes ahead with a variation still undecided", () => {
  test.describe.configure({ mode: "serial" });
  test.skip(!contractor || !staff, missingCreds("STAFF"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixture job");

  test.beforeAll(async () => {
    const contractorId = await contractorIdForEmail(db!, contractor!.email);
    f = await createLoopFixture(db!, contractorId!, [{ heading: "Lounge", labels: ["Walls", "Ceiling"] }]);
    await db!.from("wo_surfaces").update({ state: "done" }).eq("work_order_id", f.workOrderId);
    await photosIn(db!, f.workOrderId);
    const { error } = await db!.from("wo_variations").insert({
      work_order_id: f.workOrderId, category: "damage", comment: "Left undecided on purpose", status: "raised",
    });
    if (error) throw error;
  });

  test.afterAll(async () => {
    await destroyLoopFixture(db!, f);
  });

  test("the gate: every area ticked off, an open variation no longer holds the finish", async () => {
    expect(await gate("in_progress", "completion_prep")).toBeNull();
    expect(await gate("completion_prep", "walkthrough")).toBeNull();

    // One surface back to do: the surfaces are what the painter is told about.
    const ceiling = f!.surfaces.find((s) => s.label === "Ceiling")!;
    await db!.from("wo_surfaces").update({ state: "todo" }).eq("id", ceiling.id);
    expect(await gate("in_progress", "completion_prep")).toMatch(/surfaces still to tick off/);
    // With work still to do, the undecided variation still refuses the move to the walkthrough.
    expect(await gate("completion_prep", "walkthrough")).toMatch(/1 variation still waiting on a decision/);

    await db!.from("wo_surfaces").update({ state: "done" }).eq("id", ceiling.id);
    expect(await gate("completion_prep", "walkthrough")).toBeNull();
  });

  test("as the painter: the bar's press finishes the job with the variation still open", async ({ page }) => {
    await completePrep(db!, staff!, f!.workOrderId);
    await signIn(page, contractor!, /\/portal/);
    await page.goto(`/portal/jobs/${f!.workOrderId}`);
    const bar = page.getByTestId("walkthrough-bar");
    await expect(bar).toBeVisible({ timeout: 15_000 });
    await expect(bar).toHaveAttribute("data-phase", "finish");

    await bar.getByTestId("walkthrough-bar-start").click();
    // Either the walkthrough opens (no check due) or the server says the
    // check comes first — never the old refusal.
    await Promise.race([
      page.waitForURL(/\/s\/[a-f0-9]{64}/, { timeout: 20_000 }),
      expect(bar.getByTestId("walkthrough-bar-msg")).toContainText(/quality check|nice work/i, { timeout: 20_000 }),
    ]);
    if (!/\/s\//.test(page.url())) {
      await expect(bar.getByTestId("walkthrough-bar-msg")).not.toContainText(/waiting on a decision/i);
    }

    const { data: wo } = await db!.from("work_orders").select("stage").eq("id", f!.workOrderId).single();
    expect(["qa", "walkthrough", "closed"]).toContain((wo as { stage: string }).stage);
    const { data: v } = await db!.from("wo_variations").select("status").eq("work_order_id", f!.workOrderId);
    expect((v as { status: string }[]).map((x) => x.status)).toEqual(["raised"]);
  });
});

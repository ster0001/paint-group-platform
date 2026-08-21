import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn } from "./helpers";
import {
  contractorIdForEmail, createLoopFixture, destroyLoopFixture,
  serviceClient, type LoopFixture,
} from "./fixtures/woLoop";

/**
 * Step 2, driven AS THE CONTRACTOR — the role that actually ticks.
 *
 * The rule under test is the one that cannot be checked by reading code: the
 * first tick on an elevation is refused until that elevation has a before
 * photo, and the refusal comes from the server, not the screen. The job is a
 * throwaway fixture built and deleted by this spec.
 */

const creds = credentials("CONTRACTOR");
const db: SupabaseClient | null = serviceClient();

let fixture: LoopFixture | null = null;

test.describe("work order ticks", () => {
  test.skip(!creds, missingCreds("CONTRACTOR"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixture job");

  test.beforeAll(async () => {
    const contractorId = await contractorIdForEmail(db!, creds!.email);
    if (!contractorId) throw new Error(`no contractors row for ${creds!.email}`);
    fixture = await createLoopFixture(db!, contractorId, [
      { heading: "Front", labels: ["Walls — weatherboard", "Windows × 3"] },
      { heading: "Left", labels: ["Eaves — 9 m"] },
    ]);
  });

  test.afterAll(async () => {
    await destroyLoopFixture(db!, fixture);
  });

  test("the tick list renders under its elevation headings", async ({ page }) => {
    await signIn(page, creds!, /\/portal/);
    await page.goto(`/portal/jobs/${fixture!.workOrderId}`);

    const list = page.getByTestId("tick-list");
    await expect(list).toBeVisible();
    await expect(list).toContainText("Front");
    await expect(list).toContainText("Left");
    await expect(page.getByTestId("tick-progress")).toHaveText("0 / 3");
  });

  test("an elevation with no before photo asks for one before the first tick", async ({ page }) => {
    await signIn(page, creds!, /\/portal/);
    await page.goto(`/portal/jobs/${fixture!.workOrderId}`);

    await expect(page.getByTestId("photo-prompt-Front")).toBeVisible();
    await expect(page.getByTestId("photo-prompt-Left")).toBeVisible();
  });

  test("the SERVER refuses the first tick without a photo, not just the screen", async () => {
    // Straight at the RPC as the contractor's own session — bypassing the UI is
    // the point: a hint the browser enforces is not a rule.
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const auth = await fetch(`${url}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: anon, "Content-Type": "application/json" },
      body: JSON.stringify({ email: creds!.email, password: creds!.password }),
    }).then((r) => r.json());

    const front = fixture!.surfaces.find((s) => s.heading === "Front")!;
    const result = await fetch(`${url}/rest/v1/rpc/wo_tick_surface`, {
      method: "POST",
      headers: {
        apikey: anon,
        Authorization: `Bearer ${auth.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ p_surface_id: front.id, p_to: "prepped" }),
    }).then((r) => r.json());

    expect(String(result)).toBe("error:before_photo_required:Front");

    // And nothing moved.
    const { data } = await db!.from("wo_surfaces").select("state").eq("id", front.id).single();
    expect((data as { state: string }).state).toBe("todo");
    const { count } = await db!.from("wo_events")
      .select("id", { count: "exact", head: true })
      .eq("work_order_id", fixture!.workOrderId).eq("type", "surface_tick");
    expect(count ?? 0).toBe(0);
  });

  test("with the photo in, ticks record and the history is right", async ({ page }) => {
    // The photo itself is put in place directly: the upload path has its own
    // tests, and what this spec is about is the gate opening.
    await db!.from("wo_photos").insert({
      work_order_id: fixture!.workOrderId,
      kind: "before",
      area: "Front",
      storage_path: `wo/${fixture!.workOrderId}/e2e-before.jpg`,
    });

    await signIn(page, creds!, /\/portal/);
    await page.goto(`/portal/jobs/${fixture!.workOrderId}`);

    // Front no longer asks; Left still does — the gate is per elevation.
    await expect(page.getByTestId("photo-prompt-Front")).toHaveCount(0);
    await expect(page.getByTestId("photo-prompt-Left")).toBeVisible();

    const front = fixture!.surfaces.find((s) => s.heading === "Front")!;
    const row = page.getByTestId(`tick-${front.id}`);

    await row.click();                                   // todo → prepped
    await expect(row).toContainText("Prepped");
    await row.click();                                   // prepped → done
    await expect(row).toContainText("Done");
    await expect(page.getByTestId("tick-progress")).toHaveText("1 / 3");

    const { data: events } = await db!.from("wo_events")
      .select("meta").eq("work_order_id", fixture!.workOrderId).eq("type", "surface_tick")
      .order("created_at", { ascending: true });
    const moves = ((events as { meta: { from: string; to: string } }[]) ?? [])
      .map((e) => `${e.meta.from}>${e.meta.to}`);
    expect(moves).toEqual(["todo>prepped", "prepped>done"]);
  });

  test("the stage gate stays shut while surfaces are outstanding", async () => {
    const { data } = await db!.rpc("wo_gate_blocked", {
      p_wo_id: fixture!.workOrderId,
      p_from: "in_progress",
      p_to: "completion_prep",
    });
    expect(String(data)).toContain("surfaces still to tick off");
  });

  test("someone who is neither staff nor the assignee cannot tick at all", async () => {
    // The customer is the right probe here. Staff are legitimately allowed to
    // tick on a painter's behalf, so using a staff login would prove nothing —
    // and the first attempt at this test failed for a better reason than it
    // passed: staff hit the before-photo gate, exactly as a painter would.
    const other = credentials("CUSTOMER");
    test.skip(!other, "set E2E_CUSTOMER_EMAIL and E2E_CUSTOMER_PASSWORD to run this");

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const auth = await fetch(`${url}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: anon, "Content-Type": "application/json" },
      body: JSON.stringify({ email: other!.email, password: other!.password }),
    }).then((r) => r.json());

    const left = fixture!.surfaces.find((s) => s.heading === "Left")!;
    const result = await fetch(`${url}/rest/v1/rpc/wo_tick_surface`, {
      method: "POST",
      headers: { apikey: anon, Authorization: `Bearer ${auth.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_surface_id: left.id, p_to: "prepped" }),
    }).then((r) => r.json());

    expect(String(result)).toBe("error:not_yours");

    const { data } = await db!.from("wo_surfaces").select("state").eq("id", left.id).single();
    expect((data as { state: string }).state).toBe("todo");
  });
});

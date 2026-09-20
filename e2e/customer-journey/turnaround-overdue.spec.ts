/**
 * C17 failure story — a request older than the turnaround setting.
 *
 * The customer was told "usually by the next working day" (Settings
 * `confirmation_turnaround`). A request that has sat longer than that shows
 * on the estimates home in the OVERDUE bucket, and the card says, in the
 * customer's own words, that the promise has passed — the one evaluator's
 * sentence (lib/crm/work-queue.ts buildDeskCheckItems), not a second opinion.
 */
import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { credentials, signIn } from "../helpers";
import { serviceClient } from "../fixtures/woLoop";
import { defaultWizardState } from "../../lib/wizard/state";

const db: SupabaseClient | null = serviceClient();
const staff = credentials("STAFF");
const run = randomBytes(4).toString("hex");

const room = (id: number, name: string) => ({
  id, kind: "area", name, type: "Interior", areaType: "room", roomType: "bedroom", L: 4, W: 3.5, H: 2.4, isOption: false,
  description: "", open: false, media: [], origin: "customer_stated", confidence: 0.9, assumedFields: [], extractionSourceId: null,
  surfaces: [{ id: id * 10, code: "Walls", internalLabel: "Walls", clientLabel: "Walls", count: 1, coats: 2, prepHr: 0, crewNote: "", origin: "customer_stated", confidence: 0.9, assumedFields: [] }],
});

test.describe("C17 · a request older than the turnaround", () => {
  test.skip(!db || !staff, "needs SUPABASE_SERVICE_ROLE_KEY + E2E_STAFF_* creds");
  let estimateId = "";

  test.beforeAll(async () => {
    const sb = db!;
    const state = defaultWizardState();
    state.mode = "customer"; state.noPlan = true;
    state.basics = { bedrooms: 2, storeys: "single", sizeBand: "s120_200", openPlanKitchenLiving: false };
    const est = await sb.from("estimates").insert({
      title: `Overdue ${run}`, status: "draft", source: "customer_intake", total_cents: 410_000,
      builder_state: { blocks: [room(1, "Bed 1"), room(2, "Bed 2")], aiDeferred: [], modSel: {}, materials: {}, wizard: { state, builtAt: new Date().toISOString(), builtBy: "e2e" } },
    }).select("id").single();
    if (est.error) throw new Error(est.error.message);
    estimateId = est.data.id;
    // Requested a WEEK ago — past any turnaround the setting can hold, and
    // clear of the weekend boundary (three days over a weekend plus eight
    // business hours lands on Monday morning, which is "today", not overdue).
    const cr = await sb.from("confirmation_requests").insert({
      estimate_id: estimateId, requested_by: "customer", kind: "remote", status: "requested", suggested_action: "fix",
      requested_at: new Date(Date.now() - 7 * 86_400_000).toISOString(), pack: { totalCents: 410_000 },
    });
    if (cr.error) throw new Error(cr.error.message);
  });
  test.afterAll(async () => { if (estimateId) await db!.from("estimates").delete().eq("id", estimateId); });

  test("shows in the OVERDUE bucket and says the promise has passed", async ({ page }) => {
    test.setTimeout(120_000);
    await signIn(page, staff!, /home|estimates|today|quote/);
    await page.goto("/estimates");
    const row = page.getByTestId(`waiting-row-${estimateId}`);
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(row).toHaveAttribute("data-bucket", "overdue");
    await expect(row).toContainText(/that has passed/);
    await expect(row.locator("a")).toHaveAttribute("href", new RegExp(`/quote\\?id=${estimateId}&tab=pack`));
  });
});

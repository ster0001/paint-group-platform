/**
 * C17 story — commercial: warehouse → a visit booked from the console.
 *
 * A warehouse range was sent for confirmation (C13's screen); the estimator
 * opens the pack in the console and books a visit from the strip. The request
 * moves to `visit_booked` through the one confirmations route, the CRM gets
 * the event, and the strip refuses a second booking.
 */
import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { credentials, signIn } from "../helpers";
import { serviceClient } from "../fixtures/woLoop";
import { defaultWizardState, defaultCustomer } from "../../lib/wizard/state";

const db: SupabaseClient | null = serviceClient();
const staff = credentials("STAFF");
const run = randomBytes(4).toString("hex");

const area = (id: number, name: string, L: number, W: number) => ({
  id, kind: "area", name, type: "Interior", areaType: "room", roomType: "living", L, W, H: 6, isOption: false,
  description: "", open: false, media: [], origin: "customer_stated", confidence: 0.85, assumedFields: [], extractionSourceId: null,
  surfaces: [{ id: id * 10, code: "Walls", internalLabel: "Walls", clientLabel: "Walls", count: 1, coats: 2, prepHr: 0, crewNote: "", origin: "customer_stated", confidence: 0.85, assumedFields: [] }],
});

test.describe("C17 · warehouse → visit booked from the console", () => {
  test.skip(!db || !staff, "needs SUPABASE_SERVICE_ROLE_KEY + E2E_STAFF_* creds");
  let estimateId = "";
  let requestId = "";

  test.beforeAll(async () => {
    const sb = db!;
    const state = defaultWizardState();
    state.mode = "customer"; state.noPlan = true;
    state.customer = { ...defaultCustomer(), propertyKind: "commercial", commercialSegment: "warehouse", suburb: "Dandenong", postcode: "3175" };
    state.commercial = {
      segment: "warehouse", kind: null, counts: {}, openSize: "150", openHeight: null, ceiling: "exposed", also: [], surfaces: ["Walls"],
      hours: "business", occ: "occ", areaBracket: "1000", heightBracket: "6", material: "precast", racking: "some", access: [],
    } as unknown as typeof state.commercial;
    const est = await sb.from("estimates").insert({
      title: `Warehouse ${run}`, status: "draft", source: "customer_intake", total_cents: 1_860_000,
      builder_state: { blocks: [area(1, "Warehouse floor", 40, 25), area(2, "Office", 6, 4)], aiDeferred: [], modSel: {}, materials: {}, wizard: { state, builtAt: new Date().toISOString(), builtBy: "e2e" } },
    }).select("id").single();
    if (est.error) throw new Error(est.error.message);
    estimateId = est.data.id;
    const cr = await sb.from("confirmation_requests").insert({
      estimate_id: estimateId, requested_by: "customer", kind: "remote", status: "requested", suggested_action: "visit",
      pack: { totalCents: 1_860_000 },
    }).select("id").single();
    if (cr.error) throw new Error(cr.error.message);
    requestId = cr.data.id;
  });
  test.afterAll(async () => { if (estimateId) await db!.from("estimates").delete().eq("id", estimateId); });

  test("the estimator books a visit from the pack's strip; the request is visit_booked; a second click is idempotent and another action is refused", async ({ page }) => {
    test.setTimeout(120_000);
    await signIn(page, staff!, /estimates|today|quote/);
    await page.goto(`/quote?id=${estimateId}&tab=pack`);
    const strip = page.getByTestId("strip-actions");
    await expect(strip).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("strip-visit").click();
    await expect.poll(async () => {
      const { data } = await db!.from("confirmation_requests").select("status").eq("id", requestId).single();
      return data?.status;
    }, { timeout: 30_000 }).toBe("visit_booked");
    // The CRM heard it.
    const { data: events } = await db!.from("crm_events").select("type").eq("estimate_id", estimateId).eq("type", "visit_booked_from_wizard");
    expect((events ?? []).length).toBeGreaterThanOrEqual(1);
    // A second click is not an error (C6 idempotency): the route answers 200
    // with what already happened, and books nothing twice.
    const again = await page.request.post(`/api/confirmations/${requestId}`, { data: { action: "book_visit" } });
    expect(again.status()).toBe(200);
    const j = await again.json();
    expect(j.repeated).toBe(true);
    expect(j.status).toBe("visit_booked");
    // …and a different action on a booked visit IS refused, in words.
    const ask = await page.request.post(`/api/confirmations/${requestId}`, { data: { action: "ask_question", question: "Which door?" } });
    expect(ask.status()).toBe(409);
    expect((await ask.json()).error).toMatch(/already booked/i);
  });
});

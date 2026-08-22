import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn } from "./helpers";
import {
  contractorIdForEmail, createLoopFixture, destroyLoopFixture,
  rpcAs, serviceClient, type LoopFixture,
} from "./fixtures/woLoop";

/**
 * ⚑7 — Reoffer, per Tom's ruling (SESSION-HANDOFF.md, 22 Aug):
 *
 *   tap -> confirm -> withdraw the lapsed offer (logged) -> create the next
 *   offer through the existing scheduling flow -> notify the lapsed contractor
 *   courteously.
 *
 * The spec is written before the implementation, so what follows is the
 * definition of done rather than a description of whatever got built.
 */

const staff = credentials("STAFF");
const contractor = credentials("CONTRACTOR");
const db: SupabaseClient | null = serviceClient();

let job: LoopFixture | null = null;
let lapsedOfferId = "";
let firstContractor = "";
let secondContractor = "";

test.describe.configure({ mode: "serial" });

test.describe("reoffering a lapsed job", () => {
  test.skip(!staff || !contractor, missingCreds("STAFF"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixture job");

  test.beforeAll(async () => {
    firstContractor = (await contractorIdForEmail(db!, contractor!.email))!;
    // A second contractor to reoffer to. Mira exists as a test login.
    const { data: others } = await db!.from("contractors")
      .select("id").neq("id", firstContractor).limit(1);
    secondContractor = ((others ?? []) as { id: string }[])[0]?.id ?? "";

    job = await createLoopFixture(db!, firstContractor, [{ heading: "Front", labels: ["Walls"] }]);
    await db!.from("work_orders").update({
      stage: "offered", status: "issued", contractor_id: null,
    }).eq("id", job.workOrderId);

    await rpcAs(staff!, "send_offer", {
      p_work_order_id: job.workOrderId, p_contractor_id: firstContractor,
      p_start: new Date(Date.now() + 70 * 86_400_000).toISOString().slice(0, 10),
      p_end: null, p_note: "",
    });
    const { data: offer } = await db!.from("booking_offers").select("id")
      .eq("work_order_id", job.workOrderId).eq("state", "offered").single();
    lapsedOfferId = (offer as { id: string }).id;

    // Push it past its SLA, the way 27 hours of silence would.
    await db!.from("booking_offers")
      .update({ expires_at: new Date(Date.now() - 3 * 3600 * 1000).toISOString() })
      .eq("id", lapsedOfferId);
  });

  test.afterAll(async () => { await destroyLoopFixture(db!, job); });

  test("a breached offer raises exactly one critical card, with Reoffer on it", async ({ page }) => {
    await signIn(page, staff!, /\/estimates/);
    await page.goto("/pc");
    const card = page.getByTestId(`card-offer-sla:${job!.workOrderId}`);
    await expect(card).toBeVisible();
    await expect(card).toContainText("past SLA");
    await expect(page.getByTestId(`action-offer-sla:${job!.workOrderId}`)).toContainText("Reoffer");
  });

  test("reoffering withdraws the lapsed offer and logs it", async () => {
    test.skip(!secondContractor, "needs a second contractor to reoffer to");

    const result = await rpcAs(staff!, "wo_reoffer", {
      p_offer_id: lapsedOfferId,
      p_contractor_id: secondContractor,
      p_start: new Date(Date.now() + 75 * 86_400_000).toISOString().slice(0, 10),
      p_end: null,
      p_note: "Reoffered after the first offer lapsed",
    });
    expect(result).toMatch(/^ok:/);

    const { data: lapsed } = await db!.from("booking_offers")
      .select("state").eq("id", lapsedOfferId).single();
    expect((lapsed as { state: string }).state).toBe("withdrawn");

    const { data: events } = await db!.from("wo_events")
      .select("type, meta").eq("work_order_id", job!.workOrderId).eq("type", "offer_reoffered");
    expect((events ?? []).length).toBe(1);
  });

  test("the next offer exists, through the normal scheduling flow", async () => {
    test.skip(!secondContractor, "needs a second contractor");

    const { data: live } = await db!.from("booking_offers")
      .select("id, contractor_id, state, expires_at")
      .eq("work_order_id", job!.workOrderId).eq("state", "offered");
    expect((live ?? []).length).toBe(1);

    const offer = (live as { contractor_id: string; expires_at: string }[])[0];
    expect(offer.contractor_id).toBe(secondContractor);
    // A fresh SLA, not the lapsed one's.
    expect(new Date(offer.expires_at).getTime()).toBeGreaterThan(Date.now());
  });

  test("the lapsed contractor is told, courteously and without blame", async () => {
    test.skip(!secondContractor, "needs a second contractor");

    const { data } = await db!.from("contractor_events")
      .select("type, detail").eq("contractor_id", firstContractor)
      .eq("type", "offer_lapsed").order("created_at", { ascending: false }).limit(1);

    const event = ((data ?? []) as { detail: { message?: string } }[])[0];
    expect(event, "the lapsed contractor gets an event they can be shown").toBeTruthy();

    const message = (event.detail.message ?? "").toLowerCase();
    expect(message.length).toBeGreaterThan(20);
    // Courteous: no blame, no scolding.
    for (const unkind of ["failed", "did not respond", "ignored", "too slow", "missed"]) {
      expect(message).not.toContain(unkind);
    }
    expect(message).toContain("lapsed");
  });

  test("the card clears itself once the job is reoffered", async ({ page }) => {
    test.skip(!secondContractor, "needs a second contractor");
    await signIn(page, staff!, /\/estimates/);
    await page.goto("/pc");
    // The breach is gone: the live offer is inside its SLA again.
    await expect(page.getByTestId(`card-offer-sla:${job!.workOrderId}`)).toHaveCount(0);
  });

  test("a job with no live offer cannot be reoffered", async () => {
    expect(await rpcAs(staff!, "wo_reoffer", {
      p_offer_id: "00000000-0000-0000-0000-000000000000",
      p_contractor_id: firstContractor,
      p_start: new Date(Date.now() + 80 * 86_400_000).toISOString().slice(0, 10),
      p_end: null, p_note: "",
    })).toBe("error:not_found");
  });
});

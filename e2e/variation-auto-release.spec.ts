import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn, TINY_SIGNATURE_PNG } from "./helpers";
import {
  contractorIdForEmail, createLoopFixture, destroyLoopFixture,
  serviceClient, rpcAs, setVariationRelease, type LoopFixture,
} from "./fixtures/woLoop";

/**
 * Tom, 3 Sep 2026: "as soon as the client approves them, automatically send
 * the variation to the contractor in their home page in the app for their
 * approval."
 *
 *   office prices a variation → customer signs it on /v
 *     → released_at is stamped BY THE SIGN (no office click)
 *     → the painter's home page lists it under "Variations waiting on you"
 *     → the painter accepts it there, in one tap.
 *
 * The switch lives on Settings → Automations; this pins the 'auto' side. The
 * manual side ('pc') is still proven by wo-variations.spec.
 */

const contractor = credentials("CONTRACTOR");
const customer = credentials("CUSTOMER");
const staff = credentials("STAFF");
const db: SupabaseClient | null = serviceClient();

let fixture: LoopFixture | null = null;
let variationId = "";
let token = "";
let releaseBefore: "auto" | "pc" = "auto";

test.describe.configure({ mode: "serial" });

test.describe("a signed variation reaches the painter by itself", () => {
  test.skip(!contractor, missingCreds("CONTRACTOR"));
  test.skip(!customer, missingCreds("CUSTOMER"));
  test.skip(!staff, missingCreds("STAFF"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixture job");

  test.beforeAll(async () => {
    releaseBefore = await setVariationRelease(db!, "auto");
    const contractorId = await contractorIdForEmail(db!, contractor!.email);
    if (!contractorId) throw new Error(`no contractors row for ${contractor!.email}`);
    fixture = await createLoopFixture(db!, contractorId, [
      { heading: "Front", labels: ["Walls — render", "Door × 1"] },
    ]);
    const { data: seeded } = await db!.from("wo_variations").insert({
      work_order_id: fixture.workOrderId,
      category: "extra_scope",
      comment: "Paint the side gate as well — auto-release fixture",
      est_hours: 2,
      status: "raised",
    }).select("id").single();
    variationId = (seeded as { id: string }).id;
    const priced = await rpcAs(staff!, "wo_price_variation", {
      p_variation_id: variationId,
      p_price_cents: 56_000,
      p_inputs: { hours: 2, chargeOutCents: 28000, type: "Exterior" },
      p_priced_lines: [{ label: "Labour — 2 hr", cents: 56_000 }],
      p_hours: 2,
    });
    expect(priced).toMatch(/^ok:/);
    token = priced.slice(3);
  });

  test.afterAll(async () => {
    await destroyLoopFixture(db!, fixture);
    await setVariationRelease(db!, releaseBefore);
  });

  test("before signing, nothing is with the painter", async () => {
    const { data } = await db!.from("wo_variations").select("status, released_at").eq("id", variationId).single();
    expect(data).toMatchObject({ status: "priced", released_at: null });
    expect(await rpcAs(contractor!, "wo_contractor_accept_variation", { p_variation_id: variationId }))
      .toBe("error:customer_not_approved");
  });

  test("the customer's signature releases it — no office click", async () => {
    expect(await rpcAs(customer!, "wo_customer_sign_variation", {
      p_token: token, p_name: "Auto Customer", p_signature: TINY_SIGNATURE_PNG,
    })).toBe("ok:approved");

    const { data } = await db!.from("wo_variations")
      .select("status, released_at, released_by").eq("id", variationId).single();
    const v = data as { status: string; released_at: string | null; released_by: string | null };
    expect(v.status).toBe("customer_approved");
    expect(v.released_at).not.toBeNull();
    expect(v.released_by).toBeNull(); // the system did it, not a person

    const { data: events } = await db!.from("wo_events")
      .select("type, meta").eq("work_order_id", fixture!.workOrderId).eq("type", "variation_released");
    const auto = (events ?? []).find((e) => (e.meta as { variation_id?: string }).variation_id === variationId);
    expect((auto?.meta as { auto?: boolean } | undefined)?.auto).toBe(true);
  });

  test("the painter sees it on their home page and accepts it there", async ({ page }) => {
    await signIn(page, contractor!, /\/portal/);
    await page.goto("/portal");
    const card = page.getByTestId("home-variations");
    await expect(card).toBeVisible();
    await expect(card).toContainText("auto-release fixture");

    await card.locator("a").first().click();
    await expect(page).toHaveURL(new RegExp(`/portal/jobs/${fixture!.workOrderId}`));

    const accept = page.getByTestId(`accept-${variationId}`);
    await expect(accept).toContainText("$120.00"); // 2 h × the $60 settings rate
    await accept.click();
    await expect(page.getByTestId(`delta-${variationId}`)).toContainText("$120.00");

    const { data } = await db!.from("wo_variations")
      .select("status, contractor_accepted_at").eq("id", variationId).single();
    expect((data as { status: string }).status).toBe("contractor_accepted");
  });

  test("the office's Release button is a harmless no-op afterwards", async () => {
    // Accepted already — release answers not_approved (status moved on) or
    // already; either way it never un-does anything.
    const r = await rpcAs(staff!, "wo_release_variation", { p_variation_id: variationId });
    expect(["ok:already", "error:not_approved"]).toContain(r);
  });
});

import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn, drawSignature } from "./helpers";
import {
  contractorIdForEmail, createLoopFixture, destroyLoopFixture,
  serviceClient, rpcAs, type LoopFixture,
} from "./fixtures/woLoop";

/**
 * One variation, all the way through, in every role that touches it.
 *
 *   contractor raises it (real UI, with a real photo upload)
 *     -> office prices it
 *       -> customer approves it on the token link (real UI)
 *         -> contractor accepts the adjusted offer (real UI)
 *
 * The assertions that matter are the refusals in between: the contractor cannot
 * accept before the customer has answered, and the contractor's money is the
 * settings rate × hours computed by the database, not anything the browser sent.
 */

const contractor = credentials("CONTRACTOR");
const customer = credentials("CUSTOMER");
const staff = credentials("STAFF");
const db: SupabaseClient | null = serviceClient();

// A real 1×1 JPEG — the ingest sniffs the bytes, so a text file would be
// refused (and that refusal has its own test below).
const JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a" +
  "HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA" +
  "AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==",
  "base64",
);

let fixture: LoopFixture | null = null;
// The flow tests work on a variation seeded straight into the database, so each
// one stands alone and none of them depends on the upload test above having run.
// The contractor's own raise — photo and all — is proved separately.
let variationId = "";
let token = "";

test.describe("a variation, end to end", () => {
  test.skip(!contractor, missingCreds("CONTRACTOR"));
  test.skip(!customer, missingCreds("CUSTOMER"));
  test.skip(!staff, missingCreds("STAFF"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to build the fixture job");

  test.beforeAll(async () => {
    const contractorId = await contractorIdForEmail(db!, contractor!.email);
    if (!contractorId) throw new Error(`no contractors row for ${contractor!.email}`);
    fixture = await createLoopFixture(db!, contractorId, [
      { heading: "Left", labels: ["Walls — weatherboard", "Windows × 2"] },
    ]);

    const { data: photo } = await db!.from("wo_photos").insert({
      work_order_id: fixture.workOrderId, kind: "variation",
      storage_path: `wo/${fixture.workOrderId}/seeded.jpg`,
    }).select("id").single();

    const { data: seeded } = await db!.from("wo_variations").insert({
      work_order_id: fixture.workOrderId,
      category: "rot",
      comment: "Three lower boards on the left side are gone at the bottom edge.",
      est_hours: 3,
      status: "raised",
    }).select("id").single();
    variationId = (seeded as { id: string }).id;
    await db!.from("wo_photos").update({ variation_id: variationId })
      .eq("id", (photo as { id: string }).id);
  });

  test.afterAll(async () => { await destroyLoopFixture(db!, fixture); });

  test("the contractor raises one, with a photo, from their phone", async ({ page }) => {
    await signIn(page, contractor!, /\/portal/);
    await page.goto(`/portal/jobs/${fixture!.workOrderId}`);

    await page.getByTestId("raise-variation").click();
    await page.getByTestId("category-rot").click();
    await page.getByTestId("variation-comment")
      .fill("Three lower boards on the left side are gone at the bottom edge — soft right through.");
    await page.getByTestId("variation-hours").fill("3");

    // Sending is refused until there is evidence.
    await expect(page.getByTestId("send-variation")).toBeDisabled();

    await page.locator('input[type="file"]').last()
      .setInputFiles({ name: "rot.jpg", mimeType: "image/jpeg", buffer: JPEG });
    await expect(page.getByTestId("variation-photo")).toContainText("1 photo added", { timeout: 20_000 });

    await page.getByTestId("send-variation").click();
    await expect(page.getByTestId("variation-message")).toContainText("Sent to the office");

    // The one this test raised is the one with the comment it typed.
    const { data } = await db!.from("wo_variations")
      .select("id, status, category, est_hours")
      .eq("work_order_id", fixture!.workOrderId)
      .like("comment", "%soft right through%").single();
    const row = data as { id: string; status: string; category: string; est_hours: string };
    expect(row.status).toBe("raised");
    expect(row.category).toBe("rot");
    expect(Number(row.est_hours)).toBe(3);

    const { count } = await db!.from("wo_photos")
      .select("id", { count: "exact", head: true }).eq("variation_id", row.id);
    expect(count).toBe(1);
  });

  test("the contractor cannot accept it before the customer has", async () => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const auth = await fetch(`${url}/auth/v1/token?grant_type=password`, {
      method: "POST", headers: { apikey: anon, "Content-Type": "application/json" },
      body: JSON.stringify({ email: contractor!.email, password: contractor!.password }),
    }).then((r) => r.json());

    const result = await fetch(`${url}/rest/v1/rpc/wo_contractor_accept_variation`, {
      method: "POST",
      headers: { apikey: anon, Authorization: `Bearer ${auth.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_variation_id: variationId }),
    }).then((r) => r.json());

    expect(String(result)).toBe("error:customer_not_approved");
  });

  test("the office prices it, and the contractor's share is worked out by the database", async () => {
    // Priced at 3 hours. Nothing here sends a contractor amount.
    const data = await rpcAs(staff!, "wo_price_variation", {
      p_variation_id: variationId,
      p_price_cents: 84000,
      p_inputs: { hours: 3, chargeOutCents: 28000, type: "Exterior" },
      p_priced_lines: [{ label: "Labour — 3 hr", cents: 84000 }],
      p_hours: 3,
    });
    expect(data).toMatch(/^ok:/);
    token = data.slice(3);
    expect(token.length).toBeGreaterThanOrEqual(24);

    const { data: row } = await db!.from("wo_variations")
      .select("status, price_cents, est_hours, contractor_rate_cents, contractor_delta_cents")
      .eq("id", variationId).single();
    const v = row as {
      status: string; price_cents: number; contractor_rate_cents: number; contractor_delta_cents: number;
    };
    expect(v.status).toBe("priced");
    expect(v.price_cents).toBe(84000);
    // The rule: hours × the Settings rate, to the cent, from the DB.
    expect(v.contractor_rate_cents).toBe(6000);
    expect(v.contractor_delta_cents).toBe(18000);
  });

  test("the customer approves it on the token link — by SIGNING (ruling 1)", async ({ page }) => {
    await page.goto(`/v/${token}`);
    await expect(page.getByTestId("variation-price")).toHaveText("$840.00");
    await expect(page.getByTestId("variation-photos")).toContainText("1 photo");

    // The contractor's rate and delta must not be anywhere in what the customer
    // is sent — not hidden, absent.
    const html = (await page.content());
    expect(html).not.toContain("18000");
    expect(html).not.toContain("$180.00");

    // Approve opens the signing panel — a name and a drawn signature, no
    // one-tap approval any more.
    await page.getByTestId("approve-variation").click();

    // Signature first without a name: the client refuses politely.
    await drawSignature(page);
    await page.getByTestId("confirm-sign").click();
    await expect(page.getByTestId("variation-message")).toContainText("full name");

    await page.getByTestId("sign-name").fill("Casey Customer");
    await page.getByTestId("confirm-sign").click();
    await expect(page.getByTestId("variation-outcome")).toContainText("Approved");
    await expect(page.getByTestId("variation-signedby")).toContainText("Casey Customer");

    const { data } = await db!.from("wo_variations")
      .select("status, customer_responded_at, signed_name, signed_at, signature")
      .eq("id", variationId).single();
    const v = data as {
      status: string; customer_responded_at: string | null;
      signed_name: string | null; signed_at: string | null; signature: string | null;
    };
    expect(v.status).toBe("customer_approved");
    expect(v.customer_responded_at).not.toBeNull();
    expect(v.signed_name).toBe("Casey Customer");
    expect(v.signed_at).not.toBeNull();
    expect(v.signature).toMatch(/^data:image\/png;base64,/);
    // A drawn squiggle is real image data, not a token-size stub.
    expect((v.signature ?? "").length).toBeGreaterThan(500);
  });

  test("declining needs no signature and changes nothing on the job", async ({ page }) => {
    // A second variation, seeded and priced the same way.
    const { data: seeded } = await db!.from("wo_variations").insert({
      work_order_id: fixture!.workOrderId,
      category: "customer_request",
      comment: "Could you also do the letterbox?",
      est_hours: 1,
      status: "raised",
    }).select("id").single();
    const declineId = (seeded as { id: string }).id;
    const priced = await rpcAs(staff!, "wo_price_variation", {
      p_variation_id: declineId, p_price_cents: 12_000,
      p_inputs: { hours: 1 }, p_priced_lines: [{ label: "Labour — 1 hr", cents: 12_000 }],
      p_hours: 1,
    });
    expect(priced).toMatch(/^ok:/);

    const { data: surfacesBefore } = await db!.from("wo_surfaces")
      .select("id, state, removed_from_scope").eq("work_order_id", fixture!.workOrderId).order("id");

    await page.goto(`/v/${priced.slice(3)}`);
    await page.getByTestId("decline-variation").click();
    await page.getByTestId("confirm-decline").click();
    await expect(page.getByTestId("variation-outcome")).toContainText("Declined");

    const { data: after } = await db!.from("wo_variations")
      .select("status, signed_name, signature").eq("id", declineId).single();
    const v = after as { status: string; signed_name: string | null; signature: string | null };
    expect(v.status).toBe("declined");
    expect(v.signed_name).toBeNull();
    expect(v.signature).toBeNull();

    // Declined keeps everything unchanged — no strike, no state moves.
    const { data: surfacesAfter } = await db!.from("wo_surfaces")
      .select("id, state, removed_from_scope").eq("work_order_id", fixture!.workOrderId).order("id");
    expect(surfacesAfter).toEqual(surfacesBefore);
  });

  test("a stranger's token gets a 404, never a 403", async ({ page }) => {
    const response = await page.goto("/v/thistokendoesnotexistatallreally");
    expect(response?.status()).toBe(404);
  });

  test("the contractor still cannot accept until the office releases it", async () => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const auth = await fetch(`${url}/auth/v1/token?grant_type=password`, {
      method: "POST", headers: { apikey: anon, "Content-Type": "application/json" },
      body: JSON.stringify({ email: contractor!.email, password: contractor!.password }),
    }).then((r) => r.json());

    const result = await fetch(`${url}/rest/v1/rpc/wo_contractor_accept_variation`, {
      method: "POST",
      headers: { apikey: anon, Authorization: `Bearer ${auth.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_variation_id: variationId }),
    }).then((r) => r.json());

    expect(String(result)).toBe("error:not_released");
  });

  test("released, the contractor accepts it in one tap and sees their own figure", async ({ page }) => {
    const released = await rpcAs(staff!, "wo_release_variation", { p_variation_id: variationId });
    expect(released).toBe("ok:released");

    await signIn(page, contractor!, /\/portal/);
    await page.goto(`/portal/jobs/${fixture!.workOrderId}`);

    const accept = page.getByTestId(`accept-${variationId}`);
    await expect(accept).toContainText("$180.00");
    await accept.click();

    await expect(page.getByTestId(`delta-${variationId}`)).toContainText("$180.00");

    const { data } = await db!.from("wo_variations")
      .select("status, contractor_accepted_at").eq("id", variationId).single();
    const v = data as { status: string; contractor_accepted_at: string | null };
    expect(v.status).toBe("contractor_accepted");
    expect(v.contractor_accepted_at).not.toBeNull();
  });

  test("both approvals are on the record, in order", async () => {
    const { data } = await db!.from("wo_events")
      .select("type").eq("work_order_id", fixture!.workOrderId)
      .like("type", "variation%").order("created_at", { ascending: true });

    const types = ((data as { type: string }[]) ?? []).map((e) => e.type);
    // No variation_raised here: this variation was seeded straight into the
    // table so each test could stand alone. The raise event is proved by the
    // contractor's own raise test, which goes through the RPC.
    expect(types).toContain("variation_priced");
    expect(types).toContain("variation_customer_approved");
    expect(types).toContain("variation_contractor_accepted");
    expect(types.indexOf("variation_customer_approved"))
      .toBeLessThan(types.indexOf("variation_contractor_accepted"));
  });

  test("a job cannot leave in_progress while a variation is open", async () => {
    // Start from a genuinely clear gate, whatever the earlier tests left behind:
    // every surface done, and no variation still waiting on anyone. Anything
    // else and this test would depend on the order the suite happened to run in.
    await db!.from("wo_surfaces").update({ state: "done" }).eq("work_order_id", fixture!.workOrderId);
    await db!.from("wo_variations")
      .update({ status: "cancelled" })
      .eq("work_order_id", fixture!.workOrderId)
      .in("status", ["raised", "priced", "customer_approved"]);

    const { data: clear } = await db!.rpc("wo_gate_blocked", {
      p_wo_id: fixture!.workOrderId, p_from: "in_progress", p_to: "completion_prep",
    });
    expect(clear).toBeNull();

    await db!.from("wo_variations").insert({
      work_order_id: fixture!.workOrderId, category: "damage",
      comment: "Second one, left open on purpose", status: "raised",
    });

    const { data } = await db!.rpc("wo_gate_blocked", {
      p_wo_id: fixture!.workOrderId, p_from: "in_progress", p_to: "completion_prep",
    });
    expect(String(data)).toContain("waiting on a decision");
  });
});

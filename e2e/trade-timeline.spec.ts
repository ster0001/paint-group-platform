import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { serviceClient } from "./fixtures/woLoop";
import { TINY_SIGNATURE_PNG } from "./helpers";

/**
 * Trade portal v2 · Session 4 — the shared timeline through the trade route,
 * as a real trade VIEWER with a narrowed property_scope:
 *  · an in-scope property's job shows the day-by-day feed with photos, the
 *    PC-approved daily update, and the trade-only "Colours confirmed" event;
 *  · a same-org property OUTSIDE the viewer's scope is a 404 — as is a
 *    mismatched property/job pair.
 */

const db: SupabaseClient | null = serviceClient();
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;

test.describe("trade timeline (trade portal v2, session 4)", () => {
  test.skip(!db || !url, "needs SUPABASE_SERVICE_ROLE_KEY + supabase env");

  const run = randomBytes(4).toString("hex");
  const password = "painttest123";
  const viewerEmail = `pg.e2e.tt.viewer.${run}@example.com`;
  let userId = "";
  let accountId = "";
  let propA = "";
  let propB = "";
  let woA = "";
  let woB = "";
  const estimateIds: string[] = [];
  const photoPaths: string[] = [];

  test.beforeAll(async () => {
    const sb = db!;
    const u = await sb.auth.admin.createUser({ email: viewerEmail, password, email_confirm: true });
    if (u.error || !u.data.user) throw new Error(`createUser: ${u.error?.message}`);
    userId = u.data.user.id;
    const a = await sb.from("accounts").insert({
      email: viewerEmail, name: "TT e2e Org", account_type: "trade", org_kind: "real_estate",
    }).select("id").single();
    if (a.error) throw new Error(a.error.message);
    accountId = a.data.id;

    const mkProp = async (address: string) => {
      const p = await sb.from("properties").insert({
        account_id: accountId, address, suburb: "Elwood", postcode: "3184",
        address_norm: `${address.toLowerCase()} elwood 3184 ${run}`,
      }).select("id").single();
      if (p.error) throw new Error(p.error.message);
      return p.data.id as string;
    };
    propA = await mkProp("14 Beaumont St");
    propB = await mkProp("9 Mitford St");

    // The viewer sees ONLY property A.
    const m = await sb.from("account_users").insert({
      account_id: accountId, profile_id: userId, role: "viewer", property_scope: [propA],
    });
    if (m.error) throw new Error(m.error.message);

    const mkJob = async (propertyId: string, title: string) => {
      const est = await sb.from("estimates").insert({
        title, status: "accepted", source: "manual", level_of_finish: 3,
        account_id: accountId, property_id: propertyId, builder_state: {},
      }).select("id").single();
      if (est.error) throw new Error(est.error.message);
      estimateIds.push(est.data.id);
      const wo = await sb.from("work_orders").insert({
        estimate_id: est.data.id, wo_ref: `TT-${run.slice(0, 4)}${propertyId === propA ? "A" : "B"}`,
        share_token: `tt${propertyId.slice(0, 6)}${run}${Date.now()}`,
        stage: "in_progress", status: "in_progress", issued_at: new Date().toISOString(),
        start_date: new Date().toISOString().slice(0, 10),
        wo_snapshot: { jobTitle: title, areas: [], materials: [] }, colours: {},
      }).select("id").single();
      if (wo.error) throw new Error(wo.error.message);
      return wo.data.id as string;
    };
    woA = await mkJob(propA, `TT e2e job A ${run}`);
    woB = await mkJob(propB, `TT e2e job B ${run}`);

    // Property A's job: surfaces, a SENT daily update, a progress photo, and
    // the colours question answered YES (the trade-only event).
    const surf = await sb.from("wo_surfaces").insert([
      { work_order_id: woA, heading: "Living room", heading_meta: "", label: "Walls", surface_key: "s0", sort: 0, state: "done", state_changed_at: new Date().toISOString() },
      { work_order_id: woA, heading: "Living room", heading_meta: "", label: "Ceiling", surface_key: "s1", sort: 1, state: "todo" },
    ]);
    if (surf.error) throw new Error(surf.error.message);

    const upd = await sb.from("wo_updates").insert({
      work_order_id: woA, for_date: new Date().toISOString().slice(0, 10),
      draft_text: "First coat is on in the living room.", final_text: "First coat is on in the living room.",
      status: "sent", sent_at: new Date().toISOString(),
    });
    if (upd.error) throw new Error(upd.error.message);

    const png = Buffer.from(TINY_SIGNATURE_PNG.split(",")[1], "base64");
    const path = `e2e-tt/${run}/progress.png`;
    const up = await sb.storage.from("wo-photos").upload(path, png, { contentType: "image/png" });
    if (up.error) throw new Error(up.error.message);
    photoPaths.push(path);
    const ph = await sb.from("wo_photos").insert({
      work_order_id: woA, kind: "progress", area: "Living room", caption: "First coat", storage_path: path,
    });
    if (ph.error) throw new Error(ph.error.message);

    const chk = await sb.from("wo_checklist_items").insert({
      work_order_id: woA, phase: "pre_start", label: "Colour schedule finalised",
      detail: "", required: true, sort: 1, kind: "yes_no", item_key: "colours",
      answer: "yes", done_at: new Date().toISOString(),
    });
    if (chk.error) throw new Error(chk.error.message);
  });

  test.afterAll(async () => {
    const sb = db!;
    for (const wo of [woA, woB].filter(Boolean)) {
      await sb.from("wo_photos").delete().eq("work_order_id", wo);
      await sb.from("wo_updates").delete().eq("work_order_id", wo);
      await sb.from("wo_surfaces").delete().eq("work_order_id", wo);
      await sb.from("wo_checklist_items").delete().eq("work_order_id", wo);
      await sb.from("work_orders").delete().eq("id", wo);
    }
    if (photoPaths.length) await sb.storage.from("wo-photos").remove(photoPaths);
    for (const e of estimateIds) await sb.from("estimates").delete().eq("id", e);
    for (const p of [propA, propB].filter(Boolean)) {
      await sb.from("properties").delete().eq("id", p);
    }
    if (accountId) {
      await sb.from("account_users").delete().eq("account_id", accountId);
      await sb.from("accounts").delete().eq("id", accountId);
    }
    if (userId) await sb.auth.admin.deleteUser(userId);
  });

  test("a scoped viewer sees the shared feed — photos, the PC-approved update, the trade events", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/login");
    await page.fill('input[type="email"]', viewerEmail);
    await page.fill('input[type="password"]', password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/account/);

    await page.goto(`/account/properties/${propA}/jobs/${woA}`);
    await expect(page.getByRole("heading", { name: "Your project, day by day" })).toBeVisible();
    await expect(page.getByText("First coat is on in the living room.")).toBeVisible();
    await expect(page.getByText("CHECKED AND SENT BY THE OFFICE")).toBeVisible();
    await expect(page.getByText("Colours confirmed & paint ordered")).toBeVisible();
    await expect(page.locator(".tl img").first()).toBeVisible(); // signed rendition, never an original
    await expect(page.getByText("‹ 14 Beaumont St, Elwood")).toBeVisible();
  });

  test("out of scope is a 404: the same org's other property, and a mismatched pair", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/login");
    await page.fill('input[type="email"]', viewerEmail);
    await page.fill('input[type="password"]', password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/account/);

    const outOfScope = await page.goto(`/account/properties/${propB}/jobs/${woB}`);
    expect(outOfScope?.status()).toBe(404);

    const mismatched = await page.goto(`/account/properties/${propA}/jobs/${woB}`);
    expect(mismatched?.status()).toBe(404);
  });
});

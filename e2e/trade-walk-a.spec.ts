/**
 * C15 · walk A — the agent, end to end, on the TEST stack.
 *
 *   1. A staff member fixes a price on a trade quote → the measured tree
 *      lands on THAT property (`properties.measured_tree`, versioned).
 *   2. The agent's home shows "Waiting on us" (ready to accept) and the
 *      measured property; New quote on it shows the file and a range BEFORE
 *      the sheet is opened; "Open the sheet" creates the quote through the
 *      one submit route, seeded from the file — nothing re-typed.
 *   3. The sheet: a cell tap moves the range; no fix-online anywhere; "Send
 *      for confirmation" puts it in the estimator's queue and on the home.
 *   4. The tenant link: sent from the sheet, opened with no account on a
 *      phone, one photo lands on the estimate as a defect photo.
 *
 * Desktop at 1280 and phone at 430 (brief: both compositions checked).
 */
import { test, expect, type Browser } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { credentials, signIn } from "./helpers";
import { serviceClient } from "./fixtures/woLoop";
import { assertNoPasswordField, deleteUserByEmail, magicLinkFor } from "./fixtures/portal";
import { defaultWizardState } from "../lib/wizard/state";

const db: SupabaseClient | null = serviceClient();
const staff = credentials("STAFF");
const run = randomBytes(4).toString("hex");
const DESKTOP = { width: 1280, height: 900 };
const PHONE = { width: 430, height: 900 };

const surf = (id: number, code: string, count = 1, coats = 2) => ({
  id, code, internalLabel: code, clientLabel: code, count, coats,
  prepHr: 0, crewNote: "", origin: "human_confirmed", confidence: 1, assumedFields: [],
});
const room = (id: number, name: string, L: number, W: number, surfaces: unknown[]) => ({
  id, kind: "area", name, type: "Interior", areaType: "room", roomType: name.startsWith("Bed") ? "bedroom" : "living",
  L, W, H: 2.4, isOption: false, description: "", open: false, media: [],
  origin: "human_confirmed", confidence: 1, assumedFields: [], extractionSourceId: null, surfaces,
});
// Four rooms: two priced below the public floor ($2,000, `wizard_policy.minJobCents`)
// and the submit answers "minimum call-out" with no estimate id — see the parking lot.
const BLOCKS = [
  room(1, "Bed 1", 3.5, 3.2, [surf(10, "Walls"), surf(11, "Ceilings"), surf(12, "Skirting Boards"), surf(13, "Flat Door and Frame (1 Side)"), surf(14, "Awning / Casement Window")]),
  room(2, "Bed 2", 3.6, 3.0, [surf(15, "Walls"), surf(16, "Ceilings"), surf(17, "Skirting Boards"), surf(18, "Flat Door and Frame (1 Side)"), surf(19, "Awning / Casement Window")]),
  room(3, "Living", 6.0, 4.5, [surf(20, "Walls"), surf(21, "Ceilings"), surf(22, "Skirting Boards"), surf(23, "Flat Door and Frame (1 Side)"), surf(24, "Awning / Casement Window", 2)]),
  room(4, "Hall", 5.0, 1.2, [surf(25, "Walls"), surf(26, "Ceilings"), surf(27, "Skirting Boards"), surf(28, "Flat Door and Frame (1 Side)", 4)]),
];

test.describe("C15 walk A — the agent", () => {
  test.skip(!db || !staff, "needs SUPABASE_SERVICE_ROLE_KEY + E2E_STAFF_* creds");

  const member = `pg.e2e.c15a.${run}@example.com`;
  let accountId = "";
  let propertyId = "";
  let seedEstimateId = "";
  let requestId = "";
  const estimateIds: string[] = [];

  test.beforeAll(async () => {
    const sb = db!;
    const created = await sb.auth.admin.createUser({ email: member, email_confirm: true });
    if (created.error || !created.data.user) throw new Error(`createUser: ${created.error?.message}`);
    const a = await sb.from("accounts").insert({ email: member, name: `C15 e2e Agency ${run}`, account_type: "trade", org_kind: "real_estate" }).select("id").single();
    if (a.error) throw new Error(a.error.message);
    accountId = a.data.id;
    const p = await sb.from("properties").insert({
      account_id: accountId, address: "4/22 Elm Grove", suburb: "Thornbury", state: "VIC", postcode: "3071",
      address_norm: `4/22 elm grove thornbury 3071 ${run}`, access_notes: "Key box 4821 · no lift",
    }).select("id").single();
    if (p.error) throw new Error(p.error.message);
    propertyId = p.data.id;
    const m = await sb.from("account_users").insert({ account_id: accountId, profile_id: created.data.user.id, role: "admin" });
    if (m.error) throw new Error(m.error.message);

    // The quote the estimator fixes: a customer-mode trade quote on the property.
    const state = defaultWizardState();
    state.mode = "customer"; state.noPlan = true; state.propertyId = propertyId;
    state.basics = { bedrooms: 2, storeys: "single", sizeBand: "s120_200", openPlanKitchenLiving: false };
    const est = await sb.from("estimates").insert({
      title: `4/22 Elm Grove (C15 ${run})`, status: "draft", source: "customer_intake", total_cents: 342_000,
      account_id: accountId, property_id: propertyId,
      builder_state: { blocks: BLOCKS, aiDeferred: [], modSel: {}, materials: {}, wizard: { state, builtAt: new Date().toISOString(), builtBy: "e2e" } },
    }).select("id").single();
    if (est.error) throw new Error(est.error.message);
    seedEstimateId = est.data.id; estimateIds.push(seedEstimateId);
    const cr = await sb.from("confirmation_requests").insert({
      estimate_id: seedEstimateId, requested_by: "customer", kind: "remote", status: "requested",
      suggested_action: "fix", pack: { totalCents: 342_000 },
    }).select("id").single();
    if (cr.error) throw new Error(cr.error.message);
    requestId = cr.data.id;
  });

  test.afterAll(async () => {
    const sb = db!;
    if (!accountId) return;
    const { data: ests } = await sb.from("estimates").select("id").eq("account_id", accountId);
    const ids = [...new Set([...(ests ?? []).map((e) => e.id as string), ...estimateIds])];
    if (ids.length) {
      const { data: srcs } = await sb.from("estimate_sources").select("id, storage_path").in("estimate_id", ids);
      const paths = (srcs ?? []).map((s) => s.storage_path as string).filter(Boolean);
      if (paths.length) await sb.storage.from("estimate-sources").remove(paths).catch(() => undefined);
      await sb.from("estimate_sources").delete().in("estimate_id", ids);
      await sb.from("tenant_photo_links").delete().in("estimate_id", ids);
      await sb.from("wizard_leads").delete().in("estimate_id", ids);
      await sb.from("estimates").delete().in("id", ids);
    }
    await sb.from("tenant_photo_links").delete().eq("account_id", accountId);
    await sb.from("trade_specs").delete().eq("account_id", accountId);
    await sb.from("properties").delete().eq("account_id", accountId);
    await sb.from("account_users").delete().eq("account_id", accountId);
    await sb.from("accounts").delete().eq("id", accountId);
    await deleteUserByEmail(sb, member);
  });

  async function memberPage(browser: Browser, viewport: { width: number; height: number }) {
    const ctx = await browser.newContext({ viewport });
    const page = await ctx.newPage();
    await page.goto(await magicLinkFor(db!, member));
    await expect(page).toHaveURL(/\/account/, { timeout: 20_000 });
    await assertNoPasswordField(page);
    return { ctx, page };
  }

  test("fix a price as staff → the tree lands on the property; the agent quotes again from the file, sheet, send, tenant photos", async ({ browser }) => {
    test.setTimeout(300_000);
    const sb = db!;

    // ---- 1 · staff fixes the price ----------------------------------------
    {
      const ctx = await browser.newContext({ viewport: DESKTOP });
      const page = await ctx.newPage();
      await signIn(page, staff!, /estimates|today|quote/);
      const res = await page.request.post(`/api/confirmations/${requestId}`, { data: { action: "fix_price" } });
      expect(res.ok(), await res.text()).toBe(true);
      await ctx.close();
    }
    const { data: prop } = await sb.from("properties").select("measured_tree, measured_at").eq("id", propertyId).single();
    const tree = prop!.measured_tree as { version?: number; blocks?: Array<{ name: string }>; estimateId?: string } | null;
    expect(tree?.version, "the versioned tree is written to the estimate's property").toBe(1);
    expect(tree?.estimateId).toBe(seedEstimateId);
    expect(tree?.blocks?.map((b) => b.name)).toEqual(["Bed 1", "Bed 2", "Living", "Hall"]);
    expect(prop!.measured_at).toBeTruthy();

    // ---- 2 · the agent, desktop: home → new quote from the file ------------
    const { ctx: dctx, page } = await memberPage(browser, DESKTOP);
    await page.goto("/account");
    await expect(page.getByTestId("waiting-on-us")).toBeVisible();
    await expect(page.getByTestId("waiting-ready").first()).toContainText("Elm Grove");
    await expect(page.getByTestId("new-quote")).toBeVisible();
    await page.getByTestId("rebook-measured").first().click();
    await expect(page).toHaveURL(new RegExp(`/account/quote/new\\?property=${propertyId}`));
    await expect(page.getByTestId("property-file")).toContainText("On file");
    await expect(page.getByTestId("file-areas")).toContainText("4 areas");
    await expect(page.getByTestId("file-range")).toContainText("$");
    await expect(page.getByTestId("estimated-from-file")).toContainText("before you open the sheet");
    expect(await page.getByText(/Fix my price/i).count(), "trade never sees fix-online").toBe(0);

    await page.getByTestId("open-sheet").click();
    await expect(page).toHaveURL(/\/account\/quote\/[0-9a-f-]{36}\/sheet/, { timeout: 60_000 });
    const sheetUrl = page.url();
    const newId = sheetUrl.match(/quote\/([0-9a-f-]{36})\/sheet/)![1];
    estimateIds.push(newId);

    // Seeded from the file: same rooms, same sizes, linked to the property.
    const { data: made } = await sb.from("estimates").select("property_id, account_id, builder_state").eq("id", newId).single();
    expect(made!.property_id).toBe(propertyId);
    expect(made!.account_id).toBe(accountId);
    const seededNames = ((made!.builder_state as { blocks: Array<{ name: string; kind: string }> }).blocks).filter((b) => b.kind === "area").map((b) => b.name);
    expect(seededNames).toEqual(["Bed 1", "Bed 2", "Living", "Hall"]);

    // ---- 3 · the sheet ----------------------------------------------------
    await expect(page.getByTestId("sheet-row")).toHaveCount(4);
    await expect(page.getByTestId("sheet-row").first()).toContainText("3.5 × 3.2");
    await expect(page.getByTestId("range-figure")).toContainText("$");
    const before = (await page.getByTestId("range-figure").textContent()) ?? "";
    const wallsCell = page.getByTestId("sheet-row").first().getByTestId("cell-walls");
    await expect(wallsCell).toHaveAttribute("data-on", "1");
    await wallsCell.click(); // 2c → not painted
    await expect(wallsCell).toHaveAttribute("data-on", "0", { timeout: 20_000 });
    await expect(page.getByTestId("range-figure")).not.toHaveText(before, { timeout: 20_000 });
    expect(await page.getByText(/Fix my price/i).count()).toBe(0);
    await expect(page.getByTestId("sheet-colours")).toBeVisible();
    await expect(page.getByTestId("sheet-on-file")).toContainText("Key box 4821");

    await page.getByTestId("send-for-confirmation").click();
    await expect(page).toHaveURL(/\/account$/, { timeout: 30_000 });
    await expect(page.getByTestId("waiting-with_us").first()).toContainText("Elm Grove");
    const { data: reqs } = await sb.from("confirmation_requests").select("kind, status").eq("estimate_id", newId);
    expect(reqs).toHaveLength(1);
    expect(reqs![0].kind).toBe("remote");
    expect(reqs![0].status).toBe("requested");
    await dctx.close();

    // ---- 4 · phone: the sheet scrolls sideways; ask the tenant --------------
    const { ctx: pctx, page: phone } = await memberPage(browser, PHONE);
    await phone.goto(sheetUrl);
    const grid = phone.getByTestId("spec-sheet");
    await expect(grid).toBeVisible();
    expect(await grid.evaluate((el) => el.scrollWidth > el.clientWidth), "⚑59: the grid scrolls horizontally on a phone").toBe(true);
    await expect(phone.getByTestId("sheet-sent")).toBeVisible();
    await phone.getByTestId("ask-tenant").click();
    await expect(phone).toHaveURL(/\/tenant$/);
    await phone.getByTestId("send-tenant-link").click();
    await expect(phone.getByTestId("tenant-link-sent")).toBeVisible({ timeout: 20_000 });
    await expect(phone.getByTestId("tenant-message")).toContainText("nothing to do with your bond");
    const url = (await phone.getByTestId("tenant-link-url").textContent()) ?? "";
    const tokenPath = url.match(/\/photos\/[A-Za-z0-9_-]+/)?.[0];
    expect(tokenPath, url).toBeTruthy();
    await pctx.close();

    // ---- the tenant: no account, a phone, one photo --------------------------
    const tctx = await browser.newContext({ viewport: PHONE });
    const tenant = await tctx.newPage();
    await tenant.goto(tokenPath!);
    await expect(tenant.getByTestId("tenant-page")).toBeVisible();
    await expect(tenant.getByText(/nothing to do with your bond/)).toBeVisible();
    await tenant.getByTestId("tenant-file").setInputFiles(path.join(__dirname, "fixtures", "condition-photo.png"));
    await expect(tenant.getByTestId("tenant-count")).toContainText("1 photo", { timeout: 30_000 });
    await tctx.close();

    const { data: photos } = await sb.from("estimate_sources").select("kind").eq("estimate_id", newId);
    expect(photos?.map((p) => p.kind)).toEqual(["defect_photo"]);
    const { data: link } = await sb.from("tenant_photo_links").select("status, uploaded_photo_ids").eq("estimate_id", newId).single();
    expect(link!.status).toBe("photos_received");
    expect((link!.uploaded_photo_ids as string[]).length).toBe(1);
  });
});

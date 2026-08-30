import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { serviceClient } from "./fixtures/woLoop";

/**
 * Trade portal v2 · Session 3 — the Portfolio and Property screens, driven
 * as a REAL trade login (brief §7 row 3):
 *  · portfolio: pulse tiles, needs-you, property card with reference line +
 *    swatch strip + progress bar;
 *  · derivation: a surface tick and a new colour record change the card on
 *    reload — the strip and bar read data, never a typed status;
 *  · property screen: four tabs, colour cards with the lossy label, money
 *    from the invoicing rows, About Paint Group; out-of-scope id → 404;
 *  · org_kind personas: facilities shows Site/PO labels.
 */

const db: SupabaseClient | null = serviceClient();
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;

test.describe("trade portfolio (trade portal v2, session 3)", () => {
  test.skip(!db || !url, "needs SUPABASE_SERVICE_ROLE_KEY + supabase env");

  const run = randomBytes(4).toString("hex");
  const password = "painttest123";
  const agencyEmail = `pg.e2e.tp.agency.${run}@example.com`;
  const facilitiesEmail = `pg.e2e.tp.fm.${run}@example.com`;
  const userIds: string[] = [];
  const accountIds: string[] = [];
  let propA = ""; // active job + colours
  let propB = ""; // quiet property
  let propFm = ""; // facilities org's site
  let activeWoId = "";
  let surfaceIds: string[] = [];
  const estimateIds: string[] = [];
  let migrationReady = true;

  test.beforeAll(async () => {
    const sb = db!;
    const probe = await sb.from("colour_records").select("id").limit(1);
    if (probe.error) { migrationReady = false; return; }

    const mkUserOrg = async (email: string, name: string, orgKind: string) => {
      const u = await sb.auth.admin.createUser({ email, password, email_confirm: true });
      if (u.error || !u.data.user) throw new Error(`createUser: ${u.error?.message}`);
      userIds.push(u.data.user.id);
      const a = await sb.from("accounts").insert({ email, name, account_type: "trade", org_kind: orgKind }).select("id").single();
      if (a.error) throw new Error(a.error.message);
      accountIds.push(a.data.id);
      const m = await sb.from("account_users").insert({ account_id: a.data.id, profile_id: u.data.user.id, role: "admin" });
      if (m.error) throw new Error(m.error.message);
      return a.data.id as string;
    };
    const mkProp = async (account: string, address: string, refs: Array<[string, string]>) => {
      const p = await sb.from("properties").insert({
        account_id: account, address, suburb: "Elwood", postcode: "3184",
        address_norm: `${address.toLowerCase()} elwood 3184 ${run}`,
      }).select("id").single();
      if (p.error) throw new Error(p.error.message);
      if (refs.length) {
        const r = await sb.from("property_references").insert(refs.map(([label, value], i) => ({
          property_id: p.data.id, label, value, sort: i,
        })));
        if (r.error) throw new Error(r.error.message);
      }
      return p.data.id as string;
    };

    const agency = await mkUserOrg(agencyEmail, "TP e2e Agency", "real_estate");
    const fm = await mkUserOrg(facilitiesEmail, "TP e2e Facilities", "facilities");

    propA = await mkProp(agency, "14 Beaumont St", [["Owner", "T. & M. Nguyen"]]);
    propB = await mkProp(agency, "28 Broadway", []);
    propFm = await mkProp(fm, "Elwood Village Block B", [["Site", "Block B"], ["PO", "BAC-2026-0712"]]);

    // Active job at propA: WO in progress, 1 of 4 surfaces done.
    const est = await sb.from("estimates").insert({
      title: `TP e2e job ${run}`, status: "accepted", source: "manual", level_of_finish: 3,
      account_id: agency, property_id: propA, total_cents: 693000, builder_state: {},
    }).select("id").single();
    if (est.error) throw new Error(est.error.message);
    estimateIds.push(est.data.id);
    const wo = await sb.from("work_orders").insert({
      estimate_id: est.data.id, wo_ref: `PG-E2E${run.slice(0, 3)}`, share_token: `tp${run}${Date.now()}`,
      stage: "in_progress", status: "in_progress", issued_at: new Date().toISOString(),
      start_date: new Date().toISOString().slice(0, 10),
      wo_snapshot: { jobTitle: "TP e2e job", areas: [], materials: [] }, colours: {},
    }).select("id").single();
    if (wo.error) throw new Error(wo.error.message);
    activeWoId = wo.data.id;
    const surf = await sb.from("wo_surfaces").insert([0, 1, 2, 3].map((i) => ({
      work_order_id: activeWoId, heading: "Living room", heading_meta: "", label: `Surface ${i}`,
      surface_key: `s${i}`, sort: i, state: i === 0 ? "done" : "todo",
      state_changed_at: i === 0 ? new Date().toISOString() : null,
    }))).select("id");
    if (surf.error) throw new Error(surf.error.message);
    surfaceIds = (surf.data as Array<{ id: string }>).map((r) => r.id);

    // One applied colour (lossy) at propA; facilities site gets one too.
    for (const [prop, lossy] of [[propA, true], [propFm, false]] as const) {
      const c = await sb.from("colour_records").insert({
        property_id: prop, area_label: "Walls — all rooms", surface_type: "wall",
        brand: "Dulux", product: "Wash & Wear Low Sheen", colour_name: "Natural White",
        sheen: "low sheen", coats: 2, swatch_hex: "#f1ede4", status: "applied",
        source: "historical_import", colour_attribution_lossy: lossy,
      });
      if (c.error) throw new Error(c.error.message);
    }
  });

  test.afterAll(async () => {
    const sb = db!;
    for (const prop of [propA, propB, propFm].filter(Boolean)) {
      await sb.from("colour_records").delete().eq("property_id", prop);
      await sb.from("property_references").delete().eq("property_id", prop);
    }
    if (activeWoId) {
      await sb.from("wo_surfaces").delete().eq("work_order_id", activeWoId);
      await sb.from("work_orders").delete().eq("id", activeWoId);
    }
    for (const e of estimateIds) await sb.from("estimates").delete().eq("id", e);
    for (const p of [propA, propB, propFm].filter(Boolean)) await sb.from("properties").delete().eq("id", p);
    for (const a of accountIds) {
      await sb.from("account_users").delete().eq("account_id", a);
      await sb.from("accounts").delete().eq("id", a);
    }
    for (const u of userIds) await sb.auth.admin.deleteUser(u);
  });

  async function login(page: import("@playwright/test").Page, email: string) {
    await page.goto("/login");
    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/account/);
  }

  test("portfolio: tiles, reference line, swatch strip — and both derive from data on reload", async ({ page }) => {
    test.skip(!migrationReady, "run migrations 20261213/20261214 first");
    test.setTimeout(120_000);
    const sb = db!;
    await login(page, agencyEmail);

    // The pulse counts the active job; the card carries the Owner reference.
    await expect(page.getByTestId("pulse-onsite")).toContainText("1");
    const cardA = page.getByTestId(`prop-${propA}`);
    await expect(cardA).toContainText("14 Beaumont St");
    await expect(cardA).toContainText("Owner · T. & M. Nguyen");
    await expect(cardA).toContainText("1 of 4 surfaces done");
    const swatches = cardA.getByTestId(`swatches-${propA}`).locator("i");
    await expect(swatches).toHaveCount(1);

    // Derivation, not typed status: tick a surface + add a colour record
    // server-side, reload, and the bar and strip both move.
    await sb.from("wo_surfaces").update({ state: "done", state_changed_at: new Date().toISOString() }).eq("id", surfaceIds[1]);
    await sb.from("colour_records").insert({
      property_id: propA, area_label: "Front door", surface_type: "door",
      brand: "Dulux", product: "Weathershield", colour_name: "Domino",
      sheen: "gloss", coats: 2, swatch_hex: "#2a2e33", status: "applied",
      source: "staff_edit",
    });
    await page.reload();
    await expect(cardA).toContainText("2 of 4 surfaces done");
    await expect(cardA.getByTestId(`swatches-${propA}`).locator("i")).toHaveCount(2);

    // Search narrows by reference value.
    await page.getByTestId("portfolio-search").fill("nguyen");
    await expect(page.getByTestId(`prop-${propA}`)).toBeVisible();
    await expect(page.getByTestId(`prop-${propB}`)).toHaveCount(0);
  });

  test("property screen: four tabs, colour card + lossy note, money and documents panes", async ({ page }) => {
    test.skip(!migrationReady, "run migrations 20261213/20261214 first");
    test.setTimeout(120_000);
    await login(page, agencyEmail);
    await page.goto(`/account/properties/${propA}`);

    await expect(page.getByRole("heading", { name: /14 Beaumont St/ })).toBeVisible();
    await expect(page.getByTestId("ref-owner")).toContainText("T. & M. Nguyen");
    await expect(page.getByTestId("current-job")).toContainText("Surfaces done");

    await page.getByTestId("ptab-colours").click();
    await expect(page.getByText("Natural White")).toBeVisible();
    await expect(page.getByTestId("lossy-note")).toContainText("may not show every room");

    await page.getByTestId("ptab-money").click();
    await expect(page.getByTestId("pane-money")).toContainText("This job, inc GST");

    await page.getByTestId("ptab-documents").click();
    await expect(page.getByTestId("about-paint-group")).toBeVisible();
  });

  test("volume org: the 40-property portfolio renders inside the budget", async ({ page }) => {
    test.skip(!migrationReady, "run migrations 20261213/20261214 first");
    test.setTimeout(120_000);
    const { data } = await db!.from("accounts").select("id").eq("email", "pg.demo.volume@example.com").maybeSingle();
    test.skip(!data, "run scripts/portal/seed-trade-demo.mjs first");

    await login(page, "pg.demo.volume@example.com");
    await page.goto("/account", { waitUntil: "domcontentloaded" }); // warm
    const t0 = Date.now();
    await page.goto("/account", { waitUntil: "domcontentloaded" });
    const ms = Date.now() - t0;
    await expect(page.getByTestId("portfolio-search")).toBeVisible();
    console.log(`[volume] 40-property portfolio: ${ms}ms (target 1500)`);
    // Report always; the strict budget bites under VOLUME_GATE_STRICT (the
    // 3a-8 pattern — CI runners sit far from Sydney).
    expect(ms).toBeLessThan(process.env.VOLUME_GATE_STRICT ? 1500 : 6000);
  });

  test("an out-of-scope property id is a 404 — and the other org's labels follow its kind", async ({ page }) => {
    test.skip(!migrationReady, "run migrations 20261213/20261214 first");
    test.setTimeout(120_000);
    await login(page, facilitiesEmail);

    // Facilities persona: the reference line reads Site / PO.
    const fmCard = page.getByTestId(`prop-${propFm}`);
    await expect(fmCard).toContainText("Site · Block B");
    await expect(fmCard).toContainText("PO · BAC-2026-0712");

    // The agency's property does not resolve for this org.
    const res = await page.goto(`/account/properties/${propA}`);
    expect(res?.status()).toBe(404);
  });
});

import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn, userIdFor } from "./helpers";
import { serviceClient } from "./fixtures/woLoop";

/**
 * Home dashboard v2 · session 5 — P&L + Marketing (brief Part D, session 5
 * e2e): the OWNER sees both sections with the "Settings basis until MYOB"
 * chip; a big acceptance this month puts an "Amber · trend" anomaly card in
 * the strip; and every P&L / marketing metric is 403 for pc, sales AND
 * finance logins (⚑2, server-side). Cleaned up in afterAll.
 */
const staff = credentials("STAFF");
const db: SupabaseClient | null = serviceClient();
const home = /\/(home|estimates|pc|crm|contacts|invoic|settings|proving|contractors)/;

test.describe("dashboard · session 5 · P&L + marketing, owner only", () => {
  test.skip(!staff || !db, missingCreds("STAFF") + " + service key");
  test.use({ viewport: { width: 1280, height: 900 } });
  const run = randomBytes(3).toString("hex");
  const password = "painttest123";
  const others = (["pc", "sales", "finance"] as const).map((role) => ({ role, email: `pg.e2e.${role}5.${run}@example.com`, id: "" }));
  let masterId = ""; let masterWasOwner = false; let estimateId = "";

  test.beforeAll(async () => {
    masterId = (await userIdFor(staff!)) ?? "";
    if (!masterId) throw new Error("e2e staff login not found");
    const { data, error } = await db!.from("profiles").select("is_owner").eq("id", masterId).single();
    if (error) throw new Error(error.message);
    masterWasOwner = data?.is_owner === true;
    if (!masterWasOwner) await db!.from("profiles").update({ is_owner: true }).eq("id", masterId);
    for (const o of others) {
      const made = await db!.auth.admin.createUser({ email: o.email, password, email_confirm: true });
      if (made.error) throw new Error(made.error.message);
      o.id = made.data.user!.id;
      const prof = await db!.from("profiles").upsert({ id: o.id, role: "staff", name: `${o.role} ${run}`, is_owner: false, staff_access: {}, staff_roles: [o.role] }, { onConflict: "id" });
      if (prof.error) throw new Error(prof.error.message);
    }
    // An acceptance this month big enough that Contracts signed is ≥ 25% up on the comparison window.
    const est = await db!.from("estimates").insert({
      status: "accepted", source: "manual", level_of_finish: 3, title: `Anomaly ${run}`, accepted_name: `Owner ${run}`, accepted_at: new Date().toISOString(), sent_at: new Date().toISOString(),
      lead_source: "referral", total_cents: 900_000_000, subtotal_cents: 818_181_818, accepted_total_cents: 900_000_000, builder_state: { blocks: [] }, share_token: `s5${randomBytes(18).toString("base64url")}`,
    }).select("id").single();
    if (est.error) throw new Error(est.error.message);
    estimateId = est.data.id as string;
  });
  test.afterAll(async () => {
    if (!db) return;
    if (estimateId) await db.from("estimates").delete().eq("id", estimateId);
    for (const o of others) if (o.id) await db.auth.admin.deleteUser(o.id);
    if (masterId && !masterWasOwner) await db.from("profiles").update({ is_owner: false }).eq("id", masterId);
  });

  test("the owner sees P&L and Marketing on the Settings basis, and the anomaly card in the strip", async ({ page }) => {
    test.setTimeout(150_000);
    await signIn(page, staff!, home);
    await page.goto("/home?preset=month");
    await expect(page.getByTestId("home")).toBeVisible({ timeout: 45_000 });
    await expect(page.getByTestId("section-pl")).toBeVisible();
    await expect(page.getByTestId("section-marketing")).toBeVisible();
    await expect(page.getByTestId("switches-on-pl")).toHaveCount(0);
    await expect(page.getByTestId("switches-on-marketing")).toHaveCount(0);

    // Contracts signed is ex GST: the fixture's $9m inc appears as ≥ $8,181,818 ex.
    const signed = Number(((await page.getByTestId("tile-value-pl.contracts_signed_ex").textContent()) ?? "").replace(/[^\d]/g, ""));
    expect(signed).toBeGreaterThanOrEqual(8_181_818);
    await expect(page.getByTestId("tile-note-pl.contracts_signed_ex")).toContainText("Settings basis until MYOB");
    await page.getByTestId("tile-pl.contracts_signed_ex").click();
    await expect(page.getByTestId("drill-pl.contracts_signed_ex").locator("tr", { hasText: `Anomaly ${run}` })).toContainText("$8,181,818");
    await page.getByTestId("tile-pl.contracts_signed_ex").click();

    // Net margin is a rows card whose first line is the gross margin; the basis is written on every line.
    await expect(page.getByTestId("rows-pl.net_margin_ex")).toBeVisible();
    await expect(page.getByTestId("row-pl.net_margin_ex-0")).toContainText("Gross margin on signed-off jobs");
    await expect(page.getByTestId("rows-mk.by_source")).toBeVisible();
    await expect(page.getByTestId("tile-mk.cost_per_accepted")).toBeVisible();
    await expect(page.getByTestId("tile-mk.repeat_referral_share")).toBeVisible();

    // The anomaly card: "Contracts signed up N% vs <month>", amber, in the needs-doing strip.
    const anomaly = page.getByTestId("needs-doing-card").filter({ hasText: /Contracts signed up \d+% vs/ });
    await expect(anomaly).toHaveCount(1);
    await expect(anomaly).toContainText("Amber · trend");
  });

  test("the owner's export goes through the one route; pc, sales and finance are 403 on every P&L and marketing metric", async ({ page }) => {
    test.setTimeout(150_000);
    await signIn(page, staff!, home);
    const ok = await page.request.get("/api/reporting/export?metric=pl.contracts_signed_ex&preset=month");
    expect(ok.status()).toBe(200);
    const text = (await ok.text()).replace(/^﻿/, "");
    expect(text.split("\r\n")[0]).toContain("Accepted,Estimate,Category");
    expect(text).toContain(`Anomaly ${run}`);
    const mk = await page.request.get("/api/reporting/export?metric=mk.by_source&preset=month");
    expect(mk.status()).toBe(200);

    for (const o of others) {
      await page.context().clearCookies();
      await signIn(page, { email: o.email, password }, home);
      for (const metric of ["pl.contracts_signed_ex", "pl.gross_margin_actual", "pl.net_margin_ex", "mk.by_source", "mk.cost_per_accepted", "mk.repeat_referral_share"]) {
        const r = await page.request.get(`/api/reporting/export?metric=${metric}&preset=month`);
        expect(r.status(), `${o.role} on ${metric}`).toBe(403);
      }
      await page.goto("/home");
      await expect(page.getByTestId("home")).toBeVisible({ timeout: 45_000 });
      await expect(page.getByTestId("section-pl")).toHaveCount(0);
      await expect(page.getByTestId("section-marketing")).toHaveCount(0);
      await expect(page.getByTestId("needs-doing-card").filter({ hasText: "Amber · trend" })).toHaveCount(0);
    }
  });
});

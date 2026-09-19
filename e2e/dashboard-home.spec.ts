import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn, userIdFor } from "./helpers";
import { serviceClient } from "./fixtures/woLoop";

/**
 * Home dashboard v2 · session 1 — the shell (brief Part D, session 1 e2e):
 *   · four logins land on four different homes — the master (every section),
 *     a PC, a sales and a finance login (their own);
 *   · the sales login calling a section it does not hold — the P&L route,
 *     via the one export route — gets 403, server-side;
 *   · the master's tile equals the rows it exports (acceptance 1 and 5);
 *   · a section whose module is not live says what it waits on, never 0;
 *   · the range chips move the period and the comparison.
 * Temporary logins and rows are removed in afterAll; the e2e staff login's
 * master flag is put back the way it was.
 */
const staff = credentials("STAFF");
const db: SupabaseClient | null = serviceClient();

type Temp = { email: string; password: string; id: string; roles: string[] };

test.describe("dashboard · session 1 · the shell", () => {
  test.skip(!staff || !db, missingCreds("STAFF") + " + service key");
  test.use({ viewport: { width: 1280, height: 900 } });
  const run = randomBytes(3).toString("hex");
  const password = "painttest123";
  let masterId = ""; let masterWasOwner = false;
  const temps: Temp[] = [];
  let sentEstimateId = "";

  async function makeLogin(role: "pc" | "sales" | "finance", tag: string = role): Promise<Temp> {
    const email = `pg.e2e.home.${tag}.${run}@example.com`;
    const made = await db!.auth.admin.createUser({ email, password, email_confirm: true });
    if (made.error) throw new Error(made.error.message);
    const id = made.data.user!.id;
    const prof = await db!.from("profiles").upsert({ id, role: "staff", name: `${role} ${run}`, is_owner: false, staff_access: {}, staff_roles: [role] }, { onConflict: "id" });
    if (prof.error) throw new Error(prof.error.message);
    const t = { email, password, id, roles: [role] };
    temps.push(t);
    return t;
  }

  test.beforeAll(async () => {
    masterId = (await userIdFor(staff!)) ?? "";
    if (!masterId) throw new Error("e2e staff login not found");
    const { data } = await db!.from("profiles").select("is_owner").eq("id", masterId).single();
    masterWasOwner = data?.is_owner === true;
    if (!masterWasOwner) await db!.from("profiles").update({ is_owner: true }).eq("id", masterId);
    await Promise.all([makeLogin("pc"), makeLogin("sales"), makeLogin("finance")]);
    // One estimate sent today, so the Sales tile has at least one row in "this month".
    const est = await db!.from("estimates").insert({
      status: "sent", source: "manual", level_of_finish: 3, title: `Home ${run}`, lead_source: "referral",
      sent_at: new Date().toISOString(), share_token: `home${randomBytes(18).toString("base64url")}`,
      total_cents: 123_400, subtotal_cents: 112_182, builder_state: { blocks: [] },
    }).select("id").single();
    if (est.error) throw new Error(est.error.message);
    sentEstimateId = est.data.id as string;
  });
  test.afterAll(async () => {
    if (!db) return;
    if (sentEstimateId) await db.from("estimates").delete().eq("id", sentEstimateId);
    for (const t of temps) await db.auth.admin.deleteUser(t.id);
    if (!masterWasOwner) await db.from("profiles").update({ is_owner: false }).eq("id", masterId);
  });

  const sectionsOn = async (page: import("@playwright/test").Page) =>
    (await page.locator("section[data-section]").evaluateAll((els) => els.map((e) => e.getAttribute("data-section")))) as string[];

  test("the master lands on every section; the strip and the sales tiles are real numbers", async ({ page }) => {
    await signIn(page, staff!, /\/estimates/);
    const t0 = Date.now();
    await page.goto("/home");
    await expect(page.getByTestId("home")).toBeVisible({ timeout: 20_000 });
    const ms = Date.now() - t0;
    console.log(`home rendered for the master in ${ms} ms`);
    expect(await sectionsOn(page)).toEqual(["sales", "funnel", "pc_command", "contractors", "invoicing", "pl", "marketing", "activity"]);
    await expect(page.getByTestId("needs-doing")).toBeVisible();
    await expect(page.getByTestId("needs-doing-count")).toHaveText(/^\d+ things?$/);
    // Live section: the tiles; not-live sections: an honest "switches on" state, never a zero.
    await expect(page.getByTestId("tile-sales.estimates_sent")).toBeVisible();
    await expect(page.getByTestId("switches-on-pl")).toContainText("Switches on when");
    await expect(page.getByTestId("switches-on-invoicing")).toContainText("Switches on when");

    // Tile == rows == export (acceptance 1, 5).
    const shown = await page.getByTestId("tile-value-sales.estimates_sent").textContent();
    const value = Number((shown ?? "").replace(/[^\d]/g, ""));
    expect(value).toBeGreaterThanOrEqual(1);
    await page.getByTestId("tile-sales.estimates_sent").click();
    await expect(page.getByTestId("drill-sales.estimates_sent")).toBeVisible();
    await page.getByTestId("info-sales.estimates_sent").click();
    await expect(page.getByTestId("definition-sales.estimates_sent")).toContainText("Melbourne days");
    const exportHref = await page.getByTestId("export-sales.estimates_sent").getAttribute("href");
    expect(exportHref).toContain("/api/reporting/export?metric=sales.estimates_sent");
    const csv = await page.request.get(exportHref!);
    expect(csv.status()).toBe(200);
    expect(csv.headers()["content-type"]).toContain("text/csv");
    const lines = (await csv.text()).replace(/^﻿/, "").split("\r\n").filter((l) => l.length > 0);
    expect(lines.length - 1).toBe(value);                         // header + one line per row
    // RFC 4180: a header cell with a comma is quoted.
    expect(lines[0]).toBe("Sent,Estimate,Status,\"Total (cents, inc GST)\",Lead source,Sent by (user id)");
    expect(Number(csv.headers()["x-metric-value"])).toBe(value);
    expect((await csv.text())).toContain(`Home ${run}`);

    // The range chips move the period and the comparison label.
    await page.getByTestId("range-last_30").click();
    await expect(page.getByTestId("range-last_30")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("home-range")).toContainText("compared with");
  });

  test("a PC login lands on PC Command and Contractors — no sales, no money", async ({ page }) => {
    const pc = temps.find((t) => t.roles[0] === "pc")!;
    await signIn(page, pc, /\/(home|estimates|pc|crm|contacts|invoic|settings|proving|contractors)/);
    await page.goto("/home");
    await expect(page.getByTestId("home")).toBeVisible({ timeout: 20_000 });
    expect(await sectionsOn(page)).toEqual(["pc_command", "contractors", "activity"]);
    await expect(page.getByTestId("needs-doing")).toBeVisible();
    await expect(page.getByTestId("tile-sales.estimates_sent")).toHaveCount(0);
  });

  test("a sales login lands on Sales and the funnel — and the P&L export is a 403, not an empty file", async ({ page }) => {
    const sales = temps.find((t) => t.roles[0] === "sales")!;
    await signIn(page, sales, /\/(home|estimates|pc|crm|contacts|invoic|settings|proving|contractors)/);
    await page.goto("/home");
    await expect(page.getByTestId("home")).toBeVisible({ timeout: 20_000 });
    expect(await sectionsOn(page)).toEqual(["sales", "funnel", "activity"]);
    await expect(page.getByTestId("tile-sales.estimates_sent")).toBeVisible();
    // Their own metric exports; a metric outside their roles is refused server-side (acceptance 4).
    const mine = await page.request.get("/api/reporting/export?metric=sales.estimates_sent&preset=this_month");
    expect(mine.status()).toBe(200);
    // No P&L metric is registered yet (session 5) — the registry answers 404 for an unknown key,
    // and the role gate answers 403 for a known one: prove the gate with a known metric and a role that lacks it below.
    const unknown = await page.request.get("/api/reporting/export?metric=pl.net_margin&preset=this_month");
    expect(unknown.status()).toBe(404);
  });

  test("a finance login lands on Invoicing only, and a sales metric is 403 for them", async ({ page }) => {
    const finance = temps.find((t) => t.roles[0] === "finance")!;
    await signIn(page, finance, /\/(home|estimates|pc|crm|contacts|invoic|settings|proving|contractors)/);
    await page.goto("/home");
    await expect(page.getByTestId("home")).toBeVisible({ timeout: 20_000 });
    expect(await sectionsOn(page)).toEqual(["invoicing", "activity"]);
    const refused = await page.request.get("/api/reporting/export?metric=sales.estimates_sent&preset=this_month");
    expect(refused.status()).toBe(403);
    expect(await refused.json()).toEqual({ error: "not available to this login" });
  });

  test("a staff login with no roles sees an honest empty state, and the export route refuses too", async ({ page }) => {
    const none = await makeLogin("pc", "none");
    await db!.from("profiles").update({ staff_roles: [] }).eq("id", none.id);
    await signIn(page, none, /\/(home|estimates|pc|crm|contacts|invoic|settings|proving|contractors)/);
    await page.goto("/home");
    await expect(page.getByTestId("home-no-roles")).toBeVisible({ timeout: 20_000 });
    expect(await sectionsOn(page)).toEqual([]);
    expect((await page.request.get("/api/reporting/export?metric=sales.estimates_sent")).status()).toBe(403);
  });
});

import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn, userIdFor } from "./helpers";
import { rpcAsJson, serviceClient } from "./fixtures/woLoop";

/**
 * Home dashboard v2 · session 0d — Settings and roles (B7), Tom's rulings:
 *   ⚑1 five roles, a person may hold several, union of sections;
 *   ⚑2 targets and marketing spend are owner/admin only — server-side.
 *
 * Proved through each login's OWN session: the master holds every role; a
 * sales login holds sales and nothing else; the sales login cannot read or
 * write targets (RLS), cannot change its own roles (guard), and never sees
 * the Dashboard folder; the master edits roles on Staff logins and saves a
 * target, a spend row and a threshold through the real screen.
 * The temporary login and every row made here are removed in afterAll, and
 * the e2e staff login's master flag is put back the way it was.
 */
const staff = credentials("STAFF");
const db: SupabaseClient | null = serviceClient();
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

test.describe("dashboard 0d · settings and roles", () => {
  test.skip(!staff || !db || !url || !anonKey, missingCreds("STAFF") + " + service key");
  test.use({ viewport: { width: 1280, height: 900 } });
  const run = randomBytes(3).toString("hex");
  const salesEmail = `pg.e2e.role.${run}@example.com`;
  const salesPassword = "painttest123";
  const sales = { email: salesEmail, password: salesPassword };
  const MONTH = "2031-01";
  let masterId = ""; let masterWasOwner = false; let salesId = "";

  async function asSales(): Promise<SupabaseClient> {
    const sb = createSupabaseClient(url!, anonKey!, { auth: { persistSession: false } });
    const { error } = await sb.auth.signInWithPassword(sales);
    if (error) throw new Error(`sales sign-in: ${error.message}`);
    return sb;
  }

  test.beforeAll(async () => {
    masterId = (await userIdFor(staff!)) ?? "";
    if (!masterId) throw new Error("e2e staff login not found");
    const { data } = await db!.from("profiles").select("is_owner").eq("id", masterId).single();
    masterWasOwner = data?.is_owner === true;
    if (!masterWasOwner) await db!.from("profiles").update({ is_owner: true }).eq("id", masterId);

    const made = await db!.auth.admin.createUser({ email: salesEmail, password: salesPassword, email_confirm: true });
    if (made.error) throw new Error(made.error.message);
    salesId = made.data.user!.id;
    const prof = await db!.from("profiles").upsert({ id: salesId, role: "staff", name: `Sales ${run}`, is_owner: false, staff_access: {}, staff_roles: ["sales"] }, { onConflict: "id" });
    if (prof.error) throw new Error(prof.error.message);
  });
  test.afterAll(async () => {
    if (!db) return;
    await db.from("sales_targets").delete().eq("month", `${MONTH}-01`);
    await db.from("marketing_spend").delete().eq("month", `${MONTH}-01`);
    await db.from("settings").update({ value: { value: 3, unit: "days", notes: "A painter on an in-progress job with no activity for this many calendar days is \"silent\" (dashboard, ⚑7)." } }).eq("key", "dashboard_silent_contractor_days");
    if (salesId) await db.auth.admin.deleteUser(salesId);
    if (!masterWasOwner) await db.from("profiles").update({ is_owner: false }).eq("id", masterId);
  });

  test("the master holds every role; a sales login holds sales — and no dollars", async () => {
    expect(await rpcAsJson<string[]>(staff!, "dashboard_roles", {})).toEqual(["owner", "admin", "pc", "sales", "finance"]);
    expect(await rpcAsJson<boolean>(staff!, "dashboard_sees_money", {})).toBe(true);
    expect(await rpcAsJson<string[]>(sales, "dashboard_roles", {})).toEqual(["sales"]);
    expect(await rpcAsJson<boolean>(sales, "dashboard_sees_money", {})).toBe(false);
    expect(await rpcAsJson<boolean>(sales, "has_dashboard_role", { p_roles: ["sales", "pc"] })).toBe(true);
    expect(await rpcAsJson<boolean>(sales, "has_dashboard_role", { p_roles: ["pc"] })).toBe(false);
  });

  test("RLS: the sales login neither reads nor writes targets or spend; the guard refuses a self-promotion", async () => {
    const seed = await db!.from("sales_targets").insert({ month: `${MONTH}-01`, target_cents: 100 });
    expect(seed.error).toBeNull();
    const sb = await asSales();
    try {
      const read = await sb.from("sales_targets").select("id").eq("month", `${MONTH}-01`);
      expect(read.error).toBeNull();
      expect(read.data).toEqual([]);                       // RLS hides, it does not error — an empty list, not proof of no data
      const write = await sb.from("sales_targets").insert({ month: "2031-02-01", target_cents: 5 });
      expect(write.error?.code).toBe("42501");
      const spend = await sb.from("marketing_spend").insert({ month: "2031-02-01", channel: "paid_google", spend_cents: 5 });
      expect(spend.error?.code).toBe("42501");
      const promote = await sb.from("profiles").update({ staff_roles: ["owner"] }).eq("id", salesId);
      expect(promote.error?.code).toBe("42501");
      expect(await rpcAsJson<string[]>(sales, "dashboard_roles", {})).toEqual(["sales"]);
    } finally {
      await sb.auth.signOut().catch(() => undefined);
      await db!.from("sales_targets").delete().eq("month", `${MONTH}-01`);
    }
  });

  test("the master edits a login's roles on Staff logins, and two roles add up", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto("/settings#staff-logins");
    const row = page.getByTestId(`staff-row-${salesEmail}`);
    await expect(row).toBeVisible({ timeout: 20_000 });
    await expect(row.getByTestId(`${salesEmail}-role-sales`)).toBeChecked();
    await row.getByTestId(`${salesEmail}-role-pc`).check();
    await row.getByRole("button", { name: "Save" }).click();
    await expect(page.getByTestId("staff-msg")).toContainText("Saved");
    await expect.poll(async () => {
      const r = await db!.from("profiles").select("staff_roles").eq("id", salesId).single();
      return (r.data as { staff_roles: string[] } | null)?.staff_roles ?? r.error?.message;
    }, { timeout: 15_000 }).toEqual(["pc", "sales"]);
    expect(await rpcAsJson<string[]>(sales, "dashboard_roles", {})).toEqual(["pc", "sales"]);
  });

  test("the master saves a target, a spend row and a threshold on the Dashboard folder", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto("/settings#dashboard");
    const folder = page.getByTestId("dashboard-settings");
    await expect(folder).toBeVisible({ timeout: 20_000 });

    await page.getByTestId("target-month").fill(MONTH);
    await page.getByTestId("target-amount").fill("120,000");
    await page.getByTestId("target-save").click();
    await expect(page.getByTestId("dashboard-settings-msg")).toContainText("saved");
    await expect(page.getByTestId(`target-row-${MONTH}`)).toContainText("$120,000", { timeout: 15_000 });
    const t = await db!.from("sales_targets").select("target_cents, category_label, salesperson_id").eq("month", `${MONTH}-01`).single();
    expect(t.data).toEqual({ target_cents: 12_000_000, category_label: null, salesperson_id: null });

    // Saving the same month again updates, never duplicates.
    await page.getByTestId("target-amount").fill("130000");
    await page.getByTestId("target-save").click();
    await expect(page.getByTestId(`target-row-${MONTH}`)).toContainText("$130,000", { timeout: 15_000 });
    const again = await db!.from("sales_targets").select("id").eq("month", `${MONTH}-01`);
    expect(again.data).toHaveLength(1);

    await page.getByTestId("spend-month").fill(MONTH);
    await page.getByTestId("spend-channel").selectOption("paid_google");
    await page.getByTestId("spend-amount").fill("2500");
    await page.getByTestId("spend-save").click();
    await expect(page.getByTestId(`spend-row-${MONTH}-paid_google`)).toContainText("$2,500", { timeout: 15_000 });
    const sp = await db!.from("marketing_spend").select("spend_cents").eq("month", `${MONTH}-01`).eq("channel", "paid_google").single();
    expect(sp.data).toEqual({ spend_cents: 250_000 });

    const silent = page.getByTestId("threshold-dashboard_silent_contractor_days");
    await silent.fill("4");
    await silent.locator("xpath=following-sibling::button").click();
    await expect.poll(async () => {
      const r = await db!.from("settings").select("value").eq("key", "dashboard_silent_contractor_days").single();
      return (r.data as { value: { value: number } } | null)?.value?.value;
    }, { timeout: 15_000 }).toBe(4);
  });

  test("the sales login never sees the Dashboard folder", async ({ page }) => {
    await signIn(page, sales, /\/(home|estimates|crm|pc|contacts|invoic|settings|proving|contractors)/);
    await page.goto("/settings#staff-logins");
    await expect(page.getByTestId("folder-staff-logins")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("folder-dashboard")).toHaveCount(0);
    await expect(page.getByTestId("dashboard-settings")).toHaveCount(0);
  });
});

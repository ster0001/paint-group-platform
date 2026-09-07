import { test, expect, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { serviceClient } from "./fixtures/woLoop";

/**
 * CRM v2 · P7 — the scale gate's screens, and the theme (C1).
 *
 *   · Today: Mine / Everyone — an item for a customer owned by someone else
 *     leaves "mine" and stays in "everyone"; an unowned one is in both
 *   · two items for one customer sit under one card
 *   · the badge's second ask is served from the cache
 *   · dark / light: the toggle flips the palette, the cookie keeps it across a
 *     reload, and every CRM tab wears it
 *   · Customers → owner "Mine" filters to my customers
 */

const db: SupabaseClient | null = serviceClient();
const staff = { email: process.env.E2E_STAFF_EMAIL ?? "", password: process.env.E2E_STAFF_PASSWORD ?? "" };
const run = randomBytes(4).toString("hex");
const MINE = `Mia Mine ${run}`;
const THEIRS = `Theo Theirs ${run}`;

async function loginAs(page: Page, who: { email: string; password: string }) {
  await page.goto("/login");
  await page.fill('input[type="email"]', who.email);
  await page.fill('input[type="password"]', who.password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

test.describe("CRM v2 P7 — scale gate and theme", () => {
  test.describe.configure({ mode: "serial" });
  test.skip(!db || !staff.email, "needs SUPABASE_SERVICE_ROLE_KEY + E2E_STAFF_* creds");

  let meId = "", otherId = "", mineAcc = "", theirsAcc = "", madeOther = false;

  test.beforeAll(async () => {
    const sb = db!;
    // Two staff profiles: the login, and someone else.
    const { data: profiles } = await sb.from("profiles").select("id").eq("role", "staff").order("created_at").limit(5);
    const ids = (profiles ?? []).map((p) => p.id as string);
    // The e2e login's id comes from its email via the admin API.
    for (let pageNo = 1; pageNo <= 30 && !meId; pageNo++) {
      const { data } = await sb.auth.admin.listUsers({ page: pageNo, perPage: 200 });
      const u = data?.users?.find((x) => (x.email ?? "").toLowerCase() === staff.email.toLowerCase());
      if (u) meId = u.id;
      if (!data?.users?.length || data.users.length < 200) break;
    }
    otherId = ids.find((id) => id !== meId) ?? "";
    // C1 has one staff login: make a second, temporary one to own a customer.
    if (!otherId) {
      const { data: made, error } = await sb.auth.admin.createUser({ email: `crm.p7.other.${run}@volume.example`, password: `P7-${run}-pass!`, email_confirm: true });
      if (error || !made.user) throw new Error(error?.message ?? "could not create the second staff user");
      otherId = made.user.id;
      const { error: pErr } = await sb.from("profiles").upsert({ id: otherId, role: "staff", name: `Other Staff ${run}` }, { onConflict: "id" });
      if (pErr) throw new Error(pErr.message);
      madeOther = true;
    }
    const due = new Date(Date.now() - 2 * 86_400_000).toISOString();
    const a = await sb.from("accounts").insert({ email: `crm.p7.mine.${run}@volume.example`, name: MINE, owner_id: meId || null, followup_due_at: due, followup_note: `Ring back ${run}` }).select("id").single();
    const b = await sb.from("accounts").insert({ email: `crm.p7.theirs.${run}@volume.example`, name: THEIRS, owner_id: otherId || null, followup_due_at: due, followup_note: `Someone else's ${run}` }).select("id").single();
    if (a.error || b.error) throw new Error(a.error?.message ?? b.error?.message);
    mineAcc = a.data.id as string; theirsAcc = b.data.id as string;
    // A second item for the same customer: a callback request.
    await sb.rpc("crm_log_event", { p_type: "callback_requested", p_account_id: mineAcc, p_payload: { note: `Second thing ${run}` }, p_source: "customer", p_occurred_at: due });
  });

  test.afterAll(async () => {
    const sb = db!;
    await sb.from("accounts").delete().in("id", [mineAcc, theirsAcc]);
    if (madeOther && otherId) await sb.auth.admin.deleteUser(otherId);
  });

  test("Today: Mine hides another owner's customer, Everyone shows all; one customer's items sit together", async ({ page }) => {
    test.skip(!meId || !otherId, "needs two staff profiles on C1");
    await loginAs(page, staff);
    await page.goto("/crm/today?f=followups");
    await expect(page.getByTestId("who-mine")).toHaveClass(/\bon\b/);
    await expect(page.locator(".qitem", { hasText: MINE })).toBeVisible();
    await expect(page.locator(".qitem", { hasText: THEIRS })).toHaveCount(0);
    await page.getByTestId("who-all").click();
    await expect(page.locator(".qitem", { hasText: THEIRS })).toBeVisible();
    await expect(page.locator(".qitem", { hasText: MINE })).toBeVisible();
    // Grouping: the callback for Mia rides under her follow-up card (or vice versa), not as a second card.
    await page.goto("/crm/today?who=all");
    const mia = page.locator(".qitem", { hasText: MINE });
    await expect(mia).toHaveCount(1);
    await expect(mia.getByTestId("also")).toHaveCount(1);
  });

  test("the badge's second ask is served from the cache", async ({ page }) => {
    await loginAs(page, staff);
    const fresh = await page.request.get("/crm/api/badge?fresh=1");
    expect((await fresh.json()).cached).toBe(false);
    const again = await page.request.get("/crm/api/badge");
    const body = await again.json();
    expect(body.cached).toBe(true);
    expect(typeof body.count).toBe("number");
  });

  test("dark and light: the toggle flips the palette, the cookie keeps it, every tab wears it", async ({ page }) => {
    await loginAs(page, staff);
    await page.goto("/crm/today");
    const root = page.locator(".crm");
    await expect(root).toHaveAttribute("data-theme", "dark");
    await page.getByTestId("theme-toggle").click();
    await expect(root).toHaveAttribute("data-theme", "light");
    const bg = await root.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bg).toBe("rgb(241, 244, 246)");
    await page.reload();
    await expect(root).toHaveAttribute("data-theme", "light");
    for (const path of ["/crm/customers", "/crm/campaigns", "/crm/diary"]) {
      await page.goto(path);
      await expect(page.locator(".crm")).toHaveAttribute("data-theme", "light");
    }
    await page.getByTestId("theme-toggle").click();
    await expect(page.locator(".crm")).toHaveAttribute("data-theme", "dark");
  });

  test("Customers → owner Mine filters to my customers", async ({ page }) => {
    test.skip(!meId || !otherId, "needs two staff profiles on C1");
    await loginAs(page, staff);
    await page.goto(`/crm/customers?owner=me&q=${run}`);
    await expect(page.locator(".prow", { hasText: MINE })).toBeVisible();
    await expect(page.locator(".prow", { hasText: THEIRS })).toHaveCount(0);
  });
});

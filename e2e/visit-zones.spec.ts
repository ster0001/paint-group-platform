import { test, expect, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { gotoTodayWith } from "./helpers";
import { serviceClient } from "./fixtures/woLoop";

/**
 * Visit booking addendum A · S1 — zones, driven as staff on the real screen.
 *
 *   · Settings → Visit zones lists the seeded suburbs with status, far edge and
 *     reviewed; Glen Waverley 3150 is Zone 1, Wheelers Hill 3150 is Zone 3
 *   · "Check an address" answers from the live list
 *   · moving a suburb changes the resolver's answer AT ONCE (the check box
 *     reads the same table the customer path will)
 *   · an unmapped suburb (recorded by the resolver) shows on CRM Today as a
 *     work item and in the Settings list; adding the suburb resolves both
 *
 * Everything this spec creates it removes: the test suburb it adds and the
 * unmapped row it records are deleted in afterAll; the moved suburb is moved
 * back.
 */

const db: SupabaseClient | null = serviceClient();
const staff = { email: process.env.E2E_STAFF_EMAIL ?? "", password: process.env.E2E_STAFF_PASSWORD ?? "" };
const run = randomBytes(3).toString("hex");
const MADE_UP = `Zonetest ${run}`;
const MADE_UP_PC = "3999";

async function loginAs(page: Page, who: { email: string; password: string }) {
  await page.goto("/login");
  await page.fill('input[type="email"]', who.email);
  await page.fill('input[type="password"]', who.password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

test.describe("S1 — visit zones", () => {
  test.describe.configure({ mode: "serial" });
  test.skip(!db || !staff.email, "needs SUPABASE_SERVICE_ROLE_KEY + E2E_STAFF_* creds");

  let seeded = 0;
  let mordiallocBefore = "";

  test.beforeAll(async () => {
    const sb = db!;
    const { count, error } = await sb.from("visit_suburbs").select("id", { count: "exact", head: true });
    if (error) throw new Error(`visit_suburbs: ${error.message} — run migration 20270212 and scripts/seed-visit-zones.ts seed on the test project`);
    seeded = count ?? 0;
    const { data: m } = await sb.from("visit_suburbs").select("status").eq("postcode", "3195").ilike("suburb", "mordialloc").single();
    mordiallocBefore = (m?.status as string) ?? "zone_4";
  });

  test.afterAll(async () => {
    const sb = db!;
    for (let i = 0; i < 2; i++) {
      const a = await sb.from("visit_suburbs").delete().ilike("suburb", MADE_UP.toLowerCase());
      const b = await sb.from("visit_unmapped_suburbs").delete().ilike("suburb", MADE_UP.toLowerCase());
      const c = await sb.from("visit_suburbs").update({ status: mordiallocBefore, basis: "named_by_tom" }).eq("postcode", "3195").ilike("suburb", "mordialloc");
      if (!a.error && !b.error && !c.error) return;
      if (i === 1) throw new Error(`cleanup failed: ${a.error?.message ?? b.error?.message ?? c.error?.message}`);
    }
  });

  test("the seeded list is there and the shared-postcode pairs are told apart", async ({ page }) => {
    expect(seeded).toBeGreaterThan(3000);
    await loginAs(page, staff);
    await page.goto("/settings#visit-zones");
    await expect(page.getByTestId("visit-zones")).toBeVisible();
    await expect(page.getByTestId("visit-zones-load-error")).toHaveCount(0);
    await page.getByTestId("zone-search").fill("3150");
    await expect(page.getByTestId("suburb-glen-waverley-3150").getByTestId("suburb-status")).toHaveValue("zone_1");
    await expect(page.getByTestId("suburb-wheelers-hill-3150").getByTestId("suburb-status")).toHaveValue("zone_3");
    await page.getByTestId("zone-search").fill("3195");
    await expect(page.getByTestId("suburb-parkdale-3195").getByTestId("suburb-status")).toHaveValue("zone_1");
    await expect(page.getByTestId("suburb-mordialloc-3195").getByTestId("suburb-status")).toHaveValue("zone_4");
    // Far edge comes from the CSV.
    await page.getByTestId("zone-search").fill("Mornington");
    await expect(page.getByTestId("suburb-mornington-3931").getByTestId("suburb-far-edge")).toBeChecked();
  });

  test("check an address answers from the live list; moving a suburb changes the answer at once", async ({ page }) => {
    await loginAs(page, staff);
    await page.goto("/settings#visit-zones");
    await page.getByTestId("zone-check-suburb").fill("Mordialloc");
    await page.getByTestId("zone-check-postcode").fill("3195");
    await page.getByTestId("zone-check-go").click();
    await expect(page.getByTestId("zone-check-result")).toContainText("Zone 4");

    await page.getByTestId("zone-search").fill("3195");
    await page.getByTestId("suburb-mordialloc-3195").getByTestId("suburb-status").selectOption("pre_arranged");
    await expect(page.getByTestId("visit-zones-msg")).toContainText("Mordialloc 3195 is now Pre-arranged");
    const { data } = await db!.from("visit_suburbs").select("status, reviewed, basis").eq("postcode", "3195").ilike("suburb", "mordialloc").single();
    expect(data).toMatchObject({ status: "pre_arranged", reviewed: true, basis: "settings" });

    await page.getByTestId("zone-check-go").click();
    await expect(page.getByTestId("zone-check-result")).toContainText("Pre-arranged");
    // Parkdale, same postcode, is untouched.
    await page.getByTestId("zone-check-suburb").fill("Parkdale");
    await page.getByTestId("zone-check-go").click();
    await expect(page.getByTestId("zone-check-result")).toContainText("Zone 1");
  });

  test("a made-up Victorian suburb is unmapped, raises a Today item, and adding it resolves both", async ({ page }) => {
    const sb = db!;
    // The customer path records the miss (lib/visits/zones.ts resolveZone with the service client).
    const { resolveZone } = await import("../lib/visits/zones");
    const r = await resolveZone(sb, { suburb: MADE_UP, postcode: MADE_UP_PC, state: "VIC" });
    expect(r.outcome).toBe("unmapped");
    const { data: row } = await sb.from("visit_unmapped_suburbs").select("id, hits").ilike("suburb", MADE_UP.toLowerCase()).single();
    expect(row?.hits).toBe(1);
    await resolveZone(sb, { suburb: MADE_UP, postcode: MADE_UP_PC, state: "VIC" });
    const { data: again } = await sb.from("visit_unmapped_suburbs").select("hits").eq("id", row!.id).single();
    expect(again?.hits).toBe(2);

    await loginAs(page, staff);
    const item = page.getByText(`Unmapped suburb: ${MADE_UP} ${MADE_UP_PC}`).first();
    await gotoTodayWith(page, "/crm/today?f=followups", item);
    await expect(item).toBeVisible();

    await page.goto("/settings#visit-zones");
    const unmapped = page.getByTestId(`unmapped-${row!.id}`);
    await expect(unmapped).toBeVisible();
    await expect(unmapped).toContainText("2 hits");
    await unmapped.getByRole("combobox").selectOption("zone_2");
    await expect(page.getByTestId("visit-zones-msg")).toContainText(`Added ${MADE_UP} ${MADE_UP_PC} as Zone 2`);
    await expect(page.getByTestId(`unmapped-${row!.id}`)).toHaveCount(0);

    const { data: resolved } = await sb.from("visit_unmapped_suburbs").select("resolved_at").eq("id", row!.id).single();
    expect(resolved?.resolved_at).not.toBeNull();
    const after = await resolveZone(sb, { suburb: MADE_UP, postcode: MADE_UP_PC, state: "VIC" });
    expect(after.outcome).toBe("zone_2");
    await page.goto("/crm/today?f=followups");
    await expect(page.getByText(`Unmapped suburb: ${MADE_UP} ${MADE_UP_PC}`)).toHaveCount(0);
  });

  test("a browser cannot read or write the zones tables without a staff session", async () => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.E2E_SUPABASE_URL ?? "";
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.E2E_SUPABASE_ANON_KEY ?? "";
    test.skip(!url || !anonKey, "needs the anon key");
    const { createClient } = await import("@supabase/supabase-js");
    const anon = createClient(url, anonKey, { auth: { persistSession: false } });
    const read = await anon.from("visit_suburbs").select("id").limit(1);
    expect(read.error, "anon read is refused (42501), not an empty list").not.toBeNull();
    const write = await anon.from("visit_suburbs").insert({ suburb: "Nope", postcode: "3000", status: "zone_1" });
    expect(write.error).not.toBeNull();
  });
});

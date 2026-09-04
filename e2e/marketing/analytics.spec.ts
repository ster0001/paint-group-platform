import { test, expect, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceClient } from "../fixtures/woLoop";

/**
 * Homepage v2 · session 7 — analytics + consent + noindex, as an ANONYMOUS
 * visitor (brief §5, §8; Tom's consent spec 4 Sep).
 *  - the sheet shows on first visit; "Only what's needed" is the default
 *    (focused, the quieter button); the choice is a 12-month first-party cookie;
 *  - Clarity is absent before consent and after decline; present after allow
 *    (when NEXT_PUBLIC_CLARITY_ID is set on the stack);
 *  - "Cookie settings" reopens the sheet;
 *  - events land in crm_events (type web_event) with the visitor id, and the
 *    address arrives on see_price ONLY;
 *  - every page carries X-Robots-Tag: noindex, nofollow.
 */
const db: SupabaseClient | null = serviceClient();
const clarityId = process.env.NEXT_PUBLIC_CLARITY_ID ?? "";

async function cookie(page: Page, name: string) {
  const c = (await page.context().cookies()).find((x) => x.name === name);
  return c ?? null;
}

test.describe("consent sheet", () => {
  test("first visit: the sheet, decline as the default, a 12-month cookie, no Clarity", async ({ page }) => {
    await page.goto("/");
    const sheet = page.getByTestId("consent-sheet");
    await expect(sheet).toBeVisible();
    await expect(page.getByTestId("consent-decline")).toBeFocused();
    await expect(page.getByTestId("consent-decline")).toHaveClass(/btn-ghost/);
    await expect(page.getByTestId("consent-allow")).toHaveClass(/btn-cyan/);
    await expect(page.locator('script[src^="https://www.clarity.ms/tag/"]')).toHaveCount(0);

    await page.getByTestId("consent-decline").click();
    await expect(sheet).toHaveCount(0);
    const c = await cookie(page, "pg_consent");
    expect(c?.value).toBe("essential");
    expect(c!.expires - Date.now() / 1000).toBeGreaterThan(360 * 24 * 3600);
    await expect(page.locator('script[src^="https://www.clarity.ms/tag/"]')).toHaveCount(0);

    await page.reload();
    await expect(page.getByTestId("consent-sheet")).toHaveCount(0);
    await expect(page.locator('script[src^="https://www.clarity.ms/tag/"]')).toHaveCount(0);
  });

  test("allow: the cookie says analytics and Clarity loads (only then)", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("consent-allow").click();
    expect((await cookie(page, "pg_consent"))?.value).toBe("analytics");
    await expect(page.locator('script[src^="https://www.clarity.ms/tag/"]')).toHaveCount(clarityId ? 1 : 0);
    await page.goto("/work");
    await expect(page.getByTestId("consent-sheet")).toHaveCount(0);
    await expect(page.locator('script[src^="https://www.clarity.ms/tag/"]')).toHaveCount(clarityId ? 1 : 0);
  });

  test("Cookie settings in the footer reopens the sheet", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("consent-decline").click();
    await page.getByTestId("cookie-settings").click();
    await expect(page.getByTestId("consent-sheet")).toBeVisible();
    await expect(page.getByTestId("consent-sheet")).toHaveAttribute("data-current", "essential");
  });
});

test.describe("first-party events", () => {
  test.skip(!db, "needs SUPABASE_SERVICE_ROLE_KEY to read crm_events");

  test("events land in crm_events with the visitor id; the address arrives on see_price only", async ({ page }) => {
    test.setTimeout(90_000);
    await page.route("**/api/places/autocomplete", (route) => route.fulfill({ json: { suggestions: [] } }));
    await page.goto("/");
    await page.getByTestId("consent-decline").click(); // no consent needed for our own table
    const vid = (await cookie(page, "pg_vid"))!.value;
    expect(vid).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    const address = `12 Elm Street, Northcote ${vid.slice(0, 6)}`;
    const hero = page.locator("#top");
    await hero.getByRole("textbox", { name: "Address" }).tap().catch(() => hero.getByRole("textbox", { name: "Address" }).click());
    await hero.getByRole("textbox", { name: "Address" }).fill(address);
    await hero.getByRole("button", { name: "See my price →" }).click();
    await expect(page).toHaveURL(/\/estimate\?/);

    type Row = { payload: { name: string; props: Record<string, unknown>; visitorId: string | null; address: string | null; path: string } };
    let rows: Row[] = [];
    await expect.poll(async () => {
      const { data } = await db!.from("crm_events").select("payload").eq("type", "web_event")
        .filter("payload->>visitorId", "eq", vid).order("occurred_at", { ascending: true });
      rows = (data ?? []) as Row[];
      return rows.map((r) => r.payload.name);
    }, { timeout: 30_000, intervals: [1_000, 2_000] }).toEqual(expect.arrayContaining(["consent_choice", "address_typed", "see_price"]));

    const seePrice = rows.find((r) => r.payload.name === "see_price")!;
    expect(seePrice.payload.address).toBe(address);
    expect(seePrice.payload.props).toEqual({ where: "hero", mode: "home" });
    expect(seePrice.payload.path).toBe("/");
    for (const r of rows) {
      if (r.payload.name === "see_price") continue;
      expect(r.payload.address).toBeNull();
      expect(JSON.stringify(r.payload.props)).not.toContain("Elm");
    }
    // cleanup is the append-only table's own retention: rows are anonymous and tiny
  });

  test("the sink strips an address a client smuggles onto another event", async ({ request }) => {
    const vid = `e2e${Date.now().toString(36)}smuggle`;
    const r = await request.post("/api/events", {
      headers: { "Sec-Fetch-Site": "same-origin" },
      data: { name: "address_typed", props: { where: "hero", address: "1 Leak St" }, path: "/", visitorId: vid, address: "1 Leak St" },
    });
    expect(r.status()).toBe(204);
    await expect.poll(async () => {
      const { data } = await db!.from("crm_events").select("payload").eq("type", "web_event").filter("payload->>visitorId", "eq", vid);
      return (data ?? []).length;
    }, { timeout: 15_000 }).toBe(1);
    const { data } = await db!.from("crm_events").select("payload").eq("type", "web_event").filter("payload->>visitorId", "eq", vid).single();
    const payload = data!.payload as { address: string | null; props: Record<string, unknown> };
    expect(payload.address).toBeNull();
    expect(JSON.stringify(payload.props)).not.toContain("Leak");
  });

  test("an unknown event name or a cross-site caller is dropped, quietly", async ({ request }) => {
    const bad = await request.post("/api/events", { headers: { "Sec-Fetch-Site": "same-origin" }, data: { name: "drop_table", props: {}, path: "/" } });
    expect(bad.status()).toBe(204);
    const cross = await request.post("/api/events", { headers: { "Sec-Fetch-Site": "cross-site" }, data: { name: "nav_cta", props: {}, path: "/" } });
    expect(cross.status()).toBe(204);
  });
});

test.describe("noindex while on the subdomain (§8)", () => {
  test("every page answers X-Robots-Tag: noindex, nofollow and the robots meta", async ({ page, request }) => {
    for (const path of ["/", "/work", "/estimate"]) {
      const r = await request.get(path);
      expect(r.headers()["x-robots-tag"]).toBe("noindex, nofollow");
    }
    await page.goto("/");
    const robots = await page.locator('meta[name="robots"]').getAttribute("content");
    expect(robots).toContain("noindex");
  });
});

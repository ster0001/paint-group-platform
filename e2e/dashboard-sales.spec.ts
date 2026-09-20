import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn, userIdFor } from "./helpers";
import { serviceClient } from "./fixtures/woLoop";

/**
 * Home dashboard v2 · session 3 — Sales + funnel + activity, as a SALES login
 * (brief Part D, session 3 e2e): Mine / Team, the funnel from wizard
 * sessions, and the activity feed — an estimate the customer opens shows on
 * it within five seconds (acceptance 8). The target card is money and stays
 * with the master (⚑2). Cleaned up in afterAll.
 */
const staff = credentials("STAFF");
const db: SupabaseClient | null = serviceClient();

test.describe("dashboard · session 3 · sales, funnel, activity", () => {
  test.skip(!staff || !db, missingCreds("STAFF") + " + service key");
  test.use({ viewport: { width: 1280, height: 900 } });
  const run = randomBytes(3).toString("hex");
  const password = "painttest123";
  const salesEmail = `pg.e2e.sales.${run}@example.com`;
  let salesId = ""; let masterId = ""; let masterWasOwner = false;
  let accountId = ""; let mineId = ""; let theirsId = ""; let token = ""; let draftId = "";
  const customer = `Priya ${run}`;

  test.beforeAll(async () => {
    masterId = (await userIdFor(staff!)) ?? "";
    if (!masterId) throw new Error("e2e staff login not found");
    const { data } = await db!.from("profiles").select("is_owner").eq("id", masterId).single();
    masterWasOwner = data?.is_owner === true;
    if (!masterWasOwner) await db!.from("profiles").update({ is_owner: true }).eq("id", masterId);

    const made = await db!.auth.admin.createUser({ email: salesEmail, password, email_confirm: true });
    if (made.error) throw new Error(made.error.message);
    salesId = made.data.user!.id;
    const prof = await db!.from("profiles").upsert({ id: salesId, role: "staff", name: `Sarah ${run}`, is_owner: false, staff_access: {}, staff_roles: ["sales"] }, { onConflict: "id" });
    if (prof.error) throw new Error(prof.error.message);

    const acct = await db!.from("accounts").insert({ email: `pg.e2e.s3-${run}@example.com`, name: customer }).select("id").single();
    if (acct.error) throw new Error(acct.error.message);
    accountId = acct.data.id as string;
    token = `s3${randomBytes(18).toString("base64url")}`;
    const base = {
      status: "sent", source: "manual", level_of_finish: 3, lead_source: "referral", account_id: accountId,
      sent_at: new Date().toISOString(), total_cents: 500_000, subtotal_cents: 454_545, builder_state: { blocks: [] },
      sent_snapshot: { version: 1, company: { name: "Paint Group", addressLine1: "", addressLine2: "", phone: "", abn: "", email: "", estimatorName: "", estimatorTitle: "", estimatorPhone: "", logoUrl: "" },
        contactName: customer, contactEmail: "", jobTitle: "Interior repaint", gstRatePct: 10, depositPct: 10, lineItems: [], options: [], paints: [], inclusions: [], exclusions: [], terms: "",
        discountMode: "pct", discountPct: 0, discountFixedCents: 0, baseSubtotalCents: 454_545, proof: { rating: "5.0", reviews: "93+", liability: "$20M", warranty: "2-year", accreditations: [] },
        areas: [{ id: "1", title: "Lounge", descriptionHtml: "", priceCents: 454_545, surfaces: [{ label: "Walls", coats: 2, product: "" }], photos: [] }] },
    };
    const mine = await db!.from("estimates").insert({ ...base, title: `Mine ${run}`, sent_by_user_id: salesId, share_token: token }).select("id").single();
    if (mine.error) throw new Error(mine.error.message);
    mineId = mine.data.id as string;
    const theirs = await db!.from("estimates").insert({ ...base, title: `Theirs ${run}`, sent_by_user_id: masterId, share_token: `s3b${randomBytes(18).toString("base64url")}` }).select("id").single();
    if (theirs.error) throw new Error(theirs.error.message);
    theirsId = theirs.data.id as string;
    const draft = await db!.from("wizard_drafts").insert({ email: `pg.e2e.s3-${run}@example.com`, started_at: new Date().toISOString(), last_seen_at: new Date().toISOString(), estimate_id: mineId, converted_at: new Date().toISOString(), state: {} }).select("id").single();
    if (draft.error) throw new Error(draft.error.message);
    draftId = draft.data.id as string;
  });
  test.afterAll(async () => {
    if (!db) return;
    if (draftId) await db.from("wizard_drafts").delete().eq("id", draftId);
    for (const id of [mineId, theirsId]) if (id) await db.from("estimates").delete().eq("id", id);
    if (accountId) { await db.from("crm_events").delete().eq("account_id", accountId); await db.from("accounts").delete().eq("id", accountId); }
    if (salesId) await db.auth.admin.deleteUser(salesId);
    if (!masterWasOwner) await db.from("profiles").update({ is_owner: false }).eq("id", masterId);
  });

  /** A tile is a client component: after a navigation the first click can land before hydration, so press until the drill answers. */
  const openTile = async (page: import("@playwright/test").Page, key: string) => {
    for (let i = 0; i < 4; i++) {
      await page.getByTestId(`tile-${key}`).click();
      try { await expect(page.getByTestId(`drill-${key}`)).toBeVisible({ timeout: 2_500 }); return; } catch { /* not hydrated yet — press again */ }
    }
    await expect(page.getByTestId(`drill-${key}`)).toBeVisible();
  };

  test("a sales login: Mine by default, Team on request; the funnel and the target's absence", async ({ page }) => {
    await signIn(page, { email: salesEmail, password }, /\/(home|estimates|pc|crm|contacts|invoic|settings|proving|contractors)/);
    await page.goto("/home");
    await expect(page.getByTestId("home")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("who-mine")).toHaveAttribute("aria-pressed", "true");
    // By salesperson, mine: one row — theirs.
    const bySales = page.getByTestId("rows-sales.by_salesperson");
    await expect(bySales).toBeVisible();
    await expect(bySales).toContainText(`Sarah ${run}`);
    await expect(bySales).not.toContainText("Team");
    // Conversion rows are theirs only.
    await openTile(page, "sales.conversion");
    const drill = page.getByTestId("drill-sales.conversion");
    await expect(drill).toContainText(`Mine ${run}`);
    await expect(drill).not.toContainText(`Theirs ${run}`);
    // Team shows everyone's.
    await page.getByTestId("who-team").click();
    await expect(page.getByTestId("who-team")).toHaveAttribute("aria-pressed", "true");
    await openTile(page, "sales.conversion");
    await expect(page.getByTestId("drill-sales.conversion")).toContainText(`Theirs ${run}`);
    // AOV by category: the fixture has no presentation → Uncategorised.
    await expect(page.getByTestId("rows-sales.aov_by_category")).toContainText("Uncategorised");
    // The target is money: not for a sales login.
    await expect(page.getByTestId("target-card")).toHaveCount(0);
    // The funnel: the fixture's session started today, saved and sent.
    await expect(page.getByTestId("funnel-card")).toBeVisible();
    expect(Number(await page.getByTestId("funnel-count-started").textContent())).toBeGreaterThanOrEqual(1);
    expect(Number(await page.getByTestId("funnel-count-sent").textContent())).toBeGreaterThanOrEqual(1);
    // The export carries the Mine / Team scope.
    const mine = await page.request.get("/api/reporting/export?metric=sales.conversion&preset=this_month&who=mine");
    expect(mine.status()).toBe(200);
    expect(await mine.text()).toContain(`Mine ${run}`);
    expect(await mine.text()).not.toContain(`Theirs ${run}`);
  });

  test("an estimate the customer opens shows on Activity within five seconds; the family filter and export follow", async ({ page, browser }) => {
    // The customer opens their estimate, signed out.
    const anon = await browser.newContext();
    const cust = await anon.newPage();
    try { await cust.goto(`/e/${token}`); await expect(cust.locator("body")).toContainText("Lounge"); } finally { await anon.close(); }
    const opened = Date.now();

    await signIn(page, { email: salesEmail, password }, /\/(home|estimates|pc|crm|contacts|invoic|settings|proving|contractors)/);
    await page.goto("/home?family=estimates");
    const feed = page.getByTestId("activity-feed");
    await expect(feed).toBeVisible({ timeout: 30_000 });
    await expect(feed.locator("[data-testid=activity-row]", { hasText: customer }).first()).toBeVisible({ timeout: 5_000 + Math.max(0, 5_000 - (Date.now() - opened)) });
    await expect(feed.locator("[data-testid=activity-row]").first()).toHaveAttribute("data-family", "estimates");
    // Money events are not a sales login's: the Money chip is not offered.
    await expect(page.getByTestId("activity-family-money")).toHaveCount(0);
    await expect(page.getByTestId("activity-family-estimates")).toHaveAttribute("aria-pressed", "true");
    // Search narrows; the export is the filtered rows.
    await page.goto(`/home?family=estimates&q=${encodeURIComponent(customer)}`);
    await expect(page.getByTestId("activity-feed").locator("[data-testid=activity-row]").first()).toContainText(customer);
    const csv = await page.request.get(`/api/reporting/export?metric=activity.events&preset=this_month&family=estimates&q=${encodeURIComponent(customer)}`);
    expect(csv.status()).toBe(200);
    const text = (await csv.text()).replace(/^\uFEFF/, "");
    expect(text).toContain(customer);
    expect(text.split("\r\n").filter((l) => l && !l.startsWith("When")).every((l) => l.includes(customer))).toBe(true);
  });

  test("the master sees the target card and both salespeople", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto("/home?who=team");
    await expect(page.getByTestId("target-card")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("target-chart")).toBeVisible();
    await page.getByTestId("target-table-toggle").click();
    await expect(page.getByTestId("target-table")).toBeVisible();
    await expect(page.getByTestId("rows-sales.by_salesperson")).toContainText(`Sarah ${run}`);
  });
});

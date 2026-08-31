import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { serviceClient } from "./fixtures/woLoop";

/**
 * Phase 2A · the four-tab shell and the derived work queue, driven as staff
 * against the real screens (C1 test stack).
 *
 * The load-bearing assertions, from the brief's acceptance list:
 *   · four tabs, the board only a view inside Customers
 *   · a fact (follow-up due) SURFACES in Today with no task row anywhere,
 *     and clearing the fact removes the item with nothing ticked
 *   · dismissal requires a reason, suppresses exactly that key, and lands
 *     on the timeline as an event
 *   · a contractor never sees the queue
 */

const db: SupabaseClient | null = serviceClient();
const staff = {
  email: process.env.E2E_STAFF_EMAIL ?? "",
  password: process.env.E2E_STAFF_PASSWORD ?? "",
};
const contractor = {
  email: process.env.E2E_CONTRACTOR_EMAIL ?? "",
  password: process.env.E2E_CONTRACTOR_PASSWORD ?? "",
};

const run = randomBytes(4).toString("hex");
const accountEmail = `crm.queue.${run}@volume.example`;
const NOTE = `Send the breakdown by the 10th ${run}`;

async function loginAs(page: import("@playwright/test").Page, who: { email: string; password: string }) {
  await page.goto("/login");
  await page.fill('input[type="email"]', who.email);
  await page.fill('input[type="password"]', who.password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

test.describe("CRM shell + work queue (2A)", () => {
  test.skip(!db || !staff.email, "needs SUPABASE_SERVICE_ROLE_KEY + E2E_STAFF_* creds");

  let accountId = "";

  test.beforeAll(async () => {
    const sb = db!;
    const { data, error } = await sb.from("accounts")
      .insert({ email: accountEmail, name: `Denise Queue ${run}`, account_type: "residential" })
      .select("id").single();
    if (error) throw new Error(error.message);
    accountId = data!.id as string;
    // The fact: a staff-set follow-up reminder, due yesterday, with a note.
    const { error: e2 } = await sb.from("accounts")
      .update({ followup_due_at: new Date(Date.now() - 86_400_000).toISOString(), followup_note: NOTE })
      .eq("id", accountId);
    if (e2) throw new Error(e2.message);
  });

  test.afterAll(async () => {
    const sb = db!;
    if (accountId) {
      await sb.from("work_item_dismissals").delete().eq("account_id", accountId);
      await sb.from("crm_events").delete().eq("account_id", accountId);
      await sb.from("accounts").delete().eq("id", accountId);
    }
  });

  test("four tabs; /crm lands on Today; the due follow-up surfaces from the fact alone", async ({ page }) => {
    test.setTimeout(120_000);
    await loginAs(page, staff);

    await page.goto("/crm");
    await page.waitForURL(/\/crm\/today/);

    const rail = page.getByRole("tablist", { name: /crm sections/i });
    for (const label of ["Today", "Customers", "Campaigns", "Diary"]) {
      await expect(rail.getByRole("tab", { name: new RegExp(label) })).toBeVisible();
    }
    // No fifth destination.
    await expect(rail.getByRole("tab")).toHaveCount(4);

    // The item exists because the fact does — no task row was inserted.
    const item = page.locator(".qitem", { hasText: `Denise Queue ${run}` });
    await expect(item).toBeVisible();
    await expect(item).toContainText("follow-up reminder due");
    await expect(item).toContainText(NOTE);

    // Its one action opens the shared customer record.
    await item.getByRole("link", { name: /open/i }).click();
    await page.waitForURL(new RegExp(`/crm/customers/${accountId}`));
    await expect(page.locator(".hname")).toContainText(`Denise Queue ${run}`);
  });

  test("clearing the fact removes the item with nothing ticked", async ({ page }) => {
    test.setTimeout(120_000);
    const sb = db!;
    await loginAs(page, staff);

    await page.goto("/crm/today");
    await expect(page.locator(".qitem", { hasText: `Denise Queue ${run}` })).toBeVisible();

    await sb.from("accounts").update({ followup_due_at: null, followup_note: null }).eq("id", accountId);
    await page.reload();
    await expect(page.locator(".qitem", { hasText: `Denise Queue ${run}` })).toHaveCount(0);

    // Put the fact back for the dismissal test.
    await sb.from("accounts")
      .update({ followup_due_at: new Date(Date.now() - 86_400_000).toISOString(), followup_note: NOTE })
      .eq("id", accountId);
  });

  test("dismissal needs a reason, suppresses the key, and lands on the timeline", async ({ page }) => {
    test.setTimeout(120_000);
    const sb = db!;
    await loginAs(page, staff);

    await page.goto("/crm/today");
    const item = page.locator(".qitem", { hasText: `Denise Queue ${run}` });
    await expect(item).toBeVisible();

    await item.getByRole("button", { name: /not this one/i }).click();
    // No reason, no dismissal.
    await expect(item.getByRole("button", { name: /^dismiss$/i })).toBeDisabled();

    await item.getByRole("button", { name: /for good/i }).click();
    await item.locator(".qdreason").fill("Rang them — duplicate reminder");
    await item.getByRole("button", { name: /^dismiss$/i }).click();

    await expect(page.locator(".qitem", { hasText: `Denise Queue ${run}` })).toHaveCount(0, { timeout: 15_000 });

    // The dismissal row and its timeline event both exist.
    const { data: dis } = await sb.from("work_item_dismissals").select("item_key, reason, until").eq("account_id", accountId);
    expect(dis).toHaveLength(1);
    expect(dis![0].item_key).toBe(`snooze_expired:account:${accountId}:reminder`);
    expect(dis![0].reason).toContain("duplicate");
    expect(dis![0].until).toBeNull();

    const { data: ev } = await sb.from("crm_events")
      .select("type, payload").eq("account_id", accountId).eq("type", "work_item_dismissed");
    expect(ev).toHaveLength(1);

    // And it shows on the record's timeline.
    await page.goto(`/crm/customers/${accountId}`);
    await expect(page.locator(".tl")).toContainText("Waved away from Today");
  });

  test("Customers: list and board are one place; filter survives the toggle; sort flips", async ({ page }) => {
    test.setTimeout(120_000);
    await loginAs(page, staff);

    await page.goto("/crm/customers");
    await expect(page.locator(".plist")).toBeVisible();
    await expect(page.locator(".note")).toContainText("Sorting isn’t a follow-up system");

    // Filter, then toggle to board — the filter must ride along.
    await page.getByRole("link", { name: /^Leads/ }).click();
    await page.waitForURL(/f=leads/);
    await page.locator(".seg").getByRole("link", { name: "Board" }).click();
    await page.waitForURL(/view=board/);
    expect(page.url()).toContain("f=leads");
    await expect(page.locator(".lanescroll")).toBeVisible();

    // The old board route is only a redirect into this view.
    await page.goto("/crm/pipeline");
    await page.waitForURL(/\/crm\/customers\?view=board/);

    // Sort works in both directions, back on the list.
    await page.goto("/crm/customers");
    await page.locator(".sortwrap summary").click();
    await page.getByRole("link", { name: /oldest first/i }).click();
    await page.waitForURL(/sort=quote-old/);
    await expect(page.locator(".sortbtn")).toContainText("Quote date");
  });

  test("Campaigns keeps no approval queue link; Diary stands", async ({ page }) => {
    test.setTimeout(120_000);
    await loginAs(page, staff);

    await page.goto("/crm/campaigns");
    await expect(page.locator(".chips").first()).not.toContainText("Waiting for you");

    await page.goto("/crm/diary");
    await expect(page.getByRole("heading", { name: "Diary" })).toBeVisible();
    await expect(page.locator(".slab").first()).toContainText("Jobs running");
  });

  test("a contractor gets no queue at all", async ({ page }) => {
    test.skip(!contractor.email, "needs E2E_CONTRACTOR_* creds");
    test.setTimeout(120_000);
    await loginAs(page, contractor);

    await page.goto("/crm/today");
    await page.waitForURL((u) => !u.pathname.startsWith("/crm"));

    const res = await page.request.get("/crm/api/badge");
    expect((await res.json()).count).toBe(0);
  });
});

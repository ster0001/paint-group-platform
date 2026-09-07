import { test, expect, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { serviceClient } from "./fixtures/woLoop";

/**
 * CRM v2 · P4 — the status model, driven as staff on the real screens (C1).
 *
 *   · delayed until a date, with a note: the card wears "Delayed to …", the
 *     chase flags go quiet, the customer leaves Today; when the date has
 *     passed a "delay is up" item carries the note
 *   · lost with one of the five ruled reasons; a new estimate re-opens them
 *   · permissions: "No texts" on the status line; STOP-by-link writes the
 *     per-channel record
 *   · tags from the office list, filterable; a saved view remembers a filter set
 *   · archived disappears from the list but search still finds them
 *   · Settings → CRM saves a threshold the rules then read
 */

const db: SupabaseClient | null = serviceClient();
const staff = { email: process.env.E2E_STAFF_EMAIL ?? "", password: process.env.E2E_STAFF_PASSWORD ?? "" };
const run = randomBytes(4).toString("hex");
const NAME = `Delia Status ${run}`;
const EMAIL = `crm.p4.${run}@volume.example`;

async function loginAs(page: Page, who: { email: string; password: string }) {
  await page.goto("/login");
  await page.fill('input[type="email"]', who.email);
  await page.fill('input[type="password"]', who.password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

test.describe("CRM v2 P4 — the status model", () => {
  test.describe.configure({ mode: "serial" });
  test.skip(!db || !staff.email, "needs SUPABASE_SERVICE_ROLE_KEY + E2E_STAFF_* creds");

  let accountId = "";

  test.beforeAll(async () => {
    const sb = db!;
    const acc = await sb.from("accounts").insert({ email: EMAIL, name: NAME, phone: "0400 000 111" }).select("id").single();
    if (acc.error) throw new Error(acc.error.message);
    accountId = acc.data.id as string;
    // A sent, silent estimate: without a state, the rules would chase it.
    const est = await sb.from("estimates").insert({
      title: `P4 status ${run}`, status: "sent", level_of_finish: 3, total_cents: 512_000, account_id: accountId,
      sent_at: new Date(Date.now() - 20 * 86_400_000).toISOString(), builder_state: { blocks: [] },
    }).select("id").single();
    if (est.error) throw new Error(est.error.message);
  });

  test.afterAll(async () => {
    const sb = db!;
    await sb.from("estimates").delete().eq("account_id", accountId);
    if (accountId) {
      const { error } = await sb.from("accounts").delete().eq("id", accountId);
      if (error) throw new Error(`account delete failed: ${error.message}`);
    }
    // The saved view this run made.
    const { data } = await sb.from("settings").select("value").eq("key", "crm_views").maybeSingle();
    const views = (Array.isArray(data?.value) ? data!.value : []) as Array<{ key: string }>;
    await sb.from("settings").upsert({ key: "crm_views", value: views.filter((v) => !v.key.includes(run)) }, { onConflict: "key" });
  });

  test("delayed until a date: the card goes quiet, and when the date passes a reminder carries the note", async ({ page }) => {
    await loginAs(page, staff);
    await page.goto(`/crm/customers/${accountId}`);
    // Before: chase due (sent 20 days ago, never opened).
    await expect(page.getByTestId("status-card")).toContainText("Estimate sent");

    await page.getByTestId("state-delayed").click();
    const form = page.getByTestId("delay-form");
    const day = new Date(Date.now() + 40 * 86_400_000).toLocaleDateString("en-CA");
    await form.getByLabel("Delayed until").fill(day);
    await form.getByLabel("Delay note").fill(`Ring about the exterior in spring ${run}`);
    await form.getByRole("button", { name: /^Delay until/ }).click();
    await expect(page.getByTestId("status-card")).toContainText("Delayed to");
    await expect(page.locator(".tl")).toContainText("Status changed");
    const { data: facts } = await db!.from("crm_account_facts").select("relationship_state, needs_you, flags").eq("account_id", accountId).single();
    expect(facts?.relationship_state).toBe("delayed");
    expect(facts?.needs_you).toBe(false);
    expect((facts?.flags as { chaseDue: boolean }).chaseDue).toBe(false);

    // Time passes: the date is behind us.
    await db!.from("accounts").update({ state_until: new Date(Date.now() - 3_600_000).toISOString() }).eq("id", accountId);
    await page.goto("/crm/today?f=followups");
    await expect(page.getByText(`${NAME} — the delay is up`)).toBeVisible();
    await expect(page.getByText(`Ring about the exterior in spring ${run}`)).toBeVisible();
    await page.goto(`/crm/customers/${accountId}`);
    await expect(page.getByTestId("status-card")).toContainText("Delay ended");
  });

  test("lost with a ruled reason; a new estimate re-opens them on its own", async ({ page }) => {
    await loginAs(page, staff);
    await page.goto(`/crm/customers/${accountId}`);
    await page.getByTestId("state-lost").click();
    await page.getByTestId("lost-form").getByLabel("Lost reason").selectOption("too_expensive");
    await page.getByTestId("lost-form").getByRole("button", { name: "Mark lost" }).click();
    await expect(page.getByTestId("status-card")).toContainText("Lost — Too expensive");
    await expect(page.locator(".tl")).toContainText("too expensive");

    await page.goto(`/crm/customers?f=lost&q=${run}`);
    await expect(page.locator(".prow", { hasText: NAME })).toBeVisible();

    const est = await db!.from("estimates").insert({ title: `P4 reopen ${run}`, status: "draft", account_id: accountId, builder_state: { blocks: [] } }).select("id").single();
    expect(est.error).toBeNull();
    const { data: acc } = await db!.from("accounts").select("relationship_state, lost_reason").eq("id", accountId).single();
    expect(acc).toMatchObject({ relationship_state: "active", lost_reason: null });
  });

  test("permissions and tags show on the status line and filter the list; a view remembers the filter", async ({ page }) => {
    await loginAs(page, staff);
    await page.goto(`/crm/customers/${accountId}`);
    await page.getByTestId("permit-sms").getByRole("button", { name: "No", exact: true }).click();
    await expect(page.getByTestId("status-card")).toContainText("No texts");
    await expect(page.locator(".tl")).toContainText("Contact permission changed");
    const { data: acc } = await db!.from("accounts").select("permit_sms, marketing_unsubscribed_at").eq("id", accountId).single();
    expect(acc?.permit_sms).toBe("declined");
    expect(acc?.marketing_unsubscribed_at).not.toBeNull();

    await page.getByTestId("tags").getByRole("button", { name: "Strata" }).click();
    await expect(page.getByTestId("status-card")).toContainText("Strata");

    await page.goto(`/crm/customers?tag=strata&q=${run}`);
    const row = page.locator(".prow", { hasText: NAME });
    await expect(row).toBeVisible();
    await expect(row).toContainText("Strata");
    await page.goto(`/crm/customers?tag=heritage&q=${run}`);
    await expect(page.locator(".prow", { hasText: NAME })).toHaveCount(0);

    page.once("dialog", (d) => d.accept(`Strata view ${run}`));
    await page.goto(`/crm/customers?tag=strata`);
    await page.getByTestId("save-view").click();
    await page.waitForURL(/v=strata-view/);
    await expect(page.getByTestId("views")).toContainText(`Strata view ${run}`);
  });

  test("archived leaves every list, but search still finds them", async ({ page }) => {
    await loginAs(page, staff);
    await page.goto(`/crm/customers/${accountId}`);
    page.once("dialog", (d) => d.accept());
    await page.getByTestId("state-archived").click();
    // Tom, 7 Sep (item 10): archiving lands you back on Customers, with a flash.
    await page.waitForURL(/\/crm\/customers\?archived=1/);
    await expect(page.getByTestId("flash")).toContainText("Archived");
    await page.goto("/crm/customers?f=all");
    // Not in the default list…
    await expect(page.locator(".prow", { hasText: NAME })).toHaveCount(0);
    // …but search finds them.
    await page.goto(`/crm/customers?q=${run}`);
    await expect(page.locator(".prow", { hasText: NAME })).toBeVisible();
  });

  test("Settings → CRM saves a threshold the rules read", async ({ page }) => {
    await loginAs(page, staff);
    await page.goto("/settings#crm");
    const field = page.getByTestId("crm-chaseUnopenedDays");
    await expect(field).toBeVisible();
    const before = await field.inputValue();
    await field.fill("2");
    await page.getByTestId("crm-save").click();
    await expect(page.getByText(/Saved\./)).toBeVisible();
    const { data } = await db!.from("settings").select("value").eq("key", "crm").single();
    expect((data?.value as { chaseUnopenedDays: number }).chaseUnopenedDays).toBe(2);
    // Put it back.
    await field.fill(before);
    await page.getByTestId("crm-save").click();
    await expect(page.getByText(/Saved\./)).toBeVisible();
  });
});

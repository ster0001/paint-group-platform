import { test, expect, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { serviceClient } from "./fixtures/woLoop";

/**
 * CRM v2 · P2 — the customer record, driven as staff on the real screens (C1).
 *
 *   · quick add: a name and a phone make a customer, and the same phone again
 *     opens the record you already have
 *   · the head shows the phone as tap-to-call and edits in place
 *   · owner, another person on the account, the log sheet with a follow-up
 *     date, and clearing the reminder — all on the timeline
 *   · a duplicate (same mobile) shows a banner; one click merges it
 *   · global search finds the record by name
 */

const db: SupabaseClient | null = serviceClient();
const staff = { email: process.env.E2E_STAFF_EMAIL ?? "", password: process.env.E2E_STAFF_PASSWORD ?? "" };

const run = randomBytes(4).toString("hex");
const DIGITS = String(parseInt(run.slice(0, 6), 16)).padStart(8, "0").slice(0, 8);
const PHONE = `04${DIGITS.slice(0, 2)} ${DIGITS.slice(2, 5)} ${DIGITS.slice(5, 8)}`;
const NAME = `Nadia Quickadd ${run}`;
const SHOTS = process.env.CRM_P2_SHOTS ?? "";

async function loginAs(page: Page, who: { email: string; password: string }) {
  await page.goto("/login");
  await page.fill('input[type="email"]', who.email);
  await page.fill('input[type="password"]', who.password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}
async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

test.describe("CRM v2 P2 — the customer record", () => {
  test.describe.configure({ mode: "serial" });
  test.skip(!db || !staff.email, "needs SUPABASE_SERVICE_ROLE_KEY + E2E_STAFF_* creds");

  let accountId = "";
  let dupId = "";

  test.afterAll(async () => {
    const sb = db!;
    for (const id of [accountId, dupId]) {
      if (!id) continue;
      const { error } = await sb.from("accounts").delete().eq("id", id);
      if (error) throw new Error(`account delete failed: ${error.message}`);
    }
  });

  test("quick add makes a phone-only customer, and the same phone finds them again", async ({ page }) => {
    await loginAs(page, staff);
    await page.goto("/crm/customers");
    await page.getByTestId("quick-add").click();
    await page.getByLabel("Name").fill(NAME);
    await page.getByLabel("Phone").fill(PHONE);
    await page.getByRole("button", { name: "Add" }).click();
    await page.waitForURL(/\/crm\/customers\/[0-9a-f-]{36}/);
    accountId = page.url().match(/\/crm\/customers\/([0-9a-f-]{36})/)![1];
    await expect(page.getByTestId("flash")).toContainText("New customer added");
    await expect(page.locator(".hname")).toContainText(NAME);
    await expect(page.getByTestId("tel-link")).toHaveAttribute("href", `tel:04${DIGITS}`);
    await shot(page, "record-new");

    // Same mobile again → the same record, not a second one.
    await page.goto("/crm/customers");
    await page.getByTestId("quick-add").click();
    await page.getByLabel("Name").fill("Somebody Else");
    await page.getByLabel("Phone").fill(PHONE.replace(/\s/g, ""));
    await page.getByRole("button", { name: "Add" }).click();
    await page.waitForURL(new RegExp(`/crm/customers/${accountId}`));
    await expect(page.getByTestId("flash")).toContainText("Already a customer");
  });

  test("details edit in place; owner, a second person, a logged call with a follow-up date, and the clear", async ({ page }) => {
    await loginAs(page, staff);
    await page.goto(`/crm/customers/${accountId}`);

    await page.getByTestId("edit-details").click();
    const edit = page.getByTestId("record-edit");
    await edit.getByLabel("Email").fill(`nadia.${run}@volume.example`);
    await edit.getByRole("button", { name: "Save" }).click();
    await expect(page.locator(".rcontact")).toContainText(`nadia.${run}@volume.example`);
    await expect(page.locator(".tl")).toContainText("Details updated");

    // Owner: the signed-in staff member.
    const owner = page.getByLabel("Owner");
    const options = await owner.locator("option").allTextContents();
    expect(options.length).toBeGreaterThan(1);
    await owner.selectOption({ index: 1 });
    await expect(page.locator(".tl")).toContainText("Owner set");
    await expect(page.getByTestId("status-card")).toContainText("Owner:");

    // Another person on the account.
    await page.getByTestId("add-contact").click();
    const cform = page.getByTestId("contact-form");
    await cform.getByLabel("Contact name").fill(`Partner ${run}`);
    await cform.getByLabel("Contact phone").fill("0400 111 222");
    await cform.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByTestId("contacts")).toContainText(`Partner ${run}`);
    await expect(page.locator(".tl")).toContainText("Contact changed");

    // The log sheet: spoke to them, come back tomorrow.
    const sheet = page.getByTestId("log-sheet").first();
    await sheet.getByRole("button", { name: "Spoke to customer" }).click();
    await sheet.locator("textarea").fill(`Wants the exterior done before Christmas ${run}`);
    await sheet.getByRole("button", { name: "Tomorrow" }).click();
    await sheet.getByRole("button", { name: "Save" }).click();
    await expect(page.locator(".tl")).toContainText("Spoke to customer");
    await expect(page.locator(".tl")).toContainText(`before Christmas ${run}`);
    await expect(page.getByTestId("status-card")).toContainText("Follow up");
    await expect(page.locator(".stat", { hasText: "Last contact" })).toContainText("0d ago");
    await shot(page, "record-logged");

    // Clear the reminder.
    await page.getByTestId("clear-followup").click();
    await expect(page.getByTestId("clear-followup")).toHaveCount(0);
    await expect(page.getByTestId("status-card")).not.toContainText("Follow up");
  });

  test("a second record with the same mobile shows the banner, and one click merges it", async ({ page }) => {
    const sb = db!;
    const dup = await sb.from("accounts").insert({ email: `dup.${run}@volume.example`, name: `Nadia Q (dup ${run})`, phone: PHONE }).select("id").single();
    if (dup.error) throw new Error(dup.error.message);
    dupId = dup.data.id as string;

    await loginAs(page, staff);
    await page.goto(`/crm/customers/${accountId}`);
    await expect(page.getByTestId("dup-banner")).toContainText(`Nadia Q (dup ${run})`);
    await shot(page, "record-dup");
    page.once("dialog", (d) => d.accept());
    await page.getByTestId("merge-dup").click();
    await expect(page.getByTestId("dup-banner")).toHaveCount(0);
    await expect(page.locator(".tl")).toContainText("Merged a duplicate record");
    const gone = await sb.from("accounts").select("id").eq("id", dupId).maybeSingle();
    expect(gone.data).toBeNull();
    dupId = "";
  });

  test("global search finds the record by name from any CRM page", async ({ page }) => {
    await loginAs(page, staff);
    await page.goto("/crm/today");
    const box = page.getByTestId("global-search");
    await box.fill(`Quickadd ${run}`);
    const hit = page.locator(".gshit", { hasText: NAME });
    await expect(hit).toBeVisible();
    await hit.click();
    await page.waitForURL(new RegExp(`/crm/customers/${accountId}`));
    await expect(page.locator(".hname")).toContainText(NAME);
  });
});

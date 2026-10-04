import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { serviceClient } from "./fixtures/woLoop";
import { destroyAccountChain } from "./fixtures/portal";
import { credentials, missingCreds, signIn } from "./helpers";

/**
 * Tom, 4 Oct 2026 — three asks on the estimate's Contact card:
 *   1. a search bar at the top of the Contact modal,
 *   2. every CRM account in the Contacts list (migration 20270210),
 *   3. a contact used on an estimate is ALWAYS saved to Contacts.
 * Driven as staff against the real builder; the CRM half is asserted through
 * the service client (a trigger, not a screen). Everything planted here is
 * removed in afterAll — by the run marker, never by pattern.
 */

const db: SupabaseClient | null = serviceClient();
const staff = credentials("STAFF");
const run = randomBytes(4).toString("hex");

const planted = {
  first_name: "Zelda", last_name: `Planted${run}`, email: `zelda.${run}@example.com`,
  phone: "0400 111 222", city: "Brunswick", company: null, address: null, state: null, postal: null,
};
const typedEmail = `typed.${run}@example.com`;
const crmEmail = `crm.${run}@example.com`;

test.describe("estimate contact: search bar, always saved, CRM mirrored", () => {
  test.skip(!db, "needs SUPABASE_SERVICE_ROLE_KEY");
  test.skip(!staff, missingCreds("STAFF"));

  test.beforeAll(async () => {
    const { error } = await db!.from("contacts").insert(planted);
    if (error) throw new Error(`plant contact: ${error.message}`);
  });

  test.afterAll(async () => {
    const sb = db!;
    await sb.from("contacts").delete().in("email", [planted.email, typedEmail]);
    await destroyAccountChain(sb, crmEmail); // takes its mirrored contact with it
    await sb.from("contacts").delete().eq("email", crmEmail);
  });

  test("1: the search bar at the top of the Contact modal finds a contact by name or phone and fills the form", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto("/quote");
    await page.getByRole("button", { name: /add contact/i }).first().click();

    const search = page.getByTestId("contact-search-input");
    await expect(search).toBeVisible();
    // The search sits ABOVE the form fields.
    const sBox = await search.boundingBox();
    const fBox = await page.getByTestId("contact-phone").boundingBox();
    expect(sBox!.y).toBeLessThan(fBox!.y);

    await search.fill(`Planted${run}`);
    const hit = page.getByTestId("contact-search-hit");
    await expect(hit).toHaveCount(1);
    await expect(hit).toContainText(`Zelda Planted${run}`);
    await page.screenshot({ path: test.info().outputPath("contact-modal-search.png") });
    await hit.click();
    await expect(page.locator("label", { hasText: "First name" }).locator("input")).toHaveValue("Zelda");
    await expect(page.locator("label", { hasText: "Email" }).locator("input")).toHaveValue(planted.email);
    await expect(page.getByTestId("contact-picked")).toContainText(`Zelda Planted${run}`);

    // By phone, spaces or not.
    await page.getByRole("button", { name: "Start a new contact" }).click();
    await expect(page.locator("label", { hasText: "First name" }).locator("input")).toHaveValue("");
    await search.fill("0400111");
    await expect(page.getByTestId("contact-search-hit").filter({ hasText: `Planted${run}` })).toHaveCount(1);

    // A miss says so, and invites the new contact.
    await search.fill(`nobody-${run}`);
    await expect(page.getByTestId("contact-search-empty")).toBeVisible();
  });

  test("2: Use on estimate saves the contact to Contacts — there is no unsaved path", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto("/quote");
    await page.getByRole("button", { name: /add contact/i }).first().click();

    // The old optional "Save to Contacts" button is gone; one action does both.
    await expect(page.getByRole("button", { name: "Save to Contacts" })).toHaveCount(0);

    // Nothing typed → refused with a reason, modal stays open.
    await page.getByTestId("contact-use").click();
    await expect(page.getByText("Enter at least a name, a mobile or an email.")).toBeVisible();

    await page.locator("label", { hasText: "First name" }).locator("input").fill("Typed");
    await page.locator("label", { hasText: "Last name" }).locator("input").fill(`Person${run}`);
    await page.locator("label", { hasText: "Email" }).locator("input").fill(typedEmail);
    await page.getByTestId("contact-phone").fill("0400 333 444");
    await page.getByTestId("contact-use").click();

    // On the card, and in the Contacts table before the estimate is even saved.
    await expect(page.getByText(`Typed Person${run}`)).toBeVisible();
    await expect(page.getByTestId("contact-search-input")).toHaveCount(0);
    await expect
      .poll(async () => {
        const { data } = await db!.from("contacts").select("id, first_name, phone").eq("email", typedEmail).maybeSingle();
        return data ? `${(data as { first_name: string }).first_name}|${(data as { phone: string }).phone}` : "missing";
      }, { timeout: 15_000 })
      .toBe("Typed|0400 333 444");

    // Reopening shows it as a Contacts row (edits save back), not a loose copy.
    await page.getByRole("button", { name: "Edit Contact" }).click();
    await expect(page.getByTestId("contact-picked")).toContainText(`Typed Person${run}`);
  });

  test("3: a new CRM account becomes a Contacts row by itself (trigger 20270210)", async () => {
    const sb = db!;
    const { data: acct, error } = await sb.from("accounts")
      .insert({ name: `Crm Person${run}`, email: crmEmail, phone: "0400 555 666", account_type: "residential" })
      .select("id").single();
    if (error) throw new Error(`insert account: ${error.message}`);
    const accountId = (acct as { id: string }).id;

    const { data: contact, error: readErr } = await sb.from("contacts")
      .select("first_name, last_name, email, phone, account_id").eq("account_id", accountId).maybeSingle();
    if (readErr) throw new Error(`read contact: ${readErr.message}`);
    expect(contact).toMatchObject({ first_name: "Crm", last_name: `Person${run}`, email: crmEmail, phone: "0400 555 666" });

    // The same person again (merge-shaped): still ONE contact for the account.
    const { error: updErr } = await sb.from("accounts").update({ phone: "0400 555 667" }).eq("id", accountId);
    if (updErr) throw new Error(`update account: ${updErr.message}`);
    const { count } = await sb.from("contacts").select("id", { count: "exact", head: true }).eq("account_id", accountId);
    expect(count).toBe(1);
  });
});

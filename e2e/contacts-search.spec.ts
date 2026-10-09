import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { credentials, missingCreds, signIn } from "./helpers";
import { serviceClient } from "./fixtures/woLoop";

/**
 * Tom, 1 Oct 2026: a search bar on the Contacts page. A contact this spec
 * plants is found by surname, by company and by a phone typed without its
 * spaces; a stranger needle says so; Clear brings the whole list back.
 * The row is this spec's own, so it removes it (afterAll).
 */
const staff = credentials("STAFF");
const db: SupabaseClient | null = serviceClient();
const tag = Math.random().toString(36).slice(2, 8);
let contactId = "";

test.describe("Contacts · search", () => {
  test.skip(!staff, missingCreds("STAFF"));
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to plant the contact");

  test.beforeAll(async () => {
    const { data, error } = await db!.from("contacts").insert({
      first_name: "Search", last_name: `Fixture${tag}`, company: `Widgets ${tag} Pty Ltd`,
      email: `search-${tag}@example.com`, phone: "0412 345 678", city: "Oakleigh",
    }).select("id").single();
    if (error) throw new Error(`plant contact: ${error.message}`);
    contactId = (data as { id: string }).id;
  });
  test.afterAll(async () => { if (contactId) await db!.from("contacts").delete().eq("id", contactId); });

  test("surname, company and a spaceless phone each find the contact; a stranger needle says so", async ({ page }) => {
    await signIn(page, staff!, /\/(home|estimates)/);
    await page.goto("/contacts");
    const box = page.getByTestId("contacts-search-input");
    await expect(box).toBeVisible();
    const row = page.getByTestId("contact-row").filter({ hasText: `Fixture${tag}` });

    await box.fill(`fixture${tag}`);
    await expect(page).toHaveURL(new RegExp(`/contacts\\?q=fixture${tag}`), { timeout: 15_000 });
    await expect(row).toHaveCount(1);

    await box.fill(`Widgets ${tag}`);
    await expect(page).toHaveURL(/q=Widgets/, { timeout: 15_000 });
    await expect(row).toHaveCount(1);

    await page.goto("/contacts?q=0412345678");
    await expect(row).toHaveCount(1);

    await page.goto("/contacts?q=zzqx-nobody-here");
    await expect(page.getByTestId("contacts-search-empty")).toBeVisible();
    await expect(page.getByTestId("contact-row")).toHaveCount(0);

    // Clear is wired once React has attached (data-ready), then the list is whole again.
    await expect(page.getByTestId("contacts-search")).toHaveAttribute("data-ready", "1");
    await page.getByTestId("contacts-search-clear").click();
    await expect(page).toHaveURL(/\/contacts$/, { timeout: 15_000 });
    await expect(row).toHaveCount(1);
  });
});

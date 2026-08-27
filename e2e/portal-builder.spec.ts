import { test, expect, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { serviceClient } from "./fixtures/woLoop";
import { deleteUserByEmail, destroyAccountChain, magicLinkFor } from "./fixtures/portal";

/**
 * 3a-6 · The embedded builder + multi-property, as the signed-in customer.
 *
 * The law (brief): a returning customer prices a second job WITHOUT
 * re-entering anything the account already knows — address prefilled from
 * the property, no email gate anywhere — and the estimate lands linked to
 * the same account and property. A stranger gets no prefill.
 */

const db: SupabaseClient | null = serviceClient();

async function drive(page: Page) {
  await page.getByRole("button", { name: /There isn't a floorplan to hand/ }).click();
  const answer = async (heading: string | RegExp, label: string) => {
    const row = page
      .locator(".wz-qhead", { hasText: heading })
      .locator("xpath=following-sibling::div[1]")
      .getByRole("button", { name: label, exact: true });
    if (await row.count()) await row.first().click();
  };
  await answer("Heritage listed", "No");
  await answer("What kind of property", "House");
  const next = async () => {
    await page.getByRole("button", { name: /Continue|Nearly there|See my estimate/ }).first().click();
    const err = page.locator(".wz-err");
    if (await err.count()) throw new Error(`wizard gate: ${await err.first().innerText()}`);
  };
  await next(); // → surfaces
  await next(); // → condition
  await next(); // → details
  await answer(/built before 1970/, "No");
  await next(); // → paint (page 5 — the LAST page for a signed-in customer)
  await next(); // "See my estimate" — submits with no email gate in sight
  await expect(page.locator(".wz-r")).toBeVisible({ timeout: 90_000 });
}

test.describe("portal builder (3a-6)", () => {
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to run the portal builder suite");

  const run = randomBytes(4).toString("hex");
  const email = `pg.e2e.builder.${run}@example.com`;
  let accountId = "";
  let propertyId = "";

  test.beforeAll(async () => {
    const sb = db!;
    const acct = await sb.from("accounts").insert({ email, name: "Margaret Builder" }).select("id").single();
    if (acct.error) throw new Error(acct.error.message);
    accountId = acct.data.id;
    const prop = await sb.from("properties").insert({
      account_id: accountId, address: "12 Acacia Street", suburb: "Murrumbeena",
      // The REAL dedupe key (lib/accounts/identity.addressKey) — the wizard's
      // save must land on THIS row, which is the whole point of the test.
      state: "VIC", postcode: "3163", address_norm: "12 acacia street murrumbeena 3163",
    }).select("id").single();
    if (prop.error) throw new Error(prop.error.message);
    propertyId = prop.data.id;
  });

  test.afterAll(async () => {
    const sb = db!;
    await destroyAccountChain(sb, email);
    await deleteUserByEmail(sb, email);
  });

  test("a returning customer prices a second job without re-entering known facts", async ({ page }) => {
    test.setTimeout(240_000);
    const sb = db!;
    await page.goto(await magicLinkFor(sb, email));

    // Home offers the builder, aimed at their property.
    const cta = page.getByRole("link", { name: "Get a new estimate" });
    await expect(cta).toHaveAttribute("href", `/estimate?property=${propertyId}`);
    await page.goto(`/estimate?property=${propertyId}`);
    if (await page.getByText(/nearly here/i).count()) {
      test.skip(true, "wizard_public is off and member bypass unavailable in this environment");
    }

    // Known facts are already there: the address and the suburb.
    await expect(page.locator("input.wz-field").first()).toHaveValue(/12 Acacia Street/);
    await expect(page.getByPlaceholder("Suburb")).toHaveValue("Murrumbeena");
    await expect(page.getByPlaceholder("Postcode")).toHaveValue("3163");

    // The whole flow, with no email field anywhere (the gate page is gone).
    // The save's server time doubles as the ⚑14 wizard-save measurement on
    // the live stack (C1 has no wizard seed data).
    let saveMs = 0;
    page.on("requestfinished", (req) => {
      if (req.url().includes("/api/wizard/submit")) {
        const t = req.timing();
        saveMs = t.responseEnd - t.requestStart;
      }
    });
    await drive(page);
    if (saveMs > 0) {
      console.log("WIZARD SAVE (live):", Math.round(saveMs), "ms");
      const { writeFileSync, readFileSync, existsSync, mkdirSync } = await import("node:fs");
      mkdirSync("test-results", { recursive: true });
      const path = "test-results/volume-gate.json";
      const prev = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
      writeFileSync(path, JSON.stringify({ ...prev, wizardSaveLiveMs: Math.round(saveMs) }, null, 2));
    }
    expect(await page.locator("input[type=email]").count()).toBe(0);

    // The estimate landed on the same account AND property, identified by
    // the verified session — not by anything typed.
    const { data: ests } = await sb.from("estimates")
      .select("id, property_id, account_id").eq("account_id", accountId);
    expect(ests?.length).toBe(1);
    expect(ests![0].property_id).toBe(propertyId);
    const { data: lead } = await sb.from("wizard_leads")
      .select("email").eq("estimate_id", ests![0].id).maybeSingle();
    expect(lead?.email).toBe(email);

    // And Home now lists it — the loop closes without a single form.
    await page.goto("/account");
    await expect(page.locator("h1")).toHaveText(/Your estimate is saved/);
  });

  test("a stranger gets no prefill from someone else's property id", async ({ page }) => {
    await page.goto(`/estimate?property=${propertyId}`);
    if (await page.getByText(/nearly here/i).count()) test.skip(true, "wizard_public off");
    await page.getByRole("button", { name: /There isn't a floorplan to hand/ }).click();
    await expect(page.getByPlaceholder("Suburb")).toHaveValue("");
    expect(await page.getByText("12 Acacia Street").count()).toBe(0);
  });

  test("add an address: one screen, kept alongside, switcher appears, dedupe holds", async ({ page }) => {
    const sb = db!;
    await page.goto(await magicLinkFor(sb, email));
    await page.goto("/account/addresses/new");

    await page.locator("#aa-street").fill("4 Elm Grove");
    await page.locator("#aa-suburb").fill("Preston");
    await page.locator("#aa-postcode").fill("3072");
    await page.getByRole("button", { name: "Add this address" }).click();

    await expect(page).toHaveURL(/\/account\?property=/);
    // Two addresses → the switcher, with both named.
    await expect(page.getByRole("link", { name: "Everything" })).toBeVisible();
    await expect(page.getByRole("link", { name: "12 Acacia Street" })).toBeVisible();
    await expect(page.getByRole("link", { name: "4 Elm Grove" })).toBeVisible();

    // Same address again = the same property, never a duplicate.
    await page.goto("/account/addresses/new");
    await page.locator("#aa-street").fill("4/Elm  grove");
    await page.locator("#aa-suburb").fill("PRESTON");
    await page.locator("#aa-postcode").fill("3072");
    await page.getByRole("button", { name: "Add this address" }).click();
    await expect(page).toHaveURL(/\/account\?property=/);
    const { count } = await sb.from("properties")
      .select("id", { count: "exact", head: true }).eq("account_id", accountId);
    expect(count).toBe(2);

    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto("/account");
    await page.screenshot({ path: "test-results/look-portal/phone-home-switcher.png", fullPage: true });
  });
});

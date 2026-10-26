import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { serviceClient } from "./fixtures/woLoop";
import { deleteUserByEmail, destroyAccountChain, magicLinkFor, openMagicLink } from "./fixtures/portal";

/**
 * Portal UX + light mode (brief 25 Oct 2026) · Home, as the signed-in customer.
 *
 *  C3  Estimates group into Needs you / With us / Done, newest first; every
 *      card carries address, status chip, a one-line next step and a date.
 *  C2  Seven properties, two of them the same address: the strip shows
 *      Everything + four chips + "More (n)", the duplicate is one chip with a
 *      count, and the strip is never taller than two rows at 400px.
 *  B4  Tapping anywhere on an estimate card opens it.
 *  C4  One "Get an estimate for another property" button.
 *  A3  Every route renders light: the page background is the paper token.
 */

const db: SupabaseClient | null = serviceClient();
const SHOTS = "docs/briefs/portal-ux-light-screens";

test.describe("portal Home — grouped estimates and capped address chips", () => {
  test.skip(!db, "set SUPABASE_SERVICE_ROLE_KEY to run the portal Home suite");

  const run = randomBytes(4).toString("hex");
  const email = `pg.e2e.homegroups.${run}@example.com`;
  const sentToken = `hg${run}${randomBytes(6).toString("hex")}`;

  test.beforeAll(async () => {
    const sb = db!;
    const acct = await sb.from("accounts").insert({ email, name: "Harriet Groups" }).select("id").single();
    if (acct.error) throw new Error(acct.error.message);
    const accountId = acct.data.id as string;

    const addresses = [
      ["1/41 Devoy Street", "Ashwood", "3147"],
      ["2 Beech Rise", "Ringwood", "3134"],
      ["288 Bluff Road", "Sandringham", "3191"],
      ["13 Leamington Crescent", "Caulfield East", "3145"],
      ["13 Leamington Crescent", "Caulfield East", "3145"], // the duplicate
      ["53B Talbot Crescent", "Kooyong", "3144"],
      ["1330 Ferntree Gully Road", "Scoresby", "3179"],
    ];
    const props = await sb.from("properties")
      .insert(addresses.map(([address, suburb, postcode]) => ({ account_id: accountId, address, suburb, postcode })))
      .select("id, address");
    if (props.error) throw new Error(props.error.message);
    const idOf = (address: string, nth = 0) => props.data.filter((p) => p.address === address)[nth].id as string;

    const base = { account_id: accountId, level_of_finish: 3, builder_state: { blocks: [] } };
    const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
    const rows = [
      { ...base, title: "1/41 Devoy Street, Ashwood", status: "sent", source: "customer_intake", share_token: sentToken, sent_at: ago(0), property_id: idOf("1/41 Devoy Street") },
      { ...base, title: "53B Talbot Crescent, Kooyong", status: "draft", source: "customer_intake", property_id: idOf("53B Talbot Crescent") },
      { ...base, title: "1330 Ferntree Gully Road, Scoresby", status: "draft", source: "manual", property_id: idOf("1330 Ferntree Gully Road") },
      { ...base, title: "2 Beech Rise, Ringwood", status: "accepted", source: "customer_intake", accepted_total_cents: 1_214_129, property_id: idOf("2 Beech Rise") },
      { ...base, title: "13 Leamington Crescent, Caulfield East", status: "declined", source: "customer_intake", property_id: idOf("13 Leamington Crescent", 0) },
      { ...base, title: "13 Leamington Crescent, Caulfield East", status: "declined", source: "customer_intake", property_id: idOf("13 Leamington Crescent", 1) },
      { ...base, title: "288 Bluff Road, Sandringham", status: "declined", source: "customer_intake", property_id: idOf("288 Bluff Road") },
    ];
    const ests = await sb.from("estimates").insert(rows).select("id");
    if (ests.error) throw new Error(ests.error.message);
    mkdirSync(SHOTS, { recursive: true });
  });

  test.afterAll(async () => {
    await destroyAccountChain(db!, email);
    await deleteUserByEmail(db!, email);
  });

  test("groups, chips, whole-card tap, one CTA — at 400px and on desktop", async ({ page }) => {
    const sb = db!;
    await page.setViewportSize({ width: 400, height: 860 });
    await openMagicLink(page, await magicLinkFor(sb, email));
    await page.goto("/account");

    // A3: light — the paper background, not the old graphite.
    expect(await page.locator(".acct").evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(246, 245, 241)");

    // C3: three groups in order; Done starts collapsed.
    const needs = page.getByTestId("group-needs-you");
    const withUs = page.getByTestId("group-with-us");
    const done = page.getByTestId("group-done");
    await expect(needs.locator("h2")).toHaveText("Needs you");
    await expect(withUs.locator("h2")).toHaveText("With us");
    await expect(done).not.toHaveAttribute("open", "");
    expect(await done.locator(".job").first().isVisible()).toBe(false);

    const ready = needs.locator(".job", { hasText: "1/41 Devoy Street" });
    await expect(ready.locator(".chip")).toHaveText("Ready for you");
    await expect(ready).toContainText("Your estimate is ready — tap to open it");
    await expect(ready).toContainText("Updated today");
    const shaping = needs.locator(".job", { hasText: "53B Talbot Crescent" });
    await expect(shaping.locator(".chip")).toHaveText("Keep shaping");
    await expect(shaping).toContainText("Confirm your rooms to finalise your price");
    const checking = withUs.locator(".job", { hasText: "1330 Ferntree Gully Road" });
    await expect(checking.locator(".chip")).toHaveText("Being checked");
    await expect(checking).toContainText("within one business day");
    await expect(checking).toContainText(/Sent today/);

    await done.locator("summary").click();
    await expect(done.locator(".job")).toHaveCount(4);
    await expect(done.locator(".job", { hasText: "2 Beech Rise" }).locator(".chip")).toHaveText("Accepted");

    // C2: Everything + 4 + More (2); the duplicate is one chip with a count; two rows at most.
    const strip = page.getByTestId("address-strip");
    await expect(page.getByTestId("address-chip")).toHaveCount(4);
    await expect(page.getByTestId("address-more")).toHaveText("More (2)");
    const box = (await strip.boundingBox())!;
    expect(box.height, "chip strip stays within two rows at 400px").toBeLessThan(90);
    await page.getByTestId("address-more").click();
    await expect(page.getByTestId("address-chip")).toHaveCount(6);
    const leamington = page.getByTestId("address-chip").filter({ hasText: "13 Leamington Crescent" });
    await expect(leamington).toHaveCount(1);
    await expect(leamington).toContainText("· 2");
    // Selecting the merged chip filters to BOTH records behind it.
    await leamington.click();
    await expect(page).toHaveURL(/property=/);
    await page.getByTestId("group-done").locator("summary").click();
    await expect(page.getByTestId("group-done").locator(".job")).toHaveCount(2);
    await page.getByRole("link", { name: "Everything" }).click();

    // C4: one estimate button, address step first; Add a property keeps its own door.
    await expect(page.getByRole("link", { name: "Get an estimate for another property" })).toHaveAttribute("href", "/estimate");
    await expect(page.getByRole("link", { name: "Add a property (no estimate yet)" })).toHaveAttribute("href", "/account/addresses/new");
    expect(await page.getByRole("link", { name: "Get a new estimate" }).count()).toBe(0);
    expect(await page.locator(".btn-cyan").count()).toBe(1);

    // B3: nothing floats over the tab bar.
    await expect(page.getByTestId("assistant-widget-launch")).toHaveCount(0);

    await page.screenshot({ path: `${SHOTS}/home-phone.png`, fullPage: true });

    // B4: tapping the next-step TEXT (not a button) opens the estimate.
    await ready.locator(".meta").click();
    await expect(page).toHaveURL(new RegExp(`/e/${sentToken}`));

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/account");
    await expect(page.getByTestId("group-needs-you")).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/home-desktop.png`, fullPage: true });
  });
});

import { expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { test } from "../helpers";
import { serviceClient } from "../fixtures/woLoop";
import { deleteUserByEmail, destroyAccountChain, magicLinkFor, openMagicLink } from "../fixtures/portal";

/**
 * Paint Home brief §5 (lead and account data) + ⚑ P8 — the customer's own
 * pages in the brand of their estimate, as the customer, on a phone.
 *
 *  1. a Paint Home estimate's /e page names Paint Home (header mark, footer
 *     line, tab title) — on the Paint Home host AND on the platform host:
 *     the brand follows the estimate, not the address it was opened from
 *  2. the shared account: the magic link opens a portal whose header is the
 *     Paint Home mark while every estimate is Paint Home's; a Paint Group
 *     estimate joining the account flips the header to Paint Group and tags
 *     the Paint Home job
 */
const db = serviceClient();

const SNAPSHOT_BASE = {
  version: 1,
  company: { name: "Paint Group", addressLine1: "", addressLine2: "", phone: "", abn: "", email: "", estimatorName: "", estimatorTitle: "", estimatorPhone: "", logoUrl: "" },
  contactName: "Paint Home Customer", contactEmail: "", jobTitle: "Interior repaint", gstRatePct: 10, depositPct: 10,
  lineItems: [], options: [], paints: [], inclusions: [], exclusions: [], terms: "",
  discountMode: "pct", discountPct: 0, discountFixedCents: 0, baseSubtotalCents: 100000,
  proof: { rating: "5.0", reviews: "93+", liability: "$20M", warranty: "2-year", accreditations: [] },
  areas: [{ id: "1", title: "Lounge", descriptionHtml: "", priceCents: 100000, surfaces: [{ label: "Walls", coats: 2, product: "" }], photos: [] }],
};
const token = (prefix: string) => `${prefix}${randomBytes(18).toString("base64url")}`;

test.describe("Paint Home — comms and portal (session 4)", () => {
  test.skip(!db, "needs SUPABASE_SERVICE_ROLE_KEY");
  test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

  const run = randomBytes(3).toString("hex");
  const email = `pg.e2e.ph-comms-${run}@example.com`;
  let phRoot = "";
  let accountId = "";
  let phToken = "";

  test.beforeAll(async ({ baseURL }) => {
    const u = new URL(baseURL!);
    phRoot = `${u.protocol}//painthome.localhost${u.port ? `:${u.port}` : ""}`;
    const acct = await db!.from("accounts").insert({ email, name: `Paint Home Customer ${run}` }).select("id").single();
    if (acct.error) throw acct.error;
    accountId = acct.data.id as string;
    phToken = token("ph");
    const est = await db!.from("estimates").insert({
      status: "sent", source: "customer_intake", brand: "painthome", level_of_finish: 3, title: `7/40 Wattletree Road ${run}`,
      account_id: accountId, sent_at: new Date().toISOString(),
      builder_state: { blocks: [], modSel: { "Level of Finish": "FIN-3" }, materials: {} },
      share_token: phToken, sent_snapshot: { ...SNAPSHOT_BASE, estRef: phToken.slice(0, 8).toUpperCase(), jobAddress: `7/40 Wattletree Road, Malvern East ${run}` },
      total_cents: 110000, subtotal_cents: 100000,
    }).select("id").single();
    if (est.error) throw est.error;
  });
  test.afterAll(async () => {
    if (!db) return;
    await destroyAccountChain(db, email);
    await deleteUserByEmail(db, email);
  });

  test("1 · a Paint Home estimate's page is Paint Home's on either host", async ({ page, baseURL }) => {
    for (const origin of [phRoot, baseURL!]) {
      await page.goto(`${origin}/e/${phToken}`);
      await expect(page).toHaveTitle("Your estimate · Paint Home");
      await expect(page.locator("header img.brandlogo, .brandlogo").first()).toHaveAttribute("alt", "Paint Home");
      await expect(page.locator("body")).toContainText("Paint Home · Melbourne");
      await expect(page.locator("header").first()).not.toContainText("Paint Group");
    }
  });

  test("2 · the shared portal: Paint Home header for a Paint Home-only account; a Paint Group job flips it and is tagged", async ({ page }) => {
    test.setTimeout(120_000);
    await openMagicLink(page, await magicLinkFor(db!, email));
    await expect(page).toHaveURL(/\/account/);
    await expect(page.locator(".app")).toHaveAttribute("data-brand", "painthome");
    await expect(page.getByTestId("painthome-logo-nav")).toBeVisible();
    await expect(page.getByTestId("job-brand")).toHaveCount(0);

    // a Paint Group estimate joins the same account (the office quoted them before)
    const pgToken = token("pg");
    const est = await db!.from("estimates").insert({
      status: "sent", source: "manual", level_of_finish: 3, title: `Earlier job ${run}`,
      account_id: accountId, sent_at: new Date().toISOString(),
      builder_state: { blocks: [], modSel: { "Level of Finish": "FIN-3" }, materials: {} },
      share_token: pgToken, sent_snapshot: { ...SNAPSHOT_BASE, estRef: pgToken.slice(0, 8).toUpperCase(), jobAddress: `12 Elm Street ${run}` },
      total_cents: 110000, subtotal_cents: 100000,
    }).select("id").single();
    if (est.error) throw est.error;

    await page.goto(`/account?v=${run}`);
    await expect(page.locator(".app")).toHaveAttribute("data-brand", "paintgroup");
    await expect(page.getByTestId("painthome-logo-nav")).toHaveCount(0);
    await expect(page.getByTestId("job-brand")).toHaveCount(1);
    await expect(page.getByTestId("job-brand")).toHaveText("Paint Home");
  });
});
